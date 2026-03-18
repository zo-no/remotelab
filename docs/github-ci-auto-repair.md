# GitHub CI Auto Repair

`scripts/github-ci-auto-repair.mjs` watches the latest GitHub Actions runs for selected branches and starts a RemoteLab repair session when the newest matching branch CI run is red.

## Why this shape

For this machine, a **local poller** is the simplest reliable default:

- no extra public webhook surface needs to be exposed from GitHub into the laptop
- it reuses the existing local `gh` auth and RemoteLab owner auth
- it can enrich the repair prompt with local repo paths, workflow context, failed jobs, and log excerpts before the model starts working

The monitor is intentionally conservative:

- it looks only at the **latest** matching run per branch/workflow group
- it skips runs that are still in progress
- it waits through a configurable settle window so quick reruns do not create session noise
- it dedupes handled GitHub run ids in a local state file
- it tells the repair session to checkpoint only after local validation, and to stop with diagnosis instead of pushing guesses for flaky or infra-only failures

## Typical usage

For the RemoteLab repo itself:

```bash
npm run github:ci:repair -- \
  --repo Ninglo/remotelab \
  --branch main \
  --workflow CI \
  --session-folder ~/code/remotelab
```

To watch both `main` and `master`:

```bash
node scripts/github-ci-auto-repair.mjs \
  --repo Ninglo/remotelab \
  --branch main \
  --branch master \
  --workflow CI \
  --session-folder ~/code/remotelab
```

Useful options:

- `--dry-run` prints candidates without starting sessions
- `--settle-minutes 10` waits longer before reacting
- `--events push,workflow_dispatch` widens the event filter when needed
- `--model <id>` / `--effort <level>` / `--thinking` tune the spawned repair session
- `--state-file <path>` and `--snapshot-dir <path>` relocate persistent monitor data

## Recommended operation pattern

For continuous monitoring, schedule the script every few minutes with `launchd`, `cron`, or another local scheduler instead of keeping an always-open webhook path.

Recommended policy:

1. Watch only the default branch CI first.
2. Start a repair session only for the latest failed run.
3. Let the session reproduce locally and validate before checkpointing.
4. If the run smells flaky, infra-only, or provider-related, stop with diagnosis instead of auto-pushing.
5. Add notifications later if you want “repair started / repair fixed / repair blocked” status pushed to phone.

## Future extensions

Natural next steps if this works well:

- push a short owner notification when a repair session starts or finishes
- group repeated failures into a single long-lived incident session per branch/workflow
- auto-comment on the related GitHub issue/PR when the session concludes
- promote from polling to GitHub webhook delivery only if near-real-time response becomes worth the extra surface area
