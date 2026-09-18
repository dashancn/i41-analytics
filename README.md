# i41 匿名工具统计

`stats.i41.cn` 的 Cloudflare Worker，为 i41 免费工具生态记录最小化匿名事件。

仅接受三个事件：`page_view`、`ecosystem_click`、`primary_product_click`。数据写入 Workers Analytics Engine 数据集 `i41_tool_events`。

不接收或保存本站工具中的文件、文件名、表单内容、剪贴板内容、OCR 内容、密码、提取码、Cookie、浏览器指纹或永久用户 ID、完整 User-Agent、原始 IP。仅当外部来源网站实际把搜索关键词放进 referrer URL 时，才按下述规则记录该外部来访关键词。客户端统计失败不会阻止页面使用或导航。

关于 URL 需要区分两类：**本站 URL** 仅会上报四个受枚举约束的 UTM 归因值；其他查询参数、完整查询串与 hash 一律不上报，路径只保留白名单字符校验后的标准化 `path`；**外部来源 URL** 会在清理后保存，用于分析访客从哪里来。

## 外部来访

首次 `page_view` 读取 `document.referrer`，即访客进入 i41 之前所在的页面，不涉及当前落地页地址。`i41.cn`、`www.i41.cn` 与六个工具子域视为 `internal`，只记录类型、不保存任何 URL。仅接受 `http`/`https` 来源，其余（如 `android-app:`、`javascript:`、`data:`、`file:`）整条丢弃。

外部来源 URL 的清理规则：删除用户名、密码与 fragment；删除名称包含 `token`、`code`、`password`、`passwd`、`key`、`secret`、`signature`、`sig`、`auth`、`session`、`email`、`phone`、`invite`、`reset` 的查询参数（因此 `access_token`、`api_key`、`reset_code` 等同样命中），其余参数保留；URL 总长上限 500，超长则丢弃查询串，仍超长则只保留域名。搜索关键词仅从来源 URL 已有的 `q`、`query`、`wd`、`word`、`keyword`、`kw`、`p` 参数解析，长度上限 100。

**关键词仅在来源网站实际提供时可见。** Google、百度、Bing 在多数情况下只发送 origin 级 referrer，因此大部分搜索来访没有关键词，这是正常现象，不应视为数据缺失。

来访时间使用 Analytics Engine 自带的 `timestamp`，客户端不发送任何时间字段。SPA 的后续 hash 路由切换和点击事件不携带来源信息。服务端会重新校验协议、host 与 `referrer_host` 是否一致、敏感参数、长度与控制字符，`internal` 或空来源不允许携带 URL 与关键词。

六个固定站点 ID 为 `tools`、`imgzip`、`pdf`、`idphoto`、`watermark`、`clip`。客户端只发送经过白名单字符校验的标准化路径：普通站点使用 `location.pathname`，hash 路由站点可将 `#/tool-slug` 记录为 `/tool-slug`；查询参数和非路由 hash 永不进入路径字段。

统计面板 API 除总览、站点、趋势、站内入口位置和导流外，还按 `site + path` 聚合页面访问，并提供“外部来源域名”聚合与“最近外部来访”明细（固定 SQL、固定 LIMIT，不接受任意查询）。面板中的“工具访问”和“跨站导流”可按站点筛选，但页面访问、点击等总览指标始终保持所选时间范围的全站汇总。已知工具显示中文名称，未知安全路径仍以“站点 + 路径”显示。

新增、删除或重命名工具时，应同步更新 `public/dashboard.js` 的路由名称表和对应测试，确保 `stats.i41.cn` 与六个工具站保持一致。

## 数据列

- `index1`: 站点
- `blob1`: 站点
- `blob2`: 事件
- `blob3`: 标准化路径
- `blob4`: 目标站点
- `blob5`: 展示位置
- `blob6` 至 `blob9`: 允许的 UTM 字段
- `blob10`: 来源类型（`internal` / `external` / 空）
- `blob11`: `referrer_host`
- `blob12`: 清理后的 `referrer_url`
- `blob13`: `referrer_keyword`
- `double1`: 计数值 1

`blob10` 至 `blob13` 追加在原有列之后，旧数据这些列为空，仪表盘查询以 `blob10 = 'external' AND blob11 != ''` 排除历史空字段。

## 测试与部署

```bash
npm test
npm run deploy
```

前端公共脚本位于 `public/analytics.js`，部署后通过 `https://stats.i41.cn/analytics.js` 供六个工具站引用。普通页面按 pathname 记录工具路径；PDF Hash Router 仅对当前允许的工具路由在每次实际变化时记录一次标准化路径，并忽略重复、未知或异常路由、查询参数与非路由 hash。

MIT License
