# Pseudora for VS Code

Detect and anonymize personal data in the editor and expose the managed Pseudora
MCP tools directly to VS Code Agent mode.

## Connect

1. Run **Pseudora: Connect Account** from the Command Palette.
2. Complete the browser login.
3. Select the Pseudora team for the current workspace.

The extension stores OAuth tokens in VS Code SecretStorage and registers
`https://mcp.pseudora.cloud/mcp` programmatically. Tokens are not written to
`settings.json` or `mcp.json`. The selected team is workspace-specific and is
sent as `X-Team-ID` on API and MCP calls.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `piiProtect.engineUrl` | `https://pseudora.cloud` | Pseudora API URL |
| `piiProtect.mcpUrl` | `https://mcp.pseudora.cloud/mcp` | Managed MCP endpoint |
| `piiProtect.autoDetect` | `false` | Auto-scan on file open/save |
| `piiProtect.highlightColor` | `rgba(255,99,71,0.25)` | Background color for PII highlights |

OAuth is the default for Pseudora Cloud. **PII Protect: Set API Key** remains an
advanced fallback for self-hosted installations; the key is stored in the OS
keychain and never in settings.

## Commands

| Command | Description |
|---|---|
| `PII Protect: Detect PII in File` | Scan the active file and highlight matches |
| `PII Protect: Anonymize Selection` | Replace the selected text with its anonymized form |
| `PII Protect: Anonymize Entire File` | Replace all file content with its anonymized form |
| `PII Protect: Clear Highlights` | Remove all PII decorations from the active file |
| `PII Protect: Set API Key` | Store the API key in the OS keychain |
| `Pseudora: Connect Account` | Sign in through the browser with OAuth PKCE |
| `Pseudora: Select Team` | Select the team for the current workspace |
| `Pseudora: Disconnect Account` | Remove the local OAuth session |

## Usage

After login, Pseudora appears in the VS Code MCP server list and its tools are
available in Agent mode. Editor commands and MCP use the same account and team.
Use the team item in the status bar to switch the workspace team.
