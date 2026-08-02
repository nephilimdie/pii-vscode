# Pseudora for VS Code

Detect and anonymize personal data in the editor and expose the managed Pseudora
MCP tools directly to VS Code Agent mode.

## Connect

1. Click **Pseudora: Sign in** in the status bar, or run **Pseudora: Sign In**
   from the Command Palette.
2. Complete the browser login.
3. Select the Pseudora team for the current workspace.
4. Select the single Pseudora status item to choose document type and mode.

The extension stores OAuth tokens in VS Code SecretStorage and registers
`https://mcp.pseudora.cloud/mcp` programmatically. Tokens are not written to
`settings.json` or `mcp.json`. Team, document type, anonymization mode, and pause
state are workspace-specific. They are applied to both editor API calls and MCP.
MCP is registered automatically and enabled by default. It can be disabled for
one workspace without disabling editor detection and anonymization.

Document type selects the policy and detection rules, for example
`fine_appeal`. Mode selects how values are replaced: `Tag` uses reversible
placeholders, while `Surrogate` uses reversible realistic fake values.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `piiProtect.engineUrl` | `https://pseudora.cloud` | Pseudora API URL |
| `piiProtect.mcpUrl` | `https://mcp.pseudora.cloud/mcp` | Managed MCP endpoint |
| `piiProtect.autoDetect` | `false` | Auto-scan on file open/save |
| `piiProtect.highlightColor` | `rgba(255,99,71,0.25)` | Background color for PII highlights |

OAuth is the default for Pseudora Cloud. **Pseudora: Set API Key** remains an
advanced fallback for self-hosted installations; the key is stored in the OS
keychain and never in settings.

## Commands

| Command | Description |
|---|---|
| `Pseudora: Detect PII in File` | Scan the active file and highlight matches |
| `Pseudora: Anonymize Selection` | Replace the selected text with its anonymized form |
| `Pseudora: Anonymize Entire File` | Replace all file content with its anonymized form |
| `Pseudora: Clear Highlights` | Remove all PII decorations from the active file |
| `Pseudora: Set API Key` | Store the API key in the OS keychain |
| `Pseudora: Sign In` | Sign in through the browser with OAuth PKCE |
| `Pseudora: Select Team` | Select the team for the current workspace |
| `Pseudora: Select Document Type` | Select the ACL-filtered policy for the workspace |
| `Pseudora: Select Anonymization Mode` | Choose tag masking or realistic surrogates |
| `Pseudora: Pause or Resume Workspace` | Disable or enable editor actions, automatic scans, and MCP |
| `Pseudora: Enable or Disable MCP for AI Chats` | Toggle only the MCP tools used by Copilot and other AI agents |
| `Pseudora: Open Workspace Controls` | Open the unified Pseudora menu |
| `Pseudora: Disconnect Account` | Remove the local OAuth session |

## Usage

After login, Pseudora appears in the VS Code MCP server list and its tools are
available in Agent mode. Open Chat, select Agent, choose **Configure Tools**, and
enable the Pseudora tools. You can also run **MCP: List Servers** to verify that
Pseudora is enabled. Editor commands and MCP use the same workspace controls.
Use the single Pseudora item in the status bar to switch account, team, document
type, and mode, or to pause the integration temporarily.
