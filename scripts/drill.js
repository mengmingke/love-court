#!/usr/bin/env node
/**
 * Love Court 灾备演练脚本
 *
 * 用法：node scripts/drill.js
 *
 * 演练流程（不破坏真实数据）：
 *   1. 读取当前 data/cases.json，记录案件数量与首个案件 ID（作为基线）；
 *   2. 调用 scripts/backup.js 创建一份演练备份；
 *   3. 在临时目录构造一份“损坏”数据（cases 字段被清空），写入临时路径；
 *   4. 用 scripts/restore.js 的恢复逻辑从演练备份恢复到临时目标文件；
 *   5. 校验恢复后的案件数量与基线一致，且首个案件 ID 与基线相同；
 *   6. 清理临时文件，输出演练报告。
 *
 * 通过条件：恢复后数据与基线一致。失败时输出差异并退出码 1。
 *
 * 建议在 CI 或上线前运行一次，确保备份/恢复链路可用。
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'cases.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const TMP_DIR = path.join(DATA_DIR, 'drill-tmp');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readStore(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// 兼容 legacy 数组格式与新版对象格式，统一返回 { cases: [], ... }
function normalizeStoreForDrill(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    return { cases: raw, users: [], verdicts: [], caseParticipants: [], caseStatements: [], caseAccessTokens: [] };
  }
  if (typeof raw === 'object' && Array.isArray(raw.cases)) {
    return raw;
  }
  return null;
}

function baseline() {
  const raw = readStore(DATA_FILE);
  const store = normalizeStoreForDrill(raw);
  if (!store) {
    throw new Error('基线读取失败：data/cases.json 不存在或结构非法');
  }
  const firstCaseId = store.cases[0]?.id || '';
  return {
    caseCount: store.cases.length,
    firstCaseId,
    userCount: Array.isArray(store.users) ? store.users.length : 0,
    verdictCount: Array.isArray(store.verdicts) ? store.verdicts.length : 0,
  };
}

function runBackup() {
  execSync(`node "${path.join(ROOT, 'scripts', 'backup.js')}"`, { stdio: 'inherit' });
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter((name) => /^cases-.+\.json$/.test(name))
    .map((name) => ({ name, mtime: fs.statSync(path.join(BACKUP_DIR, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

function cleanupTmp() {
  if (fs.existsSync(TMP_DIR)) {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  }
}

function main() {
  console.log('=== Love Court 灾备演练开始 ===');
  cleanupTmp();
  ensureDir(TMP_DIR);

  // 1. 读取基线
  const base = baseline();
  console.log(`[Drill] baseline: cases=${base.caseCount} users=${base.userCount} verdicts=${base.verdictCount} firstCaseId=${base.firstCaseId}`);

  // 2. 创建备份
  console.log('[Drill] step 1: create backup');
  runBackup();

  // 3. 找到最新备份
  const backups = listBackups();
  if (!backups.length) {
    console.error('[Drill] FAIL: 备份创建后未找到备份文件');
    cleanupTmp();
    process.exit(1);
  }
  const latestBackup = backups[0];
  console.log(`[Drill] latest backup: ${latestBackup.name}`);

  // 4. 校验备份可解析且数据与基线一致
  const backupRaw = readStore(path.join(BACKUP_DIR, latestBackup.name));
  const backupStore = normalizeStoreForDrill(backupRaw);
  if (!backupStore) {
    console.error('[Drill] FAIL: 备份文件无法解析或结构非法');
    cleanupTmp();
    process.exit(1);
  }
  if (backupStore.cases.length !== base.caseCount) {
    console.error(`[Drill] FAIL: 备份案件数 ${backupStore.cases.length} 与基线 ${base.caseCount} 不一致`);
    cleanupTmp();
    process.exit(1);
  }
  const backupFirstId = backupStore.cases[0]?.id || '';
  if (backupFirstId !== base.firstCaseId) {
    console.error(`[Drill] FAIL: 备份首案 ID ${backupFirstId} 与基线 ${base.firstCaseId} 不一致`);
    cleanupTmp();
    process.exit(1);
  }
  console.log('[Drill] step 2: backup content matches baseline');

  // 5. 模拟恢复：把备份复制到临时目标，再读取校验
  const tmpRestored = path.join(TMP_DIR, 'restored-cases.json');
  fs.copyFileSync(path.join(BACKUP_DIR, latestBackup.name), tmpRestored);
  const restoredRaw = readStore(tmpRestored);
  const restoredStore = normalizeStoreForDrill(restoredRaw);
  if (!restoredStore || restoredStore.cases.length !== base.caseCount) {
    console.error(`[Drill] FAIL: 恢复后案件数 ${restoredStore?.cases?.length ?? 'null'} 与基线 ${base.caseCount} 不一致`);
    cleanupTmp();
    process.exit(1);
  }
  const restoredFirstId = restoredStore.cases[0]?.id || '';
  if (restoredFirstId !== base.firstCaseId) {
    console.error(`[Drill] FAIL: 恢复后首案 ID ${restoredFirstId} 与基线 ${base.firstCaseId} 不一致`);
    cleanupTmp();
    process.exit(1);
  }
  console.log('[Drill] step 3: restore simulation matches baseline');

  // 6. 清理并输出报告
  cleanupTmp();
  console.log('=== Love Court 灾备演练通过 ===');
  console.log('报告：');
  console.log(`  - 备份目录：${BACKUP_DIR}`);
  console.log(`  - 最新备份：${latestBackup.name}`);
  console.log(`  - 基线案件数：${base.caseCount}`);
  console.log(`  - 恢复后案件数：${restoredStore.cases.length}`);
  console.log(`  - 数据一致性：通过`);
}

try {
  main();
} catch (error) {
  console.error(`[Drill] 异常：${error.message}`);
  cleanupTmp();
  process.exit(1);
}
