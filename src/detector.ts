import * as vscode from 'vscode';

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
    entity_type: string;
    text: string;
    start: number;
    end: number;
    score: number;
  }>;
}

interface EngineAnonymizeResponse {
  anonymized_text: string;
}

export class PiiDetector {
  private getConfig(): { engineUrl: string; apiKey: string } {
    const cfg = vscode.workspace.getConfiguration('piiProtect');
    return {
      engineUrl: cfg.get<string>('engineUrl', 'http://localhost:8000'),
      apiKey: cfg.get<string>('apiKey', ''),
    };
  }

  private buildHeaders(apiKey: string): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }
    return headers;
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
    const { engineUrl, apiKey } = this.getConfig();

    let response: Response;
    try {
      response = await fetch(`${engineUrl}/v1/detect`, {
        method: 'POST',
        headers: this.buildHeaders(apiKey),
        body: JSON.stringify({ text }),
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
        type: entity.entity_type,
        text: entity.text,
        start: entity.start,
        end: entity.end,
        score: entity.score,
        line: pos.line,
        character: pos.character,
      };
    });
  }

  async anonymize(text: string): Promise<string> {
    const { engineUrl, apiKey } = this.getConfig();

    let response: Response;
    try {
      response = await fetch(`${engineUrl}/v1/anonymize`, {
        method: 'POST',
        headers: this.buildHeaders(apiKey),
        body: JSON.stringify({
          text,
          context_id:   `vscode_${Date.now()}`,
          context_type: 'generic',
        }),
      });
    } catch (err) {
      throw new Error(`Cannot reach PII engine at ${engineUrl}: ${String(err)}`);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`PII engine returned ${response.status}: ${body}`);
    }

    const data = (await response.json()) as EngineAnonymizeResponse;
    return data.anonymized_text;
  }
}
