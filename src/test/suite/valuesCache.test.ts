import * as assert from 'assert';
import { ValuesCache } from '../../services/valuesCache';

suite('ValuesCache', () => {
  let cache: ValuesCache;

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
});
