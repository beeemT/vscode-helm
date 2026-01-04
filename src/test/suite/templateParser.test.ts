import * as assert from 'assert';
import { TemplateParser } from '../../services/templateParser';

suite('TemplateParser', () => {
  let parser: TemplateParser;

  setup(() => {
    parser = TemplateParser.getInstance();
  });

  suite('parseTemplateReferences', () => {
    test('extracts simple .Values reference', () => {
      const text = '{{ .Values.replicaCount }}';
      const refs = parser.parseTemplateReferences(text);

      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].objectType, 'Values');
      assert.strictEqual(refs[0].path, 'replicaCount');
      assert.strictEqual(refs[0].fullMatch, '.Values.replicaCount');
    });

    test('extracts nested .Values reference', () => {
      const text = '{{ .Values.image.repository }}';
      const refs = parser.parseTemplateReferences(text);

      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].path, 'image.repository');
    });

    test('extracts .Values with dash trim', () => {
      const text = '{{- .Values.replicaCount -}}';
      const refs = parser.parseTemplateReferences(text);

      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].path, 'replicaCount');
    });

    test('extracts $.Values reference (root context)', () => {
      const text = '{{ $.Values.global.environment }}';
      const refs = parser.parseTemplateReferences(text);

      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].path, 'global.environment');
    });

    test('extracts .Values with default string', () => {
      const text = '{{ .Values.name | default "myapp" }}';
      const refs = parser.parseTemplateReferences(text);

      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].path, 'name');
      assert.strictEqual(refs[0].defaultValue, 'myapp');
    });

    test('extracts .Values with default number', () => {
      const text = '{{ .Values.port | default 8080 }}';
      const refs = parser.parseTemplateReferences(text);

      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].path, 'port');
      assert.strictEqual(refs[0].defaultValue, '8080');
    });

    test('extracts multiple references', () => {
      const text = `
        image: {{ .Values.image.repository }}:{{ .Values.image.tag }}
        replicas: {{ .Values.replicaCount }}
      `;
      const refs = parser.parseTemplateReferences(text);

      assert.strictEqual(refs.length, 3);
      assert.strictEqual(refs[0].path, 'image.repository');
      assert.strictEqual(refs[1].path, 'image.tag');
      assert.strictEqual(refs[2].path, 'replicaCount');
    });

    test('extracts deeply nested reference', () => {
      const text = '{{ .Values.resources.limits.cpu }}';
      const refs = parser.parseTemplateReferences(text);

      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].path, 'resources.limits.cpu');
    });

    test('handles underscore in path', () => {
      const text = '{{ .Values.my_value }}';
      const refs = parser.parseTemplateReferences(text);

      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].path, 'my_value');
    });

    test('captures correct offsets', () => {
      const text = 'prefix {{ .Values.foo }} suffix';
      const refs = parser.parseTemplateReferences(text);

      assert.strictEqual(refs.length, 1);
      // Offset points to .Values.foo, not the entire {{ }} block
      // 'prefix {{ ' = 10 chars, so .Values.foo starts at index 10
      assert.strictEqual(refs[0].startOffset, 10);
      // .Values.foo is 11 chars, so end is at 21
      assert.strictEqual(refs[0].endOffset, 21);
    });

    test('returns empty array for no references', () => {
      const text = 'no values here';
      const refs = parser.parseTemplateReferences(text);

      assert.strictEqual(refs.length, 0);
    });

    test('extracts .Release references', () => {
      const text = '{{ .Release.Name }}';
      const refs = parser.parseTemplateReferences(text);

      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].objectType, 'Release');
      assert.strictEqual(refs[0].path, 'Name');
    });

    test('extracts .Chart references', () => {
      const text = '{{ .Chart.Name }}';
      const refs = parser.parseTemplateReferences(text);

      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].objectType, 'Chart');
      assert.strictEqual(refs[0].path, 'Name');
    });

    test('extracts .Values in if statement', () => {
      const text = '{{- if .Values.enabled }}';
      const refs = parser.parseTemplateReferences(text);

      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].path, 'enabled');
    });

    test('extracts .Values in if statement without dash', () => {
      const text = '{{ if .Values.debug }}';
      const refs = parser.parseTemplateReferences(text);

      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].path, 'debug');
    });

    test('extracts .Values in else if statement', () => {
      const text = '{{- else if .Values.fallback -}}';
      const refs = parser.parseTemplateReferences(text);

      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].path, 'fallback');
    });

    test('extracts .Values in with statement', () => {
      const text = '{{ with .Values.config }}';
      const refs = parser.parseTemplateReferences(text);

      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].path, 'config');
    });

    test('extracts .Values in range statement', () => {
      const text = '{{- range .Values.items }}';
      const refs = parser.parseTemplateReferences(text);

      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].path, 'items');
    });

    test('extracts nested .Values in if statement', () => {
      const text = '{{- if .Values.monitoring.enabled }}';
      const refs = parser.parseTemplateReferences(text);

      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].path, 'monitoring.enabled');
    });

    test('extracts $.Values in if statement', () => {
      const text = '{{- if $.Values.global.debug }}';
      const refs = parser.parseTemplateReferences(text);

      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].path, 'global.debug');
    });

    test('extracts .Values with pipe functions (trunc, trimSuffix)', () => {
      const text = '{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}';
      const refs = parser.parseTemplateReferences(text);

      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].path, 'fullnameOverride');
    });

    test('extracts .Values in default function call', () => {
      const text = '{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}';
      const refs = parser.parseTemplateReferences(text);

      // Now extracts both .Chart.Name and .Values.nameOverride
      assert.strictEqual(refs.length, 2);
      const valuesRef = refs.find(r => r.objectType === 'Values');
      assert.ok(valuesRef);
      assert.strictEqual(valuesRef!.path, 'nameOverride');
      const chartRef = refs.find(r => r.objectType === 'Chart');
      assert.ok(chartRef);
      assert.strictEqual(chartRef!.path, 'Name');
    });

    test('extracts .Values in variable assignment', () => {
      const text = '{{- $name := default .Chart.Name .Values.nameOverride }}';
      const refs = parser.parseTemplateReferences(text);

      // Now extracts both .Chart.Name and .Values.nameOverride
      assert.strictEqual(refs.length, 2);
      const valuesRef = refs.find(r => r.objectType === 'Values');
      assert.ok(valuesRef);
      assert.strictEqual(valuesRef!.path, 'nameOverride');
    });

    test('extracts .Values from _helpers.tpl patterns', () => {
      const text = `{{/*
Expand the name of the chart.
*/}}
{{- define "sample-chart.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "sample-chart.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}`;
      const refs = parser.parseTemplateReferences(text);

      // Now extracts: .Chart.Name (x2), .Values.nameOverride (x2),
      // .Values.fullnameOverride (x2), .Release.Name (x1) = 7 total
      assert.strictEqual(refs.length, 7);

      // Filter by type
      const valuesRefs = refs.filter(r => r.objectType === 'Values');
      const chartRefs = refs.filter(r => r.objectType === 'Chart');
      const releaseRefs = refs.filter(r => r.objectType === 'Release');

      assert.strictEqual(valuesRefs.length, 4);
      assert.strictEqual(chartRefs.length, 2);
      assert.strictEqual(releaseRefs.length, 1);

      const valuesPaths = valuesRefs.map(r => r.path);
      assert.ok(valuesPaths.includes('nameOverride'));
      assert.ok(valuesPaths.includes('fullnameOverride'));
    });

    test('extracts .Values with default string value', () => {
      const text = '{{- default "myapp" .Values.nameOverride }}';
      const refs = parser.parseTemplateReferences(text);

      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].path, 'nameOverride');
    });

    test('extracts .Capabilities references', () => {
      const text = '{{ .Capabilities.KubeVersion.Major }}';
      const refs = parser.parseTemplateReferences(text);

      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].objectType, 'Capabilities');
      assert.strictEqual(refs[0].path, 'KubeVersion.Major');
    });

    test('extracts .Template references', () => {
      const text = '{{ .Template.Name }}';
      const refs = parser.parseTemplateReferences(text);

      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].objectType, 'Template');
      assert.strictEqual(refs[0].path, 'Name');
    });

    test('extracts .Files references', () => {
      const text = '{{ .Files.Get "config.ini" }}';
      const refs = parser.parseTemplateReferences(text);

      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].objectType, 'Files');
      assert.strictEqual(refs[0].path, 'Get');
    });

    test('extracts mixed object types in same template', () => {
      const text = `name: {{ .Chart.Name }}
namespace: {{ .Release.Namespace }}
replicas: {{ .Values.replicaCount }}`;
      const refs = parser.parseTemplateReferences(text);

      assert.strictEqual(refs.length, 3);
      assert.ok(refs.some(r => r.objectType === 'Chart' && r.path === 'Name'));
      assert.ok(refs.some(r => r.objectType === 'Release' && r.path === 'Namespace'));
      assert.ok(refs.some(r => r.objectType === 'Values' && r.path === 'replicaCount'));
    });
  });

  suite('parseValuePath', () => {
    test('parses simple path', () => {
      const segments = parser.parseValuePath('replicaCount');

      assert.deepStrictEqual(segments, ['replicaCount']);
    });

    test('parses nested path', () => {
      const segments = parser.parseValuePath('image.repository');

      assert.deepStrictEqual(segments, ['image', 'repository']);
    });

    test('parses deeply nested path', () => {
      const segments = parser.parseValuePath('resources.limits.cpu');

      assert.deepStrictEqual(segments, ['resources', 'limits', 'cpu']);
    });

    test('parses path with array index', () => {
      const segments = parser.parseValuePath('items[0].name');

      assert.deepStrictEqual(segments, ['items', 0, 'name']);
    });
  });

  suite('getPositionFromOffset', () => {
    test('returns correct position for first line', () => {
      const text = 'hello world';
      const pos = parser.getPositionFromOffset(text, 6);

      assert.strictEqual(pos.line, 0);
      assert.strictEqual(pos.character, 6);
    });

    test('returns correct position for multi-line', () => {
      const text = 'line1\nline2\nline3';
      const pos = parser.getPositionFromOffset(text, 8);

      assert.strictEqual(pos.line, 1);
      assert.strictEqual(pos.character, 2);
    });
  });
});
