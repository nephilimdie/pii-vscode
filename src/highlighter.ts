import * as vscode from 'vscode';
import { PiiMatch } from './detector';

export class PiiHighlighter {
  private decorationType: vscode.TextEditorDecorationType | null = null;

  private getOrCreateDecorationType(): vscode.TextEditorDecorationType {
    const color = vscode.workspace
      .getConfiguration('piiProtect')
      .get<string>('highlightColor', 'rgba(255,99,71,0.25)');

    // Recreate if color may have changed
    if (this.decorationType) {
      this.decorationType.dispose();
    }

    this.decorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: color,
      border: '1px solid rgba(255,99,71,0.6)',
      borderRadius: '2px',
      overviewRulerColor: 'rgba(255,99,71,0.8)',
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });

    return this.decorationType;
  }

  highlightMatches(editor: vscode.TextEditor, matches: PiiMatch[]): void {
    const decorationType = this.getOrCreateDecorationType();

    const decorations: vscode.DecorationOptions[] = matches.map(match => {
      const startPos = new vscode.Position(match.line, match.character);
      // Calculate end position: text may span multiple lines, but in practice PII is single-line.
      // Use the length of the matched text for end character.
      const matchLength = match.end - match.start;
      const endPos = new vscode.Position(match.line, match.character + matchLength);
      const range = new vscode.Range(startPos, endPos);

      const hoverMessage = new vscode.MarkdownString(
        `**PII Detected**: \`${match.type}\`  \nConfidence: ${(match.score * 100).toFixed(0)}%  \nValue: \`${match.text}\``
      );

      return { range, hoverMessage };
    });

    editor.setDecorations(decorationType, decorations);
  }

  clearHighlights(editor: vscode.TextEditor): void {
    if (this.decorationType) {
      editor.setDecorations(this.decorationType, []);
    }
  }

  dispose(): void {
    if (this.decorationType) {
      this.decorationType.dispose();
      this.decorationType = null;
    }
  }
}
