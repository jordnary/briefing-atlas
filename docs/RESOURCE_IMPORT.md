# 图片与引用导入

正文与资源分别接收，再转换成可直接渲染的 Markdown。原消息正文不因补资源而改变，新闻编号和内容修订号保持稳定；资源更新计入格式修订。同一资源批次重复导入不会重写文件，后续只读文本也不会清空已恢复的资源。

## 从原页面补入

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

## 接收结构化资源

JSON 消息可携带以下可选字段，`archive:prepare` 会保留它们：

- `citations`：键为原引用编号，值为 `{ "title": "...", "url": "https://..." }`。
- `annotations`：只接收有明确 `ref_id` / `refId` 的链接引用，不以数组下标推测编号。
- `imageGroups`：键由 `imageGroupKey` 对原 `image_group` JSON 计算，值为上述图片对象数组；本地图片可用 `path: "images/example.webp"` 代替 `url`。
- `citationGroups`：键由 `resourceHash` 对原引用组字符串计算，值为 `{ "links": [...], "missing": 0 }`。用于已有完整上下文对应证据、但无法逐个识别内部编号的来源组。

这些映射仅进入私有同步状态，公开 Markdown 只含可用图片、链接和缺失提示。查询词不是原图地址，内部引用编号也不是可访问网址。导入不调用私有对话接口，不读取 Cookie 或登录凭据。

## 展示与检查

正文图片保留替代文本，懒加载且不发送 Referer；图库支持触摸滑动和键盘横向滚动。图片请求失败时显示提示并保留原图入口与来源说明。链接以新标签页打开，并设置 `noopener noreferrer`。本地图片路径随 `NEXT_PUBLIC_BASE_PATH` 正确加前缀。

导入后运行测试、类型检查、lint、构建与 `verify:build`，并在浏览器核对图库和链接。远程图片由原站提供，可能失效；恢复原图链接不代表已经取得自托管许可。需要长期保存原图时，先确认许可，再交付本地图片路径。
