import * as vscode from 'vscode';

export interface PiiProtectConfig {
  engineUrl: string;
  mcpUrl: string;
  apiKey: string;
  autoDetect: boolean;
  highlightColor: string;
}

/** SecretStorage key. Settings are stored in plaintext and travel through
 *  Settings Sync, so the API key must never live there. */
export const API_KEY_SECRET = 'piiProtect.apiKey';

export function getConfig(): PiiProtectConfig {
  const cfg = vscode.workspace.getConfiguration('piiProtect');
  return {
    engineUrl: cfg.get<string>('engineUrl', 'https://pseudora.cloud').replace(/\/$/, ''),
    mcpUrl: cfg.get<string>('mcpUrl', 'https://mcp.pseudora.cloud/mcp'),
    apiKey: cfg.get<string>('apiKey', ''),
    autoDetect: cfg.get<boolean>('autoDetect', false),
    highlightColor: cfg.get<string>('highlightColor', 'rgba(255,99,71,0.25)'),
  };
}

/**
 * The API key, preferring SecretStorage and falling back to the deprecated
 * settings entry so an existing install keeps working until it is migrated.
 */
export async function getApiKey(secrets?: vscode.SecretStorage): Promise<string> {
  const stored = await secrets?.get(API_KEY_SECRET);
  if (stored) {
    return stored;
  }
  return vscode.workspace.getConfiguration('piiProtect').get<string>('apiKey', '');
}

/** Prompt for a key and put it in SecretStorage. */
export async function promptForApiKey(secrets: vscode.SecretStorage): Promise<boolean> {
  const key = await vscode.window.showInputBox({
    title: 'PII Protect API key',
    prompt: 'Paste the key from Pseudora → Cloud → Customer keys',
    password: true,
    ignoreFocusOut: true,
  });

  if (!key) {
    return false;
  }

  await secrets.store(API_KEY_SECRET, key.trim());
  return true;
}

/**
 * Move a key left in settings.json into SecretStorage and clear the setting.
 * Runs once on activation; a key already in SecretStorage wins and the stale
 * setting is simply cleared.
 */
export async function migrateApiKeyOutOfSettings(secrets: vscode.SecretStorage): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('piiProtect');
  const inSettings = cfg.get<string>('apiKey', '');

  if (!inSettings) {
    return;
  }

  if (!(await secrets.get(API_KEY_SECRET))) {
    await secrets.store(API_KEY_SECRET, inSettings.trim());
  }

  for (const target of [vscode.ConfigurationTarget.Global, vscode.ConfigurationTarget.Workspace]) {
    try {
      await cfg.update('apiKey', undefined, target);
    } catch {
      // Target not applicable (e.g. no workspace open) — nothing to clear there.
    }
  }

  void vscode.window.showInformationMessage(
    'Pseudora: your API key was moved out of settings.json into the OS keychain. ' +
    'Settings Sync no longer carries it.',
  );
}

export function validateConfig(config: PiiProtectConfig): string | null {
  if (!config.engineUrl) {
    return 'piiProtect.engineUrl is not set. Please configure it in VS Code settings.';
  }
  try {
    new URL(config.engineUrl);
  } catch {
    return `piiProtect.engineUrl "${config.engineUrl}" is not a valid URL.`;
  }
  if (!config.mcpUrl) {
    return 'piiProtect.mcpUrl is not set. Please configure it in VS Code settings.';
  }
  try {
    new URL(config.mcpUrl);
  } catch {
    return `piiProtect.mcpUrl "${config.mcpUrl}" is not a valid URL.`;
  }
  return null;
}
