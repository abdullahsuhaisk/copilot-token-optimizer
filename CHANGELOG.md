# Change Log

All notable changes to the "ai-token-optimizer" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.5] - 2026-11-17

- Fix: Status bar shows the cumulative total across all VS Code windows/projects.
  Concurrent updates from multiple windows no longer overwrite each other, and a
  window resyncs the total when it regains focus.

## [0.0.4] - 2026-11-02

- Added estimated GitHub AI Credits saved alongside token savings. Configure
  `aiTokenOptimizer.aiCreditInputPricePerMillionUsd` to match the model's input
  price; credit totals are estimates, not actual Copilot billing data.
- Fix: MCP server no longer requires `node` on PATH; uses VS Code's bundled runtime.

## [0.0.3] - 2026-11-02

### Added

- Sensitive data redaction: secrets/API keys (AWS, GitHub, Slack, Google, Stripe,
  OpenAI/Anthropic, JWT, Bearer tokens, private key blocks), key/value credentials,
  connection-string passwords, IPv4/IPv6 addresses, MAC addresses and e-mails are
  masked (e.g. `[REDACTED_IPV4]`) before content reaches the LLM. Enabled by default.
- Redaction counters per category, persisted in session stats and shown in tool
  output (`Redacted: ...`), `get_token_stats`, the status bar and the
  `Show Token Savings` command.

### Changed

- Extension icon resized to 256x256 (Marketplace 1 MB limit).
- Documentation files are excluded from the packaged extension.

### Security

- The MCP server no longer logs raw payloads; only the redacted output is logged.

## [0.0.2] - 2026-10-01

- Renamed package to `token-saver-mcp`, added extension icon, MIT license and
  repository metadata.

## [0.0.1]

- Initial release