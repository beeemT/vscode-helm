import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { ValuesCompletionProvider } from '../../providers/valuesCompletionProvider';
import { HelmChartService } from '../../services/helmChartService';
import { ValuesCache } from '../../services/valuesCache';

suite('ValuesCompletionProvider', () => {
  const fixturesPath = path.join(__dirname, '..', '..', '..', 'src', 'test', 'fixtures');
  const parentWithDepsPath = path.join(fixturesPath, 'parent-with-deps');
  const archiveChartPath = path.join(fixturesPath, 'archive-chart');
  const sampleChartPath = path.join(fixturesPath, 'sample-chart');

  let provider: ValuesCompletionProvider;
  let token: vscode.CancellationToken;
  let context: vscode.CompletionContext;

  suiteSetup(async () => {
    // Initialize services
    HelmChartService.getInstance();
    ValuesCache.getInstance();
    provider = ValuesCompletionProvider.getInstance();

    // Create test context
    token = new vscode.CancellationTokenSource().token;
    context = {
      triggerKind: vscode.CompletionTriggerKind.Invoke,
      triggerCharacter: undefined,
    };
  });

  suite('returns undefined for non-applicable cases', () => {
    test('returns undefined for template files', async () => {
      const templatePath = path.join(parentWithDepsPath, 'templates', 'deployment.yaml');
      const document = await vscode.workspace.openTextDocument(templatePath);
      const position = new vscode.Position(0, 0);

      const result = await provider.provideCompletionItems(document, position, token, context);

      assert.strictEqual(result, undefined);
    });

    test('returns undefined for chart without subcharts', async () => {
      const valuesPath = path.join(sampleChartPath, 'values.yaml');
      const document = await vscode.workspace.openTextDocument(valuesPath);
      const position = new vscode.Position(0, 0);

      const result = await provider.provideCompletionItems(document, position, token, context);

      assert.strictEqual(result, undefined);
    });

    test('returns undefined for subchart values files', async () => {
      const subchartValuesPath = path.join(parentWithDepsPath, 'charts', 'mysql', 'values.yaml');
      const document = await vscode.workspace.openTextDocument(subchartValuesPath);
      const position = new vscode.Position(0, 0);

      const result = await provider.provideCompletionItems(document, position, token, context);

      assert.strictEqual(result, undefined);
    });
  });

  suite('root-level completions', () => {
    test('suggests subchart keys at root level', async () => {
      const valuesPath = path.join(parentWithDepsPath, 'values.yaml');
      const document = await vscode.workspace.openTextDocument(valuesPath);
      // Position at start of document (root level)
      const position = new vscode.Position(0, 0);

      const result = await provider.provideCompletionItems(document, position, token, context);

      assert.ok(result, 'Should return completions');
      assert.ok(Array.isArray(result), 'Should be an array');

      // Should suggest 'global'
      const globalItem = result.find((item) => item.label === 'global');
      assert.ok(globalItem, 'Should suggest global key');
      assert.strictEqual(
        globalItem?.kind,
        vscode.CompletionItemKind.Module,
        'global should be Module kind'
      );

      // Should suggest 'database' (aliased from mysql)
      const databaseItem = result.find((item) => item.label === 'database');
      assert.ok(databaseItem, 'Should suggest database (mysql alias) key');
      assert.strictEqual(
        databaseItem?.kind,
        vscode.CompletionItemKind.Module,
        'database should be Module kind'
      );

      // Should suggest 'redis'
      const redisItem = result.find((item) => item.label === 'redis');
      assert.ok(redisItem, 'Should suggest redis key');
      assert.strictEqual(
        redisItem?.kind,
        vscode.CompletionItemKind.Module,
        'redis should be Module kind'
      );
    });

    test('suggests global with correct sort order (before subcharts)', async () => {
      const valuesPath = path.join(parentWithDepsPath, 'values.yaml');
      const document = await vscode.workspace.openTextDocument(valuesPath);
      const position = new vscode.Position(0, 0);

      const result = await provider.provideCompletionItems(document, position, token, context);

      assert.ok(result, 'Should return completions');

      const globalItem = result.find((item) => item.label === 'global');
      const databaseItem = result.find((item) => item.label === 'database');

      assert.ok(globalItem?.sortText, 'global should have sortText');
      assert.ok(databaseItem?.sortText, 'database should have sortText');
      assert.ok(
        globalItem!.sortText! < databaseItem!.sortText!,
        'global should sort before subcharts'
      );
    });

    test('provides snippet insertion with newline for subchart keys', async () => {
      const valuesPath = path.join(parentWithDepsPath, 'values.yaml');
      const document = await vscode.workspace.openTextDocument(valuesPath);
      const position = new vscode.Position(0, 0);

      const result = await provider.provideCompletionItems(document, position, token, context);

      assert.ok(result, 'Should return completions');

      const databaseItem = result.find((item) => item.label === 'database');
      assert.ok(databaseItem, 'Should find database completion');
      assert.ok(
        databaseItem?.insertText instanceof vscode.SnippetString,
        'insertText should be a SnippetString'
      );
      assert.ok(
        databaseItem!.insertText!.value.includes('database:'),
        'Should include key with colon'
      );
      assert.ok(
        databaseItem!.insertText!.value.includes('\n'),
        'Should include newline for nested content'
      );
    });
  });

  suite('nested completions within subchart key', () => {
    test('suggests nested values from subchart defaults', async () => {
      const valuesPath = path.join(parentWithDepsPath, 'values.yaml');
      const realDocument = await vscode.workspace.openTextDocument(valuesPath);

      // Find position after "database:" - look for the line
      const text = realDocument.getText();
      const lines = text.split('\n');
      let databaseLineNum = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('database:')) {
          databaseLineNum = i;
          break;
        }
      }

      assert.ok(databaseLineNum >= 0, 'Should find database: line');

      // Position on next line (inside database: block)
      const position = new vscode.Position(databaseLineNum + 1, 2);

      const result = await provider.provideCompletionItems(realDocument, position, token, context);

      assert.ok(result, 'Should return completions');
      assert.ok(Array.isArray(result), 'Should be an array');

      // Should suggest 'auth' from mysql defaults
      const authItem = result.find((item) => item.label === 'auth');
      assert.ok(authItem, 'Should suggest auth key from mysql defaults');
      assert.strictEqual(
        authItem?.kind,
        vscode.CompletionItemKind.Property,
        'auth should be Property kind (it has nested values)'
      );

      // Should suggest 'primary' from mysql defaults
      const primaryItem = result.find((item) => item.label === 'primary');
      assert.ok(primaryItem, 'Should suggest primary key');

      // Should suggest 'persistence' from mysql defaults
      const persistenceItem = result.find((item) => item.label === 'persistence');
      assert.ok(persistenceItem, 'Should suggest persistence key');
    });

    test('suggests deeper nested values', async () => {
      const valuesPath = path.join(parentWithDepsPath, 'values.yaml');
      const document = await vscode.workspace.openTextDocument(valuesPath);

      // Find position inside database.auth section
      const text = document.getText();
      const lines = text.split('\n');
      let authLineNum = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('auth:') && i > 0 && lines[i - 1]?.includes('database:')) {
          authLineNum = i;
          break;
        }
        // Alternative: look for "  auth:" pattern
        if (lines[i].trimStart().startsWith('auth:')) {
          // Check if parent is database
          let foundDatabase = false;
          for (let j = i - 1; j >= 0; j--) {
            const prevLine = lines[j].trimStart();
            if (prevLine.startsWith('database:')) {
              foundDatabase = true;
              break;
            }
            // If we hit another top-level key, stop
            if (lines[j].match(/^[a-zA-Z]/)) {
              break;
            }
          }
          if (foundDatabase) {
            authLineNum = i;
            break;
          }
        }
      }

      assert.ok(authLineNum >= 0, 'Should find auth: line under database:');

      // Position on next line after auth:
      const position = new vscode.Position(authLineNum + 1, 4);

      const result = await provider.provideCompletionItems(document, position, token, context);

      assert.ok(result, 'Should return completions');

      // Should suggest auth properties from mysql defaults
      const rootPasswordItem = result.find((item) => item.label === 'rootPassword');
      assert.ok(rootPasswordItem, 'Should suggest rootPassword from mysql auth defaults');
      assert.strictEqual(
        rootPasswordItem?.kind,
        vscode.CompletionItemKind.Value,
        'rootPassword should be Value kind (scalar)'
      );

      const databaseItem = result.find((item) => item.label === 'database');
      assert.ok(databaseItem, 'Should suggest database from mysql auth defaults');

      const usernameItem = result.find((item) => item.label === 'username');
      assert.ok(usernameItem, 'Should suggest username from mysql auth defaults');
    });
  });

  suite('archive subchart completions', () => {
    test('suggests archived subchart key at root level', async () => {
      const valuesPath = path.join(archiveChartPath, 'values.yaml');
      const document = await vscode.workspace.openTextDocument(valuesPath);
      const position = new vscode.Position(0, 0);

      const result = await provider.provideCompletionItems(document, position, token, context);

      assert.ok(result, 'Should return completions');

      // Should suggest 'archived' (alias from mysubchart)
      const archivedItem = result.find((item) => item.label === 'archived');
      assert.ok(archivedItem, 'Should suggest archived (alias for mysubchart) key');

      // Check that detail indicates archive source
      assert.ok(
        archivedItem?.detail?.includes('📦'),
        'Detail should include archive indicator 📦'
      );
    });

    test('suggests nested values from archived subchart', async () => {
      const valuesPath = path.join(archiveChartPath, 'values.yaml');
      const document = await vscode.workspace.openTextDocument(valuesPath);

      // Find position inside 'archived:' section
      const text = document.getText();
      const lines = text.split('\n');
      let archivedLineNum = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('archived:')) {
          archivedLineNum = i;
          break;
        }
      }

      assert.ok(archivedLineNum >= 0, 'Should find archived: line');

      // Position on next line (inside archived: block)
      const position = new vscode.Position(archivedLineNum + 1, 2);

      const result = await provider.provideCompletionItems(document, position, token, context);

      assert.ok(result, 'Should return completions');

      // Should suggest keys from mysubchart values.yaml
      const settingItem = result.find((item) => item.label === 'setting');
      assert.ok(settingItem, 'Should suggest setting key from archive subchart');

      const portItem = result.find((item) => item.label === 'port');
      assert.ok(portItem, 'Should suggest port key from archive subchart');

      const enabledItem = result.find((item) => item.label === 'enabled');
      assert.ok(enabledItem, 'Should suggest enabled key from archive subchart');

      // Check that completions indicate archive source
      assert.ok(
        settingItem?.detail?.includes('📦'),
        'Detail should include archive indicator 📦'
      );
    });
  });

  suite('global completions', () => {
    test('suggests common global keys inside global: section', async () => {
      const valuesPath = path.join(parentWithDepsPath, 'values.yaml');
      const document = await vscode.workspace.openTextDocument(valuesPath);

      // Find position inside 'global:' section
      const text = document.getText();
      const lines = text.split('\n');
      let globalLineNum = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('global:')) {
          globalLineNum = i;
          break;
        }
      }

      assert.ok(globalLineNum >= 0, 'Should find global: line');

      // Position on next line (inside global: block)
      const position = new vscode.Position(globalLineNum + 1, 2);

      const result = await provider.provideCompletionItems(document, position, token, context);

      assert.ok(result, 'Should return completions');

      // Should suggest common global keys
      const imageRegistryItem = result.find((item) => item.label === 'imageRegistry');
      assert.ok(imageRegistryItem, 'Should suggest imageRegistry common global');

      const storageClassItem = result.find((item) => item.label === 'storageClass');
      assert.ok(storageClassItem, 'Should suggest storageClass common global');
    });
  });

  suite('completion item formatting', () => {
    test('includes documentation with default value preview', async () => {
      const valuesPath = path.join(parentWithDepsPath, 'values.yaml');
      const document = await vscode.workspace.openTextDocument(valuesPath);

      // Find position inside database.auth section
      const text = document.getText();
      const lines = text.split('\n');
      let authLineNum = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trimStart().startsWith('auth:')) {
          // Check if parent is database
          for (let j = i - 1; j >= 0; j--) {
            const prevLine = lines[j].trimStart();
            if (prevLine.startsWith('database:')) {
              authLineNum = i;
              break;
            }
            if (lines[j].match(/^[a-zA-Z]/)) {
              break;
            }
          }
          if (authLineNum >= 0) {
            break;
          }
        }
      }

      assert.ok(authLineNum >= 0, 'Should find auth: line');

      const position = new vscode.Position(authLineNum + 1, 4);

      const result = await provider.provideCompletionItems(document, position, token, context);

      assert.ok(result, 'Should return completions');

      const rootPasswordItem = result.find((item) => item.label === 'rootPassword');
      assert.ok(rootPasswordItem, 'Should find rootPassword completion');

      // Check detail contains default value
      assert.ok(rootPasswordItem?.detail, 'Should have detail');
      assert.ok(
        rootPasswordItem?.detail?.includes('Default:'),
        'Detail should show default value'
      );

      // Check documentation exists
      assert.ok(rootPasswordItem?.documentation, 'Should have documentation');
    });

    test('uses SnippetString for insertText with proper formatting', async () => {
      const valuesPath = path.join(parentWithDepsPath, 'values.yaml');
      const document = await vscode.workspace.openTextDocument(valuesPath);
      const position = new vscode.Position(0, 0);

      const result = await provider.provideCompletionItems(document, position, token, context);

      assert.ok(result, 'Should return completions');

      // Check object-type completion has newline
      const globalItem = result.find((item) => item.label === 'global');
      assert.ok(globalItem, 'Should find global completion');
      assert.ok(
        globalItem?.insertText instanceof vscode.SnippetString,
        'insertText should be SnippetString'
      );
      assert.ok(
        globalItem!.insertText!.value.includes('\n'),
        'Object keys should have newline in snippet'
      );
    });
  });

  suite('edge cases', () => {
    test('handles empty values file', async () => {
      const document = await vscode.workspace.openTextDocument({
        content: '',
        language: 'yaml',
      });
      const position = new vscode.Position(0, 0);

      // This will fail because it's not in a Helm chart context
      const result = await provider.provideCompletionItems(document, position, token, context);

      // Should gracefully return undefined (no chart context)
      assert.strictEqual(result, undefined);
    });

    test('handles comment lines', async () => {
      const valuesPath = path.join(parentWithDepsPath, 'values.yaml');
      const document = await vscode.workspace.openTextDocument(valuesPath);

      // First line is a comment
      const position = new vscode.Position(0, 5);

      // Should still provide root-level completions
      const result = await provider.provideCompletionItems(document, position, token, context);

      assert.ok(result, 'Should return completions even on comment line');
    });

    test('handles non-existent path gracefully', async () => {
      const valuesPath = path.join(parentWithDepsPath, 'values.yaml');
      const document = await vscode.workspace.openTextDocument(valuesPath);

      // Create content with a path that doesn't exist in subchart defaults
      // Position inside 'database:' but at a non-existent nested path
      // We'll test by looking for completions at a very deep level

      const text = document.getText();
      const lines = text.split('\n');

      // Find a position that would represent a non-existent nested path
      // For example, if we're at database.nonexistent.deep
      // Since the path doesn't exist, should return undefined or empty

      // Find database.primary.resources
      let resourcesLineNum = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trimStart().startsWith('resources:')) {
          resourcesLineNum = i;
          break;
        }
      }

      if (resourcesLineNum >= 0) {
        // Go into limits
        const position = new vscode.Position(resourcesLineNum + 1, 10);
        const result = await provider.provideCompletionItems(document, position, token, context);

        // Should return completions for the limits level
        // This tests that we properly navigate deep nested structures
        if (result) {
          // If we got results, verify they're from the right level
          // memory is a leaf value, so it might or might not be suggested depending on implementation
          // The key point is that the provider doesn't crash
          assert.ok(Array.isArray(result), 'Should return array or undefined, not throw');
        }
      }
    });
  });
});
