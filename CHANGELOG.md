# Changelog

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
