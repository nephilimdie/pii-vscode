import * as vscode from 'vscode';
import { PiiDetector } from './detector';
import { PiiHighlighter } from './highlighter';
import { registerCommands } from './commands';
import { PiiStatusBar } from './statusbar';
import { getConfig, migrateApiKeyOutOfSettings, promptForApiKey } from './config';
import { PseudoraOAuthClient } from './oauth';
import { PseudoraMcpProvider } from './mcp-provider';
import { PseudoraTeamStatus } from './team-status';

export function activate(context: vscode.ExtensionContext): void {
  const oauth = new PseudoraOAuthClient(context);
  const detector = new PiiDetector(context.secrets, oauth);
  const highlighter = new PiiHighlighter();
  const statusBar = new PiiStatusBar();
  const teamStatus = new PseudoraTeamStatus(oauth);
  const mcpProvider = new PseudoraMcpProvider(oauth);

  // Lift any key left in settings.json into the OS keychain.
  void migrateApiKeyOutOfSettings(context.secrets);

  const setApiKey = vscode.commands.registerCommand('piiProtect.setApiKey', async () => {
    if (await promptForApiKey(context.secrets)) {
      void vscode.window.showInformationMessage('PII Protect: API key saved to the OS keychain.');
    }
  });

  const connect = vscode.commands.registerCommand('piiProtect.connect', async () => {
    try {
      await oauth.connect();
      void vscode.window.showInformationMessage('Pseudora account connected.');
    } catch (error) {
      void vscode.window.showErrorMessage(`Pseudora login failed: ${String(error)}`);
    }
  });

  const selectTeam = vscode.commands.registerCommand('piiProtect.selectTeam', async () => {
    try {
      const team = await oauth.selectTeam();
      if (team) {
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

  const uriHandler = vscode.window.registerUriHandler(oauth);
  const mcpRegistration = vscode.lm.registerMcpServerDefinitionProvider('pseudora.mcp', mcpProvider);

  // Register all commands
  registerCommands(context, detector, highlighter, statusBar);

  // Auto-detect on save if enabled
  const onSave = vscode.workspace.onDidSaveTextDocument(async (doc: vscode.TextDocument) => {
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
    statusBar.setIdle();
  });

  context.subscriptions.push(
    setApiKey,
    connect,
    selectTeam,
    disconnect,
    uriHandler,
    mcpRegistration,
    mcpProvider,
    oauth,
    teamStatus,
    onSave,
    onOpen,
    onEditorChange,
    statusBar,
    highlighter,
  );
}

export function deactivate(): void {
  // Disposables are cleaned up via context.subscriptions
}
