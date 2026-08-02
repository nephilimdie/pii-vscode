# Changelog

## [0.4.1] - 2026-08-02

### Fixed
- Ignore implicit VS Code references without blocking protected text prompts
- Remove explicit `#` references without reading or forwarding attachment contents

## [0.4.0] - 2026-08-02

### Added
- `@pseudora` protected Chat participant that anonymizes before invoking the selected model
- Automatic response restoration through the same protected context
- Protected-chat command in the workspace menu

### Changed
- Clarified that MCP tools run inside agent workflows and do not intercept an already submitted prompt

## [0.3.1] - 2026-08-02

### Added
- Workspace command and menu control to enable or disable MCP independently

### Changed
- MCP is registered automatically and enabled by default for compatible AI chats

## [0.3.0] - 2026-08-02

### Added
- Unified workspace menu for account, team, document type, and anonymization mode
- ACL-filtered document type picker backed by Pseudora Cloud
- Workspace pause that disables editor operations, automatic scans, and MCP
- Editor context-menu actions for detection and selection anonymization

### Changed
- Replaced the separate PII and team status items with one Pseudora control
- Applied workspace document type and mode to direct API calls and MCP tools

## [0.2.1] - 2026-08-02

### Changed
- Made the unauthenticated status-bar action explicit with `Pseudora: Sign in`
- Clarified how to enable and verify Pseudora tools in VS Code Agent mode
- Improved the error shown when Cloud OAuth provisioning is unavailable

## [0.2.0] - 2026-08-01

### Added
- Browser-based OAuth PKCE login with tokens stored in VS Code SecretStorage
- Workspace-scoped team picker and status bar indicator
- Automatic remote MCP registration for VS Code Agent mode
- Automatic access-token refresh and MCP credential rotation

### Changed
- Rebranded the extension as Pseudora
- Pseudora Cloud and its managed MCP gateway are now the defaults
- API keys remain available only as a self-hosted fallback

## [0.1.0] - 2026-06-21

### Added
- Initial release
- PII detection via configurable engine URL
- Per-match decorations with hover tooltips showing type and confidence score
- Commands: Detect in File, Anonymize Selection, Anonymize File, Clear Highlights
- Status bar item showing scan state and match count
- Auto-detect on save/open (opt-in via `piiProtect.autoDetect`)
- Configurable highlight color via `piiProtect.highlightColor`
