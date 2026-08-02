import * as vscode from 'vscode';
import { PseudoraOAuthClient } from './oauth';
import { PseudoraWorkspacePreferences } from './workspace-preferences';

type OperationState =
  | { type: 'idle' }
  | { type: 'scanning' }
  | { type: 'found'; count: number }
  | { type: 'clean' }
  | { type: 'error'; message: string };

interface MenuItem extends vscode.QuickPickItem {
  action: 'connect' | 'team' | 'document' | 'mode' | 'toggle' | 'detect' | 'disconnect';
}

export interface PseudoraOperationStatus {
  setIdle(): void;
  setScanning(): void;
  setFound(count: number): void;
  setClean(): void;
  setError(message: string): void;
}

export class PseudoraStatusMenu implements vscode.Disposable, PseudoraOperationStatus {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  private readonly subscriptions: vscode.Disposable[];
  private operation: OperationState = { type: 'idle' };

  constructor(
    private readonly oauth: PseudoraOAuthClient,
    private readonly preferences: PseudoraWorkspacePreferences,
  ) {
    this.subscriptions = [
      oauth.onDidChange(() => void this.refresh()),
      preferences.onDidChange(() => void this.refresh()),
    ];
    this.item.command = 'piiProtect.openMenu';
    this.item.show();
    void this.refresh();
  }

  async open(): Promise<void> {
    const account = await this.oauth.status();
    const prefs = this.preferences.snapshot();
    const items: MenuItem[] = [];

    if (!account.connected) {
      items.push({ label: '$(sign-in) Sign in to Pseudora', action: 'connect' });
    } else {
      items.push(
        {
          label: `$(organization) Team: ${account.team?.name || 'select team'}`,
          description: account.team?.tenant_code,
          action: 'team',
        },
        {
          label: `$(file-text) Document type: ${displayValue(prefs.documentType)}`,
          description: 'Select policy and detection rules',
          action: 'document',
        },
        {
          label: `$(symbol-keyword) Mode: ${modeLabel(prefs.mode)}`,
          description: prefs.mode === 'tag' ? 'Reversible placeholders' : 'Realistic fake values',
          action: 'mode',
        },
      );
    }

    items.push({
      label: prefs.enabled ? '$(debug-pause) Pause in this workspace' : '$(play) Resume in this workspace',
      description: prefs.enabled ? 'Disable editor commands and MCP temporarily' : 'Enable editor commands and MCP',
      action: 'toggle',
    });

    if (account.connected && prefs.enabled) {
      items.push({ label: '$(search) Detect PII in active file', action: 'detect' });
    }
    if (account.connected) {
      items.push({ label: '$(sign-out) Disconnect account', action: 'disconnect' });
    }

    const selected = await vscode.window.showQuickPick(items, {
      title: 'Pseudora workspace controls',
      placeHolder: 'Choose an action',
      ignoreFocusOut: true,
    });
    if (!selected) {
      return;
    }

    await this.run(selected.action);
  }

  setIdle(): void {
    this.operation = { type: 'idle' };
    void this.refresh();
  }

  setScanning(): void {
    this.operation = { type: 'scanning' };
    void this.refresh();
  }

  setFound(count: number): void {
    this.operation = { type: 'found', count };
    void this.refresh();
  }

  setClean(): void {
    this.operation = { type: 'clean' };
    void this.refresh();
  }

  setError(message: string): void {
    this.operation = { type: 'error', message };
    void this.refresh();
  }

  dispose(): void {
    this.subscriptions.forEach(subscription => subscription.dispose());
    this.item.dispose();
  }

  private async run(action: MenuItem['action']): Promise<void> {
    switch (action) {
      case 'connect':
        await vscode.commands.executeCommand('piiProtect.connect');
        break;
      case 'team':
        await this.oauth.selectTeam();
        await this.reconcileDocumentType();
        break;
      case 'document':
        await this.selectDocumentType();
        break;
      case 'mode':
        await this.selectMode();
        break;
      case 'toggle': {
        await this.toggleEnabled();
        break;
      }
      case 'detect':
        await vscode.commands.executeCommand('piiProtect.detectInFile');
        break;
      case 'disconnect':
        await vscode.commands.executeCommand('piiProtect.disconnect');
        break;
    }
  }

  async toggleEnabled(): Promise<void> {
    const enabled = await this.preferences.toggle();
    void vscode.window.showInformationMessage(`Pseudora ${enabled ? 'resumed' : 'paused'} for this workspace.`);
  }

  async selectDocumentType(): Promise<void> {
    try {
      const types = await this.oauth.documentTypes();
      if (types.length === 0) {
        void vscode.window.showWarningMessage('No Pseudora document types are available for this team and client.');
        return;
      }
      const selected = await vscode.window.showQuickPick(
        types.map(type => ({
          label: type.display_name || type.name || displayValue(type.code),
          description: `${type.code} · default ${modeLabel(type.default_mode)}`,
          detail: type.description,
          type,
        })),
        { title: 'Select the Pseudora document type', ignoreFocusOut: true },
      );
      if (selected) {
        await this.preferences.setDocumentType(selected.type.code, selected.type.default_mode);
      }
    } catch (error) {
      void vscode.window.showErrorMessage(`Could not load Pseudora document types: ${String(error)}`);
    }
  }

  async selectMode(): Promise<void> {
    const selected = await vscode.window.showQuickPick([
      { label: 'Tag masking', description: 'Reversible placeholders such as [PERSON_1]', mode: 'tag' as const },
      { label: 'Realistic surrogate', description: 'Reversible fake values preserving format', mode: 'surrogate' as const },
    ], { title: 'Select the Pseudora anonymization mode', ignoreFocusOut: true });
    if (selected) {
      await this.preferences.setMode(selected.mode);
    }
  }

  async reconcileDocumentType(): Promise<void> {
    const current = this.preferences.snapshot().documentType;
    try {
      const types = await this.oauth.documentTypes();
      if (!types.some(type => type.code === current)) {
        const fallback = types.find(type => ['generic', 'default'].includes(type.code)) || types[0];
        if (fallback) {
          await this.preferences.setDocumentType(fallback.code, fallback.default_mode);
        }
      }
    } catch {
      // The API reports actionable errors when the user explicitly opens the picker.
    }
  }

  async refresh(): Promise<void> {
    const prefs = this.preferences.snapshot();
    const account = await this.oauth.status();

    if (!prefs.enabled) {
      this.item.text = '$(circle-slash) Pseudora: Paused';
      this.item.tooltip = 'Pseudora is disabled for this workspace. Click to resume.';
      this.clearColors();
      return;
    }
    if (!account.connected) {
      this.item.text = '$(sign-in) Pseudora: Sign in';
      this.item.tooltip = 'Sign in to configure team, document type, mode, and MCP.';
      this.clearColors();
      return;
    }

    this.clearColors();
    if (this.operation.type === 'scanning') {
      this.item.text = '$(sync~spin) Pseudora: Scanning';
    } else if (this.operation.type === 'found') {
      this.item.text = `$(warning) Pseudora: ${this.operation.count} PII`;
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else if (this.operation.type === 'error') {
      this.item.text = '$(error) Pseudora: Error';
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else {
      this.item.text = `$(shield) Pseudora · ${account.team?.name || 'team?'} · ${displayValue(prefs.documentType)} · ${modeLabel(prefs.mode)}`;
      this.clearColors();
    }

    const operationDetail = this.operation.type === 'error' ? `\nError: ${this.operation.message}` : '';
    this.item.tooltip = [
      `Account: ${account.accountName}`,
      `Team: ${account.team?.name || 'not selected'}`,
      `Document type: ${prefs.documentType}`,
      `Mode: ${modeLabel(prefs.mode)}`,
    ].join('\n') + operationDetail;
  }

  private clearColors(): void {
    this.item.color = undefined;
    this.item.backgroundColor = undefined;
  }
}

function displayValue(value: string): string {
  return value.replace(/^domain:/, '').replace(/_/g, ' ');
}

function modeLabel(mode: string): string {
  return mode === 'surrogate' ? 'Surrogate' : 'Tag';
}
