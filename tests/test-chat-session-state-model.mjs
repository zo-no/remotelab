#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const source = readFileSync(
  join(repoRoot, 'static', 'chat', 'session-state-model.js'),
  'utf8',
);

const context = {
  console,
};
context.globalThis = context;
context.window = context;

vm.runInNewContext(source, context, {
  filename: 'session-state-model.js',
});

const model = context.RemoteLabSessionStateModel;

assert.ok(model, 'session state model should attach to the global scope');

const optimisticRunning = model.getSessionStatusSummary(
  {
    id: 'session-pending',
    name: 'Pending session',
    status: 'idle',
  },
  {
    hasPendingDelivery: true,
  },
);
assert.equal(optimisticRunning.primary.key, 'running');
assert.equal(
  Array.from(optimisticRunning.indicators, (indicator) => indicator.key).join(','),
  'running',
  'pending local delivery should surface as running immediately',
);

const unreadStatus = model.getSessionStatusSummary(
  {
    id: 'session-done',
    name: 'Done session',
    status: 'done',
  },
  {
    isRead: () => false,
  },
);
assert.equal(unreadStatus.primary.key, 'unread');
assert.equal(unreadStatus.primary.label, 'unread');

const pendingAccepted = model.normalizePendingMessage({
  text: 'hello',
  requestId: 'req-1',
  timestamp: Date.now(),
  deliveryState: 'accepted',
});
assert.equal(
  model.shouldKeepPendingMessagePending(pendingAccepted, { status: 'idle' }),
  true,
  'accepted pending messages should stay non-failing during the delivery grace window',
);

const pendingSending = model.normalizePendingMessage({
  text: 'hello',
  requestId: 'req-2',
  timestamp: Date.now() - 20000,
});
assert.equal(
  model.shouldKeepPendingMessagePending(pendingSending, { status: 'idle' }),
  false,
  'stale pending messages should surface for recovery after the grace window',
);

const renamingStatus = model.getSessionStatusSummary(
  {
    id: 'session-renaming',
    status: 'idle',
    renameState: 'pending',
  },
);
assert.equal(renamingStatus.primary.key, 'renaming');

const idleStatus = model.getSessionStatusSummary(
  {
    id: 'session-idle',
    status: 'idle',
  },
);
assert.equal(idleStatus.primary.key, 'idle');
assert.equal(idleStatus.primary.label, 'idle');
