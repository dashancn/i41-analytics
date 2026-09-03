# i41 匿名工具统计

`stats.i41.cn` 的 Cloudflare Worker，为 i41 免费工具生态记录最小化匿名事件。

仅接受三个事件：`page_view`、`ecosystem_click`、`primary_product_click`。数据写入 Workers Analytics Engine 数据集 `i41_tool_events`。

不接收或保存文件、文件名、剪贴板内容、OCR 内容、密码、提取码、Cookie、永久用户 ID、完整 User-Agent 或原始 IP。客户端统计失败不会阻止页面使用或导航。

## 数据列

- `index1`: 站点
- `blob1`: 站点
- `blob2`: 事件
- `blob3`: 标准化路径
- `blob4`: 目标站点
- `blob5`: 展示位置
- `blob6` 至 `blob9`: 允许的 UTM 字段
- `double1`: 计数值 1

## 测试与部署

```bash
npm test
npm run deploy
```

前端公共脚本位于 `public/analytics.js`，部署后通过 `https://stats.i41.cn/analytics.js` 供六个工具站引用。

MIT License
