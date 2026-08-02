import * as vscode from 'vscode';
import { PiiDetector } from './detector';
import { PseudoraWorkspacePreferences } from './workspace-preferences';

const PARTICIPANT_ID = 'pseudora.secureChat';

export class PseudoraSecureChat {
  constructor(
    private readonly detector: PiiDetector,
    private readonly preferences: PseudoraWorkspacePreferences,
  ) {}

  register(extensionUri: vscode.Uri): vscode.ChatParticipant {
    const participant = vscode.chat.createChatParticipant(
      PARTICIPANT_ID,
      this.handle.bind(this),
    );
    participant.iconPath = vscode.Uri.joinPath(extensionUri, 'images', 'icon.png');
    return participant;
  }

  async handle(
    request: vscode.ChatRequest,
    _context: vscode.ChatContext,
    response: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const preferences = this.preferences.snapshot();
    if (!preferences.enabled) {
      response.markdown('Pseudora is paused in this workspace. Resume it before using protected chat.');
      return;
    }

    const prompt = this.withoutReferences(request.prompt, request.references);
    if (!prompt) {
      response.markdown('Write a request after `@pseudora`.');
      return;
    }

    if (request.references.length > 0) {
      response.progress('Attachments and references are excluded from protected chat.');
    }

    response.progress('Anonymizing with Pseudora before contacting the selected model...');

    const anonymizeStartedAt = Date.now();
    const protectedRequest = await this.detector.anonymizeWithContext(prompt);
    const anonymizeMs = Date.now() - anonymizeStartedAt;
    if (token.isCancellationRequested) {
      return;
    }

    response.progress('Sending only anonymized text to the selected model...');

    const messages = [vscode.LanguageModelChatMessage.User([
      new vscode.LanguageModelTextPart(
        'Complete the protected user request below. Personal data has been replaced by Pseudora. '
        + 'Preserve placeholders and surrogate values exactly; do not infer, expand, or identify them.\n\n'
        + `Protected user request:\n${protectedRequest.text}`,
      ),
    ])];
    const modelStartedAt = Date.now();
    const modelResponse = await request.model.sendRequest(messages, {}, token);
    let protectedReply = '';
    let firstTokenMs: number | undefined;
    for await (const fragment of modelResponse.text) {
      if (firstTokenMs === undefined && fragment) {
        firstTokenMs = Date.now() - modelStartedAt;
      }
      protectedReply += fragment;
      if (preferences.chatResponseMode === 'protected') {
        response.markdown(fragment);
      }
    }
    const modelMs = Date.now() - modelStartedAt;

    if (!protectedReply) {
      response.markdown('The selected model returned an empty response.');
      return;
    }

    if (preferences.chatResponseMode === 'protected') {
      this.writeTimings(response, 'Protected streaming', anonymizeMs, firstTokenMs, modelMs);
      return;
    }

    if (!this.needsRestoration(protectedReply, preferences.mode)) {
      response.markdown(protectedReply);
      this.writeTimings(response, 'No restoration needed', anonymizeMs, firstTokenMs, modelMs);
      return;
    }

    response.progress('Restoring your values locally through Pseudora...');
    const restoreStartedAt = Date.now();
    try {
      response.markdown(await this.detector.deanonymize(protectedReply, protectedRequest.contextId));
      this.writeTimings(
        response,
        'Restored response',
        anonymizeMs,
        firstTokenMs,
        modelMs,
        Date.now() - restoreStartedAt,
      );
    } catch {
      response.markdown(protectedReply);
      response.markdown('\n\n> Pseudora could not restore the response, so the protected version is shown.');
    }
  }

  private withoutReferences(
    prompt: string,
    references: readonly vscode.ChatPromptReference[],
  ): string {
    let sanitized = prompt;
    for (const reference of references) {
      if (!reference.range) {
        continue;
      }
      const [start, end] = reference.range;
      if (start < 0 || end < start || end > sanitized.length) {
        continue;
      }
      sanitized = sanitized.slice(0, start) + sanitized.slice(end);
    }
    return sanitized.trim();
  }

  private needsRestoration(text: string, mode: string): boolean {
    return mode === 'surrogate' || /\[[A-Z][A-Z0-9_]*_\d+\]/.test(text);
  }

  private writeTimings(
    response: vscode.ChatResponseStream,
    mode: string,
    anonymizeMs: number,
    firstTokenMs: number | undefined,
    modelMs: number,
    restoreMs?: number,
  ): void {
    const parts = [
      mode,
      `anonymize ${formatDuration(anonymizeMs)}`,
      `first token ${formatDuration(firstTokenMs ?? modelMs)}`,
      `model ${formatDuration(modelMs)}`,
    ];
    if (restoreMs !== undefined) {
      parts.push(`restore ${formatDuration(restoreMs)}`);
    }
    response.markdown(`\n\n---\n_Pseudora · ${parts.join(' · ')}_`);
  }
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${milliseconds} ms`;
  }
  return `${(milliseconds / 1000).toFixed(1)} s`;
}
