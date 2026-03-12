"use strict";

(function attachRemoteLabSessionStateModel(root) {
  const PENDING_MESSAGE_GRACE_MS = 15000;

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

  function normalizePendingDeliveryState(value) {
    if (value === "accepted" || value === "failed") return value;
    return "sending";
  }

  function normalizePendingMessage(message) {
    if (!message || typeof message !== "object") return null;
    const text = typeof message.text === "string" ? message.text : "";
    const requestId = typeof message.requestId === "string" ? message.requestId : "";
    const timestamp = Number.isFinite(message.timestamp)
      ? message.timestamp
      : Date.now();
    return {
      text,
      requestId,
      timestamp,
      deliveryState: normalizePendingDeliveryState(message.deliveryState),
    };
  }

  function isSessionBusy(session) {
    return session?.status === "running" || session?.pendingCompact === true;
  }

  function shouldKeepPendingMessagePending(message, session) {
    const pending = normalizePendingMessage(message);
    if (!pending) return false;
    if (pending.deliveryState === "failed") return false;
    if (isSessionBusy(session)) return true;
    return Date.now() - pending.timestamp < PENDING_MESSAGE_GRACE_MS;
  }

  function getSessionPrimaryStatus(session, options = {}) {
    if (!session) {
      return createEmptyStatus();
    }

    const read = typeof options.isRead === "function"
      ? options.isRead(session)
      : false;
    const hasPendingDelivery = options.hasPendingDelivery === true;
    const queuedCount = Number.isInteger(session.queuedMessageCount)
      ? session.queuedMessageCount
      : 0;
    const isRunning =
      hasPendingDelivery
      || session.status === "running"
      || session.pendingCompact === true
      || queuedCount > 0;

    if (isRunning) {
      return {
        key: "running",
        label: "running",
        className: "status-running",
        dotClass: "running",
        itemClass: "",
        title: "",
      };
    }

    if (session.status === "done" && !read) {
      return {
        key: "unread",
        label: "unread",
        className: "status-done-unread",
        dotClass: "done-unread",
        itemClass: "is-complete-unread",
        title: "",
      };
    }

    if (session.renameState === "pending") {
      return {
        key: "renaming",
        label: "renaming",
        className: "status-renaming",
        dotClass: "renaming",
        itemClass: "",
        title: "",
      };
    }

    return {
      key: "idle",
      label: "idle",
      className: "",
      dotClass: "",
      itemClass: read ? "is-complete-read" : "",
      title: "",
    };
  }

  function getSessionStatusSummary(session, options = {}) {
    const primary = getSessionPrimaryStatus(session, options);

    return {
      primary,
      indicators: [primary],
    };
  }

  function getSessionVisualStatus(session, options = {}) {
    return getSessionStatusSummary(session, options).primary;
  }

  root.RemoteLabSessionStateModel = {
    createEmptyStatus,
    normalizePendingDeliveryState,
    normalizePendingMessage,
    isSessionBusy,
    shouldKeepPendingMessagePending,
    getSessionPrimaryStatus,
    getSessionStatusSummary,
    getSessionVisualStatus,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
