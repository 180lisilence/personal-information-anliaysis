# 个人信息聚合工具（Windows 桌面客户端）

输入手机号 / 身份证号 / 用户名 / 邮箱，聚合公开网络信息，输出结构化人物画像。

## 运行方式

**方式 A：开发模式（需 Node）**
```bash
npm run start        # 启动 Electron 客户端（内置后端自动拉起）
npm run server       # 或仅启动后端服务（http://localhost:3999）
```

**方式 B：打包成安装版**
```bash
npm run build -- --win
```
在 `dist/` 下生成 NSIS 安装包，安装后即可使用。首次打包需下载 electron 分发包（耗时数分钟，可后台执行）。打包期间不要中断，否则需重新下载。

国内网络建议用镜像加速：
```bash
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
npm run build -- --win
```

启动逻辑已内置 `disable-gpu` / `no-sandbox` 等开关，虚拟机、无显卡或受限环境下也能起来（否则 GPU 进程崩溃会导致 Electron 直接退出）。

## 数据源

| 数据源 | 类型 | 说明 |
|--------|------|------|
| `phone` | 离线 | 手机号归属地、运营商、邮编、区号（基于 phonedata 离线库，2025 版数据） |
| `idcard` | 离线 | 身份证解析：省/市、出生日期、年龄、性别、生肖、星座、校验位验证 |
| `online-phone` | 在线 | 搜索引擎公开足迹检索（Bing / 百度 dork） |
| `online-username` | 在线 | 用户名 / 邮箱的公开足迹检索 |
| `maigret-social` | 在线 | 用户名跨 3000+ 站点搜索（需 Python + Maigret 依赖） |
| `holehe-email` | 在线 | 邮箱在 120+ 站点的注册检测（需 Python + holehe） |

新增数据源：在 `src/scanners/` 下新建插件，继承 `base.js` 的 `Scanner`，实现 `canHandle()` 与 `scan()` 即可，服务启动时自动加载。

## 目录结构

```
electron/       Electron 主进程与预加载
server/         本地后端（Express + 数据源加载）
src/scanners/   数据源插件
src/core/       聚合引擎（config / profile / session / telegram / limiter
                / mytelegram 凭据申请 / net 代理 / recon 侦察 / breach 突破 / dict 字典）
renderer/       前端界面（图谱 + 表格 + 导出）
data/phone.dat  手机号归属地离线库
third_party/    复用的开源项目源码
config.json     配置（端口、UA、速率、自定义源）
```

## 可选：启用 Python 系数据源

`maigret-social` / `holehe-email` 依赖 Python 环境：

```bash
python -m pip install -r third_party/maigret/requirements.txt
python -m pip install holehe
```

未安装时这两个源会优雅降级（提示缺失），不影响其余数据源。

## 配置（config.json）

- `server.port`：本地服务端口
- `userAgent`：请求 UA
- `rateLimit.maxPerMinute`：速率上限
- `dataSources.excludeGov`：排除政府类站点（默认开启，不触及）
- `dataSources.custom`：自定义数据源列表

## 最终产出：个人档案

界面顶部"个人档案"卡片突出显示四个核心字段：

| 字段 | 来源 |
|------|------|
| 姓名 | 非公开数据源（`targets`）返回 |
| 户籍 / 生活住址 | 非公开数据源返回；未配置时回退为身份证解析出的户籍区县 |
| 电话号 | 输入本身是手机号时直接填入，或来自非公开源 |
| 身份证号 | 输入本身是身份证时直接填入，或来自非公开源 |

**关于"详细到街道"的住址**：身份证号只编码到**区县**（前 6 位地区码），街道/门牌不在其中，公开渠道也拿不到。要得到街道级住址，必须由 `targets` 配置的非公开数据源返回——工具会把源里叫「住址 / 地址 / 详细地址 / address」等任意别名的字段自动归集到"住址"。

字段别名可在 `config.json` 的 `profileMap` 自定义。例如你的源返回 `custName`，把它加进 `profileMap.name` 即可：

```json
"profileMap": {
  "name": ["姓名", "custName"],
  "address": ["住址", "详细地址"],
  "phone": ["电话", "mobile"],
  "idcard": ["身份证号", "idNo"]
}
```

## 非公开数据源（需登录态）

用于抓取需要登录/授权才能看到的信息。目标接口与凭据由你自己填写，工具不内置任何站点或第三方凭据。

在 `config.json` 的 `targets` 数组里配置：

| 字段 | 说明 |
|------|------|
| `enabled` | 是否启用（默认 false，启用前先填好 url/headers） |
| `type` | 触发的输入类型：`phone` / `idcard` / `email` / `username` / `any` |
| `method` | `GET` 或 `POST` |
| `url` | 目标地址，用 `{input}` 占位符代入输入值 |
| `headers` | 请求头，`Cookie` / `Authorization` 填你自己的登录态 |
| `body` | POST 请求体（字符串或 JSON，同样支持 `{input}`） |
| `extract` | 提取规则，键为显示名，值为规则 |
| `timeout` | 超时（毫秒） |

提取规则写法：

- `json:data.name` — JSON 响应按路径取值
- `regex:姓名[:：]\s*([^\s<]+)` — 正则捕获（取第 1 个捕获组）
- `css:.addr` / `css:#mobile` — 按 class / id 提取元素文本
- 其他 — 返回响应原文前 500 字符

示例（把 `enabled` 设为 `true`、替换为你自己的地址与 Cookie 即可生效）：

```json
{
  "name": "后台用户查询",
  "enabled": true,
  "type": "phone",
  "method": "GET",
  "url": "https://your-site.example/api/user?phone={input}",
  "headers": { "Cookie": "sessionid=xxxx" },
  "extract": { "姓名": "json:data.name", "地址": "json:data.address" }
}
```

抓取结果会在界面的 `custom-auth` 卡片里按字段名展示，并附带 HTTP 状态码。

## 人员身份查询源（拿到姓名 + 街道住址）

新增 `people-lookup` 数据源，已预置 5 个能返回「姓名 + 详细住址」的非公开服务模板，**填入自己的 API key 并把 `enabled` 设为 `true` 即可用**（`config.json` 的 `lookupProviders`）：

| 服务 | 覆盖范围 | 能返回 |
|------|---------|--------|
| `whitepages` | 美国号码 | 姓名 + 当前住址（含街道） |
| `thedatagroup` | 美国号码 | 姓名 + 门牌/街道/城市/州/邮编（拼接为街道级） |
| `dehashed` | 全球泄露库 | 姓名、住址、电话 |
| `leakcheck` | 全球泄露库 | 姓名、住址、电话 |
| `intelx` | 泄露/暗网 | 姓名、住址 |

字段提取支持两种写法：
- `{ "path": "0.name" }` —— 按 JSON 路径取单字段（数组用 `0` 索引）
- `{ "combine": ["Address.House","Address.Street"] }` —— 多字段拼接（美国源的地址是分字段的）

**关于中国手机号/身份证**：公开渠道拿不到姓名和街道住址，Whitepages / DataGroup 只覆盖美国号码。国内数据的现实来源是泄露库（dehashed / leakcheck / intelx 收录了大量国内泄露数据）、Telegram 查档机器人，或你自己的数据源（`targets`）。

### 网页版人搜源（无需 API key，抓 HTML）

`format: "html"` + `requireKey: false` 的 provider 直接抓网页按正则抠字段，已预置 4 个美国免费人搜站（姓名 → 街道级住址）：

| 服务 | 地址 |
|------|------|
| `thatsthem` | https://thatsthem.com/name/{input} |
| `fastpeoplesearch` | https://www.fastpeoplesearch.com/name/{input} |
| `truepeoplesearch` | https://www.truepeoplesearch.com/results?name={input} |
| `searchpeoplefree` | https://www.searchpeoplefree.com/find/{input} |

这些站会频繁改版，正则要按实际页面调整。字段规则除了 `{ path }` / `{ combine }` 之外，新增 `{ "regex": "...", "flags": "i" }` 直接从 HTML 文本抠值。

## Telegram 社工库机器人（户籍 / 快递地址 / 全家户籍查询）

目标形态：Telegram 上的查档机器人/群组——发手机号或身份证号给机器人，它返回户籍地址、快递收货地址、姓名等。

**为什么必须用 MTProto**：Telegram Bot API 只能操作"自己的机器人"，无法以账号身份给别的机器人发消息。要自动向查档机器人发查询并读回复，必须用 **MTProto 协议以账号身份登录**（本工具用 GramJS 实现）。

### 一键获取 apiId / apiHash（不用开网页手抄）

my.telegram.org 的网页背后就是几个普通 HTTP 接口，工具已把它脚本化（`src/core/mytelegram.js`）：

```
POST /auth/send_password   {phone}            → random_hash（Telegram 同时发来登录码）
POST /auth/login           {phone,random_hash,password=登录码} → 会话 Cookie
POST /apps/create          {app_title,app_shortname,app_platform,...} → api_id / api_hash
GET  /apps                                    → 已有应用（已有就直接读，不再新建）
```

界面里就是三步：**填代理 → 填手机号点「发送登录码」→ 填登录码点「自动申请并回填」**。拿到后自动写进 `telegram.apiId` / `telegram.apiHash` 并回填到输入框。不确定代理能不能通，先点「测试连通性」。

### 界面内完成（推荐，不用手改文件）

打包版 `config.json` 在 app.asar 内只读，所以界面改动统一写到 **userData 目录**（`%APPDATA%\osint-desktop\config.json`），启动时与内置配置深合并，改完立刻生效、不用重启。

界面底部「Telegram 接入 · 找源」四步：

1. **API 凭据** — 填 apiId / apiHash → 保存
2. **账号登录** — 填手机号（带国际区号）→ 发送验证码 → 填验证码（开了两步验证再填云密码）→ 完成登录。sessionString 自动写入配置
3. **找源** — 输关键词（`社工库` / `查档` / `户籍` / `快递`）点搜索，全站搜出机器人/群组/频道；或点「我已加入的会话」列出现成的。每条结果右侧选类型（手机号/身份证号/姓名反查）后「添加为数据源」，自动写进 `telegram.bots` 并启用
4. **试查** — 填目标 + 查询内容，发送并取回机器人原始回复，界面同时用默认正则抠出 姓名/住址/电话/身份证。抠不出来就按实际回复格式改 `bots[].parse.regex`

（也可命令行登录：`node scripts/tg-login.js`，成功后 sessionString 自动写盘。）

**接入步骤**：

1. 打开 https://my.telegram.org 用你的手机号登录，创建应用，拿到 `api_id` 与 `api_hash`
2. 填进 `config.json` 的 `telegram.apiId` / `telegram.apiHash`
3. 运行登录脚本，按提示输入手机号、验证码（有两步验证再输密码）：
   ```bash
   node scripts/tg-login.js
   ```
   脚本会输出一串 `sessionString`，把它填回 `config.json` 的 `telegram.sessionString`
4. 把 `telegram.enabled` 设为 `true`，配置 `bots` 数组：

```json
{
  "name": "户籍查询",
  "enabled": true,
  "type": "idcard",
  "target": "@机器人用户名",
  "queryTemplate": "{input}",
  "waitMs": 10000,
  "parse": {
    "name":    { "regex": "姓名[:：]\\s*([^\\s\\n]+)" },
    "address": { "regex": "(?:住址|户籍地址?|地址)[:：]\\s*([^\\n]+)" },
    "idcard":  { "regex": "(?:身份证号?|证件号)[:：]\\s*([0-9Xx]{15,18})" }
  }
}
```

- `type`：`phone` / `idcard` / `name`（中文姓名）/ `email` / `any`，决定这个机器人对哪类输入生效
- `target`：机器人的 `@用户名`（或群组）
- `queryTemplate`：发给机器人的消息，`{input}` 会替换成你输入的内容（有些机器人要特定指令，如 `/查 {input}`）
- `parse`：用正则从机器人回复里抠字段，直接进"个人档案"卡片

已预置三个模板：**户籍查询**（身份证号→姓名+户籍地址）、**手机查档**（手机号→姓名+快递地址）、**姓名反查**。默认 `enabled: false`，填上真实机器人用户名并启用即可。

**注意**：各机器人返回的排版不同，首次接入时先看一眼机器人实际回复，再按它的格式调整 `parse` 里的正则。

## 批量解析与抓取

界面底部"批量解析与抓取"区域：文本框每行一条（手机号或身份证号，支持逗号分隔取首列），点按钮后逐条执行手机号归属地解析、身份证解析，以及已启用的非公开数据源抓取；结果以表格展示并可导出 CSV。

## 自动登录（抓取非公开数据用）

非公开数据通常要先登录才能取到。配置 `config.json` 的 `login` 后，抓取时会自动换取登录态并注入请求，无需手动粘贴 Cookie：

| 字段 | 说明 |
|------|------|
| `enabled` | 是否启用自动登录（默认 false） |
| `url` | 登录接口地址 |
| `method` / `contentType` | `POST` + `json` 或 `form` |
| `body` | 登录参数（账号密码） |
| `tokenPath` | 从登录响应 JSON 取 token 的路径，如 `data.token` |
| `cookiePath` | 从登录响应 JSON 取 cookie 的路径（留空则取响应头 Set-Cookie） |
| `staticCookie` / `staticToken` | 直接写死凭据（不走登录接口时用） |

登录态自动注入 `targets` 的请求头；`targets` 里若显式写了 Cookie/Authorization，以显式配置为准。

## 网络与代理（国内必看）

`config.json` 的 `proxy` 字段（界面里也能改，改完热生效）：

| 值 | 作用范围 |
|---|---|
| `http://127.0.0.1:7890` / `https://...` | my.telegram.org 申请凭据（自实现 CONNECT 隧道）；在线数据源的 fetch（`undici` ProxyAgent 接管全局 fetch） |
| `socks5://127.0.0.1:7890` 或 `socks5://user:pass@host:port` | 仅 my.telegram.org（自实现 SOCKS5 握手，含用户名密码认证） |

**Telegram 的 MTProto 连接不走上面这个代理**——GramJS 只支持 Telegram 自家的 **MTProxy** 协议。在界面「② 账号登录」里填 MTProxy 的 IP / 端口 / secret（32 位 hex），或直接用系统级 TUN / VPN 模式（那样直连即可，不用填）。

相关接口：`GET /api/net/status`、`GET /api/my/probe`（连通性自检）。

## 日常用法（只要两步）

1. **点一下「开始自动找源」** —— 你什么都不用填。应用自己完成：

   | 阶段 | 做什么 |
   |---|---|
   | ① 搜索 | 10 条搜索词 × 3 个引擎（DuckDuckGo / Bing / 搜狗），从结果页抠候选域名（含 DuckDuckGo `uddg=` 跳转还原），过滤掉搜索引擎与大型平台 |
   | ② 快筛 | 并发探测首页，只留标题/正文像查档站的（命中 `查询/查档/户籍/身份/实名/社工` 等） |
   | ③ 攻破 | 逐个自动：找后台 → 破登录 → 找出查询接口 → **试出它用哪个参数名** → 自动定抽取规则 |
   | ④ 接入 | 真能出数据（特征命中达标）的自动存成数据源 |

   全程后台跑，实时刷日志；跑完告诉你接了几个。

2. **输手机号或身份证号** —— 顶部一个大输入框，出姓名 / 住址 / 电话 / 身份证号。

打不开站？点「自动检测系统代理」（读 Windows 注册表 `Internet Settings\ProxyServer`）自动套用，再点「测试连通性」。

**你已经知道网址时**，才用 ②「接入一个查档站」直接粘。Telegram 找源、手动攻破、批量、一键接管全部收进底部「高级功能」折叠区，**日常不用打开，也不依赖登录 Telegram**。

### 接口

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/discover/start` | POST | 启动自动找源任务，返回 `jobId` |
| `/api/discover/status?id=` | GET | 轮询进度（日志 + 阶段性结果） |
| `/api/discover/stop` | POST | 请求停止 |
| `/api/quick/connect` | POST | 一步接入：给网址，自动攻破并落成数据源 |
| `/api/quick/targets` | GET | 已接入数据源列表 |
| `/api/quick/targets/set` | POST | 启用/停用、改名、改 body/headers/抽取规则 |
| `/api/quick/targets/remove` | POST | 删除 |
| `/api/quick/test` | POST | 用某个源试查一次，回显抽到的字段与原始响应 |
| `/api/net/detect` | GET | 自动检测系统代理（Windows 读注册表 + 环境变量） |
| `/api/net/check` | POST | 连通性自检，分别测直连与走代理 |

## 一键接管（不用手动粘域名）

上面四步手动走通后，可以整条自动化：从 Telegram 搜到社工库机器人 → 读简介抠它官网 → 自动侦察 → 自动破登录 → 扫荡抠 Bot Token → `getMe` 接管 → 盲打查询接口 → 一键导成数据源。

界面「**一键接管**」面板填关键词点开始即可，任务后台运行，实时刷进度日志。

| 参数 | 说明 |
|---|---|
| 关键词 | 默认 `户籍查询,查档,社工库,快递地址,身份查询,常住人口`，Telegram 全站搜 |
| 最多试聊 / 发什么 | 给机器人发一句话（如 `/start`）从回复里抠官网；留 0 则不主动发消息，只读简介 |
| 站点 | 已知官网可直填，多个逗号分隔（也可完全跳过找源，只打已知站） |
| 爆破账号 / 口令 | 留空用内置 10 账号 × 51 弱口令 |
| 最多侦察 / 最多破登录 | 限速，避免打太猛 |
| 探测子域 / 跑完自动导入 | 子域 DNS 探测；自动导入 = 命中接口直接写进 `targets` |

结果分区展示，且**每一行都能回填到下方手动面板继续细调**：站点→①、登录 Cookie→②、Token→③、接口→④。

接口：`POST /api/offsec/autopwn`（启动，返回 `jobId`）、`GET /api/offsec/autopwn/status?id=`（轮询）、`POST /api/offsec/autopwn/stop`、`POST /api/offsec/import`。

## 后台突破（攻破查档站后台 → 接管它的机器人 → 直调其内部接口）

针对市面查档 / 开盒类站点：不需要自己注册 Telegram 应用，直接打它的后台，抠出它机器人（Bot）的 Token 据为己用，并带着登录 Cookie 直调它内部的查询接口。界面上「**后台突破**」面板四步走：

### ① 侦察 `POST /api/offsec/recon`

对一个域名一次摸清攻击面，返回可直接下手的入口：

| 探测项 | 说明 |
|---|---|
| 首页指纹 | 识别 ThinkPHP / Laravel / phpMyAdmin / SpringBoot / WordPress / 帝国CMS / 织梦 等，命中会带版本号 |
| 后台路径 | 35 条后台字典（`/admin`、`/admin.php`、`/houtai`、`/manage` …），命中登录页标 `★登录页` |
| 敏感文件 | 34 条泄露面字典，命中自动分类打标：`.git 泄露`、`.env 泄露`、`数据库备份`、`源码包`、`phpinfo`、`Actuator`、`swagger`、`配置泄露` |
| 子域 | 35 个常见前缀 DNS 解析存活探测（`api.`、`admin.`、`dev.`、`test.` …） |
| 页面 Token | 正则 `\d{8,10}:[A-Za-z0-9_-]{35}` 从页面里抠 Bot Token |
| 链接提取 | 从机器人回复 / 页面里抠官网（含 `t.me`），用于定位后台所在域名 |

结果行上有「**设为登录目标**」按钮，一键把命中的后台地址带到下一步。

### ② 破登录

- **弱口令爆破** `POST /api/offsec/brute` —— 51 条弱口令 × 10 个常见用户名（admin / administrator / root / test …），自动抓取登录页里的隐藏字段（`_token`、`__hash__`、CSRF）随表单一起提交。
  判定用**基线对比法**：先发一个随机密码建立基线，再比较 status / 响应长度 / Set-Cookie / Location 跳转，并叠加成功关键词（`登录成功`、`welcome`、`dashboard`…）与失败关键词（`密码错误`、`验证码错误`…）打分，避免"页面长度一样就漏判"。
- **万能口令注入** `POST /api/offsec/sqli` —— 15 条 SQL 注入载荷（`admin' or '1'='1`、`admin' --`、`' or 1=1#` …），用户名与密码两个位置各打一遍。
- **JWT 伪造** —— 抓到 JWT 后可 `alg=none` 重签（`jwtForge`）。

命中结果行上有「**带入下一步**」按钮，把拿到的 Cookie 直接填到第 ④ 步。

### ③ 接管机器人

- `POST /api/offsec/tokens` —— 从后台页面 / `.env` / 配置文件里抠 Bot Token
- `POST /api/offsec/bot` —— 直连 `https://api.telegram.org/bot<token>/<method>`：
  - `getMe` 验证 Token 归属（会回显它机器人的 `@username`，确认已接管）
  - `getUpdates` 读它的消息（能看到别人发给它的查询请求和它回的档案）
  - `sendMessage` 直接**用它的机器人发消息**
  - `getWebhookInfo` / `setWebhook` 看它回调挂在哪，必要时摘掉 webhook 独占

### ④ 直调接口 `POST /api/offsec/call` / `POST /api/offsec/loot`

- `call` —— 带上登录 Cookie / 自定义 Headers / Body（JSON 或表单），直调站内的查询接口
- `loot` —— 登录后自动扫荡：遍历后台页面抠 Token + **盲打** `/api/query`、`/api/search`、`/index.php/api/query`、`/api/order/list` 等查询类路径，把能返回数据的接口挑出来
- 命中后点「**导入为数据源（targets）**」，把该接口写进 `config.json`，回到顶部主界面就能当普通数据源一样查手机号 / 身份证

字典可查看与替换：`GET /api/offsec/dict`。

## 本地接口（后端运行在 http://127.0.0.1:3999）

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/scan` | POST | 单条查询，返回各源结果与归集后的 `standard` 档案 |
| `/api/batch` | POST | 批量查询（`items` 数组） |
| `/api/health` | GET | 已加载的数据源列表 |
| `/api/config` | GET / POST | 读 / 写运行时配置（POST 为深合并 patch） |
| `/api/config/reset` | POST | 恢复默认配置 |
| `/api/net/status` | GET | 当前代理与 MTProxy 配置 |
| `/api/my/probe` | GET | 测试 my.telegram.org 连通性 |
| `/api/my/send-code` | POST | 向 my.telegram.org 提交手机号，索取登录码 |
| `/api/my/verify` | POST | 登录码 → 自动读/建应用 → 返回并保存 apiId / apiHash |
| `/api/my/apps` | GET | 列出 my.telegram.org 上已有应用 |
| `/api/tg/status` | GET | Telegram 就绪状态、已配置的机器人 |
| `/api/tg/send-code` | POST | 发送登录验证码 |
| `/api/tg/sign-in` | POST | 验证码 + 云密码完成登录，产出 sessionString |
| `/api/tg/discover` | POST | 关键词全站搜索机器人 / 群组 / 频道 |
| `/api/tg/dialogs` | GET | 当前账号已加入的会话 |
| `/api/tg/probe` | POST | 向指定机器人发一条查询并原样返回回复 |
| `/api/offsec/recon` | POST | 侦察：指纹 + 后台/敏感文件路径 + 子域 + 页面 Token |
| `/api/offsec/brute` | POST | 弱口令爆破（基线对比判定，自动带隐藏字段） |
| `/api/offsec/sqli` | POST | 万能口令 SQL 注入登录 |
| `/api/offsec/tokens` | POST | 从 URL 或文本里抠 Telegram Bot Token |
| `/api/offsec/bot` | POST | 直调 `api.telegram.org/bot<token>/<method>`（getMe / getUpdates / sendMessage / setWebhook） |
| `/api/offsec/call` | POST | 带 Cookie/Headers 直调目标接口 |
| `/api/offsec/loot` | POST | 登录后扫荡：抠 Token + 盲打查询类接口 |
| `/api/offsec/dict` | GET | 查看内置字典规模 |
| `/api/offsec/autopwn` | POST | 启动一键接管任务，返回 `jobId` |
| `/api/offsec/autopwn/status?id=` | GET | 轮询任务进度（steps 日志 + 阶段性结果） |
| `/api/offsec/autopwn/stop` | POST | 请求停止任务 |
| `/api/offsec/import` | POST | 把扫到的接口批量导入 `targets` |

## 测试脚本

| 脚本 | 覆盖 | 结果 |
|---|---|---|
| `node test-offsec.js` | 后台突破：路径分类、指纹、字典、Token 正则 | 27/27 |
| `node test-offsec-live.js` | 本地靶站端到端：侦察 → 爆破 → 注入 → 扫荡 → 直调出档案 | 16/16 |
| `node test-exe-smoke.js` | 打包后 exe 的 `/api/offsec/*` 全链路冒烟（需先启动 exe） | 13/13 |
| `node test-connect.js` | 一步接入端到端 + **抓到的字段能否浮到档案**（关键回归） | 18/18 |
| `node test-discover.js` | 自动找源：URL 还原 / 快筛 / 全流程自动接入 | 14/14 |
| `node test-quick.js` | 极简主区接口：connect / targets / test / 网络 | 19/19 |
| `node test-autopwn.js` | 一键链条端到端：侦察 → 破登录 → 扫荡 → 接管 → 导入 targets | 15/15 |
| `node test-mt.js` | MTProxy 配置与 my.telegram.org 应用解析 | 12/12 |
| `node test-scanners.js` / `test-api.js` / `test-full.js` / `test-lookup.js` / `test-batch.js` | 数据源与查询主链路 | — |
| `node scripts/check-asar.js` | 校验 dist 内 asar 是否打入全部核心模块 | — |

## 注意事项

- 本工具为本地运行的数据聚合客户端，数据源由使用者自行配置。
- 政府/党政军/公检法类站点不在采集范围内（`dataSources.excludeGov` 默认开启）。
- 搜索引擎源受反爬限制，必要时在 `config.json` 配置代理与限速。
- 结果默认仅存本地，不上传。

## 复用的开源项目

- [xluohome/phonedata](https://github.com/xluohome/phonedata) — 手机号归属地离线库
- [conzi/phone](https://github.com/conzi/phone) — 参考实现
- [soxoj/maigret](https://github.com/soxoj/maigret) — 用户名跨站搜索
- [sherlock-project/sherlock](https://github.com/sherlock-project/sherlock) — 用户名搜索
- [megadose/holehe](https://github.com/megadose/holehe) — 邮箱注册检测
- [OSINTool](https://gitee.com/djchanahcjd/osintool) — 桌面端结构参考
