import * as vscode from 'vscode';
import { HelmDecorationHoverProvider } from './providers/decorationHoverProvider';
import { HelmDefinitionProvider } from './providers/definitionProvider';
import { StatusBarProvider } from './providers/statusBarProvider';
import { ValuesDecorationProvider } from './providers/valuesDecorationProvider';
import { FileWatcher } from './services/fileWatcher';
import { HelmChartService } from './services/helmChartService';
import { ValuesCache } from './services/valuesCache';

let outputChannel: vscode.OutputChannel;
let decorationProvider: ValuesDecorationProvider;

/**
 * Activate the extension
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Create output channel for logging
  outputChannel = vscode.window.createOutputChannel('Helm Values');
  context.subscriptions.push(outputChannel);

  log('Helm Values extension activating...');

  // Initialize services (singleton instances)
  HelmChartService.getInstance();
  ValuesCache.getInstance();
  const fileWatcher = FileWatcher.getInstance();

  // Initialize file watcher
  fileWatcher.initialize(context);

  // Initialize status bar provider
  const statusBarProvider = StatusBarProvider.initialize(context);

  // Initialize decoration provider for instant visual updates
  decorationProvider = ValuesDecorationProvider.initialize();

  // Register hover provider for decoration tooltips
  // Responds to positions at the end of template expressions (where decorations appear)
  const hoverProvider = HelmDecorationHoverProvider.getInstance();
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { language: 'yaml', pattern: '**/templates/**' },
      hoverProvider
    ),
    vscode.languages.registerHoverProvider(
      { language: 'helm', pattern: '**/templates/**' },
      hoverProvider
    )
  );

  // Register definition provider for Cmd/Ctrl+Click go-to-definition
  // Register for both 'yaml' and 'helm' languages
  const definitionProvider = HelmDefinitionProvider.getInstance();
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      { language: 'yaml', pattern: '**/templates/**' },
      definitionProvider
    ),
    vscode.languages.registerDefinitionProvider(
      { language: 'helm', pattern: '**/templates/**' },
      definitionProvider
    )
  );

  // Register go-to-definition command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'helmValues.goToValueDefinition',
      async (valuePath: string, chartRoot: string, selectedFile: string) => {
        const cache = ValuesCache.getInstance();
        const position = await cache.findValuePositionInChain(
          chartRoot,
          selectedFile,
          valuePath
        );

        if (position) {
          const uri = vscode.Uri.file(position.filePath);
          const pos = new vscode.Position(position.line, position.character);
          const doc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(doc, {
            selection: new vscode.Range(pos, pos),
          });
        } else {
          vscode.window.showWarningMessage(`Could not find definition for .Values.${valuePath}`);
        }
      }
    )
  );

  // Listen for values file changes
  context.subscriptions.push(
    fileWatcher.onValuesChanged((chartRoot) => {
      log(`Values changed in chart: ${chartRoot}`);
      decorationProvider.refresh();
    })
  );

  // Listen for values files list changes
  context.subscriptions.push(
    fileWatcher.onValuesFilesListChanged((chartRoot) => {
      log(`Values files list changed in chart: ${chartRoot}`);
      statusBarProvider.refreshValuesFilesList();
    })
  );

  // Listen for selection changes
  context.subscriptions.push(
    statusBarProvider.onSelectionChanged((chartRoot) => {
      log(`Selection changed in chart: ${chartRoot}`);
      decorationProvider.refresh();
    })
  );

  log('Helm Values extension activated');
}

/**
 * Deactivate the extension
 */
export function deactivate(): void {
  log('Helm Values extension deactivating...');

  // Clear caches
  const valuesCache = ValuesCache.getInstance();
  valuesCache.clearAll();

  // Dispose file watcher
  const fileWatcher = FileWatcher.getInstance();
  fileWatcher.dispose();

  // Dispose decoration provider
  if (decorationProvider) {
    decorationProvider.dispose();
  }

  log('Helm Values extension deactivated');
}

/**
 * Log a message to the output channel
 */
function log(message: string): void {
  const timestamp = new Date().toISOString();
  outputChannel?.appendLine(`[${timestamp}] ${message}`);
}
