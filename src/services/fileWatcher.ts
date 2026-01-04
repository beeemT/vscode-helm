import * as path from 'path';
import * as vscode from 'vscode';
import { ArchiveReader } from './archiveReader';
import { HelmChartService } from './helmChartService';
import { ValuesCache } from './valuesCache';

/**
 * Callback type for file watcher events
 */
export type FileWatcherCallback = (chartRoot: string) => void;

/**
 * Service for watching file system changes related to Helm charts
 */
export class FileWatcher {
  private static instance: FileWatcher;
  private watchers: vscode.FileSystemWatcher[] = [];
  private onValuesChangedCallbacks: FileWatcherCallback[] = [];
  private onValuesFilesListChangedCallbacks: FileWatcherCallback[] = [];

  private constructor() {}

  public static getInstance(): FileWatcher {
    if (!FileWatcher.instance) {
      FileWatcher.instance = new FileWatcher();
    }
    return FileWatcher.instance;
  }

  /**
   * Initialize file watchers for the workspace
   */
  public initialize(context: vscode.ExtensionContext): void {
    // Watch for changes to values files in the workspace
    this.setupValuesFileWatcher(context);
    // Watch for changes in charts/ subdirectories (subcharts)
    this.setupSubchartWatcher(context);
  }

  /**
   * Set up watcher for values files
   */
  private setupValuesFileWatcher(context: vscode.ExtensionContext): void {
    // Watch for any YAML file that could be a values file
    const patterns = [
      '**/values*.yaml',
      '**/values*.yml',
      '**/*.values.yaml',
      '**/*.values.yml',
      '**/*-values.yaml',
      '**/*-values.yml',
      '**/values.*.yaml',
      '**/values.*.yml',
      '**/values/**/*.yaml',
      '**/values/**/*.yml',
    ];

    for (const pattern of patterns) {
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);

      watcher.onDidChange(async (uri) => {
        await this.handleValuesFileChange(uri);
      });

      watcher.onDidCreate(async (uri) => {
        await this.handleValuesFileCreated(uri);
      });

      watcher.onDidDelete(async (uri) => {
        await this.handleValuesFileDeleted(uri);
      });

      this.watchers.push(watcher);
      context.subscriptions.push(watcher);
    }
  }

  /**
   * Set up watcher for subchart files (charts/ directory)
   */
  private setupSubchartWatcher(context: vscode.ExtensionContext): void {
    // Watch for changes in charts/*/values.yaml and charts/*/Chart.yaml
    const subchartPatterns = [
      '**/charts/*/values.yaml',
      '**/charts/*/values.yml',
      '**/charts/*/Chart.yaml',
    ];

    for (const pattern of subchartPatterns) {
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);

      watcher.onDidChange(async (uri) => {
        await this.handleSubchartFileChange(uri);
      });

      watcher.onDidCreate(async (uri) => {
        await this.handleSubchartFileChange(uri);
      });

      watcher.onDidDelete(async (uri) => {
        await this.handleSubchartFileChange(uri);
      });

      this.watchers.push(watcher);
      context.subscriptions.push(watcher);
    }

    // Watch for .tgz archive changes in charts/ directory
    this.setupArchiveWatcher(context);
  }

  /**
   * Set up watcher for archive subcharts (.tgz files in charts/ directory)
   */
  private setupArchiveWatcher(context: vscode.ExtensionContext): void {
    const archivePattern = '**/charts/*.tgz';
    const watcher = vscode.workspace.createFileSystemWatcher(archivePattern);

    watcher.onDidChange(async (uri) => {
      await this.handleArchiveChange(uri);
    });

    watcher.onDidCreate(async (uri) => {
      await this.handleArchiveChange(uri);
    });

    watcher.onDidDelete(async (uri) => {
      await this.handleArchiveDelete(uri);
    });

    this.watchers.push(watcher);
    context.subscriptions.push(watcher);
  }

  /**
   * Handle archive file change (content changed or new archive added)
   */
  private async handleArchiveChange(uri: vscode.Uri): Promise<void> {
    const archivePath = uri.fsPath;
    const chartsDir = path.dirname(archivePath);

    if (path.basename(chartsDir) !== 'charts') {
      return;
    }

    const parentChartRoot = path.dirname(chartsDir);
    const parentChartYaml = path.join(parentChartRoot, 'Chart.yaml');

    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(parentChartYaml));

      // Invalidate archive cache
      const archiveReader = ArchiveReader.getInstance();
      archiveReader.invalidateCache(archivePath);

      // Invalidate parent chart's cache
      const valuesCache = ValuesCache.getInstance();
      valuesCache.invalidateCache(parentChartRoot);

      // Notify callbacks
      this.notifyValuesChanged(parentChartRoot);
      this.notifyValuesFilesListChanged(parentChartRoot);
    } catch {
      // Parent Chart.yaml not found
    }
  }

  /**
   * Handle archive file deletion
   */
  private async handleArchiveDelete(uri: vscode.Uri): Promise<void> {
    const archivePath = uri.fsPath;
    const chartsDir = path.dirname(archivePath);

    if (path.basename(chartsDir) !== 'charts') {
      return;
    }

    const parentChartRoot = path.dirname(chartsDir);
    const parentChartYaml = path.join(parentChartRoot, 'Chart.yaml');

    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(parentChartYaml));

      // Invalidate archive cache
      const archiveReader = ArchiveReader.getInstance();
      archiveReader.invalidateCache(archivePath);

      // Invalidate parent chart's cache
      const valuesCache = ValuesCache.getInstance();
      valuesCache.invalidateCacheImmediate(parentChartRoot);

      // Notify that subcharts list changed
      this.notifyValuesFilesListChanged(parentChartRoot);
    } catch {
      // Parent Chart.yaml not found
    }
  }

  /**
   * Handle subchart file changes (values.yaml or Chart.yaml in charts/ directory)
   */
  private async handleSubchartFileChange(uri: vscode.Uri): Promise<void> {
    // Find the parent chart root (two levels up from charts/subchart/)
    const subchartRoot = path.dirname(uri.fsPath);
    const chartsDir = path.dirname(subchartRoot);

    if (path.basename(chartsDir) !== 'charts') {
      return;
    }

    const parentChartRoot = path.dirname(chartsDir);
    const parentChartYaml = path.join(parentChartRoot, 'Chart.yaml');

    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(parentChartYaml));

      // Invalidate the parent chart's cache (which affects subchart value resolution)
      const valuesCache = ValuesCache.getInstance();
      valuesCache.invalidateCache(parentChartRoot);

      // Also invalidate the subchart's own cache if it has one
      valuesCache.invalidateCache(subchartRoot);

      // Notify callbacks
      this.notifyValuesChanged(parentChartRoot);
    } catch {
      // Parent Chart.yaml not found, not a valid parent chart
    }
  }

  /**
   * Handle values file content change
   */
  private async handleValuesFileChange(uri: vscode.Uri): Promise<void> {
    const helmService = HelmChartService.getInstance();
    const chartContext = await helmService.detectHelmChart(uri);

    if (chartContext) {
      // Invalidate cache for this chart
      const valuesCache = ValuesCache.getInstance();
      valuesCache.invalidateCache(chartContext.chartRoot);

      // Notify callbacks
      this.notifyValuesChanged(chartContext.chartRoot);
    }
  }

  /**
   * Handle new values file created
   */
  private async handleValuesFileCreated(uri: vscode.Uri): Promise<void> {
    const helmService = HelmChartService.getInstance();
    const chartContext = await helmService.detectHelmChart(uri);

    if (chartContext) {
      // Notify that the values files list has changed
      this.notifyValuesFilesListChanged(chartContext.chartRoot);
    }
  }

  /**
   * Handle values file deleted
   */
  private async handleValuesFileDeleted(uri: vscode.Uri): Promise<void> {
    // We need to find the chart root from the deleted file path
    // Since the file is deleted, we can't use detectHelmChart
    // Instead, walk up the directory tree looking for Chart.yaml

    let currentDir = path.dirname(uri.fsPath);
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspaceRoots = workspaceFolders?.map((f) => f.uri.fsPath) || [];

    while (currentDir) {
      const chartYamlPath = path.join(currentDir, 'Chart.yaml');

      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(chartYamlPath));

        // Found the chart root
        const valuesCache = ValuesCache.getInstance();
        valuesCache.invalidateCacheImmediate(currentDir);
        this.notifyValuesFilesListChanged(currentDir);
        return;
      } catch {
        const parentDir = path.dirname(currentDir);

        // Stop if we've reached filesystem root
        if (parentDir === currentDir) {
          break;
        }

        // Stop if we've gone above all workspace roots
        const isInWorkspace = workspaceRoots.some((root) => parentDir.startsWith(root));
        if (workspaceRoots.length > 0 && !isInWorkspace) {
          break;
        }

        currentDir = parentDir;
      }
    }
  }

  /**
   * Register a callback for when values file content changes
   */
  public onValuesChanged(callback: FileWatcherCallback): vscode.Disposable {
    this.onValuesChangedCallbacks.push(callback);
    return new vscode.Disposable(() => {
      const index = this.onValuesChangedCallbacks.indexOf(callback);
      if (index >= 0) {
        this.onValuesChangedCallbacks.splice(index, 1);
      }
    });
  }

  /**
   * Register a callback for when the list of values files changes
   */
  public onValuesFilesListChanged(callback: FileWatcherCallback): vscode.Disposable {
    this.onValuesFilesListChangedCallbacks.push(callback);
    return new vscode.Disposable(() => {
      const index = this.onValuesFilesListChangedCallbacks.indexOf(callback);
      if (index >= 0) {
        this.onValuesFilesListChangedCallbacks.splice(index, 1);
      }
    });
  }

  /**
   * Notify all values changed callbacks
   */
  private notifyValuesChanged(chartRoot: string): void {
    for (const callback of this.onValuesChangedCallbacks) {
      try {
        callback(chartRoot);
      } catch (error) {
        console.error('Error in values changed callback:', error);
      }
    }
  }

  /**
   * Notify all values files list changed callbacks
   */
  private notifyValuesFilesListChanged(chartRoot: string): void {
    for (const callback of this.onValuesFilesListChangedCallbacks) {
      try {
        callback(chartRoot);
      } catch (error) {
        console.error('Error in values files list changed callback:', error);
      }
    }
  }

  /**
   * Dispose all watchers
   */
  public dispose(): void {
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers = [];
    this.onValuesChangedCallbacks = [];
    this.onValuesFilesListChangedCallbacks = [];
  }
}
