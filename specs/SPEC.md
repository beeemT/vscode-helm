# VS Code Helm Values Extension Specification

## Overview

A VS Code extension that enhances working with Helm charts by providing:
1. A status bar dropdown to select values override files (excluding default `values.yaml`)
2. Inlay hints in Helm template files showing resolved template values
3. Clickable inlay hints for go-to-definition navigation to value sources

## Features

### Status Bar Values File Selector

- Displays in VS Code's bottom status bar
- Shows "None" by default (no override file selected)
- Clicking opens a QuickPick dropdown with available values files
- Only visible when editing files within a Helm chart
- Selection persisted per-chart (keyed by `Chart.yaml` absolute path)
- Excludes the default `values.yaml` from selection options

### Inlay Hints

- Display resolved template values inline after `.Values.x.y.z` expressions
- Values computed by deep-merging:
  1. Base `values.yaml` (always applied)
  2. Selected override file (if any)
- Clickable hints navigate to the value definition location in the source YAML
- Supported template patterns:
  - `{{ .Values.foo }}`
  - `{{- .Values.foo -}}`
  - `{{ $.Values.foo }}`
  - `{{ .Values.foo | default "bar" }}`

### Helm Chart Detection

- Walks up directory tree from open file to find `Chart.yaml`
- Identifies files within `templates/` directory as Helm templates
- Root chart support only (subchart support deferred)

### Values File Discovery

Discovers values files using these patterns in the chart root:
- `values*.yaml` / `values*.yml` (e.g., `values-prod.yaml`, `values-staging.yaml`)
- `*.values.yaml` / `*.values.yml` (e.g., `prod.values.yaml`)
- `*-values.yaml` / `*-values.yml` (e.g., `prod-values.yaml`)
- `values.*.yaml` / `values.*.yml` (e.g., `values.prod.yaml`)
- `values/*.yaml` / `values/*.yml` subdirectory (e.g., `values/prod.yaml`)

**Exclusions:**
- `values.yaml` (the default file, always merged as base)
- URL-based values files (out of scope)
- JSON files (out of scope)

## Architecture

### Project Structure

```
vscode-helm/
├── .vscode/
│   ├── launch.json           # Debug configurations
│   └── tasks.json            # Build tasks
├── src/
│   ├── extension.ts          # Entry point (activate/deactivate)
│   ├── providers/
│   │   ├── inlayHintsProvider.ts   # InlayHintsProvider implementation
│   │   └── statusBarProvider.ts    # Status bar + QuickPick
│   ├── services/
│   │   ├── helmChartService.ts     # Chart detection + values file discovery
│   │   ├── templateParser.ts       # Regex-based .Values extraction
│   │   ├── valuesCache.ts          # Per-chart caching with debounce
│   │   └── fileWatcher.ts          # File system watchers
│   └── test/
│       ├── suite/
│       │   ├── helmChartService.test.ts
│       │   ├── templateParser.test.ts
│       │   ├── valuesCache.test.ts
│       │   └── extension.test.ts
│       ├── fixtures/               # Test Helm charts
│       └── AGENTS.md               # Test-specific agent instructions
├── .vscode-test.mjs          # Test configuration
├── package.json              # Extension manifest
├── tsconfig.json             # TypeScript config
├── AGENTS.md                 # Project-wide agent instructions
├── SPEC.md                   # This file
└── README.md
```

### Key Components

#### HelmChartService
- `detectHelmChart(uri: Uri): Promise<HelmChartContext | undefined>`
- `findValuesFiles(chartRoot: string): Promise<string[]>`
- `isHelmTemplateFile(uri: Uri): boolean`

#### TemplateParser
- `parseTemplateReferences(text: string): TemplateReference[]`
- Returns array of `{ path, startOffset, endOffset, defaultValue? }`

#### ValuesCache
- Per-chart caching keyed by `Chart.yaml` path
- 300ms debounced invalidation on file changes
- Deep merge of base + override values

#### StatusBarProvider
- Creates/manages status bar item
- Handles QuickPick selection
- Persists selection in `ExtensionContext.workspaceState`

#### InlayHintsProvider
- Implements `vscode.InlayHintsProvider`
- Creates `InlayHintLabelPart` with `location` for click navigation
- Triggers refresh on values file change or selection change

### Activation Events

```json
{
  "activationEvents": [
    "workspaceContains:**/Chart.yaml",
    "onLanguage:yaml"
  ]
}
```

### Dependencies

**Runtime:**
- `js-yaml` - YAML parsing

**Development:**
- `@types/vscode`
- `@types/node`
- `@types/js-yaml`
- `typescript`
- `@vscode/test-cli`
- `@vscode/test-electron`
- `eslint`
- `prettier`

## Implementation Notes

### Caching Strategy
- Cache parsed values per-chart to avoid re-parsing on every keystroke
- Invalidate cache when:
  - Values file content changes (via FileSystemWatcher)
  - Different values file selected
  - Chart context changes (different chart opened)
- Use 300ms debounce to batch rapid file changes

### Multi-Chart Workspace Support
- Track selected values file per-chart using `Chart.yaml` absolute path as key
- Status bar updates when switching between files in different charts
- Each chart maintains independent selection state

### Error Handling
- Gracefully handle missing/invalid YAML files
- Show no inlay hints if values cannot be resolved
- Log errors to Output channel for debugging

## Out of Scope (Deferred)

- Subchart values support
- URL-based values files (`helm install -f https://...`)
- JSON values files
- `with`/`range` block context tracking
- `index .Values "key"` syntax
- Complex Go template expressions

## Testing Strategy

### Unit Tests
- HelmChartService: Chart detection, values file discovery patterns
- TemplateParser: All supported expression patterns
- ValuesCache: Merge logic, cache invalidation

### Integration Tests
- End-to-end with test fixture charts
- Status bar visibility and selection persistence
- Inlay hint rendering and click navigation

### Test Fixtures
Located in `src/test/fixtures/`:
- Sample Helm chart with various values file patterns
- Template files with different `.Values` expressions
- Multi-chart workspace scenario
