# Documentation Map

This repo now uses a simple split:

- `docs/` — current, shareable documentation for humans and contributors
- `notes/` — internal design notes, grouped by status so current truth does not get mixed with future direction or historical rationale

## Canonical Spine

Read these first when you need the current truth:

1. `../AGENTS.md` — repo rules, constraints, active priorities
2. `project-architecture.md` — current shipped architecture and code map
3. `../notes/current/core-domain-contract.md` — current domain/refactor baseline
4. `setup.md` / `external-message-protocol.md` / other focused guides as needed

## What Lives In `docs/`

### Current Core

- `project-architecture.md` — top-down map of the shipped system
- `setup.md` — installation and service setup
- `external-message-protocol.md` — canonical integration contract for external channels
- `creating-apps.md` — user/developer guide for Apps

### Focused Integrations

- `cloudflare-email-worker.md` — email worker deployment notes
- `github-auto-triage.md` — GitHub intake/auto-reply workflow

## What Lives In `notes/`

See `../notes/README.md` for the note taxonomy.

Short version:

- `../notes/current/` — current baseline notes that still matter operationally
- `../notes/directional/` — future-facing design direction
- `../notes/archive/` — historical RFCs, investigations, and superseded merge notes
- `../notes/local/` — machine/operator-specific state that should not be treated as shared architecture truth

## Authoring Rule

Before adding a new doc, ask:

1. Is this current truth or a discussion artifact?
2. Is it for users/operators, or for internal design work?
3. Will it still be true after the next refactor, or is it historical rationale?

If the answer is unclear, prefer:

- `docs/` for current operational truth
- `notes/directional/` for future design
- `notes/archive/` for investigation history
