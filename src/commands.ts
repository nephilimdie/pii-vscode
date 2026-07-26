import * as vscode from 'vscode';
import { PiiDetector, PiiMatch } from './detector';
import { PiiHighlighter } from './highlighter';
import { PiiStatusBar } from './statusbar';
import { getConfig, validateConfig } from './config';

// Per-document match cache so other commands (clear, etc.) can reference last results.
const lastMatches = new Map<string, PiiMatch[]>();

async function runDetection(
  editor: vscode.TextEditor,
  detector: PiiDetector,
  highlighter: PiiHighlighter,
  statusBar: PiiStatusBar
): Promise<PiiMatch[]> {
  const config = getConfig();
  const validationError = validateConfig(config);
  if (validationError) {
    vscode.window.showErrorMessage(validationError);
    statusBar.setError(validationError);
    return [];
  }

  statusBar.setScanning();

  let matches: PiiMatch[];
  try {
    matches = await detector.detect(editor.document.getText());
  } catch (err) {
    const msg = String(err);
    vscode.window.showErrorMessage(`PII detection failed: ${msg}`);
    statusBar.setError(msg);
    return [];
  }

  lastMatches.set(editor.document.uri.toString(), matches);

  if (matches.length > 0) {
    highlighter.highlightMatches(editor, matches);
    statusBar.setFound(matches.length);

    // Build a summary grouped by type
    const byType = new Map<string, number>();
    for (const m of matches) {
      byType.set(m.type, (byType.get(m.type) ?? 0) + 1);
    }
    const summary = [...byType.entries()]
      .map(([type, count]) => `${type}: ${count}`)
      .join(', ');
    vscode.window.showWarningMessage(`PII found in file — ${summary}`);
  } else {
    highlighter.clearHighlights(editor);
    statusBar.setClean();
    vscode.window.showInformationMessage('No PII detected in this file.');
  }

  return matches;
}

export function registerCommands(
  context: vscode.ExtensionContext,
  detector: PiiDetector,
  highlighter: PiiHighlighter,
  statusBar: PiiStatusBar
): void {
  // ── Detect in file ──────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('piiProtect.detectInFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor.');
        return;
      }
      await runDetection(editor, detector, highlighter, statusBar);
    })
  );

  // ── Anonymize selection ─────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('piiProtect.anonymizeSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor.');
        return;
      }

      const selection = editor.selection;
      if (selection.isEmpty) {
        vscode.window.showWarningMessage('No text selected. Select the text you want to anonymize.');
        return;
      }

      const config = getConfig();
      const validationError = validateConfig(config);
      if (validationError) {
        vscode.window.showErrorMessage(validationError);
        return;
      }

      const selectedText = editor.document.getText(selection);
      statusBar.setScanning();

      let anonymized: string;
      try {
        anonymized = await detector.anonymize(selectedText);
      } catch (err) {
        const msg = String(err);
        vscode.window.showErrorMessage(`Anonymization failed: ${msg}`);
        statusBar.setError(msg);
        return;
      }

      await editor.edit(editBuilder => {
        editBuilder.replace(selection, anonymized);
      });

      highlighter.clearHighlights(editor);
      statusBar.setClean();
      vscode.window.showInformationMessage('Selection anonymized.');
    })
  );

  // ── Anonymize entire file ───────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('piiProtect.anonymizeFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor.');
        return;
      }

      const config = getConfig();
      const validationError = validateConfig(config);
      if (validationError) {
        vscode.window.showErrorMessage(validationError);
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        'This will replace the entire file content with its anonymized version. Continue?',
        { modal: true },
        'Yes, anonymize'
      );
      if (confirm !== 'Yes, anonymize') {
        return;
      }

      const fullText = editor.document.getText();
      statusBar.setScanning();

      let anonymized: string;
      try {
        anonymized = await detector.anonymize(fullText);
      } catch (err) {
        const msg = String(err);
        vscode.window.showErrorMessage(`Anonymization failed: ${msg}`);
        statusBar.setError(msg);
        return;
      }

      const fullRange = new vscode.Range(
        editor.document.positionAt(0),
        editor.document.positionAt(fullText.length)
      );

      await editor.edit(editBuilder => {
        editBuilder.replace(fullRange, anonymized);
      });

      highlighter.clearHighlights(editor);
      lastMatches.delete(editor.document.uri.toString());
      statusBar.setClean();
      vscode.window.showInformationMessage('File anonymized.');
    })
  );

  // ── Clear highlights ────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('piiProtect.clearHighlights', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      highlighter.clearHighlights(editor);
      lastMatches.delete(editor.document.uri.toString());
      statusBar.setIdle();
    })
  );
}
