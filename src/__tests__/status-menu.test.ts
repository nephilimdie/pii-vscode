import { beforeEach, describe, expect, it } from 'vitest';
import { __statusBarItems, EventEmitter } from 'vscode';
import { PseudoraOAuthClient } from '../oauth';
import { PseudoraStatusMenu } from '../status-menu';
import { PseudoraWorkspacePreferences } from '../workspace-preferences';

function preferences(values: Record<string, unknown> = {}): PseudoraWorkspacePreferences {
  return new PseudoraWorkspacePreferences({
    get: <T>(key: string, fallback?: T) => (key in values ? values[key] as T : fallback),
    update: async (key: string, value: unknown) => { values[key] = value; },
    keys: () => Object.keys(values),
  });
}

describe('Pseudora status menu', () => {
  beforeEach(() => {
    __statusBarItems.length = 0;
  });

  it('uses one explicit sign-in control when disconnected', async () => {
    const changed = new EventEmitter<void>();
    const oauth = {
      onDidChange: changed.event,
      status: async () => ({ connected: false }),
    } as unknown as PseudoraOAuthClient;
    const prefs = preferences();

    const status = new PseudoraStatusMenu(oauth, prefs);
    await status.refresh();

    expect(__statusBarItems).toHaveLength(1);
    expect(__statusBarItems[0]).toMatchObject({
      text: '$(sign-in) Pseudora: Sign in',
      command: 'piiProtect.openMenu',
    });

    status.dispose();
    prefs.dispose();
  });

  it('shows a single paused control for the workspace', async () => {
    const changed = new EventEmitter<void>();
    const oauth = {
      onDidChange: changed.event,
      status: async () => ({ connected: true, accountName: 'Stefano' }),
    } as unknown as PseudoraOAuthClient;
    const prefs = preferences({ 'piiProtect.enabled': false });

    const status = new PseudoraStatusMenu(oauth, prefs);
    await status.refresh();

    expect(__statusBarItems).toHaveLength(1);
    expect(__statusBarItems[0].text).toBe('$(circle-slash) Pseudora: Paused');

    status.dispose();
    prefs.dispose();
  });
});
