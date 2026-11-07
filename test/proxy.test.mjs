// Runs the proxy against a local stand-in for the hosted MCP (no network): tools, filters, calls and auth.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { ReelspanMcpProxy, toolAllowed } from '../dist/proxy.js';
import { parseArgs } from '../dist/cli.js';

const seen = [];
let http, url;

function makeUpstream() {
  const s = new McpServer({ name: 'stand-in', version: '1' }, { instructions: 'Use list_profiles first.' });
  s.registerTool('list_profiles', { description: 'List profiles', annotations: { readOnlyHint: true } }, async () => ({ content: [{ type: 'text', text: '{"profiles":[{"username":"brand"}]}' }] }));
  s.registerTool('upload_text', { description: 'Post text', inputSchema: { user: z.string(), title: z.string() } }, async (a) => ({ content: [{ type: 'text', text: JSON.stringify({ success: true, echo: a }) }] }));
  s.registerTool('delete_profile', { description: 'Delete', inputSchema: { username: z.string() }, annotations: { destructiveHint: true } }, async () => ({ content: [{ type: 'text', text: 'deleted' }] }));
  return s;
}

before(async () => {
  const sessions = new Map();
  http = createServer(async (req, res) => {
    seen.push({ auth: req.headers.authorization, ua: req.headers['user-agent'] });
    if (req.headers.authorization !== 'Bearer rs_test_good') {
      res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'invalid api key' }, id: null }));
      return;
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const sid = req.headers['mcp-session-id'];
    let transport = sid && sessions.get(sid);
    if (!transport) {
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), enableJsonResponse: true, onsessioninitialized: (id) => sessions.set(id, transport) });
      await makeUpstream().connect(transport);
    }
    await transport.handleRequest(req, res, body);
  });
  await new Promise((r) => http.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${http.address().port}/mcp`;
});
after(() => http.close());

async function connect(opts) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const proxy = await ReelspanMcpProxy.start(a, { apiKey: 'rs_test_good', url, ...opts });
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(b);
  return { proxy, client };
}

test('forwards the tools, instructions and calls with the key', async () => {
  const { proxy, client } = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['delete_profile', 'list_profiles', 'upload_text']);
  assert.equal(client.getInstructions(), 'Use list_profiles first.');
  const r = await client.callTool({ name: 'upload_text', arguments: { user: 'brand', title: 'hi' } });
  assert.deepEqual(JSON.parse(r.content[0].text).echo, { user: 'brand', title: 'hi' });
  assert.ok(seen.every((s) => s.auth === 'Bearer rs_test_good'));
  assert.match(seen.at(-1).ua, /^reelspan-mcp\//);
  await proxy.close();
});

test('read-only hides and refuses tools that write', async () => {
  const { proxy, client } = await connect({ readOnly: true });
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name), ['list_profiles']);
  const r = await client.callTool({ name: 'delete_profile', arguments: { username: 'brand' } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /not available/);
  await proxy.close();
});

test('allow and deny lists', async () => {
  const { proxy, client } = await connect({ excludeTools: ['delete_profile'] });
  assert.deepEqual((await client.listTools()).tools.map((t) => t.name).sort(), ['list_profiles', 'upload_text']);
  await proxy.close();
  assert.equal(toolAllowed({ name: 'a' }, { tools: ['b'] }), false);
  assert.equal(toolAllowed({ name: 'b' }, { tools: ['b'] }), true);
});

test('a wrong key gives a clear error', async () => {
  const [a] = InMemoryTransport.createLinkedPair();
  await assert.rejects(ReelspanMcpProxy.start(a, { apiKey: 'rs_bad', url }), /refused the API key/);
});

test('no key at all', async () => {
  const saved = process.env.REELSPAN_API_KEY;
  delete process.env.REELSPAN_API_KEY;
  const [a] = InMemoryTransport.createLinkedPair();
  await assert.rejects(ReelspanMcpProxy.start(a, { url }), /REELSPAN_API_KEY/);
  if (saved) process.env.REELSPAN_API_KEY = saved;
});

test('arguments', () => {
  const a = parseArgs(['--read-only', '--tools=upload_text,list_profiles', '--timeout', '30'], {});
  assert.equal(a.readOnly, true);
  assert.deepEqual(a.tools, ['upload_text', 'list_profiles']);
  assert.equal(a.timeoutMs, 30000);
  assert.equal(parseArgs([], { REELSPAN_READ_ONLY: '1' }).readOnly, true);
  assert.throws(() => parseArgs(['--nope'], {}), /Unknown option/);
});
