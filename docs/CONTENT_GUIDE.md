# 内容与同步规范

内容权威来自 `AI & Tech Briefing` 原任务，正文不得独立总结、翻译、补写或调整新闻顺序。日期来自正文标题。无法取得完整正文时不发布，缺日期不使用当前日期替代。

## 输入方式

1. 应用读取：把 `read_thread` 的原始 JSON 结果保存到忽略的 `incoming/`，读取全部分页后运行 `archive:prepare`。仅处理完成的助手正式简报，排除任务配置、用户消息和其他回复。
2. 普通 Markdown：保存导出的 `.md` 及同名 `.md.receipt.json`。回执包含 `source`、`messageId`、`role: "assistant"`、`status: "completed"`、`complete: true`。来源与消息标识仅进入私有状态。
3. JSON 批次：`version: 1`、固定 `source`、`complete: true`、`messages` 数组、可选 `missingDates`。每条消息使用上面的回执字段及 `text`。

转换器支持带明确日期的 AI & Tech Briefing 标题、顺序编号的 Markdown 新闻标题，以及最后一条分隔线之后的结语。不会把代码块内标题识别为新闻。其他原文结构会进入待处理，先扩展转换器再导入，不为迁就格式改写原文。

图片查询描述须由 `imageGroups` 对应到原图资源，否则转换为“原配图暂未恢复”。聊天实体转换为名称。内部引用可由带明确引用编号的 `citations` / `annotations` 或经原页面上下文校验的 `citationGroups` 恢复；无法对应的链接仍在原位置标记缺失。原有机构首页链接保留，但不当作具体报道证据。结构、采集要求与命令见 [图片与引用](#图片与引用)。

## 同步命令

所有原始输入先放入已忽略的 `incoming/`；有多页时，将全部页面文件一并传给 `archive:prepare`，默认生成 `incoming/source-export.json`。

```powershell
npm run archive:prepare -- incoming/thread-page.json
npm run archive:sync -- incoming/source-export.json

# 普通 Markdown 需配套 briefing.md.receipt.json
npm run archive:sync -- incoming/briefing.md

# 原稿修订先生成私有差异，审阅后才接受
npm run archive:sync -- incoming/source-export.json --accept-revisions

# 中断后仅清理已退出进程的锁，再恢复批次
npm run archive:sync -- --unlock
npm run archive:sync -- --recover
```

无变化不重写文件，也不要求构建或发布；有待审阅差异时保留现有内容。保存后的检查与发布见 [开发与发布](DEVELOPMENT.md)。

`npm run import -- incoming/normalized.md` 用于已转换内容的人工恢复。使用 `--replace` 时，内容修订必须递增、增加更正说明并保留原新闻编号。恢复后若来源摘要不一致，需审阅来源差异并恢复相应回执，不用强制覆盖消除冲突。

## 内容文件

路径为 `content/briefings/YYYY/MM/YYYY-MM-DD.md`。使用 JSON frontmatter，新闻正文使用 `## <stable-id>` 分段。字段白名单阻止私有元数据进入公开产物。

| 字段                          | 规则                                                 |
| ----------------------------- | ---------------------------------------------------- |
| `id`、`briefingDate`、`title` | 稳定编号、正文日期与原标题                           |
| `intro`、`outro`              | 保留原导语与结语 Markdown                            |
| `summary`、`summaryKind`      | 原文没有摘要时直接摘录，标为 `excerpt`               |
| `revision`、`formatRevision`  | 内容及格式分别计数，格式更新不伪装成原稿变化         |
| `corrections`                 | 日期、说明、`source` / `format` / `cross-issue` 类型 |
| `status`、`sample`            | `draft` 或 `published`；生产构建拒绝示例             |
| `stories`                     | 按原顺序保存新闻元数据                               |

新闻保留标题、正文、可空事件日期、来源。标签与机构允许空数组。自动标签仅根据标题中的明确词项映射：AI / Agent / 模型 → AI 与大模型；游戏 / Unity / Unreal → 游戏与交互；芯片 / GPU / CUDA → 科技行业；论文 / 科学 / 证明 → 机器学习；Coding / MCP / Skills → 开发工具。机构只匹配代码内列出的名称。没有分类信息也能全文检索。

正文无需三个固定小标题。支持 Markdown 标题、列表、表格、代码块、`$...$` / `\(...\)` 行内公式、`$$...$$` / `\[...\]` 块级公式。原始 HTML 禁用，代码块中的 HTML 保留为代码；来源与 Markdown 链接接受无凭据 HTTP / HTTPS。图片仅接受 HTTPS 或 `images/` 下的安全本地路径，拒绝路径越界、协议相对地址和脚本 URL。

原图可在正文使用普通 Markdown 图片，或在 `:::gallery` 块中按原顺序排列图片与来源链接。远程原图引用不代表已核验转载许可；不自动下载图片。自托管图片应先确认许可，置于 `public/images/`；原有 `image` 字段仍支持 `path`、`alt`、`caption`、`source`。不搜索替代图或生成新闻配图。

## 增量与恢复

`sourceHash` 只统一换行，不忽略正文、数字、链接或公式。`resourceHash` 独立跟踪图片与引用元数据，补资源只递增 `formatRevision`。后续仅有文本的读取保留同一原稿已有的资源；原文改变后须重新交付资源，以免错配。`archiveHash` 对确定性 Markdown 副本计算；转换器版本独立保存。私有来源映射、资源元数据和摘要只写 `work/archive-sync/`，不入 Git。

同日期不同正文不能覆盖。原消息编辑先生成 `review-YYYY-MM-DD.json` 完整前后差异，再用 `--accept-revisions` 接受。标题或正文完全匹配时复用编号；两者同时变化且无法可靠对应时，回执中提供经过审阅的 `storyMapping`，键为原稿新顺序编号，值为已有新闻编号。增删条目也需人工设计保持旧链接的迁移，默认暂停。

同日更正可以用 `correctionOf` 指向原消息，但仍需差异审阅。跨期更正使用消息中的 `corrections`，每项包含 `targetDate` 和原稿中的精确 `note`；说明必须明确包含目标日期，不确定对应关系时保留待处理。更正追加为独立记录，不改写旧正文。

整个输入批次校验通过后才保存。唯一写入锁覆盖自动同步、人工导入和完整生产构建。私有批次日志先落盘，再逐项保存，最后更新检查点及状态；中断时构建拒绝运行，恢复先核对每个文件是否为批次前或批次后版本。外部编辑不被恢复流程覆盖。

状态丢失时读取私有检查点。检查点也丢失时，不从日期猜测来源对应关系；恢复私有备份或重新审阅来源证据。`--unlock` 仅清理对应进程已退出的锁；活跃写入者不会被解除。

`config/archive-sync.json` 保存执行约定。应用代理负责有限重读；普通 Node 脚本只接受交付的文件，不私自访问对话接口。权限失效时保留当前内容并报告可处理原因，禁止 Cookie 提取、私有接口逆向与生成替代稿。

## 图片与引用

正文与资源分别接收，再转换成可直接渲染的 Markdown。原消息正文不因补资源而改变，新闻编号和内容修订号保持稳定；资源更新计入格式修订。同一资源批次重复导入不会重写文件，后续只读文本也不会清空已恢复的资源。

### 从原页面补入

先取得完整原稿并运行 `archive:prepare`。在已登录的原对话页面，通过正常浏览器操作读取对应助手回答的可见 DOM。对虚拟滚动页面分期读取并保存；展开原图库读取完整图片列表，不能只取预览的前三张。组合引用只能导入实际读到的链接，不能把 `+1` 猜成另一篇报道。

把采集结果存入忽略的 `incoming/browser-resources.json`：

```json
{
  "messages": [
    {
      "messageId": "original-message-id",
      "title": "AI & Tech Briefing · 2026-09-08",
      "stories": [
        {
          "title": "1. 原新闻标题",
          "images": [{ "url": "https://example.org/original.jpg" }],
          "citations": [
            {
              "title": "原来源名称",
              "url": "https://example.org/article",
              "context": "包含该引用的原页面完整段落文本"
            }
          ]
        }
      ]
    }
  ],
  "galleries": [
    {
      "messageId": "original-message-id",
      "story": 1,
      "images": [
        {
          "url": "https://example.org/original.jpg",
          "alt": "原图片描述",
          "caption": "原图片标题",
          "sourceUrl": "https://example.org/image-source"
        }
      ]
    }
  ]
}
```

`stories`、`citations` 和图库图片保持原页面顺序。`images` 记录正文是否实际显示原图，`galleries` 保存展开后的完整图库；原文只有图片查询描述而页面未输出图片时，两者为空。`sourceUrl` 优先使用图片详情显示的来源页，未取得来源页时可保留原图 URL 作为图片入口，不据此声称许可已核验。不要将新闻文章、头像、图标或无关页面图片当作原配图。

```powershell
npm run archive:resources -- incoming/source-export.json incoming/browser-resources.json
npm run archive:sync -- incoming/resource-export.json
```

资源导入器校验消息对应关系、简报及新闻标题、条目数、引用数量与段落上下文、图库数量，并拒绝重复或跨消息图库。任意校验失败均不会输出新的资源批次。引用链接由普通引用入口取得；如果同一原稿中某个引用编号单独出现，可用该明确对应关系补全组合引用。仍无法对应的附加来源保留数量提示。

### 接收结构化资源

JSON 消息可携带以下可选字段，`archive:prepare` 会保留它们：

- `citations`：键为原引用编号，值为 `{ "title": "...", "url": "https://..." }`。
- `annotations`：只接收有明确 `ref_id` / `refId` 的链接引用，不以数组下标推测编号。
- `imageGroups`：键由 `imageGroupKey` 对原 `image_group` JSON 计算，值为上述图片对象数组；本地图片可用 `path: "images/example.webp"` 代替 `url`。
- `citationGroups`：键由 `resourceHash` 对原引用组字符串计算，值为 `{ "links": [...], "missing": 0 }`。用于已有完整上下文对应证据、但无法逐个识别内部编号的来源组。

这些映射仅进入私有同步状态，公开 Markdown 只含可用图片、链接和缺失提示。查询词不是原图地址，内部引用编号也不是可访问网址。导入不调用私有对话接口，不读取 Cookie 或登录凭据。

### 展示与检查

正文图片保留替代文本，懒加载且不发送 Referer；图库切换、大图预览和键盘交互见 [阅读与搜索](READER.md#图片阅读)。图片请求失败时显示提示并保留原图入口与来源说明。链接以新标签页打开，并设置 `noopener noreferrer`。本地图片路径随 `NEXT_PUBLIC_BASE_PATH` 正确加前缀。

导入后执行 [开发检查](DEVELOPMENT.md#检查与测试)，并在浏览器核对图库和链接。远程图片由原站提供，可能失效；恢复原图链接不代表已经取得自托管许可。需要长期保存原图时，先确认许可，再交付本地图片路径。
