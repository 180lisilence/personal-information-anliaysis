# 网页爬取 · Android 版（WebCrawler.apk）

把桌面版面板移植成手机 App：输入链接 → 抓取网页 → 每个链接单独生成一个 txt。

- **产物**：`WebCrawler.apk`（约 33 KB，单文件，自签名）
- **包名**：`com.angel.webcrawler`
- **要求**：Android 10 及以上（`minSdk 29` / `targetSdk 34`）
- **权限**：只申请 `INTERNET`。因为保存走系统下载目录（MediaStore），**不需要存储权限**

## 功能（对应桌面版的六个圈）

| 位置 | 手机上长这样 |
|------|--------------|
| ① | 链接输入框，可放多个网址（空格 / 逗号 / 换行分隔） |
| ② | 命名输入框，**留空 = 时间戳（精确到秒）**；多个链接自动加 `_01` `_02` |
| ③ | 输出目录显示，默认「下载/WebCrawler」 |
| ④ | 文件大小，自动 B/KB/MB/GB；多文件显示「N 个文件 / 合计 X」 |
| ⑤ | 选择输出目录（系统目录选择器，可选；不选就用默认下载目录） |
| ⑥ | 打开输出目录 → 弹出本次生成的文件列表，点一下即可打开 |

另外：**输入框长按**就是系统的粘贴 / 全选菜单（手机上不需要像桌面版那样自己造右键菜单）。

每个 txt 头部带源链接、最终链接、HTTP 状态、抓取时间；失败的网址单独生成
`xxx_失败.txt` 写明原因，不影响其他网址。

## 安装

APK 已经推到手机的「下载」目录（`/sdcard/Download/WebCrawler.apk`），两种装法：

**方式一（推荐）**：手机上打开「文件管理 → 下载 → WebCrawler.apk」，点击安装。
首次会提示「外部来源应用」，允许即可。

**方式二（USB）**：手机连电脑后执行

```bash
adb install -r WebCrawler.apk
```

手机上会弹出安装确认，需要点「继续安装」。华为 / 荣耀设备还要在
**设置 → 系统和更新 → 开发人员选项**里打开「允许通过 USB 安装应用」，
否则 adb 会报 `INSTALL_FAILED_ABORTED: User rejected permissions`。

> 这是自签名 APK（签名库 `keystore.jks`，口令 `123456`），用于自己安装没问题；
> 上应用商店需要换成正式签名并做加固。

## 重新构建

```bash
python build.py          # 产出 WebCrawler.apk
python gen_icon.py       # 需要重做图标时先跑这个
```

`build.py` **不用 Gradle、不联网**，只调用本机已有的工具链：

| 步骤 | 工具 | 作用 |
|------|------|------|
| 1 | aapt2 compile / link | 编译资源（图标）与清单，生成基础 APK |
| 2 | javac | 编译 Java 源码（`-source 1.8 -target 1.8`） |
| 3 | d8 | class → classes.dex |
| 4 | zipfile | 把 dex 塞进 APK |
| 5 | zipalign | 4 字节对齐 |
| 6 | apksigner | 签名并验证 |

工具路径写在 `build.py` 顶部（`D:\TOOL\Android\Sdk`、`D:\TOOL\jdk`），换机器要改。

## 源码

```
AndroidManifest.xml                    清单（minSdk 29、label 网页爬取、图标）
src/com/angel/webcrawler/Crawler.java  抓取 + 正文提取（纯 java.*，不依赖 Android API）
src/com/angel/webcrawler/MainActivity.java  界面 + 保存 + 交互
res/mipmap-*/                          图标（脚本生成，非手绘）
gen_icon.py                            图标生成器（纯标准库画 PNG）
run_java_test.py                       抓取逻辑离线验证（不需要手机）
tests/TestCrawler.java                 验证用主类
```

`Crawler.java` 刻意只用 `java.*` 类，所以**能在电脑上用 JDK 直接跑**，
不用装到手机上就能验证抓取与解析逻辑 —— 这是改逻辑后的第一道回归测试。

## 已验证内容（均为实跑，非推断）

- 构建产物：`WebCrawler.apk` 33 KB，`apksigner verify` 通过
- APK 内容：`AndroidManifest.xml` + `resources.arsc` + `classes.dex` + 图标资源，14 个条目
- dex 内类完整：`MainActivity`、`Crawler`、`Crawler$Page`，方法名抽样命中
- 清单信息：包名 `com.angel.webcrawler`、`minSdk 29`、`targetSdk 34`、
  label「网页爬取」、图标 `res/mipmap-anydpi-v26/ic_launcher.xml`
- **抓取逻辑（桌面 JDK 实跑三个页面）**：
  - UTF-8 页面 → 标题 / 描述 / 正文 157 字 / 链接 2 条，噪声标签已剔除，相对链接补成绝对地址
  - GBK 带 `meta charset` 页面 → 中文正常
  - GBK 无任何 charset 声明页面 → 靠乱码检测回退 GBK，中文正常
  - 列表排版与桌面版一致（连续列表项之间不留空行）

## 尚未验证（需要手机确认）

- 真机安装：adb 连续两次返回 `User rejected permissions`（手机上无人点确认），
  故**安装后的界面与抓取行为未实机验证**。逻辑层已用桌面 JDK 覆盖。
- 安装后建议实测一次：输入 `https://www.baidu.com` → 开始抓取 → 查看
  「下载/WebCrawler」下是否出现时间戳命名的 txt。

## 设计取舍

- **minSdk 29**：Android 10 起可直接用 MediaStore 写公共下载目录，无需申请存储权限，
  也不用引入 FileProvider（那是 androidx 的库，本方案完全离线构建，取不到）。
  如需兼容 Android 9 及以下，要加存储权限 + FileProvider，改动不小。
- **正则解析 HTML** 而非引入 Jsoup：避免任何第三方依赖，保持 33 KB 体积与离线可构建。
  对正常网页够用，遇到极端嵌套结构可能不如真解析器精确。
- **真机安装受限**：华为 / 荣耀对 USB 安装有额外开关，这是系统策略，不是 APK 的问题。
