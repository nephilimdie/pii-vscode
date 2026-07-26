# PII Protect — VS Code Extension

Detect and anonymize Personally Identifiable Information (PII) directly in your editor.

## Requirements

A running [pii-protect](https://github.com/your-org/pii-protect) engine instance.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `piiProtect.engineUrl` | `http://localhost:8000` | Engine base URL. For the hosted service: `https://pseudora.cloud` |
| `piiProtect.autoDetect` | `false` | Auto-scan on file open/save |
| `piiProtect.highlightColor` | `rgba(255,99,71,0.25)` | Background color for PII highlights |

`piiProtect.apiKey` is **deprecated**. Settings live in `settings.json` as
plaintext and are carried between machines by Settings Sync, so the key is stored
in the OS keychain instead — run **PII Protect: Set API Key**. A value still
present in settings is migrated into the keychain automatically the next time the
extension activates, and the plaintext copy is removed.

## Commands

| Command | Description |
|---|---|
| `PII Protect: Detect PII in File` | Scan the active file and highlight matches |
| `PII Protect: Anonymize Selection` | Replace the selected text with its anonymized form |
| `PII Protect: Anonymize Entire File` | Replace all file content with its anonymized form |
| `PII Protect: Clear Highlights` | Remove all PII decorations from the active file |
| `PII Protect: Set API Key` | Store the API key in the OS keychain |

## Usage

1. Set `piiProtect.engineUrl` in VS Code settings, then run **PII Protect: Set API Key**.
2. Open a file and run **PII Protect: Detect PII in File** from the Command Palette.
3. PII matches are highlighted with a red background. Hover over any highlight to see the entity type and confidence score.
4. Use **Anonymize Selection** or **Anonymize Entire File** to replace PII with anonymized placeholders.
