# Test AGENTS.md

## Overview

This directory contains tests for the Helm Values VS Code extension.

## Test Structure

```
test/
├── suite/
│   ├── index.ts                    # Test runner entry point
│   ├── helmChartService.test.ts    # HelmChartService tests
│   ├── templateParser.test.ts      # TemplateParser tests
│   ├── valuesCache.test.ts         # ValuesCache tests
│   └── extension.test.ts           # Integration tests
└── fixtures/
    ├── sample-chart/               # Standard Helm chart
    │   ├── Chart.yaml
    │   ├── values.yaml
    │   ├── values-prod.yaml
    │   ├── values-dev.yaml
    │   ├── prod.values.yaml
    │   ├── values/
    │   │   └── staging.yaml
    │   └── templates/
    │       ├── deployment.yaml
    │       └── service.yaml
    └── multi-chart/                # Multiple charts workspace
        ├── chart-a/
        └── chart-b/
```

## Running Tests

```bash
# Run all tests
npm test

# Run tests matching pattern
npm test -- --grep "TemplateParser"

# Run with verbose output
npm test -- --reporter spec
```

## Writing Tests

### Test Naming Convention

Use descriptive names following the pattern:
`[Component] [method/feature] [expected behavior]`

```typescript
suite('TemplateParser', () => {
  test('parseTemplateReferences extracts simple .Values reference', () => {
    // ...
  });
});
```

### Using Fixtures

Fixtures are sample Helm charts in `fixtures/` directory:

```typescript
import * as path from 'path';

const fixturesPath = path.join(__dirname, '..', 'fixtures');
const sampleChartPath = path.join(fixturesPath, 'sample-chart');
```

### Mocking VS Code APIs

For unit tests that don't need full VS Code integration:

```typescript
// Mock vscode.workspace.fs
const mockFs = {
  stat: async (uri: vscode.Uri) => ({ type: vscode.FileType.File }),
  readFile: async (uri: vscode.Uri) => Buffer.from('content')
};
```

### Adding New Test Cases

1. Create test file in `suite/` directory named `*.test.ts`
2. Use Mocha's `suite` and `test` functions
3. Import modules from `../../` (relative to compiled output)
4. Add fixture files if needed

## Fixture Files

### sample-chart

Standard Helm chart with various values file patterns:
- `values.yaml` - Default values (base)
- `values-prod.yaml` - Production overrides
- `values-dev.yaml` - Development overrides
- `prod.values.yaml` - Alternative naming pattern
- `values/staging.yaml` - Subdirectory pattern

### Template Files

Template files in `templates/` contain various `.Values` patterns:
- Simple: `{{ .Values.image.repository }}`
- With dash trim: `{{- .Values.replicas -}}`
- Root context: `{{ $.Values.global.name }}`
- With default: `{{ .Values.port | default 8080 }}`

## Debugging Tests

1. Open VS Code in the extension directory
2. Set breakpoints in test files
3. Use "Extension Tests" launch configuration
4. Tests run in Extension Development Host
