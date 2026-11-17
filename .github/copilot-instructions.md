# Copilot Instructions — AI Token Optimizer

- ALWAYS read workspace files with the `read_file_optimized` MCP tool (from the
  "AI Token Optimizer" server). Do NOT use the built-in file-read tool unless
  `read_file_optimized` returns an error, or you need the exact original text
  and line numbers to make an edit.
- Before reasoning over any large text that is not a file (terminal output,
  logs, pasted code, API responses), pass it through the `optimize_context`
  MCP tool first.
- When the user asks about savings, call `get_token_stats`.
