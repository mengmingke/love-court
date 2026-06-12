const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "cases.json");

loadEnvFile();

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

ensureDataFile();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(url.pathname, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "服务器错误" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Love Court is running: http://localhost:${PORT}`);
  console.log(`局域网分享时，把 localhost 换成这台电脑的局域网 IP。`);
});

async function handleApi(req, res, url) {
  const method = req.method;
  const parts = url.pathname.split("/").filter(Boolean);

  if (method === "GET" && url.pathname === "/api/cases") {
    const cases = readCases().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    sendJson(res, 200, { cases });
    return;
  }

  if (method === "POST" && url.pathname === "/api/cases") {
    const cases = readCases();
    const currentYear = new Date().getFullYear();
    const caseNumber = `${currentYear}-${String(cases.length + 1).padStart(3, "0")}`;
    const item = {
      id: crypto.randomBytes(6).toString("hex"),
      caseNumber,
      inviteCode: crypto.randomBytes(3).toString("hex").toUpperCase(),
      title: "",
      plaintiffName: "",
      defendantName: "",
      plaintiffStatement: "",
      defendantStatement: "",
      plaintiffAnswer: "",
      defendantAnswer: "",
      question: "",
      verdict: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    cases.push(item);
    writeCases(cases);
    sendJson(res, 201, { case: item });
    return;
  }

  if (method === "DELETE" && url.pathname === "/api/cases") {
    writeCases([]);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (parts[0] === "api" && parts[1] === "cases" && parts[2]) {
    const caseId = parts[2];
    if (method === "GET" && parts.length === 3) {
      sendJson(res, 200, { case: findCaseOrThrow(caseId) });
      return;
    }

    if (method === "PATCH" && parts.length === 3) {
      const patch = await readBody(req);
      const updated = updateCase(caseId, (item) => {
        const allowed = [
          "title",
          "plaintiffName",
          "defendantName",
          "plaintiffStatement",
          "defendantStatement",
          "plaintiffAnswer",
          "defendantAnswer",
        ];
        allowed.forEach((key) => {
          if (typeof patch[key] === "string") item[key] = patch[key].slice(0, key.includes("Statement") ? 500 : 220);
        });
        item.updatedAt = new Date().toISOString();
      });
      sendJson(res, 200, { case: updated });
      return;
    }

    if (method === "POST" && parts[3] === "question") {
      const updated = updateCase(caseId, (item) => {
        item.question = buildQuestion(item);
        item.updatedAt = new Date().toISOString();
      });
      sendJson(res, 200, { case: updated });
      return;
    }

    if (method === "POST" && parts[3] === "verdict") {
      const cases = readCases();
      const index = cases.findIndex((entry) => entry.id === caseId);
      if (index < 0) throw new Error("案件不存在或已被清空");
      validateCase(cases[index]);
      cases[index].verdict = await buildAiVerdict(cases[index]);
      cases[index].updatedAt = new Date().toISOString();
      writeCases(cases);
      const updated = cases[index];
      sendJson(res, 200, { case: updated });
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
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf8");
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

function readCases() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function writeCases(cases) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(cases, null, 2), "utf8");
}

function findCaseOrThrow(caseId) {
  const item = readCases().find((entry) => entry.id === caseId);
  if (!item) {
    const error = new Error("案件不存在或已被清空");
    error.status = 404;
    throw error;
  }
  return item;
}

function updateCase(caseId, updater) {
  const cases = readCases();
  const index = cases.findIndex((entry) => entry.id === caseId);
  if (index < 0) throw new Error("案件不存在或已被清空");
  updater(cases[index]);
  writeCases(cases);
  return cases[index];
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 20_000) {
        reject(new Error("请求内容过长"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("JSON 格式错误"));
      }
    });
    req.on("error", reject);
  });
}

function validateCase(item) {
  if (!item.title || !item.plaintiffName || !item.defendantName) {
    throw new Error("请先填写案件名称、原告昵称和被告昵称。");
  }
  if ((item.plaintiffStatement || "").length < 8 || (item.defendantStatement || "").length < 8) {
    throw new Error("双方陈词都需要至少 8 个字，才能宣判。");
  }
  const blocked = /自杀|伤害自己|报警|家暴|殴打|诈骗|投资|股票|基金|借贷|诊断|用药|法律咨询|起诉离婚|代码|编程/i;
  const allText = `${item.title} ${item.plaintiffStatement} ${item.defendantStatement}`;
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

async function buildAiVerdict(item) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return { ...buildVerdict(item), provider: "local-rules" };
  }

  const fallback = { ...buildVerdict(item), provider: "local-rules-fallback" };
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
        model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
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
              '{"ratio":{"plaintiff":数字,"defendant":数字},"focus":["争议焦点1","争议焦点2","争议焦点3"],"facts":"事实认定，80字内","reason":"判决理由，120字内","penalty":"娱乐处罚，60字内","indices":{"hardMouth":数字,"grievance":数字,"coaxDifficulty":数字,"oldScoreRisk":数字},"settlement":"和解建议，80字内"}',
              "责任比例相加必须等于100，单方责任不要低于15或高于85。",
              "indices 四项范围必须是 0 到 100 的整数，分别代表嘴硬指数、委屈指数、哄人难度、翻旧账风险。",
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
      console.warn("DeepSeek verdict failed:", response.status, errorText.slice(0, 300));
      return fallback;
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    const parsed = normalizeAiVerdict(JSON.parse(content), item);
    return { ...parsed, provider: "deepseek" };
  } catch (error) {
    console.warn("DeepSeek verdict fallback:", error.message);
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

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}
