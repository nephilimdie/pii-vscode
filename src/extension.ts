import * as vscode from 'vscode';
import { PiiDetector } from './detector';
import { PiiHighlighter } from './highlighter';
import { registerCommands } from './commands';
import { PiiStatusBar } from './statusbar';
import { getConfig } from './config';

export function activate(context: vscode.ExtensionContext): void {
  const detector = new PiiDetector();
  const highlighter = new PiiHighlighter();
  const statusBar = new PiiStatusBar();

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

  context.subscriptions.push(onSave, onOpen, onEditorChange, statusBar, highlighter);
}

export function deactivate(): void {
  // Disposables are cleaned up via context.subscriptions
}
