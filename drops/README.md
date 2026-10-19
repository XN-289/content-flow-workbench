# 本地投递箱

把 `.json`、`.md` 或 `.txt` 文件放到本目录，工作台运行时会自动解析、去重、入库，成功后移入 `processed/`，格式错误则移入 `failed/`。

只是临时粘贴一段内容时，优先使用工作台今日页的“快速粘贴”，不需要先落成文件。

## JSON

```json
{
  "sourceId": "source-001",
  "signals": [
    {
      "url": "https://example.com/post",
      "title": "信号标题",
      "engagement": "5.9万",
      "publishedAt": "2026-10-19T08:00:00+08:00"
    }
  ],
  "materials": [
    {
      "sourceUrl": "https://example.com/post",
      "author": "评论者",
      "type": "hot-comment",
      "excerpt": "热评原文",
      "whyValuable": "受众语言准确",
      "possibleUse": "hook"
    }
  ]
}
```

## Markdown / TXT

```text
sourceId: source-001
url: https://example.com/post
engagement: 5.9万

# 信号标题
备注或原文摘录
```

素材可以用 `kind: material`，正文会作为 `excerpt` 入库。
