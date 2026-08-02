import { describe, expect, it } from 'vitest';
import { PseudoraWorkspacePreferences } from '../workspace-preferences';

function subject(): PseudoraWorkspacePreferences {
  const values: Record<string, unknown> = {};
  return new PseudoraWorkspacePreferences({
    get: <T>(key: string, fallback?: T) => (key in values ? values[key] as T : fallback),
    update: async (key: string, value: unknown) => { values[key] = value; },
    keys: () => Object.keys(values),
  });
}

describe('workspace preferences', () => {
  it('stores pause, document type, and mode in the workspace', async () => {
    const preferences = subject();

    expect(preferences.snapshot()).toEqual({
      enabled: true,
      mcpEnabled: true,
      documentType: 'generic',
      mode: 'tag',
    });
    await preferences.setDocumentType('fine_appeal', 'surrogate');
    expect(preferences.snapshot()).toMatchObject({ documentType: 'fine_appeal', mode: 'surrogate' });
    await preferences.toggle();
    expect(preferences.snapshot().enabled).toBe(false);
    await preferences.toggleMcp();
    expect(preferences.snapshot().mcpEnabled).toBe(false);

    preferences.dispose();
  });
});
