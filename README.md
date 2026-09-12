# Briefing Atlas · 科技简报图志

按日期与主题阅读 AI、机器学习、游戏开发和科技简报。支持全文搜索与组合筛选、独立文章页、公式和图库、收藏与已读、继续阅读、排版设置及阅读记录备份，并提供可收起的 Live2D 看板娘。

## 本地运行

需要 Node.js 22.13 或更高版本及 npm，推荐最新 LTS。

```powershell
npm ci
npm run dev
```

构建并预览静态站点：

```powershell
npm run build
npm run verify:build
npm start
```

静态输出为 `dist/client/`。内容来自原简报任务已完成的稿件；收录不等于事实核验。阅读记录仅保存在当前浏览器，可导出备份。

## 文档

完整导航与文档存放约定见 [文档索引](docs/README.md)。

- [内容与同步](docs/CONTENT_GUIDE.md)：导入、修订、恢复以及图片和引用。
- [阅读与搜索](docs/READER.md)：检索语法、阅读记录、排版和图库。
- [Live2D 看板娘](docs/LIVE2D.md)：交互、模型加载和组件维护。
- [开发与发布](docs/DEVELOPMENT.md)：检查命令、测试入口和 GitHub Pages。

### 私有简报发布流程

同步工作流先以 `preview` 检查私有来源并生成审阅报告；确认差异后，在同一运行的 Summary 中复制 review ID 和 source commit，手动以 `approve` 重新运行。通过校验的内容会提交到公开归档并调用 Pages 发布。若构建、部署或线上核验失败，修复对应阶段后可用 `Retry Pages publication` 指定同一公开 commit 重试；`Check Pages health` 会定时报告线上漂移。检查点冲突必须按 [开发与发布](docs/DEVELOPMENT.md) 的恢复步骤处理。

内部计划、任务规则和验证记录统一保存在被 Git 忽略的 `docs/local/`，不进入云端仓库。
