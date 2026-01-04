import * as yaml from 'js-yaml';
import { HelmChartService } from './helmChartService';

/**
 * Cached values data for a Helm chart
 */
interface CachedValues {
  /** Default values from values.yaml */
  defaultValues: Record<string, unknown>;
  /** Override values from selected file */
  overrideValues: Record<string, unknown>;
  /** Merged values (default + override) */
  merged: Record<string, unknown>;
  /** Timestamp of last update */
  timestamp: number;
  /** Selected override file path (empty string for none) */
  selectedOverrideFile: string;
}

/**
 * Cached subchart values (merged from subchart defaults + parent overrides)
 */
interface CachedSubchartValues {
  /** The merged values as the subchart would see them */
  merged: Record<string, unknown>;
  /** Timestamp of last update */
  timestamp: number;
  /** Parent's selected override file */
  parentOverrideFile: string;
}

/**
 * Source of a resolved value
 * - 'override': Value from a selected override file
 * - 'default': Value from the chart's own values.yaml
 * - 'parent-default': Value from parent chart's values.yaml (for subcharts)
 * - 'inline-default': Value from inline default in template
 */
export type ValueSource = 'override' | 'default' | 'parent-default' | 'inline-default';

/**
 * Position of a value in a YAML file
 */
export interface ValuePosition {
  filePath: string;
  line: number;
  character: number;
  /** Where the value comes from */
  source: ValueSource;
}

/**
 * Service for caching and resolving Helm values
 */
export class ValuesCache {
  private static instance: ValuesCache;
  private cache: Map<string, CachedValues> = new Map();
  private subchartCache: Map<string, CachedSubchartValues> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly DEBOUNCE_MS = 300;

  private constructor() {}

  public static getInstance(): ValuesCache {
    if (!ValuesCache.instance) {
      ValuesCache.instance = new ValuesCache();
    }
    return ValuesCache.instance;
  }

  /**
   * Get cached values for a chart, loading them if necessary
   */
  public async getValues(
    chartRoot: string,
    selectedOverrideFile: string
  ): Promise<Record<string, unknown>> {
    const cacheKey = chartRoot;
    const cached = this.cache.get(cacheKey);

    // Return cached values if override file hasn't changed
    if (cached && cached.selectedOverrideFile === selectedOverrideFile) {
      return cached.merged;
    }

    // Load and cache values
    return this.loadValues(chartRoot, selectedOverrideFile);
  }

  /**
   * Get values for a subchart as the subchart would see them.
   * Follows Helm's merge behavior:
   * 1. Start with subchart's own values.yaml defaults
   * 2. Merge parent's values under the subchart key (alias or name)
   * 3. Include global values from parent
   *
   * @param parentChartRoot Root of the parent chart
   * @param subchartRoot Root of the subchart
   * @param subchartKey The key used in parent's values.yaml (alias or name)
   * @param parentOverrideFile Selected override file in parent chart
   */
  public async getValuesForSubchart(
    parentChartRoot: string,
    subchartRoot: string,
    subchartKey: string,
    parentOverrideFile: string
  ): Promise<Record<string, unknown>> {
    // Check subchart cache
    const cacheKey = `${subchartRoot}:${parentOverrideFile}`;
    const cached = this.subchartCache.get(cacheKey);
    if (cached && cached.parentOverrideFile === parentOverrideFile) {
      return cached.merged;
    }

    const helmService = HelmChartService.getInstance();

    // 1. Load subchart's own default values
    let subchartDefaults: Record<string, unknown> = {};
    const subchartValuesPath = await helmService.getDefaultValuesPath(subchartRoot);
    if (subchartValuesPath) {
      try {
        const content = await helmService.readFileContents(subchartValuesPath);
        subchartDefaults = (yaml.load(content) as Record<string, unknown>) || {};
      } catch (error) {
        console.error(`Failed to parse subchart default values: ${error}`);
      }
    }

    // 2. Get parent's merged values
    const parentValues = await this.getValues(parentChartRoot, parentOverrideFile);

    // 3. Extract values for this subchart from parent (under subchartKey)
    const parentSubchartValues = (parentValues[subchartKey] as Record<string, unknown>) || {};

    // 4. Extract global values from parent
    const globalValues = (parentValues['global'] as Record<string, unknown>) || {};

    // 5. Merge: subchart defaults <- parent subchart values
    let merged = this.deepMerge(subchartDefaults, parentSubchartValues);

    // 6. Add global values (they should be accessible as .Values.global in subchart)
    if (Object.keys(globalValues).length > 0) {
      merged = this.deepMerge(merged, { global: globalValues });
    }

    // Cache the result
    this.subchartCache.set(cacheKey, {
      merged,
      timestamp: Date.now(),
      parentOverrideFile,
    });

    return merged;
  }

  /**
   * Load values from files and update cache
   */
  private async loadValues(
    chartRoot: string,
    selectedOverrideFile: string
  ): Promise<Record<string, unknown>> {
    const helmService = HelmChartService.getInstance();

    // Load default values
    let defaultValues: Record<string, unknown> = {};
    const defaultValuesPath = await helmService.getDefaultValuesPath(chartRoot);

    if (defaultValuesPath) {
      try {
        const content = await helmService.readFileContents(defaultValuesPath);
        defaultValues = (yaml.load(content) as Record<string, unknown>) || {};
      } catch (error) {
        console.error(`Failed to parse default values: ${error}`);
      }
    }

    // Load override values if selected
    let overrideValues: Record<string, unknown> = {};
    if (selectedOverrideFile) {
      try {
        const content = await helmService.readFileContents(selectedOverrideFile);
        overrideValues = (yaml.load(content) as Record<string, unknown>) || {};
      } catch (error) {
        console.error(`Failed to parse override values: ${error}`);
      }
    }

    // Deep merge values
    const merged = this.deepMerge(defaultValues, overrideValues);

    // Update cache
    this.cache.set(chartRoot, {
      defaultValues,
      overrideValues,
      merged,
      timestamp: Date.now(),
      selectedOverrideFile,
    });

    return merged;
  }

  /**
   * Resolve a value path against the cached values
   */
  public resolveValuePath(
    values: Record<string, unknown>,
    path: string
  ): unknown {
    const segments = this.parseValuePath(path);
    let current: unknown = values;

    for (const segment of segments) {
      if (current === null || current === undefined) {
        return undefined;
      }

      if (typeof segment === 'number') {
        if (Array.isArray(current)) {
          current = current[segment];
        } else {
          return undefined;
        }
      } else {
        if (typeof current === 'object' && current !== null) {
          current = (current as Record<string, unknown>)[segment];
        } else {
          return undefined;
        }
      }
    }

    return current;
  }

  /**
   * Find the position of a value in a YAML file
   */
  public async findValuePosition(
    filePath: string,
    valuePath: string,
    source: ValueSource
  ): Promise<ValuePosition | undefined> {
    try {
      const helmService = HelmChartService.getInstance();
      const content = await helmService.readFileContents(filePath);
      const lines = content.split('\n');
      const segments = valuePath.split('.');

      let currentIndent = -1;
      let targetSegmentIndex = 0;

      for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        const trimmed = line.trimStart();

        // Skip empty lines and comments
        if (!trimmed || trimmed.startsWith('#')) {
          continue;
        }

        const indent = line.length - trimmed.length;
        const targetSegment = segments[targetSegmentIndex];

        // Check if this line matches the current target segment
        if (trimmed.startsWith(targetSegment + ':')) {
          // Verify indent is correct (deeper than parent)
          if (currentIndent === -1 || indent > currentIndent) {
            if (targetSegmentIndex === segments.length - 1) {
              // Found the target
              return {
                filePath,
                line: lineNum,
                character: indent,
                source,
              };
            }
            // Move to next segment
            targetSegmentIndex++;
            currentIndent = indent;
          }
        } else if (indent <= currentIndent && currentIndent >= 0) {
          // We've gone back up in the YAML hierarchy, reset search
          // This handles cases where the path doesn't exist at current level
          break;
        }
      }

      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Find the position of a value, checking override file first, then default
   */
  public async findValuePositionInChain(
    chartRoot: string,
    selectedOverrideFile: string,
    valuePath: string
  ): Promise<ValuePosition | undefined> {
    const helmService = HelmChartService.getInstance();

    // Check override file first
    if (selectedOverrideFile) {
      const overridePos = await this.findValuePosition(selectedOverrideFile, valuePath, 'override');
      if (overridePos) {
        return overridePos;
      }
    }

    // Fall back to default values
    const defaultValuesPath = await helmService.getDefaultValuesPath(chartRoot);
    if (defaultValuesPath) {
      return this.findValuePosition(defaultValuesPath, valuePath, 'default');
    }

    return undefined;
  }

  /**
   * Find the position of a subchart value in the chain:
   * 1. Parent override file (under subchartKey.path)
   * 2. Parent default values.yaml (under subchartKey.path)
   * 3. For global.* paths: check parent files at root level (global.path)
   * 4. Subchart's own values.yaml (under path)
   */
  public async findSubchartValuePositionInChain(
    parentChartRoot: string,
    subchartRoot: string,
    subchartKey: string,
    parentOverrideFile: string,
    valuePath: string
  ): Promise<ValuePosition | undefined> {
    const helmService = HelmChartService.getInstance();

    // The path in parent files is prefixed with subchart key
    const parentValuePath = `${subchartKey}.${valuePath}`;

    // Check parent override file first (under subchart key)
    if (parentOverrideFile) {
      const overridePos = await this.findValuePosition(
        parentOverrideFile,
        parentValuePath,
        'override'
      );
      if (overridePos) {
        return overridePos;
      }
    }

    // Check parent default values.yaml (under subchart key)
    const parentDefaultValuesPath = await helmService.getDefaultValuesPath(parentChartRoot);
    if (parentDefaultValuesPath) {
      const parentDefaultPos = await this.findValuePosition(
        parentDefaultValuesPath,
        parentValuePath,
        'parent-default'
      );
      if (parentDefaultPos) {
        return parentDefaultPos;
      }
    }

    // For global.* paths, also check parent files at root level
    // In Helm, global values are defined at root level in parent and passed to subcharts
    if (valuePath.startsWith('global.')) {
      if (parentOverrideFile) {
        const globalOverridePos = await this.findValuePosition(
          parentOverrideFile,
          valuePath, // Use path as-is (global.xxx)
          'override'
        );
        if (globalOverridePos) {
          return globalOverridePos;
        }
      }

      if (parentDefaultValuesPath) {
        const globalDefaultPos = await this.findValuePosition(
          parentDefaultValuesPath,
          valuePath, // Use path as-is (global.xxx)
          'parent-default'
        );
        if (globalDefaultPos) {
          return globalDefaultPos;
        }
      }
    }

    // Fall back to subchart's own values.yaml
    const subchartDefaultValuesPath = await helmService.getDefaultValuesPath(subchartRoot);
    if (subchartDefaultValuesPath) {
      return this.findValuePosition(subchartDefaultValuesPath, valuePath, 'default');
    }

    return undefined;
  }

  /**
   * Invalidate cache for a chart (with debouncing)
   */
  public invalidateCache(chartRoot: string): void {
    // Clear existing timer
    const existingTimer = this.debounceTimers.get(chartRoot);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new debounced invalidation
    const timer = setTimeout(() => {
      this.cache.delete(chartRoot);
      // Also invalidate any subchart caches that depend on this chart
      this.invalidateSubchartCaches(chartRoot);
      this.debounceTimers.delete(chartRoot);
    }, this.DEBOUNCE_MS);

    this.debounceTimers.set(chartRoot, timer);
  }

  /**
   * Immediately invalidate cache without debouncing
   */
  public invalidateCacheImmediate(chartRoot: string): void {
    const existingTimer = this.debounceTimers.get(chartRoot);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.debounceTimers.delete(chartRoot);
    }
    this.cache.delete(chartRoot);
    // Also invalidate any subchart caches that depend on this chart
    this.invalidateSubchartCaches(chartRoot);
  }

  /**
   * Invalidate subchart caches that might depend on a parent chart
   */
  private invalidateSubchartCaches(chartRoot: string): void {
    // Invalidate subchart caches for subcharts of this chart
    const chartsDir = chartRoot + '/charts/';
    for (const key of this.subchartCache.keys()) {
      // Key format is "subchartRoot:overrideFile"
      if (key.includes(chartsDir)) {
        this.subchartCache.delete(key);
      }
    }
    // Also check if this chart is a subchart and invalidate its cache
    for (const key of this.subchartCache.keys()) {
      if (key.startsWith(chartRoot + ':')) {
        this.subchartCache.delete(key);
      }
    }
  }

  /**
   * Clear all cached values
   */
  public clearAll(): void {
    this.debounceTimers.forEach((timer) => clearTimeout(timer));
    this.debounceTimers.clear();
    this.cache.clear();
    this.subchartCache.clear();
  }

  /**
   * Parse a value path into segments
   */
  private parseValuePath(path: string): (string | number)[] {
    const segments: (string | number)[] = [];
    const parts = path.split('.');

    for (const part of parts) {
      const arrayMatch = part.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[(\d+)\]$/);
      if (arrayMatch) {
        segments.push(arrayMatch[1]);
        segments.push(parseInt(arrayMatch[2], 10));
      } else {
        segments.push(part);
      }
    }

    return segments;
  }

  /**
   * Deep merge two objects, with source taking precedence
   */
  public deepMerge(
    target: Record<string, unknown>,
    source: Record<string, unknown>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = { ...target };

    for (const key of Object.keys(source)) {
      const sourceValue = source[key];
      const targetValue = target[key];

      if (
        sourceValue !== null &&
        typeof sourceValue === 'object' &&
        !Array.isArray(sourceValue) &&
        targetValue !== null &&
        typeof targetValue === 'object' &&
        !Array.isArray(targetValue)
      ) {
        result[key] = this.deepMerge(
          targetValue as Record<string, unknown>,
          sourceValue as Record<string, unknown>
        );
      } else {
        result[key] = sourceValue;
      }
    }

    return result;
  }

  /**
   * Format a value for display in an inlay hint
   */
  public formatValueForDisplay(value: unknown, maxLength: number = 50): string {
    if (value === undefined) {
      return '<undefined>';
    }

    if (value === null) {
      return 'null';
    }

    if (typeof value === 'string') {
      // Account for surrounding quotes in length calculation
      if (value.length + 2 > maxLength) {
        // maxLength - 5 accounts for: opening quote (1) + "..." (3) + closing quote (1)
        const truncateAt = Math.max(0, maxLength - 5);
        return `"${value.substring(0, truncateAt)}..."`;
      }
      return `"${value}"`;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    if (Array.isArray(value)) {
      const preview = `[${value.length} items]`;
      return preview;
    }

    if (typeof value === 'object') {
      const keys = Object.keys(value);
      const preview = `{${keys.length} keys}`;
      return preview;
    }

    return String(value);
  }
}
