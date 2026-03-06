#!/usr/bin/env node
import assert from 'assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const tempHome = mkdtempSync(join(tmpdir(), 'remotelab-status-broadcast-'));
const tempBin = join(tempHome, 'bin');
const configDir = join(tempHome, '.config', 'remotelab');

mkdirSync(tempBin, { recursive: true });
mkdirSync(configDir, { recursive: true });

const fakeCodexPath = join(tempBin, 'fake-codex');
writeFileSync(
  fakeCodexPath,
  `#!/usr/bin/env node
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-test' }));
console.log(JSON.stringify({ type: 'turn.started' }));
setTimeout(() => {
  console.log(JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: 'finished' },
  }));
  console.log(JSON.stringify({
    type: 'turn.completed',
    usage: { input_tokens: 1, output_tokens: 1 },
  }));
}, 25);
setTimeout(() => process.exit(0), 40);
`,
  'utf8',
);
chmodSync(fakeCodexPath, 0o755);

writeFileSync(
  join(configDir, 'tools.json'),
  JSON.stringify(
    [
      {
        id: 'fake-codex',
        name: 'Fake Codex',
        command: 'fake-codex',
        runtimeFamily: 'codex-json',
        models: [{ id: 'fake-model', label: 'Fake model' }],
        reasoning: {
          kind: 'enum',
          label: 'Reasoning',
          levels: ['low'],
          default: 'low',
        },
      },
    ],
    null,
    2,
  ),
  'utf8',
);

process.env.HOME = tempHome;
process.env.PATH = `${tempBin}:${process.env.PATH}`;

const sessionManager = await import(
  pathToFileURL(join(repoRoot, 'chat', 'session-manager.mjs')).href
);
const wsClients = await import(
  pathToFileURL(join(repoRoot, 'chat', 'ws-clients.mjs')).href
);

const {
  createSession,
  sendMessage,
  subscribe,
  unsubscribe,
  killAll,
} = sessionManager;
const { setWss } = wsClients;

function makeWs(authSession) {
  return {
    readyState: 1,
    _authSession: authSession,
    messages: [],
    send(payload) {
      this.messages.push(JSON.parse(payload));
    },
  };
}

async function waitFor(predicate, description, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${description}`);
}

const ownerWs = makeWs({ role: 'owner' });
const visitorWs = makeWs({ role: 'visitor', sessionId: 'placeholder' });
setWss({ clients: new Set([ownerWs, visitorWs]) });

const ownerSessionA = createSession(tempHome, 'fake-codex', 'Owner A');
const ownerSessionB = createSession(tempHome, 'fake-codex', 'Owner B');
subscribe(ownerSessionB.id, ownerWs);

sendMessage(ownerSessionA.id, 'Say hello', [], {
  tool: 'fake-codex',
  model: 'fake-model',
  effort: 'low',
});

await waitFor(
  () => ownerWs.messages.some(
    (msg) =>
      msg.type === 'session'
      && msg.session?.id === ownerSessionA.id
      && msg.session?.status === 'running',
  ),
  'owner should receive a running update for a non-attached owner session',
);

await waitFor(
  () => ownerWs.messages.some(
    (msg) =>
      msg.type === 'session'
      && msg.session?.id === ownerSessionA.id
      && msg.session?.status === 'idle',
  ),
  'owner should receive a completion update for a non-attached owner session',
);

const visitorSession = createSession(tempHome, 'fake-codex', 'Visitor A', {
  visitorId: 'visitor-1',
});
visitorWs._authSession.sessionId = visitorSession.id;
subscribe(visitorSession.id, visitorWs);
ownerWs.messages = [];

sendMessage(visitorSession.id, 'Visitor run', [], {
  tool: 'fake-codex',
  model: 'fake-model',
  effort: 'low',
});

await waitFor(
  () => visitorWs.messages.some(
    (msg) =>
      msg.type === 'session'
      && msg.session?.id === visitorSession.id
      && msg.session?.status === 'idle',
  ),
  'visitor should still receive its own completion update',
);

assert.equal(
  ownerWs.messages.some(
    (msg) => msg.type === 'session' && msg.session?.id === visitorSession.id,
  ),
  false,
  'owner clients must not receive visitor session status broadcasts',
);

unsubscribe(ownerSessionB.id, ownerWs);
unsubscribe(visitorSession.id, visitorWs);
killAll();
setWss({ clients: new Set() });
rmSync(tempHome, { recursive: true, force: true });

console.log('test-session-status-broadcast: ok');
