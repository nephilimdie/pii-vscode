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
  }),
};

export const window = {
  activeTextEditor: null as null,
  showErrorMessage: (_msg: string) => Promise.resolve(undefined),
  showInformationMessage: (_msg: string) => Promise.resolve(undefined),
  createStatusBarItem: () => ({
    text: '', tooltip: '', command: '',
    show: () => {}, hide: () => {}, dispose: () => {},
  }),
  createTextEditorDecorationType: () => ({ dispose: () => {} }),
};

export const StatusBarAlignment = { Left: 1, Right: 2 } as const;
export const DecorationRangeBehavior = { ClosedClosed: 0 } as const;
export const OverviewRulerLane = { Center: 4 } as const;
export const commands = { executeCommand: async () => undefined };
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
