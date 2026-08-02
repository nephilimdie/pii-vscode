// Minimal vscode API mock for vitest — only covers what detector.ts / config.ts actually use

const _config: Record<string, unknown> = {
  engineUrl: 'http://test-engine.local:8000',
  apiKey:    'test-key',
  autoDetect: false,
  highlightColor: 'rgba(255,99,71,0.25)',
};

export function __setConfig(overrides: Partial<typeof _config>): void {
  Object.assign(_config, overrides);
}

export const workspace = {
  getConfiguration: (_section?: string) => ({
    get: <T>(key: string, fallback: T): T =>
      key in _config ? (_config[key] as T) : fallback,
    update: async (key: string, value: unknown, _target?: number): Promise<void> => {
      if (value === undefined) {
        delete _config[key];
      } else {
        _config[key] = value;
      }
    },
  }),
};

export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 } as const;

/** In-memory stand-in for vscode.SecretStorage. */
export class FakeSecretStorage {
  private store_ = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.store_.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    this.store_.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store_.delete(key);
  }
}

export const __statusBarItems: Array<{ text: string; tooltip: string; command: string }> = [];

export const window = {
  activeTextEditor: null as null,
  showErrorMessage: (_msg: string) => Promise.resolve(undefined),
  showInformationMessage: (_msg: string) => Promise.resolve(undefined),
  showWarningMessage: (_msg: string) => Promise.resolve(undefined),
  showQuickPick: async () => undefined,
  createStatusBarItem: () => {
    const item = {
      text: '', tooltip: '', command: '',
      show: () => {}, hide: () => {}, dispose: () => {},
    };
    __statusBarItems.push(item);
    return item;
  },
  createTextEditorDecorationType: () => ({ dispose: () => {} }),
};

export const StatusBarAlignment = { Left: 1, Right: 2 } as const;
export class ThemeColor {
  constructor(public readonly id: string) {}
}
export const DecorationRangeBehavior = { ClosedClosed: 0 } as const;
export const OverviewRulerLane = { Center: 4 } as const;
export const commands = { executeCommand: async () => undefined };
export class EventEmitter<T> {
  private listeners: Array<(event: T) => void> = [];
  readonly event = (listener: (event: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter(item => item !== listener); } };
  };
  fire(event: T): void { this.listeners.forEach(listener => listener(event)); }
  dispose(): void { this.listeners = []; }
}
export class Uri {
  private constructor(private readonly value: string) {}
  static parse(value: string): Uri { return new Uri(value); }
  toString(): string { return this.value; }
}
export class McpHttpServerDefinition {
  constructor(
    public readonly label: string,
    public uri: Uri,
    public headers: Record<string, string> = {},
    public version?: string,
  ) {}
}
export const Range = class {
  constructor(
    public readonly startLine: number,
    public readonly startChar: number,
    public readonly endLine: number,
    public readonly endChar: number,
  ) {}
};
export const Position = class {
  constructor(public readonly line: number, public readonly character: number) {}
};
