import * as assert from 'assert';
import * as path from 'path';
import { HelmChartContext } from '../../services/helmChartService';
import { ValuesCache } from '../../services/valuesCache';

/**
 * Helper to build a mock HelmChartContext for subchart testing
 */
function buildSubchartContext(
  parentChartRoot: string,
  subchartRoot: string,
  subchartName: string
): HelmChartContext {
  const parentContext: HelmChartContext = {
    chartRoot: parentChartRoot,
    chartYamlPath: path.join(parentChartRoot, 'Chart.yaml'),
    valuesYamlPath: path.join(parentChartRoot, 'values.yaml'),
    valuesOverrideFiles: [],
    isSubchart: false,
    subcharts: [],
  };

  return {
    chartRoot: subchartRoot,
    chartYamlPath: path.join(subchartRoot, 'Chart.yaml'),
    valuesYamlPath: path.join(subchartRoot, 'values.yaml'),
    valuesOverrideFiles: [],
    isSubchart: true,
    subchartName,
    parentChart: parentContext,
    subcharts: [],
  };
}

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
      const subchartContext = buildSubchartContext(
        parentWithDepsPath,
        mysqlSubchartPath,
        'database' // alias
      );
      const values = await cache.getValuesForSubchart(subchartContext, ''); // no override file

      // Should have parent override for auth.rootPassword
      const auth = values.auth as Record<string, unknown> | undefined;
      assert.strictEqual(auth?.rootPassword, 'parent-secret', 'Should have parent override');
      // Should have parent override for auth.database
      assert.strictEqual(auth?.database, 'myapp', 'Should have parent value');
      // Should keep subchart default for auth.username (not overridden by parent)
      assert.strictEqual(auth?.username, 'default-user', 'Should keep subchart default');
    });

    test('includes global values from parent', async () => {
      const subchartContext = buildSubchartContext(
        parentWithDepsPath,
        mysqlSubchartPath,
        'database'
      );
      const values = await cache.getValuesForSubchart(subchartContext, '');

      // Global values should be accessible as .Values.global
      const global = values.global as Record<string, unknown> | undefined;
      assert.ok(global, 'Should have global values');
      assert.strictEqual(global?.environment, 'production', 'Should have global.environment');
      assert.strictEqual(global?.region, 'us-east-1', 'Should have global.region');
    });

    test('applies parent override file values', async () => {
      const overrideFile = path.join(parentWithDepsPath, 'values-prod.yaml');
      const subchartContext = buildSubchartContext(
        parentWithDepsPath,
        mysqlSubchartPath,
        'database'
      );
      const values = await cache.getValuesForSubchart(subchartContext, overrideFile);

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
      const subchartContext = buildSubchartContext(
        parentWithDepsPath,
        redisSubchartPath,
        'redis' // no alias, use directory name
      );
      const values = await cache.getValuesForSubchart(subchartContext, '');

      // Should have parent override for auth.password
      const auth = values.auth as Record<string, unknown> | undefined;
      assert.strictEqual(auth?.password, 'redis-secret', 'Should have parent override');
      // Should keep subchart default for replica.replicaCount
      const replica = values.replica as Record<string, unknown> | undefined;
      assert.strictEqual(replica?.replicaCount, 1, 'Should keep subchart default');
    });

    test('caches subchart values', async () => {
      const subchartContext = buildSubchartContext(
        parentWithDepsPath,
        mysqlSubchartPath,
        'database'
      );
      // Get values twice
      const values1 = await cache.getValuesForSubchart(subchartContext, '');
      const values2 = await cache.getValuesForSubchart(subchartContext, '');

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

  suite('getValuesForSubchart - nested subcharts', () => {
    // Nested subchart fixture paths
    const nestedSubchartsPath = path.join(fixturesPath, 'nested-subcharts');
    const parentSubchartPath = path.join(nestedSubchartsPath, 'charts', 'parent');
    const leafSubchartPath = path.join(parentSubchartPath, 'charts', 'leaf');

    /**
     * Build a nested subchart context (grandparent > parent > leaf)
     */
    function buildNestedSubchartContext(): HelmChartContext {
      const grandparentContext: HelmChartContext = {
        chartRoot: nestedSubchartsPath,
        chartYamlPath: path.join(nestedSubchartsPath, 'Chart.yaml'),
        valuesYamlPath: path.join(nestedSubchartsPath, 'values.yaml'),
        valuesOverrideFiles: [],
        isSubchart: false,
        subcharts: [],
      };

      const parentContext: HelmChartContext = {
        chartRoot: parentSubchartPath,
        chartYamlPath: path.join(parentSubchartPath, 'Chart.yaml'),
        valuesYamlPath: path.join(parentSubchartPath, 'values.yaml'),
        valuesOverrideFiles: [],
        isSubchart: true,
        subchartName: 'parentAlias',
        parentChart: grandparentContext,
        subcharts: [],
      };

      return {
        chartRoot: leafSubchartPath,
        chartYamlPath: path.join(leafSubchartPath, 'Chart.yaml'),
        valuesYamlPath: path.join(leafSubchartPath, 'values.yaml'),
        valuesOverrideFiles: [],
        isSubchart: true,
        subchartName: 'leafAlias',
        parentChart: parentContext,
        subcharts: [],
      };
    }

    test('resolves values from grandparent for nested subchart', async () => {
      const leafContext = buildNestedSubchartContext();
      const values = await cache.getValuesForSubchart(leafContext, '');

      // Values should come from grandparent's values.yaml under parentAlias.leafAlias
      assert.strictEqual(values.name, 'leaf-from-grandparent', 'Should get name from grandparent');
      const config = values.config as Record<string, unknown> | undefined;
      assert.strictEqual(config?.setting, 'grandparent-override', 'Should get config.setting from grandparent');
      assert.strictEqual(config?.timeout, 60, 'Should get config.timeout from grandparent');
    });

    test('nested subchart inherits global values from root', async () => {
      const leafContext = buildNestedSubchartContext();
      const values = await cache.getValuesForSubchart(leafContext, '');

      // Global values should be accessible from the root chart
      const global = values.global as Record<string, unknown> | undefined;
      assert.ok(global, 'Should have global values');
      assert.strictEqual(global?.environment, 'production', 'Should have global.environment');
      assert.strictEqual(global?.region, 'us-east-1', 'Should have global.region');
      assert.strictEqual(global?.logLevel, 'info', 'Should have global.logLevel');
    });

    test('nested subchart falls back to own defaults when not overridden', async () => {
      const leafContext = buildNestedSubchartContext();
      const values = await cache.getValuesForSubchart(leafContext, '');

      // replicaCount is not defined in grandparent's parentAlias.leafAlias section
      // so it should fall back to leaf's own default
      assert.strictEqual(values.replicaCount, 1, 'Should fall back to leaf default');
      const resources = values.resources as Record<string, Record<string, unknown>> | undefined;
      assert.ok(resources?.limits, 'Should have resources.limits from leaf default');
    });

    test('nested subchart applies override file from root', async () => {
      const leafContext = buildNestedSubchartContext();
      const overrideFile = path.join(nestedSubchartsPath, 'values-prod.yaml');
      const values = await cache.getValuesForSubchart(leafContext, overrideFile);

      // Override file should override grandparent defaults
      assert.strictEqual(values.name, 'leaf-prod', 'Should get name from prod override');
      const config = values.config as Record<string, unknown> | undefined;
      assert.strictEqual(config?.setting, 'prod-override', 'Should get config.setting from prod override');
      assert.strictEqual(config?.timeout, 120, 'Should get config.timeout from prod override');
      assert.strictEqual(config?.maxRetries, 5, 'Should get config.maxRetries from prod override');
    });

    test('nested subchart override applies global values from override', async () => {
      const leafContext = buildNestedSubchartContext();
      const overrideFile = path.join(nestedSubchartsPath, 'values-prod.yaml');
      const values = await cache.getValuesForSubchart(leafContext, overrideFile);

      // Global values from override file should override root defaults
      const global = values.global as Record<string, unknown> | undefined;
      assert.strictEqual(global?.logLevel, 'warn', 'Should have global.logLevel from prod override');
      assert.strictEqual(global?.environment, 'production', 'Should have global.environment from prod');
    });
  });

  suite('findSubchartValuePositionInChainNested', () => {
    // Nested subchart fixture paths
    const nestedSubchartsPath = path.join(fixturesPath, 'nested-subcharts');
    const parentSubchartPath = path.join(nestedSubchartsPath, 'charts', 'parent');
    const leafSubchartPath = path.join(parentSubchartPath, 'charts', 'leaf');

    /**
     * Build a nested subchart context (grandparent > parent > leaf)
     */
    function buildNestedSubchartContext(): HelmChartContext {
      const grandparentContext: HelmChartContext = {
        chartRoot: nestedSubchartsPath,
        chartYamlPath: path.join(nestedSubchartsPath, 'Chart.yaml'),
        valuesYamlPath: path.join(nestedSubchartsPath, 'values.yaml'),
        valuesOverrideFiles: [],
        isSubchart: false,
        subcharts: [],
      };

      const parentContext: HelmChartContext = {
        chartRoot: parentSubchartPath,
        chartYamlPath: path.join(parentSubchartPath, 'Chart.yaml'),
        valuesYamlPath: path.join(parentSubchartPath, 'values.yaml'),
        valuesOverrideFiles: [],
        isSubchart: true,
        subchartName: 'parentAlias',
        parentChart: grandparentContext,
        subcharts: [],
      };

      return {
        chartRoot: leafSubchartPath,
        chartYamlPath: path.join(leafSubchartPath, 'Chart.yaml'),
        valuesYamlPath: path.join(leafSubchartPath, 'values.yaml'),
        valuesOverrideFiles: [],
        isSubchart: true,
        subchartName: 'leafAlias',
        parentChart: parentContext,
        subcharts: [],
      };
    }

    test('finds value in root values.yaml under nested path', async () => {
      const leafContext = buildNestedSubchartContext();
      const pos = await cache.findSubchartValuePositionInChainNested(
        leafContext,
        '', // no override
        'name'
      );

      assert.ok(pos, 'Should find position');
      assert.ok(pos!.filePath.endsWith('nested-subcharts/values.yaml'), 'Should be in root values.yaml');
      // Note: it's found at parentAlias.leafAlias.name level
    });

    test('finds value in root override file when selected', async () => {
      const leafContext = buildNestedSubchartContext();
      const overrideFile = path.join(nestedSubchartsPath, 'values-prod.yaml');
      const pos = await cache.findSubchartValuePositionInChainNested(
        leafContext,
        overrideFile,
        'name'
      );

      assert.ok(pos, 'Should find position');
      assert.ok(pos!.filePath.endsWith('values-prod.yaml'), 'Should be in override file');
      assert.strictEqual(pos!.source, 'override', 'Should be marked as override');
    });

    test('falls back to leaf values.yaml for unoverridden values', async () => {
      const leafContext = buildNestedSubchartContext();
      const pos = await cache.findSubchartValuePositionInChainNested(
        leafContext,
        '',
        'replicaCount'
      );

      assert.ok(pos, 'Should find position');
      assert.ok(pos!.filePath.endsWith('leaf/values.yaml'), 'Should be in leaf values.yaml');
      assert.strictEqual(pos!.source, 'default', 'Should be marked as default');
    });

    test('finds global values at root level', async () => {
      const leafContext = buildNestedSubchartContext();
      const pos = await cache.findSubchartValuePositionInChainNested(
        leafContext,
        '',
        'global.environment'
      );

      assert.ok(pos, 'Should find position for global value');
      assert.ok(pos!.filePath.endsWith('nested-subcharts/values.yaml'), 'Should be in root values.yaml');
    });
  });

  suite('archive subchart values', () => {
    const archiveChartPath = path.join(fixturesPath, 'archive-chart');
    const archivePath = path.join(archiveChartPath, 'charts', 'mysubchart-1.0.0.tgz');

    test('loadSubchartDefaults loads values from archive', async () => {
      const subchartInfo = {
        name: 'mysubchart',
        alias: 'archived',
        chartRoot: archivePath,
        isArchive: true,
        archivePath: archivePath,
      };

      const defaults = await cache.loadSubchartDefaults(subchartInfo);

      assert.ok(defaults, 'Should load defaults');
      assert.strictEqual(defaults.setting, 'default-from-subchart', 'Should have subchart default value');
      assert.strictEqual(defaults.port, 8080, 'Should have subchart default port');
      assert.strictEqual(defaults.enabled, true, 'Should have subchart default enabled');
    });

    test('getValuesForSubchartInfo merges archive defaults with parent values', async () => {
      const subchartInfo = {
        name: 'mysubchart',
        alias: 'archived',
        chartRoot: archivePath,
        isArchive: true,
        archivePath: archivePath,
      };

      const values = await cache.getValuesForSubchartInfo(
        archiveChartPath,
        subchartInfo,
        ''
      );

      // Parent values.yaml overrides archived.setting and archived.port
      assert.strictEqual(values.setting, 'from-parent', 'Should have parent override for setting');
      assert.strictEqual(values.port, 9090, 'Should have parent override for port');
      // enabled is not overridden, should keep subchart default
      assert.strictEqual(values.enabled, true, 'Should keep subchart default for enabled');
    });

    test('getValuesForSubchartInfo includes global values from parent', async () => {
      const subchartInfo = {
        name: 'mysubchart',
        alias: 'archived',
        chartRoot: archivePath,
        isArchive: true,
        archivePath: archivePath,
      };

      const values = await cache.getValuesForSubchartInfo(
        archiveChartPath,
        subchartInfo,
        ''
      );

      const global = values.global as Record<string, unknown> | undefined;
      assert.ok(global, 'Should have global values');
      assert.strictEqual(global?.environment, 'test', 'Should have global.environment from parent');
    });

    test('loadSubchartDefaults loads values from directory subchart', async () => {
      const subchartInfo = {
        name: 'mysql',
        alias: 'database',
        chartRoot: mysqlSubchartPath,
        isArchive: false,
      };

      const defaults = await cache.loadSubchartDefaults(subchartInfo);

      assert.ok(defaults, 'Should load defaults');
      assert.ok(defaults.auth, 'Should have mysql auth section');
      const auth = defaults.auth as Record<string, unknown>;
      assert.strictEqual(auth.rootPassword, 'default-mysql-root', 'Should have mysql default rootPassword');
    });
  });
});
