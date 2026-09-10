# 开发与发布

## 环境与启动

需要 Node.js 22.13 或更高版本及 npm，推荐最新 LTS。使用锁文件安装依赖：

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

`.github/workflows/sync-source.yml` 按北京时间 08:20、08:30 和 08:40（UTC 的前一天 00:20、00:30、00:40）运行，也可手动触发。运行前在仓库设置：

- Repository variable `BRIEFING_SOURCE_REPO`：`owner/briefing_source`。
- 可选 variable `BRIEFING_SOURCE_REF`：固定源仓库分支或 commit；默认 `main`。
- Secret `BRIEFING_SOURCE_TOKEN`：仅能读取私有源仓库的 token。

工作流在临时目录检出源仓库，执行其锁定依赖的测试、校验和 `npm run export`，再调用 `npm run sync:source`。源仓库内容、导出包、来源映射和差异不会加入公开提交；归档检查点通过 GitHub Actions 私有 cache 跨运行恢复。无变化时不提交；截断、校验失败、同日冲突或待审阅修订会使本轮暂停，不使用自动接受修订。通过测试、构建和产物校验后仅提交 `content/briefings`，由 `pages.yml` 发布并执行线上版本核验。

在仓库 Settings → Pages 中选择 GitHub Actions。推送到 `master` 会自动运行 `Publish static archive` 工作流，也可以按需手动运行。配置见 [pages.yml](../.github/workflows/pages.yml)。

构建矩阵使用 Node.js 22、最新 LTS（`lts/*`）和最新 Current（`node`），每次解析最新补丁版本。各版本执行测试、类型检查、lint、构建和产物校验；LTS 额外运行 `npm run test:e2e`，涵盖搜索、阅读、图库和看板娘。所有构建作业通过后，发布 LTS 的 `dist/client/` 产物。JavaScript Action 自身使用 Node.js 24 运行时，与项目构建版本分别管理。

构建使用 GitHub 托管的 `ubuntu-24.04` 镜像及其预装 Chromium 系统依赖，通过 `npx playwright install chromium` 下载与项目 Playwright 版本匹配的浏览器，避免额外刷新第三方 APT 源导致发布失败。

构建作业没有部署权限；部署作业使用 `pages: write` 与 `id-token: write`。源码、测试、文档和本地工作数据不进入 Pages 上传目录，构建 artifact 保留 1 天。部署作业输出页面地址后，`verify-online` 作业会检出同一提交并运行 `npm run verify:online`，检查公开清单和最新一期页面；核对失败时不会进入部署记录清理，也不得将本次部署标记为已验证。

### 部署记录清理

部署成功后，独立清理作业使用 `GITHUB_TOKEN` 的 `deployments: write` 权限，分页读取 `github-pages` 环境记录。只有最新记录属于本次提交且状态为 `success`，才将旧记录标为 `inactive` 并删除，保留最新成功部署。其他环境和 Actions 运行历史保留，当前 Pages 站点继续可用。

构建或部署失败不会触发清理；记录不匹配或 API 失败会使清理作业报错，可重跑失败作业。工作流串行部署，防止发布与清理交错。旧部署记录删除后，需要旧版本时重新运行对应提交的发布工作流。实现见 [cleanup-pages-deployments.mjs](../scripts/cleanup-pages-deployments.mjs)，删除条件见 [GitHub Deployments API](https://docs.github.com/en/rest/deployments/deployments#delete-a-deployment)。

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

归档流程分别记录保存、构建、部署和线上验证。以下命令记录状态并核对产物，不触发部署：

```powershell
npm run archive:publication -- --built
# 在实际部署成功后填入真实回执和 HTTPS 站点地址
npm run archive:publication -- --deployed '<deployment-receipt>' 'https://example.org/briefing-atlas/'
npm run archive:publication -- --verify
# 失败时记录实际阶段：build、deploy 或 verify
npm run archive:publication -- --failed verify ONLINE_VERSION_MISMATCH
```

`--built` 要求产物与当前归档版本一致，并重新检查构建；`--deployed` 要求同一版本已构建且有部署回执；`--verify` 检查线上公开清单和最近一期页面。只有线上核对成功，才可将版本记为 `verified`。失败后保留内容与状态，处理对应阶段；运行回执留在已忽略的 `work/` 中。

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
