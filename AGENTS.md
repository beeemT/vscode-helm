# AGENTS.md

## Project Overview

VS Code extension for Helm chart development. Provides:
- Status bar dropdown for selecting values override files
- Text decorations showing resolved template values
- Go-to-definition for value sources (Cmd/Ctrl+Click)
- Find all references from values files to templates
- Hover tooltips on decorations with value details

TypeScript-based VS Code extension using `js-yaml` for YAML parsing.

## Setup Commands

```bash
# Install dependencies
npm install

# Build the extension
npm run compile

# Watch mode for development
npm run watch

# Run tests
npm test

# Lint code
npm run lint

# Format code
npm run format
```

## Development Workflow

1. Run `npm install` to install dependencies
2. Press F5 in VS Code to launch Extension Development Host
3. Open a folder containing a Helm chart (has `Chart.yaml`)
4. Edit template files in `templates/` directory to see value decorations
5. Click the status bar item to select a values override file

## Testing

- Run all tests: `npm test`
- Tests use Mocha with `@vscode/test-cli`
- Test fixtures are in `src/test/fixtures/`
- Tests are in `src/test/suite/`

### Running Specific Tests

```bash
# Run tests matching a pattern
npm test -- --grep "HelmChartService"
```

## Code Style

- TypeScript strict mode enabled
- ESLint for linting
- Prettier for formatting
- Use camelCase for variables and functions
- Use PascalCase for classes and interfaces
- Prefer async/await over raw Promises
- Add JSDoc comments for public APIs

## Project Structure

```
src/
├── extension.ts                    # Entry point (activate/deactivate)
├── providers/
│   ├── valuesDecorationProvider.ts # Text decorations for .Values references
│   ├── decorationHoverProvider.ts  # Hover tooltips for decorations
│   ├── definitionProvider.ts       # Go-to-definition (Cmd/Ctrl+Click)
│   ├── referenceProvider.ts        # Find all references from values files
│   └── statusBarProvider.ts        # Status bar values file selector
├── services/
│   ├── helmChartService.ts         # Chart detection + values discovery
│   ├── templateParser.ts           # Parse .Values references from templates
│   ├── valuesCache.ts              # Caching layer for parsed values
│   └── fileWatcher.ts              # File system watchers
└── test/
    ├── suite/                      # Test files
    └── fixtures/                   # Test Helm charts
```

## Key Architectural Decisions

### Why Decorations Instead of Inlay Hints

We use VS Code's TextEditor Decorations API instead of InlayHints for displaying resolved values. This decision was made due to significant limitations with InlayHints:

**InlayHints Limitations:**
1. **No reliable refresh mechanism**: The `onDidChangeInlayHints` event is often ignored by VS Code. Hints only update when the document content changes.
2. **Workarounds are problematic**:
   - Making no-op edits (insert/delete space) marks the document as "dirty" (unsaved)
   - `editor.inlayHints.toggle` command doesn't exist
   - Toggling settings programmatically is disruptive to users
3. **Critical for this extension**: We need hints to update immediately when users select a different values file from the status bar dropdown.

**Decorations Solution:**
- Decorations update instantly via `editor.setDecorations()` without requiring document changes
- Hover functionality provided by a separate `HoverProvider` targeting the decoration position
- Definition navigation via `DefinitionProvider` for Cmd/Ctrl+Click

**Decoration Hover Limitation:**
- VS Code's decoration `hoverMessage` only works for the first decoration per decoration type
- Solution: Use a dedicated `HoverProvider` that responds to positions near template expression endings

### Per-Chart State
- Selected values file is tracked per-chart using `Chart.yaml` path as key
- State persisted in `ExtensionContext.workspaceState`
- Allows independent selection when working with multiple charts

### Caching Strategy
- Values are cached per-chart to avoid re-parsing on every keystroke
- Cache invalidated on:
  - Values file content changes (via FileSystemWatcher)
  - Different values file selected
  - Chart context changes
- 300ms debounce for rapid file changes

### Values File Discovery
Patterns searched in chart root:
- `values*.yaml` / `values*.yml`
- `*.values.yaml` / `*.values.yml`
- `*-values.yaml` / `*-values.yml`
- `values.*.yaml` / `values.*.yml`
- `values/*.yaml` subdirectory

Default `values.yaml` is always used as base but excluded from selection.

### Language ID Handling
Template files may have language ID `yaml` or `helm` (when Helm extension is installed).
All providers are registered for both languages.

### Subchart Support Architecture

The extension supports Helm subcharts (dependencies) in the `charts/` directory. This is implemented with the following design:

**Subchart Detection (`detectSubchartContext`)**:
1. When a chart is detected, check if its parent directory is named `charts`
2. If so, look for `Chart.yaml` one level up to find parent chart
3. Read parent's `Chart.yaml` dependencies to resolve aliases

**SubchartInfo Interface**:
```typescript
interface SubchartInfo {
  name: string;          // Directory name
  alias?: string;        // Alias from Chart.yaml dependencies
  chartRoot: string;     // Absolute path to subchart
  condition?: string;    // Condition expression from dependencies
}
```

**Value Resolution for Subcharts (`getValuesForSubchart`)**:
Follows Helm's merge behavior:
1. Start with subchart's own `values.yaml` defaults
2. Merge parent's values under the subchart key (alias or name)
3. Include `global` values from parent chart

**Key Design Decisions**:
- **Parent Chart Drives State**: Subcharts use the parent chart's selected values file
- **Alias Resolution**: Always check `Chart.yaml` dependencies for aliases
- **Cache Strategy**: Subchart caches keyed by `{subchartRoot}:{parentOverrideFile}`
- **Status Bar Display**: Shows `📦 subchartName > 📄 fileName` when in subchart

**Value Position Resolution (`findSubchartValuePositionInChain`)**:
Priority order for go-to-definition:
1. Parent override file (under `subchartKey.path`)
2. Parent default `values.yaml` (under `subchartKey.path`)
3. Subchart's own `values.yaml` (under `path`)

**Limitations**:
- Only expanded directories supported, not `.tgz` archives
- Nested subcharts (subcharts within subcharts) not supported
- Parent context is not recursive to avoid infinite loops

## PR Guidelines

1. Run `npm run lint` before committing
2. Run `npm test` and ensure all tests pass
3. Add tests for new functionality
4. Update README.md if adding user-facing features
5. Keep commits focused and atomic

## Debugging

1. Set breakpoints in VS Code
2. Press F5 to launch Extension Development Host
3. Use "Extension Tests" configuration to debug tests
4. Check Output channel "Helm Values" for extension logs

## Common Issues

### Extension not activating
- Ensure workspace contains a `Chart.yaml` file
- Check that the file is valid YAML

### Inlay hints not showing
- Verify file is in a `templates/` directory
- Check `helmValues.enableInlayHints` setting is true
- Ensure `values.yaml` exists and is valid YAML

### Status bar not visible
- Status bar only shows when editing files within a Helm chart
- Open a file that's part of a chart (has `Chart.yaml` in parent directories)
