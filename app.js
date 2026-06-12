const API_BASE = "";
const POLL_MS = 1800;

const state = {
  currentCase: null,
  role: "plaintiff",
  pollTimer: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  newCaseBtn: $("#newCaseBtn"),
  caseNumber: $("#caseNumber"),
  inviteCode: $("#inviteCode"),
  caseStatus: $("#caseStatus"),
  caseTitle: $("#caseTitle"),
  plaintiffName: $("#plaintiffName"),
  defendantName: $("#defendantName"),
  shareLink: $("#shareLink"),
  copyLinkBtn: $("#copyLinkBtn"),
  nextStep: $("#nextStep"),
  plaintiffStatement: $("#plaintiffStatement"),
  defendantStatement: $("#defendantStatement"),
  plaintiffAnswer: $("#plaintiffAnswer"),
  defendantAnswer: $("#defendantAnswer"),
  identityPill: $("#identityPill"),
  wordCount: $("#wordCount"),
  questionBox: $("#questionBox"),
  judgeQuestion: $("#judgeQuestion"),
  syncBtn: $("#syncBtn"),
  askBtn: $("#askBtn"),
  verdictBtn: $("#verdictBtn"),
  archiveList: $("#archiveList"),
  clearArchiveBtn: $("#clearArchiveBtn"),
  saveCardBtn: $("#saveCardBtn"),
  verdictDetail: $("#verdictDetail"),
  cardCaseNo: $("#cardCaseNo"),
  cardTitle: $("#cardTitle"),
  cardPlaintiff: $("#cardPlaintiff"),
  cardDefendant: $("#cardDefendant"),
  cardRatio: $("#cardRatio"),
  cardPenalty: $("#cardPenalty"),
  cardReason: $("#cardReason"),
  hardMouthIndex: $("#hardMouthIndex"),
  grievanceIndex: $("#grievanceIndex"),
  coaxDifficultyIndex: $("#coaxDifficultyIndex"),
  oldScoreRiskIndex: $("#oldScoreRiskIndex"),
};

function getCaseIdFromUrl() {
  const params = new URLSearchParams(location.search);
  return params.get("case");
}

function getRoleFromUrl() {
  const params = new URLSearchParams(location.search);
  const explicitRole = params.get("role");
  if (explicitRole === "defendant") return "defendant";
  if (explicitRole === "plaintiff") return "plaintiff";
  return null;
}

function getViewFromUrl() {
  const params = new URLSearchParams(location.search);
  const view = params.get("view");
  return ["court", "archive", "share"].includes(view) ? view : null;
}

function getPosterModeFromUrl() {
  const params = new URLSearchParams(location.search);
  return params.get("poster") === "1";
}

function getOwnedCases() {
  try {
    return JSON.parse(localStorage.getItem("love-court-owned-cases")) || [];
  } catch {
    return [];
  }
}

function rememberOwnedCase(caseId) {
  const ownedCases = new Set(getOwnedCases());
  ownedCases.add(caseId);
  localStorage.setItem("love-court-owned-cases", JSON.stringify([...ownedCases]));
}

function inferRole(caseId) {
  const explicitRole = getRoleFromUrl();
  if (explicitRole) return explicitRole;
  if (!caseId) return "plaintiff";
  return getOwnedCases().includes(caseId) ? "plaintiff" : "defendant";
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "请求失败");
  }
  return payload;
}

function switchView(viewName) {
  document.body.dataset.view = viewName;
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === `${viewName}View`));
  $$(".tab-button").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === viewName));
}

function setRole(role) {
  state.role = role === "defendant" ? "defendant" : "plaintiff";
  elements.identityPill.textContent = `当前身份：${state.role === "plaintiff" ? "原告" : "被告"}`;
  updateEditingState();
}

function updateEditingState() {
  const isPlaintiff = state.role === "plaintiff";
  const isDefendant = state.role === "defendant";
  elements.caseTitle.disabled = !isPlaintiff;
  elements.plaintiffName.disabled = !isPlaintiff;
  elements.defendantName.disabled = !isPlaintiff;
  elements.plaintiffStatement.disabled = !isPlaintiff;
  elements.plaintiffAnswer.disabled = !isPlaintiff;
  elements.defendantStatement.disabled = !isDefendant;
  elements.defendantAnswer.disabled = !isDefendant;
  elements.caseTitle.placeholder = isPlaintiff ? "例如：已读不回案" : "由原告填写案由";
  elements.plaintiffName.placeholder = isPlaintiff ? "例如：女朋友" : "由原告填写";
  elements.defendantName.placeholder = isPlaintiff ? "例如：男朋友" : "由原告填写";
  elements.plaintiffStatement.placeholder = isPlaintiff ? "说清楚发生了什么、你为什么委屈、希望对方怎么做。" : "当前由原告填写";
  elements.defendantStatement.placeholder = isDefendant ? "说清楚你的视角、有没有误会、你愿意承担什么。" : "当前由被告填写";
}

function getCaseProgress(caseData = state.currentCase) {
  if (!caseData) {
    return {
      status: "待立案",
      nextStep: "原告先点击“我要起诉”，创建一个新的案件房间。",
      canAsk: false,
      canVerdict: false,
    };
  }

  const hasInfo = Boolean(caseData.title && caseData.plaintiffName && caseData.defendantName);
  const hasPlaintiff = (caseData.plaintiffStatement || "").trim().length >= 8;
  const hasDefendant = (caseData.defendantStatement || "").trim().length >= 8;

  if (caseData.verdict) {
    return {
      status: "已宣判",
      nextStep: "判决书已生成，可以复制结果发给对方，或者在案卷里回看。",
      canAsk: false,
      canVerdict: true,
    };
  }

  if (!hasInfo) {
    return {
      status: "待原告立案",
      nextStep: state.role === "plaintiff" ? "请先填写案件名称、双方昵称和原告陈词。" : "等待原告补全案件信息。",
      canAsk: false,
      canVerdict: false,
    };
  }

  if (!hasPlaintiff) {
    return {
      status: "待原告陈词",
      nextStep: state.role === "plaintiff" ? "请写下你的陈词，至少 8 个字，然后点击同步陈词。" : "等待原告提交陈词。",
      canAsk: false,
      canVerdict: false,
    };
  }

  if (!hasDefendant) {
    return {
      status: "待被告陈词",
      nextStep: state.role === "plaintiff" ? "原告已就位，把传唤被告链接发给对方。" : "请写下你的陈词，至少 8 个字，然后点击同步陈词。",
      canAsk: false,
      canVerdict: false,
    };
  }

  return {
    status: "可宣判",
    nextStep: "双方陈词已齐，可以让 AI 法官追问，或直接生成裁决。",
    canAsk: true,
    canVerdict: true,
  };
}

function updateCaseProgress(caseData = state.currentCase) {
  const progress = getCaseProgress(caseData);
  elements.caseStatus.textContent = progress.status;
  elements.nextStep.textContent = progress.nextStep;
  elements.askBtn.disabled = !progress.canAsk;
  elements.verdictBtn.disabled = !progress.canVerdict;
}

async function createCase() {
  const payload = await api("/api/cases", { method: "POST" });
  rememberOwnedCase(payload.case.id);
  history.replaceState(null, "", `?case=${payload.case.id}`);
  state.currentCase = payload.case;
  setRole("plaintiff");
  hydrateCase(payload.case);
  startPolling();
  switchView("court");
}

async function loadCase(caseId) {
  const payload = await api(`/api/cases/${encodeURIComponent(caseId)}`);
  state.currentCase = payload.case;
  hydrateCase(payload.case);
  startPolling();
}

function hydrateCase(caseData) {
  state.currentCase = caseData;
  elements.caseNumber.textContent = `${caseData.caseNumber}号案件`;
  elements.inviteCode.textContent = `邀请码：${caseData.inviteCode}`;
  elements.caseTitle.value = caseData.title || "";
  elements.plaintiffName.value = caseData.plaintiffName || "";
  elements.defendantName.value = caseData.defendantName || "";
  elements.plaintiffStatement.value = caseData.plaintiffStatement || "";
  elements.defendantStatement.value = caseData.defendantStatement || "";
  elements.plaintiffAnswer.value = caseData.plaintiffAnswer || "";
  elements.defendantAnswer.value = caseData.defendantAnswer || "";
  elements.shareLink.value = `${location.origin}${location.pathname}?case=${caseData.id}&role=defendant`;
  elements.questionBox.hidden = !caseData.question;
  if (caseData.question) elements.judgeQuestion.textContent = caseData.question;
  updateWordCount();
  hydrateCard();
  renderVerdictDetail();
  updateEditingState();
  updateCaseProgress(caseData);
}

function getFormPatch() {
  const patch = {
  };
  if (state.role === "plaintiff") {
    patch.title = elements.caseTitle.value.trim();
    patch.plaintiffName = elements.plaintiffName.value.trim();
    patch.defendantName = elements.defendantName.value.trim();
    patch.plaintiffStatement = elements.plaintiffStatement.value.trim();
    patch.plaintiffAnswer = elements.plaintiffAnswer.value.trim();
  }
  if (state.role === "defendant") {
    patch.defendantStatement = elements.defendantStatement.value.trim();
    patch.defendantAnswer = elements.defendantAnswer.value.trim();
  }
  return patch;
}

async function saveCurrentCase({ quiet = false } = {}) {
  if (!state.currentCase) return null;
  const payload = await api(`/api/cases/${encodeURIComponent(state.currentCase.id)}`, {
    method: "PATCH",
    body: JSON.stringify(getFormPatch()),
  });
  hydrateCase(payload.case);
  if (!quiet) alert("已同步到案件房间。");
  return payload.case;
}

async function askQuestion() {
  await saveCurrentCase({ quiet: true });
  const payload = await api(`/api/cases/${encodeURIComponent(state.currentCase.id)}/question`, { method: "POST" });
  hydrateCase(payload.case);
}

async function generateVerdict() {
  await saveCurrentCase({ quiet: true });
  try {
    const payload = await api(`/api/cases/${encodeURIComponent(state.currentCase.id)}/verdict`, { method: "POST" });
    hydrateCase(payload.case);
    renderArchive();
    switchView("share");
  } catch (error) {
    alert(error.message);
  }
}

function updateWordCount() {
  const count = elements.plaintiffStatement.value.length + elements.defendantStatement.value.length;
  elements.wordCount.textContent = `${count} / 1000`;
  if (state.currentCase) {
    const draft = {
      ...state.currentCase,
      title: elements.caseTitle.value.trim(),
      plaintiffName: elements.plaintiffName.value.trim(),
      defendantName: elements.defendantName.value.trim(),
      plaintiffStatement: elements.plaintiffStatement.value.trim(),
      defendantStatement: elements.defendantStatement.value.trim(),
    };
    updateCaseProgress(draft);
  }
}

function hydrateCard() {
  const current = state.currentCase;
  if (!current) return;
  elements.cardCaseNo.textContent = `${current.caseNumber}号案件`;
  elements.cardTitle.textContent = current.title || "等待案由";
  elements.cardPlaintiff.textContent = current.plaintiffName || "-";
  elements.cardDefendant.textContent = current.defendantName || "-";
  if (!current.verdict) {
    elements.cardRatio.textContent = "等待审理";
    elements.cardPenalty.textContent = "尚未宣判";
    elements.cardReason.textContent = "双方陈词同步完成后，AI法官会生成事实认定、责任比例和娱乐处罚。";
    renderIndices();
    return;
  }
  const { ratio, penalty, reason, indices } = current.verdict;
  elements.cardRatio.textContent = `${current.plaintiffName} ${ratio.plaintiff}% / ${current.defendantName} ${ratio.defendant}%`;
  elements.cardPenalty.textContent = penalty;
  elements.cardReason.textContent = reason;
  renderIndices(indices);
}

function renderIndices(indices = {}) {
  elements.hardMouthIndex.textContent = formatIndex(indices.hardMouth);
  elements.grievanceIndex.textContent = formatIndex(indices.grievance);
  elements.coaxDifficultyIndex.textContent = formatIndex(indices.coaxDifficulty);
  elements.oldScoreRiskIndex.textContent = formatIndex(indices.oldScoreRisk);
}

function formatIndex(value) {
  return Number.isFinite(Number(value)) ? `${Math.round(Number(value))}` : "--";
}

function renderVerdictDetail() {
  const current = state.currentCase;
  if (!current?.verdict) {
    elements.verdictDetail.innerHTML = "";
    return;
  }
  const verdict = current.verdict;
  elements.verdictDetail.innerHTML = `
    <div class="detail-block">
      <h3>事实认定</h3>
      <p>${escapeHtml(verdict.facts)}</p>
    </div>
    <div class="detail-block">
      <h3>争议焦点</h3>
      <ol>${verdict.focus.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>
    </div>
      <div class="detail-block">
        <h3>判决理由</h3>
        <p>${escapeHtml(verdict.reason)}</p>
      </div>
      <div class="detail-block">
        <h3>娱乐指数</h3>
        <p>嘴硬指数 ${escapeHtml(formatIndex(verdict.indices?.hardMouth))}，委屈指数 ${escapeHtml(formatIndex(verdict.indices?.grievance))}，哄人难度 ${escapeHtml(formatIndex(verdict.indices?.coaxDifficulty))}，翻旧账风险 ${escapeHtml(formatIndex(verdict.indices?.oldScoreRisk))}。</p>
      </div>
      <div class="detail-block">
        <h3>和解建议</h3>
        <p>${escapeHtml(verdict.settlement)}</p>
    </div>
  `;
}

async function renderArchive() {
  try {
    const payload = await api("/api/cases");
    const cases = payload.cases;
    if (!cases.length) {
      elements.archiveList.innerHTML = `<div class="empty-state">暂无案件。先发起一次开庭，案卷会自动归档。</div>`;
      return;
    }
    elements.archiveList.innerHTML = cases
      .map((item) => {
        const ratio = item.verdict
          ? `${item.plaintiffName} ${item.verdict.ratio.plaintiff}% / ${item.defendantName} ${item.verdict.ratio.defendant}%`
          : "未宣判";
        return `
          <article class="archive-item">
            <strong>${escapeHtml(item.caseNumber)}号 ${escapeHtml(item.title || "未命名案件")}</strong>
            <span>原告：${escapeHtml(item.plaintiffName || "-")}　被告：${escapeHtml(item.defendantName || "-")}</span>
            <span>责任比例：${escapeHtml(ratio)}</span>
            <button type="button" data-load-case="${item.id}">查看判决书</button>
          </article>
        `;
      })
      .join("");
  } catch {
    elements.archiveList.innerHTML = `<div class="empty-state">案卷读取失败，请确认后端服务正在运行。</div>`;
  }
}

function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    if (!state.currentCase) return;
    const focused = document.activeElement;
    const isTyping = focused && ["TEXTAREA", "INPUT"].includes(focused.tagName) && !focused.readOnly;
    if (isTyping) return;
    try {
      await loadCase(state.currentCase.id);
    } catch {
      elements.caseStatus.textContent = "连接中断";
    }
  }, POLL_MS);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return map[char];
  });
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    alert(successMessage);
  } catch {
    alert("浏览器未允许复制，请手动选中复制。");
  }
}

function exportShareCard() {
  const current = state.currentCase;
  if (!current?.verdict) {
    alert("请先生成裁决，再保存判决书。");
    return;
  }
  const content = [
    "爱情法庭",
    `${current.caseNumber}号案件`,
    `案由：${current.title}`,
    `原告：${current.plaintiffName}`,
    `被告：${current.defendantName}`,
    `责任比例：${current.plaintiffName} ${current.verdict.ratio.plaintiff}% / ${current.defendantName} ${current.verdict.ratio.defendant}%`,
    `娱乐指数：嘴硬${formatIndex(current.verdict.indices?.hardMouth)} / 委屈${formatIndex(current.verdict.indices?.grievance)} / 哄人难度${formatIndex(current.verdict.indices?.coaxDifficulty)} / 翻旧账风险${formatIndex(current.verdict.indices?.oldScoreRisk)}`,
    `判决结果：${current.verdict.penalty}`,
  ].join("\n");
  copyText(content, "判决书文字已复制，可直接发给对方。");
}

function bindEvents() {
  elements.newCaseBtn.addEventListener("click", createCase);
  elements.copyLinkBtn.addEventListener("click", () => copyText(elements.shareLink.value, "邀请链接已复制。"));
  elements.syncBtn.addEventListener("click", () => saveCurrentCase());
  elements.askBtn.addEventListener("click", askQuestion);
  elements.verdictBtn.addEventListener("click", generateVerdict);
  elements.saveCardBtn.addEventListener("click", exportShareCard);
  elements.clearArchiveBtn.addEventListener("click", async () => {
    if (!confirm("确定清空服务端案卷吗？")) return;
    await api("/api/cases", { method: "DELETE" });
    renderArchive();
  });
  elements.archiveList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-load-case]");
    if (!button) return;
    rememberOwnedCase(button.dataset.loadCase);
    history.replaceState(null, "", `?case=${button.dataset.loadCase}`);
    setRole("plaintiff");
    await loadCase(button.dataset.loadCase);
    switchView("share");
  });
  $$(".tab-button").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  [elements.plaintiffStatement, elements.defendantStatement].forEach((textarea) => {
    textarea.addEventListener("input", updateWordCount);
  });
  [elements.caseTitle, elements.plaintiffName, elements.defendantName].forEach((field) => {
    field.addEventListener("input", updateWordCount);
  });
  $$(".sync-on-blur").forEach((field) => {
    field.addEventListener("blur", () => saveCurrentCase({ quiet: true }).catch(() => {}));
  });
}

async function boot() {
  bindEvents();
  document.body.dataset.poster = getPosterModeFromUrl() ? "true" : "false";
  await renderArchive();
  const caseId = getCaseIdFromUrl();
  setRole(inferRole(caseId));
  if (caseId) {
    await loadCase(caseId);
    switchView(getViewFromUrl() || "court");
  } else {
    await createCase();
  }
}

boot().catch((error) => {
  document.body.innerHTML = `<main class="fatal"><h1>服务未启动</h1><p>${escapeHtml(error.message)}</p><p>请在项目目录运行：node server.js</p></main>`;
});
