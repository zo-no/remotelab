#!/usr/bin/env node

import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

import { TOOLS_FILE } from '../lib/config.mjs';

const HOME = homedir();
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DEFAULT_CONFIG_PATH = join(HOME, '.config', 'remotelab', 'micro-agent.json');
const DOUBAO_FAST_CONFIG_PATH = join(HOME, '.config', 'remotelab', 'doubao-fast-agent.json');
const DEFAULT_TOOL_ID = 'micro-agent';
const DEFAULT_TOOL_NAME = 'Micro Agent';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4.1-mini';
const COMMAND_PATH = join(REPO_ROOT, 'scripts', 'micro-agent.mjs');

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
  node scripts/install-micro-agent.mjs [options]

Options:
  --api-key <key>          OpenAI-compatible API key
  --base-url <url>         OpenAI-compatible base URL (default: ${DEFAULT_BASE_URL})
  --model <id>             Model id (default: ${DEFAULT_MODEL})
  --config <path>          Config output path (default: ${DEFAULT_CONFIG_PATH})
  --tool-id <id>           RemoteLab tool id (default: ${DEFAULT_TOOL_ID})
  --tool-name <name>       RemoteLab tool label (default: ${DEFAULT_TOOL_NAME})
  -h, --help               Show this help

The installer looks for credentials in this order:
  1. explicit flags
  2. MICRO_AGENT_* env vars
  3. OPENAI_* / DOUBAO_* / ARK_* env vars
  4. existing ${DOUBAO_FAST_CONFIG_PATH}
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const result = {
    apiKey: '',
    baseUrl: '',
    model: '',
    configPath: '',
    toolId: DEFAULT_TOOL_ID,
    toolName: DEFAULT_TOOL_NAME,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--api-key':
        result.apiKey = argv[index + 1] || '';
        index += 1;
        break;
      case '--base-url':
        result.baseUrl = argv[index + 1] || '';
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
      case '--tool-id':
        result.toolId = argv[index + 1] || DEFAULT_TOOL_ID;
        index += 1;
        break;
      case '--tool-name':
        result.toolName = argv[index + 1] || DEFAULT_TOOL_NAME;
        index += 1;
        break;
      case '-h':
      case '--help':
        printUsage(0);
        break;
      default:
        break;
    }
  }
  return result;
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
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

function coalesce(...values) {
  for (const value of values) {
    const trimmed = trimString(value);
    if (trimmed) return trimmed;
  }
  return '';
}

async function resolveSourceConfig(options) {
  const doubaoFastConfig = await loadJsonFile(DOUBAO_FAST_CONFIG_PATH);
  return {
    apiKey: coalesce(
      options.apiKey,
      process.env.MICRO_AGENT_API_KEY,
      process.env.OPENAI_API_KEY,
      process.env.DOUBAO_API_KEY,
      process.env.ARK_API_KEY,
      doubaoFastConfig?.apiKey,
    ),
    baseUrl: coalesce(
      options.baseUrl,
      process.env.MICRO_AGENT_BASE_URL,
      process.env.OPENAI_API_BASE,
      process.env.DOUBAO_API_BASE,
      process.env.ARK_API_BASE,
      doubaoFastConfig?.baseUrl,
      DEFAULT_BASE_URL,
    ),
    model: coalesce(
      options.model,
      process.env.MICRO_AGENT_MODEL,
      process.env.OPENAI_MODEL,
      process.env.DOUBAO_MODEL,
      process.env.ARK_MODEL,
      doubaoFastConfig?.model,
      DEFAULT_MODEL,
    ),
  };
}

async function loadTools() {
  const existing = await loadJsonFile(TOOLS_FILE);
  return Array.isArray(existing) ? existing : [];
}

async function saveTools(tools) {
  await mkdir(dirname(TOOLS_FILE), { recursive: true });
  await writeFile(TOOLS_FILE, JSON.stringify(tools, null, 2), 'utf8');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const configPath = resolve(trimString(options.configPath) || DEFAULT_CONFIG_PATH);
  const source = await resolveSourceConfig(options);

  if (!source.apiKey) {
    printUsage(1, 'Unable to resolve an API key for Micro Agent.');
  }

  if (!(await pathExists(COMMAND_PATH))) {
    throw new Error(`Micro agent command not found: ${COMMAND_PATH}`);
  }

  const config = {
    apiKey: source.apiKey,
    baseUrl: source.baseUrl,
    model: source.model,
    maxIterations: 4,
    requestTimeoutMs: 20000,
    bashTimeoutMs: 12000,
    maxToolOutputChars: 12000,
    maxDirectoryEntries: 200,
    maxToolCallsPerTurn: 3,
    maxWriteChars: 200000,
    tools: {
      bash: true,
      list_dir: true,
      read_file: true,
      write_file: true,
      request_upgrade: true,
    },
  };

  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');

  const tools = await loadTools();
  const filtered = tools.filter((tool) => tool?.id !== options.toolId);
  filtered.push({
    id: options.toolId,
    name: trimString(options.toolName) || DEFAULT_TOOL_NAME,
    command: COMMAND_PATH,
    runtimeFamily: 'claude-stream-json',
    promptMode: 'bare-user',
    flattenPrompt: true,
    models: [{ id: source.model, label: source.model }],
    reasoning: { kind: 'none', label: 'Thinking' },
  });
  await saveTools(filtered);

  console.log(`Installed Micro Agent:`);
  console.log(`- config: ${configPath}`);
  console.log(`- tool id: ${options.toolId}`);
  console.log(`- command: ${COMMAND_PATH}`);
  console.log(`- model: ${source.model}`);
  console.log(`- base URL: ${source.baseUrl}`);
}

await main();
