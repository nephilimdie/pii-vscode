import { describe, it, expect, beforeEach } from 'vitest';
import { API_KEY_SECRET, getApiKey, migrateApiKeyOutOfSettings } from '../config';
import { FakeSecretStorage, __setConfig, workspace } from '../__mocks__/vscode';

// vscode is aliased to src/__mocks__/vscode.ts via vitest.config.ts

function settingsKey(): string {
  return workspace.getConfiguration('piiProtect').get<string>('apiKey', '');
}

describe('API key storage', () => {
  beforeEach(() => {
    __setConfig({ apiKey: 'from-settings' });
  });

  it('prefers SecretStorage over the settings entry', async () => {
    const secrets = new FakeSecretStorage();
    await secrets.store(API_KEY_SECRET, 'from-keychain');

    expect(await getApiKey(secrets)).toBe('from-keychain');
  });

  it('falls back to settings when SecretStorage is empty', async () => {
    expect(await getApiKey(new FakeSecretStorage())).toBe('from-settings');
  });

  it('falls back to settings when there is no SecretStorage at all', async () => {
    expect(await getApiKey(undefined)).toBe('from-settings');
  });

  it('migration moves the key into SecretStorage and clears the setting', async () => {
    const secrets = new FakeSecretStorage();

    await migrateApiKeyOutOfSettings(secrets);

    expect(await secrets.get(API_KEY_SECRET)).toBe('from-settings');
    expect(settingsKey()).toBe('');
  });

  it('migration does not overwrite a key already in SecretStorage', async () => {
    const secrets = new FakeSecretStorage();
    await secrets.store(API_KEY_SECRET, 'already-there');

    await migrateApiKeyOutOfSettings(secrets);

    expect(await secrets.get(API_KEY_SECRET)).toBe('already-there');
    // The stale plaintext copy is cleared regardless.
    expect(settingsKey()).toBe('');
  });

  it('migration is a no-op when settings hold no key', async () => {
    __setConfig({ apiKey: '' });
    const secrets = new FakeSecretStorage();

    await migrateApiKeyOutOfSettings(secrets);

    expect(await secrets.get(API_KEY_SECRET)).toBeUndefined();
  });
});
