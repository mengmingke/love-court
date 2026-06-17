# Love Court 测试计划与清单

> 对应 Task 7.1：制定并执行功能测试、兼容性测试、性能测试与安全测试。
> 覆盖范围：登录、创建案件、邀请被告、双方陈词、裁决生成、历史案卷、分享、隐私/删除、错误态、限流、敏感内容。
> 测试环境：微信开发者工具 + 真机（iOS / Android）+ 生产后端（HTTPS）。

## 0. 测试前置条件

- [ ] 已配置生产 HTTPS 域名并加入小程序「request 合法域名」白名单
- [ ] `TARO_APP_LOGIN_ENABLED=true`、`TARO_APP_API_BASE` 指向生产 HTTPS
- [ ] `DEEPSEEK_API_KEY` 已配置且余额充足（用于 AI 裁决路径）
- [ ] 后端 `server.js` 已部署，`data/cases.json` 可读写，`data/backups/` 可写
- [ ] 已通过 `node scripts/drill.js` 灾备演练
- [ ] 微信小程序 AppID 已替换 `project.config.json` 中的 `touristappid`
- [ ] 测试账号：至少 2 个微信账号（A 作为原告、B 作为被告）

---

## 1. 功能测试（Functional Test）

### 1.1 登录与用户绑定

| 编号 | 场景 | 步骤 | 预期 | 通过 |
| --- | --- | --- | --- | --- |
| F-LOGIN-01 | 首次登录 | A 首次打开小程序 | 后端创建 user 记录（source=business-token），签发业务 token 并写入 storage；首页可正常加载 | ☐ |
| F-LOGIN-02 | 重复登录 | A 关闭后再次打开 | 自动恢复登录态，无需重新授权；历史案件可见 | ☐ |
| F-LOGIN-03 | Token 失效 | 手动清空 storage 或后端撤销 token | 下次接口请求触发 401，前端重新走 `Taro.login` 换发新 token | ☐ |
| F-LOGIN-04 | 非微信环境 | 在 H5 / 开发者工具关闭微信登录 | `authEnabled=false` 时降级为 client-id 模式，不阻塞核心流程 | ☐ |

### 1.2 创建案件

| 编号 | 场景 | 步骤 | 预期 | 通过 |
| --- | --- | --- | --- | --- |
| F-CASE-01 | 创建空案件 | A 点击「新案件」 | 后端 `POST /api/cases` 返回 201，生成 `caseNumber`（YYYY-NNN）与 6 位 `inviteCode`；原告自动绑定 plaintiff 角色 | ☐ |
| F-CASE-02 | 案件号自增 | 连续创建 3 个案件 | caseNumber 依次为 001/002/003，不重复 | ☐ |
| F-CASE-03 | 邀请码唯一性 | 创建 10 个案件 | inviteCode 不重复，均为 6 位大写十六进制 | ☐ |
| F-CASE-04 | 本地兜底 | 断开后端 | 自动 fallback 到 `local-` 前缀案件，UI 可用但分享海报不可用 | ☐ |

### 1.3 邀请被告

| 编号 | 场景 | 步骤 | 预期 | 通过 |
| --- | --- | --- | --- | --- |
| F-INVITE-01 | 微信分享邀请 | A 点击「邀请被告」(openType=share) | 分享卡片标题为「邀请你出庭：{案由}」，path 携带 `case`、`role=defendant`、`inviteCode` | ☐ |
| F-INVITE-02 | 复制路径 | A 点击「复制路径」 | 剪贴板内容为 `/pages/index/index?case=...&role=defendant&inviteCode=...` | ☐ |
| F-INVITE-03 | 被告加入 | B 通过分享卡片打开 | `POST /api/cases/:id/join` 成功，B 绑定 defendant 角色；inviteToken 标记 usedAt | ☐ |
| F-INVITE-04 | 邀请码失效 | B 再次用同一 inviteCode 加入 | 返回 403「邀请码无效、已失效或已过期」 | ☐ |
| F-INVITE-05 | 邀请码过期 | 7 天后用同一 inviteCode | 返回 403 | ☐ |
| F-INVITE-06 | 角色占用 | C 尝试作为 defendant 加入已有被告的案件 | 返回 409「该身份已被占用」 | ☐ |
| F-INVITE-07 | 无邀请码加入 | C 不带 inviteCode 直接访问 | 返回 403 | ☐ |

### 1.4 双方陈词

| 编号 | 场景 | 步骤 | 预期 | 通过 |
| --- | --- | --- | --- | --- |
| F-STMT-01 | 原告填写 | A 填写案由/原告昵称/被告昵称/原告陈词 | 字段长度受 `TITLE_MAX_LENGTH=220`、`STATEMENT_MAX_LENGTH=500` 限制 | ☐ |
| F-STMT-02 | 被告填写 | B 切换被告身份填写被告陈词 | 被告字段可编辑，原告字段 disabled | ☐ |
| F-STMT-03 | 同步陈词 | 点击「同步陈词」 | `PATCH /api/cases/:id/statements` 成功，toast「已同步」；caseStatements 写入 version 自增 | ☐ |
| F-STMT-04 | 陈词过短 | 输入 < 8 字后点击「生成裁决」 | toast「陈词至少 8 个字」，不发起请求 | ☐ |
| F-STMT-05 | 必填校验 | 案由/昵称为空时同步 | toast「请填写案由 / 原告昵称 / 被告昵称」 | ☐ |
| F-STMT-06 | AI 追问 | 双方陈词齐后点击「AI追问」 | 生成 `question` 并展示追问卡片，双方可补充回答 | ☐ |
| F-STMT-07 | 并发更新 | A、B 同时 PATCH | 写入串行化（writeChain），后写者不覆盖前写者的非冲突字段；version 单调递增 | ☐ |

### 1.5 裁决生成

| 编号 | 场景 | 步骤 | 预期 | 通过 |
| --- | --- | --- | --- | --- |
| F-VERDICT-01 | 本地规则裁决 | 未配置 DEEPSEEK_API_KEY | provider=`local-rules`，正面显示责任比例、处罚、来源标识；背面显示 reasoning 3 步 | ☐ |
| F-VERDICT-02 | AI 裁决 | 已配置 DEEPSEEK_API_KEY | provider=`deepseek`，model 字段持久化；裁决书正面标注「本裁决由 {model} AI模型生成」 | ☐ |
| F-VERDICT-03 | AI 失败回退 | DeepSeek 接口 500 | 回退 provider=`local-rules-fallback`，UI 不报错 | ☐ |
| F-VERDICT-04 | 责任比例合法 | 任意裁决 | plaintiff + defendant = 100，单方 ∈ [15, 85] | ☐ |
| F-VERDICT-05 | indices 范围 | 任意裁决 | hardMouth/grievance/coaxDifficulty/oldScoreRisk ∈ [0, 100] 整数 | ☐ |
| F-VERDICT-06 | 翻面交互 | 点击「查看裁决理由」 | 卡片翻转，显示事实认定、推理步骤、适用规则、和解建议；可返回正面 | ☐ |
| F-VERDICT-07 | 重复宣判 | 已有裁决后再次点击「生成裁决」 | 复用 latestVerdictId，不重复消耗 AI 调用 | ☐ |
| F-VERDICT-08 | 裁决持久化 | 切换设备/重新登录后打开案件 | verdict 字段从远程恢复，含 provider/model/reasoning | ☐ |

### 1.6 历史案卷

| 编号 | 场景 | 步骤 | 预期 | 通过 |
| --- | --- | --- | --- | --- |
| F-HIST-01 | 列表加载 | 进入「案卷」tab | `GET /api/me/cases` 返回当前用户可见案件，按 updatedAt 倒序 | ☐ |
| F-HIST-02 | 分页 | 案件 > 10 条 | 显示「加载下一页」按钮，page 累加 | ☐ |
| F-HIST-03 | 空状态 | 新用户无案件 | 显示「暂无案卷」空态卡片，引导去创建 | ☐ |
| F-HIST-04 | 权限隔离 | C 打开 A 的案件 ID | 返回 403「无权访问该案件」 | ☐ |
| F-HIST-05 | 软删除后不可见 | A 删除案件 | 列表不再显示该案件（deletedAt 过滤） | ☐ |
| F-HIST-06 | 归档 | A 点击「归档」 | archivedAt 写入；列表仍可见（按当前实现），可在庭审页恢复 | ☐ |
| F-HIST-07 | 恢复 | A 点击「恢复」 | archivedAt/deletedAt 清空 | ☐ |
| F-HIST-08 | 彻底删除 | A 点击「彻底删除」并确认 | `POST /api/cases/:id/purge` 物理删除案件及关联 participants/statements/verdicts/tokens | ☐ |
| F-HIST-09 | 下拉刷新 | 案卷页下拉 | 触发 `usePullDownRefresh`，重新加载第 1 页 | ☐ |

### 1.7 分享

| 编号 | 场景 | 步骤 | 预期 | 通过 |
| --- | --- | --- | --- | --- |
| F-SHARE-01 | 进入分享页 | 生成裁决后切到「分享」tab | 加载当前案件，显示裁决书卡片 | ☐ |
| F-SHARE-02 | 复制裁决文字 | 点击「复制裁决文字」 | 剪贴板含案号、案由、责任比例、判决结果、来源标识 | ☐ |
| F-SHARE-03 | 生成海报 | 点击「生成裁决海报」 | `GET /api/cases/:id/share-image` 返回 PNG，前端 `previewImage` 预览 | ☐ |
| F-SHARE-04 | 海报缓存 | 同一案件二次生成 | 命中 poster-cache（sha1 key），不重复生成 | ☐ |
| F-SHARE-05 | 保存相册 | 点击「保存到相册」 | 首次请求 `scope.writePhotosAlbum` 权限；成功后 toast「已保存到相册」 | ☐ |
| F-SHARE-06 | 相册权限拒绝 | 设置中关闭相册权限 | toast「请在设置中开启相册权限」 | ☐ |
| F-SHARE-07 | 转发 | 点击「转发给对方」(openType=share) | 微信分享卡片标题为「裁决书：{案由}」 | ☐ |
| F-SHARE-08 | 本地案件海报 | local- 案件点击生成海报 | toast「本地案件暂不支持海报，请连接后端」 | ☐ |
| F-SHARE-09 | 未裁决分享 | 案件未生成裁决进入分享页 | 显示「暂无可分享裁决」空态 | ☐ |

### 1.8 隐私与删除

| 编号 | 场景 | 步骤 | 预期 | 通过 |
| --- | --- | --- | --- | --- |
| F-PRIV-01 | 隐私页可达 | 庭审页点击「隐私与协议」 | 进入 `/pages/legal/index`，展示隐私政策、用户协议、AI 内容说明、删除入口 | ☐ |
| F-PRIV-02 | 删除我的数据 | 点击「删除我的数据」并确认 | `DELETE /api/me/data` 软删除当前用户全部可见案件，toast「已删除 N 条数据」 | ☐ |
| F-PRIV-03 | 删除后案卷 | 删除后切到案卷 | 列表为空或仅剩他人案件 | ☐ |
| F-PRIV-04 | 单案件删除 | 庭审页点击「删除」并确认 | 软删除，案卷不可见，可恢复 | ☐ |
| F-PRIV-05 | 单案件彻底删除 | 庭审页点击「彻底删除」并确认 | 物理删除，不可恢复 | ☐ |
| F-PRIV-06 | 非创建者彻底删除 | B（被告）尝试彻底删除 A 创建的案件 | 返回 403「无权删除该案件」 | ☐ |

### 1.9 错误态

| 编号 | 场景 | 步骤 | 预期 | 通过 |
| --- | --- | --- | --- | --- |
| F-ERR-01 | 创建失败 | 后端不可达 | 显示错误卡片「创建失败，请确认网络或后端服务」+ 重试按钮 | ☐ |
| F-ERR-02 | 加载失败 | 案件加载接口 500 | toast「案件加载失败」+ 错误卡片 + 重试 | ☐ |
| F-ERR-03 | 案件不存在 | 访问已 purge 的 caseId | 返回 404「案件不存在或已被清空」 | ☐ |
| F-ERR-04 | 无权限 | C 访问 A 的案件 | 返回 403，不泄露案件内容 | ☐ |
| F-ERR-05 | 同步失败 | PATCH 接口 500 | toast「同步失败，请稍后重试」 | ☐ |
| F-ERR-06 | 宣判失败 | verdict 接口 500 | toast「宣判失败，请稍后重试」 | ☐ |
| F-ERR-07 | 海报生成失败 | share-image 接口 500 | toast「海报生成失败，请稍后重试」 | ☐ |
| F-ERR-08 | 弱网提示 | 切换到 2g/3g 网络 | 顶部显示「网络不稳定，操作可能失败，请耐心等待」 | ☐ |
| F-ERR-09 | 断网 | 关闭网络后操作 | fallback 到本地兜底，不白屏 | ☐ |

### 1.10 限流

| 编号 | 场景 | 步骤 | 预期 | 通过 |
| --- | --- | --- | --- | --- |
| F-RATE-01 | 正常限流 | 1 分钟内请求 ≤ 120 次 | 全部正常返回 | ☐ |
| F-RATE-02 | 超限 | 1 分钟内请求 > 120 次 | 返回 429「请求过于频繁，请稍后再试」 | ☐ |
| F-RATE-03 | 限流桶清理 | 等待 5 分钟 | 过期桶被自动清理，内存不泄漏 | ☐ |
| F-RATE-04 | 按 client-id 隔离 | A、B 同时高频请求 | 各自独立计数，互不影响 | ☐ |

### 1.11 敏感内容拦截

| 编号 | 场景 | 步骤 | 预期 | 通过 |
| --- | --- | --- | --- | --- |
| F-MOD-01 | 陈词含危机词 | 输入「自杀/自残/想死」 | 同步时返回 400「内容包含敏感词，已被拦截…」 | ☐ |
| F-MOD-02 | 陈词含违法词 | 输入「赌博/毒品/枪支」 | 返回 400 | ☐ |
| F-MOD-03 | 陈词含医疗词 | 输入「诊断/用药/处方」 | 返回 400 | ☐ |
| F-MOD-04 | 陈词含投资词 | 输入「股票/基金/理财」 | 返回 400 | ☐ |
| F-MOD-05 | 陈词含代码词 | 输入「sql/password/身份证号/银行卡号」 | 返回 400 | ☐ |
| F-MOD-06 | 宣判时拦截 | 绕过同步直接宣判（含敏感词） | `validateCase` 在宣判前再次拦截 | ☐ |
| F-MOD-07 | AI 拒绝处理 | AI prompt 已限制不处理危机/法律/医疗 | AI 返回娱乐裁决或回退本地规则 | ☐ |

---

## 2. 兼容性测试（Compatibility Test）

### 2.1 微信版本

| 微信版本 | 测试范围 | 通过 |
| --- | --- | --- |
| 微信 8.0.x（iOS 最新） | 全流程 | ☐ |
| 微信 8.0.x（Android 最新） | 全流程 | ☐ |
| 微信 7.0.x（iOS 旧版） | 全流程 | ☐ |
| 微信 7.0.x（Android 旧版） | 全流程 | ☐ |
| 微信 PC 版 | 主要流程（分享/海报可能受限） | ☐ |

### 2.2 设备机型

| 机型 | 系统 | 关注点 | 通过 |
| --- | --- | --- | --- |
| iPhone 15 Pro | iOS 17 | 高分辨率渲染、安全区 | ☐ |
| iPhone SE 2 | iOS 15 | 小屏布局、键盘遮挡 | ☐ |
| iPhone 6s | iOS 15 | 低端机性能、内存 | ☐ |
| 华为 Mate 60 | HarmonyOS 4 | 全面屏适配、返回键 | ☐ |
| 小米 14 | Android 14 | 字体缩放、深色模式 | ☐ |
| 红米 9A | Android 10 | 低端机加载、弱网 | ☐ |
| iPad | iPadOS 17 | 横屏布局（可选） | ☐ |

### 2.3 系统特性

| 编号 | 场景 | 预期 | 通过 |
| --- | --- | --- | --- |
| C-SYS-01 | 深色模式 | 文字可读，不出现黑底黑字 | ☐ |
| C-SYS-02 | 字体放大（最大） | 不溢出、不截断关键信息 | ☐ |
| C-SYS-03 | 横屏 | 主要页面可用（庭审页可接受竖屏锁定） | ☐ |
| C-SYS-04 | 系统返回键（Android） | 不出现白屏或栈错乱 | ☐ |
| C-SYS-05 | 后台切前台 | `useDidShow` 重新加载案件/案卷 | ☐ |
| C-SYS-06 | 杀进程后重启 | 登录态恢复，currentCaseId 恢复 | ☐ |
| C-SYS-07 | 剪贴板权限 | 复制邀请路径/裁决文字正常 | ☐ |
| C-SYS-08 | 相册权限 | 保存海报正常，拒绝后引导 | ☐ |

### 2.4 网络环境

| 编号 | 场景 | 预期 | 通过 |
| --- | --- | --- | --- |
| C-NET-01 | WiFi | 全流程顺畅 | ☐ |
| C-NET-02 | 4G | 全流程可用 | ☐ |
| C-NET-03 | 3G/2G | 弱网提示显示，操作可完成（允许慢） | ☐ |
| C-NET-04 | 弱网（Charles 限速 100kb/s） | 请求不丢失，超时有提示 | ☐ |
| C-NET-05 | 断网 | 本地兜底可用，不白屏 | ☐ |
| C-NET-06 | 网络抖动 | 重试机制生效 | ☐ |

---

## 3. 性能测试（Performance Test）

### 3.1 前端性能

| 编号 | 指标 | 目标 | 测量方式 | 通过 |
| --- | --- | --- | --- | --- |
| P-FE-01 | 首屏加载（庭审页） | ≤ 2s（WiFi）/ ≤ 4s（4G） | 微信开发者工具 Performance 面板 | ☐ |
| P-FE-02 | 案卷列表加载 | ≤ 1.5s | 真机计时 | ☐ |
| P-FE-03 | 裁决生成（本地） | ≤ 1s | 真机计时 | ☐ |
| P-FE-04 | 裁决生成（AI） | ≤ 8s | 真机计时，loading 态可见 | ☐ |
| P-FE-05 | 海报生成（首次） | ≤ 5s | 真机计时 | ☐ |
| P-FE-06 | 海报生成（缓存命中） | ≤ 500ms | 真机计时 | ☐ |
| P-FE-07 | 卡片翻转动画 | ≥ 30fps | 开发者工具 FPS | ☐ |
| P-FE-08 | 主包体积 | ≤ 2MB（主包限制） | `npm run build:weapp:prod` 后查看 dist 体积 | ☐ |
| P-FE-09 | 分包（如启用） | 单包 ≤ 2MB，总包 ≤ 20MB | 构建产物检查 | ☐ |
| P-FE-10 | 内存占用 | 长时间使用不超 200MB | 开发者工具 Memory | ☐ |

### 3.2 后端性能

| 编号 | 指标 | 目标 | 测量方式 | 通过 |
| --- | --- | --- | --- | --- |
| P-BE-01 | `GET /api/me/cases` | P95 ≤ 300ms | 压测 / 真机抓包 | ☐ |
| P-BE-02 | `POST /api/cases` | P95 ≤ 300ms | 压测 | ☐ |
| P-BE-03 | `PATCH /api/cases/:id/statements` | P95 ≤ 400ms | 压测 | ☐ |
| P-BE-04 | `POST /api/cases/:id/verdict`（AI） | P95 ≤ 10s | 真机 | ☐ |
| P-BE-05 | `GET /api/cases/:id/share-image`（首次） | P95 ≤ 3s | 真机 | ☐ |
| P-BE-06 | 并发写入 | 50 并发不串行化错误 | `withStoreWrite` 串行链路验证 | ☐ |
| P-BE-07 | 文件存储大小 | `data/cases.json` ≤ 10MB（单实例） | 监控 | ☐ |
| P-BE-08 | 备份耗时 | 单次备份 ≤ 2s | `scripts/backup.js` 计时 | ☐ |

### 3.3 压力测试

| 编号 | 场景 | 目标 | 工具 | 通过 |
| --- | --- | --- | --- | --- |
| P-LOAD-01 | 100 并发创建案件 | 0 错误，caseNumber 不重复 | autocannon / wrk | ☐ |
| P-LOAD-02 | 100 并发陈词更新 | 0 数据丢失，version 单调递增 | autocannon | ☐ |
| P-LOAD-03 | 50 并发 AI 裁决 | DeepSeek 限流不击穿，回退正常 | autocannon | ☐ |
| P-LOAD-04 | 限流验证 | 121 并发请求 → 1 个 429 | 脚本 | ☐ |

### 3.4 性能优化验证

- [ ] 已开启 `minified: true`（project.config.json）
- [ ] 已移除调试依赖（react-refresh 等仅 dev）
- [ ] 图片资源已压缩或使用 CDN
- [ ] `Taro.preload` 已配置关键页面（如案卷）
- [ ] 海报 PNG 已启用 30 天缓存（POSTER_CACHE_TTL_MS）

---

## 4. 安全测试（Security Test）

### 4.1 鉴权与权限

| 编号 | 场景 | 步骤 | 预期 | 通过 |
| --- | --- | --- | --- | --- |
| S-AUTH-01 | 无 token 访问 | 不带 Authorization 调用 `/api/me/cases` | 降级为 anonymous 用户，仅可见 legacy 案件 | ☐ |
| S-AUTH-02 | 伪造 token | 使用随机字符串作为 Bearer | 后端识别为未知 sourceKey，创建新 user，无法访问他人案件 | ☐ |
| S-AUTH-03 | 越权访问案件 | C 用 A 的 caseId 调用 `/api/cases/:id` | 返回 403 | ☐ |
| S-AUTH-04 | 越权更新陈词 | C 调用 `/api/cases/:id/statements` | `requireParticipant` 返回 403 | ☐ |
| S-AUTH-05 | 越权宣判 | C 调用 `/api/cases/:id/verdict` | 返回 403 | ☐ |
| S-AUTH-06 | 越权删除 | B 尝试 purge A 的案件 | 返回 403 | ☐ |
| S-AUTH-07 | 邀请码枚举 | 暴力枚举 6 位 inviteCode | 限流拦截（429）；token 一次性使用 | ☐ |

### 4.2 输入校验与注入

| 编号 | 场景 | 步骤 | 预期 | 通过 |
| --- | --- | --- | --- | --- |
| S-INJ-01 | SQL 注入（未来 DB） | 陈词输入 `' OR 1=1 --` | 当前文件存储无影响；迁移 DB 后需参数化查询 | ☐ |
| S-INJ-02 | XSS | 陈词输入 `<script>alert(1)</script>` | 前端 Text 组件不执行；SVG 海报经 `escapeSvg` 转义 | ☐ |
| S-INJ-03 | 超长输入 | 输入 10000 字陈词 | `sanitizeCasePatch` 截断至 500 字 | ☐ |
| S-INJ-04 | 特殊字符 | 输入 emoji、繁体、日文 | 正常存储与展示 | ☐ |
| S-INJ-05 | JSON 篡改 | PATCH body 含额外字段 | `sanitizeCasePatch` 白名单过滤，仅保留 7 个字段 | ☐ |
| S-INJ-06 | 路径穿越 | 静态请求 `/../../etc/passwd` | `serveStatic` 校验 `filePath.startsWith(ROOT)`，返回 403 | ☐ |

### 4.3 敏感数据保护

| 编号 | 场景 | 步骤 | 预期 | 通过 |
| --- | --- | --- | --- | --- |
| S-DATA-01 | 日志脱敏 | 触发 `safeWarn` 输出含 token/手机号 | `desensitizeLog` 屏蔽为 `***` | ☐ |
| S-DATA-02 | Authorization 脱敏 | 日志含 `Bearer xxx` | 替换为 `Bearer ***` | ☐ |
| S-DATA-03 | client-id 脱敏 | 日志含 `X-Love-Court-Client-Id: xxx` | 替换为 `***` | ☐ |
| S-DATA-04 | 身份证号脱敏 | 日志含 18 位身份证 | 替换为 `********` | ☐ |
| S-DATA-05 | 银行卡号脱敏 | 日志含 16-19 位数字 | 替换为 `********` | ☐ |
| S-DATA-06 | 手机号脱敏 | 日志含 11 位手机号 | 替换为 `13****8888` 格式 | ☐ |
| S-DATA-07 | 邮箱脱敏 | 日志含 email | 替换为 `***@***` | ☐ |
| S-DATA-08 | storage 不存敏感信息 | 检查 storage | 仅存 token/clientId/session，无明文敏感字段 | ☐ |

### 4.4 传输与协议

| 编号 | 场景 | 预期 | 通过 |
| --- | --- | --- | --- |
| S-TLS-01 | 生产 HTTPS | `TARO_APP_API_BASE` 以 `https://` 开头 | ☐ |
| S-TLS-02 | 合法域名 | 已在小程序后台配置 request 合法域名 | ☐ |
| S-TLS-03 | 证书有效性 | SSL Labs 评级 ≥ A | ☐ |
| S-TLS-04 | HSTS | 后端响应含 `Strict-Transport-Security`（建议） | ☐ |
| S-TLS-05 | 拒绝 HTTP | 小程序 `urlCheck: true` 拒绝 http 请求 | ☐ |

### 4.5 限流与防滥用

| 编号 | 场景 | 预期 | 通过 |
| --- | --- | --- | --- |
| S-ABUSE-01 | 单用户高频 | 1 分钟 > 120 次 → 429 | ☐ |
| S-ABUSE-02 | IP 高频 | 按 IP 维度限流 | ☐ |
| S-ABUSE-03 | AI 调用滥用 | 短时间内多次宣判 → 复用 latestVerdictId，不重复调用 DeepSeek | ☐ |
| S-ABUSE-04 | 邀请码暴力 | 限流 + token 一次性 + 7 天过期 | ☐ |

### 4.6 数据删除与合规

| 编号 | 场景 | 预期 | 通过 |
| --- | --- | --- | --- |
| S-DEL-01 | 软删除可恢复 | deletedAt 写入，案卷不可见，恢复按钮可用 | ☐ |
| S-DEL-02 | 彻底删除不可恢复 | purge 物理删除关联数据 | ☐ |
| S-DEL-03 | 删除我的数据 | `DELETE /api/me/data` 软删除当前用户全部可见案件 | ☐ |
| S-DEL-04 | 删除入口可达 | 隐私页提供删除入口（合规要求） | ☐ |
| S-DEL-05 | 删除前确认 | 二次确认弹窗 | ☐ |
| S-DEL-06 | 隐私政策可达 | 隐私页展示隐私政策、用户协议、AI 内容说明 | ☐ |

### 4.7 备份与灾备

| 编号 | 场景 | 预期 | 通过 |
| --- | --- | --- | --- |
| S-BAK-01 | 自动备份 | 写入后节流备份至 `data/backups/` | ☐ |
| S-BAK-02 | 备份保留 | 默认 14 份，超出裁剪 | ☐ |
| S-BAK-03 | 恢复前快照 | 恢复时生成 `cases-pre-restore-*.json` | ☐ |
| S-BAK-04 | 灾备演练 | `node scripts/drill.js` 通过 | ☐ |
| S-BAK-05 | RPO ≤ 1h | cron 每小时备份 | ☐ |
| S-BAK-06 | RTO ≤ 10min | `restore.js --latest` + 重启 | ☐ |

---

## 5. 测试执行记录模板

| 轮次 | 日期 | 执行人 | 范围 | 用例数 | 通过 | 失败 | 阻塞 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | YYYY-MM-DD | | 全量 | | | | | |
| R2 | YYYY-MM-DD | | 回归 | | | | | |
| R3 | YYYY-MM-DD | | 上线前 | | | | | |

## 6. 缺陷分级

| 等级 | 定义 | 处理时限 |
| --- | --- | --- |
| P0 阻断 | 核心流程不可用（登录/创建/宣判/分享） | 上线前必须修复 |
| P1 严重 | 主要功能异常或数据错误 | 上线前必须修复 |
| P2 一般 | 次要功能异常、体验问题 | 上线后 1 周内修复 |
| P3 轻微 | 文案、样式小问题 | 排期修复 |

## 7. 测试通过标准

- P0/P1 缺陷数 = 0
- P2 缺陷数 ≤ 5 且均有规避方案
- 功能测试通过率 ≥ 95%
- 兼容性测试覆盖至少 4 款机型 + 2 个微信版本
- 性能指标全部达标
- 安全测试无高危项
- 灾备演练通过
