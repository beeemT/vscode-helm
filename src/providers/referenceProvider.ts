import * as path from 'path';
import * as vscode from 'vscode';
import { HelmChartContext, HelmChartService } from '../services/helmChartService';
import { TemplateParser } from '../services/templateParser';

/**
 * Provider for finding all references to a value key in Helm template files.
 * Enables "Find All References" from values.yaml to see where values are used.
 * Also supports finding references across parent/subchart boundaries.
 */
export class HelmReferenceProvider implements vscode.ReferenceProvider {
  private static instance: HelmReferenceProvider;

  private constructor() {}

  public static getInstance(): HelmReferenceProvider {
    if (!HelmReferenceProvider.instance) {
      HelmReferenceProvider.instance = new HelmReferenceProvider();
    }
    return HelmReferenceProvider.instance;
  }

  public async provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.ReferenceContext,
    _token: vscode.CancellationToken
  ): Promise<vscode.Location[] | undefined> {
    const helmService = HelmChartService.getInstance();

    // Only process values files (not template files)
    if (helmService.isHelmTemplateFile(document.uri)) {
      return undefined;
    }

    // Check if this is a values file within a Helm chart
    const chartContext = await helmService.detectHelmChart(document.uri);
    if (!chartContext) {
      return undefined;
    }

    // Get the value path at the cursor position
    const valuePath = this.getValuePathAtPosition(document, position);
    if (!valuePath) {
      return undefined;
    }

    // Find all references in template files
    const locations = await this.findReferencesInTemplates(chartContext, valuePath);

    // If this is a parent chart's values.yaml, also check if the path is a subchart key
    // and find references within that subchart's templates
    if (!chartContext.isSubchart && chartContext.subcharts.length > 0) {
      const topLevelKey = valuePath.split('.')[0];

      // Check if this is a global.* path - globals are available in all subcharts
      if (topLevelKey === 'global') {
        // Search all subcharts for references to this global value
        for (const subchart of chartContext.subcharts) {
          const subchartLocations = await this.findReferencesInSubchartTemplates(
            subchart.chartRoot,
            valuePath // global.* paths are accessed the same way in subcharts
          );
          locations.push(...subchartLocations);
        }
      } else {
        // Check if the path is under a subchart key (alias or name)
        const matchingSubchart = chartContext.subcharts.find(
          (sub) => sub.name === topLevelKey || sub.alias === topLevelKey
        );

        if (matchingSubchart) {
          // The value path is under a subchart key
          // Find references in subchart templates using the path without the subchart prefix
          const subchartValuePath = valuePath.split('.').slice(1).join('.');
          if (subchartValuePath) {
            const subchartLocations = await this.findReferencesInSubchartTemplates(
              matchingSubchart.chartRoot,
              subchartValuePath
            );
            locations.push(...subchartLocations);
          }
        }
      }
    }

    return locations;
  }

  /**
   * Get the full value path (e.g., "image.repository") at the given position in a values file.
   * This walks up through parent keys to build the complete path.
   */
  private getValuePathAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): string | undefined {
    const line = document.lineAt(position.line);
    const lineText = line.text;
    const trimmed = lineText.trimStart();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      return undefined;
    }

    // Check if cursor is on a key (before the colon)
    const colonIndex = lineText.indexOf(':');
    if (colonIndex === -1) {
      return undefined;
    }

    // Extract the key from this line
    const currentIndent = lineText.length - trimmed.length;
    const keyMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/);
    if (!keyMatch) {
      return undefined;
    }

    const currentKey = keyMatch[1];

    // Build the path by walking up to find parent keys
    const pathSegments: string[] = [currentKey];
    let targetIndent = currentIndent;

    // Walk backwards through lines to find parent keys
    for (let lineNum = position.line - 1; lineNum >= 0; lineNum--) {
      const prevLine = document.lineAt(lineNum).text;
      const prevTrimmed = prevLine.trimStart();

      // Skip empty lines and comments
      if (!prevTrimmed || prevTrimmed.startsWith('#')) {
        continue;
      }

      const prevIndent = prevLine.length - prevTrimmed.length;

      // If we find a line with less indentation, it's a potential parent
      if (prevIndent < targetIndent) {
        const parentKeyMatch = prevTrimmed.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/);
        if (parentKeyMatch) {
          pathSegments.unshift(parentKeyMatch[1]);
          targetIndent = prevIndent;

          // If we've reached the top level (indent 0), we're done
          if (prevIndent === 0) {
            break;
          }
        }
      }
    }

    return pathSegments.join('.');
  }

  /**
   * Find all references to a value path in template files.
   */
  private async findReferencesInTemplates(
    chartContext: HelmChartContext,
    valuePath: string
  ): Promise<vscode.Location[]> {
    const locations: vscode.Location[] = [];
    const templateParser = TemplateParser.getInstance();

    // Find all template files
    const templatesDir = path.join(chartContext.chartRoot, 'templates');
    const templatePattern = new vscode.RelativePattern(templatesDir, '**/*.{yaml,yml,tpl}');
    const templateFiles = await vscode.workspace.findFiles(templatePattern);

    // Search each template file for references
    for (const templateUri of templateFiles) {
      try {
        const document = await vscode.workspace.openTextDocument(templateUri);
        const text = document.getText();
        const references = templateParser.parseTemplateReferences(text);

        // Find references that match the value path
        // Match both exact path and paths that start with valuePath (for nested access)
        for (const ref of references) {
          if (ref.objectType === 'Values' && (ref.path === valuePath || ref.path.startsWith(valuePath + '.'))) {
            // Calculate position from offset
            const startPos = document.positionAt(ref.startOffset);
            const endPos = document.positionAt(ref.endOffset);
            const range = new vscode.Range(startPos, endPos);
            locations.push(new vscode.Location(templateUri, range));
          }
        }
      } catch (error) {
        console.error(`Failed to search template file ${templateUri.fsPath}: ${error}`);
      }
    }

    return locations;
  }

  /**
   * Find references to a value path in a subchart's templates.
   * Used when the value is defined in parent's values.yaml under a subchart key.
   */
  private async findReferencesInSubchartTemplates(
    subchartRoot: string,
    valuePath: string
  ): Promise<vscode.Location[]> {
    const locations: vscode.Location[] = [];
    const templateParser = TemplateParser.getInstance();

    // Find all template files in the subchart
    const templatesDir = path.join(subchartRoot, 'templates');
    const templatePattern = new vscode.RelativePattern(templatesDir, '**/*.{yaml,yml,tpl}');
    const templateFiles = await vscode.workspace.findFiles(templatePattern);

    // Search each template file for references
    for (const templateUri of templateFiles) {
      try {
        const document = await vscode.workspace.openTextDocument(templateUri);
        const text = document.getText();
        const references = templateParser.parseTemplateReferences(text);

        // Find references that match the value path
        for (const ref of references) {
          if (ref.objectType === 'Values' && (ref.path === valuePath || ref.path.startsWith(valuePath + '.'))) {
            const startPos = document.positionAt(ref.startOffset);
            const endPos = document.positionAt(ref.endOffset);
            const range = new vscode.Range(startPos, endPos);
            locations.push(new vscode.Location(templateUri, range));
          }
        }
      } catch (error) {
        console.error(`Failed to search subchart template file ${templateUri.fsPath}: ${error}`);
      }
    }

    return locations;
  }
}
