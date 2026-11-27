# Change Log

All notable changes to the "ai-token-optimizer" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Fixed

- Comment removal no longer corrupts code. Only comments that occupy whole lines
  are removed, so a `/*` inside a string (for example the glob `"src/**/*.ts"`)
  is never mistaken for a comment start.
- `read_file_optimized` no longer follows a symlink that leads outside the
  workspace root, and no longer rejects a folder whose name merely starts with
  two dots (such as `..hidden`).
- Repeated-line folding (`line  (x3)`) is limited to the `log` and `plaintext`
  languages, so code and data (arrays, tables, markup) keep their repeated
  lines. The `optimize_context` description now asks for `languageId: "log"`
  when the text is a log.
- Secret, e-mail and URL-password redaction no longer takes quadratic time on
  long dotted, dashed or blank-line-only inputs, and trailing-whitespace
  trimming is linear.
- `engines.vscode` is now `^1.101.0`, the first release with
  `vscode.lm.registerMcpServerDefinitionProvider`, and `@types/vscode` is pinned
  to `~1.101.0` so the compiler cannot use newer APIs by accident. Earlier
  builds declared `^1.99.0` and could not activate on VS Code 1.99 and 1.100.

### Changed

- The one-line summary in front of an optimized tool reply is much shorter
  (about 19 tokens instead of 71) and is left out when nothing changed, so it no
  longer eats the savings it reports. The per-call credit estimate is still in
  the status bar and in `get_token_stats`.
- Restructured the sources into small modules: `core/telemetry.ts` became
  `tokens.ts`, `credits.ts` and `stats-store.ts`; `core/format.ts` became
  `core/format/`; `core/optimizer.ts` was split into `optimizer.ts`,
  `languages.ts` and `line-transforms.ts`; the workspace path guard moved to
  `core/workspace-path.ts`; `mcp-server.ts` is now a thin entry point over
  `mcp/`. The extension host no longer loads the tiktoken tokenizer.
- The savings report is titled "Cumulative Savings" (the totals span all
  windows) and `SessionStats` is now `CumulativeStats`.

### Added

- Tests for the MCP server (through the SDK's in-memory transport), the
  workspace path guard, the file lock and the manifest. Tests are now
  type-checked (`npm run typecheck`).
- Stricter ESLint (`typescript-eslint` type-checked recommendations, warnings
  fail) and a GitHub Actions workflow that runs `npm test`.
- `npm run clean`, which `vscode:prepublish` now runs before compiling, so the
  compiled output of a deleted or renamed module can never end up in the
  package. `tsconfig.test.json` and the CI workflow are left out of the package
  as well.
- `npm run package` and `npm run publish:vsce` (runs the tests, then
  `vsce publish`), and a GitHub Actions release workflow that publishes to the
  Marketplace through Trusted Publishing when a `v*` tag matching
  `package.json` is pushed. The CI workflow now cancels superseded runs and
  times out after 10 minutes.

## [0.0.10] - 2026-11-25

- Restructure sources into `src/core/` (vscode-independent logic) and `test/`.
- Fall back to the default price with a warning when
  `aiTokenOptimizer.aiCreditInputPricePerMillionUsd` is invalid.
- Report the real package version from the MCP server and log only token
  counts (not payload text) to its output.

## [0.0.9] - 2026-11-18

- Fix the status bar after upgrading by showing preserved payload totals
  separately from measured reply totals.

## [0.0.8] - 2026-11-18

- Preserve Markdown formatting, avoid guessing comment syntax for unknown inputs,
  and limit aggressive whitespace folding to explicit plain-text inputs.
- Track complete textual MCP reply tokens, including summary overhead, and
  report net token growth instead of hiding negative savings.

## [0.0.7] - 2026-11-17

- README: "Making Copilot Use the Tools" now includes a ready-to-copy
  `.github/copilot-instructions.md` to add to your project for extra savings.

## [0.0.6] - 2026-11-17

- MCP tool descriptions now steer Copilot to prefer `read_file_optimized` over
  the built-in file reader and to run large non-file text through
  `optimize_context`, so the tools are used more often.

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