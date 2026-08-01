import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'vscode';
import { PseudoraMcpProvider } from '../mcp-provider';
import { PseudoraSessionProvider } from '../oauth';

describe('Pseudora MCP provider', () => {
  it('keeps credentials out of discovery and adds them only when resolved', async () => {
    const changed = new EventEmitter<void>();
    const sessions: PseudoraSessionProvider = {
      onDidChange: changed.event,
      selectedTeamCode: () => 'team-blue',
      requestHeaders: async () => ({
        Authorization: 'Bearer oauth-token',
        'X-Team-ID': 'team-blue',
        'X-Pii-Client': 'vscode',
      }),
    };
    const provider = new PseudoraMcpProvider(sessions);

    const [server] = provider.provideMcpServerDefinitions();
    expect(server.uri.toString()).toBe('https://mcp.pseudora.cloud/mcp');
    expect(server.headers).toEqual({ 'X-Pii-Client': 'vscode' });

    const resolved = await provider.resolveMcpServerDefinition(
      server,
      { isCancellationRequested: false } as never,
    );
    expect(resolved?.headers).toEqual({
      Authorization: 'Bearer oauth-token',
      'X-Team-ID': 'team-blue',
      'X-Pii-Client': 'vscode',
    });

    provider.dispose();
  });
});
