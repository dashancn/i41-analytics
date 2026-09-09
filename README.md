# i41 匿名工具统计

`stats.i41.cn` 的 Cloudflare Worker，为 i41 免费工具生态记录最小化匿名事件。

仅接受三个事件：`page_view`、`ecosystem_click`、`primary_product_click`。数据写入 Workers Analytics Engine 数据集 `i41_tool_events`。

不接收或保存文件、文件名、用户输入、剪贴板内容、OCR 内容、密码、提取码、查询字符串、Cookie、指纹或永久用户 ID、完整 User-Agent 或原始 IP。客户端统计失败不会阻止页面使用或导航。

六个固定站点 ID 为 `tools`、`imgzip`、`pdf`、`idphoto`、`watermark`、`clip`。客户端只发送经过白名单字符校验的标准化路径：普通站点使用 `location.pathname`，hash 路由站点可将 `#/tool-slug` 记录为 `/tool-slug`；查询参数和非路由 hash 永不进入路径字段。

统计面板 API 除总览、站点、趋势、来源和导流外，还按 `site + path` 聚合页面访问。面板中的“工具访问”和“跨站导流”可按站点筛选，但页面访问、点击等总览指标始终保持所选时间范围的全站汇总。已知工具显示中文名称，未知安全路径仍以“站点 + 路径”显示。

新增、删除或重命名工具时，应同步更新 `public/dashboard.js` 的路由名称表和对应测试，确保 `stats.i41.cn` 与六个工具站保持一致。

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
