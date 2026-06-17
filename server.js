const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "cases.json");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const POSTER_CACHE_DIR = path.join(DATA_DIR, "poster-cache");
const POSTER_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LEGACY_USER_ID = "legacy-import";
const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_HISTORY_PAGE_SIZE = 10;
const MAX_HISTORY_PAGE_SIZE = 50;

// 接口限流：按 client-id 或 IP 维度，每分钟最多 RATE_LIMIT_WINDOW 内 RATE_LIMIT_MAX 次请求
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000;
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 120;
const rateLimitBuckets = new Map();
// 自动清理过期限流桶，避免内存泄漏
setInterval(() => {
  const threshold = Date.now() - RATE_LIMIT_WINDOW_MS * 4;
  for (const [key, bucket] of rateLimitBuckets) {
    if (bucket.windowStart < threshold) rateLimitBuckets.delete(key);
  }
}, 5 * 60 * 1000).unref();

// 数据备份：每次写入触发增量备份（节流），最多保留 BACKUP_KEEP 份
const BACKUP_KEEP = Number(process.env.BACKUP_KEEP) || 14;
const BACKUP_THROTTLE_MS = Number(process.env.BACKUP_THROTTLE_MS) || 30 * 1000;
let lastBackupAt = 0;
let backupTimer = null;

loadEnvFile();
ensureDataFile();
normalizePersistedStore();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

let writeChain = Promise.resolve();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(url.pathname, res);
  } catch (error) {
    // 业务错误携带 status（400/403/404/409/429 等），默认 500
    const status = Number(error.status) >= 400 && Number(error.status) < 600 ? Number(error.status) : 500;
    safeWarn("[API] error:", error.message);
    sendJson(res, status, { error: error.message || "服务器错误" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Love Court is running: http://localhost:${PORT}`);
  console.log("局域网分享时，把 localhost 换成这台电脑的局域网 IP。");
});

// 读取请求体并解析为 JSON，空体返回 {}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

async function handleApi(req, res, url) {
  const method = req.method || "GET";
  const parts = url.pathname.split("/").filter(Boolean);
  const context = getRequestContext(req);

  // 接口限流：按 client-id 或 IP 维度
  const rateLimitKey = context.user.sourceKey || req.socket.remoteAddress || "anonymous";
  if (!checkRateLimit(rateLimitKey)) {
    sendJson(res, 429, { error: "请求过于频繁，请稍后再试" });
    return;
  }

  // 数据删除入口：DELETE /api/me/data，软删除当前用户可见的全部案件
  if (method === "DELETE" && url.pathname === "/api/me/data") {
    const result = await withStoreWrite((store) => deleteUserData(store, context.user.id));
    sendJson(res, 200, { ok: true, removed: result.removed });
    return;
  }

  if (method === "GET" && (url.pathname === "/api/cases" || url.pathname === "/api/me/cases")) {
    const { page, pageSize } = parsePagination(url);
    const history = listCasesForUser(context.user.id, { page, pageSize });
    sendJson(res, 200, { cases: history.items, page: history.page, pageSize: history.pageSize, total: history.total, totalPages: history.totalPages });
    return;
  }

  if (method === "POST" && url.pathname === "/api/cases") {
    const created = await withStoreWrite((store) => createCase(store, context.user));
    sendJson(res, 201, { case: created });
    return;
  }

  if (parts[0] === "api" && parts[1] === "cases" && parts[2]) {
    const caseId = parts[2];

    if (method === "GET" && parts.length === 3) {
      sendJson(res, 200, { case: getCaseView(caseId, context.user.id) });
      return;
    }

    if (method === "POST" && parts[3] === "join") {
      const body = await readBody(req);
      const joined = await withStoreWrite((store) => joinCase(store, caseId, context.user, body));
      sendJson(res, 200, { case: joined });
      return;
    }

    if (method === "POST" && parts[3] === "archive") {
      const archived = await withStoreWrite((store) => archiveCase(store, caseId, context.user.id));
      sendJson(res, 200, { case: archived });
      return;
    }

    if (method === "POST" && parts[3] === "restore") {
      const restored = await withStoreWrite((store) => restoreCase(store, caseId, context.user.id));
      sendJson(res, 200, { case: restored });
      return;
    }

    if (method === "POST" && parts[3] === "delete") {
      const deleted = await withStoreWrite((store) => softDeleteCase(store, caseId, context.user.id));
      sendJson(res, 200, { case: deleted });
      return;
    }

    if (method === "POST" && parts[3] === "purge") {
      await withStoreWrite((store) => purgeCase(store, caseId, context.user.id));
      sendJson(res, 200, { ok: true });
      return;
    }

    if ((method === "PATCH" && parts[3] === "statements") || (method === "PATCH" && parts.length === 3)) {
      const body = await readBody(req);
      const updated = await withStoreWrite((store) => updateStatements(store, caseId, context.user, body));
      sendJson(res, 200, { case: updated });
      return;
    }

    if (method === "POST" && parts[3] === "question") {
      const updated = await withStoreWrite((store) => updateQuestion(store, caseId, context.user.id));
      sendJson(res, 200, { case: updated });
      return;
    }

    if (method === "POST" && parts[3] === "verdict") {
      const updated = await withStoreWrite((store) => generateVerdict(store, caseId, context.user));
      sendJson(res, 200, { case: updated });
      return;
    }

    if (method === "GET" && parts[3] === "share-image") {
      const item = getCaseView(caseId, context.user.id);
      if (!item.verdict) {
        sendJson(res, 400, { error: "请先生成裁决，再生成判决书图片。" });
        return;
      }
      const png = await buildShareImagePng(item);
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Disposition": `inline; filename="love-court-${item.caseNumber}.png"`,
        "Cache-Control": "public, max-age=86400, immutable",
      });
      res.end(png);
      return;
    }
  }

  sendJson(res, 404, { error: "接口不存在" });
}

function serveStatic(pathname, res) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(ROOT, cleanPath));
  if (!filePath.startsWith(ROOT)) {
    sendText(res, 403, "Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendText(res, 404, "Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(createEmptyStore(), null, 2), "utf8");
  }
}

function normalizePersistedStore() {
  const raw = readRawStore();
  const normalized = normalizeStore(raw);
  if (needsMigration(raw, normalized)) {
    writeRawStore(normalized);
  }
}

function readRawStore() {
  ensureDataFile();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return createEmptyStore();
  }
}

function writeRawStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
}

function withStoreWrite(mutator) {
  writeChain = writeChain.then(async () => {
    const store = normalizeStore(readRawStore());
    const result = await mutator(store);
    writeRawStore(store);
    // 写入成功后触发节流备份
    scheduleBackup();
    return result;
  });
  return writeChain.catch((error) => {
    writeChain = Promise.resolve();
    throw error;
  });
}

function needsMigration(raw, normalized) {
  if (!raw || Array.isArray(raw)) return true;
  return JSON.stringify(raw) !== JSON.stringify(normalized);
}

function createEmptyStore() {
  return {
    version: 1,
    meta: {
      nextCaseSequence: 1,
    },
    users: [],
    cases: [],
    caseParticipants: [],
    caseStatements: [],
    verdicts: [],
    caseAccessTokens: [],
  };
}

function normalizeStore(raw) {
  if (Array.isArray(raw)) {
    return migrateLegacyCases(raw);
  }

  const base = createEmptyStore();
  const store = Object.assign(base, raw && typeof raw === "object" ? raw : {});
  store.version = 1;
  store.meta = Object.assign({}, base.meta, store.meta || {});
  store.users = Array.isArray(store.users) ? store.users : [];
  store.cases = Array.isArray(store.cases) ? store.cases : [];
  store.caseParticipants = Array.isArray(store.caseParticipants) ? store.caseParticipants : [];
  store.caseStatements = Array.isArray(store.caseStatements) ? store.caseStatements : [];
  store.verdicts = Array.isArray(store.verdicts) ? store.verdicts : [];
  store.caseAccessTokens = Array.isArray(store.caseAccessTokens) ? store.caseAccessTokens : [];
  store.meta.nextCaseSequence = Math.max(Number(store.meta.nextCaseSequence) || 1, inferNextCaseSequence(store.cases));
  store.cases = store.cases.map((item) => normalizeCaseRecord(item));
  store.users = store.users.map((item) => normalizeUserRecord(item));
  store.caseParticipants = store.caseParticipants.map((item) => normalizeParticipantRecord(item));
  store.caseStatements = store.caseStatements.map((item) => normalizeStatementRecord(item));
  store.verdicts = store.verdicts.map((item) => normalizeVerdictRecord(item));
  store.caseAccessTokens = store.caseAccessTokens.map((item) => normalizeAccessTokenRecord(item));
  return store;
}

function migrateLegacyCases(cases) {
  const now = new Date().toISOString();
  const normalizedCases = cases.map((item, index) => normalizeCaseRecord({
    id: item.id || randomId(),
    caseNumber: item.caseNumber || buildCaseNumber(index + 1),
    inviteCode: item.inviteCode || randomToken(6).toUpperCase(),
    title: item.title || "",
    plaintiffName: item.plaintiffName || "",
    defendantName: item.defendantName || "",
    plaintiffStatement: item.plaintiffStatement || "",
    defendantStatement: item.defendantStatement || "",
    plaintiffAnswer: item.plaintiffAnswer || "",
    defendantAnswer: item.defendantAnswer || "",
    question: item.question || "",
    verdict: item.verdict || null,
    createdAt: item.createdAt || now,
    updatedAt: item.updatedAt || item.createdAt || now,
    createdByUserId: LEGACY_USER_ID,
    latestStatementVersion: Number(item.latestStatementVersion) || 0,
    latestVerdictId: item.latestVerdictId || null,
  }));

  const accessTokens = normalizedCases.map((item) => normalizeAccessTokenRecord({
    id: randomId(),
    caseId: item.id,
    token: item.inviteCode,
    purpose: "invite",
    createdByUserId: LEGACY_USER_ID,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    usedAt: null,
    revokedAt: null,
  }));

  return {
    version: 1,
    meta: {
      nextCaseSequence: inferNextCaseSequence(normalizedCases),
    },
    users: [],
    cases: normalizedCases,
    caseParticipants: [],
    caseStatements: [],
    verdicts: normalizedCases
      .filter((item) => item.verdict)
      .map((item) => normalizeVerdictRecord({
        id: randomId(),
        caseId: item.id,
        createdByUserId: LEGACY_USER_ID,
        provider: item.verdict.provider || "legacy",
        model: item.verdict.model || null,
        payload: item.verdict,
        createdAt: item.updatedAt,
        updatedAt: item.updatedAt,
      })),
    caseAccessTokens: accessTokens,
  };
}

function normalizeCaseRecord(item) {
  const now = new Date().toISOString();
  return {
    id: String(item.id || randomId()),
    caseNumber: String(item.caseNumber || buildCaseNumber(1)),
    inviteCode: String(item.inviteCode || randomToken(6).toUpperCase()),
    title: String(item.title || ""),
    plaintiffName: String(item.plaintiffName || ""),
    defendantName: String(item.defendantName || ""),
    plaintiffStatement: String(item.plaintiffStatement || ""),
    defendantStatement: String(item.defendantStatement || ""),
    plaintiffAnswer: String(item.plaintiffAnswer || ""),
    defendantAnswer: String(item.defendantAnswer || ""),
    question: String(item.question || ""),
    verdict: item.verdict || null,
    createdAt: String(item.createdAt || now),
    updatedAt: String(item.updatedAt || item.createdAt || now),
    createdByUserId: String(item.createdByUserId || LEGACY_USER_ID),
    latestStatementVersion: Number(item.latestStatementVersion) || 0,
    latestVerdictId: item.latestVerdictId || null,
    archivedAt: item.archivedAt ? String(item.archivedAt) : null,
    archivedByUserId: item.archivedByUserId ? String(item.archivedByUserId) : null,
    deletedAt: item.deletedAt ? String(item.deletedAt) : null,
    deletedByUserId: item.deletedByUserId ? String(item.deletedByUserId) : null,
  };
}

function normalizeUserRecord(item) {
  const now = new Date().toISOString();
  return {
    id: String(item.id || randomId()),
    displayName: String(item.displayName || "匿名用户"),
    source: String(item.source || "client-id"),
    sourceKey: String(item.sourceKey || item.id || randomId()),
    createdAt: String(item.createdAt || now),
    updatedAt: String(item.updatedAt || now),
  };
}

function normalizeParticipantRecord(item) {
  const now = new Date().toISOString();
  return {
    id: String(item.id || randomId()),
    caseId: String(item.caseId),
    userId: String(item.userId),
    role: item.role === "defendant" ? "defendant" : "plaintiff",
    joinedAt: String(item.joinedAt || now),
    lastSeenAt: String(item.lastSeenAt || item.joinedAt || now),
  };
}

function normalizeStatementRecord(item) {
  const now = new Date().toISOString();
  return {
    id: String(item.id || randomId()),
    caseId: String(item.caseId),
    userId: String(item.userId),
    role: item.role === "defendant" ? "defendant" : "plaintiff",
    title: String(item.title || ""),
    plaintiffName: String(item.plaintiffName || ""),
    defendantName: String(item.defendantName || ""),
    plaintiffStatement: String(item.plaintiffStatement || ""),
    defendantStatement: String(item.defendantStatement || ""),
    plaintiffAnswer: String(item.plaintiffAnswer || ""),
    defendantAnswer: String(item.defendantAnswer || ""),
    createdAt: String(item.createdAt || now),
    updatedAt: String(item.updatedAt || now),
    version: Number(item.version) || 1,
  };
}

function normalizeVerdictRecord(item) {
  const now = new Date().toISOString();
  return {
    id: String(item.id || randomId()),
    caseId: String(item.caseId),
    createdByUserId: String(item.createdByUserId || LEGACY_USER_ID),
    provider: String(item.provider || "local-rules"),
    model: item.model === undefined || item.model === null ? null : String(item.model),
    payload: item.payload || null,
    createdAt: String(item.createdAt || now),
    updatedAt: String(item.updatedAt || now),
  };
}

function normalizeAccessTokenRecord(item) {
  const now = new Date().toISOString();
  return {
    id: String(item.id || randomId()),
    caseId: String(item.caseId),
    token: String(item.token || randomToken(6).toUpperCase()),
    purpose: item.purpose === "invite" ? "invite" : "invite",
    createdByUserId: String(item.createdByUserId || LEGACY_USER_ID),
    createdAt: String(item.createdAt || now),
    updatedAt: String(item.updatedAt || now),
    expiresAt: item.expiresAt ? String(item.expiresAt) : null,
    usedAt: item.usedAt || null,
    revokedAt: item.revokedAt || null,
  };
}

function inferNextCaseSequence(cases) {
  let max = 0;
  for (const item of cases) {
    const match = String(item.caseNumber || "").match(/-(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]) || 0);
  }
  return max + 1;
}

function getRequestContext(req) {
  const headers = req.headers || {};
  const auth = String(headers.authorization || headers.Authorization || "");
  const clientId = String(headers["x-love-court-client-id"] || "").trim();
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const source = token ? "business-token" : clientId ? "client-id" : "anonymous";
  const sourceKey = token || clientId || req.socket.remoteAddress || "anonymous";
  const user = upsertUser(source, sourceKey);
  return { user };
}

function upsertUser(source, sourceKey) {
  const store = normalizeStore(readRawStore());
  const existing = store.users.find((item) => item.source === source && item.sourceKey === sourceKey);
  if (existing) return existing;
  const now = new Date().toISOString();
  const user = normalizeUserRecord({
    id: randomId(),
    displayName: buildDisplayName(sourceKey),
    source,
    sourceKey,
    createdAt: now,
    updatedAt: now,
  });
  store.users.unshift(user);
  writeRawStore(store);
  return user;
}

function buildDisplayName(sourceKey) {
  const tail = String(sourceKey || "anon").slice(-4);
  return `用户${tail}`;
}

function parsePagination(url) {
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const rawPageSize = Number(url.searchParams.get("pageSize")) || DEFAULT_HISTORY_PAGE_SIZE;
  const pageSize = Math.min(MAX_HISTORY_PAGE_SIZE, Math.max(1, rawPageSize));
  return { page, pageSize };
}

function listCasesForUser(userId, options = {}) {
  const store = normalizeStore(readRawStore());
  const visible = store.cases
    .filter((item) => isVisibleToUser(store, item, userId))
    .filter((item) => !item.deletedAt)
    .sort(sortCaseDesc);
  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.min(MAX_HISTORY_PAGE_SIZE, Math.max(1, Number(options.pageSize) || DEFAULT_HISTORY_PAGE_SIZE));
  const total = visible.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  return {
    items: visible.slice(start, start + pageSize),
    page: currentPage,
    pageSize,
    total,
    totalPages,
  };
}

function isVisibleToUser(store, caseRecord, userId) {
  if (caseRecord.deletedAt) return false;
  if (caseRecord.createdByUserId === LEGACY_USER_ID) return true;
  const participants = store.caseParticipants.filter((item) => item.caseId === caseRecord.id);
  if (!participants.length) return true;
  return participants.some((item) => item.userId === userId);
}

function sortCaseDesc(a, b) {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

function isParticipant(store, caseId, userId) {
  return store.caseParticipants.some((entry) => entry.caseId === caseId && entry.userId === userId);
}

function requireParticipant(store, caseId, userId) {
  if (!isParticipant(store, caseId, userId)) {
    const error = new Error("无权访问该案件");
    error.status = 403;
    throw error;
  }
}

function requireCaseOwnerOrParticipant(store, caseId, userId) {
  const { item } = requireCase(store, caseId);
  if (item.createdByUserId !== userId && !isParticipant(store, caseId, userId)) {
    const error = new Error("无权访问该案件");
    error.status = 403;
    throw error;
  }
  return item;
}

function getCaseView(caseId, userId) {
  const store = normalizeStore(readRawStore());
  const item = store.cases.find((entry) => entry.id === caseId);
  if (!item) {
    const error = new Error("案件不存在或已被清空");
    error.status = 404;
    throw error;
  }
  if (!isVisibleToUser(store, item, userId)) {
    const error = new Error("无权访问该案件");
    error.status = 403;
    throw error;
  }
  return decorateCase(store, item);
}

function shouldAllowInvite(store, item, inviteCode) {
  if (!inviteCode) return null;
  const token = store.caseAccessTokens.find((entry) => entry.caseId === item.id && entry.token === inviteCode && entry.purpose === "invite");
  if (!token || token.revokedAt || token.usedAt) return null;
  const expiresAt = token.expiresAt ? new Date(token.expiresAt).getTime() : new Date(token.createdAt).getTime() + INVITE_TOKEN_TTL_MS;
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;
  return token;
}

function findCaseIndex(store, caseId) {
  return store.cases.findIndex((entry) => entry.id === caseId);
}

function requireCase(store, caseId) {
  const index = findCaseIndex(store, caseId);
  if (index < 0) {
    const error = new Error("案件不存在或已被清空");
    error.status = 404;
    throw error;
  }
  return { index, item: store.cases[index] };
}

function createCase(store, user) {
  const now = new Date().toISOString();
  const caseId = randomId();
  const caseNumber = buildCaseNumber(store.meta.nextCaseSequence || 1);
  const inviteCode = randomToken(6).toUpperCase();
  const item = normalizeCaseRecord({
    id: caseId,
    caseNumber,
    inviteCode,
    title: "",
    plaintiffName: "",
    defendantName: "",
    plaintiffStatement: "",
    defendantStatement: "",
    plaintiffAnswer: "",
    defendantAnswer: "",
    question: "",
    verdict: null,
    createdAt: now,
    updatedAt: now,
    createdByUserId: user.id,
    latestStatementVersion: 0,
    latestVerdictId: null,
  });
  store.meta.nextCaseSequence = (store.meta.nextCaseSequence || 1) + 1;
  store.cases.unshift(item);
  store.caseParticipants.unshift(normalizeParticipantRecord({
    id: randomId(),
    caseId,
    userId: user.id,
    role: "plaintiff",
    joinedAt: now,
    lastSeenAt: now,
  }));
  store.caseAccessTokens.unshift(normalizeAccessTokenRecord({
    id: randomId(),
    caseId,
    token: inviteCode,
    purpose: "invite",
    createdByUserId: user.id,
    createdAt: now,
    updatedAt: now,
    usedAt: null,
    revokedAt: null,
  }));
  return decorateCase(store, item);
}

function joinCase(store, caseId, user, body) {
  const { item } = requireCase(store, caseId);
  const existingParticipant = store.caseParticipants.find((entry) => entry.caseId === caseId && entry.userId === user.id);
  const requestedRole = body && body.role === "defendant" ? "defendant" : "plaintiff";
  const inviteCode = String(body && body.inviteCode ? body.inviteCode : "").trim();

  if (!existingParticipant) {
    const inviteToken = shouldAllowInvite(store, item, inviteCode);
    if (!inviteToken) {
      const error = new Error("邀请码无效、已失效或已过期");
      error.status = 403;
      throw error;
    }
  }

  const now = new Date().toISOString();
  const occupant = store.caseParticipants.find((entry) => entry.caseId === caseId && entry.role === requestedRole && entry.userId !== user.id);
  if (occupant) {
    const error = new Error("该身份已被占用");
    error.status = 409;
    throw error;
  }

  if (existingParticipant) {
    existingParticipant.role = requestedRole;
    existingParticipant.lastSeenAt = now;
  } else {
    store.caseParticipants.unshift(normalizeParticipantRecord({
      id: randomId(),
      caseId,
      userId: user.id,
      role: requestedRole,
      joinedAt: now,
      lastSeenAt: now,
    }));
    const token = store.caseAccessTokens.find((entry) => entry.caseId === caseId && entry.token === inviteCode && entry.purpose === "invite");
    if (token) {
      token.usedAt = now;
      token.updatedAt = now;
    }
  }
  item.updatedAt = now;
  return decorateCase(store, item);
}

function archiveCase(store, caseId, userId) {
  const item = requireCaseOwnerOrParticipant(store, caseId, userId);
  const now = new Date().toISOString();
  item.archivedAt = now;
  item.archivedByUserId = userId;
  item.updatedAt = now;
  return decorateCase(store, item);
}

function restoreCase(store, caseId, userId) {
  const item = requireCaseOwnerOrParticipant(store, caseId, userId);
  const now = new Date().toISOString();
  item.archivedAt = null;
  item.archivedByUserId = null;
  item.deletedAt = null;
  item.deletedByUserId = null;
  item.updatedAt = now;
  return decorateCase(store, item);
}

function softDeleteCase(store, caseId, userId) {
  const item = requireCaseOwnerOrParticipant(store, caseId, userId);
  const now = new Date().toISOString();
  item.deletedAt = now;
  item.deletedByUserId = userId;
  item.updatedAt = now;
  return decorateCase(store, item);
}

function purgeCase(store, caseId, userId) {
  const { index, item } = requireCase(store, caseId);
  if (item.createdByUserId !== userId) {
    const error = new Error("无权删除该案件");
    error.status = 403;
    throw error;
  }
  store.cases.splice(index, 1);
  store.caseParticipants = store.caseParticipants.filter((entry) => entry.caseId !== caseId);
  store.caseStatements = store.caseStatements.filter((entry) => entry.caseId !== caseId);
  store.verdicts = store.verdicts.filter((entry) => entry.caseId !== caseId);
  store.caseAccessTokens = store.caseAccessTokens.filter((entry) => entry.caseId !== caseId);
}

function updateStatements(store, caseId, user, body) {
  const { item } = requireCase(store, caseId);
  requireParticipant(store, caseId, user.id);
  const role = body && body.role === "defendant" ? "defendant" : body && body.role === "plaintiff" ? "plaintiff" : getParticipantRole(store, caseId, user.id) || "plaintiff";
  ensureParticipant(store, caseId, user.id, role);
  const now = new Date().toISOString();
  const patch = sanitizeCasePatch(body || {});
  const existing = store.caseStatements.find((entry) => entry.caseId === caseId && entry.userId === user.id);
  const nextStatement = normalizeStatementRecord(existing ? Object.assign({}, existing, patch, {
    role,
    updatedAt: now,
    version: existing.version + 1,
  }) : {
    id: randomId(),
    caseId,
    userId: user.id,
    role,
    title: patch.title,
    plaintiffName: patch.plaintiffName,
    defendantName: patch.defendantName,
    plaintiffStatement: patch.plaintiffStatement,
    defendantStatement: patch.defendantStatement,
    plaintiffAnswer: patch.plaintiffAnswer,
    defendantAnswer: patch.defendantAnswer,
    createdAt: now,
    updatedAt: now,
    version: 1,
  });
  if (existing) {
    Object.assign(existing, nextStatement);
  } else {
    store.caseStatements.unshift(nextStatement);
  }
  applyCasePatch(item, patch);
  item.updatedAt = now;
  item.latestStatementVersion = Math.max(Number(item.latestStatementVersion) || 0, nextStatement.version);
  return decorateCase(store, item);
}

function updateQuestion(store, caseId, userId) {
  requireParticipant(store, caseId, userId);
  const { item } = requireCase(store, caseId);
  item.question = buildQuestion(item);
  item.updatedAt = new Date().toISOString();
  return decorateCase(store, item);
}

async function generateVerdict(store, caseId, user) {
  ensureUser(store, user);
  requireParticipant(store, caseId, user.id);
  const { item } = requireCase(store, caseId);
  validateCase(item);
  const existingVerdict = item.latestVerdictId ? store.verdicts.find((entry) => entry.id === item.latestVerdictId) : null;
  if (existingVerdict) {
    item.verdict = existingVerdict.payload;
    return decorateCase(store, item);
  }

  const verdict = await buildAiVerdict(item);
  const now = new Date().toISOString();
  const record = normalizeVerdictRecord({
    id: randomId(),
    caseId,
    createdByUserId: user.id,
    provider: verdict.provider,
    model: verdict.model || null,
    payload: verdict,
    createdAt: now,
    updatedAt: now,
  });
  store.verdicts.unshift(record);
  item.verdict = verdict;
  item.latestVerdictId = record.id;
  item.updatedAt = now;
  return decorateCase(store, item);
}

function getParticipantRole(store, caseId, userId) {
  const participant = store.caseParticipants.find((entry) => entry.caseId === caseId && entry.userId === userId);
  return participant ? participant.role : null;
}

function ensureParticipant(store, caseId, userId, role) {
  const now = new Date().toISOString();
  let participant = store.caseParticipants.find((entry) => entry.caseId === caseId && entry.userId === userId);
  if (!participant) {
    participant = normalizeParticipantRecord({
      id: randomId(),
      caseId,
      userId,
      role,
      joinedAt: now,
      lastSeenAt: now,
    });
    store.caseParticipants.unshift(participant);
    return participant;
  }
  participant.role = role;
  participant.lastSeenAt = now;
  return participant;
}

function sanitizeCasePatch(body) {
  const result = {};
  const limits = {
    title: 220,
    plaintiffName: 220,
    defendantName: 220,
    plaintiffStatement: 500,
    defendantStatement: 500,
    plaintiffAnswer: 220,
    defendantAnswer: 220,
  };
  for (const key of Object.keys(limits)) {
    if (typeof body[key] === "string") {
      result[key] = body[key].trim().slice(0, limits[key]);
    }
  }
  // 写入时同样拦截敏感内容，避免绕过宣判环节直接落库
  const blocked = /自杀|自残|伤害自己|轻生|想死|报警|家暴|殴打|虐待|诈骗|赌博|毒品|大麻|枪支|投资|股票|基金|理财|借贷|高利贷|诊断|用药|处方|法律咨询|起诉离婚|代码|编程|sql|password|身份证号|银行卡号/i;
  const joined = [result.title, result.plaintiffStatement, result.defendantStatement, result.plaintiffAnswer, result.defendantAnswer].filter(Boolean).join(" ");
  if (blocked.test(joined)) {
    const error = new Error("内容包含敏感词，已被拦截。涉及危机、法律、医疗、投资或代码内容请寻求专业帮助。");
    error.status = 400;
    throw error;
  }
  return result;
}

function applyCasePatch(item, patch) {
  for (const key of Object.keys(patch)) {
    item[key] = patch[key];
  }
}

function decorateCase(store, item) {
  const latestVerdict = item.latestVerdictId ? store.verdicts.find((entry) => entry.id === item.latestVerdictId) : null;
  const verdict = latestVerdict ? latestVerdict.payload : item.verdict || null;
  if (verdict && latestVerdict) {
    if (!verdict.provider) verdict.provider = latestVerdict.provider;
    if (verdict.model === undefined) verdict.model = latestVerdict.model || null;
  }
  return Object.assign({}, item, { verdict });
}

function buildCaseNumber(sequence) {
  const currentYear = new Date().getFullYear();
  return `${currentYear}-${String(sequence).padStart(3, "0")}`;
}

function randomId() {
  return crypto.randomBytes(6).toString("hex");
}

function randomToken(length) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString("hex").slice(0, length).toUpperCase();
}

function loadEnvFile() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !process.env[key]) process.env[key] = value;
  }
}

function validateCase(item) {
  if (!item.title || !item.plaintiffName || !item.defendantName) {
    throw new Error("请先填写案件名称、原告昵称和被告昵称。");
  }
  if ((item.plaintiffStatement || "").length < 8 || (item.defendantStatement || "").length < 8) {
    throw new Error("双方陈词都需要至少 8 个字，才能宣判。");
  }
  // 敏感内容拦截：覆盖标题、双方陈词、双方补充回答
  // 涵盖危机（自杀/自残/家暴/伤害）、违法（诈骗/赌博/毒品/枪支）、医疗用药、投资理财、严肃法律咨询、代码生成等
  const blocked = /自杀|自残|伤害自己|轻生|想死|报警|家暴|殴打|虐待|诈骗|赌博|毒品|大麻|枪支|投资|股票|基金|理财|借贷|高利贷|诊断|用药|处方|法律咨询|起诉离婚|代码|编程|sql|password|身份证号|银行卡号/i;
  const allText = [
    item.title,
    item.plaintiffStatement,
    item.defendantStatement,
    item.plaintiffAnswer || "",
    item.defendantAnswer || "",
  ].join(" ");
  if (blocked.test(allText)) {
    throw new Error("本庭只受理轻量娱乐争议。涉及危机、法律、医疗、投资或代码内容，请寻求专业帮助。");
  }
}

function buildQuestion(item) {
  const text = `${item.title} ${item.plaintiffStatement} ${item.defendantStatement}`;
  if (/已读|不回|消息|微信|回复/.test(text)) {
    return "请双方分别说明：消息没有及时回复时，是否有提前说明忙碌状态？对方通常能接受多久不回复？";
  }
  if (/纪念日|生日|节日|礼物/.test(text)) {
    return "请双方分别说明：这个日子的重要性是否提前表达过？是否存在补救行为？";
  }
  if (/游戏|开黑|排位|电脑/.test(text)) {
    return "请双方分别说明：游戏安排是否影响了约定时间？有没有提前沟通优先级？";
  }
  if (/奶茶|外卖|吃|饭|零食/.test(text)) {
    return "请双方分别说明：这份食物原本归谁？有没有出现未经同意就处置的情况？";
  }
  return "请双方分别说明：这件事发生前，有没有明确表达期待或提前告知安排？";
}

function scoreResponsibility(item) {
  const plaintiffText = `${item.plaintiffStatement} ${item.plaintiffAnswer}`;
  const defendantText = `${item.defendantStatement} ${item.defendantAnswer}`;
  let defendantScore = 50;
  const defendantBad = /忘|没回|没看|打游戏|睡着|下次|错了|道歉|没注意|太忙|加班|迟到/g;
  const plaintiffBad = /翻旧账|阴阳|冷战|拉黑|生气但没说|不告诉|故意|试探/g;
  defendantScore += (defendantText.match(defendantBad) || []).length * 8;
  defendantScore -= (plaintiffText.match(plaintiffBad) || []).length * 7;
  if (/提前|说过|约好|答应/.test(plaintiffText)) defendantScore += 12;
  if (/不知道|没说|没提醒|临时/.test(defendantText)) defendantScore -= 8;
  if (/道歉|补偿|解释|哄/.test(defendantText)) defendantScore -= 10;
  if (/冷战|不理|拉黑/.test(plaintiffText)) defendantScore -= 8;
  defendantScore = Math.max(20, Math.min(85, defendantScore));
  const defendant = Math.round(defendantScore / 5) * 5;
  return { defendant, plaintiff: 100 - defendant };
}

function buildVerdict(item) {
  const ratio = scoreResponsibility(item);
  const text = `${item.title} ${item.plaintiffStatement} ${item.defendantStatement}`;
  const defendantLoses = ratio.defendant >= ratio.plaintiff;
  const loser = defendantLoses ? item.defendantName : item.plaintiffName;
  const winner = defendantLoses ? item.plaintiffName : item.defendantName;
  let penalty = `${loser}请${winner}喝奶茶一杯，并提供一次认真道歉。`;
  if (/已读|不回|消息|微信|回复/.test(text)) penalty = `${loser}需主动报备忙碌状态 24 小时，并补发一句不敷衍的想念。`;
  if (/纪念日|生日|节日|礼物/.test(text)) penalty = `${loser}补办一次小型仪式，预算不低于一杯奶茶加一朵花。`;
  if (/游戏|开黑|排位|电脑/.test(text)) penalty = `${loser}暂停排位一晚，安排一次完整陪伴局。`;
  if (/奶茶|外卖|吃|饭|零食/.test(text)) penalty = `${loser}赔偿同款食物一份，并承诺下次先问归属权。`;
  if (Math.abs(ratio.defendant - ratio.plaintiff) <= 10) penalty = "双方各退一步：一人道歉一句，一人停止翻旧账 24 小时。";
  return {
    ratio,
    focus: ["双方是否提前表达期待与边界", "是否存在失约、忽视或沟通不足", "事后是否主动解释、补救与安抚"],
    facts: `经审理，本案主要围绕“${item.title}”展开。双方均有表达情绪，但争议核心不在输赢，而在期待是否被说清、承诺是否被尊重。`,
    reason: `本庭认为，亲密关系里的小事通常不是小事本身，而是背后的重视感。${loser}在本案中需要承担更多安抚和补救义务，${winner}也应避免把本案扩大为历史总账。`,
    penalty,
    indices: buildFunIndices(item, ratio),
    settlement: "建议双方在判决后 30 分钟内完成和解动作：说清一个具体需求，给出一个具体补偿，然后本案封存，禁止无限上诉。",
    reasoning: buildLocalReasoning(item, ratio),
  };
}

function buildFunIndices(item, ratio) {
  const text = `${item.title} ${item.plaintiffStatement} ${item.defendantStatement} ${item.plaintiffAnswer} ${item.defendantAnswer}`;
  const maxResponsibility = Math.max(ratio.plaintiff, ratio.defendant);
  const hasOldScore = /翻旧账|以前|每次|总是|又|上次/.test(text);
  const hasSilent = /不回|冷战|不理|拉黑|已读/.test(text);
  const hasApology = /道歉|补偿|哄|解释|愿意/.test(text);
  return {
    hardMouth: Math.min(96, Math.max(38, maxResponsibility + (hasApology ? -8 : 12))),
    grievance: Math.min(98, Math.max(45, 55 + (hasSilent ? 22 : 8) + (hasOldScore ? 8 : 0))),
    coaxDifficulty: Math.min(95, Math.max(35, 45 + Math.abs(ratio.plaintiff - ratio.defendant) / 2 + (hasApology ? -6 : 12))),
    oldScoreRisk: Math.min(92, Math.max(25, hasOldScore ? 78 : hasSilent ? 48 : 36)),
  };
}

function buildLocalReasoning(item, ratio) {
  const text = `${item.title} ${item.plaintiffStatement} ${item.defendantStatement}`;
  const plaintiffText = `${item.plaintiffStatement} ${item.plaintiffAnswer}`;
  const defendantText = `${item.defendantStatement} ${item.defendantAnswer}`;
  const steps = [];

  const evidence = [];
  if (item.plaintiffStatement) evidence.push(`原告称"${item.plaintiffStatement.slice(0, 40)}"`);
  if (item.defendantStatement) evidence.push(`被告称"${item.defendantStatement.slice(0, 40)}"`);
  steps.push({ step: 1, label: "关键证据", text: evidence.join("；") || "双方陈述已记录。" });

  const logicParts = [];
  if (/忘|没回|没看|打游戏|睡着/.test(defendantText)) logicParts.push("被告存在忽视行为");
  if (/翻旧账|阴阳|冷战|拉黑/.test(plaintiffText)) logicParts.push("原告存在扩大化行为");
  if (/提前|说过|约好|答应/.test(plaintiffText)) logicParts.push("原告曾提前表达期待");
  if (/道歉|补偿|解释|哄/.test(defendantText)) logicParts.push("被告有补救意愿");
  if (!logicParts.length) logicParts.push("双方均有情绪表达，核心在于期待是否被说清");
  steps.push({ step: 2, label: "推理逻辑", text: logicParts.join("，") + `。责任比例：原告${ratio.plaintiff}%，被告${ratio.defendant}%。` });

  let rule = "亲密关系中，小事背后的重视感比事件本身更重要。";
  if (/已读|不回|消息|微信|回复/.test(text)) rule = "及时回复是基本尊重，忙碌时应主动报备状态。";
  else if (/纪念日|生日|节日|礼物/.test(text)) rule = "重要日子需要被记住，遗忘时应主动补救。";
  else if (/游戏|开黑|排位|电脑/.test(text)) rule = "约定时间优先于娱乐安排，变更需提前沟通。";
  else if (/奶茶|外卖|吃|饭|零食/.test(text)) rule = "食物归属权应被尊重，未经同意不应处置。";
  steps.push({ step: 3, label: "适用规则", text: rule });

  return steps;
}

async function buildAiVerdict(item) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  if (!apiKey) {
    return { ...buildVerdict(item), provider: "local-rules", model: null };
  }

  const fallback = { ...buildVerdict(item), provider: "local-rules-fallback", model: null };
  const prompt = {
    caseNumber: item.caseNumber,
    title: item.title,
    plaintiffName: item.plaintiffName,
    defendantName: item.defendantName,
    plaintiffStatement: item.plaintiffStatement,
    defendantStatement: item.defendantStatement,
    plaintiffAnswer: item.plaintiffAnswer,
    defendantAnswer: item.defendantAnswer,
    judgeQuestion: item.question,
  };

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: [
              "你是 AI情侣法庭的娱乐法官，只处理情侣、朋友、室友之间的轻量互动争议。",
              "你的目标不是严肃判案，而是在轻松、好笑、克制的语气中帮助双方表达、倾听与和解。",
              "禁止提供法律咨询、医疗建议、投资建议、危机干预、代码生成或泛闲聊。",
              "只输出合法 JSON，不要使用 Markdown，不要添加解释性前后缀。",
            ].join("\n"),
          },
          {
            role: "user",
            content: [
              "请基于以下案件生成娱乐裁决。",
              "JSON 格式必须完全符合：",
              '{"ratio":{"plaintiff":数字,"defendant":数字},"focus":["争议焦点1","争议焦点2","争议焦点3"],"facts":"事实认定，80字内","reason":"判决理由，120字内","penalty":"娱乐处罚，60字内","indices":{"hardMouth":数字,"grievance":数字,"coaxDifficulty":数字,"oldScoreRisk":数字},"settlement":"和解建议，80字内","reasoning":[{"step":1,"label":"关键证据","text":"引用双方陈词中的关键事实，50字内"},{"step":2,"label":"推理逻辑","text":"说明责任划分的推理过程，80字内"},{"step":3,"label":"适用规则","text":"说明判罚依据的情侣相处规则，60字内"}]}',
              "责任比例相加必须等于100，单方责任不要低于15或高于85。",
              "indices 四项范围必须是 0 到 100 的整数，分别代表嘴硬指数、委屈指数、哄人难度、翻旧账风险。",
              "reasoning 是 3 到 5 个推理步骤的数组，每步包含 step（序号）、label（步骤标签）、text（说明文字，80字内）。用用户易于理解的语言，避免技术术语。",
              "娱乐处罚可以是奶茶、道歉、拥抱、暂停翻旧账、陪伴等轻量动作。",
              JSON.stringify(prompt),
            ].join("\n"),
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.9,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      safeWarn("DeepSeek verdict failed:", `status=${response.status} body=${errorText.slice(0, 300)}`);
      return fallback;
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    const parsed = normalizeAiVerdict(JSON.parse(content), item);
    return { ...parsed, provider: "deepseek", model };
  } catch (error) {
    safeWarn("DeepSeek verdict fallback:", error.message);
    return fallback;
  }
}

function normalizeAiVerdict(verdict, item) {
  const plaintiff = Number(verdict?.ratio?.plaintiff);
  const defendant = Number(verdict?.ratio?.defendant);
  const validRatio = Number.isFinite(plaintiff) && Number.isFinite(defendant) && plaintiff + defendant === 100;
  const fallback = buildVerdict(item);
  return {
    ratio: validRatio ? { plaintiff, defendant } : fallback.ratio,
    focus: Array.isArray(verdict?.focus) && verdict.focus.length ? verdict.focus.slice(0, 3).map(String) : fallback.focus,
    facts: String(verdict?.facts || fallback.facts).slice(0, 180),
    reason: String(verdict?.reason || fallback.reason).slice(0, 240),
    penalty: String(verdict?.penalty || fallback.penalty).slice(0, 140),
    indices: normalizeIndices(verdict?.indices, fallback.indices),
    settlement: String(verdict?.settlement || fallback.settlement).slice(0, 180),
    reasoning: normalizeReasoning(verdict?.reasoning, fallback.reasoning),
  };
}

function normalizeIndices(indices, fallback) {
  const keys = ["hardMouth", "grievance", "coaxDifficulty", "oldScoreRisk"];
  const normalized = {};
  for (const key of keys) {
    const value = Math.round(Number(indices?.[key]));
    normalized[key] = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback[key];
  }
  return normalized;
}

function normalizeReasoning(input, fallback) {
  if (!Array.isArray(input) || !input.length) return fallback;
  return input.slice(0, 6).map((item, i) => ({
    step: Number.isFinite(Number(item?.step)) ? Number(item.step) : i + 1,
    label: String(item?.label || `步骤${i + 1}`).slice(0, 20),
    text: String(item?.text || "").slice(0, 200),
  })).filter((item) => item.text);
}

async function buildShareImagePng(item) {
  const cacheKey = buildPosterCacheKey(item);
  const cached = readPosterCache(cacheKey);
  if (cached) return cached;
  const svg = buildShareImageSvg(item);
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  writePosterCache(cacheKey, png);
  return png;
}

function buildPosterCacheKey(item) {
  const verdictId = item.latestVerdictId || item.verdict?.provider || "verdict";
  const updatedAt = item.verdict?.updatedAt || item.updatedAt || item.createdAt || "";
  const seed = `${item.id}:${verdictId}:${updatedAt}`;
  return crypto.createHash("sha1").update(seed).digest("hex").slice(0, 24);
}

function readPosterCache(cacheKey) {
  try {
    const filePath = path.join(POSTER_CACHE_DIR, `${cacheKey}.png`);
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (Date.now() - stat.mtimeMs > POSTER_CACHE_TTL_MS) return null;
    return fs.readFileSync(filePath);
  } catch (error) {
    safeWarn("poster cache read failed:", error.message);
    return null;
  }
}

function writePosterCache(cacheKey, buffer) {
  try {
    if (!fs.existsSync(POSTER_CACHE_DIR)) fs.mkdirSync(POSTER_CACHE_DIR, { recursive: true });
    const filePath = path.join(POSTER_CACHE_DIR, `${cacheKey}.png`);
    fs.writeFileSync(filePath, buffer);
  } catch (error) {
    safeWarn("poster cache write failed:", error.message);
  }
}

function buildShareImageSvg(item) {
  const width = 750;
  const height = 1550;
  const verdict = item.verdict;
  const ratioText = `${item.plaintiffName} ${verdict.ratio.plaintiff}% / ${item.defendantName} ${verdict.ratio.defendant}%`;
  const indices = verdict.indices || {};
  const reasonLines = wrapText(verdict.reason || "", 27, 4);
  const penaltyLines = wrapText(verdict.penalty || "", 24, 3);
  const settlementLines = wrapText(verdict.settlement || "", 24, 3);
  const titleLines = wrapText(item.title || "未命名案件", 10, 2);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fff8ea"/>
      <stop offset="58%" stop-color="#fbf7ee"/>
      <stop offset="100%" stop-color="#eef4ff"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="16" stdDeviation="18" flood-color="#1c2028" flood-opacity="0.14"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="#f1ece1"/>
  <rect x="42" y="34" width="666" height="1482" rx="18" fill="url(#bg)" stroke="#b42318" stroke-width="4" filter="url(#shadow)"/>
  <text x="78" y="94" font-family="Microsoft YaHei, PingFang SC, Arial" font-size="30" font-weight="900" fill="#b42318">爱情法庭</text>
  <text x="78" y="136" font-family="Microsoft YaHei, PingFang SC, Arial" font-size="28" font-weight="900" fill="#b42318">${escapeSvg(item.caseNumber)}号案件</text>
  <text x="78" y="176" font-family="Arial" font-size="18" font-weight="900" fill="#255a9b">LOVE COURT VERDICT</text>
  ${svgTextLines(titleLines, 78, 250, 48, 48, "#111827", 900)}

  ${svgInfoBox(78, 332, 594, 96, "原告", item.plaintiffName)}
  <circle cx="375" cy="468" r="36" fill="#b42318"/>
  <text x="375" y="480" text-anchor="middle" font-family="Arial" font-size="22" font-weight="900" fill="#ffffff">VS</text>
  ${svgInfoBox(78, 508, 594, 96, "被告", item.defendantName)}

  <rect x="78" y="642" width="594" height="116" rx="12" fill="#fffdf8" stroke="#efb7b3"/>
  <text x="104" y="688" font-family="Microsoft YaHei, PingFang SC, Arial" font-size="22" font-weight="800" fill="#667085">责任比例</text>
  <text x="104" y="734" font-family="Microsoft YaHei, PingFang SC, Arial" font-size="34" font-weight="900" fill="#b42318">${escapeSvg(ratioText)}</text>

  ${svgIndexBox(78, 790, "嘴硬指数", indices.hardMouth, 280)}
  ${svgIndexBox(392, 790, "委屈指数", indices.grievance, 280)}
  ${svgIndexBox(78, 930, "哄人难度", indices.coaxDifficulty, 280)}
  ${svgIndexBox(392, 930, "翻旧账风险", indices.oldScoreRisk, 280)}

  <rect x="78" y="1080" width="594" height="142" rx="12" fill="#eef8f2" stroke="#b7dfc6"/>
  <text x="104" y="1124" font-family="Microsoft YaHei, PingFang SC, Arial" font-size="22" font-weight="800" fill="#12613e">判决结果</text>
  ${svgTextLines(penaltyLines, 104, 1164, 24, 34, "#006b47", 900)}

  ${svgTextLines(reasonLines, 78, 1270, 22, 34, "#374151", 500)}
  ${svgTextLines(settlementLines, 78, 1290 + reasonLines.length * 34, 20, 30, "#667085", 500)}
  <text x="375" y="1490" text-anchor="middle" font-family="Microsoft YaHei, PingFang SC, Arial" font-size="14" fill="#9ca3af">${item.verdict?.provider === "deepseek" ? "本裁决由 AI 模型生成" : "本裁决根据本地规则生成"}</text>
</svg>`;
}

function svgInfoBox(x, y, width, height, label, value) {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="12" fill="#ffffff" stroke="#d7dce5"/>
  <text x="${x + 26}" y="${y + 38}" font-family="Microsoft YaHei, PingFang SC, Arial" font-size="21" font-weight="800" fill="#667085">${escapeSvg(label)}</text>
  <text x="${x + 26}" y="${y + 74}" font-family="Microsoft YaHei, PingFang SC, Arial" font-size="28" font-weight="900" fill="#111827">${escapeSvg(value || "-")}</text>`;
}

function svgIndexBox(x, y, label, value, width = 170) {
  const safeValue = Number.isFinite(Number(value)) ? Math.round(Number(value)) : "--";
  const center = x + width / 2;
  return `<rect x="${x}" y="${y}" width="${width}" height="110" rx="12" fill="#ffffff" stroke="#d7dce5"/>
  <text x="${center}" y="${y + 38}" text-anchor="middle" font-family="Microsoft YaHei, PingFang SC, Arial" font-size="20" font-weight="800" fill="#667085">${escapeSvg(label)}</text>
  <text x="${center}" y="${y + 84}" text-anchor="middle" font-family="Arial" font-size="42" font-weight="900" fill="#255a9b">${escapeSvg(safeValue)}</text>`;
}

function svgTextLines(lines, x, y, fontSize, lineHeight, color, weight) {
  return lines
    .map((line, index) => `<text x="${x}" y="${y + index * lineHeight}" font-family="Microsoft YaHei, PingFang SC, Arial" font-size="${fontSize}" font-weight="${weight}" fill="${color}">${escapeSvg(line)}</text>`)
    .join("\n");
}

function wrapText(value, maxChars, maxLines) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return ["-"];
  const lines = [];
  let current = "";
  for (const char of text) {
    current += char;
    if (current.length >= maxChars) {
      lines.push(current);
      current = "";
      if (lines.length === maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && text.length > lines.join("").length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, Math.max(0, maxChars - 1))}…`;
  }
  return lines;
}

function escapeSvg(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
    return map[char];
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

// ============================================================
// 安全加固与合规：日志脱敏、限流、备份、数据删除
// ============================================================

// 日志脱敏：屏蔽 token、client-id、Authorization、手机号、邮箱、身份证号、银行卡号
const DESENSITIZE_PATTERNS = [
  { re: /(Authorization\s*[:=]\s*)([^\s,;]+)/gi, replacement: "$1***" },
  { re: /(Bearer\s+)([A-Za-z0-9._\-]+)/gi, replacement: "$1***" },
  { re: /(X-Love-Court-Client-Id\s*[:=]\s*)([^\s,;]+)/gi, replacement: "$1***" },
  { re: /(token\s*[:=]\s*)([A-Za-z0-9._\-]{6,})/gi, replacement: "$1***" },
  { re: /(1[3-9]\d)\d{4}(\d{4})/g, replacement: "$1****$2" }, // 手机号
  { re: /([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/g, replacement: "***@***" }, // 邮箱
  { re: /([1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx])/g, replacement: "********" }, // 身份证号
  { re: /(\d{16,19})/g, replacement: "********" }, // 银行卡号
];

function desensitizeLog(value) {
  if (typeof value !== "string") {
    try {
      value = JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  let result = value;
  for (const { re, replacement } of DESENSITIZE_PATTERNS) {
    result = result.replace(re, replacement);
  }
  return result;
}

// 安全日志：所有 console.warn/error 输出前先脱敏
function safeWarn(label, payload) {
  console.warn(label, desensitizeLog(payload));
}

// 接口限流：滑动窗口计数，超过 RATE_LIMIT_MAX 返回 false
function checkRateLimit(key) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitBuckets.set(key, { windowStart: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT_MAX;
}

// 数据备份：节流触发，最多保留 BACKUP_KEEP 份
function scheduleBackup() {
  const now = Date.now();
  if (now - lastBackupAt < BACKUP_THROTTLE_MS) {
    if (!backupTimer) {
      backupTimer = setTimeout(() => {
        backupTimer = null;
        try {
          writeBackupNow();
        } catch (error) {
          safeWarn("[Backup] scheduled failed:", error.message);
        }
      }, BACKUP_THROTTLE_MS);
    }
    return;
  }
  try {
    writeBackupNow();
  } catch (error) {
    safeWarn("[Backup] failed:", error.message);
  }
}

function writeBackupNow() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(BACKUP_DIR, `cases-${stamp}.json`);
  // 复制当前数据文件，避免内存态与磁盘态不一致
  if (!fs.existsSync(DATA_FILE)) return;
  fs.copyFileSync(DATA_FILE, target);
  lastBackupAt = Date.now();
  pruneOldBackups();
}

function pruneOldBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return;
  const entries = fs.readdirSync(BACKUP_DIR)
    .filter((name) => /^cases-.+\.json$/.test(name))
    .map((name) => ({ name, mtime: fs.statSync(path.join(BACKUP_DIR, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const entry of entries.slice(BACKUP_KEEP)) {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, entry.name));
    } catch (error) {
      safeWarn("[Backup] prune failed:", error.message);
    }
  }
}

// 从指定备份文件恢复数据，返回恢复前的快照路径
function restoreFromBackup(backupFileName) {
  if (!backupFileName || !/^cases-.+\.json$/.test(backupFileName)) {
    throw new Error("备份文件名非法");
  }
  const backupPath = path.join(BACKUP_DIR, backupFileName);
  if (!fs.existsSync(backupPath)) {
    throw new Error(`备份文件不存在：${backupFileName}`);
  }
  // 恢复前先把当前数据另存为 pre-restore 快照
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const preRestoreStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const preRestorePath = path.join(BACKUP_DIR, `cases-pre-restore-${preRestoreStamp}.json`);
  if (fs.existsSync(DATA_FILE)) {
    fs.copyFileSync(DATA_FILE, preRestorePath);
  }
  fs.copyFileSync(backupPath, DATA_FILE);
  normalizePersistedStore();
  return { restoredFrom: backupFileName, preRestoreSnapshot: path.basename(preRestorePath) };
}

// 列出可用备份
function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter((name) => /^cases-.+\.json$/.test(name))
    .map((name) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, name));
      return { name, size: stat.size, mtime: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

// 数据删除入口：软删除当前用户可见的全部案件，返回删除条数
function deleteUserData(store, userId) {
  let removed = 0;
  const now = new Date().toISOString();
  for (const item of store.cases) {
    if (!isVisibleToUser(store, item, userId)) continue;
    if (item.deletedAt) continue;
    item.deletedAt = now;
    item.deletedByUserId = userId;
    item.updatedAt = now;
    removed += 1;
  }
  return { removed };
}
