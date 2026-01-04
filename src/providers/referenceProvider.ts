import * as path from 'path';
import * as vscode from 'vscode';
import { HelmChartContext, HelmChartService, SubchartInfo } from '../services/helmChartService';
import { TemplateParser } from '../services/templateParser';

/**
 * Provider for finding all references to a value key in Helm template files.
 * Enables "Find All References" from values.yaml to see where values are used.
 * Also supports finding references across parent/subchart boundaries, including nested subcharts.
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

    // If this chart has subcharts, check if the path is a subchart key
    // and find references within that subchart's templates (including nested subcharts)
    // This applies to both root charts and intermediate subcharts (parent subchart editing its leaf)
    if (chartContext.subcharts.length > 0) {
      const pathSegments = valuePath.split('.');
      const topLevelKey = pathSegments[0];

      // Check if this is a global.* path - globals are available in all subcharts
      if (topLevelKey === 'global') {
        // Search all subcharts (including nested) for references to this global value
        await this.findGlobalReferencesInAllSubcharts(chartContext, valuePath, locations);
      } else {
        // Check if the path starts with a subchart key (alias or name)
        // and recursively search through nested subcharts
        await this.findReferencesInSubchartChain(
          chartContext.subcharts,
          pathSegments,
          locations
        );
      }
    }

    return locations;
  }

  /**
   * Find references to global values in all subcharts, including nested ones.
   */
  private async findGlobalReferencesInAllSubcharts(
    chartContext: HelmChartContext,
    valuePath: string,
    locations: vscode.Location[]
  ): Promise<void> {
    // Recursively search all subcharts
    const searchSubcharts = async (subcharts: SubchartInfo[]): Promise<void> => {
      for (const subchart of subcharts) {
        // Search in this subchart's templates
        const subchartLocations = await this.findReferencesInSubchartTemplates(
          subchart.chartRoot,
          valuePath // global.* paths are accessed the same way in subcharts
        );
        if (subchartLocations && subchartLocations.length > 0) {
          locations.push(...subchartLocations);
        }

        // Discover and search nested subcharts
        const helmService = HelmChartService.getInstance();
        const nestedSubcharts = await helmService.discoverSubcharts(subchart.chartRoot);
        if (nestedSubcharts.length > 0) {
          await searchSubcharts(nestedSubcharts);
        }
      }
    };

    await searchSubcharts(chartContext.subcharts);
  }

  /**
   * Find references by following the subchart chain in the path.
   * For example, if valuePath is "parentAlias.leafAlias.config.setting":
   * 1. Find subchart with key "parentAlias"
   * 2. Find nested subchart with key "leafAlias" within parent
   * 3. Search for "config.setting" in leaf's templates
   */
  private async findReferencesInSubchartChain(
    subcharts: SubchartInfo[],
    pathSegments: string[],
    locations: vscode.Location[]
  ): Promise<void> {
    if (pathSegments.length === 0 || subcharts.length === 0) {
      return;
    }

    const currentKey = pathSegments[0];
    const helmService = HelmChartService.getInstance();

    // Find subchart matching the current key (by alias or name)
    const matchingSubchart = subcharts.find(
      (sub) => helmService.getSubchartValuesKey(sub) === currentKey
    );

    if (!matchingSubchart) {
      return;
    }

    const remainingSegments = pathSegments.slice(1);

    if (remainingSegments.length === 0) {
      // No more path segments - this shouldn't really be a valid use case
      // (clicking on just the subchart key itself)
      return;
    }

    // Check if the next segment is another subchart key (nested subchart)
    const nestedSubcharts = await helmService.discoverSubcharts(matchingSubchart.chartRoot);
    const nextKey = remainingSegments[0];
    const nestedSubchart = nestedSubcharts.find(
      (sub) => helmService.getSubchartValuesKey(sub) === nextKey
    );

    if (nestedSubchart && remainingSegments.length > 1) {
      // Continue down the subchart chain
      await this.findReferencesInSubchartChain(
        nestedSubcharts,
        remainingSegments,
        locations
      );
    } else {
      // No more nested subcharts matching - search in current subchart's templates
      const subchartValuePath = remainingSegments.join('.');
      if (subchartValuePath) {
        const subchartLocations = await this.findReferencesInSubchartTemplates(
          matchingSubchart.chartRoot,
          subchartValuePath
        );
        if (subchartLocations && subchartLocations.length > 0) {
          locations.push(...subchartLocations);
        }
      }
    }
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
