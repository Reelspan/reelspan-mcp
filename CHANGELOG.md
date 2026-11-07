# Changelog

## 0.1.0

First release.

- `reelspan-mcp`: Reelspan's hosted MCP tools over stdio, for clients that start a local command.
- Tools, schemas and instructions come from the hosted server at start, so new tools appear without an update.
- `--read-only` (only tools marked read-only), `--tools` and `--exclude-tools` filters; refused calls are refused
  locally too, not only hidden.
- Reconnects once when the hosted session has gone; long uploads get a 10 minute timeout that resets on progress.
- Clear messages for a missing or refused API key.
- `server.json` for the MCP Registry, `smithery.yaml`, and `gemini-extension.json`.
