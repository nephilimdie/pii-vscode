# Pseudora for VS Code

Protect personal data in the editor, open a pre-model protected chat, and expose
the managed Pseudora MCP tools to VS Code Agent mode.

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
AI response mode controls latency: `Protected streaming` displays the protected
model response as it arrives, while `Restored response` waits for completion and
restores original values before display.

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
| `Pseudora: Select AI Response Mode` | Choose protected streaming or restored responses |
| `Pseudora: Pause or Resume Workspace` | Disable or enable editor actions, automatic scans, and MCP |
| `Pseudora: Open Protected AI Chat` | Open Chat prefilled with `@pseudora` |
| `Pseudora: Enable or Disable MCP Agent Tools` | Toggle only the MCP tools used by Copilot and other AI agents |
| `Pseudora: Open Workspace Controls` | Open the unified Pseudora menu |
| `Pseudora: Disconnect Account` | Remove the local OAuth session |

## Protected AI chat

Use `@pseudora` at the start of a Chat request, or select **Open protected AI
chat** from the Pseudora status menu. The extension anonymizes the prompt before
calling the model selected in VS Code. By default, the protected response is
streamed immediately. Select **AI response: Restored** from the workspace menu
to buffer the response and restore original values before rendering it locally.

Each response reports anonymization, first-token, model, and optional restoration
timings. Restored tag responses without Pseudora tokens skip the extra API call.

Protected chat fails closed: if anonymization fails, the language model is not
called. Attachments and previous chat turns are not forwarded, while explicit
`#` references are removed from the prompt. Each protected request is isolated,
preventing unprocessed context from bypassing the protection boundary.

## MCP agent tools

After login, Pseudora appears in the VS Code MCP server list and its tools are
available in Agent mode. Open Chat, select Agent, choose **Configure Tools**, and
enable the Pseudora tools. You can also run **MCP: List Servers** to verify that
Pseudora is enabled. Editor commands and MCP use the same workspace controls.
Use the single Pseudora item in the status bar to switch account, team, document
type, and mode, or to pause the integration temporarily.

MCP tools are invoked by the language model during an agent request. They protect
data produced or fetched inside an agent workflow, but they cannot intercept a
raw prompt that was already submitted to a generic Copilot chat. Use
`@pseudora` when the prompt itself contains personal data.
