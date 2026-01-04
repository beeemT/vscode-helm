<div align="center">

# 🎛️ Helm Values Preview

**A VS Code extension that supercharges Helm chart development**

[![VS Code](https://img.shields.io/badge/VS%20Code-1.85+-blue.svg)](https://code.visualstudio.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)

*See resolved template values inline, navigate to definitions, and switch between environments instantly.*

</div>

---

## ✨ Features

### 📊 Inline Value Decorations

See resolved `.Values.*` expressions directly in your template files. Values update instantly when you switch between environments—no need to run `helm template` repeatedly.

- Values shown inline after each template expression
- Unset values highlighted with warnings
- Truncated display for long values (configurable)

### 🔄 Values File Selector

Quickly switch between values override files using the status bar dropdown. The selected file is merged with `values.yaml` following Helm's merge behavior.

> **Status bar shows:** `📄 values-prod.yaml` or `📦 subchart > 📄 values-prod.yaml` for subcharts

### 🔍 Go-to-Definition

**Ctrl/Cmd+Click** on any value decoration to jump directly to where that value is defined—whether it's in your override file, default `values.yaml`, or a subchart's values.

### 📚 Find All References

Right-click on any key in a values file and select "Find All References" to see every template that uses that value across your chart and subcharts.

### 💡 Quick Fixes for Missing Values

When a `.Values.*` reference doesn't exist, the extension shows a warning decoration and offers a **Quick Fix** to create the missing key in your `values.yaml`.

### 📦 Full Subchart Support

Works seamlessly with Helm dependencies:

| Feature | Description |
|---------|-------------|
| **Auto-detection** | Subcharts in `charts/` directory automatically detected |
| **Alias support** | Dependencies with aliases in `Chart.yaml` properly resolved |
| **Nested subcharts** | Full support for subcharts within subcharts |
| **Archive support** | Works with `.tgz` packaged subcharts (read-only) |
| **Global values** | `global:` section properly inherited |

### 🎯 Autocomplete for Subchart Values

When editing values files, get intelligent autocomplete suggestions for subchart configuration keys based on their default `values.yaml`.

---

## 🚀 Getting Started

1. **Install** the extension from the VS Code marketplace
2. **Open** a workspace containing a Helm chart (must have `Chart.yaml`)
3. **Edit** any template file in the `templates/` directory
4. **Click** the status bar item to select a values override file
5. **Enjoy** inline value previews and instant navigation!

---

## ⚙️ Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `helmValues.enableInlayHints` | Enable/disable inline value decorations | `true` |
| `helmValues.inlayHintMaxLength` | Maximum characters before value is truncated | `50` |

---

## 📋 Commands

| Command | Description |
|---------|-------------|
| `Helm: Select Values File` | Open the values file picker |
| `Helm: Clear Values File Selection` | Reset to default `values.yaml` only |
| `Helm: Go to Value Definition` | Navigate to the value source |
| `Helm: Create Missing Value` | Add undefined value to `values.yaml` |

---

## 📁 Supported Patterns

### Template Expressions

```yaml
{{ .Values.foo }}
{{- .Values.foo -}}
{{ $.Values.foo }}
{{ .Values.foo | default "bar" }}
{{ if .Values.enabled }}...{{ end }}
```

### Values File Patterns

The extension discovers override files matching these patterns:

- `values-*.yaml` → `values-prod.yaml`, `values-dev.yaml`
- `*.values.yaml` → `prod.values.yaml`
- `*-values.yaml` → `production-values.yaml`
- `values.*.yaml` → `values.prod.yaml`
- `values/*.yaml` → `values/staging.yaml`

---

## 📦 Subchart Example

```yaml
# Chart.yaml
dependencies:
  - name: mysql
    version: "1.0.0"
    alias: database

# values.yaml
database:
  auth:
    rootPassword: "my-secret"
global:
  environment: production
```

When editing `charts/mysql/templates/deployment.yaml`:
- `.Values.auth.rootPassword` → `"my-secret"` (from parent)
- `.Values.global.environment` → `"production"` (inherited global)

Archive subcharts (`.tgz`) are supported for value resolution and autocomplete, but navigation into archives is read-only.

---

## 🛠️ Development

```bash
# Install dependencies
npm install

# Compile
npm run compile

# Watch mode (for development)
npm run watch

# Run tests
npm test

# Lint
npm run lint

# Format code
npm run format
```

### Debugging

1. Open the project in VS Code
2. Press **F5** to launch the Extension Development Host
3. Open a folder containing a Helm chart to test

---

## 🤝 Contributing

Contributions are welcome! Please see the [AGENTS.md](AGENTS.md) file for development guidelines and architecture documentation.

---

## 📄 License

[MIT](LICENSE)

---

<div align="center">

**[Report Bug](https://github.com/beeemt/vscode-helm/issues) · [Request Feature](https://github.com/beeemt/vscode-helm/issues)**

</div>