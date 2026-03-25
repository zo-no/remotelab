function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function getAttachmentDisplayName(attachment) {
  return normalizeString(attachment?.originalName) || normalizeString(attachment?.filename);
}

export function getAttachmentSavedPath(attachment) {
  return normalizeString(attachment?.savedPath);
}

export function formatAttachmentContextReference(attachment) {
  const displayName = getAttachmentDisplayName(attachment);
  const savedPath = getAttachmentSavedPath(attachment);
  if (displayName && savedPath && displayName !== savedPath) {
    return `${displayName} -> ${savedPath}`;
  }
  return savedPath || displayName;
}

export function formatAttachmentContextLine(images, label = 'Attached files') {
  const refs = (images || []).map((image) => formatAttachmentContextReference(image)).filter(Boolean);
  if (refs.length === 0) return '';
  return `[${label}: ${refs.join(', ')}]`;
}

export function stripAttachmentSavedPath(attachment) {
  if (!(attachment && typeof attachment === 'object')) return attachment;
  const { savedPath, ...rest } = attachment;
  return rest;
}

export function stripEventAttachmentSavedPaths(event) {
  if (!(event && typeof event === 'object') || !Array.isArray(event.images)) return event;
  return {
    ...event,
    images: event.images.map((image) => stripAttachmentSavedPath(image)),
  };
}
