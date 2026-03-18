#!/usr/bin/env node
import assert from 'assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const cookie = 'session_token=test-session';
const commandPath = join(repoRoot, 'scripts', 'micro-agent.mjs');

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address?.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitFor(condition, label, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function request(port, method, path, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/json',
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let json = null;
          try { json = data ? JSON.parse(data) : null; } catch {}
          resolve({ status: res.statusCode, json, text: data });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function setupTempHome(providerBaseUrl) {
  const home = mkdtempSync(join(tmpdir(), 'remotelab-micro-agent-'));
  const configDir = join(home, '.config', 'remotelab');
  const workspace = join(home, 'workspace');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(workspace, { recursive: true });

  writeFileSync(
    join(configDir, 'auth.json'),
    JSON.stringify({ token: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' }, null, 2),
    'utf8',
  );
  writeFileSync(
    join(configDir, 'auth-sessions.json'),
    JSON.stringify({ 'test-session': { expiry: Date.now() + 60 * 60 * 1000, role: 'owner' } }, null, 2),
    'utf8',
  );
  writeFileSync(
    join(configDir, 'micro-agent.json'),
    JSON.stringify({
      apiKey: 'test-micro-key',
      baseUrl: providerBaseUrl,
      model: 'fake-micro-agent',
      maxIterations: 4,
      requestTimeoutMs: 5000,
      bashTimeoutMs: 5000,
      maxToolOutputChars: 4000,
      maxToolCallsPerTurn: 3,
      maxWriteChars: 4000,
      tools: {
        bash: true,
        list_dir: true,
        read_file: true,
        write_file: true,
        request_upgrade: true,
      },
    }, null, 2),
    'utf8',
  );
  writeFileSync(
    join(configDir, 'tools.json'),
    JSON.stringify([
      {
        id: 'micro-agent',
        name: 'Micro Agent',
        command: commandPath,
        runtimeFamily: 'claude-stream-json',
        promptMode: 'bare-user',
        flattenPrompt: true,
        models: [{ id: 'fake-micro-agent', label: 'Fake Micro Agent' }],
        reasoning: { kind: 'none', label: 'Thinking' },
      },
    ], null, 2),
    'utf8',
  );

  return { home, workspace };
}

async function startServer({ home, port }) {
  const child = spawn(process.execPath, ['chat-server.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      CHAT_PORT: String(port),
      SECURE_COOKIES: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  await waitFor(async () => {
    try {
      const res = await request(port, 'GET', '/api/auth/me');
      return res.status === 200;
    } catch {
      return false;
    }
  }, 'server startup');

  return { child, getStdout: () => stdout, getStderr: () => stderr };
}

async function stopServer(server) {
  if (!server?.child || server.child.exitCode !== null) return;
  server.child.kill('SIGTERM');
  await waitFor(() => server.child.exitCode !== null, 'server shutdown');
}

async function startProviderServer() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    await new Promise((resolve) => req.on('end', resolve));

    if (req.method === 'POST' && req.url === '/chat/completions') {
      const parsed = JSON.parse(body || '{}');
      requests.push(parsed);

      const firstUserMessage = parsed.messages?.find((message) => message.role === 'user')?.content || '';
      const hasToolResult = Array.isArray(parsed.messages)
        && parsed.messages.some((message) => message.role === 'tool');

      res.writeHead(200, { 'Content-Type': 'application/json' });

      if (/Create marker file/.test(firstUserMessage)) {
        if (!hasToolResult) {
          res.end(JSON.stringify({
            id: 'resp_write_tool',
            object: 'chat.completion',
            model: parsed.model,
            choices: [{
              index: 0,
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [{
                  id: 'call_write_1',
                  type: 'function',
                  function: {
                    name: 'write_file',
                    arguments: JSON.stringify({
                      path: 'tmp-output/marker.txt',
                      content: 'hello from micro agent\n',
                      mode: 'overwrite',
                    }),
                  },
                }],
              },
            }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }));
          return;
        }

        res.end(JSON.stringify({
          id: 'resp_write_final',
          object: 'chat.completion',
          model: parsed.model,
          choices: [{
            index: 0,
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: 'Marker file written.',
            },
          }],
          usage: { prompt_tokens: 12, completion_tokens: 7 },
        }));
        return;
      }

      if (/Plan a broad refactor/.test(firstUserMessage)) {
        res.end(JSON.stringify({
          id: 'resp_upgrade_tool',
          object: 'chat.completion',
          model: parsed.model,
          choices: [{
            index: 0,
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{
                id: 'call_upgrade_1',
                type: 'function',
                function: {
                  name: 'request_upgrade',
                  arguments: JSON.stringify({
                    target_tool: 'codex',
                    reason: 'Needs deeper multi-file repo work',
                  }),
                },
              }],
            },
          }],
          usage: { prompt_tokens: 9, completion_tokens: 4 },
        }));
        return;
      }

      res.end(JSON.stringify({
        id: 'resp_default',
        object: 'chat.completion',
        model: parsed.model,
        choices: [{
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'Default reply.',
          },
        }],
        usage: { prompt_tokens: 4, completion_tokens: 2 },
      }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    server,
    requests,
    port: server.address().port,
  };
}

async function createSession(port, folder, name) {
  const res = await request(port, 'POST', '/api/sessions', {
    folder,
    tool: 'micro-agent',
    name,
    group: 'Tests',
    description: 'Micro agent runtime test',
  });
  assert.equal(res.status, 201, 'create session should succeed');
  return res.json.session;
}

async function submitMessage(port, sessionId, requestId, text) {
  const res = await request(port, 'POST', `/api/sessions/${sessionId}/messages`, {
    requestId,
    text,
    tool: 'micro-agent',
    model: 'fake-micro-agent',
  });
  assert.ok(res.status === 202 || res.status === 200, 'submit message should succeed');
  return res.json.run;
}

async function waitForRunTerminal(port, runId) {
  let run = null;
  await waitFor(async () => {
    const res = await request(port, 'GET', `/api/runs/${runId}`);
    if (res.status !== 200) return false;
    run = res.json.run;
    return ['completed', 'failed', 'cancelled'].includes(run.state);
  }, `run ${runId} terminal`, 15000);
  return run;
}

const provider = await startProviderServer();
const { home, workspace } = setupTempHome(`http://127.0.0.1:${provider.port}`);
const port = await getFreePort();
const server = await startServer({ home, port });

try {
  const writeSession = await createSession(port, workspace, 'Micro write');
  const writeRun = await submitMessage(port, writeSession.id, 'req-micro-write', 'Create marker file and confirm.');
  const writeTerminal = await waitForRunTerminal(port, writeRun.id);

  assert.equal(writeTerminal.state, 'completed', `write run should complete: ${server.getStderr()}`);
  assert.ok((writeTerminal.normalizedEventCount || 0) > 0, 'micro agent should emit normalized events');
  assert.equal(provider.requests[0]?.messages?.[1]?.content, 'Create marker file and confirm.', 'bare-user prompt mode should pass only the user text');

  const markerPath = join(workspace, 'tmp-output', 'marker.txt');
  assert.equal(existsSync(markerPath), true, 'write_file should create the requested file');
  assert.equal(readFileSync(markerPath, 'utf8'), 'hello from micro agent\n', 'write_file should write the expected content');

  const writeEvents = await request(port, 'GET', `/api/sessions/${writeSession.id}/events`);
  assert.equal(writeEvents.status, 200, 'write session events request should succeed');
  assert.equal(
    writeEvents.json.events.some((event) => event.type === 'message' && event.role === 'assistant' && /Marker file written\./.test(event.content || '')),
    true,
    'history should include the final assistant reply for the write flow',
  );

  const upgradeSession = await createSession(port, workspace, 'Micro upgrade');
  const upgradeRun = await submitMessage(port, upgradeSession.id, 'req-micro-upgrade', 'Plan a broad refactor across several files.');
  const upgradeTerminal = await waitForRunTerminal(port, upgradeRun.id);

  assert.equal(upgradeTerminal.state, 'completed', `upgrade run should complete: ${server.getStderr()}`);
  const upgradeRequests = provider.requests.filter((parsed) => (
    parsed.messages?.find((message) => message.role === 'user')?.content === 'Plan a broad refactor across several files.'
  ));
  assert.equal(upgradeRequests.length, 1, 'upgrade flow should only issue one provider request for the user turn');
  assert.equal(
    upgradeRequests[0]?.messages?.some((message) => message.role === 'tool'),
    false,
    'upgrade flow should short-circuit locally without sending tool results back to the provider',
  );

  const upgradedSessionRes = await request(port, 'GET', `/api/sessions/${upgradeSession.id}`);
  assert.equal(upgradedSessionRes.status, 200, 'upgraded session fetch should succeed');
  assert.equal(upgradedSessionRes.json.session?.tool, 'codex', 'session tool should auto-switch to codex after upgrade request');

  const upgradeEvents = await request(port, 'GET', `/api/sessions/${upgradeSession.id}/events`);
  assert.equal(upgradeEvents.status, 200, 'upgrade session events request should succeed');
  assert.equal(
    upgradeEvents.json.events.some((event) => event.type === 'message' && event.role === 'assistant' && /better fit for CodeX next/i.test(event.content || '')),
    true,
    'history should include the assistant handoff message',
  );
  assert.equal(
    upgradeEvents.json.events.some((event) => event.type === 'status' && /Next turn will use CodeX/i.test(event.content || '')),
    true,
    'history should include the manager-applied tool switch status event',
  );

  console.log('test-micro-agent-runtime: ok');
} finally {
  await stopServer(server);
  await new Promise((resolve) => provider.server.close(resolve));
  rmSync(home, { recursive: true, force: true });
}
