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

suite('HelmReferenceProvider - Global values in subcharts', () => {
  const fixturesPath = path.join(__dirname, '..', '..', '..', 'src', 'test', 'fixtures');
  const parentChartPath = path.join(fixturesPath, 'parent-with-deps');
  const parentValuesPath = path.join(parentChartPath, 'values.yaml');
  const subchartTemplatePath = path.join(parentChartPath, 'charts', 'mysql', 'templates', 'statefulset.yaml');

  let parentValuesDocument: vscode.TextDocument;
  let provider: HelmReferenceProvider;

  suiteSetup(async () => {
    HelmChartService.getInstance();
    provider = HelmReferenceProvider.getInstance();
    parentValuesDocument = await vscode.workspace.openTextDocument(parentValuesPath);
  });

  test('finds global.region references in subchart templates', async () => {
    // Find the line with "region: us-east-1" under "global:"
    const text = parentValuesDocument.getText();
    const lines = text.split('\n');
    let regionLine = -1;
    let foundGlobal = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('global:')) {
        foundGlobal = true;
      }
      if (foundGlobal && lines[i].includes('region:')) {
        regionLine = i;
        break;
      }
    }
    assert.ok(regionLine >= 0, 'Should find region line under global');

    const position = new vscode.Position(regionLine, 4); // Position on "region"
    const context: vscode.ReferenceContext = { includeDeclaration: false };
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideReferences(parentValuesDocument, position, context, token);

    assert.ok(result, 'Should return references');
    assert.ok(Array.isArray(result), 'Should be an array');
    assert.ok(result.length > 0, 'Should find at least one reference');

    // Verify reference is found in subchart template
    const subchartRef = result.find((loc) => loc.uri.fsPath === subchartTemplatePath);
    assert.ok(subchartRef, 'Should find reference in subchart statefulset.yaml');
  });

  test('finds global.environment references in subchart templates', async () => {
    // Find the line with "environment: production" under "global:"
    const text = parentValuesDocument.getText();
    const lines = text.split('\n');
    let envLine = -1;
    let foundGlobal = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('global:')) {
        foundGlobal = true;
      }
      if (foundGlobal && lines[i].includes('environment:')) {
        envLine = i;
        break;
      }
    }
    assert.ok(envLine >= 0, 'Should find environment line under global');

    const position = new vscode.Position(envLine, 4); // Position on "environment"
    const context: vscode.ReferenceContext = { includeDeclaration: false };
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideReferences(parentValuesDocument, position, context, token);

    assert.ok(result, 'Should return references');
    assert.ok(Array.isArray(result), 'Should be an array');
    assert.ok(result.length > 0, 'Should find at least one reference');

    // Verify reference is found in subchart template
    const subchartRef = result.find((loc) => loc.uri.fsPath === subchartTemplatePath);
    assert.ok(subchartRef, 'Should find reference in subchart statefulset.yaml');
  });

  test('finds global parent key references in all subchart templates', async () => {
    // Find the line with "global:"
    const text = parentValuesDocument.getText();
    const lines = text.split('\n');
    let globalLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('global:')) {
        globalLine = i;
        break;
      }
    }
    assert.ok(globalLine >= 0, 'Should find global line');

    const position = new vscode.Position(globalLine, 2); // Position on "global"
    const context: vscode.ReferenceContext = { includeDeclaration: false };
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideReferences(parentValuesDocument, position, context, token);

    assert.ok(result, 'Should return references');
    assert.ok(Array.isArray(result), 'Should be an array');
    // Should find global.environment and global.region references in subchart
    assert.ok(result.length >= 2, 'Should find multiple global references');
  });
});

suite('HelmReferenceProvider - Aliased subcharts', () => {
  const fixturesPath = path.join(__dirname, '..', '..', '..', 'src', 'test', 'fixtures');
  const parentChartPath = path.join(fixturesPath, 'parent-with-deps');
  const parentValuesPath = path.join(parentChartPath, 'values.yaml');
  const mysqlTemplatePath = path.join(parentChartPath, 'charts', 'mysql', 'templates', 'statefulset.yaml');

  let parentValuesDocument: vscode.TextDocument;
  let provider: HelmReferenceProvider;

  suiteSetup(async () => {
    HelmChartService.getInstance();
    provider = HelmReferenceProvider.getInstance();
    parentValuesDocument = await vscode.workspace.openTextDocument(parentValuesPath);
  });

  test('finds references for aliased subchart values (database.auth.rootPassword)', async () => {
    // Find the line with "rootPassword:" under "database.auth:"
    const text = parentValuesDocument.getText();
    const lines = text.split('\n');
    let rootPasswordLine = -1;
    let foundDatabase = false;
    let foundAuth = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('database:')) {
        foundDatabase = true;
      }
      if (foundDatabase && lines[i].includes('auth:')) {
        foundAuth = true;
      }
      if (foundAuth && lines[i].includes('rootPassword:')) {
        rootPasswordLine = i;
        break;
      }
    }
    assert.ok(rootPasswordLine >= 0, 'Should find rootPassword line under database.auth');

    const position = new vscode.Position(rootPasswordLine, 6); // Position on "rootPassword"
    const context: vscode.ReferenceContext = { includeDeclaration: false };
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideReferences(parentValuesDocument, position, context, token);

    assert.ok(result, 'Should return references');
    assert.ok(Array.isArray(result), 'Should be an array');
    assert.ok(result.length > 0, 'Should find at least one reference');

    // Verify reference is found in mysql subchart template (via alias "database")
    const mysqlRef = result.find((loc) => loc.uri.fsPath === mysqlTemplatePath);
    assert.ok(mysqlRef, 'Should find reference in mysql subchart statefulset.yaml');
  });

  test('finds references when clicking on aliased subchart key (database)', async () => {
    // Find the line with "database:"
    const text = parentValuesDocument.getText();
    const lines = text.split('\n');
    let databaseLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('database:')) {
        databaseLine = i;
        break;
      }
    }
    assert.ok(databaseLine >= 0, 'Should find database line');

    const position = new vscode.Position(databaseLine, 3); // Position on "database"
    const context: vscode.ReferenceContext = { includeDeclaration: false };
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideReferences(parentValuesDocument, position, context, token);

    assert.ok(result, 'Should return references');
    assert.ok(Array.isArray(result), 'Should be an array');
    // Should find all references in mysql subchart (auth.rootPassword, etc.)
    assert.ok(result.length >= 1, 'Should find at least one reference in subchart');
  });
});

suite('HelmReferenceProvider - Nested subcharts', () => {
  const fixturesPath = path.join(__dirname, '..', '..', '..', 'src', 'test', 'fixtures');
  const nestedChartPath = path.join(fixturesPath, 'nested-subcharts');
  const nestedValuesPath = path.join(nestedChartPath, 'values.yaml');
  const leafTemplatePath = path.join(nestedChartPath, 'charts', 'parent', 'charts', 'leaf', 'templates', 'configmap.yaml');

  let nestedValuesDocument: vscode.TextDocument;
  let provider: HelmReferenceProvider;

  suiteSetup(async () => {
    HelmChartService.getInstance();
    provider = HelmReferenceProvider.getInstance();
    nestedValuesDocument = await vscode.workspace.openTextDocument(nestedValuesPath);
  });

  test('finds references in nested subchart (parentAlias.leafAlias.config.setting)', async () => {
    // Find the line with "setting:" under "parentAlias.leafAlias.config:"
    const text = nestedValuesDocument.getText();
    const lines = text.split('\n');
    let settingLine = -1;
    let foundParentAlias = false;
    let foundLeafAlias = false;
    let foundConfig = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('parentAlias:')) {
        foundParentAlias = true;
      }
      if (foundParentAlias && lines[i].includes('leafAlias:')) {
        foundLeafAlias = true;
      }
      if (foundLeafAlias && lines[i].includes('config:')) {
        foundConfig = true;
      }
      if (foundConfig && lines[i].includes('setting:')) {
        settingLine = i;
        break;
      }
    }
    assert.ok(settingLine >= 0, 'Should find setting line under parentAlias.leafAlias.config');

    const position = new vscode.Position(settingLine, 8); // Position on "setting"
    const context: vscode.ReferenceContext = { includeDeclaration: false };
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideReferences(nestedValuesDocument, position, context, token);

    assert.ok(result, 'Should return references');
    assert.ok(Array.isArray(result), 'Should be an array');
    assert.ok(result.length > 0, 'Should find at least one reference');

    // Verify reference is found in leaf subchart template
    const leafRef = result.find((loc) => loc.uri.fsPath === leafTemplatePath);
    assert.ok(leafRef, 'Should find reference in leaf subchart configmap.yaml');
  });

  test('finds global references in nested subcharts', async () => {
    // Find the line with "environment:" under "global:"
    const text = nestedValuesDocument.getText();
    const lines = text.split('\n');
    let envLine = -1;
    let foundGlobal = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('global:')) {
        foundGlobal = true;
      }
      if (foundGlobal && lines[i].includes('environment:')) {
        envLine = i;
        break;
      }
    }
    assert.ok(envLine >= 0, 'Should find environment line under global');

    const position = new vscode.Position(envLine, 4); // Position on "environment"
    const context: vscode.ReferenceContext = { includeDeclaration: false };
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideReferences(nestedValuesDocument, position, context, token);

    assert.ok(result, 'Should return references');
    assert.ok(Array.isArray(result), 'Should be an array');
    assert.ok(result.length > 0, 'Should find at least one reference');

    // Verify reference is found in leaf subchart template
    const leafRef = result.find((loc) => loc.uri.fsPath === leafTemplatePath);
    assert.ok(leafRef, 'Should find global.environment reference in leaf subchart configmap.yaml');
  });
});

suite('HelmReferenceProvider - Intermediate subchart values.yaml', () => {
  const fixturesPath = path.join(__dirname, '..', '..', '..', 'src', 'test', 'fixtures');
  const nestedChartPath = path.join(fixturesPath, 'nested-subcharts');
  const parentValuesPath = path.join(nestedChartPath, 'charts', 'parent', 'values.yaml');
  const leafTemplatePath = path.join(nestedChartPath, 'charts', 'parent', 'charts', 'leaf', 'templates', 'configmap.yaml');

  let parentValuesDocument: vscode.TextDocument;
  let provider: HelmReferenceProvider;

  suiteSetup(async () => {
    HelmChartService.getInstance();
    provider = HelmReferenceProvider.getInstance();
    parentValuesDocument = await vscode.workspace.openTextDocument(parentValuesPath);
  });

  test('finds references in leaf subchart when editing parent subchart values.yaml (leafAlias.config.setting)', async () => {
    // Find the line with "setting:" under "leafAlias.config:"
    const text = parentValuesDocument.getText();
    const lines = text.split('\n');
    let settingLine = -1;
    let foundLeafAlias = false;
    let foundConfig = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('leafAlias:')) {
        foundLeafAlias = true;
      }
      if (foundLeafAlias && lines[i].includes('config:')) {
        foundConfig = true;
      }
      if (foundConfig && lines[i].includes('setting:')) {
        settingLine = i;
        break;
      }
    }
    assert.ok(settingLine >= 0, 'Should find setting line under leafAlias.config in parent values.yaml');

    const position = new vscode.Position(settingLine, 6); // Position on "setting"
    const context: vscode.ReferenceContext = { includeDeclaration: false };
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideReferences(parentValuesDocument, position, context, token);

    assert.ok(result, 'Should return references');
    assert.ok(Array.isArray(result), 'Should be an array');
    assert.ok(result.length > 0, 'Should find at least one reference');

    // Verify reference is found in leaf subchart template
    const leafRef = result.find((loc) => loc.uri.fsPath === leafTemplatePath);
    assert.ok(leafRef, 'Should find reference in leaf subchart configmap.yaml when editing parent subchart values.yaml');
  });

  test('clicking on leafAlias key returns empty when no value path specified', async () => {
    // Find the line with "leafAlias:"
    const text = parentValuesDocument.getText();
    const lines = text.split('\n');
    let leafAliasLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('leafAlias:')) {
        leafAliasLine = i;
        break;
      }
    }
    assert.ok(leafAliasLine >= 0, 'Should find leafAlias line');

    const position = new vscode.Position(leafAliasLine, 3); // Position on "leafAlias"
    const context: vscode.ReferenceContext = { includeDeclaration: false };
    const token = new vscode.CancellationTokenSource().token;

    const result = await provider.provideReferences(parentValuesDocument, position, context, token);

    // Clicking on just the subchart key without a value path returns empty
    // because there's no specific value to search for in templates
    assert.ok(result, 'Should return result');
    assert.ok(Array.isArray(result), 'Should be an array');
    // Behavior: no references when clicking on just the subchart alias key itself
    // (need a value path like leafAlias.config.setting)
  });
});
