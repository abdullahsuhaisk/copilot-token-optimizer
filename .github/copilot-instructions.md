# Copilot Instructions — AI Token Optimizer

- When reading the contents of a workspace file, prefer the `read_file_optimized`
  MCP tool (from the "AI Token Optimizer" server) over the built-in file-read
  tool, so token savings are tracked.
- When optimizing or summarizing a text/code payload that is not read from a
  file, prefer the `optimize_context` MCP tool.
- After a batch of optimizations, you may call `get_token_stats` to report
  cumulative savings if the user asks for a summary.
