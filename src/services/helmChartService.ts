import * as yaml from 'js-yaml';
import * as path from 'path';
import * as vscode from 'vscode';
import { ArchiveReader } from './archiveReader';

/**
 * Represents the context of a detected Helm chart
 */
export interface HelmChartContext {
  /** Absolute path to the chart root directory */
  chartRoot: string;
  /** Absolute path to Chart.yaml */
  chartYamlPath: string;
  /** Absolute path to default values.yaml */
  valuesYamlPath: string;
  /** List of absolute paths to values override files */
  valuesOverrideFiles: string[];
  /** Whether this chart is a subchart (inside another chart's charts/ directory) */
  isSubchart: boolean;
  /** If subchart, the alias or name used to reference it from the parent */
  subchartName?: string;
  /** If subchart, the parent chart context */
  parentChart?: HelmChartContext;
  /** Discovered subcharts in this chart's charts/ directory */
  subcharts: SubchartInfo[];
}

/**
 * Information about a subchart discovered in charts/ directory
 */
export interface SubchartInfo {
  /** The directory name of the subchart (or archive filename without extension) */
  name: string;
  /** Alias from Chart.yaml dependencies (if any) */
  alias?: string;
  /** Absolute path to the subchart root (directory path or archive path) */
  chartRoot: string;
  /** Condition expression from Chart.yaml (if any) */
  condition?: string;
  /** Whether this subchart is from a .tgz archive */
  isArchive?: boolean;
  /** Absolute path to the archive file (only set if isArchive is true) */
  archivePath?: string;
}

/**
 * Represents Chart.yaml metadata
 */
export interface ChartMetadata {
  apiVersion?: string;
  name?: string;
  version?: string;
  kubeVersion?: string;
  description?: string;
  type?: string;
  keywords?: string[];
  home?: string;
  sources?: string[];
  dependencies?: Array<{
    name: string;
    version: string;
    repository?: string;
    condition?: string;
    tags?: string[];
    alias?: string;
  }>;
  maintainers?: Array<{
    name: string;
    email?: string;
    url?: string;
  }>;
  icon?: string;
  appVersion?: string;
  deprecated?: boolean;
  annotations?: Record<string, string>;
}

/**
 * Represents Release information (simulated for decoration purposes)
 */
export interface ReleaseInfo {
  Name: string;
  Namespace: string;
  IsUpgrade: boolean;
  IsInstall: boolean;
  Revision: number;
  Service: string;
}

/**
 * Service for detecting Helm charts and discovering values files
 */
export class HelmChartService {
  private static instance: HelmChartService;
  private chartMetadataCache: Map<string, Record<string, unknown>> = new Map();

  private constructor() {}

  public static getInstance(): HelmChartService {
    if (!HelmChartService.instance) {
      HelmChartService.instance = new HelmChartService();
    }
    return HelmChartService.instance;
  }

  /**
   * Detect the Helm chart context for a given file URI.
   * Walks up the directory tree looking for Chart.yaml.
   * Also detects if the chart is a subchart of a parent chart.
   */
  public async detectHelmChart(fileUri: vscode.Uri): Promise<HelmChartContext | undefined> {
    let currentDir = path.dirname(fileUri.fsPath);
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
    const workspaceRoot = workspaceFolder?.uri.fsPath;

    // Walk up directories looking for Chart.yaml
    while (currentDir) {
      const chartYamlPath = path.join(currentDir, 'Chart.yaml');

      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(chartYamlPath));

        // Found Chart.yaml - this is the chart root
        const valuesYamlPath = path.join(currentDir, 'values.yaml');
        const valuesOverrideFiles = await this.findValuesFiles(currentDir);

        // Check if this chart is a subchart (inside another chart's charts/ directory)
        const subchartInfo = await this.detectSubchartContext(currentDir, workspaceRoot);

        // Discover subcharts in this chart's charts/ directory
        const subcharts = await this.discoverSubcharts(currentDir);

        const context: HelmChartContext = {
          chartRoot: currentDir,
          chartYamlPath,
          valuesYamlPath,
          valuesOverrideFiles,
          isSubchart: subchartInfo.isSubchart,
          subchartName: subchartInfo.subchartName,
          parentChart: subchartInfo.parentChart,
          subcharts,
        };

        return context;
      } catch {
        // Chart.yaml not found, go up one level
        const parentDir = path.dirname(currentDir);

        // Stop if we've reached the workspace root or filesystem root
        if (parentDir === currentDir) {
          break;
        }

        // Don't go above workspace root if we have one
        if (workspaceRoot && !parentDir.startsWith(workspaceRoot)) {
          break;
        }

        currentDir = parentDir;
      }
    }

    return undefined;
  }

  /**
   * Check if a chart directory is a subchart (inside another chart's charts/ directory).
   * Returns subchart context info including parent chart if found.
   * Recursively detects nested subcharts with cycle detection.
   */
  private async detectSubchartContext(
    chartRoot: string,
    workspaceRoot: string | undefined,
    visited: Set<string> = new Set()
  ): Promise<{
    isSubchart: boolean;
    subchartName?: string;
    parentChart?: HelmChartContext;
  }> {
    // Cycle detection: if we've already visited this chart, stop recursion
    if (visited.has(chartRoot)) {
      return { isSubchart: false };
    }
    visited.add(chartRoot);

    const parentDir = path.dirname(chartRoot);
    const dirName = path.basename(parentDir);

    // Check if immediate parent directory is named "charts"
    if (dirName !== 'charts') {
      return { isSubchart: false };
    }

    // Look for parent Chart.yaml one level up from charts/
    const potentialParentRoot = path.dirname(parentDir);
    const potentialParentChartYaml = path.join(potentialParentRoot, 'Chart.yaml');

    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(potentialParentChartYaml));

      // Found parent chart - get the subchart name (could be aliased)
      const subchartDirName = path.basename(chartRoot);
      const subchartName = await this.resolveSubchartName(potentialParentRoot, subchartDirName);

      // Build parent context - recursively detect if parent is also a subchart
      const parentValuesYamlPath = path.join(potentialParentRoot, 'values.yaml');
      const parentValuesOverrideFiles = await this.findValuesFiles(potentialParentRoot);
      const parentSubcharts = await this.discoverSubcharts(potentialParentRoot);

      // Recursively check if parent is also a subchart (with cycle detection)
      const parentSubchartInfo = await this.detectSubchartContext(
        potentialParentRoot,
        workspaceRoot,
        visited
      );

      const parentContext: HelmChartContext = {
        chartRoot: potentialParentRoot,
        chartYamlPath: potentialParentChartYaml,
        valuesYamlPath: parentValuesYamlPath,
        valuesOverrideFiles: parentValuesOverrideFiles,
        isSubchart: parentSubchartInfo.isSubchart,
        subchartName: parentSubchartInfo.subchartName,
        parentChart: parentSubchartInfo.parentChart,
        subcharts: parentSubcharts,
      };

      return {
        isSubchart: true,
        subchartName,
        parentChart: parentContext,
      };
    } catch {
      // No parent Chart.yaml found
      return { isSubchart: false };
    }
  }

  /**
   * Resolve the subchart name by checking if the parent Chart.yaml has an alias for it.
   * Returns the alias if found, otherwise the directory name.
   */
  private async resolveSubchartName(parentChartRoot: string, subchartDirName: string): Promise<string> {
    try {
      const chartYamlPath = path.join(parentChartRoot, 'Chart.yaml');
      const content = await this.readFileContents(chartYamlPath);
      const chartMetadata = yaml.load(content) as ChartMetadata;

      if (chartMetadata.dependencies) {
        // Find a dependency that matches this subchart directory
        for (const dep of chartMetadata.dependencies) {
          // The directory name is typically the dependency name (after download)
          // but could also be the alias if one was defined
          if (dep.name === subchartDirName || dep.alias === subchartDirName) {
            // Return alias if available, otherwise the name
            return dep.alias || dep.name;
          }
        }
      }
    } catch {
      // Ignore errors reading Chart.yaml
    }

    // Default to directory name
    return subchartDirName;
  }

  /**
   * Discover subcharts in the charts/ directory of a chart.
   * Discovers both expanded directories and .tgz archives.
   */
  public async discoverSubcharts(chartRoot: string): Promise<SubchartInfo[]> {
    const subcharts: SubchartInfo[] = [];
    const chartsDir = path.join(chartRoot, 'charts');

    // Check if charts/ directory exists
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(chartsDir));
    } catch {
      return subcharts;
    }

    // Read dependencies from Chart.yaml for alias mapping
    let dependencies: ChartMetadata['dependencies'] = [];
    try {
      const chartYamlPath = path.join(chartRoot, 'Chart.yaml');
      const content = await this.readFileContents(chartYamlPath);
      const chartMetadata = yaml.load(content) as ChartMetadata;
      dependencies = chartMetadata.dependencies || [];
    } catch {
      // Continue without dependency info
    }

    // Find all Chart.yaml files in charts/*/ (expanded directories)
    const pattern = new vscode.RelativePattern(chartsDir, '*/Chart.yaml');
    const chartFiles = await vscode.workspace.findFiles(pattern);

    for (const chartFile of chartFiles) {
      const subchartRoot = path.dirname(chartFile.fsPath);
      const subchartDirName = path.basename(subchartRoot);

      // Find matching dependency for alias and condition
      const matchingDep = dependencies.find(
        (dep) => dep.name === subchartDirName || dep.alias === subchartDirName
      );

      subcharts.push({
        name: subchartDirName,
        alias: matchingDep?.alias,
        chartRoot: subchartRoot,
        condition: matchingDep?.condition,
        isArchive: false,
      });
    }

    // Find all .tgz archives in charts/
    const archivePattern = new vscode.RelativePattern(chartsDir, '*.tgz');
    const archiveFiles = await vscode.workspace.findFiles(archivePattern);

    const archiveReader = ArchiveReader.getInstance();
    for (const archiveFile of archiveFiles) {
      const archivePath = archiveFile.fsPath;
      const chartName = await archiveReader.getChartName(archivePath);

      // Find matching dependency for alias and condition
      // Dependency name should match the chart name from the archive
      const matchingDep = dependencies.find(
        (dep) => dep.name === chartName || dep.alias === chartName
      );

      subcharts.push({
        name: chartName,
        alias: matchingDep?.alias,
        chartRoot: archivePath, // For archives, chartRoot is the archive path
        condition: matchingDep?.condition,
        isArchive: true,
        archivePath: archivePath,
      });
    }

    return subcharts.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get the effective name to use for accessing subchart values in the parent's values.yaml.
   * This is the alias if defined, otherwise the dependency name.
   */
  public getSubchartValuesKey(subchart: SubchartInfo): string {
    return subchart.alias || subchart.name;
  }

  /**
   * Get the root ancestor chart in a nested subchart hierarchy.
   * For a non-subchart, returns the chart itself.
   * For a subchart, walks up the parent chain to find the root.
   */
  public getRootAncestorChart(chartContext: HelmChartContext): HelmChartContext {
    let current = chartContext;
    while (current.isSubchart && current.parentChart) {
      current = current.parentChart;
    }
    return current;
  }

  /**
   * Build the ancestor chain from root to the given subchart.
   * Returns an array of { chartContext, subchartKey } pairs from root to leaf.
   * The first element is the root chart (subchartKey is undefined).
   * Each subsequent element is a subchart with its key in the parent's values.
   */
  public buildAncestorChain(
    chartContext: HelmChartContext
  ): Array<{ chart: HelmChartContext; subchartKey?: string }> {
    // Walk up to root, collecting ancestors
    const ancestors: Array<{ chart: HelmChartContext; subchartKey?: string }> = [];
    let current: HelmChartContext | undefined = chartContext;

    while (current) {
      if (current.isSubchart && current.subchartName) {
        ancestors.push({ chart: current, subchartKey: current.subchartName });
      } else {
        ancestors.push({ chart: current, subchartKey: undefined });
      }
      current = current.parentChart;
    }

    // Reverse to get root-to-leaf order
    return ancestors.reverse();
  }

  /**
   * Build the cache key for a subchart's values, including the full ancestor chain.
   * Format: rootChartRoot:parent1Key:parent2Key:...:leafKey:overrideFile
   */
  public buildSubchartCacheKey(chartContext: HelmChartContext, overrideFile: string): string {
    const chain = this.buildAncestorChain(chartContext);
    const keyParts = chain.map((item, index) => {
      if (index === 0) {
        return item.chart.chartRoot;
      }
      return item.subchartKey || 'unknown';
    });
    return `${keyParts.join(':')}:${overrideFile}`;
  }

  /**
   * Find all values override files in the chart root.
   * Excludes the default values.yaml file.
   *
   * Patterns searched:
   * - values*.yaml / values*.yml (e.g., values-prod.yaml)
   * - *.values.yaml / *.values.yml (e.g., prod.values.yaml)
   * - *-values.yaml / *-values.yml (e.g., prod-values.yaml)
   * - values.*.yaml / values.*.yml (e.g., values.prod.yaml)
   * - values/*.yaml subdirectory (e.g., values/prod.yaml)
   */
  public async findValuesFiles(chartRoot: string): Promise<string[]> {
    const files: Set<string> = new Set();

    // Pattern 1: values*.yaml / values*.yml in chart root
    const valuesStarPattern = new vscode.RelativePattern(chartRoot, 'values*.{yaml,yml}');
    const valuesStarFiles = await vscode.workspace.findFiles(valuesStarPattern);
    valuesStarFiles.forEach((f) => files.add(f.fsPath));

    // Pattern 2: *.values.yaml / *.values.yml in chart root
    const starValuesPattern = new vscode.RelativePattern(chartRoot, '*.values.{yaml,yml}');
    const starValuesFiles = await vscode.workspace.findFiles(starValuesPattern);
    starValuesFiles.forEach((f) => files.add(f.fsPath));

    // Pattern 3: *-values.yaml / *-values.yml in chart root
    const dashValuesPattern = new vscode.RelativePattern(chartRoot, '*-values.{yaml,yml}');
    const dashValuesFiles = await vscode.workspace.findFiles(dashValuesPattern);
    dashValuesFiles.forEach((f) => files.add(f.fsPath));

    // Pattern 4: values.*.yaml / values.*.yml in chart root
    const valuesDotPattern = new vscode.RelativePattern(chartRoot, 'values.*.{yaml,yml}');
    const valuesDotFiles = await vscode.workspace.findFiles(valuesDotPattern);
    valuesDotFiles.forEach((f) => files.add(f.fsPath));

    // Pattern 5: values/*.yaml subdirectory
    const valuesSubdirPattern = new vscode.RelativePattern(chartRoot, 'values/*.{yaml,yml}');
    const valuesSubdirFiles = await vscode.workspace.findFiles(valuesSubdirPattern);
    valuesSubdirFiles.forEach((f) => files.add(f.fsPath));

    // Filter out the default values.yaml and values.yml
    const defaultValuesPath = path.join(chartRoot, 'values.yaml');
    const defaultValuesYmlPath = path.join(chartRoot, 'values.yml');

    return Array.from(files)
      .filter((f) => f !== defaultValuesPath && f !== defaultValuesYmlPath)
      .sort();
  }

  /**
   * Check if a file is a Helm template file (inside templates/ directory)
   */
  public isHelmTemplateFile(uri: vscode.Uri): boolean {
    const normalizedPath = uri.fsPath.replace(/\\/g, '/');
    return normalizedPath.includes('/templates/');
  }

  /**
   * Check if the default values.yaml exists for a chart
   */
  public async hasDefaultValues(chartRoot: string): Promise<boolean> {
    const valuesYamlPath = path.join(chartRoot, 'values.yaml');
    const valuesYmlPath = path.join(chartRoot, 'values.yml');

    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(valuesYamlPath));
      return true;
    } catch {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(valuesYmlPath));
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Get the default values file path for a chart
   */
  public async getDefaultValuesPath(chartRoot: string): Promise<string | undefined> {
    const valuesYamlPath = path.join(chartRoot, 'values.yaml');
    const valuesYmlPath = path.join(chartRoot, 'values.yml');

    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(valuesYamlPath));
      return valuesYamlPath;
    } catch {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(valuesYmlPath));
        return valuesYmlPath;
      } catch {
        return undefined;
      }
    }
  }

  /**
   * Read file contents as string
   */
  public async readFileContents(filePath: string): Promise<string> {
    const uri = vscode.Uri.file(filePath);
    const content = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(content).toString('utf-8');
  }

  /**
   * Get Chart.yaml metadata for a chart.
   * Returns metadata with PascalCase keys to match Helm's .Chart object behavior.
   * (Helm templates use .Chart.Name, .Chart.Version, etc. with PascalCase)
   */
  public async getChartMetadata(chartRoot: string): Promise<Record<string, unknown> | undefined> {
    // Check cache first
    if (this.chartMetadataCache.has(chartRoot)) {
      return this.chartMetadataCache.get(chartRoot);
    }

    const chartYamlPath = path.join(chartRoot, 'Chart.yaml');
    try {
      const content = await this.readFileContents(chartYamlPath);
      const rawMetadata = yaml.load(content) as ChartMetadata;

      // Convert to PascalCase keys to match Helm's .Chart object behavior
      // Helm uses PascalCase for .Chart fields (e.g., .Chart.Name, .Chart.Version)
      const metadata: Record<string, unknown> = {
        Name: rawMetadata.name,
        Version: rawMetadata.version,
        AppVersion: rawMetadata.appVersion,
        Description: rawMetadata.description,
        Type: rawMetadata.type,
        ApiVersion: rawMetadata.apiVersion,
        KubeVersion: rawMetadata.kubeVersion,
        Keywords: rawMetadata.keywords,
        Home: rawMetadata.home,
        Sources: rawMetadata.sources,
        Dependencies: rawMetadata.dependencies,
        Maintainers: rawMetadata.maintainers,
        Icon: rawMetadata.icon,
        Deprecated: rawMetadata.deprecated,
        Annotations: rawMetadata.annotations,
      };

      this.chartMetadataCache.set(chartRoot, metadata);
      return metadata;
    } catch {
      return undefined;
    }
  }

  /**
   * Clear the Chart.yaml metadata cache for a chart
   */
  public clearChartMetadataCache(chartRoot?: string): void {
    if (chartRoot) {
      this.chartMetadataCache.delete(chartRoot);
    } else {
      this.chartMetadataCache.clear();
    }
  }

  /**
   * Get simulated Release information for decoration purposes.
   * In a real Helm deployment, these values come from the release context.
   * Here we provide placeholder values to show what would be available.
   */
  public getReleaseInfo(_chartRoot: string): ReleaseInfo {
    return {
      Name: `<release-name>`,
      Namespace: `<namespace>`,
      IsUpgrade: false,
      IsInstall: true,
      Revision: 1,
      Service: 'Helm',
    };
  }

  /**
   * Get Capabilities information (Kubernetes cluster capabilities)
   * These are placeholder values showing what's available at runtime.
   */
  public getCapabilities(): Record<string, unknown> {
    return {
      APIVersions: ['v1', 'apps/v1', 'batch/v1', '...'],
      KubeVersion: {
        Version: '<cluster-version>',
        Major: '<major>',
        Minor: '<minor>',
        GitVersion: '<git-version>',
      },
      HelmVersion: {
        Version: '<helm-version>',
        GitCommit: '<git-commit>',
        GitTreeState: '<git-tree-state>',
        GoVersion: '<go-version>',
      },
    };
  }

  /**
   * Get Template information for a specific template file
   */
  public getTemplateInfo(templatePath: string, chartRoot: string): Record<string, string> {
    const relativePath = path.relative(chartRoot, templatePath);
    const basePath = path.dirname(relativePath);
    return {
      Name: relativePath,
      BasePath: basePath,
    };
  }

  /**
   * Find all Helm charts in the workspace.
   * Returns an array of HelmChartContext for each chart found.
   */
  public async findAllChartsInWorkspace(): Promise<HelmChartContext[]> {
    const charts: HelmChartContext[] = [];

    // Find all Chart.yaml files in the workspace
    const chartYamlFiles = await vscode.workspace.findFiles('**/Chart.yaml', '**/node_modules/**');

    for (const chartYamlUri of chartYamlFiles) {
      // Use detectHelmChart to get full context including subchart info
      const chartContext = await this.detectHelmChart(chartYamlUri);
      if (chartContext) {
        charts.push(chartContext);
      }
    }

    return charts.sort((a, b) => a.chartRoot.localeCompare(b.chartRoot));
  }
}
