# 开发与发布

## 环境与启动

需要 Node.js 22.18 或更高版本及 npm，推荐最新 LTS。使用锁文件安装依赖：

```powershell
npm ci
npm run dev
```

开发启动前会生成内容索引。静态构建和本地预览：

```powershell
npm run build
npm run verify:build
npm start
```

静态产物位于 `dist/client/`。运行时没有数据库或模型生成 API；简报正文来自已保存的内容文件。

## 目录与生成文件

| 路径                                              | 用途                                         |
| ------------------------------------------------- | -------------------------------------------- |
| `app/`、`components/`、`lib/`                     | 页面、交互组件与共用逻辑                     |
| `content/briefings/`                              | 按日期保存、纳入版本控制的正式内容           |
| `public/`                                         | 静态资源；生成的搜索索引和版本清单已忽略     |
| `scripts/`、`config/`                             | 内容转换、构建、发布检查及通用配置           |
| `tests/`                                          | 单元测试、浏览器回归和独立测试夹具           |
| `docs/`                                           | 长期指南；`docs/local/` 存放被忽略的内部材料 |
| `incoming/`、`work/`                              | 私有输入、来源回执、差异和可恢复的同步状态   |
| `generated/`、`dist/`、`test-output/`、`outputs/` | 索引、构建、测试及打包产物，均不提交         |

构建缓存可重新生成；`work/` 中的来源映射和检查点用于恢复，不能当作普通缓存一起删除。

## 检查与测试

功能或内容变更使用现有检查：

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run verify:build
```

线上发布完成后，可用部署步骤输出的 Pages 地址核对公开版本与最近一期页面：

```powershell
npm run verify:online -- 'https://example.org/briefing-atlas/'
```

该命令从当前 `content/briefings/` 计算归档版本，读取站点公开的
`archive-manifest.json` 和最新一期页面；地址必须是 HTTPS，不能带登录信息。
网络暂时失败会有限重试，版本、页面或访问权限异常会以非零状态退出。CI 发布应将
该检查作为部署后的必需步骤，核对失败时保留已部署站点并暂停后续清理。

浏览器测试使用静态构建，首次运行需安装 Chromium；测试自动启动预览服务：

```powershell
npx playwright install chromium
npm run test:e2e
```

| 范围                           | 测试入口                                                                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 导入、修订、锁、恢复与发布状态 | [archive.test.mjs](../tests/archive.test.mjs)                                                                                                                           |
| 内容、日期与渲染               | [domain.test.mjs](../tests/domain.test.mjs)                                                                                                                             |
| 图片与引用、图库数据           | [resources.test.mjs](../tests/resources.test.mjs)、[gallery.spec.mjs](../tests/browser/gallery.spec.mjs)                                                                |
| 搜索语法、权重、链接状态与筛选 | [search.test.mjs](../tests/search.test.mjs)、[search.spec.mjs](../tests/browser/search.spec.mjs)                                                                        |
| 阅读设置与备份兼容             | [reader.test.mjs](../tests/reader.test.mjs)、[reader.spec.mjs](../tests/browser/reader.spec.mjs)                                                                        |
| 看板娘动作、点击与导航         | [companion.test.mjs](../tests/companion.test.mjs)、[companion-hit.test.mjs](../tests/companion-hit.test.mjs)、[companion.spec.mjs](../tests/browser/companion.spec.mjs) |
| 部署历史清理                   | [deployments.test.mjs](../tests/deployments.test.mjs)                                                                                                                   |

浏览器测试包含桌面和手机场景；真实模型测试需要访问 Live2D 官方 Cubism Core 地址。模拟客户端、逻辑测试和本地浏览器通过，不代表远程部署、真实定时同步或实验性 WebMCP 已通过验收。执行结果保存在本地文档和测试产物中。

仅调整文档时，检查链接、命令与源码的一致性、隐私、Git 跟踪范围和格式即可，无需重复运行完整应用回归。格式检查可指定本次修改的文件：

```powershell
npm run format -- --check README.md docs/README.md docs/CONTENT_GUIDE.md docs/READER.md docs/LIVE2D.md docs/DEVELOPMENT.md
git diff --check
```

## GitHub Pages

### 私有简报自动同步

`.github/workflows/sync-source.yml` 默认每天轮询一次私有源仓库（UTC 03:00，北京时间 11:00），也可手动触发或由源仓库校验成功后的 `repository_dispatch` 触发。同步 job 成功后通过明确的 `needs: sync` 依赖调用 `pages.yml` reusable workflow，并把同步 job 产生的 `publish_commit` 传给 Pages；不会依赖 `github-actions[bot]` push 递归触发。Pages 仍保留 `push`（人工 commit）和 `workflow_dispatch`（可指定 commit）入口。没有新提交但需要重试失败部署时，Summary 会输出 `retry_only=true`，可直接手动 dispatch Pages。手动运行同步时默认执行 `preview`；完成差异审阅后，从 Summary 复制 review ID 与 source commit，使用 workflow dispatch 的 `approve` action 才能接受修订并继续发布。运行前在仓库设置：

- Repository variable `BRIEFING_SOURCE_REPO`：`owner/briefing_source`。
- 可选 variable `BRIEFING_SOURCE_REF`：固定源仓库分支或 commit；默认 `main`。
- Secret `BRIEFING_SOURCE_TOKEN`：仅能读取私有源仓库的 token。
- Secret `BRIEFING_STATE_TOKEN`：可读写私有状态仓库（默认同一源仓库）的 token；首次迁移完整私有状态时可将 variable `BRIEFING_STATE_BOOTSTRAP` 设为 `true` 创建独立的 `atlas-sync-state` 分支，成功后应改回 `false`。Bootstrap 仅用于远端检查点确实不存在且本地保留完整来源回执的初始化，不能修复冲突、覆盖已有检查点或从公开 Markdown 重建回执。
- 可选 variables `BRIEFING_STATE_REPO`、`BRIEFING_STATE_BRANCH`：将检查点放在独立的私有仓库和分支；状态仓库必须保持 private，且分支不能是默认分支。

工作流在临时目录检出源仓库，执行其锁定依赖的测试、校验和 `npm run export`，再调用 `npm run sync:source`。同步器会核对 checkout 的 commit、工作区、日期路径、导出摘要和每日消息，避免消费变化中的分支头。源仓库内容、导出包、来源映射和差异不会加入公开提交；归档检查点通过状态仓库的私有 Contents API 读写，写入冲突会停止运行。无变化时不提交；截断、校验失败、同日冲突或待审阅修订会使本轮暂停，不使用自动接受修订。通过测试、构建和产物校验后仅提交 `content/briefings`，由 `pages.yml` 发布并执行线上版本核验。

源仓库尚未产生正式生产简报时，校验步骤以 `NO_BRIEFINGS` 记录安全暂停并结束本轮，不导出空数据、不覆盖检查点，也不触发网站发布；其他校验错误仍会使工作流失败并等待处理。

### Actions 审阅可见性

每次同步运行都会在 Actions Summary 写入统一状态和下一步操作。状态固定为
`unchanged`（没有需要发布的变化）、`pending`（需要人工审阅）、`conflict`
（检查点或日期冲突）、`failure`（步骤失败）或 `success`（同步检查通过）。
待审阅修订仍需人工核对后，再手动运行同步并提交匹配的 review ID、source commit；批准会重新验证导出内容、检查点版本和 converter 版本。冲突必须先人工恢复，
不会自动覆盖内容。

同步 job 同时输出 `should_publish`、`publish_commit`、`review_required` 和
`retry_only`。待审阅、检查点或日期冲突、同步失败、无生产简报和内容未变化时，
Summary 会写出明确的 `skipped_reason`；Pages job 只有在 `should_publish=true` 时才会
启动，并始终使用该次同步输出的 commit SHA。

同步产生的 `review-*.json` 保留在被忽略的私有工作目录，并由
`scripts/archive-review.mjs` 转换为易读的 `review-report.md`。工作流始终尝试上传
`archive-review-<run_id>` artifact（保留 7 天），即使同步待审阅或失败也会生成状态报告。
报告只使用受限差异摘录，URL、凭据和本地绝对路径会被替换，不进入 Git 提交或 Pages 产物。

在仓库 Settings → Pages 中选择 GitHub Actions。推送到 `master` 会自动运行 `Publish static archive` 工作流，也可以按需手动运行。配置见 [pages.yml](../.github/workflows/pages.yml)。

Pages 发布使用固定的 Node.js `22.18.0` release lane；该 lane 执行完整测试、typecheck、lint、构建、产物校验和必需的浏览器 E2E，并上传唯一的 `dist/client/` artifact。最新 LTS（`lts/*`）和 Current（`node`）作为 compatibility lanes 运行相同的 Node/构建检查，但使用 `continue-on-error` 记录兼容性回归，不阻断 release artifact、部署或线上核验。浏览器 E2E 只属于 release gate；图库测试固定到已审阅的六图 fixture，并在测试路由中拦截外部图片资源，避免 Wikimedia、Sanity 等网络服务造成随机失败。JavaScript Action 自身使用 Node.js 24 运行时，与项目构建版本分别管理。

阶段 6 的运行时间比较以本地 Playwright 全套浏览器回归为基线：优化前为 55 passed、1 skipped、约 2.7 分钟；优化后仍为 55 passed、1 skipped、约 2.7 分钟，说明没有通过删减断言换取速度。发布路径的变化来自并行边界：旧矩阵要等待三条 Node lane 全部结束后才能部署；现在部署只依赖固定版本的 release lane，两个 compatibility lane 与 release 并行且失败只作为诊断结果，因此兼容性版本的波动不再延迟必需发布。每次 Pages 运行仍以 Actions job timestamps 比较实际构建、E2E、部署和线上核验耗时。

构建使用 GitHub 托管的 `ubuntu-24.04` 镜像及其预装 Chromium 系统依赖，通过 `npx playwright install chromium` 下载与项目 Playwright 版本匹配的浏览器，避免额外刷新第三方 APT 源导致发布失败。

构建作业没有部署权限；部署作业使用 `pages: write` 与 `id-token: write`。源码、测试、文档和本地工作数据不进入 Pages 上传目录，构建 artifact 保留 1 天。部署回执写入私有检查点后，`verify-online` 作业会检出同一提交、恢复检查点，再运行 `npm run archive:publication -- --verify` 检查公开清单和最新一期页面；核对与状态保存均成功后才会清理旧部署记录。

### 部署记录清理

部署成功后，独立清理作业使用 `GITHUB_TOKEN` 的 `deployments: write` 权限，分页读取 `github-pages` 环境记录。只有最新记录属于本次提交且状态为 `success`，才将旧记录标为 `inactive` 并删除，保留最新成功部署。其他环境和 Actions 运行历史保留，当前 Pages 站点继续可用。

构建或部署失败不会触发清理；记录不匹配或 API 失败会使清理作业报错。工作流串行部署，防止发布与清理交错。恢复旧版本需要核对该公开 commit 对应的完整私有检查点及部署回执，不能只选择旧 commit 就跳过绑定验证。实现见 [cleanup-pages-deployments.mjs](../scripts/cleanup-pages-deployments.mjs)，删除条件见 [GitHub Deployments API](https://docs.github.com/en/rest/deployments/deployments#delete-a-deployment)。

### 子路径构建

本地使用与部署相同的前缀构建、检查和运行浏览器回归；以下示例假定尚未设置 `NEXT_PUBLIC_BASE_PATH`。已有值时应在结束后恢复原值。

```powershell
$env:NEXT_PUBLIC_BASE_PATH = '/briefing-atlas'
npm run build
npm run verify:build
npm run test:e2e
Remove-Item Env:NEXT_PUBLIC_BASE_PATH
npm run build
npm run verify:build
```

工作流会使用 Pages 配置返回的实际前缀。站内客户端路由使用不含前缀的路径；静态资源和复制链接按 `NEXT_PUBLIC_BASE_PATH` 加前缀。

### 发布状态与恢复

v2 私有检查点使用 `binding = { commit, archiveVersion, sourceCommit }` 同时绑定公开 Git commit、归档内容版本与私有源 commit。`state.checkpointBinding`、`publication.binding` 必须与它完全一致；`checkpointId` 对检查点阶段、绑定、完整私有状态和内容清单计算摘要，每次状态变更都会重新计算。来源回执、历史映射和 publication state 都属于检查点的一部分。

同步的顺序固定为：完整验证 → 创建本地公开 commit → `state:prepare` 以 CAS 保存绑定该 commit 的 `prepared` 检查点 → push 该 commit → `state:save` 标记 `committed`。准备失败时不能 push；push 失败时不能把检查点标记为完成。公开 commit 已推送而最后保存失败时，在同一 commit 恢复完整 prepared 检查点，再完成保存。仅变更待审阅元数据时会单独保存私有检查点，保留原公开绑定；保存失败会在 Summary 显示 `pending_checkpoint_save_failed`，应先修复再批准审阅。

Pages 与 health 使用同一个 `archive-publication-state` 工作流锁，sync 在同步 job 内持有同组锁；retry 通过调用 Pages 取得锁，父调用不会重复持锁。远端写入还必须使用 restore 取得的 SHA 与摘要做 compare-and-swap（CAS），保护来自其他运行或终端的并发更新。CAS、权限或状态校验失败都会停止当前操作，不会重新读取后无条件覆盖。

Pages 首先执行 `archive:publication -- --plan` 验证绑定并决定剩余阶段。同一绑定已经 `verified` 且没有健康异常时跳过发布；存在部署回执的 verify 重试只核对线上内容。新部署需要当前运行的 Pages artifact，因此即使已有 built 回执，也可能重新构建 artifact。每个完成阶段立即保存私有状态，不能等到全部发布结束才登记回执。health 通过独立健康字段记录观测结果，不回退已完成的发布阶段，也不会因此重复部署。

部署前必须执行 `--begin-deploy <attempt>` 并成功 `state:save`，随后才允许调用 Pages。`deploymentIntent` 表示外部部署可能已经开始；部署返回错误、运行中断或回执写入失败，都不能据此认定没有发布。任何遗留 intent 会产生 `PUBLICATION_DEPLOYMENT_RECOVERY_REQUIRED`，禁止自动再次部署。

人工恢复 intent 前，先停止相关写入，检出 intent 绑定的公开 commit，恢复检查点，并在 GitHub 核对原运行、真实部署回执和线上内容。只有确认该部署实际成功后才能补记；以下占位符必须替换为已核实的原 attempt、回执和 HTTPS 地址。终端应已安全配置私有状态访问，命令不触发部署，每一步成功后才继续：

```powershell
npm run state:restore
$env:BRIEFING_PUBLICATION_ATTEMPT = '<original-attempt>'
npm run archive:publication -- --deployed '<verified-deployment-receipt>' 'https://example.org/briefing-atlas/'
npm run state:save
npm run archive:publication -- --verify
npm run state:save
```

无法核实外部结果时继续保留 intent 与站点，交由维护者恢复可信记录。不能清除 intent、伪造 receipt、修改 `verifiedVersion` 或重跑部署来消除错误。普通 build 失败可修复后重试；verify 失败复用已保存部署。`retry_stage` 与私有状态记录的下一阶段不一致时也会拒绝运行。

常见稳定错误码及处理边界：

| 错误码                                                                                                     | 含义与处理                                                                                                   |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `PRIVATE_STATE_WRITE_CONFLICT`                                                                             | CAS 会话过期或远端已变化。保留本次证据，重新读取最新检查点并核对实际阶段，禁止循环重试旧会话或修改会话 SHA。 |
| `PRIVATE_STATE_ACCESS_FAILED`                                                                              | 私有状态访问或写入权限失败。修复仓库、分支和权限配置后重试读取，不进入 bootstrap 或补偿覆盖。                |
| `PRIVATE_STATE_CORRUPT`、`PRIVATE_STATE_SESSION_CORRUPT`、`INVALID_PRIVATE_STATE`                          | 响应、会话或本地状态损坏。恢复可信备份，不按空状态继续。                                                     |
| `CLOUD_CHECKPOINT_INVALID`、`CLOUD_CHECKPOINT_BINDING_INVALID`、`CLOUD_CHECKPOINT_STATE_DIVERGED`          | 检查点结构、摘要、绑定或来源记录不一致。保留完整数据并核对私有备份。                                         |
| `CLOUD_CHECKPOINT_CONTENT_CONFLICT`、`PRIVATE_STATE_COMMIT_CONTENT_MISMATCH`                               | 日期集合、公开内容或 Git 中的内容与检查点不一致。整批停止，按下节处理。                                      |
| `PRIVATE_STATE_RECONCILE_REQUIRED`、`PRIVATE_STATE_COMMIT_DIVERGED`                                        | 当前 commit 需要显式 reconcile，或已不属于允许的祖先关系。不能直接保存新绑定。                               |
| `PRIVATE_STATE_COMMIT_NOT_READY`、`PRIVATE_STATE_PUBLIC_CHECKOUT_DIRTY`                                    | prepared commit 未就位，或公开内容存在未提交改动。先恢复正确 commit 和完整内容。                             |
| `PUBLICATION_CHECKPOINT_BINDING_MISMATCH`、`PUBLICATION_BINDING_MISMATCH`、`PUBLICATION_STATE_REGRESSION`  | 发布回执属于不同绑定，或更新会回退已登记阶段。拒绝写入。                                                     |
| `PUBLICATION_DEPLOYMENT_RECOVERY_REQUIRED`、`PUBLICATION_ATTEMPT_MISMATCH`、`PUBLICATION_RECEIPT_CONFLICT` | 部署结果待核实，或 attempt、回执冲突。核对真实外部部署，不自动重发。                                         |

### 检查点冲突：按步骤安全恢复

`state:restore` 是严格校验与私有状态恢复入口：它检查完整日期集合、内容字节摘要、Git commit 中的全部归档文件和当前 checkout；新增、缺失或不同内容都使整批操作停止。它不会覆盖公开文件，也不再将 `baseline` 或 `history` hash 视为允许自动回滚的候选。诊断只列日期与 hash，用于比较证据，不包含正文和 source receipts。

1. 保留当前状态。确认没有同步或发布正在写入后，在项目根目录备份私有状态与公开文件；备份保留在被忽略的 `work/` 下。已有的 `incoming/`、私有源导出和来源回执继续保留，不清空、不公开上传。

   ```powershell
   $recoveryDir = 'work/recovery-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
   New-Item -ItemType Directory -Path $recoveryDir | Out-Null
   Copy-Item -LiteralPath 'work/archive-sync' -Destination "$recoveryDir/archive-sync" -Recurse
   Copy-Item -LiteralPath 'content/briefings' -Destination "$recoveryDir/briefings" -Recurse
   git status --short
   ```

   若本地从未恢复过私有状态，第一条复制可能提示目录不存在：保留公开文件备份，并从私有状态仓库的独立状态分支保存完整 `atlas-checkpoint.json` 到该备份目录。该文件含私有来源证据，不能上传公开 issue、Actions artifact 或提交到公开仓库。

2. 对照公开 Git 历史与完整私有检查点，判断是否仅有代码 commit 变化。若当前公开内容与检查点逐日期一致，原绑定 commit 是当前 HEAD 的祖先，且检查点已经 `committed`，可显式执行：

   ```powershell
   npm run state:reconcile
   npm run state:restore
   ```

   `state:reconcile` 会重新验证完整内容与祖先关系，重新绑定当前 commit，并通过 CAS 保存。它不导入新闻、不补建来源回执，也不接受任意内容分叉。调用者需要完整 Git 历史；prepared 检查点只允许恢复到其绑定的原 commit。若 CAS 失败，保留本次工作并重新读取远端，不能跳过失败继续发布。

3. 对 v1 legacy 检查点，普通 restore 要求先显式 reconcile。只有公开内容与旧检查点完整一致时，`state:reconcile` 才会迁移现有私有来源回执，并标记仍需绑定；它不会猜测 `sourceCommit`。随后使用固定私有源 commit 执行既有同步与审阅流程，完成验证及本地公开 commit 后依次 `state:prepare`、push、`state:save` 升级为 v2。来源映射、历史和 review 必须完整保留，不能删除 legacy 检查点再 bootstrap。

4. 若存在未知公开内容差异、缺失日期或无共同绑定，停止自动恢复，从可信备份恢复同一绑定的完整公开 commit 和私有检查点。由维护者核对 `records.sources`、`sourceHash`、`activeSource`、`history` 与待审阅记录，不从公开正文重建 receipt。需要保留的新修订应在一致状态恢复后重新通过固定来源和审阅流程处理。

5. 恢复正确 commit 与完整私有状态后，再执行严格 restore 和项目检查。每一步成功后才继续；没有已核实的外部部署回执时不运行补记部署命令。

   ```powershell
   npm run state:restore
   npm test
   npm run typecheck
   npm run lint
   npm run build
   npm run verify:build
   npm run test:e2e
   git diff --check
   ```

任何情况下都不能删除 `checkpoint.json`、`state.json`、远端 `atlas-checkpoint.json` 或状态分支来解锁，不能强行修改会话 SHA、绑定或摘要，不能静默覆盖公开内容。`PRIVATE_STATE_RECOVERY_REQUIRED` 表示缺少必要私有证据，应恢复完整私有备份；`state:bootstrap` 只用于明确未初始化的远端，不能恢复冲突。公开归档无法重建 source receipts 与 history。
原稿导入、修订和同步恢复见 [内容与同步](CONTENT_GUIDE.md)。Node 脚本接收交付文件；真实定时读取和关机后的云端交付仍需单独验证，不能由手动构建或发布推定已完成。

## 入场动画

`components/float-in.tsx` 提供可复用的 `FloatIn` 组件。内容首次进入视口时从下方轻轻浮起并淡入，每次挂载只播放一次；离开视口再返回、收藏或展开预览都不会重播。每日简报、历史简报、搜索与收藏页通过共用的 `StoryCard` 自动使用此效果。

```tsx
import { FloatIn } from '@/components/float-in';

<FloatIn as="section" className="summary-panel" duration={600} distance={20}>
  <h2>本期导读</h2>
  <p>导读内容</p>
</FloatIn>;
```

- `as`：使用 `div`（默认）、`article`、`section` 或 `li`，直接渲染对应语义元素，不增加布局包裹。
- `duration`：时长，默认 `600` 毫秒。
- `distance`：向上浮入的起始偏移，默认 `20` 像素。
- `delay`：进入视口后的延迟，默认 `0` 毫秒；同屏短列表可使用小幅延迟错开入场，长列表应避免按全局序号累计延迟。
- 支持标准 HTML 属性、`className` 和 `style`；样式随组件导入，无需额外注册。

动画仅改变透明度和位移，不影响文档布局。系统启用“减少动态效果”、打印页面、禁用 JavaScript 或浏览器缺少 `IntersectionObserver` 时，内容直接显示。键盘焦点进入组件时立即结束动画，目录锚点目标也始终可见。

鼠标或触摸操作不会因获得焦点而强制结束位移动画，以免按下和抬起之间目标位置改变，导致收藏、已读或文章链接的点击丢失。
