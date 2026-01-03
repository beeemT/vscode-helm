import * as path from 'path';
import * as vscode from 'vscode';
import { HelmChartContext, HelmChartService } from '../services/helmChartService';
import { ValuesCache } from '../services/valuesCache';

/**
 * State key prefix for storing selected values file per chart
 */
const STATE_KEY_PREFIX = 'helmValues.selectedFile.';

/**
 * Provider for the status bar values file selector
 */
export class StatusBarProvider {
  private static instance: StatusBarProvider;
  private statusBarItem: vscode.StatusBarItem;
  private context: vscode.ExtensionContext;
  private currentChartContext: HelmChartContext | undefined;
  private onSelectionChangedEmitter = new vscode.EventEmitter<string>();
  /** Local cache for selected files (faster access than workspaceState) */
  private selectedFilesCache: Map<string, string> = new Map();

  /**
   * Event fired when the selected values file changes
   */
  public readonly onSelectionChanged = this.onSelectionChangedEmitter.event;

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;

    // Create status bar item
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.command = 'helmValues.selectValuesFile';
    this.statusBarItem.tooltip = 'Select Helm values override file';
    context.subscriptions.push(this.statusBarItem);

    // Register commands
    this.registerCommands();

    // Update status bar when active editor changes
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.updateStatusBar())
    );

    // Initial update
    this.updateStatusBar();
  }

  public static initialize(context: vscode.ExtensionContext): StatusBarProvider {
    if (!StatusBarProvider.instance) {
      StatusBarProvider.instance = new StatusBarProvider(context);
    }
    return StatusBarProvider.instance;
  }

  public static getInstance(): StatusBarProvider | undefined {
    return StatusBarProvider.instance;
  }

  /**
   * Register extension commands
   */
  private registerCommands(): void {
    this.context.subscriptions.push(
      vscode.commands.registerCommand('helmValues.selectValuesFile', () =>
        this.showValuesFilePicker()
      )
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('helmValues.clearValuesFile', () =>
        this.clearSelection()
      )
    );
  }

  /**
   * Update the status bar based on current editor
   */
  public async updateStatusBar(): Promise<void> {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      this.hideStatusBar();
      return;
    }

    const helmService = HelmChartService.getInstance();
    const chartContext = await helmService.detectHelmChart(editor.document.uri);

    if (!chartContext) {
      this.hideStatusBar();
      this.currentChartContext = undefined;
      return;
    }

    this.currentChartContext = chartContext;
    const selectedFile = this.getSelectedFile(chartContext.chartRoot);

    if (selectedFile) {
      const fileName = path.basename(selectedFile);
      this.statusBarItem.text = `$(file-code) ${fileName}`;
    } else {
      this.statusBarItem.text = '$(file-code) None';
    }

    this.statusBarItem.show();
  }

  /**
   * Hide the status bar
   */
  private hideStatusBar(): void {
    this.statusBarItem.hide();
  }

  /**
   * Show the QuickPick for selecting a values file
   */
  private async showValuesFilePicker(): Promise<void> {
    let chartContext = this.currentChartContext;

    // If no current chart context, try to find charts in workspace
    if (!chartContext) {
      chartContext = await this.promptForChartSelection();
      if (!chartContext) {
        return;
      }
      // Update current context for subsequent operations
      this.currentChartContext = chartContext;
    }

    const helmService = HelmChartService.getInstance();
    const valuesFiles = await helmService.findValuesFiles(chartContext.chartRoot);

    if (valuesFiles.length === 0) {
      vscode.window.showInformationMessage('No values override files found in chart');
      return;
    }

    // Build QuickPick items
    const items: vscode.QuickPickItem[] = [];

    // Add "None" option
    items.push({
      label: '$(x) None',
      description: 'Use only default values.yaml',
      detail: undefined,
    });

    // Add values files
    for (const file of valuesFiles) {
      const relativePath = path.relative(chartContext.chartRoot, file);
      items.push({
        label: `$(file) ${path.basename(file)}`,
        description: relativePath !== path.basename(file) ? relativePath : undefined,
        detail: file,
      });
    }

    // Show QuickPick
    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select values override file',
      matchOnDescription: true,
    });

    if (selected) {
      const selectedFile = selected.label.startsWith('$(x)') ? '' : selected.detail || '';
      await this.setSelectedFile(chartContext.chartRoot, selectedFile);
    }
  }

  /**
   * Prompt user to select a Helm chart from the workspace
   */
  private async promptForChartSelection(): Promise<HelmChartContext | undefined> {
    const helmService = HelmChartService.getInstance();
    const charts = await helmService.findAllChartsInWorkspace();

    if (charts.length === 0) {
      vscode.window.showWarningMessage('No Helm charts found in workspace');
      return undefined;
    }

    // If only one chart, use it directly
    if (charts.length === 1) {
      return charts[0];
    }

    // Multiple charts - prompt user to select one
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspaceRoot = workspaceFolders?.[0]?.uri.fsPath || '';

    const items: vscode.QuickPickItem[] = charts.map((chart) => {
      const relativePath = workspaceRoot
        ? path.relative(workspaceRoot, chart.chartRoot)
        : chart.chartRoot;
      return {
        label: `$(package) ${path.basename(chart.chartRoot)}`,
        description: relativePath,
        detail: chart.chartRoot,
      };
    });

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a Helm chart',
      matchOnDescription: true,
    });

    if (!selected) {
      return undefined;
    }

    return charts.find((c) => c.chartRoot === selected.detail);
  }

  /**
   * Clear the current selection
   */
  private async clearSelection(): Promise<void> {
    if (this.currentChartContext) {
      await this.setSelectedFile(this.currentChartContext.chartRoot, '');
    }
  }

  /**
   * Get the selected values file for a chart
   */
  public getSelectedFile(chartRoot: string): string {
    // Check local cache first for immediate access (handles empty string correctly)
    if (this.selectedFilesCache.has(chartRoot)) {
      return this.selectedFilesCache.get(chartRoot)!;
    }
    // Fall back to workspace state (initial load)
    const stateKey = this.getStateKey(chartRoot);
    const fromState = this.context.workspaceState.get<string>(stateKey, '');
    // Populate local cache
    this.selectedFilesCache.set(chartRoot, fromState);
    return fromState;
  }

  /**
   * Set the selected values file for a chart
   */
  public async setSelectedFile(chartRoot: string, filePath: string): Promise<void> {
    const stateKey = this.getStateKey(chartRoot);

    // Update local cache immediately (synchronous)
    this.selectedFilesCache.set(chartRoot, filePath);

    // Invalidate values cache BEFORE persisting to ensure fresh data on next request
    const valuesCache = ValuesCache.getInstance();
    valuesCache.invalidateCacheImmediate(chartRoot);

    // Persist to workspace state (async)
    await this.context.workspaceState.update(stateKey, filePath);

    // Update status bar
    await this.updateStatusBar();

    // Notify listeners after a microtask to ensure all state is settled
    // This helps VS Code's inlay hints system pick up the new value
    await Promise.resolve();
    this.onSelectionChangedEmitter.fire(chartRoot);
  }

  /**
   * Get the state key for a chart
   */
  private getStateKey(chartRoot: string): string {
    return STATE_KEY_PREFIX + chartRoot;
  }

  /**
   * Get the current chart context
   */
  public getCurrentChartContext(): HelmChartContext | undefined {
    return this.currentChartContext;
  }

  /**
   * Refresh the values files list for the current chart
   */
  public async refreshValuesFilesList(): Promise<void> {
    // Re-detect chart to refresh the values files list
    if (this.currentChartContext) {
      const helmService = HelmChartService.getInstance();
      const newContext = await helmService.detectHelmChart(
        vscode.Uri.file(this.currentChartContext.chartYamlPath)
      );
      if (newContext) {
        this.currentChartContext = newContext;
      }
    }
  }
}
