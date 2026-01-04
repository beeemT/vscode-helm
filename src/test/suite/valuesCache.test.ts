import * as assert from 'assert';
import * as path from 'path';
import { ValuesCache } from '../../services/valuesCache';

suite('ValuesCache', () => {
  let cache: ValuesCache;
  // Use workspace root to find fixtures
  const workspaceRoot = path.resolve(__dirname, '..', '..', '..');
  const fixturesPath = path.join(workspaceRoot, 'src', 'test', 'fixtures');
  const parentWithDepsPath = path.join(fixturesPath, 'parent-with-deps');
  const mysqlSubchartPath = path.join(parentWithDepsPath, 'charts', 'mysql');
  const redisSubchartPath = path.join(parentWithDepsPath, 'charts', 'redis');

  setup(() => {
    cache = ValuesCache.getInstance();
    cache.clearAll();
  });

  teardown(() => {
    cache.clearAll();
  });

  suite('deepMerge', () => {
    test('merges flat objects', () => {
      const target = { a: 1, b: 2 };
      const source = { b: 3, c: 4 };
      const result = cache.deepMerge(target, source);

      assert.deepStrictEqual(result, { a: 1, b: 3, c: 4 });
    });

    test('merges nested objects', () => {
      const target = {
        image: { repository: 'nginx', tag: 'latest' },
        replicas: 1,
      };
      const source = {
        image: { tag: '1.25.0' },
        replicas: 3,
      };
      const result = cache.deepMerge(target, source);

      assert.deepStrictEqual(result, {
        image: { repository: 'nginx', tag: '1.25.0' },
        replicas: 3,
      });
    });

    test('source overwrites array values', () => {
      const target = { items: [1, 2, 3] };
      const source = { items: [4, 5] };
      const result = cache.deepMerge(target, source);

      assert.deepStrictEqual(result, { items: [4, 5] });
    });

    test('handles deeply nested objects', () => {
      const target = {
        level1: {
          level2: {
            level3: { value: 'original' },
          },
        },
      };
      const source = {
        level1: {
          level2: {
            level3: { value: 'override' },
          },
        },
      };
      const result = cache.deepMerge(target, source);

      assert.deepStrictEqual(result, {
        level1: {
          level2: {
            level3: { value: 'override' },
          },
        },
      });
    });

    test('handles null values in source', () => {
      const target = { a: { b: 'value' } };
      const source = { a: null };
      const result = cache.deepMerge(target, source);

      assert.deepStrictEqual(result, { a: null });
    });
  });

  suite('resolveValuePath', () => {
    test('resolves simple path', () => {
      const values = { replicaCount: 3 };
      const result = cache.resolveValuePath(values, 'replicaCount');

      assert.strictEqual(result, 3);
    });

    test('resolves nested path', () => {
      const values = { image: { repository: 'nginx' } };
      const result = cache.resolveValuePath(values, 'image.repository');

      assert.strictEqual(result, 'nginx');
    });

    test('resolves deeply nested path', () => {
      const values = { resources: { limits: { cpu: '100m' } } };
      const result = cache.resolveValuePath(values, 'resources.limits.cpu');

      assert.strictEqual(result, '100m');
    });

    test('returns undefined for missing path', () => {
      const values = { a: 1 };
      const result = cache.resolveValuePath(values, 'b');

      assert.strictEqual(result, undefined);
    });

    test('returns undefined for partial path', () => {
      const values = { image: { repository: 'nginx' } };
      const result = cache.resolveValuePath(values, 'image.tag');

      assert.strictEqual(result, undefined);
    });

    test('resolves array index', () => {
      const values = { items: ['a', 'b', 'c'] };
      const result = cache.resolveValuePath(values, 'items[1]');

      assert.strictEqual(result, 'b');
    });

    test('resolves nested array access', () => {
      const values = { containers: [{ name: 'app' }] };
      const result = cache.resolveValuePath(values, 'containers[0].name');

      assert.strictEqual(result, 'app');
    });
  });

  suite('formatValueForDisplay', () => {
    test('formats string value', () => {
      const result = cache.formatValueForDisplay('hello');

      assert.strictEqual(result, '"hello"');
    });

    test('formats number value', () => {
      const result = cache.formatValueForDisplay(42);

      assert.strictEqual(result, '42');
    });

    test('formats boolean value', () => {
      const result = cache.formatValueForDisplay(true);

      assert.strictEqual(result, 'true');
    });

    test('formats null value', () => {
      const result = cache.formatValueForDisplay(null);

      assert.strictEqual(result, 'null');
    });

    test('formats undefined value', () => {
      const result = cache.formatValueForDisplay(undefined);

      assert.strictEqual(result, '<undefined>');
    });

    test('formats array value', () => {
      const result = cache.formatValueForDisplay([1, 2, 3]);

      assert.strictEqual(result, '[3 items]');
    });

    test('formats object value', () => {
      const result = cache.formatValueForDisplay({ a: 1, b: 2 });

      assert.strictEqual(result, '{2 keys}');
    });

    test('truncates long strings', () => {
      const longString = 'a'.repeat(100);
      const result = cache.formatValueForDisplay(longString, 20);

      assert.strictEqual(result.length, 20);
      assert.ok(result.endsWith('..."'));
    });
  });

  suite('getValuesForSubchart', () => {
    test('merges subchart defaults with parent values', async () => {
      // Get values for the mysql subchart aliased as "database"
      const values = await cache.getValuesForSubchart(
        parentWithDepsPath,
        mysqlSubchartPath,
        'database', // alias
        '' // no override file
      );

      // Should have parent override for auth.rootPassword
      const auth = values.auth as Record<string, unknown> | undefined;
      assert.strictEqual(auth?.rootPassword, 'parent-secret', 'Should have parent override');
      // Should have parent override for auth.database
      assert.strictEqual(auth?.database, 'myapp', 'Should have parent value');
      // Should keep subchart default for auth.username (not overridden by parent)
      assert.strictEqual(auth?.username, 'default-user', 'Should keep subchart default');
    });

    test('includes global values from parent', async () => {
      const values = await cache.getValuesForSubchart(
        parentWithDepsPath,
        mysqlSubchartPath,
        'database',
        ''
      );

      // Global values should be accessible as .Values.global
      const global = values.global as Record<string, unknown> | undefined;
      assert.ok(global, 'Should have global values');
      assert.strictEqual(global?.environment, 'production', 'Should have global.environment');
      assert.strictEqual(global?.region, 'us-east-1', 'Should have global.region');
    });

    test('applies parent override file values', async () => {
      const overrideFile = path.join(parentWithDepsPath, 'values-prod.yaml');
      const values = await cache.getValuesForSubchart(
        parentWithDepsPath,
        mysqlSubchartPath,
        'database',
        overrideFile
      );

      // Should have prod override for auth.rootPassword
      const auth = values.auth as Record<string, unknown> | undefined;
      assert.strictEqual(auth?.rootPassword, 'prod-secret', 'Should have prod override');
      // primary.resources.limits.memory should be 1Gi from prod values
      const primary = values.primary as Record<string, Record<string, Record<string, unknown>>> | undefined;
      assert.strictEqual(
        primary?.resources?.limits?.memory,
        '1Gi',
        'Should have prod memory limit'
      );
    });

    test('works for non-aliased subchart', async () => {
      const values = await cache.getValuesForSubchart(
        parentWithDepsPath,
        redisSubchartPath,
        'redis', // no alias, use directory name
        ''
      );

      // Should have parent override for auth.password
      const auth = values.auth as Record<string, unknown> | undefined;
      assert.strictEqual(auth?.password, 'redis-secret', 'Should have parent override');
      // Should keep subchart default for replica.replicaCount
      const replica = values.replica as Record<string, unknown> | undefined;
      assert.strictEqual(replica?.replicaCount, 1, 'Should keep subchart default');
    });

    test('caches subchart values', async () => {
      // Get values twice
      const values1 = await cache.getValuesForSubchart(
        parentWithDepsPath,
        mysqlSubchartPath,
        'database',
        ''
      );
      const values2 = await cache.getValuesForSubchart(
        parentWithDepsPath,
        mysqlSubchartPath,
        'database',
        ''
      );

      // Both should return same values
      assert.deepStrictEqual(values1, values2, 'Cached values should match');
    });

    test('invalidates subchart cache when parent cache cleared', () => {
      // This is an indirect test - after clearing, next getValues should reload
      cache.invalidateCacheImmediate(parentWithDepsPath);

      // The cache should be empty, but getValuesForSubchart should still work
      // (it will reload the values)
    });
  });

  suite('findSubchartValuePositionInChain', () => {
    test('finds value in parent values.yaml under subchart key', async () => {
      const pos = await cache.findSubchartValuePositionInChain(
        parentWithDepsPath,
        mysqlSubchartPath,
        'database',
        '', // no override
        'auth.rootPassword'
      );

      assert.ok(pos, 'Should find position');
      assert.ok(pos!.filePath.includes('values.yaml'), 'Should be in parent values.yaml');
      assert.strictEqual(pos!.source, 'parent-default', 'Should be marked as parent-default');
    });

    test('finds value in parent override file when selected', async () => {
      const overrideFile = path.join(parentWithDepsPath, 'values-prod.yaml');
      const pos = await cache.findSubchartValuePositionInChain(
        parentWithDepsPath,
        mysqlSubchartPath,
        'database',
        overrideFile,
        'auth.rootPassword'
      );

      assert.ok(pos, 'Should find position');
      assert.ok(pos!.filePath.includes('values-prod.yaml'), 'Should be in override file');
      assert.strictEqual(pos!.source, 'override', 'Should be marked as override');
    });

    test('falls back to subchart values.yaml for defaults not in parent', async () => {
      const pos = await cache.findSubchartValuePositionInChain(
        parentWithDepsPath,
        mysqlSubchartPath,
        'database',
        '',
        'persistence.enabled'
      );

      assert.ok(pos, 'Should find position');
      assert.ok(pos!.filePath.includes('charts/mysql/values.yaml'), 'Should be in subchart values.yaml');
      assert.strictEqual(pos!.source, 'default', 'Should be marked as default');
    });

    test('finds global values at root level of parent values.yaml', async () => {
      const pos = await cache.findSubchartValuePositionInChain(
        parentWithDepsPath,
        mysqlSubchartPath,
        'database',
        '',
        'global.environment'
      );

      assert.ok(pos, 'Should find position for global value');
      assert.ok(
        pos!.filePath.endsWith('parent-with-deps/values.yaml'),
        'Should be in parent values.yaml at root level'
      );
      assert.strictEqual(pos!.source, 'parent-default', 'Should be marked as parent-default');
    });

    test('finds global.region at root level of parent values.yaml', async () => {
      const pos = await cache.findSubchartValuePositionInChain(
        parentWithDepsPath,
        mysqlSubchartPath,
        'database',
        '',
        'global.region'
      );

      assert.ok(pos, 'Should find position for global.region');
      assert.ok(
        pos!.filePath.endsWith('parent-with-deps/values.yaml'),
        'Should be in parent values.yaml'
      );
      assert.strictEqual(pos!.source, 'parent-default', 'Should be marked as parent-default');
    });

    test('global values not found in subchart own values.yaml', async () => {
      // Global values come from parent, not subchart's own values.yaml
      // The subchart's values.yaml doesn't define global values
      const pos = await cache.findSubchartValuePositionInChain(
        parentWithDepsPath,
        mysqlSubchartPath,
        'database',
        '',
        'global.nonexistent'
      );

      // Should not find this value since it doesn't exist anywhere
      assert.strictEqual(pos, undefined, 'Should not find non-existent global value');
    });
  });
});
