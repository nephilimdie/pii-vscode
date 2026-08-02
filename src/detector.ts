import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { getApiKey } from './config';
import { PseudoraSessionProvider } from './oauth';
import { PseudoraWorkspacePreferences, WorkspacePreferencesSnapshot } from './workspace-preferences';

export interface PiiMatch {
  type: string;
  text: string;
  start: number;
  end: number;
  score: number;
  line: number;
  character: number;
}

interface EngineDetectResponse {
  entities: Array<{
    entity_type?: string;
    type?: string;
    text?: string;
    start: number;
    end: number;
    score?: number;
    confidence?: number;
  }>;
}

interface EngineAnonymizeResponse {
  anonymized_text?: string;
  text?: string;
}

interface EngineDeanonymizeResponse {
  deanonymized_text?: string;
  text?: string;
}

export interface ProtectedText {
  text: string;
  contextId: string;
}

export class PiiDetector {
  /**
   * `secrets` is the extension's SecretStorage. It is optional so the class stays
   * constructible in tests, but in the real extension it is always supplied —
   * without it the key can only come from the deprecated settings entry.
   */
  constructor(
    private readonly secrets?: vscode.SecretStorage,
    private readonly oauth?: PseudoraSessionProvider,
    private readonly preferences?: PseudoraWorkspacePreferences,
  ) {}

  private async getConfig(): Promise<{ engineUrl: string; apiKey: string }> {
    const cfg = vscode.workspace.getConfiguration('piiProtect');
    return {
      engineUrl: cfg.get<string>('engineUrl', 'https://pseudora.cloud').replace(/\/$/, ''),
      apiKey: await getApiKey(this.secrets),
    };
  }

  private async buildHeaders(apiKey: string): Promise<Record<string, string>> {
    const oauthHeaders = await this.oauth?.requestHeaders(false);
    if (oauthHeaders) {
      return { ...oauthHeaders, 'Content-Type': 'application/json' };
    }

    if (apiKey) {
      return {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        'X-Pii-Client': 'vscode',
      };
    }

    const interactiveHeaders = await this.oauth?.requestHeaders(true);
    if (!interactiveHeaders) {
      return { 'Content-Type': 'application/json' };
    }
    return { ...interactiveHeaders, 'Content-Type': 'application/json' };
  }

  /**
   * Map a flat character offset in `text` to { line, character } (0-based).
   */
  private offsetToPosition(text: string, offset: number): { line: number; character: number } {
    let line = 0;
    let character = 0;
    for (let i = 0; i < offset && i < text.length; i++) {
      if (text[i] === '\n') {
        line++;
        character = 0;
      } else {
        character++;
      }
    }
    return { line, character };
  }

  async detect(text: string): Promise<PiiMatch[]> {
    const { engineUrl, apiKey } = await this.getConfig();
    const prefs = this.currentPreferences();

    let response: Response;
    try {
      response = await fetch(`${engineUrl}/v1/detect`, {
        method: 'POST',
        headers: await this.buildHeaders(apiKey),
        body: JSON.stringify(this.protectionPayload(text, prefs)),
      });
    } catch (err) {
      throw new Error(`Cannot reach PII engine at ${engineUrl}: ${String(err)}`);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`PII engine returned ${response.status}: ${body}`);
    }

    const data = (await response.json()) as EngineDetectResponse;

    return data.entities.map(entity => {
      const pos = this.offsetToPosition(text, entity.start);
      return {
        type: entity.entity_type || entity.type || 'UNKNOWN',
        text: entity.text || text.slice(entity.start, entity.end),
        start: entity.start,
        end: entity.end,
        score: entity.score ?? entity.confidence ?? 0,
        line: pos.line,
        character: pos.character,
      };
    });
  }

  async anonymize(text: string): Promise<string> {
    return (await this.anonymizeWithContext(text)).text;
  }

  async anonymizeWithContext(text: string): Promise<ProtectedText> {
    const { engineUrl, apiKey } = await this.getConfig();
    const prefs = this.currentPreferences();
    const contextId = `vscode_${randomUUID()}`;

    let response: Response;
    try {
      response = await fetch(`${engineUrl}/v1/anonymize`, {
        method: 'POST',
        headers: await this.buildHeaders(apiKey),
        body: JSON.stringify(this.protectionPayload(text, prefs, contextId)),
      });
    } catch (err) {
      throw new Error(`Cannot reach PII engine at ${engineUrl}: ${String(err)}`);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`PII engine returned ${response.status}: ${body}`);
    }

    const data = (await response.json()) as EngineAnonymizeResponse;
    const protectedText = data.anonymized_text ?? data.text;
    if (typeof protectedText !== 'string') {
      throw new Error('PII engine returned an invalid anonymization response.');
    }

    return { text: protectedText, contextId };
  }

  async deanonymize(text: string, contextId: string): Promise<string> {
    const { engineUrl, apiKey } = await this.getConfig();
    const prefs = this.currentPreferences();

    let response: Response;
    try {
      response = await fetch(`${engineUrl}/v1/deanonymize`, {
        method: 'POST',
        headers: await this.buildHeaders(apiKey),
        body: JSON.stringify(this.protectionPayload(text, prefs, contextId)),
      });
    } catch (err) {
      throw new Error(`Cannot reach PII engine at ${engineUrl}: ${String(err)}`);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`PII engine returned ${response.status}: ${body}`);
    }

    const data = (await response.json()) as EngineDeanonymizeResponse;
    const restoredText = data.deanonymized_text ?? data.text;
    if (typeof restoredText !== 'string') {
      throw new Error('PII engine returned an invalid deanonymization response.');
    }

    return restoredText;
  }

  private currentPreferences(): WorkspacePreferencesSnapshot {
    return this.preferences?.snapshot() ?? {
      enabled: true,
      mcpEnabled: true,
      documentType: 'generic',
      mode: 'tag',
      chatResponseMode: 'protected',
    };
  }

  private protectionPayload(
    text: string,
    preferences: WorkspacePreferencesSnapshot,
    contextId?: string,
  ): Record<string, string> {
    const payload: Record<string, string> = { text };
    if (contextId) {
      payload.context_id = contextId;
      payload.mode = preferences.mode;
    }

    if (preferences.documentType.startsWith('domain:')) {
      payload.domain = preferences.documentType.slice('domain:'.length);
    } else {
      payload.context_type = preferences.documentType;
    }

    return payload;
  }
}
