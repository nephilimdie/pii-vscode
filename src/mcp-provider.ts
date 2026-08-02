import * as vscode from 'vscode';
import { getConfig } from './config';
import { PseudoraSessionProvider } from './oauth';
import { PseudoraWorkspacePreferences } from './workspace-preferences';

export class PseudoraMcpProvider implements vscode.McpServerDefinitionProvider<vscode.McpHttpServerDefinition>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly subscriptions: vscode.Disposable[];

  readonly onDidChangeMcpServerDefinitions = this.changed.event;

  constructor(
    private readonly sessions: PseudoraSessionProvider,
    private readonly preferences: PseudoraWorkspacePreferences,
  ) {
    this.subscriptions = [
      sessions.onDidChange(() => this.changed.fire()),
      preferences.onDidChange(() => this.changed.fire()),
    ];
  }

  provideMcpServerDefinitions(): vscode.McpHttpServerDefinition[] {
    const preferences = this.preferences.snapshot();
    if (!preferences.enabled || !preferences.mcpEnabled) {
      return [];
    }

    const config = getConfig();
    const team = this.sessions.selectedTeamCode() || 'unselected';

    return [new vscode.McpHttpServerDefinition(
      'Pseudora',
      vscode.Uri.parse(config.mcpUrl),
      { 'X-Pii-Client': 'vscode' },
      `team:${team}|document:${preferences.documentType}|mode:${preferences.mode}`,
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

    const preferences = this.preferences.snapshot();
    if (!preferences.enabled || !preferences.mcpEnabled) {
      return undefined;
    }

    server.headers = {
      ...headers,
      'X-Pii-Document-Type': preferences.documentType,
      'X-Pii-Mode': preferences.mode,
    };
    return server;
  }

  dispose(): void {
    this.subscriptions.forEach(subscription => subscription.dispose());
    this.changed.dispose();
  }
}
