import * as vscode from 'vscode';
import { HelmChartContext, HelmChartService } from '../services/helmChartService';
import { TemplateParser, TemplateReference } from '../services/templateParser';
import { ValuesCache } from '../services/valuesCache';
import { StatusBarProvider } from './statusBarProvider';

/**
 * Provider for inlay hints showing resolved Helm values
 */
export class HelmInlayHintsProvider implements vscode.InlayHintsProvider {
  private _onDidChangeInlayHints = new vscode.EventEmitter<void>();
  public readonly onDidChangeInlayHints = this._onDidChangeInlayHints.event;

  /**
   * Trigger a refresh of inlay hints for all visible editors
   */
  public refresh(): void {
    // Fire the event to notify VS Code that hints have changed
    this._onDidChangeInlayHints.fire();
  }

  /**
   * Force refresh of inlay hints by triggering a no-op edit.
   * This works around VS Code sometimes ignoring onDidChangeInlayHints events.
   */
  public async forceRefresh(): Promise<void> {
    // Fire the event first
    this._onDidChangeInlayHints.fire();

    // Force VS Code to re-evaluate by making a no-op edit on visible Helm template editors
    const helmService = HelmChartService.getInstance();
    for (const editor of vscode.window.visibleTextEditors) {
      if (helmService.isHelmTemplateFile(editor.document.uri)) {
        // Use a WorkspaceEdit to insert and delete a character atomically
        const position = new vscode.Position(0, 0);

        // Insert a space
        const insertEdit = new vscode.WorkspaceEdit();
        insertEdit.insert(editor.document.uri, position, ' ');
        await vscode.workspace.applyEdit(insertEdit);

        // Delete the space
        const deleteEdit = new vscode.WorkspaceEdit();
        deleteEdit.delete(editor.document.uri, new vscode.Range(position, position.translate(0, 1)));
        await vscode.workspace.applyEdit(deleteEdit);
      }
    }
  }

  /**
   * Provide inlay hints for the document
   */
  async provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range,
    token: vscode.CancellationToken
  ): Promise<vscode.InlayHint[]> {
    const hints: vscode.InlayHint[] = [];

    // Check if inlay hints are enabled
    const config = vscode.workspace.getConfiguration('helmValues');
    if (!config.get<boolean>('enableInlayHints', true)) {
      return hints;
    }

    // Check if this is a Helm template file
    const helmService = HelmChartService.getInstance();
    if (!helmService.isHelmTemplateFile(document.uri)) {
      return hints;
    }

    // Detect the chart context
    const chartContext = await helmService.detectHelmChart(document.uri);
    if (!chartContext) {
      return hints;
    }

    // Check for cancellation
    if (token.isCancellationRequested) {
      return hints;
    }

    // Get the selected values file
    // For subcharts, we need to use the parent chart's selected file
    const statusBarProvider = StatusBarProvider.getInstance();
    const effectiveChartRoot = chartContext.isSubchart && chartContext.parentChart
      ? chartContext.parentChart.chartRoot
      : chartContext.chartRoot;
    const selectedFile = statusBarProvider?.getSelectedFile(effectiveChartRoot) || '';

    // Get merged values
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

    // Check for cancellation
    if (token.isCancellationRequested) {
      return hints;
    }

    // Parse template references in the range
    const text = document.getText(range);
    const startOffset = document.offsetAt(range.start);
    const templateParser = TemplateParser.getInstance();
    const references = templateParser.parseTemplateReferences(text);

    // Get max length from config
    const maxLength = config.get<number>('inlayHintMaxLength', 50);

    // Create hints for each reference
    for (const ref of references) {
      if (token.isCancellationRequested) {
        break;
      }

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

      // Create position after the template expression
      const endPosition = document.positionAt(startOffset + ref.endOffset);

      // Create hint with clickable label
      const hint = await this.createInlayHint(
        endPosition,
        displayValue,
        ref,
        chartContext,
        selectedFile
      );

      hints.push(hint);
    }

    return hints;
  }

  /**
   * Create an inlay hint with clickable navigation
   */
  private async createInlayHint(
    position: vscode.Position,
    displayValue: string,
    ref: TemplateReference,
    chartContext: HelmChartContext,
    selectedFile: string
  ): Promise<vscode.InlayHint> {
    const valuesCache = ValuesCache.getInstance();

    // Find the position of the value definition
    let valuePosition;
    if (chartContext.isSubchart && chartContext.parentChart && chartContext.subchartName) {
      valuePosition = await valuesCache.findSubchartValuePositionInChain(
        chartContext.parentChart.chartRoot,
        chartContext.chartRoot,
        chartContext.subchartName,
        selectedFile,
        ref.path
      );
    } else {
      valuePosition = await valuesCache.findValuePositionInChain(
        chartContext.chartRoot,
        selectedFile,
        ref.path
      );
    }

    // Create label part
    const labelPart = new vscode.InlayHintLabelPart(` = ${displayValue}`);

    // Make it clickable if we found the position
    if (valuePosition) {
      labelPart.location = new vscode.Location(
        vscode.Uri.file(valuePosition.filePath),
        new vscode.Position(valuePosition.line, valuePosition.character)
      );
      labelPart.tooltip = new vscode.MarkdownString(
        `**Value:** \`${displayValue}\`\n\n` +
          `**Path:** \`.Values.${ref.path}\`\n\n` +
          `*Click to go to definition*`
      );
    } else {
      labelPart.tooltip = new vscode.MarkdownString(
        `**Value:** \`${displayValue}\`\n\n` + `**Path:** \`.Values.${ref.path}\``
      );
    }

    const hint = new vscode.InlayHint(position, [labelPart], vscode.InlayHintKind.Parameter);
    hint.paddingLeft = true;

    return hint;
  }

  /**
   * Resolve inlay hint (called when hovering)
   */
  resolveInlayHint(
    hint: vscode.InlayHint,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.InlayHint> {
    // Hints are already fully resolved in provideInlayHints
    return hint;
  }
}
