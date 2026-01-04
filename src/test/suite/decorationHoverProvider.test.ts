import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { HelmDecorationHoverProvider } from '../../providers/decorationHoverProvider';
import { HelmChartService } from '../../services/helmChartService';

suite('HelmDecorationHoverProvider', () => {
  const fixturesPath = path.join(__dirname, '..', '..', '..', 'src', 'test', 'fixtures');
  const sampleChartPath = path.join(fixturesPath, 'sample-chart');
  const templatePath = path.join(sampleChartPath, 'templates', 'deployment.yaml');

  let document: vscode.TextDocument;
  let provider: HelmDecorationHoverProvider;

  suiteSetup(async () => {
    // Initialize services
    HelmChartService.getInstance();
    provider = HelmDecorationHoverProvider.getInstance();

    // Open the template file
    document = await vscode.workspace.openTextDocument(templatePath);
  });

  test('returns undefined for non-Helm files', async () => {
    const nonHelmDoc = await vscode.workspace.openTextDocument({
      content: 'not a helm file',
      language: 'yaml',
    });
    const position = new vscode.Position(0, 0);
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideHover(nonHelmDoc, position, token);

    assert.strictEqual(result, undefined);
  });

  test('returns undefined when cursor is far from .Values expression end', async () => {
    // Position at the very beginning of the file
    const position = new vscode.Position(0, 0);
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideHover(document, position, token);

    assert.strictEqual(result, undefined);
  });

  test('returns hover when cursor is near .Values expression end', async () => {
    // Find {{ .Values.replicaCount }} and position cursor at the end (after }})
    const text = document.getText();
    const match = text.match(/\{\{\s*\.Values\.replicaCount\s*\}\}/);
    assert.ok(match, 'Should find .Values.replicaCount in template');

    const matchIndex = match.index!;
    const endOffset = matchIndex + match[0].length;
    const position = document.positionAt(endOffset); // Position right after }}
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideHover(document, position, token);

    assert.ok(result, 'Should return a hover');
    assert.ok(result instanceof vscode.Hover, 'Should be a Hover');

    const hover = result as vscode.Hover;
    assert.ok(hover.contents.length > 0, 'Should have hover content');

    // Check that the content includes the value
    const content = hover.contents[0];
    assert.ok(content instanceof vscode.MarkdownString, 'Content should be MarkdownString');
    const markdown = content as vscode.MarkdownString;
    assert.ok(markdown.value.includes('Value:'), 'Should show value');
    assert.ok(markdown.value.includes('.Values.replicaCount'), 'Should show path');
  });

  test('hover includes Go to definition link', async () => {
    // Find {{ .Values.replicaCount }}
    const text = document.getText();
    const match = text.match(/\{\{\s*\.Values\.replicaCount\s*\}\}/);
    assert.ok(match, 'Should find .Values.replicaCount in template');

    const matchIndex = match.index!;
    const endOffset = matchIndex + match[0].length;
    const position = document.positionAt(endOffset);
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideHover(document, position, token);

    assert.ok(result, 'Should return a hover');
    const hover = result as vscode.Hover;
    const content = hover.contents[0] as vscode.MarkdownString;

    assert.ok(
      content.value.includes('Go to definition'),
      'Should include Go to definition link'
    );
    assert.ok(content.isTrusted, 'MarkdownString should be trusted for command links');
  });

  test('hover shows correct value for nested path', async () => {
    // Find {{ .Values.image.repository }}
    const text = document.getText();
    const match = text.match(/\{\{\s*\.Values\.image\.repository\s*\}\}/);
    assert.ok(match, 'Should find .Values.image.repository in template');

    const matchIndex = match.index!;
    const endOffset = matchIndex + match[0].length;
    const position = document.positionAt(endOffset);
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideHover(document, position, token);

    assert.ok(result, 'Should return a hover');
    const hover = result as vscode.Hover;
    const content = hover.contents[0] as vscode.MarkdownString;

    // The value should be "nginx" from values.yaml
    assert.ok(
      content.value.includes('nginx') || content.value.includes('"nginx"'),
      'Should show the resolved value "nginx"'
    );
    assert.ok(
      content.value.includes('.Values.image.repository'),
      'Should show the full path'
    );
  });

  test('hover responds within range near expression end', async () => {
    // Test that hover works a few characters after the expression end
    const text = document.getText();
    const match = text.match(/\{\{\s*\.Values\.replicaCount\s*\}\}/);
    assert.ok(match, 'Should find .Values.replicaCount in template');

    const matchIndex = match.index!;
    const endOffset = matchIndex + match[0].length;

    // Test positions within the hover range (endOffset - 2 to endOffset + 10)
    const token = new vscode.CancellationTokenSource().token;

    // Position at end - 1 (inside the closing }})
    const pos1 = document.positionAt(endOffset - 1);
    const result1 = await provider.provideHover(document, pos1, token);
    assert.ok(result1, 'Should return hover at end-1');

    // Position at end + 1 (just after }})
    const pos2 = document.positionAt(endOffset + 1);
    const result2 = await provider.provideHover(document, pos2, token);
    assert.ok(result2, 'Should return hover at end+1');
  });

  test('hover for unset value shows Create value link', async () => {
    // Find {{ .Values.monitoring.path }} which is a standalone unset reference
    const text = document.getText();
    const match = text.match(/\{\{\s*\.Values\.monitoring\.path\s*\}\}/);
    assert.ok(match, 'Should find .Values.monitoring.path in template');

    const matchIndex = match.index!;
    const endOffset = matchIndex + match[0].length;
    const position = document.positionAt(endOffset);
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideHover(document, position, token);

    assert.ok(result, 'Should return a hover');
    const hover = result as vscode.Hover;
    const content = hover.contents[0] as vscode.MarkdownString;

    // Should show unset indicator
    assert.ok(content.value.includes('unset'), 'Should indicate value is unset');
    // Should show the path
    assert.ok(
      content.value.includes('.Values.monitoring.path'),
      'Should show the full path'
    );
    // Should have Create value link
    assert.ok(
      content.value.includes('Create value'),
      'Should include Create value link for unset values'
    );
    assert.ok(
      content.value.includes('helmValues.createMissingValue'),
      'Should use createMissingValue command'
    );
    assert.ok(content.isTrusted, 'MarkdownString should be trusted for command links');
  });

  test('hover for unset value does not show Go to definition link', async () => {
    // Find {{ .Values.monitoring.path }} which is a standalone unset reference
    const text = document.getText();
    const match = text.match(/\{\{\s*\.Values\.monitoring\.path\s*\}\}/);
    assert.ok(match, 'Should find .Values.monitoring.path in template');

    const matchIndex = match.index!;
    const endOffset = matchIndex + match[0].length;
    const position = document.positionAt(endOffset);
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideHover(document, position, token);

    assert.ok(result, 'Should return a hover');
    const hover = result as vscode.Hover;
    const content = hover.contents[0] as vscode.MarkdownString;

    // Should NOT show Go to definition (since there's no definition)
    assert.ok(
      !content.value.includes('Go to definition'),
      'Should not include Go to definition link for unset values'
    );
  });
});
