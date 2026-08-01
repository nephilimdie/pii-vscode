import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __setConfig } from 'vscode';
import { PseudoraOAuthApi } from '../oauth-api';

describe('Pseudora OAuth API', () => {
  beforeEach(() => {
    __setConfig({ engineUrl: 'https://pseudora.test' });
    vi.unstubAllGlobals();
  });

  it('discovers the VS Code client and refreshes a public PKCE token', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ client_id: 'vscode-client' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'new-token', expires_in: 3600 }),
      });
    vi.stubGlobal('fetch', fetchSpy);
    const api = new PseudoraOAuthApi();

    expect(await api.clientId()).toBe('vscode-client');
    await api.refresh('vscode-client', 'refresh-token');

    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://pseudora.test/oauth/client-info?client_type=vscode',
    );
    const refreshBody = JSON.parse(fetchSpy.mock.calls[1][1].body as string);
    expect(refreshBody).toEqual({
      grant_type: 'refresh_token',
      client_id: 'vscode-client',
      refresh_token: 'refresh-token',
    });
  });

  it('loads the account and team list with the bearer token', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 7,
        name: 'Stefano',
        email: 'stefano@example.test',
        teams: [{ id: 1, tenant_code: 'team-blue', name: 'Blue' }],
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const profile = await new PseudoraOAuthApi().profile('oauth-token');

    expect(profile.teams[0].tenant_code).toBe('team-blue');
    expect(fetchSpy.mock.calls[0][1].headers).toMatchObject({
      Authorization: 'Bearer oauth-token',
      'X-Pii-Client': 'vscode',
    });
  });
});
