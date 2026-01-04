import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { HelmChartService } from '../../services/helmChartService';

suite('HelmChartService', () => {
  let service: HelmChartService;
  // Use workspace root to find fixtures (works regardless of compiled output location)
  const workspaceRoot = path.resolve(__dirname, '..', '..', '..');
  const fixturesPath = path.join(workspaceRoot, 'src', 'test', 'fixtures');
  const sampleChartPath = path.join(fixturesPath, 'sample-chart');
  const parentWithDepsPath = path.join(fixturesPath, 'parent-with-deps');
  const mysqlSubchartPath = path.join(parentWithDepsPath, 'charts', 'mysql');
  const redisSubchartPath = path.join(parentWithDepsPath, 'charts', 'redis');

  setup(() => {
    service = HelmChartService.getInstance();
  });

  suite('detectHelmChart', () => {
    test('detects chart from template file', async () => {
      const templatePath = path.join(sampleChartPath, 'templates', 'deployment.yaml');
      const uri = vscode.Uri.file(templatePath);

      const context = await service.detectHelmChart(uri);

      assert.ok(context, 'Should detect chart context');
      assert.strictEqual(context!.chartRoot, sampleChartPath);
      assert.strictEqual(context!.chartYamlPath, path.join(sampleChartPath, 'Chart.yaml'));
    });

    test('detects chart from values file', async () => {
      const valuesPath = path.join(sampleChartPath, 'values.yaml');
      const uri = vscode.Uri.file(valuesPath);

      const context = await service.detectHelmChart(uri);

      assert.ok(context, 'Should detect chart context');
      assert.strictEqual(context!.chartRoot, sampleChartPath);
    });

    test('returns undefined for non-chart file', async () => {
      const nonChartPath = path.join(fixturesPath, 'non-existent', 'file.yaml');
      const uri = vscode.Uri.file(nonChartPath);

      const context = await service.detectHelmChart(uri);

      assert.strictEqual(context, undefined);
    });
  });

  suite('findValuesFiles', () => {
    test('finds values override files', async () => {
      const files = await service.findValuesFiles(sampleChartPath);

      // Should find: values-prod.yaml, values-dev.yaml, prod.values.yaml, values/staging.yaml
      assert.ok(files.length >= 4, `Expected at least 4 files, got ${files.length}`);

      // Check for expected patterns
      const fileNames = files.map((f) => path.relative(sampleChartPath, f));

      assert.ok(fileNames.some((f) => f === 'values-prod.yaml'), 'Should find values-prod.yaml');
      assert.ok(fileNames.some((f) => f === 'values-dev.yaml'), 'Should find values-dev.yaml');
      assert.ok(fileNames.some((f) => f === 'prod.values.yaml'), 'Should find prod.values.yaml');
      assert.ok(
        fileNames.some((f) => f.includes('staging.yaml')),
        'Should find values/staging.yaml'
      );
    });

    test('excludes default values.yaml', async () => {
      const files = await service.findValuesFiles(sampleChartPath);
      const fileNames = files.map((f) => path.basename(f));

      assert.ok(
        !fileNames.includes('values.yaml') || files.every((f) => !f.endsWith('/values.yaml')),
        'Should not include default values.yaml'
      );
    });
  });

  suite('isHelmTemplateFile', () => {
    test('returns true for file in templates directory', () => {
      const uri = vscode.Uri.file('/some/chart/templates/deployment.yaml');
      assert.strictEqual(service.isHelmTemplateFile(uri), true);
    });

    test('returns true for nested templates path', () => {
      const uri = vscode.Uri.file('/some/chart/templates/nested/service.yaml');
      assert.strictEqual(service.isHelmTemplateFile(uri), true);
    });

    test('returns true for .tpl files in templates directory', () => {
      const uri = vscode.Uri.file('/some/chart/templates/_helpers.tpl');
      assert.strictEqual(service.isHelmTemplateFile(uri), true);
    });

    test('returns false for values file', () => {
      const uri = vscode.Uri.file('/some/chart/values.yaml');
      assert.strictEqual(service.isHelmTemplateFile(uri), false);
    });

    test('returns false for Chart.yaml', () => {
      const uri = vscode.Uri.file('/some/chart/Chart.yaml');
      assert.strictEqual(service.isHelmTemplateFile(uri), false);
    });
  });

  suite('getChartMetadata', () => {
    test('returns Chart.yaml contents with PascalCase keys', async () => {
      const metadata = await service.getChartMetadata(sampleChartPath);

      assert.ok(metadata, 'Should return chart metadata');
      // Helm uses PascalCase for .Chart fields (e.g., .Chart.Name, .Chart.Version)
      assert.strictEqual(metadata!.Name, 'sample-chart', 'Should have correct Name');
      assert.strictEqual(metadata!.Version, '0.1.0', 'Should have correct Version');
      assert.strictEqual(metadata!.AppVersion, '1.0.0', 'Should have correct AppVersion');
      assert.strictEqual(metadata!.ApiVersion, 'v2', 'Should have correct ApiVersion');
    });

    test('returns undefined for non-existent chart', async () => {
      const metadata = await service.getChartMetadata('/non/existent/path');

      assert.strictEqual(metadata, undefined);
    });

    test('caches chart metadata', async () => {
      // Get metadata twice
      const metadata1 = await service.getChartMetadata(sampleChartPath);
      const metadata2 = await service.getChartMetadata(sampleChartPath);

      // Both should return the same data
      assert.deepStrictEqual(metadata1, metadata2);
    });

    test('clearChartMetadataCache clears the cache', async () => {
      // Get metadata to populate cache
      await service.getChartMetadata(sampleChartPath);

      // Clear cache
      service.clearChartMetadataCache(sampleChartPath);

      // Should still work after clearing
      const metadata = await service.getChartMetadata(sampleChartPath);
      assert.ok(metadata, 'Should return metadata after cache clear');
    });
  });

  suite('getReleaseInfo', () => {
    test('returns release info placeholder', () => {
      const releaseInfo = service.getReleaseInfo(sampleChartPath);

      assert.ok(releaseInfo, 'Should return release info');
      assert.ok(releaseInfo.Name, 'Should have Name');
      assert.ok(releaseInfo.Namespace, 'Should have Namespace');
      assert.strictEqual(typeof releaseInfo.IsInstall, 'boolean', 'IsInstall should be boolean');
      assert.strictEqual(typeof releaseInfo.IsUpgrade, 'boolean', 'IsUpgrade should be boolean');
      assert.strictEqual(typeof releaseInfo.Revision, 'number', 'Revision should be number');
      assert.ok(releaseInfo.Service, 'Should have Service');
    });
  });

  suite('getCapabilities', () => {
    test('returns capabilities info', () => {
      const capabilities = service.getCapabilities();

      assert.ok(capabilities, 'Should return capabilities');
      assert.ok(capabilities.APIVersions, 'Should have APIVersions');
      assert.ok(capabilities.KubeVersion, 'Should have KubeVersion');
      assert.ok(capabilities.HelmVersion, 'Should have HelmVersion');
    });
  });

  suite('getTemplateInfo', () => {
    test('returns template info for file', () => {
      const templatePath = path.join(sampleChartPath, 'templates', 'deployment.yaml');
      const templateInfo = service.getTemplateInfo(templatePath, sampleChartPath);

      assert.ok(templateInfo, 'Should return template info');
      assert.strictEqual(templateInfo.Name, 'templates/deployment.yaml', 'Should have correct Name');
      assert.strictEqual(templateInfo.BasePath, 'templates', 'Should have correct BasePath');
    });

    test('returns template info for nested file', () => {
      const templatePath = path.join(sampleChartPath, 'templates', 'nested', 'service.yaml');
      const templateInfo = service.getTemplateInfo(templatePath, sampleChartPath);

      assert.ok(templateInfo, 'Should return template info');
      assert.ok(templateInfo.Name.includes('nested'), 'Name should include nested path');
    });
  });

  suite('subchart detection', () => {
    test('detects subchart from template file in charts/ directory', async () => {
      const templatePath = path.join(mysqlSubchartPath, 'templates', 'statefulset.yaml');
      const uri = vscode.Uri.file(templatePath);

      const context = await service.detectHelmChart(uri);

      assert.ok(context, 'Should detect chart context');
      assert.strictEqual(context!.isSubchart, true, 'Should identify as subchart');
      assert.strictEqual(context!.chartRoot, mysqlSubchartPath, 'Should have correct subchart root');
    });

    test('resolves alias for subchart from parent Chart.yaml', async () => {
      const templatePath = path.join(mysqlSubchartPath, 'templates', 'statefulset.yaml');
      const uri = vscode.Uri.file(templatePath);

      const context = await service.detectHelmChart(uri);

      assert.ok(context, 'Should detect chart context');
      assert.strictEqual(context!.subchartName, 'database', 'Should resolve alias "database" for mysql subchart');
    });

    test('uses directory name when no alias defined', async () => {
      const templatePath = path.join(redisSubchartPath, 'templates', 'deployment.yaml');
      const uri = vscode.Uri.file(templatePath);

      const context = await service.detectHelmChart(uri);

      assert.ok(context, 'Should detect chart context');
      assert.strictEqual(context!.subchartName, 'redis', 'Should use directory name "redis" when no alias');
    });

    test('includes parent chart context for subcharts', async () => {
      const templatePath = path.join(mysqlSubchartPath, 'templates', 'statefulset.yaml');
      const uri = vscode.Uri.file(templatePath);

      const context = await service.detectHelmChart(uri);

      assert.ok(context, 'Should detect chart context');
      assert.ok(context!.parentChart, 'Should have parent chart context');
      assert.strictEqual(context!.parentChart!.chartRoot, parentWithDepsPath, 'Parent should point to correct chart');
      assert.strictEqual(context!.parentChart!.isSubchart, false, 'Parent should not be marked as subchart');
    });

    test('parent chart is not marked as subchart', async () => {
      const templatePath = path.join(parentWithDepsPath, 'templates', 'deployment.yaml');
      const uri = vscode.Uri.file(templatePath);

      const context = await service.detectHelmChart(uri);

      assert.ok(context, 'Should detect chart context');
      assert.strictEqual(context!.isSubchart, false, 'Parent should not be marked as subchart');
      assert.strictEqual(context!.parentChart, undefined, 'Parent should not have parent chart');
    });

    test('parent chart discovers its subcharts', async () => {
      const templatePath = path.join(parentWithDepsPath, 'templates', 'deployment.yaml');
      const uri = vscode.Uri.file(templatePath);

      const context = await service.detectHelmChart(uri);

      assert.ok(context, 'Should detect chart context');
      assert.ok(context!.subcharts.length >= 2, 'Should discover at least 2 subcharts');

      const mysqlSubchart = context!.subcharts.find((s) => s.name === 'mysql');
      assert.ok(mysqlSubchart, 'Should find mysql subchart');
      assert.strictEqual(mysqlSubchart!.alias, 'database', 'mysql should have alias "database"');

      const redisSubchart = context!.subcharts.find((s) => s.name === 'redis');
      assert.ok(redisSubchart, 'Should find redis subchart');
      assert.strictEqual(redisSubchart!.alias, undefined, 'redis should have no alias');
    });
  });

  suite('discoverSubcharts', () => {
    test('finds all subcharts in charts/ directory', async () => {
      const subcharts = await service.discoverSubcharts(parentWithDepsPath);

      assert.ok(subcharts.length >= 2, `Expected at least 2 subcharts, got ${subcharts.length}`);

      const names = subcharts.map((s) => s.name);
      assert.ok(names.includes('mysql'), 'Should find mysql subchart');
      assert.ok(names.includes('redis'), 'Should find redis subchart');
    });

    test('includes alias from Chart.yaml dependencies', async () => {
      const subcharts = await service.discoverSubcharts(parentWithDepsPath);

      const mysql = subcharts.find((s) => s.name === 'mysql');
      assert.ok(mysql, 'Should find mysql');
      assert.strictEqual(mysql!.alias, 'database', 'mysql should have alias from Chart.yaml');
    });

    test('includes condition from Chart.yaml dependencies', async () => {
      const subcharts = await service.discoverSubcharts(parentWithDepsPath);

      const mysql = subcharts.find((s) => s.name === 'mysql');
      assert.ok(mysql, 'Should find mysql');
      assert.strictEqual(mysql!.condition, 'database.enabled', 'mysql should have condition from Chart.yaml');
    });

    test('returns empty array for chart without subcharts', async () => {
      const subcharts = await service.discoverSubcharts(sampleChartPath);

      assert.deepStrictEqual(subcharts, [], 'Should return empty array');
    });
  });

  suite('getSubchartValuesKey', () => {
    test('returns alias when defined', () => {
      const subchart = { name: 'mysql', alias: 'database', chartRoot: mysqlSubchartPath };
      const key = service.getSubchartValuesKey(subchart);

      assert.strictEqual(key, 'database');
    });

    test('returns name when no alias', () => {
      const subchart = { name: 'redis', chartRoot: redisSubchartPath };
      const key = service.getSubchartValuesKey(subchart);

      assert.strictEqual(key, 'redis');
    });
  });
});
