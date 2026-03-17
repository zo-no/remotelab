#!/usr/bin/env node
import assert from 'assert/strict';
import { buildCodexArgs } from '../chat/adapters/codex.mjs';

const args = buildCodexArgs('Say hello.', {});
assert.equal(args[0], 'exec');
assert.equal(args.at(-1), 'Say hello.');
assert.equal(args.includes('IMPORTANT: Complete ALL requested work in this single response.'), false);

const overridden = buildCodexArgs('Say hello.', { systemPrefix: 'PREFIX\n\n' });
assert.equal(overridden.at(-1), 'PREFIX\n\nSay hello.');

console.log('ok - codex args do not inject a default system prefix');
console.log('ok - codex args still allow explicit per-run system prefixes');
