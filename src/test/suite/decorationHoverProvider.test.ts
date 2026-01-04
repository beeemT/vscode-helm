import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { HelmDecorationHoverProvider } from '../../providers/decorationHoverProvider';
import { StatusBarProvider } from '../../providers/statusBarProvider';
import { HelmChartService } from '../../services/helmChartService';
import { ValuesCache } from '../../services/valuesCache';

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

  test('hover shows source as values.yaml for default values', async () => {
    // Ensure no override file is selected
    const statusBar = StatusBarProvider.getInstance();
    statusBar?.setSelectedFile(sampleChartPath, '');
    ValuesCache.getInstance().invalidateCacheImmediate(sampleChartPath);

    // Find {{ .Values.replicaCount }} which exists in values.yaml
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

    // Should show Source with values.yaml
    assert.ok(content.value.includes('Source:'), 'Should include Source label');
    assert.ok(
      content.value.includes('values.yaml'),
      'Should indicate source is values.yaml'
    );
  });

  test('hover shows source as override file when override is selected', async () => {
    // Select the prod override file
    const statusBar = StatusBarProvider.getInstance();
    const overrideFile = path.join(sampleChartPath, 'values-prod.yaml');
    statusBar?.setSelectedFile(sampleChartPath, overrideFile);
    ValuesCache.getInstance().invalidateCacheImmediate(sampleChartPath);

    // Find {{ .Values.replicaCount }} which exists in values-prod.yaml
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

    // Should show Source with override file
    assert.ok(content.value.includes('Source:'), 'Should include Source label');
    assert.ok(
      content.value.includes('values-prod.yaml'),
      'Should indicate source is values-prod.yaml'
    );
    assert.ok(
      content.value.includes('sample-chart'),
      'Should indicate which chart the file belongs to'
    );

    // Clean up: reset to no override
    statusBar?.setSelectedFile(sampleChartPath, '');
    ValuesCache.getInstance().invalidateCacheImmediate(sampleChartPath);
  });

  test('hover shows source as values.yaml when value not in override file', async () => {
    // Select the prod override file
    const statusBar = StatusBarProvider.getInstance();
    const overrideFile = path.join(sampleChartPath, 'values-prod.yaml');
    statusBar?.setSelectedFile(sampleChartPath, overrideFile);
    ValuesCache.getInstance().invalidateCacheImmediate(sampleChartPath);

    // Find {{ .Values.image.pullPolicy }} which only exists in values.yaml, not in values-prod.yaml
    const text = document.getText();
    const match = text.match(/\{\{\s*\.Values\.image\.pullPolicy\s*\}\}/);
    assert.ok(match, 'Should find .Values.image.pullPolicy in template');

    const matchIndex = match.index!;
    const endOffset = matchIndex + match[0].length;
    const position = document.positionAt(endOffset);
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideHover(document, position, token);

    assert.ok(result, 'Should return a hover');
    const hover = result as vscode.Hover;
    const content = hover.contents[0] as vscode.MarkdownString;

    // Should show Source with values.yaml (not the override, since pullPolicy isn't in prod)
    assert.ok(content.value.includes('Source:'), 'Should include Source label');
    assert.ok(
      content.value.includes('values.yaml'),
      'Should indicate source is values.yaml when value not in override'
    );
    // Should NOT indicate it's an override
    assert.ok(
      !content.value.includes('(override)'),
      'Should not indicate override when value comes from default'
    );

    // Clean up: reset to no override
    statusBar?.setSelectedFile(sampleChartPath, '');
    ValuesCache.getInstance().invalidateCacheImmediate(sampleChartPath);
  });
});

suite('HelmDecorationHoverProvider - Helm Objects', () => {
  const fixturesPath = path.join(__dirname, '..', '..', '..', 'src', 'test', 'fixtures');
  const sampleChartPath = path.join(fixturesPath, 'sample-chart');
  const helpersTplPath = path.join(sampleChartPath, 'templates', '_helpers.tpl');

  let document: vscode.TextDocument;
  let provider: HelmDecorationHoverProvider;

  suiteSetup(async () => {
    HelmChartService.getInstance();
    provider = HelmDecorationHoverProvider.getInstance();
    document = await vscode.workspace.openTextDocument(helpersTplPath);
  });

  test('hover for .Chart.Name shows Chart.yaml value', async () => {
    // Find .Chart.Name in the template
    const text = document.getText();
    const match = text.match(/\.Chart\.Name/);
    assert.ok(match, 'Should find .Chart.Name in template');

    const matchIndex = match.index!;
    const endOffset = matchIndex + match[0].length;
    const position = document.positionAt(endOffset);
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideHover(document, position, token);

    assert.ok(result, 'Should return a hover for .Chart.Name');
    const hover = result as vscode.Hover;
    const content = hover.contents[0] as vscode.MarkdownString;

    // Should show the chart name from Chart.yaml
    assert.ok(content.value.includes('Value:'), 'Should show Value label');
    assert.ok(content.value.includes('sample-chart'), 'Should show the chart name');
    assert.ok(content.value.includes('.Chart.Name'), 'Should show the path');
    assert.ok(content.value.includes('Chart.yaml'), 'Should indicate source is Chart.yaml');
  });

  test('hover for .Release.Name shows runtime placeholder', async () => {
    // Find .Release.Name in the template
    const text = document.getText();
    const match = text.match(/\.Release\.Name/);
    assert.ok(match, 'Should find .Release.Name in template');

    const matchIndex = match.index!;
    const endOffset = matchIndex + match[0].length;
    const position = document.positionAt(endOffset);
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideHover(document, position, token);

    assert.ok(result, 'Should return a hover for .Release.Name');
    const hover = result as vscode.Hover;
    const content = hover.contents[0] as vscode.MarkdownString;

    // Should show Release context info
    assert.ok(content.value.includes('Value:'), 'Should show Value label');
    assert.ok(content.value.includes('.Release.Name'), 'Should show the path');
    assert.ok(
      content.value.includes('Release') || content.value.includes('runtime'),
      'Should indicate this is release/runtime context'
    );
  });

  test('hover for .Chart reference does not show unset warning', async () => {
    // Find .Chart.Name in the template
    const text = document.getText();
    const match = text.match(/\.Chart\.Name/);
    assert.ok(match, 'Should find .Chart.Name in template');

    const matchIndex = match.index!;
    const endOffset = matchIndex + match[0].length;
    const position = document.positionAt(endOffset);
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideHover(document, position, token);

    assert.ok(result, 'Should return a hover');
    const hover = result as vscode.Hover;
    const content = hover.contents[0] as vscode.MarkdownString;

    // Should NOT show unset warning for .Chart references
    assert.ok(!content.value.includes('⚠ unset'), 'Should not show unset warning for .Chart');
    assert.ok(
      !content.value.includes('Create value'),
      'Should not show Create value link for .Chart'
    );
  });

  test('hover for .Release reference does not show Go to definition', async () => {
    // Find .Release.Name in the template
    const text = document.getText();
    const match = text.match(/\.Release\.Name/);
    assert.ok(match, 'Should find .Release.Name in template');

    const matchIndex = match.index!;
    const endOffset = matchIndex + match[0].length;
    const position = document.positionAt(endOffset);
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideHover(document, position, token);

    assert.ok(result, 'Should return a hover');
    const hover = result as vscode.Hover;
    const content = hover.contents[0] as vscode.MarkdownString;

    // Should NOT show Go to definition for .Release references
    assert.ok(
      !content.value.includes('Go to definition'),
      'Should not show Go to definition for .Release'
    );
  });
});
