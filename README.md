# Briefing Atlas · 科技简报图志

按日期与主题阅读 AI、机器学习、游戏开发和科技简报。支持全文搜索、复杂检索、相关度权重、组合筛选、移动端目录、公式、收藏、已读、继续阅读、独立阅览页、阅读进度、字号、纸色主题和排版设置，以及阅读记录备份。

当前收录 **12 期、60 条**，日期连续覆盖 2026-08-28 至 2026-09-08。收录成功不等于事实核验。

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
npx playwright install chromium
npm run test:e2e
npm start
```

静态输出为 `dist/client/`，无运行时数据库或模型密钥。

## 搜索

搜索页在浏览器中加载只读索引；每次查询都由同一套纯函数完成解析、筛选、相关度计算和摘录生成。空格默认表示 `AND`，高级设置可以切换为 `OR`；支持括号、`AND`、`OR`、`NOT`、前缀排除（`-关键词`）、连续短语和英文前缀匹配（`agent*`）。字段限定包括 `title:`、`summary:`、`body:`、`tag:`、`entity:`、`source:`、`briefing:`、`date:`、`before:` 和 `after:`，例如：

```text
title:(Agent OR 模型) -body:游戏
body:"incident report" entity:OpenAI after:2026-08-28
date:2026-09 agent*
```

`date:` 支持 `YYYY`、`YYYY-MM` 和 `YYYY-MM-DD`；`before:` 与 `after:` 不包含当天。页面日期筛选包含起止当天。英文词按单词边界匹配，中文按连续文字匹配；需要搜索括号、冒号、星号或运算符本身时使用引号。无效表达式会停止出结果并显示错误提示。每次查询最多 2,048 个字符、64 个条件和 12 层括号 / 否定嵌套。

结果默认按相关度排序。标题、摘要、正文、主题、机构、来源和导读拥有独立权重，评分使用词频饱和、逆文档频率和正文长度归一化；高级设置可使用默认、均衡或正文优先预设，也可逐字段调整。排序、搜索范围、匹配方式、日期、已读状态和自定义权重都可以通过“复制搜索链接”分享并在刷新或返回后恢复。

索引加载后校验稳定 ID、日期、必要字段类型、来源 URL；格式异常时提供重试。搜索摘录来自正文或元数据文字，排除图库说明和 Markdown 链接目标。`search_briefing_archive` WebMCP 工具复用同一解析和评分逻辑，返回 `{ total, offset, hasMore, results }`；默认每页 20 条，最多 100 条，支持排序和自定义权重。

默认权重依次为标题 8、摘要 3、正文 1、主题 4、机构 4、来源 1.5、本期导读 0.5。权重范围为 0–20；0 只取消加分，不排除字段。没有关键词或只有否定 / 日期条件时按日期和稳定 ID 排序。结果高亮仅来自实际成立的正向条件；本期导读命中会明确标注，可能对应同一期的多条新闻。

搜索采用字面匹配，不包含语义扩展或拼写纠错。运行浏览器测试前需先构建，首次使用需安装 Chromium；测试自动启动本地静态预览。阅读状态选项可通过 URL 恢复，具体已读与收藏记录仍属于各自浏览器。

## 内容同步

执行依据为 [最新计划](doc/INCREMENTAL_ARCHIVE_PLAN.md)，实施证据和剩余条件见 [实施记录](doc/ARCHIVE_IMPLEMENTATION.md)。原任务是唯一内容源；网站不制作第二份新闻。归档是内部工作流，页面以简报产品呈现，不展示这一实现定位。

支持读取工具返回的完整页面，也支持普通 Markdown 搭配私有来源回执。运行约定见 [内容规范](docs/CONTENT_GUIDE.md)。

图片与引用可单独补导入。资源导入器校验原消息、新闻标题和引用上下文，将原图组成可横向浏览的图库；图片加载失败时保留图片入口。详见 [资源导入说明](docs/RESOURCE_IMPORT.md)。

```powershell
# 当前应用读取工具的 JSON 页面保存在 incoming/，不提交原始对话
npm run archive:prepare -- incoming/thread-page.json
npm run archive:sync -- incoming/source-export.json

# 用已登录原对话页面读取到的资源补全同一份原稿
npm run archive:resources -- incoming/source-export.json incoming/browser-resources.json
npm run archive:sync -- incoming/resource-export.json

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

收藏、已读、文章阅读位置和排版设置只保存在当前浏览器，沿用原有存储键。备份导入会合并收藏和已读，使用备份中的阅读设置。不同设备不自动同步；清理浏览器前可在“我的收藏”导出备份。简报卡片的“阅读全文”会进入 `/read/<date>/<story-id>/` 独立阅览页，页面支持目录、续读、阅读进度和打印样式。

独立文章页默认使用宽屏布局，也可选择标准或铺满。右下角的悬浮阅读工具支持整篇文字缩放；展开“阅读设置”可分别调整标题大小和正文大小，正文支持 16–28px、每次 1px 的微调。具体范围与兼容性见 [阅读排版说明](docs/READER.md)。

## Live2D 看板娘

全站接入 `yibei_3` 看板娘：桌面右下角显示，支持鼠标跟随、眨眼呼吸、点击台词和收起；手机默认收起，展开后才加载动画资源。站内切换页面时保留同一个模型，动画与台词延续，避免重复加载。人物为阅读工具留出空间，并遵循减少动态效果设置。指定五个部件逐帧保持完全透明；工具栏已提供扩展接口。尺寸、台词、透明部件和验证方式见 [Live2D 说明](docs/LIVE2D.md)。

## 发布

使用 GitHub Pages 发布。在仓库 Settings → Pages 中选择 GitHub Actions，然后在 Actions 中手动运行 `Publish static archive` 工作流。工作流执行测试、类型检查、lint、构建与产物验证，LTS 作业额外运行 Chromium 搜索交互回归，只上传 `dist/client/`；构建作业无部署权限，不会因为普通 Git 提交自动发布。

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
