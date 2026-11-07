# @reelspan/mcp

[Reelspan](https://reelspan.com)'s MCP server over stdio. It lets Claude, Cursor, Windsurf, Zed, Cline, Gemini CLI and
any other MCP client publish videos, photos and text to TikTok, YouTube, Instagram, Facebook, X, Threads, LinkedIn,
Pinterest, Bluesky, Reddit and 12 more networks, schedule them, and read how they did.

```bash
REELSPAN_API_KEY=rs_live_... npx -y @reelspan/mcp
```

It is a thin bridge to the hosted server at `https://api.reelspan.com/mcp`: the tools, their schemas and the server's
instructions are read from it at start, so a tool added there appears here without a new release, and every call
goes through the same auth, scopes, validation and rate limits as the API.

**Does your client speak remote MCP?** Then you don't need this package: add `https://api.reelspan.com/mcp` as a remote
server and sign in with OAuth, or send `Authorization: Bearer <API key>`. Use this package for clients that only start
local commands, for `npx` setups, and where you want the filters below.

## Set up

Create an API key in the Reelspan dashboard under **Developers → API keys**.

### Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "reelspan": {
      "command": "npx",
      "args": ["-y", "@reelspan/mcp"],
      "env": { "REELSPAN_API_KEY": "rs_live_..." }
    }
  }
}
```

### Claude Code

```bash
claude mcp add reelspan --env REELSPAN_API_KEY=rs_live_... -- npx -y @reelspan/mcp
```

Or remote, with no package at all:

```bash
claude mcp add --transport http reelspan https://api.reelspan.com/mcp --header "Authorization: Bearer rs_live_..."
```

### Cursor

`~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project): the same `mcpServers` block as Claude Desktop.

### VS Code

`.vscode/mcp.json`:

```json
{
  "inputs": [{ "type": "promptString", "id": "reelspan-key", "description": "Reelspan API key", "password": true }],
  "servers": {
    "reelspan": { "command": "npx", "args": ["-y", "@reelspan/mcp"], "env": { "REELSPAN_API_KEY": "${input:reelspan-key}" } }
  }
}
```

### Gemini CLI

```bash
gemini extensions install https://github.com/Reelspan/reelspan-mcp
```

It reads `REELSPAN_API_KEY` from your environment.

### Windsurf, Zed, Cline, Continue and others

Any client that runs a command: `npx -y @reelspan/mcp` with `REELSPAN_API_KEY` in its environment.

## Options

| Flag | Env | What it does |
|---|---|---|
| `--read-only` | `REELSPAN_READ_ONLY=1` | Only tools the server marks read-only (status, history, analytics, profiles). Nothing can be posted, changed or deleted, even if the model tries a hidden tool. |
| `--tools a,b` | `REELSPAN_TOOLS` | Only these tools |
| `--exclude-tools a,b` | `REELSPAN_EXCLUDE_TOOLS` | Never these tools, e.g. `delete_profile` |
| `--url <url>` | `REELSPAN_MCP_URL` | Another endpoint (default `https://api.reelspan.com/mcp`) |
| `--timeout <s>` | | How long one tool call may take (default 600; resets while an upload reports progress) |

A read-only reporting assistant:

```json
{ "command": "npx", "args": ["-y", "@reelspan/mcp", "--read-only"], "env": { "REELSPAN_API_KEY": "rs_live_..." } }
```

Pair it with an API key that only has read scopes for a second line of defence.

## Tools

Whatever the hosted server offers; today:

| Area | Tools |
|---|---|
| Publish | `upload_video`, `upload_photos`, `upload_text`, `upload_document` |
| After posting | `upload_status`, `upload_history`, `retry_failed` |
| Schedule | `list_scheduled`, `edit_scheduled`, `cancel_scheduled`, `get_best_times` |
| Analytics | `get_analytics`, `get_analytics_history`, `get_post_analytics` |
| Profiles | `list_profiles`, `create_profile`, `delete_profile`, `get_connect_link`, `get_account_info` |
| Media | `list_library`, `import_to_library` |
| AI captions | `generate_captions`, `write_captions`, `rewrite_captions` |
| Teams | `create_approval_link`, `get_webhook`, `set_webhook` |

Try: *"Post launch.mp4 from my Drive link to TikTok, YouTube Shorts and Instagram Reels for the acme profile tomorrow
at 9am New York time, with captions written for each network."*

## Use it from code

```ts
import { ReelspanMcpProxy } from '@reelspan/mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

await ReelspanMcpProxy.start(new StdioServerTransport(), { apiKey: process.env.REELSPAN_API_KEY, readOnly: true });
```

## Troubleshooting

- **"Reelspan refused the API key (401)"**: the key is wrong or revoked. Make a new one in the dashboard.
- **"lacks a scope (403)"**: the key was made with limited scopes. Give it the ones the tool needs.
- Logs go to stderr (stdout carries the protocol); your client shows them in its MCP log.

## Links

- [MCP docs](https://reelspan.com/docs/mcp) · [API reference](https://reelspan.com/docs) · [Node SDK](https://github.com/Reelspan/reelspan-node) · [Python SDK](https://github.com/Reelspan/reelspan-python)
- Coming from Upload-Post? The API takes Upload-Post's field names, so your prompts and automations carry over.

MIT licensed. Security reports: see [SECURITY.md](SECURITY.md).
