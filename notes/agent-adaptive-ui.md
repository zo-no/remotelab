# Agent-Adaptive UI for RemoteLab

_Started: 2026-03-11_

## Problem

We want a V0-like mechanism inside RemoteLab:

- The agent should decide how data is best presented.
- The presentation can change dynamically as the task evolves.
- The UI may need to collect structured input from the user, not just plain chat replies.
- The user has not pre-defined all possible display modes.

The initial idea is:

- use an `iframe`
- when the agent decides the data fits a form/table workflow, spin up a service
- show the user an interactive UI such as a multi-select table

This direction is valid, but "spawn a service per UI" should not be the default mechanism.

## Core Position

The agent should decide **presentation intent**, not arbitrary frontend implementation.

That means the primary contract should be:

1. agent inspects data + task state
2. agent emits a structured UI spec
3. RemoteLab renders that spec in a controlled surface
4. user actions flow back as structured events
5. agent revises the UI spec or continues in chat

So the real capability is not "agent can generate a UI".
It is:

> agent can choose the next best interaction primitive for the current state

This is much more stable, faster, and safer than asking the agent to build a one-off app every turn.

## Recommended Architecture

Use a two-lane model.

### Lane 1: Declarative built-in widgets

This should cover most interactions.

Agent emits a small JSON manifest such as:

```json
{
  "version": 1,
  "title": "Choose candidate records",
  "intent": "select_rows",
  "layout": "sidecar",
  "data": {
    "columns": [
      { "key": "name", "label": "Name", "type": "text" },
      { "key": "score", "label": "Score", "type": "number" },
      { "key": "status", "label": "Status", "type": "badge" }
    ],
    "rows": [
      { "id": "r1", "name": "Alpha", "score": 92, "status": "ready" },
      { "id": "r2", "name": "Beta", "score": 84, "status": "review" }
    ]
  },
  "actions": [
    { "id": "confirm", "label": "Confirm selection", "kind": "primary" },
    { "id": "ask_agent", "label": "Ask agent to explain", "kind": "secondary" }
  ],
  "selection": {
    "mode": "multiple",
    "min": 1,
    "max": 20
  },
  "submit": {
    "type": "agent_event",
    "event": "rows_selected"
  }
}
```

RemoteLab owns the renderer. The agent owns the spec.

Candidate built-in intents:

- `summary_card`
- `key_value`
- `table`
- `select_rows`
- `form`
- `checklist`
- `approval`
- `diff_review`
- `chart`
- `timeline`
- `kanban`
- `file_picker`
- `json_inspector`

### Lane 2: Hosted custom apps

This is for cases where declarative widgets are not enough.

Examples:

- complex graph editing
- image annotation
- spreadsheet-like editing with formulas
- multi-step business workflow

In this lane, the agent can request a custom app surface, but it should still go through a platform-managed contract:

- app bundle or local service is registered with RemoteLab
- RemoteLab proxies it
- UI is shown in an `iframe`
- communication happens through a strict `postMessage` protocol

This should be the exception path, not the default.

## Why not "spawn a service every time"

If the default path is "agent starts a service for a table/form", several problems appear quickly:

- startup latency becomes part of every UI turn
- process cleanup becomes a product problem
- mobile reliability gets worse
- state continuity becomes fragile
- security review gets harder
- the model starts solving frontend bootstrapping instead of user intent

For RemoteLab, the better split is:

- common interaction patterns: built-in renderer
- rare high-complexity interactions: sandboxed iframe app

## UI Surface Model

The current chat UI already has a clear message stream and uses `iframe` elsewhere in the product. The adaptive UI should fit that model instead of replacing it.

Recommended surfaces:

### 1. Inline card inside the message stream

Good for:

- approvals
- confirmations
- simple form fields
- one-shot row selection

This keeps context tight because the UI appears exactly where the agent asks for input.

### 2. Sidecar panel

Good for:

- tables with many columns
- diffs
- filterable datasets
- charts

The message explains what is happening; the sidecar is the working surface.

### 3. Full-screen mobile sheet

Good for:

- dense editing on phone
- multi-step forms
- spreadsheet-like review

Since the user is often on mobile, some widgets should escalate automatically from inline to full-screen.

### 4. Iframe app surface

Good for:

- advanced custom applications
- temporary tools with richer local state

This should feel like "open workspace", not "random page appeared".

## Interaction Principle

The agent should not decide based on data shape alone.
It should decide based on:

- user goal
- data cardinality
- ambiguity level
- risk level
- whether the user must edit, compare, rank, approve, or browse

The important abstraction is not "this is an array".
It is "what decision is the human trying to make right now".

Suggested decision table:

| Situation | Best UI |
|---|---|
| Need user confirmation on one action | `approval` |
| Need user choose 1 or N records | `select_rows` |
| Need collect a few structured fields | `form` |
| Need compare before/after | `diff_review` |
| Need browse many records | `table` with filters |
| Need understand distribution/trend | `chart` |
| Need complex domain workflow | iframe app |

## Agent Decision Contract

Add an explicit UI tool instead of hoping the model invents the right syntax in prose.

Example conceptual tool:

```json
{
  "tool": "present_ui",
  "input": {
    "reason": "User needs to select the records to keep before I continue.",
    "surface": "sidecar",
    "spec": {
      "intent": "select_rows",
      "...": "..."
    }
  }
}
```

And a corresponding update tool:

```json
{
  "tool": "update_ui",
  "input": {
    "uiId": "ui_123",
    "spec": {
      "intent": "table",
      "...": "..."
    }
  }
}
```

And a close tool:

```json
{
  "tool": "close_ui",
  "input": {
    "uiId": "ui_123"
  }
}
```

The key point:

- the model chooses from supported interaction primitives
- the platform validates and renders
- the user action returns as structured data

## Data Flow

Recommended event loop:

1. user asks for help
2. agent analyzes current task state
3. agent decides chat-only vs adaptive UI
4. if adaptive UI is needed, agent emits `present_ui`
5. RemoteLab stores the UI artifact and renders it
6. user interacts with the UI
7. frontend sends a structured event like:

```json
{
  "type": "ui_submission",
  "uiId": "ui_123",
  "actionId": "confirm",
  "payload": {
    "selectedRowIds": ["r1", "r2"]
  }
}
```

8. this event is appended to session history
9. the agent continues with the new structured input

This is important: UI interactions should become normal session events, not an external side channel.

## State Model

Each UI artifact should have:

```js
{
  id,
  sessionId,
  status,       // open | submitted | dismissed | replaced | errored
  surface,      // inline | sidecar | modal | iframe
  spec,
  createdAt,
  updatedAt,
  result
}
```

The agent can replace prior UI instead of stacking endless widgets.

That gives a more V0-like feel:

- UI evolves with the conversation
- outdated widgets disappear or collapse into history

## API Shape for RemoteLab

This fits naturally into the current server structure.

Suggested additions around [chat/router.mjs](/Users/kual/code/remotelab/chat/router.mjs):

- `POST /api/ui`
  - create a UI artifact
- `PATCH /api/ui/:id`
  - update an existing UI artifact
- `POST /api/ui/:id/actions`
  - submit a user action from rendered UI
- `GET /api/ui/:id`
  - fetch artifact spec
- `GET /ui/:id`
  - platform renderer entry point, especially useful for iframe mode

Suggested frontend integration around [static/chat.js](/Users/kual/code/remotelab/static/chat.js) and [templates/chat.html](/Users/kual/code/remotelab/templates/chat.html):

- render UI artifacts as first-class message blocks
- add a sidecar region for larger widgets
- support a `postMessage` bridge for iframe apps
- persist open UI state in the current session

## Iframe Strategy

Use iframe, but use it intentionally.

Recommended iframe contract:

- iframe origin is same-site or proxied through RemoteLab
- sandbox is restrictive
- communication only through `postMessage`
- parent sends:
  - theme
  - viewport hints
  - initial data
  - auth-limited action token if needed
- iframe sends:
  - `ready`
  - `resize`
  - `submit`
  - `request_data`
  - `error`

This lets you isolate rich tools without making the chat page absorb arbitrary app complexity.

## How the Agent Should Decide

If we want the agent to be good at this, the system prompt should teach a simple heuristic:

1. stay in chat if prose is enough
2. choose a built-in widget if structured input will reduce user effort
3. choose iframe app only if built-in widgets are insufficient
4. prefer fewer fields, fewer clicks, and reversible actions
5. on mobile, avoid wide tables unless the selection task truly needs them

This matters more than clever rendering.
Good selection policy is the core capability.

## Mobile-Specific Guidance

Because RemoteLab is often used from a phone:

- do not default to wide spreadsheet UIs
- present the top decision first, details second
- support row cards as an alternative to dense tables
- let the agent request "progressive disclosure":
  - first shortlist
  - then inspect details
  - then confirm

For mobile, "multi-select table" is often worse than:

- filter chips
- row cards
- bottom action bar
- detail drawer

So the real primitive may be `select_rows`, but the renderer can choose cards on mobile and a table on desktop.

## What Will Best Unlock Agent Capability

To get the most leverage from the agent, give it three powers:

### 1. UI intent selection

The model decides whether the user needs:

- explanation
- confirmation
- selection
- editing
- comparison
- monitoring

### 2. Schema generation

The model can define:

- fields
- columns
- labels
- validation rules
- default values
- action labels

### 3. Adaptive revision

After user interaction, the model can:

- simplify the UI
- refine the schema
- ask a follow-up question
- switch surface from inline to sidecar to iframe

That creates the V0-like experience:

- not static screens
- not pre-wired flows
- an evolving interaction artifact

## What the Agent Should Not Control Directly

Avoid letting the agent freely control:

- arbitrary frontend code execution in the main chat page
- ad hoc backend endpoint mutation every turn
- unrestricted local services exposed to the browser

Instead, use a stable platform boundary:

- the agent proposes
- RemoteLab validates
- RemoteLab renders
- RemoteLab logs all actions back into the session

## Best First Implementation

Do not start from general-purpose app generation.
Start from three built-in intents:

1. `approval`
2. `form`
3. `select_rows`

This is enough to unlock a lot of practical value:

- task confirmation
- structured parameter collection
- choosing files / records / candidates

Then add:

4. `diff_review`
5. `table`
6. `chart`

Only after these feel good should you add custom iframe apps.

## Concrete Product Direction

The strongest version for RemoteLab is:

- chat remains the center of gravity
- agent can attach a live UI artifact to the conversation
- most artifacts are schema-driven and platform-rendered
- iframe apps exist as an advanced escape hatch

So the product is not "chat plus random iframes".
It is:

> a conversation where the agent can materialize the right interaction surface at the right moment

That is the right V0-like mechanism for this project.

## Suggested Phase Plan

### Phase 1

- add UI artifact schema
- add `present_ui` / `update_ui` / `close_ui` tool contract
- support inline `approval`, `form`, `select_rows`

### Phase 2

- add sidecar renderer
- responsive table/card dual rendering
- append UI submissions into session history

### Phase 3

- add iframe app host + `postMessage` protocol
- support proxied custom apps
- let the agent choose built-in vs custom surface

### Phase 4

- teach the model explicit presentation heuristics
- track which UI choices lead to fast user completion
- use this feedback to improve selection policy

## Decision for Current Direction

If we continue from the current RemoteLab codebase, the best next move is:

1. define the UI artifact JSON schema
2. implement built-in rendering for `approval`, `form`, `select_rows`
3. treat iframe apps as phase-2/3 escape hatch, not the baseline

That keeps the system coherent and gives the agent a real, reusable interaction language.
