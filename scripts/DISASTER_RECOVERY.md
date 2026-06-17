# Love Court 灾备演练与恢复方案

> 适用于 Task 6.3：数据库备份、恢复演练与灾备验证方案。
> 当前数据存储为文件型 JSON（`data/cases.json`），无真实数据库；本方案同时适用于未来迁移到真实 DB 后的演练流程。

## 1. 备份策略

| 项目 | 配置 |
| --- | --- |
| 备份对象 | `data/cases.json`（含 users / cases / caseParticipants / caseStatements / verdicts / caseAccessTokens） |
| 备份目录 | `data/backups/` |
| 备份命名 | `cases-<ISO时间戳>.json`（冒号替换为 `-`，兼容 Windows） |
| 触发方式 | 1) server.js 每次写入成功后节流触发（`BACKUP_THROTTLE_MS`，默认 30s）；2) cron 定时调用 `scripts/backup.js`（建议每小时一次） |
| 保留份数 | 默认 14 份（`BACKUP_KEEP` / `--keep` 可调），超出按 mtime 倒序裁剪 |
| 恢复前快照 | 恢复时自动把当前数据另存为 `cases-pre-restore-<时间戳>.json`，便于回滚 |

环境变量：

```
BACKUP_KEEP=14
BACKUP_THROTTLE_MS=30000
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=120
```

## 2. 恢复流程

### 2.1 列出可用备份

```bash
node scripts/backup.js --list
# 或
node scripts/restore.js --list
```

### 2.2 从指定备份恢复

```bash
node scripts/restore.js --file cases-2026-06-17T00-00-00-000Z.json
```

### 2.3 从最新备份恢复

```bash
node scripts/restore.js --latest
```

恢复脚本会：

1. 校验备份文件存在且为合法 JSON（含 `cases` 数组）；
2. 把当前 `data/cases.json` 另存为 `cases-pre-restore-<时间戳>.json`；
3. 用备份覆盖 `data/cases.json`；
4. 提示重启 `server.js` 以重新加载数据。

### 2.4 回滚一次恢复

如果恢复后发现数据不正确，可用 `cases-pre-restore-*.json` 再次执行恢复：

```bash
node scripts/restore.js --file cases-pre-restore-2026-06-17T01-00-00-000Z.json
```

## 3. 灾备演练计划

### 3.1 自动化演练

```bash
node scripts/drill.js
```

`scripts/drill.js` 会自动执行：

1. 读取当前 `data/cases.json` 作为基线（案件数、首案 ID、用户数、裁决数）；
2. 调用 `scripts/backup.js` 创建一份演练备份；
3. 校验备份内容与基线一致（案件数、首案 ID）；
4. 模拟恢复（把备份复制到临时目录并读取校验）；
5. 校验恢复后数据与基线一致；
6. 清理临时文件，输出演练报告。

通过条件：恢复后案件数与首案 ID 与基线一致。失败时退出码 1。

### 3.2 演练频率

| 场景 | 频率 |
| --- | --- |
| 上线前 | 必须运行一次 `scripts/drill.js` 并通过 |
| 日常 | 每周一次（建议在 CI 中加入） |
| 故障恢复后 | 立即运行一次，确认备份链路仍可用 |

### 3.3 人工演练清单

- [ ] `node scripts/backup.js` 能成功创建备份，且备份文件可被 `--list` 列出；
- [ ] `node scripts/restore.js --latest` 能成功恢复，且恢复后 `data/cases.json` 可被 `server.js` 正常加载；
- [ ] `node scripts/drill.js` 通过，输出“灾备演练通过”；
- [ ] 恢复后启动 `server.js`，调用 `GET /api/me/cases` 能返回与基线一致的案件列表；
- [ ] 恢复后调用 `GET /api/cases/:id` 能正常返回案件详情（权限隔离未被破坏）。

## 4. 灾备 RTO / RPO 目标

| 指标 | 目标 | 说明 |
| --- | --- | --- |
| RPO（数据丢失容忍） | ≤ 1 小时 | cron 每小时备份一次；server.js 写入时也会节流备份 |
| RTO（恢复时间目标） | ≤ 10 分钟 | `scripts/restore.js --latest` + 重启 server.js |
| 备份保留 | 14 份 | 默认 14 份，可按需调整 |

## 5. 故障场景与应对

| 场景 | 应对 |
| --- | --- |
| `data/cases.json` 损坏（JSON 解析失败） | `server.js` 的 `readRawStore` 会回退到空 store；应立即 `node scripts/restore.js --latest` 恢复 |
| 误删案件（软删除） | 在案卷页或庭审页使用“恢复”按钮，或直接 `PATCH` 恢复 |
| 误删案件（彻底删除 purge） | 从 `data/backups/` 中找到 purge 之前的备份，用 `scripts/restore.js --file` 恢复 |
| 备份目录被清空 | 重新启动 `server.js`，写入会自动重建备份目录并触发新备份 |
| server.js 进程崩溃 | 由进程管理器（pm2 / systemd / 微信云托管）自动拉起；数据已在磁盘 |

## 6. 上线前检查清单

- [ ] `data/backups/` 目录存在且可写；
- [ ] `scripts/backup.js`、`scripts/restore.js`、`scripts/drill.js` 可执行；
- [ ] `node scripts/drill.js` 通过；
- [ ] cron / 任务计划程序已配置定时备份（生产环境）；
- [ ] 运维已知悉恢复流程与回滚方式；
- [ ] `BACKUP_KEEP`、`BACKUP_THROTTLE_MS`、`RATE_LIMIT_*` 环境变量已按生产负载配置。
