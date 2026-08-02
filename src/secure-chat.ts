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
    if (!this.preferences.snapshot().enabled) {
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

    const protectedRequest = await this.detector.anonymizeWithContext(prompt);
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
    const modelResponse = await request.model.sendRequest(messages, {}, token);
    let protectedReply = '';
    for await (const fragment of modelResponse.text) {
      protectedReply += fragment;
    }

    if (!protectedReply) {
      response.markdown('The selected model returned an empty response.');
      return;
    }

    response.progress('Restoring your values locally through Pseudora...');
    try {
      response.markdown(await this.detector.deanonymize(protectedReply, protectedRequest.contextId));
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
}
