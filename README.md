# PII Protect — VS Code Extension

Detect and anonymize Personally Identifiable Information (PII) directly in your editor.

## Requirements

A running [pii-protect](https://github.com/your-org/pii-protect) engine instance.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `piiProtect.engineUrl` | `http://localhost:8000` | Engine base URL |
| `piiProtect.apiKey` | `` | API key (sent as `X-API-Key` header) |
| `piiProtect.autoDetect` | `false` | Auto-scan on file open/save |
| `piiProtect.highlightColor` | `rgba(255,99,71,0.25)` | Background color for PII highlights |

## Commands

| Command | Description |
|---|---|
| `PII Protect: Detect PII in File` | Scan the active file and highlight matches |
| `PII Protect: Anonymize Selection` | Replace the selected text with its anonymized form |
| `PII Protect: Anonymize Entire File` | Replace all file content with its anonymized form |
| `PII Protect: Clear Highlights` | Remove all PII decorations from the active file |

## Usage

1. Set `piiProtect.engineUrl` (and optionally `piiProtect.apiKey`) in VS Code settings.
2. Open a file and run **PII Protect: Detect PII in File** from the Command Palette.
3. PII matches are highlighted with a red background. Hover over any highlight to see the entity type and confidence score.
4. Use **Anonymize Selection** or **Anonymize Entire File** to replace PII with anonymized placeholders.
