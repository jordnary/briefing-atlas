# Briefing Atlas · 科技简报图志

按日期与主题阅读 AI、机器学习、游戏开发和科技简报。支持全文搜索、组合筛选、移动端目录、公式、收藏、已读、继续阅读、字号和主题设置，以及阅读记录备份。

当前内容为原任务已发送的 **11 期、55 条**，日期为 2026-08-28 至 2026-09-08。2026-09-05 本次未读到，未生成补位内容。正文中的链接与配图缺失状态如实保留；收录成功不等于事实核验。

## 使用

需要 Node.js 22.13 或更高版本及 npm：

推荐使用最新 LTS。发布工作流同时验证 Node.js 22、最新 LTS（`lts/*`）和最新 Current（`node`），每次解析最新补丁版本；所有版本通过后，使用 LTS 的构建产物发布。各 JavaScript Action 已升级为使用 Node.js 24 运行时的版本；Action 自身的运行时与项目构建使用的 Node.js 版本分别管理。

```powershell
npm ci
npm run dev
```

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run verify:build
npm start
```

静态输出为 `dist/client/`，无运行时数据库或模型密钥。

## 内容同步

执行依据为 [最新计划](doc/INCREMENTAL_ARCHIVE_PLAN.md)，实施证据和剩余条件见 [实施记录](doc/ARCHIVE_IMPLEMENTATION.md)。原任务是唯一内容源；网站不制作第二份新闻。归档是内部工作流，页面以简报产品呈现，不展示这一实现定位。

支持读取工具返回的完整页面，也支持普通 Markdown 搭配私有来源回执。运行约定见 [内容规范](docs/CONTENT_GUIDE.md)。

```powershell
# 当前应用读取工具的 JSON 页面保存在 incoming/，不提交原始对话
npm run archive:prepare -- incoming/thread-page.json
npm run archive:sync -- incoming/source-export.json

# 用户导出的普通 Markdown，配套 .md.receipt.json
npm run archive:sync -- incoming/briefing.md

# 修订先产生私有差异文件，审阅后才接受
npm run archive:sync -- incoming/source-export.json --accept-revisions

# 中断恢复；仍有进程运行时不会解锁
npm run archive:sync -- --unlock
npm run archive:sync -- --recover
```

重复原稿不会重写文件或要求发布。同日不同原稿进入冲突处理；原稿修订保留新闻编号。私有来源映射、摘要值、差异和发布回执留在忽略的 `work/` 中。同步状态丢失时优先由私有检查点恢复；全部来源证据丢失时暂停覆盖，先恢复私有备份。不要只根据最近日期判断成功。

`npm run import -- incoming/normalized.md` 保留给已转换的内容恢复；`--replace` 必须同时有修订递增、更正说明与原新闻编号。直接恢复后，若来源状态摘要不一致，需审阅来源差异并恢复相应回执，不以强制覆盖自动消除冲突。

## 阅读记录

收藏、已读、阅读位置和设置只保存在当前浏览器，沿用原有存储键。备份导入会合并收藏和已读，使用备份中的阅读设置。不同设备不自动同步；清理浏览器前可在“我的收藏”导出备份。

## 发布

使用 GitHub Pages 发布。在仓库 Settings → Pages 中选择 GitHub Actions，然后在 Actions 中手动运行 `Publish static archive` 工作流。工作流执行测试、类型检查、lint、构建与产物验证，只上传 `dist/client/`；构建作业无部署权限，不会因为普通 Git 提交自动发布。

部署成功后，独立清理作业使用 `GITHUB_TOKEN` 的 `deployments: write` 权限，分页读取 `github-pages` 环境的部署记录。确认最新记录属于本次提交且状态为 `success` 后，将全部旧记录标记为 `inactive` 并删除，仅保留最新成功部署。构建或部署失败不会触发清理；记录不匹配或清理 API 失败会使清理作业报错，可在 Actions 中重跑失败作业。工作流全程串行部署，避免同一工作流的发布与清理交错。

清理范围是 GitHub Deployments 历史记录，其他环境不受影响。Actions 运行历史保留，构建 artifact 设置为 1 天后过期；不删除当前 Pages 站点。只保留最新记录意味着旧部署记录不能再用于历史追踪，需要旧版本时重新运行对应提交的发布工作流。删除前置条件见 [GitHub Deployments API 文档](https://docs.github.com/en/rest/deployments/deployments#delete-a-deployment)。

仓库已移除 `.openai/` 配置与 Sites、Cloudflare 专用部署依赖。源码、内容、测试和维护文档保留在仓库中，不进入 Pages 发布产物。`.openai/` 已加入忽略规则，避免本地工具配置再次提交。

```powershell
npm run archive:publication -- --built
# 实际部署成功后记录工具返回的回执与站点地址
npm run archive:publication -- --deployed <deployment-receipt> <site-url>
npm run archive:publication -- --verify
```

线上核对直接读取 GitHub Pages 地址下的公开清单与页面。上述命令用于手动记录发布状态，不触发部署；读取、保存、构建、部署、线上验证分阶段记录，失败只续跑相应阶段。

子路径部署：设置 `NEXT_PUBLIC_BASE_PATH` 为 `/briefing-atlas` 后构建与验证，结束后移除该环境变量并恢复根路径构建。

定时读取与关机后的云端交付必须分别验证，详见实施记录；桌面对话读取工具不是 GitHub Actions 公共接口。项目不接入模型生成 API。

## 实验能力

搜索页保留只读 `search_briefing_archive` WebMCP 接口，共用普通检索逻辑，注册失败或不支持时自然降级。尚未在支持该接口的浏览器中完成端到端验证。普通搜索和阅读不依赖它。验证范围见 [验收记录](docs/VALIDATION.md)。
