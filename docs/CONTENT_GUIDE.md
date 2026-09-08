# 内容与同步规范

内容权威来自 `AI & Tech Briefing` 原任务，正文不得独立总结、翻译、补写或调整新闻顺序。日期来自正文标题。无法取得完整正文时不发布，缺日期不使用当前日期替代。

## 输入方式

1. 应用读取：把 `read_thread` 的原始 JSON 结果保存到忽略的 `incoming/`，读取全部分页后运行 `archive:prepare`。仅处理完成的助手正式简报，排除任务配置、用户消息和其他回复。不使用整个会话轮次的时间代替单条原稿发送时间。
2. 普通 Markdown：保存导出的 `.md` 及同名 `.md.receipt.json`。回执包含 `source`、`messageId`、`role: "assistant"`、`status: "completed"`、`complete: true` 和可空的 `sourcePublishedAt`。来源与消息标识仅进入私有状态。
3. JSON 批次：`version: 1`、固定 `source`、`complete: true`、`messages` 数组、可选 `missingDates`。每条消息使用上面的回执字段及 `text`。

转换器支持带明确日期的 AI & Tech Briefing 标题、顺序编号的 Markdown 新闻标题，以及最后一条分隔线之后的结语。不会把代码块内标题识别为新闻。其他原文结构会进入待处理，先扩展转换器再导入，不为迁就格式改写原文。

图片查询描述须由 `imageGroups` 对应到原图资源，否则转换为“原配图暂未恢复”。聊天实体转换为名称。内部引用可由带明确引用编号的 `citations` / `annotations` 或经原页面上下文校验的 `citationGroups` 恢复；无法对应的链接仍在原位置标记缺失。原有机构首页链接保留，但不当作具体报道证据。结构、采集要求与命令见 [资源导入说明](RESOURCE_IMPORT.md)。

## 内容文件

路径为 `content/briefings/YYYY/MM/YYYY-MM-DD.md`。使用 JSON frontmatter，新闻正文使用 `## <stable-id>` 分段。字段白名单阻止私有元数据进入公开产物。

| 字段                                   | 规则                                                 |
| -------------------------------------- | ---------------------------------------------------- |
| `id`、`briefingDate`、`title`          | 稳定编号、正文日期与原标题                           |
| `intro`、`outro`                       | 保留原导语与结语 Markdown                            |
| `summary`、`summaryKind`               | 原文没有摘要时直接摘录，标为 `excerpt`               |
| `sourcePublishedAt`、`sourceUpdatedAt` | 独立可空时间，已知时包含时区；不使用计划运行时间代替 |
| `archivedAt`                           | 保存该版网站副本的时间                               |
| `revision`、`formatRevision`           | 内容及格式分别计数，格式更新不伪装成原稿变化         |
| `corrections`                          | 日期、说明、`source` / `format` / `cross-issue` 类型 |
| `status`、`sample`                     | `draft` 或 `published`；生产构建拒绝示例             |
| `stories`                              | 按原顺序保存新闻元数据                               |

新闻保留标题、正文、可空事件日期、来源、核验状态和说明。标签与机构允许空数组。自动标签仅根据标题中的明确词项映射：AI / Agent / 模型 → AI 与大模型；游戏 / Unity / Unreal → 游戏与交互；芯片 / GPU / CUDA → 科技行业；论文 / 科学 / 证明 → 机器学习；Coding / MCP / Skills → 开发工具。机构只匹配代码内列出的名称。没有分类信息也能全文检索。

正文无需三个固定小标题。支持 Markdown 标题、列表、表格、代码块、`$...$` / `\(...\)` 行内公式、`$$...$$` / `\[...\]` 块级公式。原始 HTML 禁用，代码块中的 HTML 保留为代码；来源与 Markdown 链接接受无凭据 HTTP / HTTPS。图片仅接受 HTTPS 或 `images/` 下的安全本地路径，拒绝路径越界、协议相对地址和脚本 URL。

原图可在正文使用普通 Markdown 图片，或在 `:::gallery` 块中按原顺序排列图片与来源链接。远程原图引用不代表已核验转载许可；不自动下载图片。自托管图片应先确认许可，置于 `public/images/`；原有 `image` 字段仍支持 `path`、`alt`、`caption`、`source`。不搜索替代图或生成新闻配图。

## 增量与恢复

`sourceHash` 只统一换行，不忽略正文、数字、链接或公式。`resourceHash` 独立跟踪图片与引用元数据，补资源只递增 `formatRevision`。后续仅有文本的读取保留同一原稿已有的资源；原文改变后须重新交付资源，以免错配。`archiveHash` 对确定性 Markdown 副本计算；转换器版本独立保存。私有来源映射、资源元数据和摘要只写 `work/archive-sync/`，不入 Git。

同日期不同正文不能覆盖。原消息编辑先生成 `review-YYYY-MM-DD.json` 完整前后差异，再用 `--accept-revisions` 接受。标题或正文完全匹配时复用编号；两者同时变化且无法可靠对应时，回执中提供经过审阅的 `storyMapping`，键为原稿新顺序编号，值为已有新闻编号。增删条目也需人工设计保持旧链接的迁移，默认暂停。

同日更正可以用 `correctionOf` 指向原消息，但仍需差异审阅。跨期更正使用消息中的 `corrections`，每项包含 `targetDate` 和原稿中的精确 `note`；说明必须明确包含目标日期，不确定对应关系时保留待处理。更正追加为独立记录，不改写旧正文。

整个输入批次校验通过后才保存。唯一写入锁覆盖自动同步、人工导入和完整生产构建。私有批次日志先落盘，再逐项保存，最后更新检查点及状态；中断时构建拒绝运行，恢复先核对每个文件是否为批次前或批次后版本。外部编辑不被恢复流程覆盖。

状态丢失时读取私有检查点。检查点也丢失时，不从日期猜测来源对应关系；恢复私有备份或重新审阅来源证据。`--unlock` 仅清理对应进程已退出的锁；活跃写入者不会被解除。

`config/archive-sync.json` 保存执行约定。应用代理负责有限重读；普通 Node 脚本只接受交付的文件，不私自访问对话接口。权限失效时保留当前内容并报告可处理原因，禁止 Cookie 提取、私有接口逆向与生成替代稿。
