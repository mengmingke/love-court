# Love Court 里程碑、验收标准与上线清单

> 对应 Task 7.2：形成分阶段里程碑、验收标准与上线清单。
> 依据：`.trae/specs/launch-ready-miniapp/spec.md` 与 `tasks.md`。

## 1. 分阶段里程碑

### M1：基础设施与环境（对应 Task 1）

- **范围**：微信登录、业务 Token、HTTPS 域名、生产/测试环境隔离、生产构建配置固化。
- **交付物**：
  - `src/services/auth.ts` 微信登录链路可用
  - `src/config/env.ts` 生产/开发环境隔离
  - `.env.production` 配置生产 HTTPS 与 AppID
  - 小程序后台已配置 request 合法域名
- **里程碑日期**：计划 YYYY-MM-DD / 实际 YYYY-MM-DD
- **状态**：☐ 未开始 / 🚧 进行中 / ✅ 完成

### M2：远程数据模型与持久化（对应 Task 2，依赖 M1）

- **范围**：users / cases / case_participants / case_statements / verdicts / case_access_tokens 表结构；创建/加入/查询/更新/裁决/历史接口；事务、幂等、并发控制。
- **交付物**：
  - `server.js` 持久化 6 张表
  - `withStoreWrite` 串行化写入
  - `caseStatements.version` 单调递增
  - 接口幂等（重复 join 不重复创建 participant）
- **里程碑日期**：计划 / 实际
- **状态**：☐ / 🚧 / ✅

### M3：权限隔离与历史管理（对应 Task 3，依赖 M2）

- **范围**：案件访问边界校验、历史分页/归档/软删除/恢复、邀请码生成/校验/失效。
- **交付物**：
  - `requireParticipant` / `requireCaseOwnerOrParticipant` 权限校验
  - `isVisibleToUser` 数据可见性过滤
  - 邀请 token 7 天过期 + 一次性使用
  - 归档/恢复/软删除/彻底删除接口
- **里程碑日期**：计划 / 实际
- **状态**：☐ / 🚧 / ✅

### M4：裁决与分享正式化（对应 Task 4，依赖 M2 + M3）

- **范围**：裁决持久化（provider/model/reasoning）、正反面展示、来源标识、海报生成与缓存。
- **交付物**：
  - `verdicts` 表持久化 AI 与本地规则裁决
  - 裁决书正面/背面 UI
  - `getProviderLabel` 来源标识
  - `buildShareImagePng` + 30 天缓存
- **里程碑日期**：计划 / 实际
- **状态**：☐ / 🚧 / ✅

### M5：UI、性能与兼容性（对应 Task 5，可与 M2 后半并行）

- **范围**：表单校验、加载/空/错误态、弱网提示、移动端适配、包体积控制。
- **交付物**：
  - `validateCaseInfo` / `validateStatement` 校验
  - `subscribeNetworkStatus` 弱网提示
  - 各页 loading/empty/error 状态卡片
  - `minified: true` 生产构建
- **里程碑日期**：计划 / 实际
- **状态**：☐ / 🚧 / ✅

### M6：安全加固与合规（对应 Task 6，依赖 M1 + M2）

- **范围**：敏感内容拦截、日志脱敏、权限最小化、接口限流、隐私政策、用户协议、AI 说明、删除入口、备份恢复演练。
- **交付物**：
  - `sanitizeCasePatch` / `validateCase` 敏感词拦截
  - `desensitizeLog` 日志脱敏
  - `checkRateLimit` 限流（120/min）
  - `src/pages/legal/index.tsx` 隐私/协议/AI 说明/删除入口
  - `scripts/backup.js` / `restore.js` / `drill.js` 灾备
  - `scripts/DISASTER_RECOVERY.md` 灾备方案
- **里程碑日期**：计划 / 实际
- **状态**：☐ / 🚧 / ✅

### M7：测试、验收与上线材料（对应 Task 7，依赖 M3-M6）

- **范围**：功能/兼容/性能/安全测试、里程碑验收、上线清单、发布说明、风险说明。
- **交付物**：
  - `docs/test-plans.md`
  - `docs/milestones-and-launch-checklist.md`
  - `docs/release-notes.md`
  - `docs/risk-notes.md`
- **里程碑日期**：计划 / 实际
- **状态**：☐ / 🚧 / ✅

### M8：灰度与正式发布

- **范围**：提交微信审核、灰度发布、全量发布、监控。
- **交付物**：
  - 微信审核通过
  - 灰度 10% → 50% → 100%
  - 上线后 7 天监控报告
- **里程碑日期**：计划 / 实际
- **状态**：☐ / 🚧 / ✅

---

## 2. 验收标准（Acceptance Criteria）

### 2.1 按 Spec Requirement 验收

| Spec Requirement | 验收标准 | 验收方式 | 通过 |
| --- | --- | --- | --- |
| 微信登录与用户绑定 | 首次登录创建 user 并签发 token；重复登录恢复登录态 | F-LOGIN-01/02 | ☐ |
| 正式数据持久化 | 创建案件后写入 DB；重新进入从远程恢复 | F-CASE-01 + F-VERDICT-08 | ☐ |
| 多用户隔离与权限控制 | 非参与人访问返回 403；参与人可见完整数据 | F-HIST-04 + S-AUTH-03 | ☐ |
| 核心业务闭环 | 创建→邀请→陈词→裁决→历史→分享全流程通过 | F-CASE → F-INVITE → F-STMT → F-VERDICT → F-HIST → F-SHARE | ☐ |
| 审核与合规材料 | 隐私政策/用户协议/AI 说明/删除入口可达 | F-PRIV-01 + S-DEL-04 | ☐ |
| 性能与兼容性要求 | 低端机/弱网可用；性能指标达标 | C-NET-03 + P-FE-01 | ☐ |
| 版本计划与里程碑 | 各阶段可依据 checklist 验证 | 本文档 M1-M8 | ☐ |

### 2.2 按 Task 验收

| Task | 验收标准 | 通过 |
| --- | --- | --- |
| 1.1 微信登录与业务 Token | `bootstrapBusinessSession` 在 weapp 环境调用 `Taro.login` 换发 token | ☐ |
| 1.2 HTTPS 与环境隔离 | `.env.production` 指向 HTTPS；`.env.development` 指向本地 | ☐ |
| 1.3 生产配置固化 | `project.config.json` 已 `minified: true`；无调试依赖进入生产构建 | ☐ |
| 2.1 表结构 | 6 张表（users/cases/caseParticipants/caseStatements/verdicts/caseAccessTokens）已落地 | ☐ |
| 2.2 接口 | 创建/加入/查询/更新/裁决/历史接口全部可用 | ☐ |
| 2.3 事务与并发 | `withStoreWrite` 串行化；version 单调递增；幂等 join | ☐ |
| 3.1 权限边界 | `requireParticipant` / `isVisibleToUser` 生效 | ☐ |
| 3.2 历史管理 | 分页/归档/软删除/恢复可用 | ☐ |
| 3.3 邀请流程 | 邀请码生成/校验/失效（一次性 + 7 天过期） | ☐ |
| 4.1 裁决持久化 | verdicts 表含 provider/model/payload | ☐ |
| 4.2 裁决展示 | 正反面 + 来源标识 + 分享页 | ☐ |
| 4.3 海报生成 | PNG 生成 + 30 天缓存 | ☐ |
| 5.1 表单与状态 | 校验/loading/empty/error/弱网提示齐备 | ☐ |
| 5.2 适配与兼容 | 多机型多微信版本通过 | ☐ |
| 5.3 包体积 | 主包 ≤ 2MB | ☐ |
| 6.1 安全加固 | 敏感词拦截 + 日志脱敏 + 限流 | ☐ |
| 6.2 合规材料 | 隐私/协议/AI 说明/删除入口 | ☐ |
| 6.3 灾备 | backup/restore/drill 可用 | ☐ |
| 7.1 测试计划 | `docs/test-plans.md` 完成 | ☐ |
| 7.2 里程碑与清单 | 本文档完成 | ☐ |
| 7.3 发布与风险说明 | `docs/release-notes.md` + `docs/risk-notes.md` 完成 | ☐ |

### 2.3 上线门槛（Go/No-Go）

- [ ] 所有 P0/P1 缺陷已修复
- [ ] 功能测试通过率 ≥ 95%
- [ ] 性能指标全部达标
- [ ] 安全测试无高危项
- [ ] 灾备演练通过（`node scripts/drill.js`）
- [ ] 隐私政策、用户协议、AI 说明已上线
- [ ] 删除入口可用
- [ ] 生产 HTTPS 域名已配置且证书有效
- [ ] 微信小程序后台已配置合法域名
- [ ] AppID 已替换 `touristappid`
- [ ] DEEPSEEK_API_KEY 已配置且余额充足
- [ ] 限流参数已按生产负载配置
- [ ] 备份 cron 已配置
- [ ] 运维已知悉恢复流程

---

## 3. 上线清单（Launch Checklist）

### 3.1 代码与构建

- [ ] `git tag v1.0.0` 已打 tag
- [ ] `npm run build:weapp:prod` 构建成功
- [ ] `dist/` 体积主包 ≤ 2MB
- [ ] 无 console.log / debugger 残留（生产构建）
- [ ] `project.config.json` 的 `appid` 已替换为正式 AppID
- [ ] `project.config.json` 的 `urlCheck: true`
- [ ] `minified: true`

### 3.2 环境与配置

- [ ] `.env.production` 已配置：
  - [ ] `TARO_APP_ENV=production`
  - [ ] `TARO_APP_API_BASE=https://api.love-court.example.com`（替换为真实域名）
  - [ ] `TARO_APP_LOGIN_ENABLED=true`
  - [ ] `TARO_APP_AUTH_LOGIN_PATH=/api/auth/wechat/login`
  - [ ] `TARO_APP_ID=` 正式 AppID
- [ ] 后端环境变量已配置：
  - [ ] `DEEPSEEK_API_KEY` 已设置
  - [ ] `DEEPSEEK_MODEL=deepseek-v4-flash`
  - [ ] `RATE_LIMIT_WINDOW_MS=60000`
  - [ ] `RATE_LIMIT_MAX=120`
  - [ ] `BACKUP_KEEP=14`
  - [ ] `BACKUP_THROTTLE_MS=30000`
  - [ ] `PORT=3000`

### 3.3 域名与证书

- [ ] 生产 HTTPS 域名已解析
- [ ] SSL 证书已部署且有效期 ≥ 3 个月
- [ ] SSL Labs 评级 ≥ A
- [ ] 微信小程序后台 → 开发管理 → 开发设置 → 服务器域名 → request 合法域名已添加
- [ ] downloadFile 合法域名已添加（海报下载）

### 3.4 数据与灾备

- [ ] `data/` 目录存在且可读写
- [ ] `data/backups/` 目录存在且可写
- [ ] `node scripts/backup.js` 可成功创建备份
- [ ] `node scripts/restore.js --latest` 可成功恢复
- [ ] `node scripts/drill.js` 通过
- [ ] cron / 任务计划程序已配置定时备份（每小时一次）
- [ ] 运维已知悉 `scripts/DISASTER_RECOVERY.md`

### 3.5 合规与审核材料

- [ ] 隐私政策已上线（`/pages/legal/index`）
- [ ] 用户协议已上线
- [ ] AI 生成内容说明已上线
- [ ] 删除我的数据入口可用
- [ ] 单案件删除/彻底删除可用
- [ ] `docs/release-notes.md` 已准备
- [ ] `docs/risk-notes.md` 已准备
- [ ] 微信小程序类目已选择（社交 > 社交资讯 / 娱乐）
- [ ] 微信小程序功能页面截图已准备
- [ ] 微信小程序测试账号已准备（供审核使用）

### 3.6 测试与验收

- [ ] `docs/test-plans.md` 全部用例已执行
- [ ] P0/P1 缺陷 = 0
- [ ] 功能测试通过率 ≥ 95%
- [ ] 兼容性测试覆盖 ≥ 4 机型 + 2 微信版本
- [ ] 性能测试全部达标
- [ ] 安全测试无高危
- [ ] 灾备演练通过
- [ ] 灰度发布计划已制定（10% → 50% → 100%）

### 3.7 监控与运维

- [ ] 后端进程管理器已配置（pm2 / systemd / 微信云托管）
- [ ] 日志收集已配置（脱敏后）
- [ ] 告警已配置（接口错误率、磁盘、内存）
- [ ] 值班联系人已确定
- [ ] 回滚方案已准备（`restore.js --latest` + 旧版本小程序包）

### 3.8 提交审核

- [ ] 通过微信开发者工具上传代码
- [ ] 提交审核，附 `docs/release-notes.md`
- [ ] 审核通过后灰度发布
- [ ] 灰度监控 24h 无异常 → 全量发布

---

## 4. 上线后监控（Post-Launch）

| 指标 | 目标 | 监控方式 | 告警阈值 |
| --- | --- | --- | --- |
| 接口错误率 | < 1% | 日志统计 | > 5% 持续 5 分钟 |
| 接口 P95 延迟 | < 500ms（非 AI） | 日志统计 | > 1s 持续 5 分钟 |
| 429 限流次数 | < 100/小时 | 日志统计 | > 1000/小时 |
| 磁盘使用 | < 80% | 系统监控 | > 90% |
| 内存使用 | < 80% | 进程监控 | > 90% |
| 备份成功率 | 100% | cron 日志 | 任意失败 |
| 微信审核投诉 | 0 | 微信后台 | ≥ 1 |
| 用户反馈删除请求 | 24h 内响应 | 客服 | 超时 |

## 5. 回滚方案

### 5.1 代码回滚

- 微信小程序：在微信后台「版本管理」回退到上一稳定版本
- 后端：`git checkout` 到上一 tag，重启服务

### 5.2 数据回滚

```bash
node scripts/restore.js --latest
# 重启 server.js
```

### 5.3 紧急关停

- 后端：停止 `server.js` 进程，小程序自动 fallback 到本地兜底（功能受限但不白屏）
- 小程序：在微信后台下架版本

## 6. 发布节奏

| 阶段 | 范围 | 时长 | 通过标准 |
| --- | --- | --- | --- |
| 内测 | 团队 + 5-10 组用户 | 3 天 | 无 P0/P1，收集反馈 |
| 灰度 10% | 随机 10% 用户 | 24h | 错误率 < 1%，无 P0 |
| 灰度 50% | 随机 50% 用户 | 24h | 错误率 < 1%，无 P0 |
| 全量 | 100% | - | 持续监控 |
