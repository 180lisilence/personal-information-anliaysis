#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
网页爬取工具
用法:
  1) 双击 run.bat 或直接运行，按提示输入网址
  2) python crawl.py https://example.com
  3) python crawl.py https://a.com https://b.com -o 结果.txt      # 多个网址合并写入一个文件
  4) python crawl.py https://example.com --raw                     # 同时保存原始 HTML
  5) python crawl.py -f urls.txt                                   # 从文件批量读取网址
  6) python crawl.py https://example.com --render                  # JS 渲染页面(需 playwright)
"""

import argparse
import os
import re
import sys
import time
import urllib.parse
from datetime import datetime

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("缺少依赖，请先执行: pip install requests beautifulsoup4 lxml")
    sys.exit(1)


HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate",
    "Connection": "keep-alive",
}

# 正文提取时剔除的噪声标签
NOISE_TAGS = [
    "script", "style", "noscript", "iframe", "svg", "canvas",
    "header", "footer", "nav", "aside", "form", "button", "select", "template",
]

TEXT_BLOCK_TAGS = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th",
                   "blockquote", "pre", "article", "section", "div", "span", "br"]

# 打包成 exe 后 __file__ 指向 PyInstaller 临时目录，改用 exe 所在目录
if getattr(sys, "frozen", False):
    _BASE_DIR = os.path.dirname(os.path.abspath(sys.executable))
else:
    _BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(_BASE_DIR, "output")


def normalize_url(raw: str) -> str:
    raw = raw.strip().strip("\"'")
    if not raw:
        return ""
    if not re.match(r"^https?://", raw, re.I):
        raw = "https://" + raw.lstrip("/")
    return raw


def split_urls(text: str):
    parts = re.split(r"[\s,;，；]+", text.strip())
    return [normalize_url(p) for p in parts if p.strip()]


def fetch(url: str, timeout: int = 20, retries: int = 2, render: bool = False,
          proxy: str = None, no_proxy: bool = False):
    """返回 (html, final_url, status_code)。代理不通时自动回退直连，反之亦然。"""
    if render:
        return fetch_rendered(url, timeout)

    # 构造尝试方案：(是否信任环境代理, 显式代理)
    host = urllib.parse.urlparse(url).hostname or ""
    if host in ("127.0.0.1", "localhost", "::1", "0.0.0.0"):
        plans = [(False, None)]  # 本地地址不走代理
    elif proxy:
        plans = [(False, {"http": proxy, "https": proxy})]
    elif no_proxy:
        plans = [(False, None)]
    else:
        plans = [(True, None), (False, None)]  # 先走系统/环境代理，失败再直连

    errors = []
    for trust_env, proxies in plans:
        for i in range(retries + 1):
            try:
                s = requests.Session()
                s.trust_env = trust_env
                if proxies:
                    s.proxies.update(proxies)
                resp = s.get(url, headers=HEADERS, timeout=timeout,
                             allow_redirects=True, verify=False)
                resp.raise_for_status()
                if not resp.encoding or resp.encoding.lower() == "iso-8859-1":
                    resp.encoding = resp.apparent_encoding or "utf-8"
                return resp.text, resp.url, resp.status_code
            except Exception as e:
                errors.append(f"{type(e).__name__}: {e}")
                if i < retries:
                    time.sleep(1.0 * (i + 1))
                else:
                    break

    raise RuntimeError("请求失败 -> " + " | ".join(errors[-2:]))


def fetch_rendered(url: str, timeout: int = 30):
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise RuntimeError("未安装 playwright，请先执行: pip install playwright && playwright install chromium")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(user_agent=HEADERS["User-Agent"])
            page.goto(url, timeout=timeout * 1000, wait_until="networkidle")
            page.wait_for_timeout(1200)
            return page.content(), page.url, 200
        finally:
            browser.close()


def clean_text(s: str) -> str:
    s = s.replace("\u00a0", " ").replace("\u200b", "")
    s = re.sub(r"[ \t\r\f\v]+", " ", s)
    s = re.sub(r"\n\s*\n\s*\n+", "\n\n", s)
    return s.strip()


def extract(html: str, base_url: str, with_links: bool = True):
    """解析网页，返回结构化 dict"""
    soup = BeautifulSoup(html, "lxml")

    title = soup.title.get_text(strip=True) if soup.title else ""
    if not title:
        h1 = soup.find("h1")
        title = h1.get_text(strip=True) if h1 else ""

    meta_desc = ""
    m = soup.find("meta", attrs={"name": re.compile("^description$", re.I)})
    if not m:
        m = soup.find("meta", attrs={"property": re.compile("^og:description$", re.I)})
    if m and m.get("content"):
        meta_desc = m["content"].strip()

    for tag in soup(NOISE_TAGS):
        tag.decompose()

    # 正文：优先 article/main，否则整个 body
    root = soup.find("article") or soup.find("main") or soup.body or soup

    lines = []   # [(kind, text)]
    seen = set()
    for el in root.find_all(TEXT_BLOCK_TAGS):
        # 跳过内部还嵌套同类块级标签的容器，避免重复
        if el.name in ("div", "section", "span", "article") and el.find(["p", "li", "h1", "h2", "h3"]):
            continue
        t = el.get_text(" ", strip=True)
        t = clean_text(t)
        if len(t) < 2:
            continue
        if t in seen:
            continue
        seen.add(t)
        if re.match(r"^h[1-6]$", el.name):
            kind, prefix = "h", "#" * int(el.name[1]) + " "
        elif el.name == "li":
            kind, prefix = "li", "- "
        else:
            kind, prefix = "p", ""
        lines.append((kind, prefix + t))

    if lines:
        body = lines[0][1]
        for prev, cur in zip(lines, lines[1:]):
            # 连续的列表项之间不加空行，其余块之间空一行
            body += ("\n" if (prev[0] == "li" and cur[0] == "li") else "\n\n") + cur[1]
    else:
        body = clean_text(root.get_text("\n", strip=True))

    result = {
        "title": title,
        "description": meta_desc,
        "url": base_url,
        "body": body,
        "links": [],
        "images": [],
    }

    if with_links:
        for a in soup.find_all("a", href=True):
            href = urllib.parse.urljoin(base_url, a["href"])
            text = clean_text(a.get_text(" ", strip=True))
            if href.startswith(("javascript:", "mailto:", "tel:", "#")):
                continue
            result["links"].append((text or href, href))
        for img in soup.find_all("img"):
            src = img.get("src") or img.get("data-src") or ""
            if not src:
                continue
            result["images"].append(urllib.parse.urljoin(base_url, src))

    return result


def safe_filename(url: str) -> str:
    p = urllib.parse.urlparse(url)
    host = (p.netloc or "site").replace(":", "_")
    path = re.sub(r"[^A-Za-z0-9_\-]", "_", (p.path or "").strip("/"))[:40]
    name = f"{host}_{path}" if path else host
    return re.sub(r"_+", "_", name).strip("_")[:80]


def build_text_block(data, index=None, total=None, show_links=True, show_images=False):
    sep = "=" * 78
    out = [sep]
    if index and total:
        out.append(f"[{index}/{total}]")
    out.append(f"标题: {data['title'] or '(无)'}")
    out.append(f"网址: {data['url']}")
    out.append(f"抓取时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    if data["description"]:
        out.append(f"描述: {data['description']}")
    out.append(sep)
    out.append("")
    out.append(data["body"] or "(未提取到正文，可能是纯 JS 渲染页面，可加 --render 重试)")
    out.append("")

    if show_links and data["links"]:
        out.append("-" * 78)
        out.append(f"链接 ({len(data['links'])} 条):")
        seen = set()
        n = 0
        for text, href in data["links"]:
            if href in seen:
                continue
            seen.add(href)
            n += 1
            out.append(f"  {n}. {text}")
            out.append(f"     {href}")
        out.append("")

    if show_images and data["images"]:
        out.append("-" * 78)
        out.append(f"图片 ({len(data['images'])} 张):")
        for i, src in enumerate(dict.fromkeys(data["images"]), 1):
            out.append(f"  {i}. {src}")
        out.append("")

    out.append("")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description="网页爬取 -> txt", add_help=True)
    ap.add_argument("urls", nargs="*", help="要爬取的网址，多个用空格分隔")
    ap.add_argument("-o", "--output", help="输出的 txt 文件名(默认按域名自动生成)")
    ap.add_argument("-f", "--file", help="从文本文件读取网址(每行一个)")
    ap.add_argument("-d", "--outdir", default=OUT_DIR, help="输出目录")
    ap.add_argument("--raw", action="store_true", help="同时保存原始 HTML")
    ap.add_argument("--no-links", action="store_true", help="不导出链接列表")
    ap.add_argument("--images", action="store_true", help="同时导出图片地址")
    ap.add_argument("--timeout", type=int, default=20, help="超时秒数，默认 20")
    ap.add_argument("--render", action="store_true", help="用浏览器渲染 JS 页面(需 playwright)")
    ap.add_argument("--proxy", help="指定代理，如 http://127.0.0.1:7890")
    ap.add_argument("--no-proxy", action="store_true", help="强制不走任何代理")
    args = ap.parse_args()

    urls = list(args.urls)
    if args.file:
        with open(args.file, "r", encoding="utf-8") as fh:
            for line in fh:
                urls.extend(split_urls(line))

    if not urls:
        print("=" * 60)
        print("网页爬取工具  |  直接回车退出，多个网址用空格或逗号分隔")
        print("=" * 60)
        raw = input("请输入网址: ").strip()
        if not raw:
            return
        try:
            extra = input("输出文件名(回车自动命名): ").strip()
        except EOFError:
            extra = ""
        if extra:
            args.output = extra
        urls = split_urls(raw)

    urls = [u for u in urls if u]
    # 去重保序
    urls = list(dict.fromkeys(urls))
    if not urls:
        print("没有有效的网址")
        return

    os.makedirs(args.outdir, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    if args.output:
        out_path = args.output
        if not os.path.isabs(out_path):
            out_path = os.path.join(args.outdir, out_path)
        if not out_path.lower().endswith(".txt"):
            out_path += ".txt"
    else:
        base = safe_filename(urls[0]) if len(urls) == 1 else "爬取结果"
        out_path = os.path.join(args.outdir, f"{base}_{stamp}.txt")

    blocks = []
    ok = 0
    for i, url in enumerate(urls, 1):
        print(f"[{i}/{len(urls)}] 抓取中: {url}")
        try:
            html, final_url, status = fetch(url, timeout=args.timeout, render=args.render,
                                            proxy=args.proxy, no_proxy=args.no_proxy)
            print(f"        状态码 {status} | HTML {len(html)/1024:.1f} KB")
        except Exception as e:
            print(f"        失败: {e}")
            blocks.append("=" * 78 + f"\n网址: {url}\n抓取时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n错误: {e}\n\n")
            continue

        data = extract(html, final_url, with_links=not args.no_links)
        print(f"        标题: {data['title'][:50] or '(无)'} | 正文 {len(data['body'])} 字 | 链接 {len(data['links'])} 条")
        blocks.append(build_text_block(data, i, len(urls) if len(urls) > 1 else None,
                                       show_links=not args.no_links,
                                       show_images=args.images))
        ok += 1

        if args.raw:
            raw_path = out_path.replace(".txt", f"_{safe_filename(url)}.html")
            with open(raw_path, "w", encoding="utf-8") as fh:
                fh.write(html)
            print(f"        原始 HTML -> {raw_path}")

    header = [
        "#" * 78,
        f"# 网页爬取结果",
        f"# 目标数量: {len(urls)}  成功: {ok}  失败: {len(urls) - ok}",
        f"# 生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "#" * 78,
        "",
    ]
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(header) + "\n".join(blocks))

    print("-" * 60)
    print(f"完成: {ok}/{len(urls)} 个页面")
    print(f"输出文件: {os.path.abspath(out_path)}")
    print(f"文件大小: {os.path.getsize(out_path)/1024:.1f} KB")


if __name__ == "__main__":
    import urllib3
    urllib3.disable_warnings()
    main()
