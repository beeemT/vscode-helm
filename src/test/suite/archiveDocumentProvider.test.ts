import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { ArchiveDocumentProvider } from '../../providers/archiveDocumentProvider';

suite('ArchiveDocumentProvider', () => {
  suite('createUri', () => {
    test('creates URI with correct scheme', () => {
      const uri = ArchiveDocumentProvider.createUri('/path/to/chart.tgz', 'values.yaml');

      assert.strictEqual(uri.scheme, 'helm-archive');
    });

    test('encodes archive path in authority', () => {
      const archivePath = '/path/to/chart.tgz';
      const uri = ArchiveDocumentProvider.createUri(archivePath, 'values.yaml');

      assert.strictEqual(decodeURIComponent(uri.authority), archivePath);
    });

    test('encodes internal path in query', () => {
      const uri = ArchiveDocumentProvider.createUri(
        '/path/to/chart.tgz',
        'templates/deployment.yaml'
      );
      const params = new URLSearchParams(uri.query);

      assert.strictEqual(params.get('file'), 'templates/deployment.yaml');
    });

    test('handles paths with special characters', () => {
      const archivePath = '/path/to/my chart (1).tgz';
      const internalPath = 'templates/my-deployment.yaml';
      const uri = ArchiveDocumentProvider.createUri(archivePath, internalPath);
      const parsed = ArchiveDocumentProvider.parseUri(uri);

      assert.ok(parsed, 'Should parse URI with special characters');
      assert.strictEqual(parsed!.archivePath, archivePath);
      assert.strictEqual(parsed!.internalPath, internalPath);
    });
  });

  suite('parseUri', () => {
    test('parses valid helm-archive URI', () => {
      const archivePath = '/path/to/chart.tgz';
      const internalPath = 'templates/deployment.yaml';
      const uri = ArchiveDocumentProvider.createUri(archivePath, internalPath);

      const parsed = ArchiveDocumentProvider.parseUri(uri);

      assert.ok(parsed, 'Should parse valid URI');
      assert.strictEqual(parsed!.archivePath, archivePath);
      assert.strictEqual(parsed!.internalPath, internalPath);
    });

    test('returns undefined for non-helm-archive scheme', () => {
      const uri = vscode.Uri.file('/path/to/file.yaml');
      const parsed = ArchiveDocumentProvider.parseUri(uri);

      assert.strictEqual(parsed, undefined);
    });

    test('returns undefined for URI without file parameter', () => {
      const uri = vscode.Uri.parse('helm-archive:///path/to/chart.tgz');
      const parsed = ArchiveDocumentProvider.parseUri(uri);

      assert.strictEqual(parsed, undefined);
    });

    test('roundtrips through create and parse', () => {
      const archivePath = '/home/user/charts/mysubchart-1.0.0.tgz';
      const internalPath = 'values.yaml';

      const uri = ArchiveDocumentProvider.createUri(archivePath, internalPath);
      const parsed = ArchiveDocumentProvider.parseUri(uri);

      assert.ok(parsed);
      assert.strictEqual(parsed!.archivePath, archivePath);
      assert.strictEqual(parsed!.internalPath, internalPath);
    });
  });

  suite('provideTextDocumentContent', () => {
    let provider: ArchiveDocumentProvider;
    const workspaceRoot = path.resolve(__dirname, '..', '..', '..');
    const fixturesPath = path.join(workspaceRoot, 'src', 'test', 'fixtures');
    const archivePath = path.join(fixturesPath, 'archive-chart', 'charts', 'mysubchart-1.0.0.tgz');

    setup(() => {
      provider = ArchiveDocumentProvider.getInstance();
    });

    test('returns content for valid archive file', async () => {
      const uri = ArchiveDocumentProvider.createUri(archivePath, 'values.yaml');
      const content = await provider.provideTextDocumentContent(uri);

      assert.ok(content, 'Should return content');
      assert.ok(content.includes('setting:'), 'Should contain setting key');
      assert.ok(content.includes('port:'), 'Should contain port key');
    });

    test('returns content for template file', async () => {
      const uri = ArchiveDocumentProvider.createUri(archivePath, 'templates/deployment.yaml');
      const content = await provider.provideTextDocumentContent(uri);

      assert.ok(content, 'Should return template content');
      assert.ok(content.includes('.Values.setting'), 'Should contain .Values.setting reference');
      assert.ok(content.includes('.Values.port'), 'Should contain .Values.port reference');
    });

    test('returns empty string for non-existent file in archive', async () => {
      const uri = ArchiveDocumentProvider.createUri(archivePath, 'non-existent.yaml');
      const content = await provider.provideTextDocumentContent(uri);

      assert.strictEqual(content, '');
    });

    test('returns empty string for invalid URI', async () => {
      const uri = vscode.Uri.parse('helm-archive:///invalid');
      const content = await provider.provideTextDocumentContent(uri);

      assert.strictEqual(content, '');
    });
  });
});
