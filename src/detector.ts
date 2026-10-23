import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import createClient, { type Client } from 'openapi-fetch';
import type { components, paths } from './generated/pseudora-api';
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

type Schemas = components['schemas'];
type CoreResult<T> = { data?: T; error?: unknown; response: Response };
type CoreInit = { headers: Record<string, string>; signal: AbortSignal; redirect: 'error' };

/** A hung engine call must fail (and withhold the text), not wait forever. */
const REQUEST_TIMEOUT_MS = 60_000;
const INVALID_RESPONSE = 'PII engine returned an invalid response.';

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
    private readonly timeoutMs = REQUEST_TIMEOUT_MS,
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

  /**
   * Why: one place enforces timeout, redirect refusal and the fail-closed response checks.
   * What: runs a generated-core call against the configured engine; returns the 2xx JSON
   * object body or throws ("Cannot reach", "returned <status>", or invalid response).
   * Test: detector.test.ts mocks fetch for network error, timeout, non-2xx and malformed bodies.
   */
  private async request<T>(
    send: (core: Client<paths>, init: CoreInit) => Promise<CoreResult<T>>,
  ): Promise<Partial<T>> {
    const { engineUrl, apiKey } = await this.getConfig();
    // `fetch` is resolved per call so a replaced global (tests, proxies) is honoured.
    const core = createClient<paths>({ baseUrl: engineUrl, fetch: request => fetch(request) });
    const init: CoreInit = {
      headers: await this.buildHeaders(apiKey),
      signal: AbortSignal.timeout(this.timeoutMs),
      redirect: 'error',
    };

    let result: CoreResult<T>;
    try {
      // The core reads the body before resolving, so the timeout covers it too.
      result = await send(core, init);
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error(INVALID_RESPONSE);
      }
      throw new Error(`Cannot reach PII engine at ${engineUrl}: ${String(err)}`);
    }

    const { data, error, response } = result;
    if (!response.ok) {
      const body = typeof error === 'string' ? error : JSON.stringify(error ?? '');
      throw new Error(`PII engine returned ${response.status}: ${body}`);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error(INVALID_RESPONSE);
    }
    return data as Partial<T>;
  }

  async detect(text: string): Promise<PiiMatch[]> {
    const policy = this.policyFields(this.currentPreferences());
    const data = await this.request((core, init) => core.POST('/v1/detect', {
      ...init,
      // DetectRequest has no `domain`; the engine ignored it, so domain policies send none.
      body: { text, context_type: 'context_type' in policy ? policy.context_type : undefined },
    }));
    if (!Array.isArray(data.entities)) {
      throw new Error(INVALID_RESPONSE);
    }

    return data.entities.map(entity => {
      const pos = this.offsetToPosition(text, entity.start);
      return {
        type: entity.type || 'UNKNOWN',
        text: entity.value || text.slice(entity.start, entity.end),
        start: entity.start,
        end: entity.end,
        score: entity.confidence ?? 0,
        line: pos.line,
        character: pos.character,
      };
    });
  }

  async anonymize(text: string): Promise<string> {
    return (await this.anonymizeWithContext(text)).text;
  }

  async anonymizeWithContext(text: string): Promise<ProtectedText> {
    const prefs = this.currentPreferences();
    const contextId = `vscode_${randomUUID()}`;
    const body: Schemas['AnonymizeRequest'] = {
      text, context_id: contextId, mode: prefs.mode, ...this.policyFields(prefs),
    };
    const data = await this.request((core, init) => core.POST('/v1/anonymize', { ...init, body }));
    // Only the spec field counts: a `text` echo must never be mistaken for protected output.
    const protectedText = data.anonymized_text;
    if (data.safe !== true || typeof protectedText !== 'string') {
      throw new Error('PII engine returned an invalid anonymization response.');
    }

    return { text: protectedText, contextId };
  }

  async deanonymize(text: string, contextId: string): Promise<string> {
    const data = await this.request((core, init) => core.POST('/v1/deanonymize', {
      ...init,
      // The engine looks mappings up by the context they were stored under:
      // `context_type`, or the domain slug when a domain policy was used.
      body: { text, context_id: contextId, context_type: this.mappingContext(this.currentPreferences()) },
    }));
    const restoredText = data.restored_text;
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

  /**
   * Why: anonymize stores mappings under `context_type || domain`; restore must use the same key.
   * What: returns the domain slug for `domain:<slug>` document types, else the document type.
   * Test: deanonymize with documentType 'domain:legal' posts context_type 'legal'.
   */
  private mappingContext(preferences: WorkspacePreferencesSnapshot): string {
    return preferences.documentType.replace(/^domain:/, '');
  }

  /**
   * Why: the workspace document type is either a context type or `domain:<slug>`.
   * What: maps it to the AnonymizeRequest selector, `{ domain }` or `{ context_type }`.
   * Test: anonymize with documentType 'domain:legal' posts domain 'legal' and no context_type.
   */
  private policyFields(
    preferences: WorkspacePreferencesSnapshot,
  ): { domain: string } | { context_type: string } {
    return preferences.documentType.startsWith('domain:')
      ? { domain: this.mappingContext(preferences) }
      : { context_type: preferences.documentType };
  }
}
