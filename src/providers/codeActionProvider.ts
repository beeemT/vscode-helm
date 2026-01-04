import * as vscode from 'vscode';
import { HelmChartService } from '../services/helmChartService';
import { ValuesDecorationProvider, UnsetValueReference } from './valuesDecorationProvider';

/**
 * Code action provider for Helm template files.
 * Provides quick fixes for unset values by offering to create them in values.yaml.
 */
export class HelmCodeActionProvider implements vscode.CodeActionProvider {
  private static instance: HelmCodeActionProvider;
  public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  private constructor() {}

  public static getInstance(): HelmCodeActionProvider {
    if (!HelmCodeActionProvider.instance) {
      HelmCodeActionProvider.instance = new HelmCodeActionProvider();
    }
    return HelmCodeActionProvider.instance;
  }

  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    _context: vscode.CodeActionContext,
    _token: vscode.CancellationToken
  ): vscode.CodeAction[] | undefined {
    const decorationProvider = ValuesDecorationProvider.getInstance();
    const unsetRefs = decorationProvider.getUnsetReferences(document.uri.toString());

    if (unsetRefs.length === 0) {
      return undefined;
    }

    const actions: vscode.CodeAction[] = [];

    // Find unset references that intersect with the current range/cursor position
    for (const unsetRef of unsetRefs) {
      if (this.rangesIntersect(range, unsetRef.range)) {
        const action = this.createAddValueAction(unsetRef);
        if (action) {
          actions.push(action);
        }
      }
    }

    return actions.length > 0 ? actions : undefined;
  }

  /**
   * Check if two ranges intersect
   */
  private rangesIntersect(range1: vscode.Range, range2: vscode.Range): boolean {
    return !range1.end.isBefore(range2.start) && !range2.end.isBefore(range1.start);
  }

  /**
   * Create a code action to add a missing value to values.yaml
   */
  private createAddValueAction(unsetRef: UnsetValueReference): vscode.CodeAction | undefined {
    const action = new vscode.CodeAction(
      `Add '.Values.${unsetRef.reference.path}' to values.yaml`,
      vscode.CodeActionKind.QuickFix
    );

    action.command = {
      command: 'helmValues.createMissingValue',
      title: 'Add missing value to values.yaml',
      arguments: [unsetRef.valuesYamlPath, unsetRef.reference.path],
    };

    action.isPreferred = true;

    return action;
  }
}

/**
 * Command handler for creating missing values in values.yaml
 */
export async function createMissingValueCommand(
  valuesYamlPath: string,
  valuePath: string
): Promise<void> {
  try {
    const helmService = HelmChartService.getInstance();

    // Read current values.yaml content
    let content: string;
    try {
      content = await helmService.readFileContents(valuesYamlPath);
    } catch {
      // File doesn't exist, create empty content
      content = '';
    }

    // Calculate the insertion point and new content
    const { newContent, insertPosition } = calculateYamlInsertion(content, valuePath);

    // Open the document
    const uri = vscode.Uri.file(valuesYamlPath);
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);

    // Apply the edit
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(new vscode.Position(0, 0), document.positionAt(content.length)), newContent);
    await vscode.workspace.applyEdit(edit);

    // Position cursor at the placeholder value
    if (insertPosition) {
      const newPosition = new vscode.Position(insertPosition.line, insertPosition.character);
      editor.selection = new vscode.Selection(newPosition, newPosition);
      editor.revealRange(new vscode.Range(newPosition, newPosition), vscode.TextEditorRevealType.InCenter);
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to add value: ${error}`);
  }
}

/**
 * Result of calculating YAML insertion
 */
interface YamlInsertionResult {
  /** The new file content */
  newContent: string;
  /** Position of the placeholder value for cursor placement */
  insertPosition?: { line: number; character: number };
}

/**
 * Calculate where and how to insert a new value path into YAML content.
 * Handles nested paths like "image.repository" by creating intermediate nodes if needed.
 */
export function calculateYamlInsertion(
  content: string,
  valuePath: string
): YamlInsertionResult {
  const segments = valuePath.split('.');
  const lines = content.split('\n');

  // Track which segments exist and at what indent/line
  interface NodeInfo {
    line: number;
    indent: number;
    lastChildLine: number; // Last line of this node's children
  }

  const existingNodes: Map<string, NodeInfo> = new Map();

  // Parse existing YAML structure
  const currentPath: string[] = [];
  const indentStack: { indent: number; key: string }[] = [];

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    const trimmed = line.trimStart();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const indent = line.length - trimmed.length;

    // Check if this is a key line
    const keyMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):/);
    if (keyMatch) {
      const key = keyMatch[1];

      // Pop items from stack that are at same or greater indent
      while (indentStack.length > 0 && indentStack[indentStack.length - 1].indent >= indent) {
        indentStack.pop();
        currentPath.pop();
      }

      currentPath.push(key);
      indentStack.push({ indent, key });

      const fullPath = currentPath.join('.');
      existingNodes.set(fullPath, { line: lineNum, indent, lastChildLine: lineNum });

      // Update parent's lastChildLine
      for (let i = 0; i < currentPath.length - 1; i++) {
        const parentPath = currentPath.slice(0, i + 1).join('.');
        const parentInfo = existingNodes.get(parentPath);
        if (parentInfo) {
          parentInfo.lastChildLine = lineNum;
        }
      }
    }
  }

  // Find the deepest existing ancestor
  let existingDepth = 0;
  let insertAfterLine = lines.length - 1;
  let baseIndent = 0;

  for (let i = segments.length - 1; i >= 0; i--) {
    const partialPath = segments.slice(0, i + 1).join('.');
    const nodeInfo = existingNodes.get(partialPath);
    if (nodeInfo) {
      existingDepth = i + 1;
      insertAfterLine = nodeInfo.lastChildLine;
      baseIndent = nodeInfo.indent + 2; // Standard YAML indent
      break;
    }
  }

  // If the full path exists, just position cursor at the value
  if (existingDepth === segments.length) {
    const nodeInfo = existingNodes.get(valuePath);
    if (nodeInfo) {
      const line = lines[nodeInfo.line];
      const colonIndex = line.indexOf(':');
      return {
        newContent: content,
        insertPosition: { line: nodeInfo.line, character: colonIndex + 2 },
      };
    }
  }

  // Build the new YAML lines to insert
  const newLines: string[] = [];
  let currentIndent = baseIndent;

  for (let i = existingDepth; i < segments.length; i++) {
    const segment = segments[i];
    const indentStr = ' '.repeat(currentIndent);

    if (i === segments.length - 1) {
      // Last segment - add placeholder value
      newLines.push(`${indentStr}${segment}: # TODO: set value`);
    } else {
      // Intermediate segment - just the key
      newLines.push(`${indentStr}${segment}:`);
    }
    currentIndent += 2;
  }

  // Insert the new lines after the insertion point
  const resultLines = [...lines];

  // Handle empty file case
  if (content.trim() === '') {
    const insertedContent = newLines.join('\n');
    const lastLineIndex = newLines.length - 1;
    const lastLine = newLines[lastLineIndex];
    const valueCharIndex = lastLine.indexOf(':') + 2;

    return {
      newContent: insertedContent,
      insertPosition: { line: lastLineIndex, character: valueCharIndex },
    };
  }

  // Find the right place to insert (after lastChildLine of parent)
  // We need to find where the parent's children end
  let insertIndex = insertAfterLine + 1;

  // Skip any trailing empty lines or comments that belong to the previous section
  while (insertIndex < resultLines.length) {
    const nextLine = resultLines[insertIndex];
    const nextTrimmed = nextLine.trimStart();

    // If it's a non-empty, non-comment line, check its indent
    if (nextTrimmed && !nextTrimmed.startsWith('#')) {
      const nextIndent = nextLine.length - nextTrimmed.length;
      // If the next line has same or less indent than our base, stop here
      if (nextIndent < baseIndent) {
        break;
      }
      // Otherwise, this line is still part of the current section
      insertIndex++;
    } else {
      // Empty or comment line - keep looking
      insertIndex++;
    }
  }

  // Actually insert at insertAfterLine + 1 for cleaner insertion
  insertIndex = insertAfterLine + 1;

  resultLines.splice(insertIndex, 0, ...newLines);

  const insertedLineIndex = insertIndex + newLines.length - 1;
  const lastInsertedLine = newLines[newLines.length - 1];
  const valueCharIndex = lastInsertedLine.indexOf(':') + 2;

  return {
    newContent: resultLines.join('\n'),
    insertPosition: { line: insertedLineIndex, character: valueCharIndex },
  };
}
