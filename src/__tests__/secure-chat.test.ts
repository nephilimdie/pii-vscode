import { describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { PiiDetector } from '../detector';
import { PseudoraSecureChat } from '../secure-chat';
import { PseudoraWorkspacePreferences } from '../workspace-preferences';

function asyncText(...values: string[]): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const value of values) {
        yield value;
      }
    },
  };
}

function responseStream() {
  return {
    markdown: vi.fn(),
    progress: vi.fn(),
  };
}

function preferences(
  enabled = true,
  chatResponseMode: 'protected' | 'restored' = 'protected',
  mode: 'tag' | 'surrogate' = 'tag',
): PseudoraWorkspacePreferences {
  return {
    snapshot: () => ({ enabled, mcpEnabled: true, documentType: 'generic', mode, chatResponseMode }),
  } as PseudoraWorkspacePreferences;
}

describe('Pseudora protected chat', () => {
  it('sends only anonymized text to the selected language model', async () => {
    const detector = {
      anonymizeWithContext: vi.fn().mockResolvedValue({
        text: 'Scrivi a [PERSON_1] presso [EMAIL_1]',
        contextId: 'ctx-1',
      }),
      deanonymize: vi.fn().mockResolvedValue('Risposta per Mario Rossi'),
    } as unknown as PiiDetector;
    const sendRequest = vi.fn().mockResolvedValue({ text: asyncText('Risposta per [PERSON_1]') });
    const stream = responseStream();
    const chat = new PseudoraSecureChat(detector, preferences(true, 'restored'));

    await chat.handle({
      prompt: 'Scrivi a Mario Rossi presso mario@example.com',
      references: [],
      model: { sendRequest },
    } as unknown as vscode.ChatRequest, {} as vscode.ChatContext, stream as unknown as vscode.ChatResponseStream, {
      isCancellationRequested: false,
    } as vscode.CancellationToken);

    expect(detector.anonymizeWithContext).toHaveBeenCalledWith(
      'Scrivi a Mario Rossi presso mario@example.com',
    );
    const serializedMessages = JSON.stringify(sendRequest.mock.calls[0][0]);
    expect(serializedMessages).toContain('[PERSON_1]');
    expect(serializedMessages).not.toContain('Mario Rossi');
    expect(serializedMessages).not.toContain('mario@example.com');
    expect(detector.deanonymize).toHaveBeenCalledWith('Risposta per [PERSON_1]', 'ctx-1');
    expect(stream.markdown).toHaveBeenCalledWith('Risposta per Mario Rossi');
    expect(stream.markdown).toHaveBeenLastCalledWith(expect.stringContaining('Restored response'));
  });

  it('streams protected model fragments without waiting for restoration', async () => {
    const detector = {
      anonymizeWithContext: vi.fn().mockResolvedValue({ text: 'Ciao [PERSON_1]', contextId: 'ctx-fast' }),
      deanonymize: vi.fn(),
    } as unknown as PiiDetector;
    const sendRequest = vi.fn().mockResolvedValue({ text: asyncText('Ciao ', '[PERSON_1]') });
    const stream = responseStream();
    const chat = new PseudoraSecureChat(detector, preferences());

    await chat.handle({
      prompt: 'Ciao Mario Rossi',
      references: [],
      model: { sendRequest },
    } as unknown as vscode.ChatRequest, {} as vscode.ChatContext, stream as unknown as vscode.ChatResponseStream, {
      isCancellationRequested: false,
    } as vscode.CancellationToken);

    expect(stream.markdown.mock.calls.slice(0, 2)).toEqual([['Ciao '], ['[PERSON_1]']]);
    expect(detector.deanonymize).not.toHaveBeenCalled();
    expect(stream.markdown).toHaveBeenLastCalledWith(expect.stringContaining('Protected streaming'));
  });

  it('skips restoration when a tag response contains no Pseudora tokens', async () => {
    const detector = {
      anonymizeWithContext: vi.fn().mockResolvedValue({ text: 'Scrivi una risposta', contextId: 'ctx-clean' }),
      deanonymize: vi.fn(),
    } as unknown as PiiDetector;
    const sendRequest = vi.fn().mockResolvedValue({ text: asyncText('Risposta senza dati personali') });
    const stream = responseStream();
    const chat = new PseudoraSecureChat(detector, preferences(true, 'restored'));

    await chat.handle({
      prompt: 'Scrivi una risposta',
      references: [],
      model: { sendRequest },
    } as unknown as vscode.ChatRequest, {} as vscode.ChatContext, stream as unknown as vscode.ChatResponseStream, {
      isCancellationRequested: false,
    } as vscode.CancellationToken);

    expect(detector.deanonymize).not.toHaveBeenCalled();
    expect(stream.markdown).toHaveBeenCalledWith('Risposta senza dati personali');
    expect(stream.markdown).toHaveBeenLastCalledWith(expect.stringContaining('No restoration needed'));
  });

  it('excludes references and continues with the protected prompt text', async () => {
    const detector = {
      anonymizeWithContext: vi.fn().mockResolvedValue({ text: 'Summarize', contextId: 'ctx-2' }),
      deanonymize: vi.fn().mockResolvedValue('Summary'),
    } as unknown as PiiDetector;
    const sendRequest = vi.fn().mockResolvedValue({ text: asyncText('Summary') });
    const stream = responseStream();
    const chat = new PseudoraSecureChat(detector, preferences());

    await chat.handle({
      prompt: 'Summarize #file',
      references: [{ id: 'file', value: 'raw contents', range: [10, 15] }],
      model: { sendRequest },
    } as unknown as vscode.ChatRequest, {} as vscode.ChatContext, stream as unknown as vscode.ChatResponseStream, {
      isCancellationRequested: false,
    } as vscode.CancellationToken);

    expect(detector.anonymizeWithContext).toHaveBeenCalledWith('Summarize');
    expect(JSON.stringify(sendRequest.mock.calls[0][0])).not.toContain('raw contents');
    expect(JSON.stringify(sendRequest.mock.calls[0][0])).not.toContain('#file');
    expect(stream.progress).toHaveBeenCalledWith(expect.stringContaining('references are excluded'));
  });

  it('fails closed when Pseudora cannot anonymize the request', async () => {
    const detector = {
      anonymizeWithContext: vi.fn().mockRejectedValue(new Error('engine unavailable')),
    } as unknown as PiiDetector;
    const sendRequest = vi.fn();
    const stream = responseStream();
    const chat = new PseudoraSecureChat(detector, preferences());

    await expect(chat.handle({
      prompt: 'Mario Rossi',
      references: [],
      model: { sendRequest },
    } as unknown as vscode.ChatRequest, {} as vscode.ChatContext, stream as unknown as vscode.ChatResponseStream, {
      isCancellationRequested: false,
    } as vscode.CancellationToken)).rejects.toThrow('engine unavailable');

    expect(sendRequest).not.toHaveBeenCalled();
  });

  it('does not contact Pseudora or the model while the workspace is paused', async () => {
    const detector = { anonymizeWithContext: vi.fn() } as unknown as PiiDetector;
    const sendRequest = vi.fn();
    const stream = responseStream();
    const chat = new PseudoraSecureChat(detector, preferences(false));

    await chat.handle({
      prompt: 'Sensitive request',
      references: [],
      model: { sendRequest },
    } as unknown as vscode.ChatRequest, {} as vscode.ChatContext, stream as unknown as vscode.ChatResponseStream, {
      isCancellationRequested: false,
    } as vscode.CancellationToken);

    expect(detector.anonymizeWithContext).not.toHaveBeenCalled();
    expect(sendRequest).not.toHaveBeenCalled();
  });
});
