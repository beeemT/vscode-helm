import * as assert from 'assert';
import * as path from 'path';
import { ArchiveReader } from '../../services/archiveReader';
import { TemplateParser } from '../../services/templateParser';
import { ValuesCache } from '../../services/valuesCache';
import { ArchiveDocumentProvider } from '../../providers/archiveDocumentProvider';

suite('Archive Introspection', () => {
  const workspaceRoot = path.resolve(__dirname, '..', '..', '..');
  const fixturesPath = path.join(workspaceRoot, 'src', 'test', 'fixtures');
  const archivePath = path.join(fixturesPath, 'archive-chart', 'charts', 'mysubchart-1.0.0.tgz');

  setup(() => {
    ArchiveReader.getInstance().clearCache();
  });

  suite('ArchiveReader.listTemplateFiles', () => {
    test('lists template files in archive', async () => {
      const reader = ArchiveReader.getInstance();
      const templates = await reader.listTemplateFiles(archivePath);

      assert.ok(templates.length > 0, 'Should find template files');
      assert.ok(
        templates.includes('templates/deployment.yaml'),
        'Should include templates/deployment.yaml'
      );
    });

    test('only returns files in templates/ directory', async () => {
      const reader = ArchiveReader.getInstance();
      const templates = await reader.listTemplateFiles(archivePath);

      for (const file of templates) {
        assert.ok(file.startsWith('templates/'), `File ${file} should start with templates/`);
      }
    });

    test('only returns yaml/yml/tpl files', async () => {
      const reader = ArchiveReader.getInstance();
      const templates = await reader.listTemplateFiles(archivePath);

      for (const file of templates) {
        assert.ok(
          file.endsWith('.yaml') || file.endsWith('.yml') || file.endsWith('.tpl'),
          `File ${file} should be a template file`
        );
      }
    });
  });

  suite('Template reference parsing in archive content', () => {
    test('parses .Values references from archive template', async () => {
      const reader = ArchiveReader.getInstance();
      const content = await reader.readFileFromArchive(archivePath, 'templates/deployment.yaml');

      assert.ok(content, 'Should read template content');

      const parser = TemplateParser.getInstance();
      const references = parser.parseTemplateReferences(content!);

      // Filter for .Values references
      const valuesRefs = references.filter((ref) => ref.objectType === 'Values');

      assert.ok(valuesRefs.length > 0, 'Should find .Values references');

      // Should find references to setting, port, enabled, global.environment
      const paths = valuesRefs.map((ref) => ref.path);
      assert.ok(paths.includes('setting'), 'Should find .Values.setting');
      assert.ok(paths.includes('port'), 'Should find .Values.port');
      assert.ok(paths.includes('enabled'), 'Should find .Values.enabled');
      assert.ok(paths.includes('global.environment'), 'Should find .Values.global.environment');
    });

    test('returns correct positions for archive references', async () => {
      const reader = ArchiveReader.getInstance();
      const content = await reader.readFileFromArchive(archivePath, 'templates/deployment.yaml');

      assert.ok(content, 'Should read template content');

      const parser = TemplateParser.getInstance();
      const references = parser.parseTemplateReferences(content!);

      // Each reference should have valid offsets
      for (const ref of references) {
        assert.ok(ref.startOffset >= 0, 'Start offset should be non-negative');
        assert.ok(ref.endOffset > ref.startOffset, 'End offset should be greater than start');
        assert.ok(ref.endOffset <= content!.length, 'End offset should not exceed content length');
      }
    });
  });

  suite('Archive URI creation for references', () => {
    test('creates valid URIs for archive template locations', async () => {
      const reader = ArchiveReader.getInstance();
      const content = await reader.readFileFromArchive(archivePath, 'templates/deployment.yaml');

      assert.ok(content, 'Should read template content');

      const parser = TemplateParser.getInstance();
      const references = parser.parseTemplateReferences(content!);
      const settingRef = references.find(
        (ref) => ref.objectType === 'Values' && ref.path === 'setting'
      );

      assert.ok(settingRef, 'Should find .Values.setting reference');

      const position = parser.getPositionFromOffset(content!, settingRef!.startOffset);
      const uri = ArchiveDocumentProvider.createUri(archivePath, 'templates/deployment.yaml');
      const parsed = ArchiveDocumentProvider.parseUri(uri);

      assert.ok(parsed, 'Should parse URI');
      assert.strictEqual(parsed!.archivePath, archivePath);
      assert.strictEqual(parsed!.internalPath, 'templates/deployment.yaml');
      assert.ok(position.line >= 0, 'Line should be non-negative');
      assert.ok(position.character >= 0, 'Character should be non-negative');
    });
  });

  suite('ValuesCache.findValuePositionInArchive', () => {
    let cache: ValuesCache;

    setup(() => {
      cache = ValuesCache.getInstance();
    });

    test('finds top-level value position in archive', async () => {
      const position = await cache.findValuePositionInArchive(archivePath, 'setting', 'default');

      assert.ok(position, 'Should find position for "setting"');
      assert.strictEqual(position!.isFromArchive, true);
      assert.strictEqual(position!.archivePath, archivePath);
      assert.strictEqual(position!.internalPath, 'values.yaml');
      assert.strictEqual(position!.source, 'default');
      assert.ok(position!.line >= 0, 'Line should be non-negative');
    });

    test('finds position for port value', async () => {
      const position = await cache.findValuePositionInArchive(archivePath, 'port', 'default');

      assert.ok(position, 'Should find position for "port"');
      assert.strictEqual(position!.isFromArchive, true);
      assert.strictEqual(position!.archivePath, archivePath);
      assert.strictEqual(position!.internalPath, 'values.yaml');
    });

    test('finds position for enabled value', async () => {
      const position = await cache.findValuePositionInArchive(archivePath, 'enabled', 'default');

      assert.ok(position, 'Should find position for "enabled"');
      assert.strictEqual(position!.isFromArchive, true);
    });

    test('returns undefined for non-existent value', async () => {
      const position = await cache.findValuePositionInArchive(
        archivePath,
        'nonExistent',
        'default'
      );

      assert.strictEqual(position, undefined);
    });

    test('returns undefined for non-existent archive', async () => {
      const position = await cache.findValuePositionInArchive(
        '/non/existent/archive.tgz',
        'setting',
        'default'
      );

      assert.strictEqual(position, undefined);
    });

    test('sets correct line numbers', async () => {
      // values.yaml content is:
      // setting: "default-from-subchart"
      // port: 8080
      // enabled: true
      const settingPos = await cache.findValuePositionInArchive(archivePath, 'setting', 'default');
      const portPos = await cache.findValuePositionInArchive(archivePath, 'port', 'default');
      const enabledPos = await cache.findValuePositionInArchive(archivePath, 'enabled', 'default');

      assert.ok(settingPos, 'Should find setting');
      assert.ok(portPos, 'Should find port');
      assert.ok(enabledPos, 'Should find enabled');

      // They should be on consecutive lines
      assert.strictEqual(settingPos!.line, 0, 'setting should be on line 0');
      assert.strictEqual(portPos!.line, 1, 'port should be on line 1');
      assert.strictEqual(enabledPos!.line, 2, 'enabled should be on line 2');
    });
  });
});
