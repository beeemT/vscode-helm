import * as path from 'path';
import * as vscode from 'vscode';
import { HelmChartContext, HelmChartService } from '../services/helmChartService';
import { TemplateParser, TemplateReference } from '../services/templateParser';
import { ValuesCache } from '../services/valuesCache';
import { StatusBarProvider } from './statusBarProvider';

/**
 * Provider for hover information at the end of Helm object references.
 * Shows resolved value and provides a link to go to definition (for .Values).
 * Only responds to the exact end position of template expressions (where decorations appear).
 */
export class HelmDecorationHoverProvider implements vscode.HoverProvider {
  private static instance: HelmDecorationHoverProvider;

  private constructor() {}

  public static getInstance(): HelmDecorationHoverProvider {
    if (!HelmDecorationHoverProvider.instance) {
      HelmDecorationHoverProvider.instance = new HelmDecorationHoverProvider();
    }
    return HelmDecorationHoverProvider.instance;
  }

  public async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): Promise<vscode.Hover | undefined> {
    const helmService = HelmChartService.getInstance();

    // Only process Helm template files
    if (!helmService.isHelmTemplateFile(document.uri)) {
      return undefined;
    }

    const chartContext = await helmService.detectHelmChart(document.uri);
    if (!chartContext) {
      return undefined;
    }

    // Find if the cursor is at the end of a Helm object reference (where decoration appears)
    const text = document.getText();
    const templateParser = TemplateParser.getInstance();
    const references = templateParser.parseTemplateReferences(text);

    // Get the offset at the cursor position
    const offset = document.offsetAt(position);

    // Find a reference where the cursor is at or just after the end (within 1 char)
    // This targets the area where the decoration is rendered
    const reference = references.find((ref) => {
      const endOffset = ref.endOffset;
      // Allow hover on the closing braces and a few chars after (where decoration shows)
      return offset >= endOffset - 2 && offset <= endOffset + 10;
    });

    if (!reference) {
      return undefined;
    }

    // Get the selected values file (for .Values)
    // For subcharts (including nested), we need to use the root ancestor chart's selected file
    const statusBarProvider = StatusBarProvider.getInstance();
    const rootAncestorChart = helmService.getRootAncestorChart(chartContext);
    const selectedFile = statusBarProvider?.getSelectedFile(rootAncestorChart.chartRoot) || '';

    // Get max length from config
    const config = vscode.workspace.getConfiguration('helmValues');
    const maxLength = config.get<number>('inlayHintMaxLength', 50);

    const valuesCache = ValuesCache.getInstance();

    // Resolve value based on object type
    let resolvedValue: unknown;
    let sourceDescription: string;

    switch (reference.objectType) {
      case 'Values': {
        // For subcharts (including nested), get values as the subchart would see them
        let values: Record<string, unknown>;
        if (chartContext.isSubchart && chartContext.parentChart && chartContext.subchartName) {
          values = await valuesCache.getValuesForSubchart(chartContext, selectedFile);
        } else {
          values = await valuesCache.getValues(chartContext.chartRoot, selectedFile);
        }
        resolvedValue = valuesCache.resolveValuePath(values, reference.path);
        sourceDescription = await this.getValuesSourceDescription(
          chartContext,
          selectedFile,
          reference,
          valuesCache,
          helmService
        );
        break;
      }
      case 'Chart': {
        const chartMetadata = await helmService.getChartMetadata(chartContext.chartRoot);
        resolvedValue = chartMetadata ? valuesCache.resolveValuePath(chartMetadata as Record<string, unknown>, reference.path) : undefined;
        sourceDescription = '`Chart.yaml`';
        break;
      }
      case 'Release': {
        const releaseInfo = helmService.getReleaseInfo(chartContext.chartRoot);
        resolvedValue = valuesCache.resolveValuePath(releaseInfo as unknown as Record<string, unknown>, reference.path);
        sourceDescription = 'Release context (runtime)';
        break;
      }
      case 'Capabilities': {
        const capabilities = helmService.getCapabilities();
        resolvedValue = valuesCache.resolveValuePath(capabilities as Record<string, unknown>, reference.path);
        sourceDescription = 'Kubernetes capabilities (runtime)';
        break;
      }
      case 'Template': {
        const templateInfo = helmService.getTemplateInfo(document.uri.fsPath, chartContext.chartRoot);
        resolvedValue = valuesCache.resolveValuePath(templateInfo as Record<string, unknown>, reference.path);
        sourceDescription = 'Template context';
        break;
      }
      case 'Files': {
        resolvedValue = '<file-content>';
        sourceDescription = 'File access (runtime)';
        break;
      }
    }

    // Check if the value is unset (only applies to .Values)
    const isUnset = reference.objectType === 'Values' && resolvedValue === undefined && reference.defaultValue === undefined;

    // Format the display value
    const displayValue =
      resolvedValue !== undefined
        ? valuesCache.formatValueForDisplay(resolvedValue, maxLength)
        : reference.defaultValue !== undefined
          ? `"${reference.defaultValue}"`
          : '⚠ unset';

    // Build hover content based on object type
    const hoverContent = await this.buildHoverContent(
      reference,
      displayValue,
      sourceDescription,
      isUnset,
      chartContext,
      selectedFile,
      helmService,
      valuesCache
    );

    // Create range for the hover - just the end of the expression
    const endPosition = document.positionAt(reference.endOffset);
    const range = new vscode.Range(endPosition, endPosition);

    return new vscode.Hover(hoverContent, range);
  }

  private async getValuesSourceDescription(
    chartContext: HelmChartContext,
    selectedFile: string,
    reference: TemplateReference,
    valuesCache: ValuesCache,
    _helmService: HelmChartService
  ): Promise<string> {
    let valuePosition;

    if (chartContext.isSubchart && chartContext.parentChart && chartContext.subchartName) {
      // For subcharts, find position in parent's values or subchart's own values
      valuePosition = await valuesCache.findSubchartValuePositionInChain(
        chartContext.parentChart.chartRoot,
        chartContext.chartRoot,
        chartContext.subchartName,
        selectedFile,
        reference.path
      );
    } else {
      valuePosition = await valuesCache.findValuePositionInChain(
        chartContext.chartRoot,
        selectedFile,
        reference.path
      );
    }

    if (!valuePosition) {
      return '';
    }

    const fileName = path.basename(valuePosition.filePath);

    // For subcharts, add context about where the value comes from
    if (chartContext.isSubchart && chartContext.parentChart) {
      const parentName = path.basename(chartContext.parentChart.chartRoot);
      const subchartDirName = path.basename(chartContext.chartRoot);
      // Use alias if different from directory name, otherwise just directory name
      const subchartDisplayName = chartContext.subchartName && chartContext.subchartName !== subchartDirName
        ? `${chartContext.subchartName} (${subchartDirName})`
        : subchartDirName;

      switch (valuePosition.source) {
        case 'override':
          return `\`${fileName}\` (parent chart \`${parentName}\`)`;
        case 'parent-default':
          return `\`${fileName}\` (parent chart \`${parentName}\`)`;
        case 'default':
          return `\`${fileName}\` (subchart \`${subchartDisplayName}\`)`;
        case 'inline-default':
          return 'inline default';
      }
    }

    // For regular (non-subchart) charts, show chart name for clarity
    const chartName = path.basename(chartContext.chartRoot);
    switch (valuePosition.source) {
      case 'override':
        return `\`${fileName}\` (chart \`${chartName}\`)`;
      case 'default':
      case 'parent-default':
        return `\`${fileName}\` (chart \`${chartName}\`)`;
      case 'inline-default':
        return 'inline default';
    }
  }

  private async buildHoverContent(
    reference: TemplateReference,
    displayValue: string,
    sourceDescription: string,
    isUnset: boolean,
    chartContext: HelmChartContext,
    selectedFile: string,
    helmService: HelmChartService,
    valuesCache: ValuesCache
  ): Promise<vscode.MarkdownString> {
    const pathDisplay = `.${reference.objectType}.${reference.path}`;

    if (reference.objectType === 'Values') {
      return this.buildValuesHoverContent(
        reference,
        displayValue,
        sourceDescription,
        isUnset,
        chartContext.chartRoot,
        selectedFile,
        helmService,
        valuesCache,
        chartContext
      );
    }

    // For non-.Values objects, show simple info
    let content = `**Value:** \`${displayValue}\`\n\n` +
      `**Path:** \`${pathDisplay}\``;

    if (sourceDescription) {
      content += `\n\n**Source:** ${sourceDescription}`;
    }

    // Add description for runtime values
    if (reference.objectType === 'Release') {
      content += '\n\n*Note: Release values are determined at deployment time.*';
    } else if (reference.objectType === 'Capabilities') {
      content += '\n\n*Note: Capabilities depend on the target Kubernetes cluster.*';
    }

    return new vscode.MarkdownString(content);
  }

  private async buildValuesHoverContent(
    reference: TemplateReference,
    displayValue: string,
    sourceDescription: string,
    isUnset: boolean,
    chartRoot: string,
    selectedFile: string,
    helmService: HelmChartService,
    valuesCache: ValuesCache,
    chartContext: HelmChartContext
  ): Promise<vscode.MarkdownString> {
    const defaultValuesPath = await helmService.getDefaultValuesPath(chartRoot);

    if (isUnset && defaultValuesPath) {
      // Unset value - show "Create value" link
      const createArgs = encodeURIComponent(
        JSON.stringify([defaultValuesPath, reference.path])
      );
      const hoverContent = new vscode.MarkdownString(
        `**Value:** \`${displayValue}\`\n\n` +
          `**Path:** \`.Values.${reference.path}\`\n\n` +
          `[➕ Create value in values.yaml](command:helmValues.createMissingValue?${createArgs})`
      );
      hoverContent.isTrusted = true;
      return hoverContent;
    }

    // Find value position using subchart-aware method
    let valuePosition;
    if (chartContext.isSubchart && chartContext.parentChart && chartContext.subchartName) {
      valuePosition = await valuesCache.findSubchartValuePositionInChain(
        chartContext.parentChart.chartRoot,
        chartContext.chartRoot,
        chartContext.subchartName,
        selectedFile,
        reference.path
      );
    } else {
      valuePosition = await valuesCache.findValuePositionInChain(
        chartRoot,
        selectedFile,
        reference.path
      );
    }

    if (valuePosition) {
      const fileUri = vscode.Uri.file(valuePosition.filePath);
      const args = encodeURIComponent(
        JSON.stringify([
          fileUri.toString(),
          {
            selection: {
              start: { line: valuePosition.line, character: valuePosition.character },
              end: { line: valuePosition.line, character: valuePosition.character },
            },
          },
        ])
      );

      const hoverContent = new vscode.MarkdownString(
        `**Value:** \`${displayValue}\`\n\n` +
          `**Path:** \`.Values.${reference.path}\`\n\n` +
          `**Source:** ${sourceDescription}\n\n` +
          `[Go to definition](command:vscode.open?${args}) (or Cmd/Ctrl+Click on .Values reference)`
      );
      hoverContent.isTrusted = true;
      return hoverContent;
    }

    if (reference.defaultValue !== undefined) {
      return new vscode.MarkdownString(
        `**Value:** \`${displayValue}\`\n\n` +
          `**Path:** \`.Values.${reference.path}\`\n\n` +
          `**Source:** inline default`
      );
    }

    return new vscode.MarkdownString(
      `**Value:** \`${displayValue}\`\n\n` + `**Path:** \`.Values.${reference.path}\``
    );
  }
}
