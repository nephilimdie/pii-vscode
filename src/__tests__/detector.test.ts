import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PiiDetector } from '../detector';
import { validateConfig } from '../config';
import { PseudoraWorkspacePreferences } from '../workspace-preferences';

// vscode is aliased to src/__mocks__/vscode.ts via vitest.config.ts

function mockFetch(response: object, ok = true, status = 200): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok,
    status,
    text: async () => JSON.stringify(response),
    json: async () => response,
  }));
}

function mockFetchNetworkError(message = 'ECONNREFUSED'): void {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError(message)));
}

// ── PiiDetector.detect() ────────────────────────────────────────────────────

describe('PiiDetector.detect()', () => {
  let detector: PiiDetector;

  beforeEach(() => {
    detector = new PiiDetector();
    vi.unstubAllGlobals();
  });

  it('returns mapped PII matches from engine response', async () => {
    mockFetch({
      entities: [
        { entity_type: 'PERSON', text: 'Mario Rossi', start: 0,  end: 11, score: 0.99 },
        { entity_type: 'EMAIL',  text: 'mario@example.com', start: 20, end: 37, score: 0.98 },
      ],
    });

    const matches = await detector.detect('Mario Rossi — email mario@example.com');

    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({ type: 'PERSON', text: 'Mario Rossi', start: 0, end: 11 });
    expect(matches[1]).toMatchObject({ type: 'EMAIL',  text: 'mario@example.com' });
  });

  it('returns empty array when no entities found', async () => {
    mockFetch({ entities: [] });
    const matches = await detector.detect('no pii here');
    expect(matches).toHaveLength(0);
  });

  it('correctly maps offset 0 → line 0 char 0', async () => {
    mockFetch({ entities: [{ entity_type: 'PERSON', text: 'Mario', start: 0, end: 5, score: 1 }] });
    const [match] = await detector.detect('Mario');
    expect(match.line).toBe(0);
    expect(match.character).toBe(0);
  });

  it('correctly maps offset past newline → line 1', async () => {
    // "first\nMario" — 'M' is at offset 6
    mockFetch({ entities: [{ entity_type: 'PERSON', text: 'Mario', start: 6, end: 11, score: 1 }] });
    const [match] = await detector.detect('first\nMario');
    expect(match.line).toBe(1);
    expect(match.character).toBe(0);
  });

  it('sends API key header when configured', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ entities: [] }), text: async () => '{}' });
    vi.stubGlobal('fetch', fetchSpy);

    await detector.detect('text');

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)['X-API-Key']).toBe('test-key');
  });

  it('throws descriptive error on HTTP 500', async () => {
    mockFetch({ error: 'Internal' }, false, 500);
    await expect(detector.detect('text')).rejects.toThrow('PII engine returned 500');
  });

  it('throws descriptive error on network failure', async () => {
    mockFetchNetworkError('ECONNREFUSED 127.0.0.1:8000');
    await expect(detector.detect('text')).rejects.toThrow('Cannot reach PII engine');
  });

  it('sends request to the configured engine URL', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ entities: [] }), text: async () => '{}' });
    vi.stubGlobal('fetch', fetchSpy);

    await detector.detect('text');

    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain('test-engine.local:8000');
    expect(url).toContain('/v1/detect');
  });
});

// ── PiiDetector.anonymize() ─────────────────────────────────────────────────

describe('PiiDetector.anonymize()', () => {
  let detector: PiiDetector;

  beforeEach(() => {
    detector = new PiiDetector();
    vi.unstubAllGlobals();
  });

  it.each([
    { safe: false, anonymized_text: 'private' },
    { anonymized_text: 'private' },
    { safe: 'true', anonymized_text: 'private' },
    { safe: true, anonymized_text: 42 },
    { safe: true, text: 'private' },
  ])('blocks unconfirmed protection responses', async (response) => {
    mockFetch(response);
    await expect(detector.anonymize('private')).rejects.toThrow('invalid anonymization response');
  });

  it('returns anonymized text from engine response', async () => {
    mockFetch({ safe: true, anonymized_text: '[PERSON_1] — email [EMAIL_1]' });

    const result = await detector.anonymize('Mario Rossi — email mario@example.com');

    expect(result).toBe('[PERSON_1] — email [EMAIL_1]');
  });

  it('throws on HTTP 401', async () => {
    mockFetch({ error: 'Unauthorized' }, false, 401);
    await expect(detector.anonymize('text')).rejects.toThrow('PII engine returned 401');
  });

  it('throws on network error', async () => {
    mockFetchNetworkError('fetch failed');
    await expect(detector.anonymize('text')).rejects.toThrow('Cannot reach PII engine');
  });

  it('bounds every engine call with a timeout signal', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ safe: true, anonymized_text: '[X]' }), text: async () => '{}' });
    vi.stubGlobal('fetch', fetchSpy);

    await detector.anonymize('sensitive content');

    expect(fetchSpy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses redirects so text and API key never reach another host', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ safe: true, anonymized_text: '[X]' }), text: async () => '{}' });
    vi.stubGlobal('fetch', fetchSpy);

    await detector.anonymize('sensitive content');

    expect(fetchSpy.mock.calls[0][1].redirect).toBe('error');
  });

  it('fails closed when the engine times out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError')));
    await expect(detector.anonymize('private')).rejects.toThrow('Cannot reach PII engine');
  });

  it('posts the full text as JSON body with context_id and context_type', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ safe: true, anonymized_text: '[X]' }), text: async () => '{}' });
    vi.stubGlobal('fetch', fetchSpy);

    await detector.anonymize('sensitive content');

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.text).toBe('sensitive content');
    expect(body.context_type).toBe('generic');
    expect(body.context_id).toMatch(/^vscode_[0-9a-f-]{36}$/);
  });

  it('uses the workspace document type and anonymization mode', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ safe: true, anonymized_text: '[X]' }), text: async () => '{}' });
    vi.stubGlobal('fetch', fetchSpy);
    const preferences = {
      snapshot: () => ({ enabled: true, documentType: 'fine_appeal', mode: 'surrogate' }),
    } as PseudoraWorkspacePreferences;
    const configuredDetector = new PiiDetector(undefined, undefined, preferences);

    await configuredDetector.anonymize('sensitive content');

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(options.body as string)).toMatchObject({
      context_type: 'fine_appeal',
      mode: 'surrogate',
    });
  });

  it('keeps the context id and restores the model response', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ safe: true, anonymized_text: 'Ciao [PERSON_1]' }),
        text: async () => '{}',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ restored_text: 'Ciao Mario Rossi' }),
        text: async () => '{}',
      });
    vi.stubGlobal('fetch', fetchSpy);

    const protectedText = await detector.anonymizeWithContext('Ciao Mario Rossi');
    const restored = await detector.deanonymize('Arrivederci [PERSON_1]', protectedText.contextId);

    expect(protectedText.text).toBe('Ciao [PERSON_1]');
    expect(restored).toBe('Ciao Mario Rossi');
    const deanonymizeBody = JSON.parse(fetchSpy.mock.calls[1][1].body as string);
    expect(deanonymizeBody.context_id).toBe(protectedText.contextId);
    expect(fetchSpy.mock.calls[1][0]).toContain('/v1/deanonymize');
  });
});

describe('PiiDetector.deanonymize()', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it.each([{}, { text: 'Mario' }, { deanonymized_text: 'Mario' }, { restored_text: 1 }])(
    'rejects a response without restored_text', async (response) => {
      mockFetch(response);
      await expect(new PiiDetector().deanonymize('[PERSON_1]', 'ctx')).rejects.toThrow('invalid deanonymization response');
    },
  );
});

describe('PiiDetector.deanonymize() mapping context', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it.each([
    ['domain:legal', 'legal'],
    ['fine_appeal', 'fine_appeal'],
  ])('restores %s mappings under context_type %s', async (documentType, contextType) => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ restored_text: 'Mario' }), text: async () => '{}' });
    vi.stubGlobal('fetch', fetchSpy);
    const preferences = {
      snapshot: () => ({ enabled: true, documentType, mode: 'tag' }),
    } as PseudoraWorkspacePreferences;

    await new PiiDetector(undefined, undefined, preferences).deanonymize('[PERSON_1]', 'ctx');

    expect(JSON.parse(fetchSpy.mock.calls[0][1].body as string)).toEqual({
      text: '[PERSON_1]', context_id: 'ctx', context_type: contextType,
    });
  });
});

// ── validateConfig() ────────────────────────────────────────────────────────

describe('validateConfig()', () => {
  const base = {
    apiKey: 'k',
    mcpUrl: 'https://mcp.pseudora.cloud/mcp',
    autoDetect: false,
    highlightColor: 'red',
  };

  it('returns null for a valid https URL', () => {
    expect(validateConfig({ ...base, engineUrl: 'https://api.pii-protect.cloud' })).toBeNull();
  });

  it('returns null for localhost http URL', () => {
    expect(validateConfig({ ...base, engineUrl: 'http://localhost:8000' })).toBeNull();
  });

  it('returns error when engineUrl is empty', () => {
    expect(validateConfig({ ...base, engineUrl: '' })).toMatch(/engineUrl is not set/);
  });

  it('returns error for a non-URL string', () => {
    expect(validateConfig({ ...base, engineUrl: 'not-a-url' })).toMatch(/not a valid URL/);
  });

  it('returns error for a URL with no protocol', () => {
    expect(validateConfig({ ...base, engineUrl: 'api.pii-protect.cloud' })).toMatch(/not a valid URL/);
  });
});
