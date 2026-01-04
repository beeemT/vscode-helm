import * as yaml from 'js-yaml';
import * as path from 'path';
import * as vscode from 'vscode';

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

        return {
          chartRoot: currentDir,
          chartYamlPath,
          valuesYamlPath,
          valuesOverrideFiles,
        };
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
  public getReleaseInfo(chartRoot: string): ReleaseInfo {
    const chartName = path.basename(chartRoot);
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
      const chartRoot = path.dirname(chartYamlUri.fsPath);
      const valuesYamlPath = path.join(chartRoot, 'values.yaml');
      const valuesOverrideFiles = await this.findValuesFiles(chartRoot);

      charts.push({
        chartRoot,
        chartYamlPath: chartYamlUri.fsPath,
        valuesYamlPath,
        valuesOverrideFiles,
      });
    }

    return charts.sort((a, b) => a.chartRoot.localeCompare(b.chartRoot));
  }
}
