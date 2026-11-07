# 网页爬取工具

输入网址，把网页正文、标题、链接抓下来写进 txt。命令行和图形面板两种方式都有。

## 图形面板（推荐）

双击 `run_gui.bat`，面板共 6 项：

| 位置 | 内容 | 说明 |
|------|------|------|
| ① | 链接 | 可输入/粘贴多个网址，用空格、逗号、分号或换行分隔 |
| ② | 命名 | 输出文件名，**留空 = 时间戳命名（精确到秒）**；多个链接自动加 `_01` `_02` 序号 |
| ③ | 输出目录 | 默认 `output/`，可手动改路径 |
| ④ | 文件大小 | 抓取完成后显示，自动换算 B/KB/MB/GB；多文件时显示「N 个文件 / 合计 X」 |
| ⑤ | 选择输出目录 | 按钮，弹出文件夹选择器 |
| ⑥ | 打开输出目录 | 按钮，直接打开资源管理器 |

填好链接点「开始抓取」即可，抓取在后台线程跑，界面不卡；状态栏实时显示进度，完成后 ④ 显示文件大小。

**多链接 = 多个独立文件，不合并。** 输入 3 个网址就生成 3 个 txt：

```
20261001_000250_01.txt
20261001_000250_02.txt
20261001_000250_03.txt
```

每个文件头部带该页的源链接、最终链接、HTTP 状态、抓取时间，正文之间互不干扰。
抓取失败的网址会单独生成 `时间戳_序号_失败.txt`，里面写明失败原因，不影响其他网址。

**输入框支持右键菜单**（剪切 / 复制 / 粘贴 / 全选）和 `Ctrl+A` 全选 —— tkinter 的输入框
默认这两样都没有，已手动补上。三个输入框（链接、命名、输出目录）都可右键。

> 注意：面板用 tkinter，**需要用带 tkinter 的 Python**。本机 `E:\pythonpath\python.exe`（3.14）可用；
> 托管 Python 3.13 没装 tkinter，跑不起来。`run_gui.bat` 会自动检测并提示。

### 双击 run_gui.bat 闪退？（已修复，仅作记录）

原因是 **bat 文件编码**：`.bat` 会被 cmd.exe 按系统 OEM 代码页（中文 Windows 是 GBK）解析，
而文件当时是 UTF-8。中文注释和中文提示全部乱码，乱码字节把命令行撕碎了——
`rem 优先用带 tkinter 的...` 这行直接把下一行的 `set` 吞掉，`start` 那行的引号也被破坏，
所以 GUI 从来没被启动过。

修复办法：**`.bat` 文件保持纯 ASCII**，中文提示交给 Python 端的 messagebox 弹窗。
另外 bat 里不要直接写 `timeout` / `find`，装了 Git for Windows 时会被 `Git\usr\bin` 里的
同名 Unix 命令抢占，要用 `%SystemRoot%\System32\timeout.exe` 这样的绝对路径。

排查手段：

- 面板启动失败时，`gui_error.log` 里会有完整 traceback（gui.py 顶层和 Tk 回调都已接管异常）
- 依赖缺失、crawl.py 加载失败会直接弹中文对话框说明原因
- bat 会在启动 3 秒后检查 pythonw 是否存活，没存活就自动用控制台模式重跑并 pause，把错误显示出来

## 命令行用法

命令行：

```bash
# 单个网址
python crawl.py https://example.com

# 多个网址，合并写入一个文件
python crawl.py https://a.com https://b.com -o 结果.txt

# 从文件批量读取（每行一个网址）
python crawl.py -f urls.txt -o 批量结果.txt

# 连图片地址一起导出
python crawl.py https://example.com --images

# 同时保存原始 HTML
python crawl.py https://example.com --raw

# 纯 JS 渲染的页面（需要先 pip install playwright && playwright install chromium）
python crawl.py https://example.com --render

# 走代理 / 强制不走代理
python crawl.py https://example.com --proxy http://127.0.0.1:7890
python crawl.py https://example.com --no-proxy
```

网址不带 `http://` 也行，会自动补 `https://`。

## 参数

| 参数 | 说明 |
|------|------|
| `-o, --output` | 输出 txt 文件名，默认按域名+时间戳自动生成 |
| `-f, --file` | 从文本文件读取网址列表 |
| `-d, --outdir` | 输出目录，默认 `output/` |
| `--raw` | 额外保存原始 HTML 文件 |
| `--no-links` | 不导出链接列表 |
| `--images` | 额外导出图片地址 |
| `--timeout` | 超时秒数，默认 20 |
| `--render` | 用无头浏览器渲染 JS 页面 |
| `--proxy` / `--no-proxy` | 指定代理 / 强制直连 |

## 输出格式

每个页面一段，包含：标题、最终网址、抓取时间、页面描述、正文（保留标题层级与列表结构）、链接清单（相对路径已补全为绝对地址）、可选图片清单。UTF-8 编码，中文正常。

## 特性

- 自动剔除 script / style / 导航 / 页脚等噪声，只留正文
- 自动识别编码，中文页面不乱码
- 伪装浏览器 UA，支持 gzip，自动跟随重定向
- 代理不通自动回退直连，本地地址默认不走代理
- 失败自动重试 2 次，失败的网址也会在结果文件里记录原因，不影响其他页面

## 依赖

```bash
pip install requests beautifulsoup4 lxml
```

`--render` 才需要 playwright，其余功能不依赖。

## 打包成 exe

双击 `build_exe.bat` 即可，脚本会自动装 PyInstaller 再打包，产物是单文件 `WebCrawler.exe`。

打包后的行为：

- 单文件 exe（实测 **21 MB**），**不依赖 Python 环境**，拷到任意 Windows 机器双击就能用
- 无控制台黑窗（`--windowed`）
- 抓取结果输出到 **exe 所在目录的 `output/` 子目录**
- 出错会弹对话框，完整 traceback 同时写入 exe 同目录的 `gui_error.log`

打包完成后可以自检（不弹窗，抓一个页面验证 exe 内的 requests/lxml/bs4 真的可用）：

```bash
WebCrawler.exe --selftest http://example.com
echo %ERRORLEVEL%
```

退出码 `0`=成功、`2`=内容太短、`3`=异常，详情写在 `gui_error.log`。

> 首次运行联网时如果 Windows 防火墙弹出提示，选「允许访问」，否则会报
> `WinError 10013 以一种访问权限不允许的方式做了一个访问套接字的尝试`（实测遇到过一次，
> 放行后即正常）。

手工打包命令：

```bash
python -m PyInstaller --noconfirm --clean --onefile --windowed --name WebCrawler ^
  --hidden-import bs4 --hidden-import lxml --hidden-import crawl gui.py
```

> 关键点：打包后 `__file__` 指向 PyInstaller 的临时解压目录（`_MEIPASS`），
> 不是 exe 所在目录。所以 gui.py / crawl.py 里的输出路径、日志路径都用
> `sys.frozen` 判断后改取 `sys.executable` 所在目录，否则抓取结果会写进临时目录、
> 每次运行都不同，用户根本找不到文件。

> `--onefile` 首次启动需要解压到临时目录，大约 2-5 秒才有窗口，属正常现象。
> 介意启动速度就用 `--onedir`（改一行参数），代价是一个文件夹而非单个文件。
