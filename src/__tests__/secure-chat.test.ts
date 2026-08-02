import { describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { PiiDetector } from '../detector';
import { PseudoraSecureChat } from '../secure-chat';
import { PseudoraWorkspacePreferences } from '../workspace-preferences';

function asyncText(value: string): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      yield value;
    },
  };
}

function responseStream() {
  return {
    markdown: vi.fn(),
    progress: vi.fn(),
  };
}

function preferences(enabled = true): PseudoraWorkspacePreferences {
  return {
    snapshot: () => ({ enabled, mcpEnabled: true, documentType: 'generic', mode: 'tag' }),
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
    const chat = new PseudoraSecureChat(detector, preferences());

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
    expect(stream.markdown).toHaveBeenLastCalledWith('Risposta per Mario Rossi');
  });

  it('blocks references instead of forwarding their unprotected contents', async () => {
    const detector = { anonymizeWithContext: vi.fn() } as unknown as PiiDetector;
    const sendRequest = vi.fn();
    const stream = responseStream();
    const chat = new PseudoraSecureChat(detector, preferences());

    await chat.handle({
      prompt: 'Summarize #file',
      references: [{ id: 'file', value: 'raw contents' }],
      model: { sendRequest },
    } as unknown as vscode.ChatRequest, {} as vscode.ChatContext, stream as unknown as vscode.ChatResponseStream, {
      isCancellationRequested: false,
    } as vscode.CancellationToken);

    expect(detector.anonymizeWithContext).not.toHaveBeenCalled();
    expect(sendRequest).not.toHaveBeenCalled();
    expect(stream.markdown).toHaveBeenCalledWith(expect.stringContaining('does not forward attachments'));
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
