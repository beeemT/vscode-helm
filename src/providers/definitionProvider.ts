import * as vscode from 'vscode';
import { HelmChartService } from '../services/helmChartService';
import { TemplateParser } from '../services/templateParser';
import { ValuesCache } from '../services/valuesCache';
import { StatusBarProvider } from './statusBarProvider';

/**
 * Provider for go-to-definition functionality on Helm object references.
 * Enables Cmd/Ctrl+Click on .Values.xxx to jump to the value definition.
 * Also supports .Chart references to jump to Chart.yaml.
 */
export class HelmDefinitionProvider implements vscode.DefinitionProvider {
  private static instance: HelmDefinitionProvider;

  private constructor() {}

  public static getInstance(): HelmDefinitionProvider {
    if (!HelmDefinitionProvider.instance) {
      HelmDefinitionProvider.instance = new HelmDefinitionProvider();
    }
    return HelmDefinitionProvider.instance;
  }

  public async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): Promise<vscode.Definition | undefined> {
    const helmService = HelmChartService.getInstance();

    // Only process Helm template files
    if (!helmService.isHelmTemplateFile(document.uri)) {
      return undefined;
    }

    const chartContext = await helmService.detectHelmChart(document.uri);
    if (!chartContext) {
      return undefined;
    }

    // Find if the cursor is within a Helm object reference
    const text = document.getText();
    const templateParser = TemplateParser.getInstance();
    const references = templateParser.parseTemplateReferences(text);

    // Get the offset at the cursor position
    const offset = document.offsetAt(position);

    // Find the reference that contains the cursor
    const reference = references.find(
      (ref) => offset >= ref.startOffset && offset <= ref.endOffset
    );

    if (!reference) {
      return undefined;
    }

    // Handle based on object type
    switch (reference.objectType) {
      case 'Values': {
        // Get the selected values file
        // For subcharts (including nested), use the root ancestor chart's selected file
        const statusBarProvider = StatusBarProvider.getInstance();
        const helmService = HelmChartService.getInstance();
        const rootChart = helmService.getRootAncestorChart(chartContext);
        const selectedFile = statusBarProvider?.getSelectedFile(rootChart.chartRoot) || '';

        // Find the position of the value definition
        const valuesCache = ValuesCache.getInstance();
        let valuePosition;

        if (chartContext.isSubchart && chartContext.parentChart && chartContext.subchartName) {
          // For subcharts (including nested), use the new nested method
          valuePosition = await valuesCache.findSubchartValuePositionInChainNested(
            chartContext,
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
          return undefined;
        }

        const targetUri = vscode.Uri.file(valuePosition.filePath);
        const targetPosition = new vscode.Position(valuePosition.line, valuePosition.character);
        return new vscode.Location(targetUri, targetPosition);
      }

      case 'Chart': {
        // Navigate to Chart.yaml
        const targetUri = vscode.Uri.file(chartContext.chartYamlPath);
        // TODO: Could find the specific line for the path (e.g., name, version)
        return new vscode.Location(targetUri, new vscode.Position(0, 0));
      }

      // Other object types don't have file-based definitions
      default:
        return undefined;
    }
  }
}
