import * as path from 'path';
import * as vscode from 'vscode';
import { HelmChartService } from '../services/helmChartService';
import { TemplateParser } from '../services/templateParser';
import { ValuesCache, ValueSource } from '../services/valuesCache';
import { StatusBarProvider } from './statusBarProvider';

/**
 * Provider for hover information at the end of .Values template expressions.
 * Shows resolved value and provides a link to go to definition.
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

    // Find if the cursor is at the end of a .Values reference (where decoration appears)
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

    // Get the selected values file
    const statusBarProvider = StatusBarProvider.getInstance();
    const selectedFile = statusBarProvider?.getSelectedFile(chartContext.chartRoot) || '';

    // Get merged values and resolve the value
    const valuesCache = ValuesCache.getInstance();
    const values = await valuesCache.getValues(chartContext.chartRoot, selectedFile);
    const resolvedValue = valuesCache.resolveValuePath(values, reference.path);

    // Get max length from config
    const config = vscode.workspace.getConfiguration('helmValues');
    const maxLength = config.get<number>('inlayHintMaxLength', 50);

    // Check if the value is unset (not in values.yaml or override file, and no default)
    const isUnset = resolvedValue === undefined && reference.defaultValue === undefined;

    // Format the display value
    const displayValue =
      resolvedValue !== undefined
        ? valuesCache.formatValueForDisplay(resolvedValue, maxLength)
        : reference.defaultValue !== undefined
          ? `"${reference.defaultValue}"`
          : '⚠ unset';

    // Find the position of the value definition (only if value exists)
    const valuePosition = isUnset
      ? undefined
      : await valuesCache.findValuePositionInChain(
          chartContext.chartRoot,
          selectedFile,
          reference.path
        );

    // Get default values path for creating missing values
    const defaultValuesPath = await helmService.getDefaultValuesPath(chartContext.chartRoot);

    // Helper to format source label
    const formatSourceLabel = (source: ValueSource, filePath: string): string => {
      const fileName = path.basename(filePath);
      switch (source) {
        case 'override':
          return `\`${fileName}\` (override)`;
        case 'default':
          return `\`values.yaml\``;
        case 'inline-default':
          return 'inline default';
      }
    };

    // Build hover content
    let hoverContent: vscode.MarkdownString;

    if (isUnset && defaultValuesPath) {
      // Unset value - show "Create value" link
      const createArgs = encodeURIComponent(
        JSON.stringify([defaultValuesPath, reference.path])
      );
      hoverContent = new vscode.MarkdownString(
        `**Value:** \`${displayValue}\`\n\n` +
          `**Path:** \`.Values.${reference.path}\`\n\n` +
          `[➕ Create value in values.yaml](command:helmValues.createMissingValue?${createArgs})`
      );
      hoverContent.isTrusted = true;
    } else if (valuePosition) {
      const fileUri = vscode.Uri.file(valuePosition.filePath);
      // Use plain object for selection - vscode.Range doesn't serialize properly
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
      const sourceLabel = formatSourceLabel(valuePosition.source, valuePosition.filePath);
      hoverContent = new vscode.MarkdownString(
        `**Value:** \`${displayValue}\`\n\n` +
          `**Path:** \`.Values.${reference.path}\`\n\n` +
          `**Source:** ${sourceLabel}\n\n` +
          `[Go to definition](command:vscode.open?${args}) (or Cmd/Ctrl+Click on .Values reference)`
      );
      hoverContent.isTrusted = true;
    } else if (reference.defaultValue !== undefined) {
      // Value comes from inline default
      hoverContent = new vscode.MarkdownString(
        `**Value:** \`${displayValue}\`\n\n` +
          `**Path:** \`.Values.${reference.path}\`\n\n` +
          `**Source:** inline default`
      );
    } else {
      hoverContent = new vscode.MarkdownString(
        `**Value:** \`${displayValue}\`\n\n` + `**Path:** \`.Values.${reference.path}\``
      );
    }

    // Create range for the hover - just the end of the expression
    const endPosition = document.positionAt(reference.endOffset);
    const range = new vscode.Range(endPosition, endPosition);

    return new vscode.Hover(hoverContent, range);
  }
}
