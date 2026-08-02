import { getConfig } from './config';

export interface PseudoraTeam {
  id: string | number;
  tenant_code: string;
  name: string;
}

export interface PseudoraProfile {
  id: string | number;
  name: string;
  email: string;
  teams: PseudoraTeam[];
}

export interface PseudoraDocumentType {
  code: string;
  name?: string;
  display_name?: string;
  default_mode: 'tag' | 'surrogate';
  description?: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

export class PseudoraOAuthApi {
  async clientId(): Promise<string> {
    const response = await fetch(`${this.baseUrl()}/oauth/client-info?client_type=vscode`, {
      headers: { Accept: 'application/json' },
    });
    const body = await response.json() as { client_id?: string; error?: string };
    if (!response.ok || !body.client_id) {
      if (body.error === 'not_configured') {
        throw new Error('Pseudora sign-in is temporarily unavailable. Please contact support.');
      }
      throw new Error(body.error || `OAuth client discovery failed (${response.status}).`);
    }
    return body.client_id;
  }

  async exchangeCode(
    clientId: string,
    code: string,
    verifier: string,
    callbackUri: string,
  ): Promise<TokenResponse> {
    return this.tokens({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: callbackUri,
    });
  }

  async refresh(clientId: string, refreshToken: string): Promise<TokenResponse> {
    return this.tokens({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
    });
  }

  async profile(accessToken: string): Promise<PseudoraProfile> {
    const response = await fetch(`${this.baseUrl()}/v1/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}`, 'X-Pii-Client': 'vscode' },
    });
    const body = await response.json() as Partial<PseudoraProfile> & { error?: string };
    if (!response.ok || !body.id) {
      throw new Error(body.error || `Could not load the Pseudora account (${response.status}).`);
    }
    return {
      id: body.id,
      name: body.name || '',
      email: body.email || '',
      teams: Array.isArray(body.teams) ? body.teams : [],
    };
  }

  async documentTypes(accessToken: string, teamCode: string): Promise<PseudoraDocumentType[]> {
    const response = await fetch(`${this.baseUrl()}/v1/admin/context-types`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Team-ID': teamCode,
        'X-Pii-Client': 'vscode',
        Accept: 'application/json',
      },
    });
    const body = await response.json() as PseudoraDocumentType[] | { data?: PseudoraDocumentType[]; error?: string };
    if (!response.ok) {
      const error = Array.isArray(body) ? undefined : body.error;
      throw new Error(error || `Could not load document types (${response.status}).`);
    }

    const items = Array.isArray(body) ? body : body.data || [];
    return items
      .filter(item => Boolean(item.code))
      .map(item => ({
        ...item,
        default_mode: item.default_mode === 'surrogate' ? 'surrogate' : 'tag',
      }));
  }

  private async tokens(payload: Record<string, string>): Promise<TokenResponse> {
    const response = await fetch(`${this.baseUrl()}/oauth/token`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json() as TokenResponse & { error?: string; message?: string };
    if (!response.ok || !body.access_token) {
      throw new Error(body.message || body.error || `OAuth token request failed (${response.status}).`);
    }
    return body;
  }

  private baseUrl(): string {
    return getConfig().engineUrl;
  }
}
