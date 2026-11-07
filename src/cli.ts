#!/usr/bin/env node
// reelspan-mcp: Reelspan's tools over stdio, for MCP clients that start a local command (Claude Desktop, Cursor,
// Windsurf, Zed, Cline, Gemini CLI…). Clients that speak remote MCP can use https://api.reelspan.com/mcp directly.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ReelspanMcpProxy, VERSION, DEFAULT_URL } from './proxy.js';

const HELP = `reelspan-mcp ${VERSION}: Reelspan's MCP tools over stdio.

Usage: REELSPAN_API_KEY=rs_live_... npx -y @reelspan/mcp [options]

Options:
  --read-only              Only tools that read (status, history, analytics); nothing is posted or changed
  --tools a,b,c            Only these tools
  --exclude-tools a,b      Never these tools
  --url <url>              Hosted MCP endpoint (default ${DEFAULT_URL}, or REELSPAN_MCP_URL)
  --timeout <seconds>      How long one tool call may take (default 600)
  -v, --version            Print the version
  -h, --help               Print this help

Environment: REELSPAN_API_KEY (required), REELSPAN_MCP_URL, REELSPAN_READ_ONLY=1`;

export function parseArgs(argv: string[], env: Record<string, string | undefined> = process.env) {
  const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const out: { readOnly: boolean; tools: string[]; excludeTools: string[]; url?: string; timeoutMs?: number; help: boolean; version: boolean } = {
    readOnly: /^(1|true|yes)$/i.test(env.REELSPAN_READ_ONLY ?? ''),
    tools: list(env.REELSPAN_TOOLS),
    excludeTools: list(env.REELSPAN_EXCLUDE_TOOLS),
    help: false,
    version: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s, 2);
    const value = () => inline ?? argv[++i];
    switch (flag) {
      case '--read-only':
        out.readOnly = true;
        break;
      case '--tools':
        out.tools = list(value());
        break;
      case '--exclude-tools':
        out.excludeTools = list(value());
        break;
      case '--url':
        out.url = value();
        break;
      case '--timeout':
        out.timeoutMs = Number(value()) * 1000;
        break;
      case '-h':
      case '--help':
        out.help = true;
        break;
      case '-v':
      case '--version':
        out.version = true;
        break;
      default:
        throw new Error(`Unknown option ${flag}. Run with --help.`);
    }
  }
  return out;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error((err as Error).message);
    process.exit(2);
  }
  if (args.help) return console.log(HELP);
  if (args.version) return console.log(VERSION);
  try {
    const proxy = await ReelspanMcpProxy.start(new StdioServerTransport(), args);
    const stop = () => proxy.close().finally(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    process.stdin.on('close', stop);
  } catch (err) {
    // stdout belongs to the protocol: messages go to stderr, which MCP clients show in their logs
    console.error(`reelspan-mcp: ${(err as Error).message}`);
    process.exit(1);
  }
}

// run only as the bin, not when imported by tests
const isMain = () => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};
if (isMain()) void main();
