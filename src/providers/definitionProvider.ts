import * as path from 'path';
import * as vscode from 'vscode';
import { HelmChartService } from '../services/helmChartService';
import { TemplateParser } from '../services/templateParser';
import { ValuesCache } from '../services/valuesCache';
import { ArchiveDocumentProvider } from './archiveDocumentProvider';
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

    // Handle helm-archive: URIs - these are virtual documents from inside .tgz archives
    if (document.uri.scheme === ArchiveDocumentProvider.scheme) {
      return this.provideDefinitionForArchiveDocument(document, position);
    }

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

        // Return undefined if no position found
        if (!valuePosition) {
          return undefined;
        }

        // For archive-sourced values with known archive location, navigate to archive URI
        if (
          valuePosition.isFromArchive &&
          valuePosition.archivePath &&
          valuePosition.internalPath
        ) {
          const uri = ArchiveDocumentProvider.createUri(
            valuePosition.archivePath,
            valuePosition.internalPath
          );
          return new vscode.Location(
            uri,
            new vscode.Position(valuePosition.line, valuePosition.character)
          );
        }

        // For archive values without location info, cannot navigate
        if (valuePosition.isFromArchive) {
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

  /**
   * Handle go-to-definition for documents opened from helm-archive: URIs.
   * Reconstructs the chart context from the archive path and resolves definitions.
   */
  private async provideDefinitionForArchiveDocument(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Definition | undefined> {
    const parsed = ArchiveDocumentProvider.parseUri(document.uri);
    if (!parsed) {
      return undefined;
    }

    const { archivePath } = parsed;

    // The archive is a subchart inside some parent chart's charts/ directory.
    // Walk up from the archive path to find the parent chart.
    const helmService = HelmChartService.getInstance();
    const chartsDir = path.dirname(archivePath);
    const parentChartRoot = path.dirname(chartsDir);
    const parentChartYaml = path.join(parentChartRoot, 'Chart.yaml');

    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(parentChartYaml));
    } catch {
      // No parent Chart.yaml found, cannot determine context
      return undefined;
    }

    // Detect the full chart context from the parent chart
    const parentContext = await helmService.detectHelmChart(vscode.Uri.file(parentChartYaml));
    if (!parentContext) {
      return undefined;
    }

    // Find the matching subchart info for this archive
    const subchartInfo = parentContext.subcharts.find(
      (sc) => sc.isArchive && sc.archivePath === archivePath
    );

    if (!subchartInfo) {
      return undefined;
    }

    // Build a synthetic chart context for the archive subchart
    const subchartName = subchartInfo.alias || subchartInfo.name;
    const archiveChartContext: import('../services/helmChartService').HelmChartContext = {
      chartRoot: archivePath,
      chartYamlPath: archivePath,
      valuesYamlPath: archivePath,
      valuesOverrideFiles: [],
      isSubchart: true,
      subchartName,
      parentChart: parentContext,
      subcharts: [],
    };

    // Find template references in the document
    const text = document.getText();
    const templateParser = TemplateParser.getInstance();
    const references = templateParser.parseTemplateReferences(text);

    const offset = document.offsetAt(position);
    const reference = references.find(
      (ref) => offset >= ref.startOffset && offset <= ref.endOffset
    );

    if (!reference) {
      return undefined;
    }

    if (reference.objectType === 'Values') {
      const statusBarProvider = StatusBarProvider.getInstance();
      const rootChart = helmService.getRootAncestorChart(archiveChartContext);
      const selectedFile = statusBarProvider?.getSelectedFile(rootChart.chartRoot) || '';

      const valuesCache = ValuesCache.getInstance();
      const valuePosition = await valuesCache.findSubchartValuePositionInChainNested(
        archiveChartContext,
        selectedFile,
        reference.path
      );

      if (!valuePosition) {
        return undefined;
      }

      if (
        valuePosition.isFromArchive &&
        valuePosition.archivePath &&
        valuePosition.internalPath
      ) {
        const uri = ArchiveDocumentProvider.createUri(
          valuePosition.archivePath,
          valuePosition.internalPath
        );
        return new vscode.Location(
          uri,
          new vscode.Position(valuePosition.line, valuePosition.character)
        );
      }

      if (valuePosition.isFromArchive) {
        return undefined;
      }

      const targetUri = vscode.Uri.file(valuePosition.filePath);
      const targetPosition = new vscode.Position(valuePosition.line, valuePosition.character);
      return new vscode.Location(targetUri, targetPosition);
    }

    return undefined;
  }
}
