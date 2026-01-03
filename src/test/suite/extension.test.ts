import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Integration Tests', () => {
  test('Extension should be present', () => {
    assert.ok(
      vscode.extensions.getExtension('beeemt.vscode-helm-values'),
      'Extension should be installed'
    );
  });

  test('Commands should be registered', async () => {
    const commands = await vscode.commands.getCommands(true);

    assert.ok(
      commands.includes('helmValues.selectValuesFile'),
      'selectValuesFile command should be registered'
    );
    assert.ok(
      commands.includes('helmValues.clearValuesFile'),
      'clearValuesFile command should be registered'
    );
    assert.ok(
      commands.includes('helmValues.goToValueDefinition'),
      'goToValueDefinition command should be registered'
    );
  });

  test('Configuration should be available', () => {
    const config = vscode.workspace.getConfiguration('helmValues');

    assert.ok(config.has('enableInlayHints'), 'enableInlayHints config should exist');
    assert.ok(config.has('inlayHintMaxLength'), 'inlayHintMaxLength config should exist');
  });
});
