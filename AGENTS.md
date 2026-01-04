# AGENTS.md

## Project Overview

VS Code extension for Helm chart development. Provides:
- Status bar dropdown for selecting values override files
- Text decorations showing resolved template values
- Go-to-definition for value sources (Cmd/Ctrl+Click)
- Find all references from values files to templates
- Hover tooltips on decorations with value details
- Autocomplete for subchart values in values files

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
│   ├── codeActionProvider.ts       # Quick fixes for missing values
│   ├── valuesDecorationProvider.ts # Text decorations for .Values references
│   ├── decorationHoverProvider.ts  # Hover tooltips for decorations
│   ├── definitionProvider.ts       # Go-to-definition (Cmd/Ctrl+Click)
│   ├── referenceProvider.ts        # Find all references from values files
│   ├── statusBarProvider.ts        # Status bar values file selector
│   └── valuesCompletionProvider.ts # Autocomplete for subchart values
├── services/
│   ├── archiveReader.ts            # Read .tgz archive subcharts
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

The extension supports Helm subcharts (dependencies) in the `charts/` directory, including **nested subcharts** (subcharts within subcharts). This is implemented with the following design:

**Subchart Detection (`detectSubchartContext`)**:
1. When a chart is detected, check if its parent directory is named `charts`
2. If so, look for `Chart.yaml` one level up to find parent chart
3. Read parent's `Chart.yaml` dependencies to resolve aliases
4. **Recursively** check if the parent is also a subchart (with cycle detection via `Set<string>` of visited paths)

**SubchartInfo Interface**:
```typescript
interface SubchartInfo {
  name: string;          // Directory name
  alias?: string;        // Alias from Chart.yaml dependencies
  chartRoot: string;     // Absolute path to subchart
  condition?: string;    // Condition expression from dependencies
}
```

**Ancestor Chain Utilities**:
- `getRootAncestorChart(context)`: Walks up the parent chain to find the root chart
- `buildAncestorChain(context)`: Returns array of `{ chart, subchartKey }` from root to leaf
- `buildSubchartCacheKey(context, overrideFile)`: Creates unique cache key including full ancestor chain

**Value Resolution for Subcharts (`getValuesForSubchart`)**:
Follows Helm's merge behavior for nested subcharts:
1. Start with subchart's own `values.yaml` defaults
2. Get root ancestor's merged values (default + selected override)
3. Build nested key path (e.g., `parentAlias.leafAlias` for grandparent > parent > leaf)
4. Extract values from root under the nested path
5. Include `global` values from root chart

**Key Design Decisions**:
- **Root Chart Drives State**: All subcharts (including nested) use the root ancestor's selected values file
- **Alias Resolution**: Always check `Chart.yaml` dependencies for aliases at each level
- **Cache Strategy**: Subchart caches keyed by full ancestor chain: `rootPath:parentKey:childKey:overrideFile`
- **Status Bar Display**: Shows abbreviated path `📦 ...parent/leaf > 📄 fileName` with full path in tooltip for deeply nested charts
- **Find References**: Works from any chart level (root, intermediate subchart, or leaf) by checking if the chart has subcharts, not just if it's a root chart. This enables finding references in nested subcharts when editing intermediate subchart values files

**Value Position Resolution (`findSubchartValuePositionInChainNested`)**:
Priority order for go-to-definition in nested subcharts:
1. Root override file (under nested path: `parentKey.leafKey.valuePath`)
2. Root default `values.yaml` (under nested path)
3. Each intermediate parent's `values.yaml` (under remaining path)
4. Subchart's own `values.yaml` (under direct `valuePath`)
5. For `global.*` paths: check root files at root level

**Cycle Detection**:
- Uses `Set<string>` of visited `chartRoot` paths during recursion
- Prevents infinite loops from circular chart references

**Reference Provider for Subcharts (`HelmReferenceProvider`)**:
- Supports finding references from any values file (root, intermediate, or leaf subchart)
- Uses `findReferencesInSubchartChain()` to recursively follow subchart key paths using alias resolution
- Uses `findGlobalReferencesInAllSubcharts()` to search all nested subcharts for `global.*` references
- Works when editing intermediate subchart values files by checking `chartContext.subcharts.length > 0` instead of `!chartContext.isSubchart`

### Archive Subchart Support

The extension supports `.tgz` archive subcharts in the `charts/` directory, not just expanded directories.

**Archive Detection (`discoverSubcharts`)**:
1. Glob pattern `*.tgz` finds archive files in `charts/` directory
2. `Chart.yaml` is extracted from archive to read chart name
3. `SubchartInfo` is created with `isArchive: true` and `archivePath` set

**SubchartInfo Extension**:
```typescript
interface SubchartInfo {
  // ... existing fields
  isArchive?: boolean;      // True if subchart is from .tgz archive
  archivePath?: string;     // Path to .tgz file
}
```

**Archive Reader (`ArchiveReader` service)**:
- Uses `tar-stream` for streaming extraction (memory efficient)
- Extracts `Chart.yaml` and `values.yaml` from archives on demand
- Caches extracted content in memory with mtime-based invalidation
- Shows VS Code notification for malformed archives

**Value Loading for Archive Subcharts**:
- `loadSubchartDefaults(subchartInfo)` checks `isArchive` flag
- For archives: uses `ArchiveReader.extractValuesYaml()`
- For directories: uses standard file reading
- `getValuesForSubchartInfo()` provides unified interface

**Archive Cache Invalidation**:
- `FileWatcher` watches `**/charts/*.tgz` pattern
- Archive cache invalidated on file change (add/modify/delete)
- No TTL expiration - only invalidates on actual file changes

**UI Indicators for Archives**:
- Hover tooltips show 📦 indicator when value comes from archive subchart
- "📦 from archive" message when navigation is not available
- Go-to-definition returns `undefined` for archive-sourced values (cannot navigate into archives)

**Limitations**:
- Cannot edit templates inside archives (read-only)
- No line-level navigation into archives (definition/references)
- Archive must be valid gzipped tar format

### Values File Autocomplete Architecture

The extension provides autocomplete suggestions in values files to help users configure subchart values.

**ValuesCompletionProvider**:
- Registered for all values file patterns: `values*.yaml`, `*.values.yaml`, `*-values.yaml`, `values/*.yaml`
- Trigger characters: newline, colon, space (for natural YAML editing flow)
- Only active for root charts with discovered subcharts (not subchart values files)

**Completion Types**:
1. **Root-level completions**: Subchart keys (using `CompletionItemKind.Module`) and `global:`
2. **Nested completions**: Keys from subchart default `values.yaml` (using `Property`/`Value` kinds)
3. **Global completions**: Common global keys (imageRegistry, storageClass, etc.) plus keys from subchart global defaults

**YAML Path Detection**:
- Uses indentation-based walking similar to `getValuePathAtPosition()` in `referenceProvider.ts`
- Determines current path hierarchy by walking backwards through document lines
- Matches path segments to subchart keys for context-aware suggestions

**Archive Subchart Support**:
- Uses `loadSubchartDefaults(subchartInfo)` which handles both directories and archives
- Archive-sourced completions show 📦 indicator in detail text
- Works seamlessly with `.tgz` subcharts via `ArchiveReader`

**Snippet Insertion**:
- Object-type values insert `key:\n  $0` (with newline and cursor placement)
- Scalar values insert `key: "${1:defaultValue}"` with placeholder
- Enables rapid value entry with tab completion

## PR Guidelines

1. Run `npm run lint` before committing
2. Run `npm test` and ensure all tests pass
3. Add tests for new functionality
4. Update README.md if adding user-facing features
5. Keep commits focused and atomic

## Documentation Maintenance

**Keep documentation in sync with code changes:**

1. **README.md**: Update when adding/removing/changing user-facing features, commands, settings, or supported patterns
2. **AGENTS.md**: Update when changing architecture, adding new providers/services, or modifying key design decisions
3. **package.json**: Keep `description` field current with main feature summary

**When to update docs:**
- New provider or service added → Update project structure in AGENTS.md
- New command or setting → Update README.md Commands/Configuration tables
- Architecture change → Update relevant section in AGENTS.md
- Bug fix for documented limitation → Remove or update the limitation note
- New file patterns supported → Update README.md patterns list

**Documentation checklist for PRs:**
- [ ] README.md reflects current features accurately
- [ ] AGENTS.md project structure matches actual `src/` layout
- [ ] No references to deprecated approaches (e.g., "inlay hints" when using decorations)
- [ ] Common Issues section reflects actual current issues

## Debugging

1. Set breakpoints in VS Code
2. Press F5 to launch Extension Development Host
3. Use "Extension Tests" configuration to debug tests
4. Check Output channel "Helm Values" for extension logs

## Common Issues

### Extension not activating
- Ensure workspace contains a `Chart.yaml` file
- Check that the file is valid YAML

### Value decorations not showing
- Verify file is in a `templates/` directory
- Check `helmValues.enableInlayHints` setting is true
- Ensure `values.yaml` exists and is valid YAML

### Status bar not visible
- Status bar only shows when editing files within a Helm chart
- Open a file that's part of a chart (has `Chart.yaml` in parent directories)
