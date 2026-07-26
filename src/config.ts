import * as vscode from 'vscode';

export interface PiiProtectConfig {
  engineUrl: string;
  apiKey: string;
  autoDetect: boolean;
  highlightColor: string;
}

export function getConfig(): PiiProtectConfig {
  const cfg = vscode.workspace.getConfiguration('piiProtect');
  return {
    engineUrl: cfg.get<string>('engineUrl', 'http://localhost:8000'),
    apiKey: cfg.get<string>('apiKey', ''),
    autoDetect: cfg.get<boolean>('autoDetect', false),
    highlightColor: cfg.get<string>('highlightColor', 'rgba(255,99,71,0.25)'),
  };
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
  return null;
}
