# System-Level Memory — RemoteLab

Universal learnings and patterns that apply to all RemoteLab deployments, regardless of who runs it or on which machine. This file lives in the code repo and is shared with all users.

## What Belongs Here

- Cross-platform gotchas (macOS vs Linux differences)
- Common failure patterns and their root causes
- Effective prompt patterns and anti-patterns
- Best practices for tool orchestration (Claude Code, Codex, etc.)
- Architecture insights that reduce future debugging time

## Learnings

### Context Continuity Across Restarts (2026-03-06)
- Claude Code's `--resume <session_id>` flag is the ONLY mechanism for conversation continuity. Without it, every spawn starts a completely fresh session regardless of what the UI shows.
- Any in-memory state critical for continuity (session IDs, thread IDs) MUST be persisted to disk. In-memory Maps are wiped on process restart.
- The UI chat history (stored in JSON files) and the AI's actual context (controlled by `--resume`) are completely independent. Users will see old messages but the AI won't remember them — a confusing UX failure mode.
- Fix: persist `claudeSessionId`/`codexThreadId` in the session metadata JSON, rehydrate into memory when the session is first used after restart.
- **Rehydration ordering trap**: WebSocket `subscribe`/`attach` creates a bare `live` entry in the in-memory Map BEFORE `sendMessage` runs. If rehydration is gated on `!live`, it gets skipped. Rehydration must check the live entry's fields, not its existence.

### Testing Strategy for Self-Hosted Services (2026-03-06)
- Never restart the server you're running on to test restart-survival features. Spin up a separate instance on a different port (e.g., 7694) and run the full test cycle there.
- Use node WebSocket client for API testing — match the actual protocol (`action` field, attach-before-send flow).
