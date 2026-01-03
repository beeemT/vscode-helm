import * as path from 'path';
import * as vscode from 'vscode';
import { HelmChartService } from '../services/helmChartService';
import { TemplateParser } from '../services/templateParser';

/**
 * Provider for finding all references to a value key in Helm template files.
 * Enables "Find All References" from values.yaml to see where values are used.
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
    return this.findReferencesInTemplates(chartContext.chartRoot, valuePath);
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
    chartRoot: string,
    valuePath: string
  ): Promise<vscode.Location[]> {
    const locations: vscode.Location[] = [];
    const templateParser = TemplateParser.getInstance();

    // Find all template files
    const templatesDir = path.join(chartRoot, 'templates');
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
          if (ref.path === valuePath || ref.path.startsWith(valuePath + '.')) {
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
}
