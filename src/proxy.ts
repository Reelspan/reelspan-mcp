// A local MCP server that forwards everything to Reelspan's hosted MCP (https://api.reelspan.com/mcp). The tools,
// their schemas and the server instructions come from the hosted server at start, so this package never drifts
// from it: a tool added there shows up here without a new release.

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { Readable } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ToolListChangedNotificationSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

export const VERSION = '0.2.0';
export const DEFAULT_URL = 'https://api.reelspan.com/mcp';

export type ProxyOptions = {
  /** A Reelspan API key. Defaults to REELSPAN_API_KEY. */
  apiKey?: string;
  /** The hosted MCP endpoint. Defaults to REELSPAN_MCP_URL, then https://api.reelspan.com/mcp. */
  url?: string;
  /** Only tools the server marks read-only (readOnlyHint): nothing gets posted, changed or deleted. */
  readOnly?: boolean;
  /** Only these tools (by name). */
  tools?: string[];
  /** Never these tools (by name). */
  excludeTools?: string[];
  /** Milliseconds one tool call may take (default 10 minutes: uploads of big files are slow). */
  timeoutMs?: number;
  /** Your own fetch, for proxies or tests. */
  fetch?: typeof fetch;
};

// The one tool that runs here instead of on the hosted server: only this local process can read the caller's files.
// It does start_upload, the PUT of the file's bytes and complete_upload in one call.
export const UPLOAD_FILE: Tool = {
  name: 'upload_file',
  title: 'Upload a local file',
  description:
    'Upload a file from this computer in one step and get its media_id: a video (mp4, mov, webm…), photo (jpg, png, webp…) or PDF document. ' +
    'Use the media_id as video_media_id, photo_media_ids, document_media_id or thumbnail_media_id. Files up to 5 GB.',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Absolute path of the file' }, kind: { type: 'string', enum: ['video', 'photo', 'document'], description: 'Guessed from the extension when left out' } },
    required: ['path'],
  },
  annotations: { destructiveHint: false, readOnlyHint: false, openWorldHint: false },
};
const KIND_OF: Record<string, 'video' | 'photo' | 'document'> = { '.mp4': 'video', '.mov': 'video', '.m4v': 'video', '.webm': 'video', '.mkv': 'video', '.jpg': 'photo', '.jpeg': 'photo', '.png': 'photo', '.gif': 'photo', '.webp': 'photo', '.heic': 'photo', '.pdf': 'document' };
const text = (v: unknown, isError = false) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }], isError });
const parsed = (r: unknown) => {
  const first = ((r as { content?: { type: string; text?: string }[] }).content)?.find((c) => c.type === 'text')?.text ?? '{}';
  try {
    return JSON.parse(first) as Record<string, unknown>;
  } catch {
    return { error: first };
  }
};

/** Whether a tool passes the read-only, allow and deny filters. */
export function toolAllowed(tool: Pick<Tool, 'name' | 'annotations'>, opts: Pick<ProxyOptions, 'readOnly' | 'tools' | 'excludeTools'>): boolean {
  if (opts.tools?.length && !opts.tools.includes(tool.name)) return false;
  if (opts.excludeTools?.includes(tool.name)) return false;
  if (opts.readOnly && tool.annotations?.readOnlyHint !== true) return false;
  return true;
}

export class ReelspanMcpProxy {
  /** The local server (set once the hosted one has answered). */
  server!: Server;
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;
  private readonly opts: Required<Pick<ProxyOptions, 'url' | 'timeoutMs'>> & ProxyOptions;
  private readonly key: string;
  private known = new Map<string, Tool>();

  /** Connects to the hosted server first, so the local one can offer the same capabilities and instructions. */
  static async start(transport: Transport, opts: ProxyOptions = {}): Promise<ReelspanMcpProxy> {
    const proxy = new ReelspanMcpProxy(opts);
    const upstream = await proxy.upstream();
    proxy.init(upstream);
    await proxy.server.connect(transport);
    return proxy;
  }

  private constructor(opts: ProxyOptions) {
    const key = opts.apiKey ?? process.env.REELSPAN_API_KEY;
    if (!key) throw new Error('Set REELSPAN_API_KEY to a Reelspan API key (dashboard → Developers → API keys).');
    this.key = key;
    this.opts = { ...opts, url: opts.url ?? process.env.REELSPAN_MCP_URL ?? DEFAULT_URL, timeoutMs: opts.timeoutMs ?? 600_000 };
  }

  private async upstream(): Promise<Client> {
    if (this.client) return this.client;
    this.connecting ??= (async () => {
      const client = new Client({ name: 'reelspan-mcp', version: VERSION });
      const transport = new StreamableHTTPClientTransport(new URL(this.opts.url), {
        requestInit: { headers: { authorization: `Bearer ${this.key}`, 'user-agent': `reelspan-mcp/${VERSION}` } },
        fetch: this.opts.fetch,
      });
      try {
        await client.connect(transport);
      } catch (err) {
        this.connecting = null;
        throw explain(err, this.opts.url);
      }
      client.onclose = () => {
        // the hosted session ended (deploy, idle timeout): the next call opens a new one
        if (this.client === client) this.client = null;
        this.connecting = null;
      };
      client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        await this.server?.sendToolListChanged().catch(() => undefined);
      });
      this.client = client;
      return client;
    })();
    return this.connecting;
  }

  /** Runs a call on the hosted server, reconnecting once if its session has gone. */
  private async withUpstream<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.upstream());
    } catch (err) {
      if (!isSessionGone(err)) throw err;
      await this.client?.close().catch(() => undefined);
      this.client = null;
      this.connecting = null;
      return fn(await this.upstream());
    }
  }

  private init(upstream: Client) {
    const caps = upstream.getServerCapabilities() ?? {};
    const server = new Server(
      { name: 'reelspan', version: VERSION },
      {
        capabilities: { tools: { listChanged: true }, ...(caps.prompts ? { prompts: {} } : {}), ...(caps.resources ? { resources: {} } : {}) },
        instructions: upstream.getInstructions(),
      },
    );
    this.server = server;

    server.setRequestHandler(ListToolsRequestSchema, async (req) => {
      const r = await this.withUpstream((c) => c.listTools(req.params));
      for (const t of r.tools) this.known.set(t.name, t);
      // the local upload, on the first page, when the hosted server has the upload tools it is built on
      const local = !req.params?.cursor && this.known.has('start_upload') && toolAllowed(UPLOAD_FILE, this.opts) ? [UPLOAD_FILE] : [];
      return { ...r, tools: [...local, ...r.tools.filter((t) => toolAllowed(t, this.opts))] };
    });

    server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const name = req.params.name;
      if (name === UPLOAD_FILE.name) {
        if (!toolAllowed(UPLOAD_FILE, this.opts)) return text('The tool "upload_file" is not available with the current settings (--read-only, --tools or --exclude-tools).', true);
        return this.uploadFile(req.params.arguments ?? {});
      }
      let tool = this.known.get(name);
      if (!tool) {
        const all = await this.withUpstream((c) => c.listTools());
        for (const t of all.tools) this.known.set(t.name, t);
        tool = this.known.get(name);
      }
      if (!tool || !toolAllowed(tool, this.opts)) {
        return { content: [{ type: 'text', text: `The tool "${name}" is not available${tool ? ' with the current settings (--read-only, --tools or --exclude-tools)' : ''}.` }], isError: true };
      }
      return this.withUpstream((c) => c.callTool(req.params, undefined, { timeout: this.opts.timeoutMs, resetTimeoutOnProgress: true }));
    });

    if (caps.prompts) {
      server.setRequestHandler(ListPromptsRequestSchema, (req) => this.withUpstream((c) => c.listPrompts(req.params)));
      server.setRequestHandler(GetPromptRequestSchema, (req) => this.withUpstream((c) => c.getPrompt(req.params)));
    }
    if (caps.resources) {
      server.setRequestHandler(ListResourcesRequestSchema, (req) => this.withUpstream((c) => c.listResources(req.params)));
      server.setRequestHandler(ListResourceTemplatesRequestSchema, (req) => this.withUpstream((c) => c.listResourceTemplates(req.params)));
      server.setRequestHandler(ReadResourceRequestSchema, (req) => this.withUpstream((c) => c.readResource(req.params)));
    }
  }

  /** start_upload on the hosted server, the file's bytes straight to storage, then complete_upload. */
  private async uploadFile(args: Record<string, unknown>) {
    const path = typeof args.path === 'string' ? args.path : '';
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) return text(`No file at ${path || '(no path given)'}`, true);
    const kind = (typeof args.kind === 'string' ? args.kind : undefined) ?? KIND_OF[extname(path).toLowerCase()];
    if (!kind) return text('Say the kind (video, photo or document): the extension doesn’t tell.', true);
    if (info.size > 5 * 1024 ** 3) return text('Files over 5 GB need start_upload with mode "multipart".', true);
    const call = (name: string, a: Record<string, unknown>) => this.withUpstream((c) => c.callTool({ name, arguments: a }, undefined, { timeout: this.opts.timeoutMs }));
    const started = await call('start_upload', { kind, size_bytes: info.size, filename: basename(path), mode: 'single' });
    const s = parsed(started);
    if (started.isError || typeof s.media_id !== 'string' || typeof s.upload_url !== 'string') return text(s, true);
    const doFetch = this.opts.fetch ?? fetch;
    const put = await doFetch(s.upload_url, { method: 'PUT', body: Readable.toWeb(createReadStream(path)) as ReadableStream, headers: { 'content-length': String(info.size) }, duplex: 'half' } as RequestInit);
    if (!put.ok) {
      await call('abort_upload', { media_id: s.media_id }).catch(() => undefined);
      return text(`The upload to storage failed (HTTP ${put.status}).`, true);
    }
    return call('complete_upload', { media_id: s.media_id });
  }

  async close() {
    await this.client?.close().catch(() => undefined);
    await this.server.close().catch(() => undefined);
  }
}

function isSessionGone(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err);
  return /\b404\b|session not found|session.*(expired|terminated)|not connected/i.test(msg);
}

function explain(err: unknown, url: string): Error {
  const msg = String((err as Error)?.message ?? err);
  const code = (err as { code?: unknown })?.code;
  if (code === 401 || /\b401\b|unauthori[sz]ed|authorization|invalid api key/i.test(msg)) return new Error(`Reelspan refused the API key (401). Check REELSPAN_API_KEY; create a key in the dashboard under Developers → API keys.`);
  if (code === 403 || /\b403\b/.test(msg)) return new Error(`The API key lacks a scope the MCP needs (403). Give the key the posts and profiles scopes.`);
  return new Error(`Could not reach the Reelspan MCP at ${url}: ${msg}`);
}
