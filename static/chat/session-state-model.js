"use strict";

(function attachRemoteLabSessionStateModel(root) {
  function createEmptyStatus() {
    return {
      key: "idle",
      label: "",
      className: "",
      dotClass: "",
      itemClass: "",
      title: "",
    };
  }

  function createStatus(key, label, className = "", dotClass = "", itemClass = "", title = "") {
    return {
      key,
      label,
      className,
      dotClass,
      itemClass,
      title,
    };
  }

  function normalizeSessionActivity(session) {
    const raw = session?.activity || {};
    const fallbackRunState = session?.status === "interrupted"
      ? "interrupted"
      : session?.status === "running"
        ? "running"
        : "idle";
    const rawRunState = raw?.run?.state;
    const runState =
      rawRunState === "running" || rawRunState === "interrupted"
        ? rawRunState
        : fallbackRunState;
    const queueCount = Number.isInteger(raw?.queue?.count)
      ? raw.queue.count
      : Number.isInteger(session?.queuedMessageCount)
        ? session.queuedMessageCount
        : 0;
    const queueState = raw?.queue?.state === "queued" || queueCount > 0
      ? "queued"
      : "idle";
    const renameState = raw?.rename?.state === "pending" || raw?.rename?.state === "failed"
      ? raw.rename.state
      : session?.renameState === "pending" || session?.renameState === "failed"
        ? session.renameState
        : "idle";
    const compactState = raw?.compact?.state === "pending" || session?.pendingCompact === true
      ? "pending"
      : "idle";

    return {
      run: {
        state: runState,
        phase: typeof raw?.run?.phase === "string" ? raw.run.phase : null,
        runId: typeof raw?.run?.runId === "string" ? raw.run.runId : null,
        cancelRequested: raw?.run?.cancelRequested === true,
        recoverable: raw?.run?.recoverable === true || session?.recoverable === true,
      },
      queue: {
        state: queueState,
        count: queueCount,
      },
      rename: {
        state: renameState,
        error: typeof raw?.rename?.error === "string" ? raw.rename.error : "",
      },
      compact: {
        state: compactState,
      },
    };
  }

  function isSessionBusy(session) {
    const activity = normalizeSessionActivity(session);
    return activity.run.state === "running"
      || activity.queue.state === "queued"
      || activity.compact.state === "pending";
  }

  function getSessionPrimaryStatus(session) {
    if (!session) {
      return createEmptyStatus();
    }

    const indicators = getSessionStatusSummary(session).indicators;
    return indicators[0] || createStatus("idle", "idle");
  }

  function getSessionStatusSummary(session) {
    const activity = normalizeSessionActivity(session);
    const indicators = [];

    if (activity.run.state === "running") {
      indicators.push(createStatus("running", "running", "status-running", "running"));
    }

    if (activity.queue.state === "queued") {
      indicators.push(createStatus(
        "queued",
        "queued",
        "status-queued",
        "queued",
        "",
        activity.queue.count > 0
          ? `${activity.queue.count} follow-up${activity.queue.count === 1 ? "" : "s"} queued`
          : "",
      ));
    }

    if (activity.compact.state === "pending") {
      indicators.push(createStatus("compacting", "compacting", "status-compacting", "compacting"));
    }

    if (activity.rename.state === "pending") {
      indicators.push(createStatus("renaming", "renaming", "status-renaming", "renaming"));
    }

    if (activity.run.state === "interrupted") {
      indicators.push(createStatus(
        "interrupted",
        "interrupted",
        "status-interrupted",
        "interrupted",
        "",
        activity.run.recoverable ? "Recoverable interrupted session" : "Interrupted session",
      ));
    }

    if (activity.rename.state === "failed") {
      indicators.push(createStatus(
        "rename-failed",
        "rename failed",
        "status-rename-failed",
        "rename-failed",
        "",
        activity.rename.error || "Session rename failed",
      ));
    }

    const primary = indicators[0] || createStatus("idle", "idle");

    return {
      primary,
      indicators,
    };
  }

  function getSessionVisualStatus(session) {
    return getSessionStatusSummary(session).primary;
  }

  root.RemoteLabSessionStateModel = {
    createEmptyStatus,
    normalizeSessionActivity,
    isSessionBusy,
    getSessionPrimaryStatus,
    getSessionStatusSummary,
    getSessionVisualStatus,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
