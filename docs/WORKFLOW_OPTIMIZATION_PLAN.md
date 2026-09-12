# 同步与 Pages 发布流程优化审计计划

## 审计范围与基线

本阶段仅审计现有实现，不修改同步、发布或安全策略。检查对象为：

- `.github/workflows/sync-source.yml`
- `.github/workflows/pages.yml`
- `scripts/cloud-state.mjs`
- `scripts/archive-sync.mjs`
- `scripts/archive-publication.mjs`
- `tests/` 中与同步、检查点、发布和部署记录相关的测试
- `docs/DEVELOPMENT.md`

当前流程是“检出私有源仓库 → 校验并导出 → 恢复私有检查点 → 同步正式内容 → 校验站点 → 提交 `content/briefings` → 手动 dispatch Pages → 线上核验”。正式内容和检查点均采用锁、批次文件和哈希校验保护；私有状态仓库使用 Contents API 的 SHA compare-and-swap。`pages.yml` 的构建矩阵为 Node 22、`lts/*` 和 `node`，只有 LTS 上传 Pages artifact 并运行浏览器回归。

仓库基线状态干净，未发现已存在的本计划文件。现有自动化测试覆盖本地同步、修订审阅、批次恢复、云端状态 CAS、发布阶段重试和线上校验；没有 workflow YAML/Pages 集成契约测试。`docs/DEVELOPMENT.md` 已记录当前运行方式与限制，并明确本地检查不能替代真实定时同步或远程部署验收。

## 现状证据与问题定位

### P0：同步完成后 Pages 触发与状态闭环不完整

1. `sync-source.yml` 只提交 `content/briefings`，随后依赖 `gh workflow run pages.yml` 手动 dispatch。由于提交使用 `GITHUB_TOKEN`，不会递归触发其他 workflow；当前兜底逻辑是必要的，但没有对 dispatch 是否创建了目标提交的运行实例、运行结果或重试次数形成可验证契约。
2. 同步步骤在退出码为 `2`（待审阅）时立即退出，读取 `last-run.json` 和写入 step output 的代码不会执行。因此 pending、unchanged、失败主要只能从日志推断，后续步骤无法稳定区分“待人工审阅”“无变化”和“可重试发布”。
3. Pages workflow 只运行 `verify:online`，没有调用 `archive:publication --deployed`、`--verify` 或带私有 token 的 `state:save`。`publication.builtVersion`、`deployedVersion`、`verifiedVersion`、`failedStage` 和部署回执不会完整写回私有检查点；Pages 失败时下一次同步看不到失败阶段，自动重试条件可能失效。
4. dispatch 条件使用 `status != unchanged`。`archive-sync` 的 `reconciled` 可以只更新状态或别名映射而不改变公开归档版本，却会触发不必要的 Pages 发布；应以可发布内容版本或明确的失败恢复需求为准。

### P0：检查点与公开内容不一致时缺少可操作的恢复路径

`cloud-state.mjs` 的 `restoreCheckpoint` 会先完整验证快照，再拒绝任何既不是检查点哈希、Git 基线哈希、也不是历史哈希的本地内容，错误为 `CLOUD_CHECKPOINT_CONTENT_CONFLICT`。这符合 fail-closed 安全策略，但当前 workflow 将恢复设为 `continue-on-error` 后直接阻塞同步；没有私有冲突摘要、人工选择入口、冲突处理后的重新校验步骤，也没有验证“冲突时不写内容、不保存新检查点、不 dispatch Pages”的端到端测试。结果是人工只能从日志和被忽略的工作目录推断差异。

### P1：审阅证据不便查看且可能覆盖

`archive-sync.mjs` 将完整 before/after 差异写入被忽略的 `work/archive-sync/review-YYYY-MM-DD.json`，`last-run.json` 只保留日期、错误码和哈希消息键。相同日期的后续审阅会覆盖旧文件；没有稳定的运行标识、文件大小上限、脱敏检查、Markdown 摘要或用户可见的受限 artifact。现有测试只断言 `REVISION_REVIEW_REQUIRED` 等错误，不检查审阅文件结构、可读性和隐私边界。

### P1：Pages 测试矩阵可能把偶发兼容性问题变成发布阻断

Node 22、最新 LTS 和最新 Current 都执行测试、typecheck、lint、build 和产物校验，任一版本失败都会阻止 deploy；Current 和 Playwright/网络环境变化可能造成偶发失败。LTS 同时承担唯一 artifact 和 E2E gate，矩阵没有失败隔离、重试、artifact 复用或“诊断版本非阻断”的契约测试。当前测试套件无法模拟这些 workflow 层面的波动。

### P1：检查点文件和发布状态的持久化一致性不足

`saveState` 依次写入 `checkpoint.json` 和 `state.json`；进程若在两次原子替换之间终止，两个文件可能短暂分叉。云端保存成功后再写 `cloud-session.json` 也存在窗口。`validateCheckpoint` 对 records、contents、pending 和 publication 的关联约束不完整，历史和资源没有大小/保留上限，长期修订可能触及 Contents API 文件限制。它们目前有单元测试覆盖主要错误码，但没有启动时双文件一致性检查和损坏恢复契约。

### P2：线上核验和可观测性仍以日志为主

`verifyOnline` 已限制 HTTPS、禁止凭据 URL、检查 manifest、完整性文件、搜索索引和最新一期页面，并对临时错误最多重试三次。但 manifest 的 schema 版本和完整性对象比较仍可加强，旧页面也不会被抽样或全量核验。workflow 没有统一输出 commit、archive version、deployment receipt、stage、failure code 和重试结果，排障需要拼接多份日志。

## 按优先级排列的优化方案

### P0-A：定义并测试 workflow 触发契约

先固定“内容提交不依赖递归 push 触发”的模型：同步 workflow 在成功提交后显式 dispatch Pages，并传入提交 SHA；若归档版本未变化但存在已记录的发布失败，才允许重试。dispatch 后记录 run id、目标 SHA 和最终结论；重复运行使用幂等检查，避免同一提交并发发布。为两个 YAML 增加契约/集成测试，至少验证触发器、permissions、concurrency、job `needs`/`if`、提交 SHA 传递、repository dispatch/manual dispatch 路径和 GITHUB_TOKEN 不递归触发时的兜底行为，并在 CI 中加入 `actionlint` 或等价 YAML/schema 检查。

依赖：先确定 Pages dispatch 的唯一入口和重试语义，再实现状态回写（P0-B）。风险是错误的去重条件可能漏掉必要重试；回滚时恢复当前的手动 dispatch 条件和 `pages` concurrency 即可。

### P0-B：建立 Pages 状态回写协议

定义私有检查点中的发布字段契约：`commit`、`archiveVersion`、`stage`（build/deploy/verify）、`deployment.id`、HTTPS `deployment.url`、`verifiedAt`、`failedStage` 和稳定 `failureCode`。部署成功、线上核验成功以及 build/deploy/verify 任一失败都写入同一私有状态仓库，并使用现有 SHA CAS；回写失败必须保留主阶段错误、禁止清理旧部署并让 job 明确失败。回写前核对 workflow checkout SHA 与 archive version，防止把其他提交的回执写入当前检查点。

依赖：P0-A 的触发和提交 SHA 契约、现有 `cloud-state` token/分支权限。风险是私有 token 权限或 CAS 冲突导致状态落后；回滚方式是停用回写 job，保留已部署站点和旧检查点，人工按 `archive:publication` 命令恢复阶段。

### P0-C：把检查点冲突变成可恢复的人工检查点

保持 `CLOUD_CHECKPOINT_CONTENT_CONFLICT` 的拒绝写入行为。恢复失败时生成只含日期、当前/检查点哈希、允许的基线/历史候选和下一步命令的私有摘要，上传到短期受限 artifact 和 job summary；不得上传正文或 token。增加端到端测试，证明冲突时 `content/briefings`、私有状态和 Pages dispatch 均不发生写入。人工修复后重新运行 restore，并在同步前再次执行完整校验。

依赖：P0-A 的 workflow 状态输出和 P1 审阅摘要通道。风险是摘要泄露内容指纹或误导人工选择；采用哈希和日期、短保留期，回滚时删除摘要步骤即可，不改变 fail-closed restore。

### P1-A：提供可读、可追踪的修订审阅材料

保留私有 JSON 作为机器记录，同时生成按 run/日期命名的 Markdown 摘要，包含变更标题、故事 ID、前后版本和审阅命令；在 `last-run.json` 写入相对路径、摘要大小、schema 版本和稳定 run id。对正文、URL、资源元数据做脱敏和大小限制，历史文件按保留期清理，避免同日期覆盖。补充 JSON schema、脱敏、上限和覆盖策略测试。公开仓库和 Pages artifact 不应包含这些文件。

依赖：P0-C 的私有 artifact 通道。风险是审阅文件积累或差异过大；设置硬上限和清理失败即告警，回滚时仅停用 Markdown 摘要生成，保留原 JSON。

### P1-B：重构 Pages 矩阵的阻断边界

建议让单一稳定 LTS job 负责 required build、E2E、artifact 和 deploy；Node 22 与 Current 保留相同核心检查作为兼容性诊断，可配置为非阻断并上传日志/artifact，或在短期网络/版本波动时有限重试。若项目政策要求所有版本阻断，应先增加可重复的失败重试和依赖缓存，再启用 branch protection。增加矩阵失败、artifact 复用和仅诊断失败不阻断部署的 workflow 测试，并在文档中明确门禁。

依赖：仓库 branch protection、Pages environment 规则和 P0-A 的发布契约。风险是放宽 Current 门禁会延迟发现兼容性回归；回滚是恢复三版本全部 required，并保留诊断日志用于定位。

### P1-C：强化检查点 schema 与持久化一致性

要求 `state.records` 与 `contents` 日期集合一致，校验 pending/publication/resourceHash/converterVersion 的类型和引用关系；启动时检测 `checkpoint.json` 与 `state.json` 分叉，优先使用带完整校验的副本并停止自动同步。为历史/资源设置保留策略和大小阈值，接近 Contents API 限制时给出稳定错误码。将双文件写入改为单一权威文件或带版本标记的可恢复提交协议，确保 session 写入失败可重试。

依赖：现有 `cloud-state` schema 版本和恢复测试。风险是严格 schema 拒绝旧检查点；先提供只读迁移/备份和版本化回滚，失败时恢复上一份私有检查点。

### P2-A：统一状态输出与线上核验覆盖

所有同步和 Pages job 输出结构化字段：source commit、export hash、archive version、status、pending code、review path、stage、failure code、deployment id/url 和 retry count。增强 `verifyOnline` 的 manifest schema、稳定对象比较和旧页面抽样策略；对 5xx、缓存陈旧和权限错误分别记录可行动结论。补充网络模拟测试，但不把不可控远程服务当作唯一 gate。

依赖：P0-B 的状态字段协议。风险是日志字段变化影响外部脚本；先兼容现有文本摘要，再逐步切换消费者，回滚时保留旧字段。

## 依赖关系与建议顺序

```text
P0-A 触发契约 ─┬─> P0-B Pages 状态回写 ─┬─> P2-A 统一观测
                └─> P0-C 冲突恢复       └─> P1-B 矩阵门禁调整
P1-A 审阅材料 <──── P0-C 私有摘要通道
P1-C schema/持久化 ─────> P0-B CAS 回写稳定性
```

实施顺序应为：先写契约和失败场景测试（P0-A、P0-C），再实现状态回写（P0-B），随后处理审阅材料、矩阵门禁和检查点 schema（P1），最后补齐可观测性和线上核验增强（P2）。每一步都应保持人工审阅、fail-closed 冲突处理、私有状态仓库和 Pages 清理前的线上核验。

## 总体风险与回滚原则

- **安全边界回归**：任何自动覆盖冲突内容、自动接受修订或把私有正文上传到公开 artifact 的方案都不可接受。回滚以恢复旧 workflow/job 和旧检查点为准，保留站点当前版本。
- **状态错误绑定**：错误的 commit/version 绑定会把失败或旧回执写入新检查点。所有回写必须先校验 SHA、archive version 和 CAS；发现冲突时停止并人工重试。
- **发布可用性**：矩阵门禁放宽或回写失败可能改变发布节奏。保留 LTS required artifact、`verify-online` 和部署记录清理前置条件，必要时恢复全矩阵 required。
- **外部 API 与网络波动**：GitHub Contents、Actions、Pages 和站点访问都可能暂时失败。重试只适用于明确的临时错误；权限、版本不匹配和内容冲突必须立即停止。
- **数据保留**：审阅 JSON、状态历史和 artifact 需设置大小及保留期，且继续由 `.gitignore` 排除；提交前检查 `git status`、敏感字段和生成目录，禁止纳入密钥、令牌、私有正文、缓存或大型产物。

本阶段交付物仅为本审计计划文档；未修改 workflow、脚本、测试或业务内容。

## 本阶段验证

已运行并通过：`npm test`（113/113）、`npm run typecheck`、`npm run lint`、`npm run build`、`npm run verify:build`、`npm run format -- --check docs/WORKFLOW_OPTIMIZATION_PLAN.md`、`git diff --check`。构建与内容校验产生的目录仍由现有忽略规则排除，未纳入提交。
