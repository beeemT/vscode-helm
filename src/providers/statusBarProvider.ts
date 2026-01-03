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
    if (!this.currentChartContext) {
      vscode.window.showWarningMessage('No Helm chart detected in current file');
      return;
    }

    const helmService = HelmChartService.getInstance();
    const valuesFiles = await helmService.findValuesFiles(this.currentChartContext.chartRoot);

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
      const relativePath = path.relative(this.currentChartContext.chartRoot, file);
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
      await this.setSelectedFile(this.currentChartContext.chartRoot, selectedFile);
    }
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
      const cached = this.selectedFilesCache.get(chartRoot)!;
      console.log(`[StatusBar] getSelectedFile from local cache: ${chartRoot} -> "${cached}"`);
      return cached;
    }
    // Fall back to workspace state (initial load)
    const stateKey = this.getStateKey(chartRoot);
    const fromState = this.context.workspaceState.get<string>(stateKey, '');
    // Populate local cache
    this.selectedFilesCache.set(chartRoot, fromState);
    console.log(`[StatusBar] getSelectedFile from workspace state: ${chartRoot} -> "${fromState}"`);
    return fromState;
  }

  /**
   * Set the selected values file for a chart
   */
  public async setSelectedFile(chartRoot: string, filePath: string): Promise<void> {
    console.log(`[StatusBar] setSelectedFile: ${chartRoot} -> "${filePath}"`);
    const stateKey = this.getStateKey(chartRoot);

    // Update local cache immediately (synchronous)
    this.selectedFilesCache.set(chartRoot, filePath);
    console.log(`[StatusBar] Local cache updated`);

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
    console.log(`[StatusBar] Firing onSelectionChanged event`);
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
