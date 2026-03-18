# Micro Agent

## What it is

`Micro Agent` is a very small local executor for RemoteLab.

It is intentionally **not** a full coding-agent shell like CodeX or Claude Code. It exists for the default case where the model mostly needs:

1. a compact prompt
2. a short local tool loop
3. direct OpenAI-compatible API access
4. a clean way to hand off to a heavier executor when the task grows

The design goal is simple: make the default path light, and make upgrading explicit and cheap.

## Architecture

```text
RemoteLab session
  -> custom tool entry (`micro-agent`)
    -> `scripts/micro-agent.mjs`
      -> OpenAI-compatible `/chat/completions`
      -> local tool executor (`bash`, `list_dir`, `read_file`, `write_file`)
      -> optional upgrade request back to RemoteLab (`codex` by default)
      -> Claude-compatible JSON event stream back to RemoteLab
```

This keeps RemoteLab compatible with the existing `claude-stream-json` runtime without rebuilding the whole provider stack first.

## Core behavior

- `promptMode: bare-user`
- `flattenPrompt: true`
- no user-facing thinking toggle; the agent decides depth internally
- short tool loop by default (`maxIterations: 4`)
- explicit small tool surface
- clean handoff path when the task stops fitting the micro-agent

The micro-agent is meant to be the default lightweight executor, not the executor that slowly re-implements a heavy coding shell.

## Built-in tools

- `bash` — short shell commands in the current working directory
- `list_dir` — directory listing
- `read_file` — small text file reads
- `write_file` — focused text-file writes or appends
- `request_upgrade` — ask RemoteLab to switch the next turn to a heavier executor

The expected split is:

- small local actions stay here
- broad repo editing and longer repair loops move to `codex`

## Upgrade model

The micro-agent can request a handoff itself.

Current version supports a thin upgrade protocol:

- the model may call `request_upgrade`
- RemoteLab records the handoff reason
- RemoteLab switches the session's default tool for the next turn

If the micro-agent hits its own loop limit before reaching a clean answer, it auto-hands off to `codex` instead of pretending to be a heavier shell.

## Install

```bash
node scripts/install-micro-agent.mjs --api-key <key> --base-url <openai-compatible-base-url> --model <model-id>
```

The installer:

- writes config to `~/.config/remotelab/micro-agent.json`
- registers a RemoteLab custom tool in `~/.config/remotelab/tools.json`
- hides manual thinking controls in the UI by setting `reasoning.kind` to `none`
- reuses an existing `doubao-fast-agent` config when available

## Use in RemoteLab

After installation, choose tool `micro-agent` when creating a session.

This is the intended default when you want:

- low latency
- a small local tool surface
- direct model API execution
- automatic escalation only when the task genuinely stops fitting

## Current limits

- no repo map
- no large edit protocol
- no long-running detached job orchestration inside the agent itself
- no attempt to imitate a full coding IDE shell

That is intentional. The point of this module is to keep the base executor small, then pay for heavier behavior only when the task earns it.
