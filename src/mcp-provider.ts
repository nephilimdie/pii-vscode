import * as vscode from 'vscode';
import { getConfig } from './config';
import { PseudoraSessionProvider } from './oauth';

export class PseudoraMcpProvider implements vscode.McpServerDefinitionProvider<vscode.McpHttpServerDefinition>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly sessionSubscription: vscode.Disposable;

  readonly onDidChangeMcpServerDefinitions = this.changed.event;

  constructor(private readonly sessions: PseudoraSessionProvider) {
    this.sessionSubscription = sessions.onDidChange(() => this.changed.fire());
  }

  provideMcpServerDefinitions(): vscode.McpHttpServerDefinition[] {
    const config = getConfig();
    const team = this.sessions.selectedTeamCode() || 'unselected';

    return [new vscode.McpHttpServerDefinition(
      'Pseudora',
      vscode.Uri.parse(config.mcpUrl),
      { 'X-Pii-Client': 'vscode' },
      `team:${team}`,
    )];
  }

  async resolveMcpServerDefinition(
    server: vscode.McpHttpServerDefinition,
    token: vscode.CancellationToken,
  ): Promise<vscode.McpHttpServerDefinition | undefined> {
    if (token.isCancellationRequested) {
      return undefined;
    }

    const headers = await this.sessions.requestHeaders(true);
    if (!headers || token.isCancellationRequested) {
      return undefined;
    }

    server.headers = headers;
    return server;
  }

  dispose(): void {
    this.sessionSubscription.dispose();
    this.changed.dispose();
  }
}
