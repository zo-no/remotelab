# Core Domain Contract

> Status: current baseline for the next RemoteLab refactor cycle.
> Purpose: freeze the product/domain model before route, storage, and frontend decomposition continue.
>
> This is the canonical domain note for the current direction.
> For the object-level code/storage crosswalk, use `notes/current/core-domain-implementation-mapping.md`.
> For the execution checklist and refactor slices, use `notes/current/core-domain-refactor-todo.md`.
> For the current shipped architecture and code map, use `docs/project-architecture.md` first.
> Older notes such as `notes/directional/app-centric-architecture.md` remain useful as historical context, but this file is the domain baseline for ongoing refactors.

---

## One-Screen Summary

RemoteLab should now be understood with one simple center:

- `Session` is the primary product object.
- `Run` is the operational execution object under a session.
- `App` is a reusable scope/policy/presentation object attached to sessions via `appId`.
- `Principal` is the access subject.
- `ShareSnapshot` is a standalone read-only publication object over a frozen session range.
- sidebar/progress/grouping/filtering are derived product surfaces, not domain truth.

Short version:

```text
Owner / App-scoped principal -> Session -> many Runs
                                \-> many ShareSnapshots
Session always belongs to one App
```

If we preserve that model, later refactors stay coherent.
If we blur it, the project will drift back into scattered special cases.

---

## Why This Document Exists

RemoteLab has been carrying several partially overlapping mental models:

- chat-first session model
- app-template model
- owner vs visitor branching
- share as a separate publishing flow
- sidebar/progress as a quasi-domain layer

That overlap is now the main source of architecture debt.

The goal of this note is to stop re-litigating the core abstractions in every implementation session.

After this note, later sessions should be able to answer:

- what is the main product object?
- what is runtime-only state?
- what is reusable policy?
- what is public publication?
- what is derived UI?
- who actually enforces permissions?

without reconstructing intent from multiple files.

---

## Product Framing

RemoteLab is not primarily:

- a terminal emulator
- a live collaborative workspace
- a generalized SaaS account system
- a share-first publishing product

RemoteLab is primarily:

- a control plane for AI workers running on one machine
- centered around durable AI conversation threads
- with optional app-shaped entry surfaces
- with optional public read-only publishing of conversation snapshots

That framing matters because it keeps the product centered on the ongoing relationship between a human and an AI worker, not on transport details or account-management complexity.

---

## Primary Design Decisions

These are the decisions that should now be treated as frozen unless we explicitly reopen them.

### 1. Session is the product center

Users think in sessions:

- open a session
- rename a session
- revisit a session
- archive a session
- share a session snapshot
- ask “what happened in this session?”

So the core product should also think in sessions.

### 2. Run is real, but subordinate

Run is not the main user-facing object.

But run is still real and necessary because it cleanly owns:

- in-flight execution
- request identity
- cancel/resume/finalization
- usage for a specific turn
- spool/sidecar coordination
- per-turn artifacts and partial outputs

The correct relationship is not “session or run”.
It is:

- session = product truth
- run = execution truth

### 3. App is above session, but often expressed as a session dimension

App is a reusable object, not just a string field.

However, in the UI it is perfectly acceptable for app to feel lightweight:

- current app filter
- current app entry surface
- current app default behavior

That keeps the product simple without flattening away the reusable record behind `appId`.

### 4. Principal stays in the domain, even if “visitor” disappears from the product

We should simplify product language.

So:

- avoid centering the product on `visitor`
- avoid pretending we already need a full heavy account system

But we still need an access subject in the model.

That subject is best called `Principal`.

### 5. Share is a separate publication object

Share should not be mixed into app auth or session ownership semantics.

It is its own thing:

- create a snapshot boundary
- publish a read-only link
- optionally revoke it later

### 6. Permissions are server-enforced

The model may influence behavior inside the granted scope.
It must not define the granted scope.

The server owns:

- which principal can access which app
- which principal can access which session
- whether a share is readable
- whether archive blocks visibility

### 7. Sidebar/progress is derived UI, not core domain

Sidebar summary can stay temporarily if useful.
But it must no longer shape the domain model.

---

## Scope And Non-Goals

This contract intentionally does **not** attempt to solve all future product directions.

### In scope

- session-centric product model
- run/session relationship
- app/principal/share definitions
- authority boundaries
- archive/share semantics for v1
- what belongs to domain truth vs derived UI

### Out of scope for this note

- full account system design
- billing or monetization
- collaborative editing semantics
- advanced org/team RBAC
- detailed storage migration plan
- exact route/file refactor mapping

### Explicit non-goals for now

- turning RemoteLab into a full multi-user chat product
- making share links behave like mini-apps with their own write flows
- delegating permissions to the model
- preserving sidebar summary as an architectural pillar

---

## Canonical Objects

## 1. Session

**Session is the primary canonical product object.**

A session is one durable conversation thread with the AI worker.

Humans return to sessions to understand the work.
So session owns the durable truth that humans care about.

### Session owns

- canonical conversation/event history
- session presentation metadata
- archive lifecycle state
- app dimension via `appId`
- initiating principal via `createdByPrincipalId`
- links to active or recent run state where needed
- user-visible contextual facts that must survive restarts/reloads

### Session does not own

- reusable app definition
- public share publication records
- raw transient execution mechanics
- sidecar spool implementation details

### Core rule

All user-visible durable facts should converge back into session-owned truth.

If a run produces something that the product should preserve, it should end up as one of:

- a session event
- session metadata
- an artifact referenced from session-visible events

This avoids creating two competing histories:

- session history for users
- run history for the system

That split becomes painful fast.

### Session lifecycle

A session:

- can exist with no active run
- can outlive many runs
- can be revisited indefinitely
- can be archived
- can spawn zero or more share snapshots

### Recommended minimum fields

- `id`
- `appId`
- `createdByPrincipalId`
- `name`
- `group`
- `description`
- `createdAt`
- `updatedAt`
- `archived` or `archivedAt`
- `activeRunId`
- `latestSeq`
- history/context pointers as needed

---

## 2. Run

**Run is a real operational child object of a session.**

A run represents one execution attempt for a session turn or maintenance action.

Typical cases:

- a user sends a message and the AI replies
- a previously interrupted turn is resumed
- a compaction operation runs
- a tool-dropping or maintenance action requires model work

### Run owns

- request identity / dedupe identity
- in-flight execution state
- cancel/resume/finalize lifecycle
- tool/model/reasoning config for that execution
- raw spool / partial execution details
- usage data for that execution
- run-scoped artifacts and final outcome

### Run does not own

- the long-term canonical user narrative of the session
- reusable app policy
- authorization scope

### Correct stance

Run is **not** “just cache”.

But run is also not allowed to become a second product-history universe.

The right split is:

- session owns durable conversational truth
- run owns operational execution truth

### Why run must remain explicit

Without a real run object, the project loses a clean place for:

- restart recovery
- cancellation semantics
- duplicate submit protection
- per-turn usage accounting
- sidecar/raw spool coordination
- isolated finalization logic

### Recommended minimum fields

- `id`
- `sessionId`
- `requestId`
- `state`
- `tool`
- `model`
- `effort`
- `startedAt`
- `finalizedAt`
- `result`
- `usage`

---

## 3. App

**App is a reusable scope/policy/presentation object above sessions.**

App is not the conversation itself.
App shapes how sessions created under it should behave or appear.

### App answers questions like

- what entry surface is this?
- what bootstrap/system framing applies?
- what welcome framing should be shown?
- what tool defaults apply?
- what visibility or sharing mode applies?

### App owns

- reusable bootstrap/policy fields
- welcome/default presentation fields
- app-level access/sharing defaults
- future app-level configuration that applies to many sessions

### App does not own

- live session history
- run spools/results
- per-session archive state

### Product expression rule

In the backend/domain layer, app remains a real object.

In the frontend/product layer, app can often be expressed as:

- current app entry
- current app filter
- current app selection

That is a valid simplification as long as the reusable app record still exists behind `appId`.

### Default app rule

The default owner console should be treated as a built-in app.

This avoids one of the most common sources of drift:

- “normal chat” as an app-less special case

That special case always leaks back into routing, auth, and UI.

### Recommended minimum fields

- `id`
- `slug` or stable name
- `title`
- `systemPrompt`
- `welcomeMessage`
- `defaultTool`
- `visibility`
- `createdAt`
- `updatedAt`

---

## 4. Principal

**Principal is the access subject.**

This document deliberately uses `Principal` instead of `User` for the core contract.

Reason:

- `user` sounds like a full mature account system
- current RemoteLab needs a reliable access subject before it needs a heavy account product

### Principal answers one question

Who is acting through this app/session surface?

### Current recommended shape

For now, keep it simple:

- one owner principal with global authority
- optional app-scoped non-owner principals
- optional shared demo/trial principal for a shared app if desired

### Why principal is better than visitor

Using `visitor` as the main abstraction caused the model to leak into unrelated areas.

Using `principal` gives us a cleaner statement:

- owner principal
- app-scoped principal
- public share reader

### Why principal is better than overcommitting to user accounts

It leaves room for growth without forcing premature product weight.

We can later choose to make principal look more like a true user/account system.
But we do not need that complexity to stabilize the core architecture now.

### Recommended minimum fields

- `id`
- `kind`
- `appScope` if applicable
- `createdAt`

---

## 5. ShareSnapshot

**ShareSnapshot is a standalone read-only publication object.**

A share is not another app.
A share is not another principal-facing live session surface.
A share is a public read-only publication over a frozen range of one session.

### ShareSnapshot owns

- stable share id
- source session reference
- frozen event boundary
- public-read lifecycle
- revocation state

### ShareSnapshot does not own

- live mutable session history
- app write permissions
- in-flight execution state

### Frozen boundary rule

The safest base contract is:

- `sessionId`
- `maxSeq`
- optional `minSeq`

That provides a stable explanation of what the share contains.

### Materialization rule

A share does not need to physically copy the full content in v1.

But it must still have its own explicit record.

Otherwise the system loses a clean home for:

- revocation
- expiry
- auditability
- future retention guarantees

### Recommended minimum fields

- `id`
- `sessionId`
- `maxSeq`
- optional `minSeq`
- `createdByPrincipalId`
- `createdAt`
- `revokedAt`

---

## Domain Relationships

```text
App 1 --- N Session
Principal 1 --- N Session
Session 1 --- N Run
Session 1 --- N ShareSnapshot
```

Interpretation:

- every session belongs to exactly one app
- every session has exactly one initiating principal
- a session can accumulate many runs over time
- a session can produce zero or more share snapshots

---

## Product Shape

This section describes how the model above should feel in the product.

## 1. Owner experience

The owner sees RemoteLab as one main control console.

But underneath that console:

- the default owner surface is still a built-in app
- owner can access all apps
- owner can see all sessions
- owner can filter by app and by principal when useful

This keeps the product simple for the owner while preserving a clean domain model.

## 2. App-scoped non-owner experience

A non-owner entering via a shared app should feel like they are entering that app, not a global control console.

Recommended v1 product behavior:

- they only see the current app scope
- they only see sessions they are allowed to see under that app
- by default, they only see sessions created by the same principal
- they do not manage global app settings
- they do not browse other apps/users from the main UI

This is intentionally narrower than a real collaboration product.

## 3. Shared demo/trial path

If desired, one shared app can temporarily use a shared demo principal.

This is acceptable as a product shortcut.

But it should still be understood as:

- one principal with shared visibility scope

not as proof that authorization no longer matters.

## 4. Public share experience

A public share should feel like a standalone read-only page.

It does not need login.
It does not need app context.
It does not need write affordances.

Its job is simple:

- show a frozen snapshot of a session range

That is all.

---

## Filtering And Navigation Model

Your recent product instinct here is good, and it should be preserved.

### UI filtering

Owner/admin surfaces may expose:

- app filter
- principal filter
- maybe future grouped views

Non-owner surfaces should usually not expose global filters.
They should simply render the allowed scope.

### Query params

Query params such as `?appId=` are acceptable for:

- preselecting an app
- opening an app surface
- filtering or navigation state

They are **not** acceptable as the source of truth for authority.

The server-owned truth remains:

- `session.appId`
- principal scope
- app visibility/access policy

### Product simplification rule

It is okay if the frontend makes app feel transparent.
It is not okay if the backend stops knowing what app actually owns a session.

---

## Authorization Model

This is the most important defensive section in the whole note.

## Server owns authorization

The server must always decide:

- which principal can enter which app
- which principal can read which sessions
- which principal can create/manage apps
- whether a share is readable
- whether archive blocks external access

## Model does not own authorization

The model may control behavior inside granted scope:

- tone
- workflow
- instruction following
- app-specific assistance style

The model must not decide the granted scope itself.

In short:

- model controls behavior inside scope
- server controls scope boundaries

If this line gets blurred, the architecture becomes hard to secure and impossible to reason about consistently.

---

## Session And Run Lifecycle

This section formalizes the sentence you are converging on:

- session is the main source humans care about
- run is the execution layer that feeds back into session

### Typical flow

1. A principal enters an app surface.
2. A session is created or reopened under that app.
3. A user action creates a run.
4. The run owns in-flight execution, raw spool, request identity, and finalization.
5. Important durable outputs are normalized into session history/metadata.
6. The run ends.
7. The session remains the canonical thing users revisit later.

### Lifecycle rule

The system may keep rich run state while the run is active.
But after completion, any fact the product wants to preserve should be explainable from session truth plus optional referenced artifacts.

### Practical implication

This gives us both:

- strong runtime structure
- simple user-facing architecture

That is better than either extreme:

- shoving everything into session with no execution boundary
- or letting run become a second shadow history

---

## Archive Semantics

Archive is a session lifecycle state.

### Archive should mean

- hide or retire this session from normal active browsing
- communicate that this session is no longer part of active working state

### Archive should not permanently mean in the long run

- universal substitute for share revocation
- app deletion
- principal deletion

### V1 pragmatic allowance

For safety, it is acceptable in v1 if archiving a session also blocks public share access derived from it.

That is reasonable as a short-term conservative rule.

But the long-term model should still leave room for explicit share revocation as its own concept.

Otherwise archive becomes semantically overloaded.

---

## Share Semantics

Share should stay deliberately small.

### Share v1 behavior

- create a share snapshot from a session
- expose it at a separate public page
- make it read-only
- allow it to stop working if revoked or if the underlying safety rule blocks it

### Share should not become in v1

- another app
- another live chat entry surface
- a partially authenticated collaboration mode
- a substitute for app-level access control

### Why this matters

The simpler share stays, the easier it is to reason about security, product behavior, and future migration.

---

## Sidebar, Grouping, And Derived Product Surfaces

The following should be treated as derived, replaceable, and non-canonical:

- sidebar summary
- progress rollups
- unread markers
- grouping/sorting views
- app/principal filter state
- badges and convenience views

This is important because it means we can improve or remove these surfaces without redefining core objects.

### Specific current stance

- sidebar summary is no longer a domain anchor
- grouping is useful product organization
- grouping does not automatically replace all progress/summary use cases
- but the core contract should not depend on either one

---

## Explicitly Rejected Simplifications

These are the tempting simplifications that we should now reject to avoid future pain.

### 1. “Run is just cache”

Rejected.

Reason:

- it erases the operational boundary needed for recovery, cancellation, dedupe, usage, and sidecar orchestration

### 2. “App is just a query param or bare string field”

Rejected.

Reason:

- it destroys reusable policy/presentation ownership and recreates special cases elsewhere

### 3. “Everything is just a user now” without a domain access subject

Rejected.

Reason:

- it sounds simpler but usually reintroduces hidden authorization flags in less explicit places

### 4. “Permissions are mainly controlled by the model”

Rejected.

Reason:

- unsafe and architecturally incoherent

### 5. “Share can just be treated as an app page”

Rejected.

Reason:

- share is a publication artifact, not a live entry surface

### 6. “Sidebar/progress is core domain truth”

Rejected.

Reason:

- derived UI must not define the product ontology

---

## Working V1 Decisions To Freeze Now

Unless we explicitly revisit them, these should now be treated as the baseline.

### Baseline product decisions

- session remains the main product object
- run remains a real backend object
- default owner console is a built-in app
- product wording moves away from `visitor`
- principal remains the access subject in the domain
- share remains standalone and read-only
- sidebar/progress remains derived

### Baseline access decisions

- owner can see all apps
- owner can see all sessions
- owner can filter by app and principal
- non-owner is scoped to the current app
- non-owner by default only sees sessions created by the same principal
- public shares require no login but are read-only

### Baseline authority decisions

- server enforces access
- query params do not define authority
- model behavior is not an authorization boundary

### Baseline archive/share decision

- archiving may block share access in v1 for safety
- explicit share revocation should remain representable as a separate concept

---

## Implementation Consequences

This note is about product/domain shape, not code mapping.
But it still implies concrete implementation direction.

### The backend should move toward

- session-centric canonical read models
- run-centric operational lifecycle handling
- app/principal-aware authorization checks
- share snapshot records with frozen boundaries
- fewer role-specific branches named around `visitor`

### The frontend should move toward

- sessions as the main browsing unit
- app as current surface/filter rather than a competing object model
- owner-only global filters for app/principal when useful
- simpler non-owner views that naturally reflect server scope
- treating progress/sidebar as optional helpers, not core truth

### Storage should move toward

- session truth for preserved user-visible history
- run truth for operational execution records
- explicit share snapshot records
- app records that survive beyond a single query param choice

---

## Questions Deferred, Not Blocking

These are real questions, but they do not block using this contract as the current baseline.

1. Should app-scoped non-owner principals persist across visits, or can they initially be ephemeral?
2. Should the default built-in app be stored explicitly or represented by a reserved id?
3. When event bodies are compacted later, how do we guarantee old shares remain readable if they reference the old range?
4. Do we ever want non-owner same-app visibility beyond “same principal only”, or should that remain out of scope for a long time?
5. If a shared demo principal exists, what is the cleanest UX for explaining its limitations without surfacing the whole authorization model?

---

## Final Working Contract

If the whole document had to be compressed into one implementation card, it would be this:

- `Session` is the primary product truth.
- `Run` is the operational execution truth for a session turn.
- `App` is a reusable scope/policy object referenced by session.
- `Principal` is the access subject.
- `ShareSnapshot` is a standalone read-only publication object.
- durable user-visible facts converge back into session-owned truth.
- server owns authorization.
- model behavior stays inside granted scope.
- sidebar/progress/grouping/filtering are derived surfaces, not core ontology.

That is the contract the next refactor sessions should follow.
