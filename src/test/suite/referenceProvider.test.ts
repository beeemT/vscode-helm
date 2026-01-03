import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { HelmReferenceProvider } from '../../providers/referenceProvider';
import { HelmChartService } from '../../services/helmChartService';

suite('HelmReferenceProvider', () => {
  const fixturesPath = path.join(__dirname, '..', '..', '..', 'src', 'test', 'fixtures');
  const sampleChartPath = path.join(fixturesPath, 'sample-chart');
  const valuesPath = path.join(sampleChartPath, 'values.yaml');
  const templatePath = path.join(sampleChartPath, 'templates', 'deployment.yaml');

  let valuesDocument: vscode.TextDocument;
  let provider: HelmReferenceProvider;

  suiteSetup(async () => {
    // Initialize services
    HelmChartService.getInstance();
    provider = HelmReferenceProvider.getInstance();

    // Open the values file
    valuesDocument = await vscode.workspace.openTextDocument(valuesPath);
  });

  test('returns undefined for template files', async () => {
    const templateDoc = await vscode.workspace.openTextDocument(templatePath);
    const position = new vscode.Position(0, 0);
    const context: vscode.ReferenceContext = { includeDeclaration: false };
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideReferences(templateDoc, position, context, token);

    assert.strictEqual(result, undefined);
  });

  test('returns undefined for non-Helm values files', async () => {
    const nonHelmDoc = await vscode.workspace.openTextDocument({
      content: 'someKey: value',
      language: 'yaml',
    });
    const position = new vscode.Position(0, 0);
    const context: vscode.ReferenceContext = { includeDeclaration: false };
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideReferences(nonHelmDoc, position, context, token);

    assert.strictEqual(result, undefined);
  });

  test('returns undefined for empty lines', async () => {
    // Find an empty line or comment line
    const position = new vscode.Position(0, 0); // First line is a comment
    const context: vscode.ReferenceContext = { includeDeclaration: false };
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideReferences(valuesDocument, position, context, token);

    assert.strictEqual(result, undefined);
  });

  test('finds references for top-level key', async () => {
    // Find the line with "replicaCount: 1"
    const text = valuesDocument.getText();
    const lines = text.split('\n');
    let replicaCountLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('replicaCount:')) {
        replicaCountLine = i;
        break;
      }
    }
    assert.ok(replicaCountLine >= 0, 'Should find replicaCount line');

    const position = new vscode.Position(replicaCountLine, 5); // Position on "replicaCount"
    const context: vscode.ReferenceContext = { includeDeclaration: false };
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideReferences(valuesDocument, position, context, token);

    assert.ok(result, 'Should return references');
    assert.ok(Array.isArray(result), 'Should be an array');
    assert.ok(result.length > 0, 'Should find at least one reference');

    // Verify at least one reference is in the template
    const templateRef = result.find((loc) => loc.uri.fsPath === templatePath);
    assert.ok(templateRef, 'Should find reference in deployment.yaml');
  });

  test('finds references for nested key (image.repository)', async () => {
    // Find the line with "repository: nginx" under "image:"
    const text = valuesDocument.getText();
    const lines = text.split('\n');
    let repositoryLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('repository:') && lines[i].includes('nginx')) {
        repositoryLine = i;
        break;
      }
    }
    assert.ok(repositoryLine >= 0, 'Should find repository line');

    const position = new vscode.Position(repositoryLine, 4); // Position on "repository"
    const context: vscode.ReferenceContext = { includeDeclaration: false };
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideReferences(valuesDocument, position, context, token);

    assert.ok(result, 'Should return references');
    assert.ok(Array.isArray(result), 'Should be an array');
    assert.ok(result.length > 0, 'Should find at least one reference');

    // Verify at least one reference is in the template
    const templateRef = result.find((loc) => loc.uri.fsPath === templatePath);
    assert.ok(templateRef, 'Should find reference in deployment.yaml');
  });

  test('finds references for deeply nested key (resources.limits.cpu)', async () => {
    // Find the line with "cpu: 100m" under "limits:"
    const text = valuesDocument.getText();
    const lines = text.split('\n');
    let cpuLine = -1;
    let foundLimits = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('limits:')) {
        foundLimits = true;
      }
      if (foundLimits && lines[i].includes('cpu:')) {
        cpuLine = i;
        break;
      }
    }
    assert.ok(cpuLine >= 0, 'Should find cpu line under limits');

    const position = new vscode.Position(cpuLine, 6); // Position on "cpu"
    const context: vscode.ReferenceContext = { includeDeclaration: false };
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideReferences(valuesDocument, position, context, token);

    assert.ok(result, 'Should return references');
    assert.ok(Array.isArray(result), 'Should be an array');
    assert.ok(result.length > 0, 'Should find at least one reference');

    // Verify at least one reference is in the template
    const templateRef = result.find((loc) => loc.uri.fsPath === templatePath);
    assert.ok(templateRef, 'Should find reference in deployment.yaml');
  });

  test('finds references for parent key that has nested access (image)', async () => {
    // Find the line with "image:"
    const text = valuesDocument.getText();
    const lines = text.split('\n');
    let imageLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('image:')) {
        imageLine = i;
        break;
      }
    }
    assert.ok(imageLine >= 0, 'Should find image line');

    const position = new vscode.Position(imageLine, 2); // Position on "image"
    const context: vscode.ReferenceContext = { includeDeclaration: false };
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideReferences(valuesDocument, position, context, token);

    assert.ok(result, 'Should return references');
    assert.ok(Array.isArray(result), 'Should be an array');
    // Should find references to image.repository, image.tag, image.pullPolicy
    assert.ok(result.length >= 3, 'Should find multiple nested references');
  });

  test('returns empty array for key with no references', async () => {
    // Find the line with "affinity: {}"
    const text = valuesDocument.getText();
    const lines = text.split('\n');
    let affinityLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('affinity:')) {
        affinityLine = i;
        break;
      }
    }
    assert.ok(affinityLine >= 0, 'Should find affinity line');

    const position = new vscode.Position(affinityLine, 3); // Position on "affinity"
    const context: vscode.ReferenceContext = { includeDeclaration: false };
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideReferences(valuesDocument, position, context, token);

    assert.ok(result, 'Should return result');
    assert.ok(Array.isArray(result), 'Should be an array');
    assert.strictEqual(result.length, 0, 'Should find no references');
  });
});
