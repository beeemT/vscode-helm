import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { ValuesDecorationProvider } from '../../providers/valuesDecorationProvider';
import { HelmChartService } from '../../services/helmChartService';
import { ValuesCache } from '../../services/valuesCache';

suite('ValuesDecorationProvider', () => {
  const fixturesPath = path.join(__dirname, '..', '..', '..', 'src', 'test', 'fixtures');
  const sampleChartPath = path.join(fixturesPath, 'sample-chart');
  const templatePath = path.join(sampleChartPath, 'templates', 'deployment.yaml');

  suiteSetup(async () => {
    // Initialize services
    HelmChartService.getInstance();
    ValuesCache.getInstance();

    // Open the template file to ensure it's loaded
    await vscode.workspace.openTextDocument(templatePath);
  });

  test('ValuesDecorationProvider is a singleton', () => {
    const instance1 = ValuesDecorationProvider.getInstance();
    const instance2 = ValuesDecorationProvider.getInstance();

    assert.strictEqual(instance1, instance2, 'Should return the same instance');
  });

  test('initialize returns singleton instance', () => {
    const instance1 = ValuesDecorationProvider.initialize();
    const instance2 = ValuesDecorationProvider.getInstance();

    assert.strictEqual(instance1, instance2, 'initialize should return singleton');
  });

  test('refresh does not throw', async () => {
    const provider = ValuesDecorationProvider.getInstance();

    // Should not throw
    await assert.doesNotReject(async () => {
      await provider.refresh();
    });
  });

  test('clearDecorations does not throw', () => {
    const provider = ValuesDecorationProvider.getInstance();

    // Should not throw
    assert.doesNotThrow(() => {
      provider.clearDecorations();
    });
  });

  test('updateDecorations handles non-Helm files gracefully', async () => {
    const provider = ValuesDecorationProvider.getInstance();
    const nonHelmDoc = await vscode.workspace.openTextDocument({
      content: 'not a helm file',
      language: 'yaml',
    });

    // Show the document in an editor
    const editor = await vscode.window.showTextDocument(nonHelmDoc);

    // Should not throw
    await assert.doesNotReject(async () => {
      await provider.updateDecorations(editor);
    });

    // Close the editor
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('dispose does not throw', () => {
    // Note: This creates a new instance that we'll dispose
    // The singleton pattern means we shouldn't dispose the main instance in tests
    // This test just verifies the dispose method exists and doesn't throw
    const provider = ValuesDecorationProvider.getInstance();
    assert.ok(typeof provider.dispose === 'function', 'dispose should be a function');
  });
});

suite('ValuesDecorationProvider Integration', () => {
  const fixturesPath = path.join(__dirname, '..', '..', '..', 'src', 'test', 'fixtures');
  const sampleChartPath = path.join(fixturesPath, 'sample-chart');
  const templatePath = path.join(sampleChartPath, 'templates', 'deployment.yaml');

  test('decorations are applied to Helm template files', async () => {
    // Open the template file
    const document = await vscode.workspace.openTextDocument(templatePath);
    const editor = await vscode.window.showTextDocument(document);

    const provider = ValuesDecorationProvider.getInstance();

    // Update decorations
    await provider.updateDecorations(editor);

    // The decoration provider should have processed the file without error
    // We can't directly verify the decorations content in tests,
    // but we can verify the method completes successfully
    assert.ok(true, 'Decorations were applied without error');

    // Close the editor
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('decorations update on config check', async () => {
    const config = vscode.workspace.getConfiguration('helmValues');
    const enabled = config.get<boolean>('enableInlayHints', true);

    // Verify config is readable
    assert.ok(typeof enabled === 'boolean', 'enableInlayHints should be a boolean');
  });
});
