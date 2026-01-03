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

    test('returns false for values file', () => {
      const uri = vscode.Uri.file('/some/chart/values.yaml');
      assert.strictEqual(service.isHelmTemplateFile(uri), false);
    });

    test('returns false for Chart.yaml', () => {
      const uri = vscode.Uri.file('/some/chart/Chart.yaml');
      assert.strictEqual(service.isHelmTemplateFile(uri), false);
    });
  });
});
