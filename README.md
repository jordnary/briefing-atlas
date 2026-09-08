# Briefing Atlas · 科技简报图志

以日历为入口的 AI 与科技阅读档案。网站源码、配置和命令均位于项目根目录。

已实现日期归档、年月直达、按月列表、简报详情与稳定新闻锚点、中英文全文搜索、主题与机构组合筛选、深浅主题、字号和摘要 / 全文设置，以及本地收藏、已读状态、继续阅读和 JSON 备份。

## 本地运行

需要 Node.js 22.13 或更高版本及 npm。在项目根目录运行：

```powershell
npm ci
npm run dev
```

生产构建与静态预览：

```powershell
npm run build
npm run verify:build
npm start
```

静态发布目录为 `dist/client/`。无需数据库、服务端密钥或运行时 Node.js 服务。

## 内容与更新

目前附带 **6 期、12 条明确标注的示例档案**。这些条目是基于原始论文的历史技术回顾，归档日期用于演示日历，不代表新闻发生日期。尚未导入个人历史简报，也未连接每日自动采集任务。

真实内容保存在 `content/briefings/YYYY/MM/YYYY-MM-DD.md`。JSON frontmatter 存放元数据，Markdown 存放每条新闻正文；页面与搜索索引由同一份内容生成。详细字段见 `docs/CONTENT_GUIDE.md`。

```powershell
npm run import -- ./incoming/2026-09-09.md
npm run validate
npm run build
```

导入会先校验整个批次。已有日期默认不覆盖；审阅修订后可以使用 `--replace`。导入成功不代表事实核验完成。日期、必要字段、稳定编号、来源和核验说明均会检查；草稿不会进入静态页面或搜索索引。

开发服务器启动前会生成内容。编辑 Markdown 后运行 `npm run validate` 更新页面数据，或重新启动开发服务器。

## 阅读状态

- 收藏、已读、上次阅读位置及阅读设置仅保存在当前浏览器。
- “我的收藏”提供备份导出与导入。导入将收藏与已读记录合并，保留已有记录，并使用备份中的阅读设置。
- 同源浏览器标签页可以接收记录变更；不同设备和不同域名之间不自动同步。
- 清理浏览器数据前请导出备份。存储不可用时页面会提示；个人记录不进入网站内容或公开索引。

## 部署

Sites 配置位于 `.openai/hosting.json`，以静态输出部署。访问范围由托管平台控制。

另提供手动触发的 GitHub Pages 工作流 `.github/workflows/pages.yml`。启用前请确认内容允许公开，并将仓库的 Pages 来源设为 GitHub Actions。工作流不会因为提交而自动公开发布。

子路径构建示例：

```powershell
$env:NEXT_PUBLIC_BASE_PATH = '/briefing-atlas'
npm run build
npm run verify:build
npm start
# 结束子路径预览后，恢复根路径构建
Remove-Item Env:NEXT_PUBLIC_BASE_PATH
npm run build
```

公开或共享托管前，应检查已发布内容。隐藏链接、前端密码框和禁止搜索引擎索引不构成访问控制。

## 验证与维护

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run verify:build
```

逻辑测试覆盖闰日、跨年、北京时间边界、组合搜索、非法备份、内容校验与新闻锚点规则。构建检查验证实际生成页面、资源子路径、草稿排除与本地路径隐私。浏览器交互与视觉验收清单见 `docs/VALIDATION.md`。

实现采用 React、TypeScript 和 Vinext 静态导出；匹配的选择器、阅读模式与菜单复用 Shadcn / Base UI。Markdown 使用 Marked，数学公式使用 KaTeX。已发布正文在构建期渲染，原始 HTML 被禁用，来源限定为 HTTPS。初始依赖审计发现的问题已通过兼容版本更新解决。

Lint 跳过未修改的组件库目录；未启用 React Compiler，因此不强制其特定优化规则。静态输出使用带尺寸的普通图片与原生 ARIA 语义，保留核心 Hooks、类型和无障碍正确性检查。

搜索页在支持 `document.modelContext` 的浏览器中暴露只读 `search_briefing_archive` 工具，与页面共用检索函数。当前未获得支持该实验接口的验证上下文，因此未宣称完成 WebMCP 端到端验证；普通浏览器不依赖此接口。
