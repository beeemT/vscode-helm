import * as vscode from 'vscode';
import { HelmChartService } from '../services/helmChartService';
import { TemplateParser, TemplateReference } from '../services/templateParser';
import { ValuesCache } from '../services/valuesCache';
import { StatusBarProvider } from './statusBarProvider';

/**
 * Information about an unset value reference for code actions
 */
export interface UnsetValueReference {
  /** The template reference */
  reference: TemplateReference;
  /** The range of the template expression */
  range: vscode.Range;
  /** The chart root path */
  chartRoot: string;
  /** The path to values.yaml */
  valuesYamlPath: string;
  /** If this is a subchart, the parent chart root */
  parentChartRoot?: string;
  /** If this is a subchart, the subchart key (alias or name) */
  subchartKey?: string;
}

/**
 * Provider for text decorations showing resolved Helm values.
 * Uses VS Code's decoration API which can be updated instantly without document changes.
 * Hover is provided by a separate HoverProvider for better compatibility.
 */
export class ValuesDecorationProvider {
  private static instance: ValuesDecorationProvider;
  private decorationType: vscode.TextEditorDecorationType;
  private unsetDecorationType: vscode.TextEditorDecorationType;
  private disposables: vscode.Disposable[] = [];

  /** Map of document URI to unset value references for code actions */
  private unsetReferences: Map<string, UnsetValueReference[]> = new Map();

  private constructor() {
    // Create decoration type for displaying resolved values
    this.decorationType = vscode.window.createTextEditorDecorationType({
      after: {
        color: new vscode.ThemeColor('editorInlayHint.foreground'),
        backgroundColor: new vscode.ThemeColor('editorInlayHint.background'),
        fontStyle: 'normal',
        fontWeight: 'normal',
        margin: '0 0 0 0.5em',
        border: '1px solid transparent',
      },
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });

    // Create decoration type for unset values (warning style)
    this.unsetDecorationType = vscode.window.createTextEditorDecorationType({
      after: {
        color: new vscode.ThemeColor('editorWarning.foreground'),
        backgroundColor: new vscode.ThemeColor('editorWarning.background'),
        fontStyle: 'italic',
        fontWeight: 'normal',
        margin: '0 0 0 0.5em',
        border: '1px solid transparent',
      },
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });

    // Listen for active editor changes
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.updateDecorations(editor);
        }
      })
    );

    // Listen for document changes
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        const editor = vscode.window.activeTextEditor;
        if (editor && event.document === editor.document) {
          this.updateDecorations(editor);
        }
      })
    );

    // Listen for visible editors changes
    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors((editors) => {
        for (const editor of editors) {
          this.updateDecorations(editor);
        }
      })
    );

    // Initial update for current editor
    if (vscode.window.activeTextEditor) {
      this.updateDecorations(vscode.window.activeTextEditor);
    }
  }

  public static getInstance(): ValuesDecorationProvider {
    if (!ValuesDecorationProvider.instance) {
      ValuesDecorationProvider.instance = new ValuesDecorationProvider();
    }
    return ValuesDecorationProvider.instance;
  }

  public static initialize(): ValuesDecorationProvider {
    return ValuesDecorationProvider.getInstance();
  }

  /**
   * Refresh decorations for all visible Helm template editors
   */
  public async refresh(): Promise<void> {
    const helmService = HelmChartService.getInstance();

    for (const editor of vscode.window.visibleTextEditors) {
      if (helmService.isHelmTemplateFile(editor.document.uri)) {
        await this.updateDecorations(editor);
      }
    }
  }

  /**
   * Update decorations for a specific editor
   */
  public async updateDecorations(editor: vscode.TextEditor): Promise<void> {
    const config = vscode.workspace.getConfiguration('helmValues');
    if (!config.get<boolean>('enableInlayHints', true)) {
      editor.setDecorations(this.decorationType, []);
      editor.setDecorations(this.unsetDecorationType, []);
      this.unsetReferences.delete(editor.document.uri.toString());
      return;
    }

    const helmService = HelmChartService.getInstance();
    if (!helmService.isHelmTemplateFile(editor.document.uri)) {
      editor.setDecorations(this.decorationType, []);
      editor.setDecorations(this.unsetDecorationType, []);
      this.unsetReferences.delete(editor.document.uri.toString());
      return;
    }

    const chartContext = await helmService.detectHelmChart(editor.document.uri);
    if (!chartContext) {
      editor.setDecorations(this.decorationType, []);
      editor.setDecorations(this.unsetDecorationType, []);
      this.unsetReferences.delete(editor.document.uri.toString());
      return;
    }

    // Get the selected values file
    // For subcharts, we need to use the parent chart's selected file
    const statusBarProvider = StatusBarProvider.getInstance();
    const effectiveChartRoot = chartContext.isSubchart && chartContext.parentChart
      ? chartContext.parentChart.chartRoot
      : chartContext.chartRoot;
    const selectedFile = statusBarProvider?.getSelectedFile(effectiveChartRoot) || '';

    // Get merged values for .Values references
    // For subcharts, get values as the subchart would see them
    const valuesCache = ValuesCache.getInstance();
    let values: Record<string, unknown>;
    if (chartContext.isSubchart && chartContext.parentChart && chartContext.subchartName) {
      values = await valuesCache.getValuesForSubchart(
        chartContext.parentChart.chartRoot,
        chartContext.chartRoot,
        chartContext.subchartName,
        selectedFile
      );
    } else {
      values = await valuesCache.getValues(chartContext.chartRoot, selectedFile);
    }

    // Get Chart metadata for .Chart references
    const chartMetadata = await helmService.getChartMetadata(chartContext.chartRoot);

    // Get Release info for .Release references
    const releaseInfo = helmService.getReleaseInfo(chartContext.chartRoot);

    // Get Capabilities for .Capabilities references
    const capabilities = helmService.getCapabilities();

    // Get Template info for .Template references
    const templateInfo = helmService.getTemplateInfo(editor.document.uri.fsPath, chartContext.chartRoot);

    // Parse template references
    const text = editor.document.getText();
    const templateParser = TemplateParser.getInstance();
    const references = templateParser.parseTemplateReferences(text);

    // Get max length from config
    const maxLength = config.get<number>('inlayHintMaxLength', 50);

    // Build decorations for resolved values
    const resolvedDecorations: vscode.DecorationOptions[] = [];
    // Build decorations for unset values
    const unsetDecorations: vscode.DecorationOptions[] = [];
    // Track unset references for code actions
    const documentUnsetRefs: UnsetValueReference[] = [];

    // Get the default values path for unset references
    // For subcharts, unset values should be created in the parent's values.yaml under the subchart key
    let defaultValuesPath: string | undefined;
    let unsetRefParentChartRoot: string | undefined;
    let unsetRefSubchartKey: string | undefined;

    if (chartContext.isSubchart && chartContext.parentChart && chartContext.subchartName) {
      defaultValuesPath = await helmService.getDefaultValuesPath(chartContext.parentChart.chartRoot);
      unsetRefParentChartRoot = chartContext.parentChart.chartRoot;
      unsetRefSubchartKey = chartContext.subchartName;
    } else {
      defaultValuesPath = await helmService.getDefaultValuesPath(chartContext.chartRoot);
    }

    for (const ref of references) {
      // Create position at the end of the template expression for the decoration
      const endPosition = editor.document.positionAt(ref.endOffset);
      const startPosition = editor.document.positionAt(ref.startOffset);
      const range = new vscode.Range(endPosition, endPosition);
      const fullRange = new vscode.Range(startPosition, endPosition);

      // Resolve value based on object type
      let resolvedValue: unknown;
      let sourceObject: Record<string, unknown> | undefined;

      switch (ref.objectType) {
        case 'Values':
          resolvedValue = valuesCache.resolveValuePath(values, ref.path);
          break;
        case 'Chart':
          sourceObject = chartMetadata as Record<string, unknown> | undefined;
          resolvedValue = sourceObject ? valuesCache.resolveValuePath(sourceObject, ref.path) : undefined;
          break;
        case 'Release':
          sourceObject = releaseInfo as unknown as Record<string, unknown>;
          resolvedValue = valuesCache.resolveValuePath(sourceObject, ref.path);
          break;
        case 'Capabilities':
          sourceObject = capabilities as Record<string, unknown>;
          resolvedValue = valuesCache.resolveValuePath(sourceObject, ref.path);
          break;
        case 'Template':
          sourceObject = templateInfo as Record<string, unknown>;
          resolvedValue = valuesCache.resolveValuePath(sourceObject, ref.path);
          break;
        case 'Files':
          // .Files is complex and depends on runtime, show a placeholder
          resolvedValue = '<file-content>';
          break;
      }

      // Only show unset warnings for .Values references (other objects have known values)
      if (ref.objectType === 'Values' && resolvedValue === undefined && ref.defaultValue === undefined) {
        // Value is unset - show warning decoration
        unsetDecorations.push({
          range,
          renderOptions: {
            after: {
              contentText: ' ⚠ unset',
            },
          },
        });

        // Track for code actions
        if (defaultValuesPath) {
          documentUnsetRefs.push({
            reference: ref,
            range: fullRange,
            chartRoot: chartContext.chartRoot,
            valuesYamlPath: defaultValuesPath,
            parentChartRoot: unsetRefParentChartRoot,
            subchartKey: unsetRefSubchartKey,
          });
        }
      } else {
        // Value is set - show resolved value
        const displayValue =
          resolvedValue !== undefined
            ? valuesCache.formatValueForDisplay(resolvedValue, maxLength)
            : ref.defaultValue !== undefined
              ? `"${ref.defaultValue}"`
              : '<undefined>';

        resolvedDecorations.push({
          range,
          renderOptions: {
            after: {
              contentText: ` = ${displayValue}`,
            },
          },
        });
      }
    }

    // Store unset references for code actions
    this.unsetReferences.set(editor.document.uri.toString(), documentUnsetRefs);

    editor.setDecorations(this.decorationType, resolvedDecorations);
    editor.setDecorations(this.unsetDecorationType, unsetDecorations);
  }

  /**
   * Get unset value references for a document
   */
  public getUnsetReferences(documentUri: string): UnsetValueReference[] {
    return this.unsetReferences.get(documentUri) || [];
  }

  /**
   * Clear all decorations
   */
  public clearDecorations(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.decorationType, []);
      editor.setDecorations(this.unsetDecorationType, []);
    }
    this.unsetReferences.clear();
  }

  /**
   * Dispose of resources
   */
  public dispose(): void {
    this.decorationType.dispose();
    this.unsetDecorationType.dispose();
    this.unsetReferences.clear();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }
}
