#!/usr/bin/env node
/**
 * Love Court 数据备份脚本
 *
 * 用法：
 *   node scripts/backup.js                # 立即创建一份备份
 *   node scripts/backup.js --keep 30      # 指定保留份数（默认 14）
 *   node scripts/backup.js --list         # 仅列出可用备份
 *
 * 备份位置：data/backups/cases-<ISO时间戳>.json
 * 备份策略：复制当前 data/cases.json 到备份目录，按时间排序保留最新 N 份。
 *
 * 该脚本可被 cron / 任务计划程序定期调用，例如每小时一次：
 *   0 * * * * cd /path/to/love-court && node scripts/backup.js >> logs/backup.log 2>&1
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'cases.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

function parseArgs(argv) {
  const args = { keep: 14, list: false };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === '--keep') {
      args.keep = Number(argv[i + 1]) || 14;
      i += 1;
    } else if (item === '--list') {
      args.list = true;
    }
  }
  return args;
}

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
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

function pruneOldBackups(keep) {
  const entries = listBackups();
  for (const entry of entries.slice(keep)) {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, entry.name));
      console.log(`[Backup] pruned old backup: ${entry.name}`);
    } catch (error) {
      console.warn(`[Backup] prune failed: ${entry.name} - ${error.message}`);
    }
  }
}

function writeBackup() {
  if (!fs.existsSync(DATA_FILE)) {
    console.error(`[Backup] data file not found: ${DATA_FILE}`);
    process.exit(1);
  }
  ensureBackupDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(BACKUP_DIR, `cases-${stamp}.json`);
  fs.copyFileSync(DATA_FILE, target);
  const stat = fs.statSync(target);
  console.log(`[Backup] created: ${path.basename(target)} (${stat.size} bytes)`);
  return target;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    const entries = listBackups();
    if (!entries.length) {
      console.log('[Backup] no backups yet.');
      return;
    }
    console.log('[Backup] available backups (newest first):');
    for (const entry of entries) {
      console.log(`  ${entry.name}\t${entry.size}B\t${entry.mtime}`);
    }
    return;
  }
  writeBackup();
  pruneOldBackups(args.keep);
}

main();
