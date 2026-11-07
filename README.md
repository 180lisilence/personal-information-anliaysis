# personal-information-anliaysis

> 个人信息聚合工具集：输入手机号 / 身份证 / 用户名 / 邮箱等片段，从公开网络聚合出更完整的个人信息画像。
> 本地运行 · 公开数据源 · 合规红线内置（排除政府/党政军/公检法国安类站点）。

仓库包含三套实现，共享同一套设计理念：

| 模块 | 形态 | 技术栈 | 说明 |
|------|------|--------|------|
| `crawler/` | 桌面爬虫 | Python + tkinter + requests/bs4 | 输入网址抓取正文/标题/链接为 txt，GUI + CLI |
| `apk/` | 手机爬虫 App | Java + aapt2/d8/apksigner | 33KB 自签名 APK，纯 java.* 实现，免存储权限 |
| `osint-desktop/` | 聚合桌面客户端 | Electron + Node + Python | 手机号/身份证/用户名/邮箱聚合，关系图谱 + 报告导出 |

详见 **[`index.html`](./index.html)**（项目介绍页，含下载按钮与原理说明）。

## 目录

- [`OSINT桌面客户端_方案.md`](./OSINT桌面客户端_方案.md) — 聚合客户端技术方案
- [`crawler/README.md`](./crawler/README.md) — 桌面爬虫使用与打包
- [`apk/README.md`](./apk/README.md) — Android 爬虫构建与安装
- [`osint-desktop/README.md`](./osint-desktop/README.md) — 聚合客户端说明

## 下载

```bash
# 克隆（main 分支）
git clone https://github.com/180lisilence/personal-information-anliaysis.git
```

或直接在仓库页面下载源码 ZIP。`third_party/` 已内置 holehe、maigret、sherlock、phonedata，无需再拉取。

## 合规边界

- 数据源白名单**排除** `.gov.cn` / `.gov` / `.mil.cn` 等政府、党政军、公检法国安类站点，绝不触碰。
- 只聚合**公开可访问**的数据；不内置、不引导对接任何需授权密钥才能访问的私密泄露库。
- 速率控制、代理、UA 随机化由配置项控制，避免把目标站点打挂。

## 构建产物说明

仓库仅包含源码（已剔除 `node_modules`、`dist`、`out`、构建产物与抓取输出）。各子项目按各自 README 构建：

```bash
# crawler → WebCrawler.exe
cd crawler && 双击 build_exe.bat

# apk → WebCrawler.apk
cd apk && python build.py

# osint-desktop → Windows 安装包
cd osint-desktop && npm install && npm run dist
```
