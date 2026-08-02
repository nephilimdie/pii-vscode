import * as vscode from 'vscode';
import { PiiDetector } from './detector';
import { PiiHighlighter } from './highlighter';
import { registerCommands } from './commands';
import { getConfig, migrateApiKeyOutOfSettings, promptForApiKey } from './config';
import { PseudoraOAuthClient } from './oauth';
import { PseudoraMcpProvider } from './mcp-provider';
import { PseudoraStatusMenu } from './status-menu';
import { PseudoraWorkspacePreferences } from './workspace-preferences';

export function activate(context: vscode.ExtensionContext): void {
  const oauth = new PseudoraOAuthClient(context);
  const preferences = new PseudoraWorkspacePreferences(context.workspaceState);
  const detector = new PiiDetector(context.secrets, oauth, preferences);
  const highlighter = new PiiHighlighter();
  const statusMenu = new PseudoraStatusMenu(oauth, preferences);
  const mcpProvider = new PseudoraMcpProvider(oauth, preferences);

  // Lift any key left in settings.json into the OS keychain.
  void migrateApiKeyOutOfSettings(context.secrets);

  const setApiKey = vscode.commands.registerCommand('piiProtect.setApiKey', async () => {
    if (await promptForApiKey(context.secrets)) {
      void vscode.window.showInformationMessage('Pseudora: API key saved to the OS keychain.');
    }
  });

  const connect = vscode.commands.registerCommand('piiProtect.connect', async () => {
    try {
      await oauth.connect();
      await statusMenu.reconcileDocumentType();
      void vscode.window.showInformationMessage('Pseudora account connected.');
    } catch (error) {
      void vscode.window.showErrorMessage(`Pseudora login failed: ${String(error)}`);
    }
  });

  const selectTeam = vscode.commands.registerCommand('piiProtect.selectTeam', async () => {
    try {
      const team = await oauth.selectTeam();
      if (team) {
        await statusMenu.reconcileDocumentType();
        void vscode.window.showInformationMessage(`Pseudora team: ${team.name}`);
      }
    } catch (error) {
      void vscode.window.showErrorMessage(`Could not select the Pseudora team: ${String(error)}`);
    }
  });

  const disconnect = vscode.commands.registerCommand('piiProtect.disconnect', async () => {
    await oauth.disconnect();
    void vscode.window.showInformationMessage('Pseudora account disconnected.');
  });

  const openMenu = vscode.commands.registerCommand('piiProtect.openMenu', async () => {
    await statusMenu.open();
  });

  const selectDocumentType = vscode.commands.registerCommand('piiProtect.selectDocumentType', async () => {
    await statusMenu.selectDocumentType();
  });

  const selectMode = vscode.commands.registerCommand('piiProtect.selectMode', async () => {
    await statusMenu.selectMode();
  });

  const toggleEnabled = vscode.commands.registerCommand('piiProtect.toggleEnabled', async () => {
    await statusMenu.toggleEnabled();
  });

  const toggleMcp = vscode.commands.registerCommand('piiProtect.toggleMcp', async () => {
    await statusMenu.toggleMcp();
  });

  const uriHandler = vscode.window.registerUriHandler(oauth);
  const mcpRegistration = vscode.lm.registerMcpServerDefinitionProvider('pseudora.mcp', mcpProvider);

  // Register all commands
  registerCommands(context, detector, highlighter, statusMenu, preferences);

  // Auto-detect on save if enabled
  const onSave = vscode.workspace.onDidSaveTextDocument(async (doc: vscode.TextDocument) => {
    if (!preferences.snapshot().enabled) {
      return;
    }
    const config = getConfig();
    if (!config.autoDetect) {
      return;
    }

    // Only run if this document is open in the active editor
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== doc.uri.toString()) {
      return;
    }

    await vscode.commands.executeCommand('piiProtect.detectInFile');
  });

  // Auto-detect on file open if enabled
  const onOpen = vscode.workspace.onDidOpenTextDocument(async (doc: vscode.TextDocument) => {
    if (!preferences.snapshot().enabled) {
      return;
    }
    const config = getConfig();
    if (!config.autoDetect) {
      return;
    }

    // Small delay so the editor has time to become active
    await new Promise(resolve => setTimeout(resolve, 300));

    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== doc.uri.toString()) {
      return;
    }

    await vscode.commands.executeCommand('piiProtect.detectInFile');
  });

  // Clear highlights when switching away from a document
  const onEditorChange = vscode.window.onDidChangeActiveTextEditor(() => {
    // Status bar goes back to idle when we change files so the count isn't stale
    statusMenu.setIdle();
  });

  context.subscriptions.push(
    setApiKey,
    connect,
    selectTeam,
    disconnect,
    openMenu,
    selectDocumentType,
    selectMode,
    toggleEnabled,
    toggleMcp,
    uriHandler,
    mcpRegistration,
    mcpProvider,
    oauth,
    preferences,
    onSave,
    onOpen,
    onEditorChange,
    statusMenu,
    highlighter,
  );
}

export function deactivate(): void {
  // Disposables are cleaned up via context.subscriptions
}
