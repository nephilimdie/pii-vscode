import { createHash, randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { getConfig } from './config';
import { PseudoraOAuthApi, PseudoraProfile, PseudoraTeam, TokenResponse } from './oauth-api';

const SESSION_SECRET = 'piiProtect.oauthSession';
const TEAM_STATE = 'piiProtect.selectedTeamCode';
const TOKEN_MARGIN_MS = 60_000;
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const OAUTH_SCOPES = ['anonymize', 'deanonymize', 'profile:read', 'settings:read'];

interface StoredSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  clientId: string;
  profile: PseudoraProfile;
}

interface PendingLogin {
  state: string;
  verifier: string;
  callbackUri: string;
  clientId: string;
  promise: Promise<StoredSession>;
  resolve: (session: StoredSession) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export interface PseudoraStatus {
  connected: boolean;
  accountName?: string;
  team?: PseudoraTeam;
}

export interface PseudoraSessionProvider {
  readonly onDidChange: vscode.Event<void>;
  requestHeaders(interactive?: boolean): Promise<Record<string, string> | undefined>;
  selectedTeamCode(): string;
}

export class PseudoraOAuthClient implements vscode.UriHandler, vscode.Disposable, PseudoraSessionProvider {
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly api = new PseudoraOAuthApi();
  private pending?: PendingLogin;
  private refreshTimer?: NodeJS.Timeout;

  readonly onDidChange = this.changed.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    void this.restoreRefreshTimer();
  }

  async connect(): Promise<void> {
    const current = await this.readSession();
    if (current && current.expiresAt > Date.now() + TOKEN_MARGIN_MS) {
      const refreshed = await this.api.profile(current.accessToken);
      await this.saveSession({ ...current, profile: refreshed });
      await this.ensureTeam(refreshed.teams, true);
      return;
    }

    const session = await this.startLogin();
    await this.ensureTeam(session.profile.teams, true);
  }

  async disconnect(): Promise<void> {
    this.clearRefreshTimer();
    await this.context.secrets.delete(SESSION_SECRET);
    await this.context.workspaceState.update(TEAM_STATE, undefined);
    this.changed.fire();
  }

  async selectTeam(): Promise<PseudoraTeam | undefined> {
    const session = await this.ensureSession(true);
    if (!session) {
      return undefined;
    }

    const profile = await this.api.profile(session.accessToken);
    await this.saveSession({ ...session, profile });
    return this.pickTeam(profile.teams);
  }

  async requestHeaders(interactive = true): Promise<Record<string, string> | undefined> {
    const session = await this.ensureSession(interactive);
    if (!session) {
      return undefined;
    }

    const team = await this.ensureTeam(session.profile.teams, interactive);
    if (!team) {
      return undefined;
    }

    return {
      Authorization: `Bearer ${session.accessToken}`,
      'X-Team-ID': team.tenant_code,
      'X-Pii-Client': 'vscode',
    };
  }

  async status(): Promise<PseudoraStatus> {
    const session = await this.readSession();
    if (!session) {
      return { connected: false };
    }

    const code = this.selectedTeamCode();
    return {
      connected: true,
      accountName: session.profile.name || session.profile.email,
      team: session.profile.teams.find(team => team.tenant_code === code),
    };
  }

  selectedTeamCode(): string {
    return this.context.workspaceState.get<string>(TEAM_STATE, '');
  }

  async handleUri(uri: vscode.Uri): Promise<void> {
    if (uri.path !== '/oauth/callback' || !this.pending) {
      return;
    }

    const query = new URLSearchParams(uri.query);
    const error = query.get('error');
    const code = query.get('code');
    const state = query.get('state');

    if (error) {
      this.rejectPending(new Error(`OAuth authorization failed: ${error}`));
      return;
    }
    if (!code || state !== this.pending.state) {
      this.rejectPending(new Error('OAuth callback is missing a valid code or state.'));
      return;
    }

    const pending = this.pending;
    try {
      const tokens = await this.api.exchangeCode(
        pending.clientId,
        code,
        pending.verifier,
        pending.callbackUri,
      );
      const profile = await this.api.profile(tokens.access_token);
      const session = this.toSession(tokens, pending.clientId, profile);
      await this.saveSession(session);
      this.resolvePending(session);
    } catch (reason) {
      this.rejectPending(asError(reason));
    }
  }

  dispose(): void {
    this.clearRefreshTimer();
    this.rejectPending(new Error('Pseudora extension stopped.'));
    this.changed.dispose();
  }

  private async startLogin(): Promise<StoredSession> {
    if (this.pending) {
      return this.pending.promise;
    }

    const clientId = await this.api.clientId();
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(24).toString('base64url');
    const callbackUri = `${vscode.env.uriScheme}://${this.context.extension.id}/oauth/callback`;

    let resolve!: (session: StoredSession) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<StoredSession>((accept, decline) => {
      resolve = accept;
      reject = decline;
    });
    const timeout = setTimeout(
      () => this.rejectPending(new Error('Pseudora login timed out.')),
      LOGIN_TIMEOUT_MS,
    );
    this.pending = { state, verifier, callbackUri, clientId, promise, resolve, reject, timeout };

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: callbackUri,
      scope: OAUTH_SCOPES.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    const opened = await vscode.env.openExternal(
      vscode.Uri.parse(`${getConfig().engineUrl}/oauth/authorize?${params.toString()}`),
    );
    if (!opened) {
      this.rejectPending(new Error('Could not open the Pseudora login page.'));
    }

    return promise;
  }

  private async ensureSession(interactive: boolean): Promise<StoredSession | undefined> {
    const session = await this.readSession();
    if (!session) {
      return interactive ? this.startLogin() : undefined;
    }
    if (session.expiresAt > Date.now() + TOKEN_MARGIN_MS) {
      return session;
    }
    if (session.refreshToken) {
      try {
        return await this.refresh(session);
      } catch {
        await this.context.secrets.delete(SESSION_SECRET);
      }
    }
    return interactive ? this.startLogin() : undefined;
  }

  private async ensureTeam(teams: PseudoraTeam[], interactive: boolean): Promise<PseudoraTeam | undefined> {
    const current = teams.find(team => team.tenant_code === this.selectedTeamCode());
    if (current) {
      return current;
    }
    if (teams.length === 1) {
      await this.setTeam(teams[0]);
      return teams[0];
    }
    if (teams.length === 0) {
      throw new Error('Your Pseudora account does not have an active team.');
    }
    return interactive ? this.pickTeam(teams) : undefined;
  }

  private async pickTeam(teams: PseudoraTeam[]): Promise<PseudoraTeam | undefined> {
    const selected = await vscode.window.showQuickPick(
      teams.map(team => ({ label: team.name, description: team.tenant_code, team })),
      { title: 'Select the Pseudora team for this workspace', ignoreFocusOut: true },
    );
    if (!selected) {
      return undefined;
    }
    await this.setTeam(selected.team);
    return selected.team;
  }

  private async setTeam(team: PseudoraTeam): Promise<void> {
    await this.context.workspaceState.update(TEAM_STATE, team.tenant_code);
    this.changed.fire();
  }

  private async refresh(session: StoredSession): Promise<StoredSession> {
    const tokens = await this.api.refresh(session.clientId, session.refreshToken);
    const profile = await this.api.profile(tokens.access_token);
    const refreshed = this.toSession(tokens, session.clientId, profile, session.refreshToken);
    await this.saveSession(refreshed);
    return refreshed;
  }

  private toSession(
    tokens: TokenResponse,
    clientId: string,
    profile: PseudoraProfile,
    previousRefreshToken = '',
  ): StoredSession {
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || previousRefreshToken,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      clientId,
      profile,
    };
  }

  private async readSession(): Promise<StoredSession | undefined> {
    const raw = await this.context.secrets.get(SESSION_SECRET);
    if (!raw) {
      return undefined;
    }
    try {
      return JSON.parse(raw) as StoredSession;
    } catch {
      await this.context.secrets.delete(SESSION_SECRET);
      return undefined;
    }
  }

  private async saveSession(session: StoredSession): Promise<void> {
    await this.context.secrets.store(SESSION_SECRET, JSON.stringify(session));
    this.scheduleRefresh(session);
    this.changed.fire();
  }

  private async restoreRefreshTimer(): Promise<void> {
    const session = await this.readSession();
    if (session) {
      this.scheduleRefresh(session);
    }
  }

  private scheduleRefresh(session: StoredSession): void {
    this.clearRefreshTimer();
    const delay = Math.max(1000, session.expiresAt - Date.now() - TOKEN_MARGIN_MS);
    this.refreshTimer = setTimeout(async () => {
      try {
        await this.refresh(session);
      } catch {
        await this.context.secrets.delete(SESSION_SECRET);
        this.changed.fire();
      }
    }, delay);
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  private resolvePending(session: StoredSession): void {
    const pending = this.pending;
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pending = undefined;
    pending.resolve(session);
  }

  private rejectPending(error: Error): void {
    const pending = this.pending;
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pending = undefined;
    pending.reject(error);
  }
}

function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}
