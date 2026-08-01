import * as vscode from 'vscode';
import { PseudoraOAuthClient } from './oauth';

export class PseudoraTeamStatus implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  private readonly sessionSubscription: vscode.Disposable;

  constructor(private readonly oauth: PseudoraOAuthClient) {
    this.sessionSubscription = oauth.onDidChange(() => void this.refresh());
    this.item.show();
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const status = await this.oauth.status();
    if (!status.connected) {
      this.item.text = '$(account) Pseudora';
      this.item.tooltip = 'Connect your Pseudora account';
      this.item.command = 'piiProtect.connect';
      return;
    }

    this.item.text = status.team
      ? `$(organization) ${status.team.name}`
      : '$(organization) Select Pseudora team';
    this.item.tooltip = status.team
      ? `${status.accountName} · ${status.team.tenant_code}`
      : `${status.accountName} · select a team for this workspace`;
    this.item.command = 'piiProtect.selectTeam';
  }

  dispose(): void {
    this.sessionSubscription.dispose();
    this.item.dispose();
  }
}
