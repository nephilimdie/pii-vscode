import * as vscode from 'vscode';

export class PiiStatusBar {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'piiProtect.detectInFile';
    this.item.tooltip = 'Click to run PII detection on this file';
    this.setIdle();
    this.item.show();
  }

  setIdle(): void {
    this.item.text = '$(shield) PII';
    this.item.color = undefined;
    this.item.backgroundColor = undefined;
  }

  setScanning(): void {
    this.item.text = '$(sync~spin) PII: Scanning…';
    this.item.color = undefined;
    this.item.backgroundColor = undefined;
  }

  setFound(count: number): void {
    this.item.text = `$(warning) PII: ${count} found`;
    this.item.color = new vscode.ThemeColor('statusBarItem.warningForeground');
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }

  setClean(): void {
    this.item.text = '$(pass) PII: Clean';
    this.item.color = new vscode.ThemeColor('statusBarItem.remoteForeground');
    this.item.backgroundColor = undefined;
  }

  setError(message: string): void {
    this.item.text = `$(error) PII: Error`;
    this.item.tooltip = message;
    this.item.color = new vscode.ThemeColor('statusBarItem.errorForeground');
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  }

  dispose(): void {
    this.item.dispose();
  }
}
