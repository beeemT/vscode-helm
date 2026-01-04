import * as path from 'path';
import * as vscode from 'vscode';
import { HelmChartService, SubchartInfo } from '../services/helmChartService';
import { ValuesCache } from '../services/valuesCache';

/**
 * Completion item with metadata about its source
 */
interface SubchartCompletionItem extends vscode.CompletionItem {
  /** Whether this completion comes from an archive subchart */
  isFromArchive?: boolean;
  /** The subchart name/alias this completion belongs to */
  subchartKey?: string;
}

/**
 * Provider for autocompletion in Helm values files.
 * Suggests:
 * - Keys from the chart's own values.yaml when editing override files
 * - Subchart keys and their nested values based on discovered subcharts
 * Works with both expanded directories and .tgz archive subcharts.
 */
export class ValuesCompletionProvider implements vscode.CompletionItemProvider {
  private static instance: ValuesCompletionProvider;

  private constructor() {}

  public static getInstance(): ValuesCompletionProvider {
    if (!ValuesCompletionProvider.instance) {
      ValuesCompletionProvider.instance = new ValuesCompletionProvider();
    }
    return ValuesCompletionProvider.instance;
  }

  public async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    _context: vscode.CompletionContext
  ): Promise<vscode.CompletionItem[] | undefined> {
    const helmService = HelmChartService.getInstance();

    // Only process values files (not template files)
    if (helmService.isHelmTemplateFile(document.uri)) {
      return undefined;
    }

    // Check if this is a values file within a Helm chart
    const chartContext = await helmService.detectHelmChart(document.uri);
    if (!chartContext) {
      return undefined;
    }

    // Don't provide completions for subcharts - they get values from parent
    if (chartContext.isSubchart) {
      return undefined;
    }

    // Discover subcharts for this chart
    const subcharts = await helmService.discoverSubcharts(chartContext.chartRoot);

    // Check if this is an override file (not the default values.yaml)
    const isOverrideFile = this.isOverrideFile(document.uri.fsPath, chartContext.chartRoot);

    // If no subcharts and not an override file, nothing to suggest
    if (subcharts.length === 0 && !isOverrideFile) {
      return undefined;
    }

    // Get the current YAML path context at cursor position
    const pathContext = this.getPathContextAtPosition(document, position);

    // Build completions based on context
    const completions: vscode.CompletionItem[] = [];

    if (pathContext.depth === 0) {
      // At root level - suggest subchart keys, 'global', and chart values
      // Add subchart completions first so chart values can avoid duplicates
      if (subcharts.length > 0) {
        await this.addRootLevelCompletions(completions, subcharts);
      }
      if (isOverrideFile) {
        await this.addChartValuesCompletions(completions, chartContext.chartRoot, []);
      }
    } else if (pathContext.path.length > 0) {
      // Inside a key hierarchy - check if it's a subchart, global, or chart values path
      const topLevelKey = pathContext.path[0];

      if (topLevelKey === 'global') {
        // Inside global: - suggest common global keys from all subcharts
        await this.addGlobalCompletions(completions, subcharts, pathContext.path.slice(1));
      } else {
        // Check if topLevelKey matches a subchart
        const matchingSubchart = subcharts.find(
          (sub) => helmService.getSubchartValuesKey(sub) === topLevelKey
        );

        if (matchingSubchart) {
          // Inside a subchart key - suggest nested values from subchart defaults
          await this.addSubchartNestedCompletions(
            completions,
            matchingSubchart,
            pathContext.path.slice(1)
          );
        } else if (isOverrideFile) {
          // Not a subchart key - suggest nested values from chart's own values.yaml
          await this.addChartValuesCompletions(completions, chartContext.chartRoot, pathContext.path);
        }
      }
    }

    return completions.length > 0 ? completions : undefined;
  }

  /**
   * Check if a file is an override values file (not the default values.yaml/values.yml)
   */
  private isOverrideFile(filePath: string, chartRoot: string): boolean {
    const fileName = path.basename(filePath);
    const dir = path.dirname(filePath);
    const valuesSubdir = path.join(chartRoot, 'values');

    // Default values.yaml or values.yml is not an override file
    if ((fileName === 'values.yaml' || fileName === 'values.yml') && dir === chartRoot) {
      return false;
    }

    // Check if it matches override file patterns
    // Patterns: values*.yaml, *.values.yaml, *-values.yaml, values.*.yaml, values/*.yaml
    const isValuesPattern =
      fileName.startsWith('values') && (fileName.endsWith('.yaml') || fileName.endsWith('.yml'));
    const isDotValuesPattern = fileName.includes('.values.') && (fileName.endsWith('.yaml') || fileName.endsWith('.yml'));
    const isDashValuesPattern = fileName.includes('-values.') && (fileName.endsWith('.yaml') || fileName.endsWith('.yml'));
    const isValuesSubdir = dir === valuesSubdir && (fileName.endsWith('.yaml') || fileName.endsWith('.yml'));

    return isValuesPattern || isDotValuesPattern || isDashValuesPattern || isValuesSubdir;
  }

  /**
   * Get the YAML path context at the cursor position.
   * Returns the current path hierarchy and nesting depth.
   */
  private getPathContextAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): { path: string[]; depth: number; currentLineIndent: number } {
    const line = document.lineAt(position.line);
    const lineText = line.text;
    const trimmed = lineText.trimStart();
    const currentLineIndent = lineText.length - trimmed.length;

    // Handle empty line or cursor at start of document
    if (!trimmed || position.line === 0) {
      // Check if we're in a nested context by looking at previous non-empty lines
      return this.findParentContext(document, position.line, currentLineIndent);
    }

    // Check if cursor is on a line with a key
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) {
      // No colon on this line - check parent context
      return this.findParentContext(document, position.line, currentLineIndent);
    }

    // Extract key from current line if cursor is after the colon (adding nested value)
    const cursorColumn = position.character;
    const keyEndIndex = lineText.indexOf(':');

    if (cursorColumn > keyEndIndex) {
      // Cursor is after colon - we're adding a value or nested key
      const keyMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/);
      if (keyMatch) {
        const currentKey = keyMatch[1];
        const parentContext = this.findParentContext(document, position.line, currentLineIndent);
        return {
          path: [...parentContext.path, currentKey],
          depth: parentContext.depth + 1,
          currentLineIndent,
        };
      }
    }

    // Cursor is on/before the key - suggest at parent level
    return this.findParentContext(document, position.line, currentLineIndent);
  }

  /**
   * Find the parent YAML path by walking backwards through the document.
   */
  private findParentContext(
    document: vscode.TextDocument,
    startLine: number,
    currentIndent: number
  ): { path: string[]; depth: number; currentLineIndent: number } {
    const pathSegments: string[] = [];
    let targetIndent = currentIndent;
    let depth = 0;

    // Walk backwards through lines to find parent keys
    for (let lineNum = startLine - 1; lineNum >= 0; lineNum--) {
      const prevLine = document.lineAt(lineNum).text;
      const prevTrimmed = prevLine.trimStart();

      // Skip empty lines and comments
      if (!prevTrimmed || prevTrimmed.startsWith('#')) {
        continue;
      }

      const prevIndent = prevLine.length - prevTrimmed.length;

      // If we find a line with less indentation, it's a potential parent
      if (prevIndent < targetIndent) {
        const parentKeyMatch = prevTrimmed.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/);
        if (parentKeyMatch) {
          pathSegments.unshift(parentKeyMatch[1]);
          targetIndent = prevIndent;
          depth++;

          // If we've reached the top level (indent 0), we're done
          if (prevIndent === 0) {
            break;
          }
        }
      }
    }

    return { path: pathSegments, depth, currentLineIndent: currentIndent };
  }

  /**
   * Add root-level completions for subchart keys and 'global'.
   */
  private async addRootLevelCompletions(
    completions: vscode.CompletionItem[],
    subcharts: SubchartInfo[]
  ): Promise<void> {
    const helmService = HelmChartService.getInstance();
    const valuesCache = ValuesCache.getInstance();

    // Add 'global' completion
    const globalItem = new vscode.CompletionItem('global', vscode.CompletionItemKind.Module);
    globalItem.detail = 'Global values shared with all subcharts';
    globalItem.documentation = new vscode.MarkdownString(
      'Values under `global:` are automatically available to all subcharts as `.Values.global.*`'
    );
    globalItem.insertText = new vscode.SnippetString('global:\n  $0');
    globalItem.sortText = '0global'; // Sort before subcharts
    completions.push(globalItem);

    // Add subchart key completions
    for (const subchart of subcharts) {
      const subchartKey = helmService.getSubchartValuesKey(subchart);
      const defaults = await valuesCache.loadSubchartDefaults(subchart);

      const item = new vscode.CompletionItem(
        subchartKey,
        vscode.CompletionItemKind.Module
      ) as SubchartCompletionItem;

      item.isFromArchive = subchart.isArchive;
      item.subchartKey = subchartKey;

      // Build detail and documentation
      const archiveIndicator = subchart.isArchive ? ' 📦' : '';
      item.detail = `Subchart: ${subchart.name}${archiveIndicator}`;

      const defaultKeys = Object.keys(defaults).slice(0, 5);
      const keyPreview = defaultKeys.length > 0
        ? `Available keys: \`${defaultKeys.join('`, `')}\`${Object.keys(defaults).length > 5 ? ', ...' : ''}`
        : 'No default values';

      const docParts = [
        `Override values for the **${subchart.name}** subchart.`,
        '',
        keyPreview,
      ];

      if (subchart.isArchive) {
        docParts.push('', '*📦 This subchart is from a .tgz archive*');
      }

      if (subchart.alias && subchart.alias !== subchart.name) {
        docParts.push('', `*Alias for dependency: ${subchart.name}*`);
      }

      item.documentation = new vscode.MarkdownString(docParts.join('\n'));
      item.insertText = new vscode.SnippetString(`${subchartKey}:\n  $0`);
      item.sortText = `1${subchartKey}`; // Sort after global
      completions.push(item);
    }
  }

  /**
   * Add completions based on the chart's own values.yaml.
   * Used when editing override files to suggest available keys.
   */
  private async addChartValuesCompletions(
    completions: vscode.CompletionItem[],
    chartRoot: string,
    currentPath: string[]
  ): Promise<void> {
    const helmService = HelmChartService.getInstance();
    const valuesCache = ValuesCache.getInstance();

    // Load the chart's default values
    const defaultValuesPath = await helmService.getDefaultValuesPath(chartRoot);
    if (!defaultValuesPath) {
      return;
    }

    // Use cache to get default values (with empty override to just get defaults)
    const defaults = await valuesCache.getValues(chartRoot, '');

    // Navigate to the current position in the defaults
    let currentObj: Record<string, unknown> = defaults;
    for (const segment of currentPath) {
      const value = currentObj[segment];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        currentObj = value as Record<string, unknown>;
      } else {
        // Path doesn't exist or leads to non-object - no completions
        return;
      }
    }

    // Get existing keys in completions to avoid duplicates
    const existingKeys = new Set(completions.map((item) =>
      typeof item.label === 'string' ? item.label : item.label.label
    ));

    // Add completions for keys at this level
    for (const [key, value] of Object.entries(currentObj)) {
      // Skip if already added (e.g., 'global' or subchart keys at root level)
      if (existingKeys.has(key)) {
        continue;
      }

      const isObject = value && typeof value === 'object' && !Array.isArray(value);

      const item = new vscode.CompletionItem(
        key,
        isObject ? vscode.CompletionItemKind.Property : vscode.CompletionItemKind.Value
      );

      // Format the default value for display
      const valuePreview = this.formatValuePreview(value);
      item.detail = `Default: ${valuePreview}`;

      const pathDisplay = currentPath.length > 0 ? `${currentPath.join('.')}.${key}` : key;
      item.documentation = new vscode.MarkdownString(
        `Default value from \`values.yaml\` at \`${pathDisplay}\``
      );

      // Insert with appropriate format
      if (isObject) {
        item.insertText = new vscode.SnippetString(`${key}:\n  $0`);
      } else if (typeof value === 'string') {
        item.insertText = new vscode.SnippetString(`${key}: "\${1:${value}}"`);
      } else {
        item.insertText = new vscode.SnippetString(`${key}: \${1:${value}}`);
      }

      // Sort after subcharts but before other items
      item.sortText = `2${key}`;
      completions.push(item);
    }
  }

  /**
   * Add completions for nested values within a subchart.
   */
  private async addSubchartNestedCompletions(
    completions: vscode.CompletionItem[],
    subchart: SubchartInfo,
    remainingPath: string[]
  ): Promise<void> {
    const valuesCache = ValuesCache.getInstance();
    const defaults = await valuesCache.loadSubchartDefaults(subchart);

    // Navigate to the current position in the defaults
    let currentObj: Record<string, unknown> = defaults;
    for (const segment of remainingPath) {
      const value = currentObj[segment];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        currentObj = value as Record<string, unknown>;
      } else {
        // Path doesn't exist or leads to non-object - no completions
        return;
      }
    }

    // Add completions for keys at this level
    const archiveIndicator = subchart.isArchive ? ' 📦' : '';

    for (const [key, value] of Object.entries(currentObj)) {
      const isObject = value && typeof value === 'object' && !Array.isArray(value);

      const item = new vscode.CompletionItem(
        key,
        isObject ? vscode.CompletionItemKind.Property : vscode.CompletionItemKind.Value
      ) as SubchartCompletionItem;

      item.isFromArchive = subchart.isArchive;
      item.subchartKey = key;

      // Format the default value for display
      const valuePreview = this.formatValuePreview(value);
      item.detail = `Default: ${valuePreview}${archiveIndicator}`;

      const docParts = [`Default value from \`${subchart.name}/values.yaml\``];
      if (subchart.isArchive) {
        docParts.push('', '*📦 From archive subchart*');
      }
      item.documentation = new vscode.MarkdownString(docParts.join('\n'));

      // Insert with appropriate format
      if (isObject) {
        item.insertText = new vscode.SnippetString(`${key}:\n  $0`);
      } else if (typeof value === 'string') {
        item.insertText = new vscode.SnippetString(`${key}: "\${1:${value}}"`);
      } else {
        item.insertText = new vscode.SnippetString(`${key}: \${1:${value}}`);
      }

      completions.push(item);
    }
  }

  /**
   * Add completions for global values based on what subcharts reference.
   */
  private async addGlobalCompletions(
    completions: vscode.CompletionItem[],
    subcharts: SubchartInfo[],
    remainingPath: string[]
  ): Promise<void> {
    const valuesCache = ValuesCache.getInstance();

    // Collect all global keys referenced across subcharts
    const globalKeys = new Map<string, { defaultValue: unknown; sources: string[] }>();

    for (const subchart of subcharts) {
      const defaults = await valuesCache.loadSubchartDefaults(subchart);
      const globalDefaults = defaults['global'] as Record<string, unknown> | undefined;

      if (globalDefaults && typeof globalDefaults === 'object') {
        // Navigate to the current position
        let currentObj = globalDefaults;
        for (const segment of remainingPath) {
          const value = currentObj[segment];
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            currentObj = value as Record<string, unknown>;
          } else {
            currentObj = {};
            break;
          }
        }

        // Collect keys at this level
        for (const [key, value] of Object.entries(currentObj)) {
          const existing = globalKeys.get(key);
          if (existing) {
            existing.sources.push(subchart.name);
          } else {
            globalKeys.set(key, { defaultValue: value, sources: [subchart.name] });
          }
        }
      }
    }

    // Add common global keys as suggestions
    this.addCommonGlobalSuggestions(completions, remainingPath.length === 0);

    // Add collected global keys from subcharts
    for (const [key, info] of globalKeys) {
      const isObject = info.defaultValue && typeof info.defaultValue === 'object' && !Array.isArray(info.defaultValue);

      const item = new vscode.CompletionItem(
        key,
        isObject ? vscode.CompletionItemKind.Property : vscode.CompletionItemKind.Value
      );

      const valuePreview = this.formatValuePreview(info.defaultValue);
      item.detail = `Used by: ${info.sources.join(', ')}`;

      const docParts = [
        `Global value referenced by subcharts.`,
        '',
        `Default: \`${valuePreview}\``,
        '',
        `Used in: ${info.sources.map(s => `\`${s}\``).join(', ')}`,
      ];
      item.documentation = new vscode.MarkdownString(docParts.join('\n'));

      if (isObject) {
        item.insertText = new vscode.SnippetString(`${key}:\n  $0`);
      } else if (typeof info.defaultValue === 'string') {
        item.insertText = new vscode.SnippetString(`${key}: "\${1:${info.defaultValue}}"`);
      } else {
        item.insertText = new vscode.SnippetString(`${key}: \${1:${info.defaultValue}}`);
      }

      item.sortText = `1${key}`; // Sort after common suggestions
      completions.push(item);
    }
  }

  /**
   * Add common global key suggestions.
   */
  private addCommonGlobalSuggestions(completions: vscode.CompletionItem[], isRootGlobal: boolean): void {
    if (!isRootGlobal) {
      return;
    }

    const commonGlobals = [
      { key: 'imageRegistry', description: 'Global Docker image registry', example: 'docker.io' },
      { key: 'imagePullSecrets', description: 'Global image pull secrets', example: '[]' },
      { key: 'storageClass', description: 'Global storage class', example: 'standard' },
      { key: 'environment', description: 'Deployment environment', example: 'production' },
      { key: 'domain', description: 'Base domain for ingress', example: 'example.com' },
    ];

    for (const global of commonGlobals) {
      const item = new vscode.CompletionItem(global.key, vscode.CompletionItemKind.Variable);
      item.detail = global.description;
      item.documentation = new vscode.MarkdownString(
        `Common global value.\n\nExample: \`${global.example}\``
      );
      item.insertText = new vscode.SnippetString(
        global.example.startsWith('[')
          ? `${global.key}:\n  $0`
          : `${global.key}: "\${1:${global.example}}"`
      );
      item.sortText = `0${global.key}`; // Sort before subchart-specific globals
      completions.push(item);
    }
  }

  /**
   * Format a value for preview display.
   */
  private formatValuePreview(value: unknown, maxLength: number = 30): string {
    if (value === undefined) {
      return '<undefined>';
    }
    if (value === null) {
      return 'null';
    }
    if (typeof value === 'string') {
      if (value.length > maxLength) {
        return `"${value.substring(0, maxLength - 3)}..."`;
      }
      return `"${value}"`;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (Array.isArray(value)) {
      return `[${value.length} items]`;
    }
    if (typeof value === 'object') {
      const keys = Object.keys(value);
      return `{${keys.length} keys}`;
    }
    return String(value);
  }
}
