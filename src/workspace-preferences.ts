import * as vscode from 'vscode';

export type PseudoraMode = 'tag' | 'surrogate';
export type ChatResponseMode = 'protected' | 'restored';

export interface WorkspacePreferencesSnapshot {
  enabled: boolean;
  mcpEnabled: boolean;
  documentType: string;
  mode: PseudoraMode;
  chatResponseMode: ChatResponseMode;
}

const ENABLED_KEY = 'piiProtect.enabled';
const MCP_ENABLED_KEY = 'piiProtect.mcpEnabled';
const DOCUMENT_TYPE_KEY = 'piiProtect.documentType';
const MODE_KEY = 'piiProtect.mode';
const CHAT_RESPONSE_MODE_KEY = 'piiProtect.chatResponseMode';

export class PseudoraWorkspacePreferences implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();

  readonly onDidChange = this.changed.event;

  constructor(private readonly state: vscode.Memento) {}

  snapshot(): WorkspacePreferencesSnapshot {
    return {
      enabled: this.state.get<boolean>(ENABLED_KEY, true),
      mcpEnabled: this.state.get<boolean>(MCP_ENABLED_KEY, true),
      documentType: this.state.get<string>(DOCUMENT_TYPE_KEY, 'generic'),
      mode: this.state.get<PseudoraMode>(MODE_KEY, 'tag'),
      chatResponseMode: this.state.get<ChatResponseMode>(CHAT_RESPONSE_MODE_KEY, 'protected'),
    };
  }

  async toggle(): Promise<boolean> {
    const enabled = !this.snapshot().enabled;
    await this.state.update(ENABLED_KEY, enabled);
    this.changed.fire();
    return enabled;
  }

  async toggleMcp(): Promise<boolean> {
    const enabled = !this.snapshot().mcpEnabled;
    await this.state.update(MCP_ENABLED_KEY, enabled);
    this.changed.fire();
    return enabled;
  }

  async setDocumentType(documentType: string, defaultMode?: string): Promise<void> {
    await this.state.update(DOCUMENT_TYPE_KEY, documentType || 'generic');
    if (defaultMode === 'tag' || defaultMode === 'surrogate') {
      await this.state.update(MODE_KEY, defaultMode);
    }
    this.changed.fire();
  }

  async setMode(mode: PseudoraMode): Promise<void> {
    await this.state.update(MODE_KEY, mode);
    this.changed.fire();
  }

  async setChatResponseMode(mode: ChatResponseMode): Promise<void> {
    await this.state.update(CHAT_RESPONSE_MODE_KEY, mode);
    this.changed.fire();
  }

  dispose(): void {
    this.changed.dispose();
  }
}
