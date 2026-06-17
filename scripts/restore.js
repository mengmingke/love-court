#!/usr/bin/env node
/**
 * Love Court 数据恢复脚本
 *
 * 用法：
 *   node scripts/restore.js --list                       # 列出可用备份
 *   node scripts/restore.js --file cases-2026-06-17T00-00-00-000Z.json
 *                                                         # 从指定备份恢复
 *   node scripts/restore.js --latest                     # 从最新备份恢复
 *
 * 恢复流程：
 *   1. 校验备份文件存在且为合法 JSON；
 *   2. 恢复前把当前 data/cases.json 另存为 cases-pre-restore-<时间戳>.json；
 *   3. 用备份覆盖 data/cases.json；
 *   4. 输出恢复前快照路径，便于回滚。
 *
 * 注意：恢复后需重启 server.js 让其重新加载磁盘数据。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'cases.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

function parseArgs(argv) {
  const args = { file: '', latest: false, list: false };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === '--file') {
      args.file = String(argv[i + 1] || '');
      i += 1;
    } else if (item === '--latest') {
      args.latest = true;
    } else if (item === '--list') {
      args.list = true;
    }
  }
  return args;
}

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

function validateBackupFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`备份文件不存在：${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`备份文件 JSON 解析失败：${error.message}`);
  }
  // 兼容 legacy 数组格式与新版对象格式
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('备份文件结构非法：期望对象或数组');
  }
  if (!Array.isArray(parsed.cases)) {
    throw new Error('备份文件结构非法：缺少 cases 数组');
  }
  return parsed;
}

function restoreFrom(backupFileName) {
  if (!/^cases-.+\.json$/.test(backupFileName)) {
    throw new Error('备份文件名非法，必须形如 cases-*.json');
  }
  const backupPath = path.join(BACKUP_DIR, backupFileName);
  validateBackupFile(backupPath);

  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const preRestoreStamp = new Date().toISOString().replace(/[:.]/g, '-');
  const preRestorePath = path.join(BACKUP_DIR, `cases-pre-restore-${preRestoreStamp}.json`);
  if (fs.existsSync(DATA_FILE)) {
    fs.copyFileSync(DATA_FILE, preRestorePath);
    console.log(`[Restore] pre-restore snapshot: ${path.basename(preRestorePath)}`);
  }
  fs.copyFileSync(backupPath, DATA_FILE);
  console.log(`[Restore] restored from: ${backupFileName}`);
  console.log('[Restore] please restart server.js to reload data.');
  return { restoredFrom: backupFileName, preRestoreSnapshot: path.basename(preRestorePath) };
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    const entries = listBackups();
    if (!entries.length) {
      console.log('[Restore] no backups available.');
      return;
    }
    console.log('[Restore] available backups (newest first):');
    for (const entry of entries) {
      console.log(`  ${entry.name}\t${entry.size}B\t${entry.mtime}`);
    }
    return;
  }

  if (!args.file && !args.latest) {
    console.error('[Restore] missing --file <name> or --latest');
    process.exit(1);
  }

  let target = args.file;
  if (args.latest) {
    const entries = listBackups();
    if (!entries.length) {
      console.error('[Restore] no backups available.');
      process.exit(1);
    }
    target = entries[0].name;
    console.log(`[Restore] using latest backup: ${target}`);
  }

  try {
    restoreFrom(target);
  } catch (error) {
    console.error(`[Restore] failed: ${error.message}`);
    process.exit(1);
  }
}

main();
