# 简报内容规范

每期使用一个 Markdown 文件。文件名、`briefingDate` 与目录日期一致。归档时区固定为 `Asia/Shanghai`；`eventDate` 是新闻发生日期，两者分别保存。

```markdown
---
{
  "id": "briefing-2026-09-09",
  "briefingDate": "2026-09-09",
  "title": "本期主线",
  "summary": "简要说明本期值得关注的内容。",
  "publishedAt": "2026-09-09T08:00:00+08:00",
  "updatedAt": "2026-09-09T08:00:00+08:00",
  "status": "draft",
  "sample": false,
  "stories": [
    {
      "id": "research-topic-followup",
      "title": "具体新闻标题",
      "summary": "一句话摘要。",
      "eventDate": null,
      "tags": ["AI 与大模型"],
      "entities": ["机构名称"],
      "sources": [],
      "verificationStatus": "pending",
      "verificationNote": "待补充原始报道并核对。"
    }
  ]
}
---

## research-topic-followup

### 发生了什么

填写能够得到来源支持的事实。

### 为什么重要

说明影响，并区分事实与解读。

### 实践或研究启示

记录可检验的实践建议。
```

`id` 必须为小写字母、数字与连字符组成的稳定编号。新闻编号在整个档案中唯一，调整条目排序时不要修改它。更正同一条新闻时保留编号；同一事件的新进展使用新编号，可用 `relatedEventId` 关联。

核验状态为 `pending`、`verified` 或 `correction`，必须配套说明。发布状态为 `draft` 或 `published`。真实内容应设置 `sample: false`；只切换此字段不会让示例成为真实新闻。

来源结构：

```json
{
  "title": "Attention Is All You Need",
  "url": "https://arxiv.org/abs/1706.03762",
  "type": "paper",
  "publishedAt": "2017-06-12"
}
```

来源类型支持 `paper`、`official`、`report`。使用具体文章链接，不能用机构首页冒充来源。缺失来源允许以待核验状态导入，不允许标记为已核验。示例论文及发生日期已核对原始摘要页面，实践建议为编辑整理。

正文支持标题、列表、链接、代码块、表格和 `$W = W_0 + BA$` 形式的行内数学公式。为减少导入风险，禁用原始 HTML、危险 URL 与聊天引用标记。正文图片语法会呈现说明；需要实际配图时使用下面的字段，并将文件放入 `public/images/`：

```json
{
  "image": {
    "path": "images/research-diagram.png",
    "alt": "图中关系的文字描述",
    "caption": "图片说明",
    "source": "作者及授权来源"
  }
}
```

缺失图片会显示文字占位，避免断图与页面跳动。导入前确认图片使用权限。

新增内容优先在 `incoming/` 等临时目录完成审阅，再运行导入命令。不要把私人聊天、密钥、账号信息或生产数据放入内容。导入完成后执行校验、构建与 Git 提交，再按已确认的访问范围发布。
