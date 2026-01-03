import * as vscode from 'vscode';
import { HelmChartService } from '../services/helmChartService';
import { TemplateParser } from '../services/templateParser';
import { ValuesCache } from '../services/valuesCache';
import { StatusBarProvider } from './statusBarProvider';

/**
 * Provider for text decorations showing resolved Helm values.
 * Uses VS Code's decoration API which can be updated instantly without document changes.
 * Hover is provided by a separate HoverProvider for better compatibility.
 */
export class ValuesDecorationProvider {
  private static instance: ValuesDecorationProvider;
  private decorationType: vscode.TextEditorDecorationType;
  private disposables: vscode.Disposable[] = [];

  private constructor() {
    // Create decoration type for displaying values
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
    console.log('[Decorations] refresh() called');
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
      return;
    }

    const helmService = HelmChartService.getInstance();
    if (!helmService.isHelmTemplateFile(editor.document.uri)) {
      editor.setDecorations(this.decorationType, []);
      return;
    }

    const chartContext = await helmService.detectHelmChart(editor.document.uri);
    if (!chartContext) {
      editor.setDecorations(this.decorationType, []);
      return;
    }

    // Get the selected values file
    const statusBarProvider = StatusBarProvider.getInstance();
    const selectedFile = statusBarProvider?.getSelectedFile(chartContext.chartRoot) || '';
    console.log(`[Decorations] updateDecorations for ${editor.document.uri.fsPath}, selectedFile: "${selectedFile}"`);

    // Get merged values
    const valuesCache = ValuesCache.getInstance();
    const values = await valuesCache.getValues(chartContext.chartRoot, selectedFile);

    // Parse template references
    const text = editor.document.getText();
    const templateParser = TemplateParser.getInstance();
    const references = templateParser.parseTemplateReferences(text);

    // Get max length from config
    const maxLength = config.get<number>('inlayHintMaxLength', 50);

    // Build decorations
    const decorations: vscode.DecorationOptions[] = [];

    for (const ref of references) {
      const resolvedValue = valuesCache.resolveValuePath(values, ref.path);

      // Skip if value is undefined and no default
      if (resolvedValue === undefined && ref.defaultValue === undefined) {
        continue;
      }

      // Use resolved value or default
      const displayValue =
        resolvedValue !== undefined
          ? valuesCache.formatValueForDisplay(resolvedValue, maxLength)
          : ref.defaultValue !== undefined
            ? `"${ref.defaultValue}"`
            : '<undefined>';

      // Create position at the end of the template expression for the decoration
      const endPosition = editor.document.positionAt(ref.endOffset);
      const range = new vscode.Range(endPosition, endPosition);

      decorations.push({
        range,
        renderOptions: {
          after: {
            contentText: ` = ${displayValue}`,
          },
        },
      });
    }

    console.log(`[Decorations] Setting ${decorations.length} decorations`);
    editor.setDecorations(this.decorationType, decorations);
  }

  /**
   * Clear all decorations
   */
  public clearDecorations(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.decorationType, []);
    }
  }

  /**
   * Dispose of resources
   */
  public dispose(): void {
    this.decorationType.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }
}
