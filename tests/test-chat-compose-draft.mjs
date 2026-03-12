#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const composeSource = readFileSync(join(repoRoot, 'static/chat/compose.js'), 'utf8');

class StorageMock {
  constructor() {
    this.store = new Map();
  }

  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }

  setItem(key, value) {
    this.store.set(key, String(value));
  }

  removeItem(key) {
    this.store.delete(key);
  }
}

function makeClassList(initial = []) {
  const values = new Set(initial);
  return {
    add(...tokens) {
      tokens.forEach((token) => values.add(token));
    },
    remove(...tokens) {
      tokens.forEach((token) => values.delete(token));
    },
    toggle(token, force) {
      if (typeof force === 'boolean') {
        if (force) values.add(token);
        else values.delete(token);
        return force;
      }
      if (values.has(token)) {
        values.delete(token);
        return false;
      }
      values.add(token);
      return true;
    },
    contains(token) {
      return values.has(token);
    },
  };
}

function makeEventTarget() {
  return {
    style: {},
    disabled: false,
    title: '',
    textContent: '',
    addEventListener() {},
    focus() {},
    click() {},
    classList: makeClassList(),
  };
}

function createContext({
  storageSeed = {},
  chromeHeight = 48,
  windowInnerHeight = 900,
  visualViewportHeight = null,
} = {}) {
  const localStorage = new StorageMock();
  Object.entries(storageSeed).forEach(([key, value]) => {
    localStorage.setItem(key, value);
  });

  const inputAreaClassList = makeClassList();
  const msgInput = {
    value: '',
    scrollHeight: 12,
    style: { height: '' },
    addEventListener() {},
    focus() {},
    getBoundingClientRect() {
      return { height: parseFloat(this.style.height) || 72 };
    },
  };
  const inputArea = {
    style: {},
    classList: inputAreaClassList,
    getBoundingClientRect() {
      return {
        height: (parseFloat(msgInput.style.height) || 72) + chromeHeight,
      };
    },
  };
  const document = {
    addEventListener() {},
    removeEventListener() {},
    getElementById() {
      return null;
    },
    createElement() {
      return {
        appendChild() {},
        remove() {},
        className: '',
        id: '',
        textContent: '',
        innerHTML: '',
        style: {},
      };
    },
  };
  const windowTarget = {
    innerHeight: windowInnerHeight,
    addEventListener() {},
    visualViewport: {
      height: visualViewportHeight,
      addEventListener() {},
    },
  };
  const focusComposerCalls = [];
  const context = {
    console,
    msgInput,
    inputArea,
    inputResizeHandle: makeEventTarget(),
    focusComposerCalls,
    currentSessionId: 'session-a',
    localStorage,
    window: windowTarget,
    getComputedStyle() {
      return { lineHeight: '24' };
    },
    requestAnimationFrame(callback) {
      callback();
    },
    cancelBtn: makeEventTarget(),
    compactBtn: makeEventTarget(),
    dropToolsBtn: makeEventTarget(),
    sendBtn: makeEventTarget(),
    sessionTemplateSelect: makeEventTarget(),
    saveTemplateBtn: makeEventTarget(),
    tabSessions: makeEventTarget(),
    tabSettings: makeEventTarget(),
    sessionListFooter: makeEventTarget(),
    newSessionBtn: makeEventTarget(),
    settingsPanel: {
      classList: {
        toggle() {},
      },
    },
    sessionList: { style: {} },
    sidebarFilters: {
      classList: {
        toggle() {},
      },
    },
    pendingNavigationState: {},
    ACTIVE_SIDEBAR_TAB_STORAGE_KEY: 'activeSidebarTab',
    normalizeSidebarTab(value) {
      return value === 'settings' || value === 'progress' ? 'settings' : 'sessions';
    },
    syncBrowserState() {},
    pendingImages: [],
    getCurrentSession() {
      return { archived: false };
    },
    createRequestId() {
      return 'req_test';
    },
    visitorMode: false,
    selectedTool: null,
    selectedModel: null,
    currentToolReasoningKind: 'toggle',
    selectedEffort: null,
    thinkingEnabled: true,
    renderImagePreviews() {},
    dispatchAction() {},
    emptyState: { parentNode: null, remove() {} },
    messagesInner: { appendChild() {}, innerHTML: '', children: [] },
    appendMessageTimestamp() {},
    scrollToBottom() {},
    focusComposer(options) {
      focusComposerCalls.push(options ?? null);
      msgInput.focus(options);
      return true;
    },
    URL: {
      revokeObjectURL() {},
    },
    document,
  };
  context.globalThis = context;
  return context;
}

const context = createContext();
vm.runInNewContext(composeSource, context, { filename: 'static/chat/compose.js' });

assert.equal(context.msgInput.style.height, '72px', 'composer should default to a 3-line height');

context.msgInput.value = 'draft for A';
context.saveDraft();
assert.equal(context.localStorage.getItem('draft_session-a'), 'draft for A');

context.currentSessionId = 'session-b';
context.msgInput.value = 'stale text';
context.msgInput.style.height = '240px';
context.restoreDraft();
assert.equal(context.msgInput.value, '', 'switching to a session without a draft should clear the input');
assert.equal(context.msgInput.style.height, '72px', 'restoring an empty draft should still reset textarea height');

context.msgInput.value = 'draft for B';
context.saveDraft();
assert.equal(context.localStorage.getItem('draft_session-b'), 'draft for B');

context.currentSessionId = 'session-a';
context.restoreDraft();
assert.equal(context.msgInput.value, 'draft for A', 'switching back should restore that session draft only');

context.msgInput.value = '';
context.saveDraft();
assert.equal(context.localStorage.getItem('draft_session-a'), null, 'empty drafts should not leave stale storage behind');

context.currentSessionId = null;
context.msgInput.value = 'orphaned text';
context.restoreDraft();
assert.equal(context.msgInput.value, '', 'no attached session should present an empty composer');

const manualContext = createContext();
vm.runInNewContext(composeSource, manualContext, { filename: 'static/chat/compose.js' });
manualContext.setManualInputHeight(220);
assert.equal(manualContext.msgInput.style.height, '220px', 'manual resize should write to the textarea height directly');
assert.equal(manualContext.localStorage.getItem('msgInputHeight'), '220', 'manual resize should persist textarea height');
assert.equal(manualContext.inputArea.classList.contains('is-resized'), true, 'manual resize should mark the composer as manually sized');

manualContext.window.innerHeight = 180;
manualContext.syncInputHeightForLayout();
assert.equal(manualContext.msgInput.style.height, '100px', 'manual resize should clamp against the current viewport instead of leaving stale oversized UI');

const legacyContext = createContext({
  storageSeed: {
    inputAreaHeight: '240',
  },
});
vm.runInNewContext(composeSource, legacyContext, { filename: 'static/chat/compose.js' });
assert.equal(legacyContext.msgInput.style.height, '192px', 'legacy container height should migrate into a textarea height');
assert.equal(legacyContext.localStorage.getItem('msgInputHeight'), '192', 'legacy height should be migrated into the new textarea storage key');
assert.equal(legacyContext.localStorage.getItem('inputAreaHeight'), null, 'legacy height storage should be cleared after migration');

const standaloneViewportContext = createContext({
  windowInnerHeight: 500,
  visualViewportHeight: 260,
});
vm.runInNewContext(composeSource, standaloneViewportContext, { filename: 'static/chat/compose.js' });
standaloneViewportContext.setManualInputHeight(220);
standaloneViewportContext.syncInputHeightForLayout();
assert.equal(standaloneViewportContext.msgInput.style.height, '139px', 'manual composer height should clamp against visualViewport height when available');

const failedSendFocusContext = createContext();
vm.runInNewContext(composeSource, failedSendFocusContext, { filename: 'static/chat/compose.js' });
failedSendFocusContext.restoreFailedSendState('session-a', 'retry me', []);
assert.equal(failedSendFocusContext.focusComposerCalls.length, 1, 'failed-send recovery should invoke the shared focus helper once');
assert.equal(failedSendFocusContext.focusComposerCalls[0]?.force, true, 'failed-send recovery should force composer focus when rehydrating the draft');
assert.equal(failedSendFocusContext.focusComposerCalls[0]?.preventScroll, true, 'failed-send recovery should keep the viewport from jumping during draft recovery');
