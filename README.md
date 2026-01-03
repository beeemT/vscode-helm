# Helm Values Preview

A VS Code extension that enhances working with Helm charts by providing:

- **Status bar values file selector** - Quickly switch between values override files
- **Inlay hints** - See resolved template values inline in your template files
- **Go-to-definition** - Click on inlay hints to jump to where values are defined

## Features

### Values File Selector

A dropdown in the status bar lets you select which values override file to use. The selected file is merged with the default `values.yaml` to compute resolved values.

![Status Bar](docs/status-bar.png)

### Inlay Hints

When editing Helm template files, inlay hints display the resolved values for `.Values.x.y.z` expressions. Values are computed by deep-merging the default `values.yaml` with your selected override file.

![Inlay Hints](docs/inlay-hints.png)

### Supported Patterns

Template expressions:
- `{{ .Values.foo }}`
- `{{- .Values.foo -}}`
- `{{ $.Values.foo }}`
- `{{ .Values.foo | default "bar" }}`

Values file patterns:
- `values-*.yaml` (e.g., `values-prod.yaml`)
- `*.values.yaml` (e.g., `prod.values.yaml`)
- `*-values.yaml` (e.g., `prod-values.yaml`)
- `values.*.yaml` (e.g., `values.prod.yaml`)
- `values/*.yaml` (e.g., `values/staging.yaml`)

## Requirements

- VS Code 1.85.0 or higher
- A workspace containing Helm charts (directories with `Chart.yaml`)

## Extension Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `helmValues.enableInlayHints` | Enable/disable inlay hints | `true` |
| `helmValues.inlayHintMaxLength` | Maximum length of inlay hint text | `50` |

## Commands

| Command | Description |
|---------|-------------|
| `Helm: Select Values File` | Open the values file picker |
| `Helm: Clear Values File Selection` | Clear the current selection |
| `Helm: Go to Value Definition` | Navigate to the value definition |

## Usage

1. Open a workspace containing a Helm chart
2. Open a template file (e.g., `templates/deployment.yaml`)
3. Click the status bar item to select a values override file
4. Inlay hints will appear showing resolved values
5. Click on a hint to jump to the value definition

## Development

```bash
# Install dependencies
npm install

# Compile
npm run compile

# Watch mode
npm run watch

# Run tests
npm test

# Lint
npm run lint
```

## License

MIT