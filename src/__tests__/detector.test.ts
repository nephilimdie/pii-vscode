import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PiiDetector } from '../detector';
import { validateConfig } from '../config';
import { PseudoraWorkspacePreferences } from '../workspace-preferences';

// vscode is aliased to src/__mocks__/vscode.ts via vitest.config.ts

type Reply = { body: unknown; status?: number; raw?: boolean };

/** Stubs global fetch with one HTTP reply per call (the last one repeats); returns the spy. */
function mockReplies(...replies: Reply[]) {
  let call = 0;
  const spy = vi.fn(async (_request: Request) => {
    const { body, status = 200, raw } = replies[Math.min(call++, replies.length - 1)];
    const payload = raw ? (body as string) : JSON.stringify(body);
    return new Response(status === 204 ? null : payload, { status, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function mockFetch(response: unknown, status = 200) {
  return mockReplies({ body: response, status });
}

function mockFetchNetworkError(message = 'ECONNREFUSED'): void {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError(message)));
}

function sentRequest(spy: ReturnType<typeof mockReplies>, index = 0): Request {
  return spy.mock.calls[index][0];
}

function withPreferences(documentType: string, mode = 'tag'): PiiDetector {
  const preferences = {
    snapshot: () => ({ enabled: true, documentType, mode }),
  } as PseudoraWorkspacePreferences;
  return new PiiDetector(undefined, undefined, preferences);
}

beforeEach(() => vi.unstubAllGlobals());

// ── PiiDetector.detect() ────────────────────────────────────────────────────

describe('PiiDetector.detect()', () => {
  const detector = new PiiDetector();

  it('returns mapped PII matches from the spec DetectResponse', async () => {
    mockFetch({
      entities: [
        { type: 'PERSON', value: 'Mario Rossi', start: 0, end: 11, confidence: 0.99 },
        { type: 'EMAIL', start: 20, end: 37, confidence: 0.98 },
      ],
    });

    const text = 'Mario Rossi — email mario@example.com';
    const matches = await detector.detect(text);

    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({ type: 'PERSON', text: 'Mario Rossi', start: 0, end: 11, score: 0.99 });
    expect(matches[1]).toMatchObject({ type: 'EMAIL', text: text.slice(20, 37) });
  });

  it('returns empty array when no entities found', async () => {
    mockFetch({ entities: [] });
    expect(await detector.detect('no pii here')).toHaveLength(0);
  });

  it('correctly maps offset 0 → line 0 char 0', async () => {
    mockFetch({ entities: [{ type: 'PERSON', start: 0, end: 5, confidence: 1 }] });
    const [match] = await detector.detect('Mario');
    expect(match.line).toBe(0);
    expect(match.character).toBe(0);
  });

  it('correctly maps offset past newline → line 1', async () => {
    mockFetch({ entities: [{ type: 'PERSON', start: 6, end: 11, confidence: 1 }] });
    const [match] = await detector.detect('first\nMario');
    expect(match.line).toBe(1);
    expect(match.character).toBe(0);
  });

  it('sends API key and client headers to the configured engine URL', async () => {
    const spy = mockFetch({ entities: [] });

    await detector.detect('text');

    const request = sentRequest(spy);
    expect(request.headers.get('X-API-Key')).toBe('test-key');
    expect(request.headers.get('X-Pii-Client')).toBe('vscode');
    expect(request.url).toBe('http://test-engine.local:8000/v1/detect');
    expect(await request.json()).toEqual({ text: 'text', context_type: 'generic' });
  });

  it('sends no domain field for domain policies (DetectRequest has none)', async () => {
    const spy = mockFetch({ entities: [] });
    await withPreferences('domain:legal').detect('text');
    expect(await sentRequest(spy).json()).toEqual({ text: 'text' });
  });

  it.each([{}, { entities: null }, { entities: 'x' }])('rejects a body without an entities array', async (body) => {
    mockFetch(body);
    await expect(detector.detect('text')).rejects.toThrow('invalid response');
  });

  it('throws descriptive error on HTTP 500', async () => {
    mockFetch({ error: 'Internal' }, 500);
    await expect(detector.detect('text')).rejects.toThrow('PII engine returned 500: {"error":"Internal"}');
  });

  it('throws descriptive error on network failure', async () => {
    mockFetchNetworkError('ECONNREFUSED 127.0.0.1:8000');
    await expect(detector.detect('text')).rejects.toThrow('Cannot reach PII engine');
  });
});

// ── PiiDetector.anonymize(): fail-closed contract ───────────────────────────

describe('PiiDetector.anonymize() fails closed', () => {
  const detector = new PiiDetector();

  it.each([
    { safe: false, anonymized_text: 'private' },
    { anonymized_text: 'private' },
    { safe: 'true', anonymized_text: 'private' },
    { safe: 1, anonymized_text: 'private' },
    { safe: true },
    { safe: true, anonymized_text: null },
    { safe: true, anonymized_text: 42 },
    { safe: true, text: 'private' },
  ])('withholds text when safe !== true or anonymized_text is missing: %j', async (response) => {
    mockFetch(response);
    await expect(detector.anonymize('private')).rejects.toThrow('invalid anonymization response');
  });

  it.each([400, 401, 402, 403, 422, 429, 500, 502, 503])(
    'withholds text on HTTP %i even when the body claims safe', async (status) => {
      mockFetch({ safe: true, anonymized_text: 'looks fine' }, status);
      await expect(detector.anonymize('private')).rejects.toThrow(`PII engine returned ${status}`);
    },
  );

  it.each([
    ['not json', 'truncated {"safe": true'],
    ['an empty body', ''],
    ['a JSON array', '[{"safe":true,"anonymized_text":"x"}]'],
    ['a JSON string', '"x"'],
    ['JSON null', 'null'],
  ])('withholds text on a malformed 2xx body (%s)', async (_label, raw) => {
    mockReplies({ body: raw, raw: true });
    await expect(detector.anonymize('private')).rejects.toThrow('invalid');
  });

  it('withholds text on 204 No Content', async () => {
    mockReplies({ body: null, status: 204 });
    await expect(detector.anonymize('private')).rejects.toThrow('invalid');
  });

  it('withholds text on a network error', async () => {
    mockFetchNetworkError('fetch failed');
    await expect(detector.anonymize('private')).rejects.toThrow('Cannot reach PII engine');
  });

  it('withholds text when the engine does not answer before the timeout', async () => {
    vi.stubGlobal('fetch', vi.fn((request: Request) => new Promise((_resolve, reject) => {
      request.signal.addEventListener('abort', () => reject(request.signal.reason));
    })));

    await expect(new PiiDetector(undefined, undefined, undefined, 20).anonymize('private'))
      .rejects.toThrow(/Cannot reach PII engine.*TimeoutError/);
  });

  it('withholds text when a redirect is refused', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed', { cause: new Error('unexpected redirect') })));
    await expect(detector.anonymize('private')).rejects.toThrow('Cannot reach PII engine');
  });

  it('refuses redirects so text and API key never reach another host', async () => {
    const spy = mockFetch({ safe: true, anonymized_text: '[X]' });
    await detector.anonymize('sensitive content');
    expect(sentRequest(spy).redirect).toBe('error');
  });
});

// ── PiiDetector.anonymize(): success path ───────────────────────────────────

describe('PiiDetector.anonymize()', () => {
  const detector = new PiiDetector();

  it('returns anonymized text from engine response', async () => {
    mockFetch({ safe: true, anonymized_text: '[PERSON_1] — email [EMAIL_1]' });
    expect(await detector.anonymize('Mario Rossi — email mario@example.com')).toBe('[PERSON_1] — email [EMAIL_1]');
  });

  it('posts the AnonymizeRequest with context_id, mode and context_type', async () => {
    const spy = mockFetch({ safe: true, anonymized_text: '[X]' });

    await detector.anonymize('sensitive content');

    const request = sentRequest(spy);
    expect(request.method).toBe('POST');
    expect(request.url).toBe('http://test-engine.local:8000/v1/anonymize');
    const body = await request.json();
    expect(body).toMatchObject({ text: 'sensitive content', context_type: 'generic', mode: 'tag' });
    expect(body.context_id).toMatch(/^vscode_[0-9a-f-]{36}$/);
  });

  it('uses the workspace document type and anonymization mode', async () => {
    const spy = mockFetch({ safe: true, anonymized_text: '[X]' });
    await withPreferences('fine_appeal', 'surrogate').anonymize('sensitive content');
    expect(await sentRequest(spy).json()).toMatchObject({ context_type: 'fine_appeal', mode: 'surrogate' });
  });

  it('invokes a domain policy directly for domain document types', async () => {
    const spy = mockFetch({ safe: true, anonymized_text: '[X]' });
    await withPreferences('domain:legal').anonymize('sensitive content');
    const body = await sentRequest(spy).json();
    expect(body.domain).toBe('legal');
    expect(body).not.toHaveProperty('context_type');
  });

  it('keeps the context id and restores the model response', async () => {
    const spy = mockReplies(
      { body: { safe: true, anonymized_text: 'Ciao [PERSON_1]' } },
      { body: { restored_text: 'Ciao Mario Rossi' } },
    );

    const protectedText = await detector.anonymizeWithContext('Ciao Mario Rossi');
    const restored = await detector.deanonymize('Arrivederci [PERSON_1]', protectedText.contextId);

    expect(protectedText.text).toBe('Ciao [PERSON_1]');
    expect(restored).toBe('Ciao Mario Rossi');
    const request = sentRequest(spy, 1);
    expect(request.url).toContain('/v1/deanonymize');
    expect((await request.json()).context_id).toBe(protectedText.contextId);
  });
});

// ── PiiDetector.deanonymize() ───────────────────────────────────────────────

describe('PiiDetector.deanonymize()', () => {
  it.each([{}, { text: 'Mario' }, { deanonymized_text: 'Mario' }, { restored_text: 1 }])(
    'rejects a response without restored_text: %j', async (response) => {
      mockFetch(response);
      await expect(new PiiDetector().deanonymize('[PERSON_1]', 'ctx')).rejects.toThrow('invalid deanonymization response');
    },
  );

  it('rejects a non-2xx restore even when it carries restored_text', async () => {
    mockFetch({ restored_text: 'Mario' }, 500);
    await expect(new PiiDetector().deanonymize('[PERSON_1]', 'ctx')).rejects.toThrow('PII engine returned 500');
  });

  it.each([
    ['domain:legal', 'legal'],
    ['fine_appeal', 'fine_appeal'],
  ])('restores %s mappings under context_type %s', async (documentType, contextType) => {
    const spy = mockFetch({ restored_text: 'Mario' });
    await withPreferences(documentType).deanonymize('[PERSON_1]', 'ctx');
    expect(await sentRequest(spy).json()).toEqual({ text: '[PERSON_1]', context_id: 'ctx', context_type: contextType });
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
