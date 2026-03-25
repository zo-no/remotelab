import { createHash, createHmac, randomBytes } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { basename, extname, join } from 'path';
import { rename } from 'fs/promises';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import {
  CHAT_FILE_ASSETS_DIR,
  CHAT_FILE_ASSET_CACHE_DIR,
  FILE_ASSET_PUBLIC_BASE_URL,
  FILE_ASSET_STORAGE_ACCESS_KEY_ID,
  FILE_ASSET_STORAGE_BASE_URL,
  FILE_ASSET_STORAGE_ENABLED,
  FILE_ASSET_STORAGE_KEY_PREFIX,
  FILE_ASSET_STORAGE_PRESIGN_TTL_SECONDS,
  FILE_ASSET_STORAGE_REGION,
  FILE_ASSET_STORAGE_SECRET_ACCESS_KEY,
} from '../lib/config.mjs';
import {
  createSerialTaskQueue,
  ensureDir,
  pathExists,
  readJson,
  removePath,
  statOrNull,
  writeJsonAtomic,
} from './fs-utils.mjs';

const FILE_ASSET_ID_PATTERN = /^fasset_[a-f0-9]{24}$/;
const runFileAssetMutation = createSerialTaskQueue();

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeMimeType(value) {
  return normalizeString(value).toLowerCase() || 'application/octet-stream';
}

function normalizePositiveInteger(value) {
  const numeric = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function createError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function sanitizeFilename(value, fallback = 'attachment') {
  const candidate = basename(normalizeString(value) || fallback)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return candidate.slice(0, 120) || fallback;
}

function sanitizeDisplayName(value, fallback = 'attachment') {
  const candidate = basename(normalizeString(value).replace(/\\/g, '/')) || fallback;
  return candidate.replace(/\s+/g, ' ').slice(0, 255) || fallback;
}

function sanitizeScopeSegment(value, fallback = 'session') {
  const candidate = normalizeString(value)
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return candidate.slice(0, 80) || fallback;
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hmacDigest(key, value) {
  return createHmac('sha256', key).update(value).digest();
}

function buildSigningKey(shortDate) {
  const kDate = hmacDigest(`AWS4${FILE_ASSET_STORAGE_SECRET_ACCESS_KEY}`, shortDate);
  const kRegion = hmacDigest(kDate, FILE_ASSET_STORAGE_REGION);
  const kService = hmacDigest(kRegion, 's3');
  return hmacDigest(kService, 'aws4_request');
}

function formatAmzDate(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function canonicalUri(url) {
  const segments = url.pathname.split('/').map((segment) => encodeRfc3986(safeDecodeURIComponent(segment)));
  return segments.join('/') || '/';
}

function canonicalQuery(entries) {
  return [...entries]
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)])
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey === rightKey) return leftValue.localeCompare(rightValue);
      return leftKey.localeCompare(rightKey);
    })
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function requireFileAssetStorageEnabled() {
  if (FILE_ASSET_STORAGE_ENABLED) return;
  throw createError('File asset storage is not configured', 'FILE_ASSET_STORAGE_DISABLED', 503);
}

function isValidFileAssetId(id) {
  return typeof id === 'string' && FILE_ASSET_ID_PATTERN.test(id);
}

function generateFileAssetId() {
  return `fasset_${randomBytes(12).toString('hex')}`;
}

function fileAssetPath(id) {
  return join(CHAT_FILE_ASSETS_DIR, `${id}.json`);
}

function buildObjectKey(sessionId, assetId, originalName) {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const sessionSegment = sanitizeScopeSegment(sessionId, 'session');
  const filename = sanitizeFilename(originalName, 'attachment');
  const prefix = FILE_ASSET_STORAGE_KEY_PREFIX ? `${FILE_ASSET_STORAGE_KEY_PREFIX}/` : '';
  return `${prefix}${sessionSegment}/${year}/${month}/${day}/${assetId}-${filename}`;
}

function buildStorageObjectUrl(baseUrl, objectKey) {
  const url = new URL(baseUrl);
  const normalizedBasePath = url.pathname.replace(/\/+$/, '');
  const encodedKey = objectKey.split('/').filter(Boolean).map((segment) => encodeRfc3986(segment)).join('/');
  url.pathname = `${normalizedBasePath}/${encodedKey}`;
  url.hash = '';
  url.search = '';
  return url.toString();
}

function presignStorageRequest(method, objectUrl, expiresInSeconds = FILE_ASSET_STORAGE_PRESIGN_TTL_SECONDS) {
  requireFileAssetStorageEnabled();

  const url = new URL(objectUrl);
  const issuedAt = new Date();
  const amzDate = formatAmzDate(issuedAt);
  const shortDate = amzDate.slice(0, 8);
  const credentialScope = `${shortDate}/${FILE_ASSET_STORAGE_REGION}/s3/aws4_request`;
  const query = new URLSearchParams(url.search);
  query.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
  query.set('X-Amz-Credential', `${FILE_ASSET_STORAGE_ACCESS_KEY_ID}/${credentialScope}`);
  query.set('X-Amz-Date', amzDate);
  query.set('X-Amz-Expires', String(expiresInSeconds));
  query.set('X-Amz-SignedHeaders', 'host');

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri(url),
    canonicalQuery(query.entries()),
    `host:${url.host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signature = createHmac('sha256', buildSigningKey(shortDate))
    .update(stringToSign)
    .digest('hex');

  query.set('X-Amz-Signature', signature);
  url.search = canonicalQuery(query.entries());

  return {
    url: url.toString(),
    expiresAt: new Date(issuedAt.getTime() + expiresInSeconds * 1000).toISOString(),
  };
}

function normalizeFileAssetRecord(record) {
  if (!(record && typeof record === 'object')) return null;
  const id = normalizeString(record.id);
  if (!isValidFileAssetId(id)) return null;
  const sessionId = normalizeString(record.sessionId);
  return {
    id,
    sessionId,
    status: normalizeString(record.status) || 'pending_upload',
    createdAt: normalizeString(record.createdAt) || nowIso(),
    updatedAt: normalizeString(record.updatedAt) || nowIso(),
    createdBy: normalizeString(record.createdBy) || 'owner',
    originalName: sanitizeDisplayName(record.originalName || 'attachment'),
    mimeType: normalizeMimeType(record.mimeType),
    sizeBytes: normalizePositiveInteger(record.sizeBytes),
    etag: normalizeString(record.etag),
    storage: {
      provider: 's3-compatible',
      objectKey: normalizeString(record?.storage?.objectKey),
    },
    localizedPath: normalizeString(record.localizedPath),
    localizedAt: normalizeString(record.localizedAt),
    uploadCompletedAt: normalizeString(record.uploadCompletedAt),
  };
}

async function mutateFileAsset(id, mutator) {
  if (!isValidFileAssetId(id)) return null;
  return runFileAssetMutation(async () => {
    const current = await getFileAsset(id);
    if (!current) return null;
    const draft = JSON.parse(JSON.stringify(current));
    const changed = await mutator(draft);
    if (changed === false) return current;
    draft.updatedAt = nowIso();
    await ensureDir(CHAT_FILE_ASSETS_DIR);
    await writeJsonAtomic(fileAssetPath(id), draft);
    return normalizeFileAssetRecord(draft);
  });
}

async function reuseLocalizedPath(record) {
  const localizedPath = normalizeString(record?.localizedPath);
  if (!localizedPath) return '';
  if (!await pathExists(localizedPath)) return '';
  return localizedPath;
}

function buildCachedFilename(record) {
  const originalExtension = extname(record?.originalName || '').toLowerCase();
  if (/^\.[a-z0-9]+$/.test(originalExtension)) {
    return `${record.id}${originalExtension}`;
  }
  return `${record.id}.bin`;
}

async function ensureReadyFileAssetRecord(recordOrId) {
  const record = typeof recordOrId === 'string'
    ? await getFileAsset(recordOrId)
    : normalizeFileAssetRecord(recordOrId);
  if (!record) {
    throw createError('File asset not found', 'FILE_ASSET_NOT_FOUND', 404);
  }
  if (record.status !== 'ready') {
    throw createError('File asset is not ready', 'FILE_ASSET_NOT_READY', 409);
  }
  return record;
}

function buildDownloadRoute(assetId) {
  return `/api/assets/${assetId}/download`;
}

async function buildClientFileAsset(record, { includeDirectUrl = false } = {}) {
  const payload = {
    id: record.id,
    sessionId: record.sessionId,
    status: record.status,
    originalName: record.originalName,
    mimeType: record.mimeType,
    ...(record.sizeBytes ? { sizeBytes: record.sizeBytes } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    downloadUrl: buildDownloadRoute(record.id),
  };
  if (includeDirectUrl && record.status === 'ready') {
    const direct = await buildFileAssetDirectUrl(record);
    payload.directUrl = direct.url;
    if (direct.expiresAt) payload.directUrlExpiresAt = direct.expiresAt;
  }
  return payload;
}

export function getFileAssetBootstrapConfig() {
  return {
    enabled: FILE_ASSET_STORAGE_ENABLED,
    directUpload: FILE_ASSET_STORAGE_ENABLED,
    provider: FILE_ASSET_STORAGE_ENABLED ? 's3-compatible' : '',
  };
}

export async function getFileAsset(assetId) {
  if (!isValidFileAssetId(assetId)) return null;
  return normalizeFileAssetRecord(await readJson(fileAssetPath(assetId), null));
}

export async function getFileAssetForClient(assetId, options = {}) {
  const record = await getFileAsset(assetId);
  if (!record) return null;
  return buildClientFileAsset(record, options);
}

export async function createFileAssetUploadIntent({
  sessionId,
  originalName,
  mimeType,
  sizeBytes,
  createdBy = 'owner',
} = {}) {
  requireFileAssetStorageEnabled();
  const normalizedSessionId = normalizeString(sessionId);
  if (!normalizedSessionId) {
    throw createError('sessionId is required', 'FILE_ASSET_SESSION_REQUIRED', 400);
  }

  const assetId = generateFileAssetId();
  const createdAt = nowIso();
  const record = normalizeFileAssetRecord({
    id: assetId,
    sessionId: normalizedSessionId,
    status: 'pending_upload',
    createdAt,
    updatedAt: createdAt,
    createdBy,
    originalName: sanitizeDisplayName(originalName, 'attachment'),
    mimeType: normalizeMimeType(mimeType),
    sizeBytes: normalizePositiveInteger(sizeBytes),
    storage: {
      objectKey: buildObjectKey(normalizedSessionId, assetId, originalName),
    },
  });

  await ensureDir(CHAT_FILE_ASSETS_DIR);
  await writeJsonAtomic(fileAssetPath(assetId), record);

  const upload = presignStorageRequest('PUT', buildStorageObjectUrl(FILE_ASSET_STORAGE_BASE_URL, record.storage.objectKey));
  return {
    asset: await buildClientFileAsset(record),
    upload: {
      method: 'PUT',
      url: upload.url,
      headers: {
        'Content-Type': record.mimeType,
      },
      expiresAt: upload.expiresAt,
    },
  };
}

export async function finalizeFileAssetUpload(assetId, { sizeBytes, etag } = {}) {
  const record = await mutateFileAsset(assetId, (draft) => {
    draft.status = 'ready';
    draft.uploadCompletedAt = nowIso();
    const normalizedSize = normalizePositiveInteger(sizeBytes);
    if (normalizedSize) draft.sizeBytes = normalizedSize;
    const normalizedEtag = normalizeString(etag).replace(/^W\//, '').replace(/^"|"$/g, '');
    if (normalizedEtag) draft.etag = normalizedEtag;
    return true;
  });

  if (!record) {
    throw createError('File asset not found', 'FILE_ASSET_NOT_FOUND', 404);
  }
  return buildClientFileAsset(record, { includeDirectUrl: true });
}

export async function buildFileAssetDirectUrl(recordOrId, { expiresInSeconds = FILE_ASSET_STORAGE_PRESIGN_TTL_SECONDS } = {}) {
  const record = await ensureReadyFileAssetRecord(recordOrId);
  if (FILE_ASSET_PUBLIC_BASE_URL) {
    return {
      url: buildStorageObjectUrl(FILE_ASSET_PUBLIC_BASE_URL, record.storage.objectKey),
      expiresAt: null,
    };
  }
  return presignStorageRequest('GET', buildStorageObjectUrl(FILE_ASSET_STORAGE_BASE_URL, record.storage.objectKey), expiresInSeconds);
}

export async function localizeFileAsset(recordOrId) {
  const record = await ensureReadyFileAssetRecord(recordOrId);
  const existingPath = await reuseLocalizedPath(record);
  if (existingPath) return existingPath;

  const direct = await buildFileAssetDirectUrl(record, {
    expiresInSeconds: Math.max(FILE_ASSET_STORAGE_PRESIGN_TTL_SECONDS, 60 * 60),
  });
  const response = await fetch(direct.url, { method: 'GET', redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw createError(`Failed to download file asset: ${record.id}`, 'FILE_ASSET_DOWNLOAD_FAILED', 502);
  }

  await ensureDir(CHAT_FILE_ASSET_CACHE_DIR);
  const targetPath = join(CHAT_FILE_ASSET_CACHE_DIR, buildCachedFilename(record));
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;

  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(tempPath));
    await rename(tempPath, targetPath);
  } catch (error) {
    await removePath(tempPath).catch(() => {});
    throw createError(error.message || 'Failed to localize file asset', 'FILE_ASSET_LOCALIZE_FAILED', 502);
  }

  const fileStats = await statOrNull(targetPath);
  const updated = await mutateFileAsset(record.id, (draft) => {
    draft.localizedPath = targetPath;
    draft.localizedAt = nowIso();
    if (fileStats?.isFile() && Number.isInteger(fileStats.size) && fileStats.size > 0) {
      draft.sizeBytes = fileStats.size;
    }
    return true;
  });

  return normalizeString(updated?.localizedPath) || targetPath;
}

export async function materializeFileAssetAttachments(attachments) {
  const materialized = await Promise.all((attachments || []).map(async (attachment) => {
    if (!(attachment && typeof attachment === 'object')) return null;
    const savedPath = normalizeString(attachment.savedPath);
    if (savedPath && await pathExists(savedPath)) {
      return attachment;
    }

    const assetId = normalizeString(attachment.assetId);
    if (!assetId) {
      return attachment;
    }

    const record = await ensureReadyFileAssetRecord(assetId);
    const localizedPath = await localizeFileAsset(record);
    return {
      ...attachment,
      assetId: record.id,
      filename: normalizeString(attachment.filename) || basename(localizedPath),
      savedPath: localizedPath,
      originalName: normalizeString(attachment.originalName) || record.originalName,
      mimeType: normalizeString(attachment.mimeType) || record.mimeType,
    };
  }));

  return materialized.filter(Boolean);
}

export async function publishLocalFileAssetFromPath({
  sessionId,
  localPath,
  originalName,
  mimeType,
  createdBy = 'owner',
} = {}) {
  requireFileAssetStorageEnabled();
  const filePath = normalizeString(localPath);
  const fileStats = await statOrNull(filePath);
  if (!filePath || !fileStats?.isFile()) {
    throw createError('localPath must point to a file', 'FILE_ASSET_LOCAL_PATH_INVALID', 400);
  }

  const intent = await createFileAssetUploadIntent({
    sessionId,
    originalName: originalName || basename(filePath),
    mimeType,
    sizeBytes: fileStats.size,
    createdBy,
  });

  const response = await fetch(intent.upload.url, {
    method: 'PUT',
    headers: intent.upload.headers,
    body: createReadStream(filePath),
    duplex: 'half',
  });
  if (!response.ok) {
    throw createError(`Failed to upload local file asset: ${response.status}`, 'FILE_ASSET_UPLOAD_FAILED', 502);
  }

  return finalizeFileAssetUpload(intent.asset.id, {
    sizeBytes: fileStats.size,
    etag: response.headers.get('etag') || '',
  });
}
