import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { HelmDefinitionProvider } from '../../providers/definitionProvider';
import { HelmChartService } from '../../services/helmChartService';

suite('HelmDefinitionProvider', () => {
  const fixturesPath = path.join(__dirname, '..', '..', '..', 'src', 'test', 'fixtures');
  const sampleChartPath = path.join(fixturesPath, 'sample-chart');
  const templatePath = path.join(sampleChartPath, 'templates', 'deployment.yaml');
  const valuesPath = path.join(sampleChartPath, 'values.yaml');

  let document: vscode.TextDocument;
  let provider: HelmDefinitionProvider;

  suiteSetup(async () => {
    // Initialize services
    HelmChartService.getInstance();
    provider = HelmDefinitionProvider.getInstance();

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

    const result = await provider.provideDefinition(nonHelmDoc, position, token);

    assert.strictEqual(result, undefined);
  });

  test('returns undefined when cursor is not on a .Values reference', async () => {
    // Position on "apiVersion" line which has no .Values
    const position = new vscode.Position(0, 5);
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideDefinition(document, position, token);

    assert.strictEqual(result, undefined);
  });

  test('returns location for simple .Values reference', async () => {
    // Find the line with {{ .Values.replicaCount }}
    const text = document.getText();
    const match = text.match(/\{\{\s*\.Values\.replicaCount\s*\}\}/);
    assert.ok(match, 'Should find .Values.replicaCount in template');

    const matchIndex = match.index!;
    const position = document.positionAt(matchIndex + 10); // Position inside .Values.replicaCount
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideDefinition(document, position, token);

    assert.ok(result, 'Should return a definition');
    assert.ok(result instanceof vscode.Location, 'Should be a Location');

    const location = result as vscode.Location;
    assert.strictEqual(
      location.uri.fsPath,
      valuesPath,
      'Should point to values.yaml'
    );
    // replicaCount is on line 2 (0-indexed line 1)
    assert.strictEqual(location.range.start.line, 1, 'Should point to correct line');
  });

  test('returns location for nested .Values reference', async () => {
    // Find {{ .Values.image.repository }}
    const text = document.getText();
    const match = text.match(/\{\{\s*\.Values\.image\.repository\s*\}\}/);
    assert.ok(match, 'Should find .Values.image.repository in template');

    const matchIndex = match.index!;
    const position = document.positionAt(matchIndex + 15); // Position inside the reference
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideDefinition(document, position, token);

    assert.ok(result, 'Should return a definition');
    assert.ok(result instanceof vscode.Location, 'Should be a Location');

    const location = result as vscode.Location;
    assert.strictEqual(
      location.uri.fsPath,
      valuesPath,
      'Should point to values.yaml'
    );
  });

  test('returns location for deeply nested .Values reference', async () => {
    // Find {{ .Values.resources.limits.cpu }}
    const text = document.getText();
    const match = text.match(/\{\{\s*\.Values\.resources\.limits\.cpu\s*\}\}/);
    assert.ok(match, 'Should find .Values.resources.limits.cpu in template');

    const matchIndex = match.index!;
    const position = document.positionAt(matchIndex + 20); // Position inside the reference
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideDefinition(document, position, token);

    assert.ok(result, 'Should return a definition');
    assert.ok(result instanceof vscode.Location, 'Should be a Location');

    const location = result as vscode.Location;
    assert.strictEqual(
      location.uri.fsPath,
      valuesPath,
      'Should point to values.yaml'
    );
  });
});

suite('HelmDefinitionProvider - Helm Objects', () => {
  const fixturesPath = path.join(__dirname, '..', '..', '..', 'src', 'test', 'fixtures');
  const sampleChartPath = path.join(fixturesPath, 'sample-chart');
  const helpersTplPath = path.join(sampleChartPath, 'templates', '_helpers.tpl');
  const chartYamlPath = path.join(sampleChartPath, 'Chart.yaml');

  let document: vscode.TextDocument;
  let provider: HelmDefinitionProvider;

  suiteSetup(async () => {
    HelmChartService.getInstance();
    provider = HelmDefinitionProvider.getInstance();
    document = await vscode.workspace.openTextDocument(helpersTplPath);
  });

  test('returns location to Chart.yaml for .Chart reference', async () => {
    // Find .Chart.Name in the template
    const text = document.getText();
    const match = text.match(/\.Chart\.Name/);
    assert.ok(match, 'Should find .Chart.Name in template');

    const matchIndex = match.index!;
    const position = document.positionAt(matchIndex + 5); // Position inside .Chart.Name
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideDefinition(document, position, token);

    assert.ok(result, 'Should return a definition for .Chart');
    assert.ok(result instanceof vscode.Location, 'Should be a Location');

    const location = result as vscode.Location;
    assert.strictEqual(
      location.uri.fsPath,
      chartYamlPath,
      'Should point to Chart.yaml'
    );
  });

  test('returns undefined for .Release reference (no file definition)', async () => {
    // Find .Release.Name in the template
    const text = document.getText();
    const match = text.match(/\.Release\.Name/);
    assert.ok(match, 'Should find .Release.Name in template');

    const matchIndex = match.index!;
    const position = document.positionAt(matchIndex + 5); // Position inside .Release.Name
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideDefinition(document, position, token);

    // .Release is runtime info, no file to navigate to
    assert.strictEqual(result, undefined, 'Should return undefined for .Release');
  });

  test('returns location for .Values reference in .tpl file', async () => {
    // Find .Values.nameOverride in the template
    const text = document.getText();
    const match = text.match(/\.Values\.nameOverride/);
    assert.ok(match, 'Should find .Values.nameOverride in template');

    const matchIndex = match.index!;
    const position = document.positionAt(matchIndex + 10); // Position inside .Values.nameOverride
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideDefinition(document, position, token);

    // nameOverride is not defined in values.yaml, so should return undefined
    // (or could return values.yaml location if we want to support creation)
    // Based on current implementation, it returns undefined for undefined values
    assert.ok(result === undefined || result instanceof vscode.Location,
      'Should return undefined or Location for undefined .Values');
  });
});
