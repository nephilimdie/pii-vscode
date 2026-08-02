import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'vscode';
import { PseudoraMcpProvider } from '../mcp-provider';
import { PseudoraSessionProvider } from '../oauth';
import { PseudoraWorkspacePreferences } from '../workspace-preferences';

function preferences(enabled = true): PseudoraWorkspacePreferences {
  const values: Record<string, unknown> = {
    'piiProtect.enabled': enabled,
    'piiProtect.documentType': 'fine_appeal',
    'piiProtect.mode': 'surrogate',
  };
  return new PseudoraWorkspacePreferences({
    get: <T>(key: string, fallback?: T) => (key in values ? values[key] as T : fallback),
    update: async (key: string, value: unknown) => { values[key] = value; },
    keys: () => Object.keys(values),
  });
}

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
    const prefs = preferences();
    const provider = new PseudoraMcpProvider(sessions, prefs);

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
      'X-Pii-Document-Type': 'fine_appeal',
      'X-Pii-Mode': 'surrogate',
    });

    provider.dispose();
    prefs.dispose();
  });

  it('removes the MCP server while the workspace is paused', () => {
    const changed = new EventEmitter<void>();
    const sessions = {
      onDidChange: changed.event,
      selectedTeamCode: () => 'team-blue',
      requestHeaders: async () => undefined,
    } as PseudoraSessionProvider;
    const prefs = preferences(false);
    const provider = new PseudoraMcpProvider(sessions, prefs);

    expect(provider.provideMcpServerDefinitions()).toEqual([]);

    provider.dispose();
    prefs.dispose();
  });
});
