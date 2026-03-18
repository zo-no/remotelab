#!/usr/bin/env node

import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from 'fs/promises';
import { homedir, platform } from 'os';
import { dirname, join, resolve } from 'path';

const HOME = homedir();
const DEFAULT_CONFIG_PATH = join(HOME, '.config', 'remotelab', 'micro-agent.json');
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4.1-mini';
const DEFAULT_MAX_ITERATIONS = 4;
const DEFAULT_REQUEST_TIMEOUT_MS = 20000;
const DEFAULT_BASH_TIMEOUT_MS = 12000;
const DEFAULT_TOOL_OUTPUT_CHARS = 12000;
const DEFAULT_DIRECTORY_ENTRIES = 200;
const DEFAULT_TOOL_CALLS_PER_TURN = 3;
const DEFAULT_MAX_WRITE_CHARS = 200000;

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function printUsage(exitCode = 0, errorMessage = '') {
  const output = exitCode === 0 ? console.log : console.error;
  if (errorMessage) {
    console.error(errorMessage);
    console.error('');
  }
  output(`Usage:
  node scripts/micro-agent.mjs -p <prompt> [options]

Options:
  -p <prompt>              Prompt text to run
  --model <id>             Override model id for this run
  --config <path>          Config path (default: ${DEFAULT_CONFIG_PATH})
  --output-format <type>   text | stream-json (default: stream-json)
  --resume <id>            Reuse a prior emitted session id
  --continue               Accepted for Claude-compatible CLI parity
  --verbose                Accepted for Claude-compatible CLI parity
  --effort <level>         Accepted for Claude-compatible CLI parity
  --dangerously-skip-permissions
                           Accepted for Claude-compatible CLI parity
  -h, --help               Show this help

Config shape:
  {
    "apiKey": "...",
    "baseUrl": "${DEFAULT_BASE_URL}",
    "model": "${DEFAULT_MODEL}",
    "maxIterations": 4,
    "requestTimeoutMs": 20000,
    "bashTimeoutMs": 12000,
    "maxToolOutputChars": 12000,
    "maxDirectoryEntries": 200,
    "maxToolCallsPerTurn": 3,
    "maxWriteChars": 200000,
    "systemPrompt": "optional compact instruction",
    "tools": {
      "bash": true,
      "list_dir": true,
      "read_file": true,
      "write_file": true,
      "request_upgrade": true
    }
  }
`);
  process.exit(exitCode);
}

function parsePositiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed)) return fallback;
  if (parsed < min || parsed > max) return fallback;
  return parsed;
}

function resolveHomePath(value, fallback) {
  const raw = trimString(value);
  if (!raw) return fallback;
  if (raw === '~') return HOME;
  if (raw.startsWith('~/')) return join(HOME, raw.slice(2));
  return resolve(raw);
}

function clipText(value, maxChars = DEFAULT_TOOL_OUTPUT_CHARS) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 23))}\n...[truncated]`;
}

function normalizeRequestedModel(requestedModel, fallbackModel) {
  const trimmed = trimString(requestedModel);
  return trimmed || fallbackModel;
}

async function loadJsonFile(path) {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function normalizeConfig(input, configPath) {
  const data = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const toolFlags = data.tools && typeof data.tools === 'object' && !Array.isArray(data.tools) ? data.tools : {};
  return {
    configPath,
    apiKey: trimString(
      data.apiKey
      || process.env.MICRO_AGENT_API_KEY
      || process.env.OPENAI_API_KEY
      || process.env.DOUBAO_API_KEY
      || process.env.ARK_API_KEY,
    ),
    baseUrl: trimString(
      data.baseUrl
      || process.env.MICRO_AGENT_BASE_URL
      || process.env.OPENAI_API_BASE
      || process.env.DOUBAO_API_BASE
      || process.env.ARK_API_BASE,
    ) || DEFAULT_BASE_URL,
    model: normalizeRequestedModel(
      data.model
      || process.env.MICRO_AGENT_MODEL
      || process.env.OPENAI_MODEL
      || process.env.DOUBAO_MODEL
      || process.env.ARK_MODEL,
      DEFAULT_MODEL,
    ),
    systemPrompt: trimString(data.systemPrompt),
    maxIterations: parsePositiveInteger(data.maxIterations, DEFAULT_MAX_ITERATIONS, { min: 1, max: 8 }),
    requestTimeoutMs: parsePositiveInteger(data.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, { min: 1000, max: 120000 }),
    bashTimeoutMs: parsePositiveInteger(data.bashTimeoutMs, DEFAULT_BASH_TIMEOUT_MS, { min: 500, max: 120000 }),
    maxToolOutputChars: parsePositiveInteger(data.maxToolOutputChars, DEFAULT_TOOL_OUTPUT_CHARS, { min: 256, max: 200000 }),
    maxDirectoryEntries: parsePositiveInteger(data.maxDirectoryEntries, DEFAULT_DIRECTORY_ENTRIES, { min: 10, max: 5000 }),
    maxToolCallsPerTurn: parsePositiveInteger(data.maxToolCallsPerTurn, DEFAULT_TOOL_CALLS_PER_TURN, { min: 1, max: 20 }),
    maxWriteChars: parsePositiveInteger(data.maxWriteChars, DEFAULT_MAX_WRITE_CHARS, { min: 256, max: 2000000 }),
    shell: trimString(data.shell || process.env.SHELL) || (platform() === 'darwin' ? '/bin/zsh' : '/bin/bash'),
    tools: {
      bash: toolFlags.bash !== false,
      listDir: toolFlags.list_dir !== false,
      readFile: toolFlags.read_file !== false,
      writeFile: toolFlags.write_file !== false,
      requestUpgrade: toolFlags.request_upgrade !== false,
    },
  };
}

async function loadConfig(configPath) {
  const resolvedPath = resolveHomePath(configPath || process.env.MICRO_AGENT_CONFIG || DEFAULT_CONFIG_PATH, DEFAULT_CONFIG_PATH);
  const parsed = await loadJsonFile(resolvedPath);
  const config = normalizeConfig(parsed, resolvedPath);
  if (!config.apiKey) {
    throw new Error(`Micro agent config is missing apiKey: ${resolvedPath}`);
  }
  return config;
}

function parseArgs(argv) {
  const result = {
    prompt: '',
    outputFormat: 'stream-json',
    model: '',
    configPath: '',
    resumeId: '',
    verbose: false,
    effort: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '-p':
      case '--prompt':
      case '--text':
        result.prompt = argv[index + 1] || '';
        index += 1;
        break;
      case '--output-format':
        result.outputFormat = trimString(argv[index + 1]) || 'stream-json';
        index += 1;
        break;
      case '--model':
        result.model = argv[index + 1] || '';
        index += 1;
        break;
      case '--config':
        result.configPath = argv[index + 1] || '';
        index += 1;
        break;
      case '--resume':
        result.resumeId = argv[index + 1] || '';
        index += 1;
        break;
      case '--effort':
        result.effort = trimString(argv[index + 1]);
        index += 1;
        break;
      case '--verbose':
        result.verbose = true;
        break;
      case '--continue':
      case '--dangerously-skip-permissions':
      case '--print':
      case '--thinking':
        break;
      case '-h':
      case '--help':
        printUsage(0);
        break;
      default:
        if (!arg.startsWith('-') && !result.prompt) {
          result.prompt = arg;
        }
        break;
    }
  }

  if (!trimString(result.prompt)) {
    printUsage(1, 'Prompt is required.');
  }

  return result;
}

function buildSystemPrompt(config) {
  if (config.systemPrompt) return config.systemPrompt;
  return [
    'You are Rowan Micro Agent running locally on the owner\'s machine through RemoteLab.',
    'You are the default lightweight executor, not a full coding shell.',
    'Decide your own reasoning depth internally and keep the visible reply concise.',
    'Prefer zero tool calls when a plain answer is enough; otherwise use the minimum local tools needed.',
    'Use explicit file tools for simple reads or writes before falling back to bash.',
    'If the task turns into broad repo editing, repeated test/fix loops, multi-file refactors, or needs more than a few tool calls, use request_upgrade instead of stretching this executor.',
    'Do not start long-running servers, install packages, delete data, reset git history, or make broad system changes unless the user explicitly asks.',
    'When local work succeeds, give a short status-oriented reply.',
    'Match the user\'s language.',
    `Current working directory: ${process.cwd()}`,
    `Operating system: ${platform()}`,
  ].join('\n');
}

function buildTools(config) {
  const tools = [];
  if (config.tools.bash) {
    tools.push({
      type: 'function',
      function: {
        name: 'bash',
        description: 'Run a short shell command in the current working directory on the local machine. Use this for quick inspection or narrow local operations. Avoid destructive or long-running commands unless the user explicitly asked.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command to run.' },
            timeout_ms: { type: 'integer', minimum: 500, maximum: 120000, description: 'Optional timeout override.' },
          },
          required: ['command'],
          additionalProperties: false,
        },
      },
    });
  }
  if (config.tools.listDir) {
    tools.push({
      type: 'function',
      function: {
        name: 'list_dir',
        description: 'List files and directories for a path on the local machine.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute path or path relative to the current working directory.' },
          },
          additionalProperties: false,
        },
      },
    });
  }
  if (config.tools.readFile) {
    tools.push({
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a small text file from the local machine.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute path or path relative to the current working directory.' },
            max_chars: { type: 'integer', minimum: 128, maximum: 200000, description: 'Optional character limit for the returned file content.' },
          },
          required: ['path'],
          additionalProperties: false,
        },
      },
    });
  }
  if (config.tools.writeFile) {
    tools.push({
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Write a small text file on the local machine. Good for creating or overwriting focused files without shell quoting.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute path or path relative to the current working directory.' },
            content: { type: 'string', description: 'Exact text content to write.' },
            mode: {
              type: 'string',
              enum: ['overwrite', 'append'],
              description: 'overwrite replaces the file; append adds to the end.',
            },
            create_dirs: { type: 'boolean', description: 'Create missing parent directories when true.' },
          },
          required: ['path', 'content'],
          additionalProperties: false,
        },
      },
    });
  }
  if (config.tools.requestUpgrade) {
    tools.push({
      type: 'function',
      function: {
        name: 'request_upgrade',
        description: 'Ask RemoteLab to switch the next turn to a heavier executor when this task is no longer a fit for the micro-agent. Prefer target_tool=codex for deeper repo-edit work.',
        parameters: {
          type: 'object',
          properties: {
            reason: { type: 'string', description: 'Short reason for the handoff.' },
            target_tool: { type: 'string', description: 'RemoteLab tool id to use next, usually codex.' },
          },
          required: ['reason'],
          additionalProperties: false,
        },
      },
    });
  }
  return tools;
}

function ensureJsonEventOutput(outputFormat) {
  return outputFormat === 'stream-json';
}

function buildClaudeUsage(usage = {}) {
  return {
    input_tokens: Number.isInteger(usage.prompt_tokens) ? usage.prompt_tokens : 0,
    output_tokens: Number.isInteger(usage.completion_tokens) ? usage.completion_tokens : 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
}

function emitJsonLine(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function emitAssistantMessage({ sessionId, messageId, model, text, toolCalls, usage }) {
  const content = [];
  if (trimString(text)) {
    content.push({ type: 'text', text });
  }
  for (const call of toolCalls || []) {
    content.push({
      type: 'tool_use',
      id: call.id,
      name: call.name,
      input: call.input,
    });
  }
  emitJsonLine({
    type: 'assistant',
    session_id: sessionId,
    message: {
      role: 'assistant',
      type: 'message',
      id: messageId,
      model,
      stop_reason: (toolCalls || []).length > 0 ? 'tool_use' : 'end_turn',
      stop_sequence: null,
      usage: buildClaudeUsage(usage),
      content,
    },
  });
}

function emitToolResults(sessionId, results) {
  emitJsonLine({
    type: 'user',
    session_id: sessionId,
    message: {
      role: 'user',
      type: 'message',
      content: results.map((result) => ({
        type: 'tool_result',
        tool_use_id: result.id,
        content: result.content,
        is_error: result.isError === true,
      })),
    },
  });
}

function emitResult(sessionId, resultText, usage) {
  emitJsonLine({
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: sessionId,
    result: resultText,
    usage: buildClaudeUsage(usage),
  });
}

function emitUpgradeControl(sessionId, tool, reason, message) {
  emitJsonLine({
    type: 'remotelab_control',
    action: 'upgrade',
    session_id: sessionId,
    tool,
    reason,
    message,
  });
}

function extractTextContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object' && typeof entry.text === 'string') return entry.text;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function normalizeToolCalls(rawCalls) {
  if (!Array.isArray(rawCalls)) return [];
  return rawCalls
    .map((call) => {
      const functionName = trimString(call?.function?.name);
      const argumentText = typeof call?.function?.arguments === 'string'
        ? call.function.arguments
        : JSON.stringify(call?.function?.arguments || {});
      if (!functionName) return null;
      let input = {};
      try {
        input = JSON.parse(argumentText || '{}');
      } catch {
        input = { parse_error: 'Invalid JSON arguments', raw: argumentText };
      }
      return {
        id: trimString(call?.id) || `tool_${randomUUID().replace(/-/g, '')}`,
        name: functionName,
        input,
        raw: call,
      };
    })
    .filter(Boolean);
}

async function runProcess(command, args, options = {}) {
  const timeoutMs = parsePositiveInteger(options.timeoutMs, DEFAULT_BASH_TIMEOUT_MS, { min: 100, max: 120000 });
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...(options.env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {}
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', rejectPromise);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode: code ?? 1,
        signal: signal || null,
        stdout,
        stderr,
        timedOut,
      });
    });

    if (typeof options.stdin === 'string') {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();
  });
}

function resolveToolPath(path) {
  return resolveHomePath(path || '.', process.cwd());
}

async function executeBashTool(input, config) {
  const command = trimString(input?.command);
  if (!command) {
    return { isError: true, content: 'Missing command for bash tool.' };
  }
  const timeoutMs = parsePositiveInteger(input?.timeout_ms, config.bashTimeoutMs, { min: 100, max: 120000 });
  const result = await runProcess(config.shell, ['-lc', command], {
    cwd: process.cwd(),
    timeoutMs,
  });
  const stdout = clipText(result.stdout, config.maxToolOutputChars);
  const stderr = clipText(result.stderr, config.maxToolOutputChars);
  const lines = [
    `Command: ${command}`,
    `CWD: ${process.cwd()}`,
    `Exit code: ${result.exitCode}`,
  ];
  if (result.timedOut) lines.push(`Timed out after ${timeoutMs}ms`);
  if (trimString(stdout)) {
    lines.push('Stdout:');
    lines.push(stdout);
  }
  if (trimString(stderr)) {
    lines.push('Stderr:');
    lines.push(stderr);
  }
  return {
    isError: result.exitCode !== 0 || result.timedOut,
    content: lines.join('\n'),
  };
}

async function executeListDirTool(input, config) {
  const resolvedPath = resolveToolPath(input?.path || '.');
  const dirStat = await stat(resolvedPath);
  if (!dirStat.isDirectory()) {
    return { isError: true, content: `${resolvedPath} is not a directory.` };
  }
  const entries = await readdir(resolvedPath, { withFileTypes: true });
  const lines = entries
    .slice(0, config.maxDirectoryEntries)
    .map((entry) => `${entry.isDirectory() ? 'dir ' : 'file'} ${entry.name}`);
  if (entries.length > config.maxDirectoryEntries) {
    lines.push(`... truncated after ${config.maxDirectoryEntries} entries`);
  }
  return {
    isError: false,
    content: [`Directory: ${resolvedPath}`, ...lines].join('\n'),
  };
}

async function executeReadFileTool(input, config) {
  const resolvedPath = resolveToolPath(input?.path);
  const maxChars = parsePositiveInteger(input?.max_chars, config.maxToolOutputChars, { min: 128, max: 200000 });
  const data = await readFile(resolvedPath, 'utf8');
  return {
    isError: false,
    content: `File: ${resolvedPath}\n${clipText(data, maxChars)}`,
  };
}

async function executeWriteFileTool(input, config) {
  const resolvedPath = resolveToolPath(input?.path);
  const content = typeof input?.content === 'string' ? input.content : '';
  const mode = trimString(input?.mode).toLowerCase() === 'append' ? 'append' : 'overwrite';
  const createDirs = input?.create_dirs !== false;
  if (!trimString(resolvedPath)) {
    return { isError: true, content: 'Missing path for write_file.' };
  }
  if (content.length > config.maxWriteChars) {
    return {
      isError: true,
      content: `Refused to write ${content.length} characters because the configured limit is ${config.maxWriteChars}.`,
    };
  }
  if (createDirs) {
    await mkdir(dirname(resolvedPath), { recursive: true });
  }
  if (mode === 'append') {
    await appendFile(resolvedPath, content, 'utf8');
  } else {
    await writeFile(resolvedPath, content, 'utf8');
  }
  const bytes = Buffer.byteLength(content, 'utf8');
  return {
    isError: false,
    content: `${mode === 'append' ? 'Appended' : 'Wrote'} ${bytes} bytes to ${resolvedPath}`,
  };
}

async function executeRequestUpgradeTool(input) {
  const targetTool = trimString(input?.target_tool) || 'codex';
  const reason = trimString(input?.reason) || 'Task needs a heavier executor.';
  return {
    isError: false,
    isUpgrade: true,
    targetTool,
    reason,
    content: `Requested upgrade to ${targetTool}: ${reason}`,
  };
}

async function executeToolCall(toolCall, config) {
  try {
    switch (toolCall.name) {
      case 'bash':
        return await executeBashTool(toolCall.input, config);
      case 'list_dir':
        return await executeListDirTool(toolCall.input, config);
      case 'read_file':
        return await executeReadFileTool(toolCall.input, config);
      case 'write_file':
        return await executeWriteFileTool(toolCall.input, config);
      case 'request_upgrade':
        return await executeRequestUpgradeTool(toolCall.input, config);
      default:
        return { isError: true, content: `Unsupported tool: ${toolCall.name}` };
    }
  } catch (error) {
    return {
      isError: true,
      content: clipText(error?.stack || error?.message || String(error), config.maxToolOutputChars),
    };
  }
}

function makeTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

function buildCompletionsUrl(baseUrl) {
  const normalized = trimString(baseUrl).replace(/\/$/, '');
  return `${normalized}/chat/completions`;
}

function isMissingModelError(payload, requestedModel, defaultModel) {
  const code = trimString(payload?.error?.code);
  const message = trimString(payload?.error?.message || payload?.message || '');
  if (!requestedModel || requestedModel === defaultModel) return false;
  if (code === 'InvalidEndpointOrModel.NotFound') return true;
  return /(does not exist|not have access|InvalidEndpointOrModel|Not Found)/i.test(message);
}

async function fetchChatCompletion(config, requestedModel, messages, tools) {
  const requested = normalizeRequestedModel(requestedModel, config.model);
  const modelToUse = requested || config.model;
  const payload = {
    model: modelToUse,
    messages,
    stream: false,
  };
  if (Array.isArray(tools) && tools.length > 0) {
    payload.tools = tools;
    payload.tool_choice = 'auto';
  }

  const attempt = async (model) => {
    const requestBody = { ...payload, model };
    const timeout = makeTimeoutSignal(config.requestTimeoutMs);
    try {
      const response = await fetch(buildCompletionsUrl(config.baseUrl), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: timeout.signal,
      });
      const rawText = await response.text();
      let json = null;
      try {
        json = rawText ? JSON.parse(rawText) : null;
      } catch {
        json = null;
      }
      if (!response.ok) {
        const error = new Error(clipText(json?.error?.message || rawText || `HTTP ${response.status}`, config.maxToolOutputChars));
        error.code = json?.error?.code;
        error.payload = json;
        error.httpStatus = response.status;
        throw error;
      }
      return { response: json || {}, modelUsed: model };
    } finally {
      timeout.cancel();
    }
  };

  try {
    return await attempt(modelToUse);
  } catch (error) {
    if (isMissingModelError(error.payload, modelToUse, config.model)) {
      return attempt(config.model);
    }
    throw error;
  }
}

function aggregateUsage(accumulator, usage = {}) {
  accumulator.prompt_tokens += Number.isInteger(usage.prompt_tokens) ? usage.prompt_tokens : 0;
  accumulator.completion_tokens += Number.isInteger(usage.completion_tokens) ? usage.completion_tokens : 0;
  return accumulator;
}

function resolveToolLabel(toolId) {
  if (toolId === 'codex') return 'CodeX';
  if (toolId === 'claude') return 'Claude Code';
  return toolId;
}

function buildUpgradeMessage(targetTool, reason) {
  const label = resolveToolLabel(targetTool);
  const suffix = trimString(reason) ? ` because ${trimString(reason)}` : '';
  return `This task is a better fit for ${label} next. I switched the next turn to ${label}${suffix}.`;
}

async function runAgent(config, args) {
  const sessionId = trimString(args.resumeId) || randomUUID().replace(/-/g, '');
  const tools = buildTools(config);
  const outputJson = ensureJsonEventOutput(args.outputFormat);
  const usageTotals = { prompt_tokens: 0, completion_tokens: 0 };
  const messages = [
    { role: 'system', content: buildSystemPrompt(config) },
    { role: 'user', content: args.prompt },
  ];

  if (outputJson) {
    emitJsonLine({ type: 'system', subtype: 'init', session_id: sessionId });
  }

  for (let iteration = 0; iteration < config.maxIterations; iteration += 1) {
    const { response, modelUsed } = await fetchChatCompletion(config, args.model, messages, tools);
    const choice = Array.isArray(response?.choices) ? response.choices[0] : null;
    const assistantMessage = choice?.message || {};
    const toolCalls = normalizeToolCalls(assistantMessage.tool_calls).slice(0, config.maxToolCallsPerTurn);
    const assistantText = extractTextContent(assistantMessage.content);
    aggregateUsage(usageTotals, response?.usage || {});

    if (outputJson) {
      emitAssistantMessage({
        sessionId,
        messageId: `msg_${randomUUID().replace(/-/g, '')}`,
        model: trimString(response?.model) || modelUsed,
        text: assistantText,
        toolCalls,
        usage: response?.usage,
      });
    }

    if (toolCalls.length === 0) {
      if (outputJson) {
        emitResult(sessionId, assistantText, usageTotals);
      } else {
        process.stdout.write(`${assistantText}\n`);
      }
      return 0;
    }

    messages.push({
      role: 'assistant',
      content: assistantText || '',
      tool_calls: toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: {
          name: call.name,
          arguments: JSON.stringify(call.input || {}),
        },
      })),
    });

    const toolResults = [];
    let upgradeRequest = null;
    for (const toolCall of toolCalls) {
      const result = await executeToolCall(toolCall, config);
      toolResults.push({
        id: toolCall.id,
        isError: result.isError === true,
        content: result.content,
      });
      if (result.isUpgrade) {
        upgradeRequest = result;
        break;
      }
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result.content,
      });
    }

    if (outputJson) {
      emitToolResults(sessionId, toolResults);
    }

    if (upgradeRequest) {
      const handoffText = buildUpgradeMessage(upgradeRequest.targetTool, upgradeRequest.reason);
      if (outputJson) {
        emitUpgradeControl(sessionId, upgradeRequest.targetTool, upgradeRequest.reason, handoffText);
        emitResult(sessionId, handoffText, usageTotals);
      } else {
        process.stdout.write(`${handoffText}\n`);
      }
      return 0;
    }
  }

  const fallbackReason = `the micro-agent hit its ${config.maxIterations}-turn loop limit`;
  const fallbackTool = 'codex';
  const handoffText = buildUpgradeMessage(fallbackTool, fallbackReason);
  if (outputJson) {
    emitUpgradeControl(sessionId, fallbackTool, fallbackReason, handoffText);
    emitResult(sessionId, handoffText, usageTotals);
  } else {
    process.stdout.write(`${handoffText}\n`);
  }
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = await loadConfig(args.configPath);
  try {
    const exitCode = await runAgent(config, args);
    process.exit(exitCode);
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  }
}

await main();
