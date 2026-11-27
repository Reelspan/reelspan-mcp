# Changelog

## 0.2.0

- `upload_file`: uploads a file from your computer in one call (by path) and returns its `media_id`, for
  `upload_video`, `upload_photos`, `upload_document` or `set_youtube_thumbnail`. It runs in this package, since only a
  local process can read your files; it uses the hosted `start_upload` and `complete_upload` underneath. Hidden with
  `--read-only`.
- From the hosted server (no update needed, listed here for reference): `check_accounts`, `upload_status`
  `wait_seconds`, thumbnails from an uploaded image, links between the networks of one post (`{youtube.post_url}`),
  `{network}_caption`, post numbers at 24h, 72h and 7d, and a stricter `validate_post`.

## 0.1.1

- README: the tools as they are now. `generate_captions` is gone; `write_captions` reads an uploaded video, and
  local files go up with `start_upload` and `complete_upload`.

## 0.1.0

First release.

- `reelspan-mcp`: Reelspan's hosted MCP tools over stdio, for clients that start a local command.
- Tools, schemas and instructions come from the hosted server at start, so new tools appear without an update.
- `--read-only` (only tools marked read-only), `--tools` and `--exclude-tools` filters; refused calls are refused
  locally too, not only hidden.
- Reconnects once when the hosted session has gone; long uploads get a 10 minute timeout that resets on progress.
- Clear messages for a missing or refused API key.
- `server.json` for the MCP Registry, `smithery.yaml`, and `gemini-extension.json`.
