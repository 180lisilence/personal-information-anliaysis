#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
网页爬取工具 - 图形面板
双击 run_gui.bat 运行，或: python gui.py
"""

import importlib.util
import os
import subprocess
import sys
import threading
import traceback
import urllib.parse
from datetime import datetime

# pythonw.exe 下 sys.stdout / sys.stderr 为 None，先判空再改编码
try:
    if sys.stdout is not None:
        sys.stdout.reconfigure(encoding="utf-8")
    if sys.stderr is not None:
        sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

import tkinter as tk
from tkinter import filedialog, messagebox

def app_dir() -> str:
    """打包成 exe 后 __file__ 指向 PyInstaller 临时解压目录，
    必须改用 exe 自身所在目录，否则输出目录每次运行都变、用户找不到文件。"""
    if getattr(sys, "frozen", False):
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


BASE_DIR = app_dir()
LOG_PATH = os.path.join(BASE_DIR, "gui_error.log")


def log_error(text: str):
    """写 gui_error.log，便于 pythonw 静默崩溃后排查"""
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as fh:
            fh.write(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {text}\n")
    except Exception:
        pass


def show_fatal(title: str, msg: str):
    log_error(f"{title}: {msg}")
    try:
        r = tk.Tk()
        r.withdraw()
        messagebox.showerror(title, msg)
        r.destroy()
    except Exception:
        pass


# 依赖自检：缺库时弹中文提示，而不是静默退出
_missing = [m for m in ("requests", "bs4") if importlib.util.find_spec(m) is None]
if _missing:
    show_fatal(
        "缺少依赖",
        "面板依赖以下库，请先安装：\n\n"
        f"缺失: {', '.join(_missing)}\n\n"
        "在命令提示符中执行：\n"
        "pip install requests beautifulsoup4 lxml -i "
        "https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com",
    )
    sys.exit(1)

try:
    import crawl  # 复用 crawl.py 的抓取与解析逻辑
except BaseException as e:  # crawl.py 缺依赖时会 sys.exit(1)
    show_fatal("启动失败", f"加载 crawl.py 出错：\n{e}")
    sys.exit(1)


def install_excepthook(root: tk.Tk):
    """Tk 回调里的异常不走 sys.excepthook，必须单独接管"""
    def hook(tp, val, tb):
        log_error("".join(traceback.format_exception(tp, val, tb)))
        try:
            messagebox.showerror("程序出错", f"{val}\n\n详细信息已写入:\n{LOG_PATH}")
        except Exception:
            pass

    sys.excepthook = hook
    root.report_callback_exception = lambda tp, val, tb: hook(tp, val, tb)

BG = "#1e1e1e"
BG2 = "#252526"
BG3 = "#2d2d2d"
FG = "#e6e6e6"
FG2 = "#9a9a9a"
ACC = "#0d6efd"
ACC2 = "#0a58ca"
OK = "#2ea043"
ERR = "#f85149"

DEFAULT_OUTDIR = os.path.join(BASE_DIR, "output")


def human_size(n: float) -> str:
    """字节数转 KB/MB/GB"""
    n = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.2f} {unit}"
        n /= 1024
    return f"{n:.2f} TB"


def unique_path(path: str) -> str:
    """文件已存在时追加 _2/_3…，避免同秒内多次抓取互相覆盖"""
    if not os.path.exists(path):
        return path
    base, ext = os.path.splitext(path)
    n = 2
    while os.path.exists(f"{base}_{n}{ext}"):
        n += 1
    return f"{base}_{n}{ext}"


def select_all(entry: tk.Entry):
    entry.selection_range(0, "end")
    entry.icursor("end")
    return "break"


def attach_context_menu(entry: tk.Entry):
    """tk 的 Entry 默认不带右键菜单，Ctrl+A 在 Windows 上也不是全选，
    这里补上 剪切 / 复制 / 粘贴 / 全选，让输入框能正常复制粘贴。"""
    menu = tk.Menu(entry, tearoff=0, bg=BG3, fg=FG,
                   activebackground=ACC, activeforeground="white",
                   relief="flat", bd=0, font=("Microsoft YaHei UI", 9))

    menu.add_command(label="剪切", command=lambda: entry.event_generate("<<Cut>>"))
    menu.add_command(label="复制", command=lambda: entry.event_generate("<<Copy>>"))
    menu.add_command(label="粘贴", command=lambda: entry.event_generate("<<Paste>>"))
    menu.add_separator()
    menu.add_command(label="全选", command=lambda: select_all(entry))

    def popup(event):
        try:
            entry.focus_set()
            menu.tk_popup(event.x_root, event.y_root)
        finally:
            menu.grab_release()

    entry.bind("<Button-3>", popup)          # Windows 右键
    entry.bind("<Button-2>", popup)          # 部分鼠标/触控板
    entry.bind("<Control-a>", lambda e: select_all(entry))
    entry.bind("<Control-A>", lambda e: select_all(entry))
    entry._ctx_menu = menu


class App:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.busy = False
        self.last_file = ""
        root.title("网页爬取工具")
        root.geometry("720x430")
        root.minsize(620, 400)
        root.configure(bg=BG)

        root.grid_columnconfigure(1, weight=1)

        # 标题
        tk.Label(root, text="网页爬取工具", bg=BG, fg=FG,
                 font=("Microsoft YaHei UI", 15, "bold")).grid(
            row=0, column=0, columnspan=3, sticky="w", padx=18, pady=(16, 12))

        r = 1
        # ① 链接
        self.url_var = tk.StringVar()
        tk.Label(root, text="① 链接：", bg=BG, fg=FG, width=14, anchor="w",
                 font=("Microsoft YaHei UI", 10)).grid(row=r, column=0, sticky="w", padx=(18, 6), pady=7)
        self.url_entry = tk.Entry(root, textvariable=self.url_var, bg=BG3, fg=FG,
                                  insertbackground=FG, relief="flat", font=("Consolas", 10))
        self.url_entry.grid(row=r, column=1, columnspan=2, sticky="ew", padx=(0, 18), ipady=6)
        attach_context_menu(self.url_entry)
        self._ph(self.url_entry, "可粘贴多个网址（空格/逗号分隔），每个网址单独生成一个 txt")

        r += 1
        # ② 命名
        self.name_var = tk.StringVar()
        tk.Label(root, text="② 命名：", bg=BG, fg=FG, width=14, anchor="w",
                 font=("Microsoft YaHei UI", 10)).grid(row=r, column=0, sticky="w", padx=(18, 6), pady=7)
        self.name_entry = tk.Entry(root, textvariable=self.name_var, bg=BG3, fg=FG,
                                   insertbackground=FG, relief="flat", font=("Microsoft YaHei UI", 10))
        self.name_entry.grid(row=r, column=1, columnspan=2, sticky="ew", padx=(0, 18), ipady=6)
        attach_context_menu(self.name_entry)
        self._ph(self.name_entry, "留空 = 时间戳命名（精确到秒），多链接自动加 _01 _02 序号")

        r += 1
        # ③ 输出目录 + ⑤ 选择输出目录
        self.dir_var = tk.StringVar(value=DEFAULT_OUTDIR)
        tk.Label(root, text="③ 输出目录：", bg=BG, fg=FG, width=14, anchor="w",
                 font=("Microsoft YaHei UI", 10)).grid(row=r, column=0, sticky="w", padx=(18, 6), pady=7)
        self.dir_entry = tk.Entry(root, textvariable=self.dir_var, bg=BG3, fg=FG,
                                  insertbackground=FG, relief="flat", font=("Microsoft YaHei UI", 9))
        self.dir_entry.grid(row=r, column=1, sticky="ew", padx=(0, 8), ipady=6)
        attach_context_menu(self.dir_entry)
        tk.Button(root, text="⑤ 选择输出目录", command=self.pick_dir, bg=BG3, fg=FG,
                  activebackground=ACC, activeforeground="white", relief="flat",
                  font=("Microsoft YaHei UI", 9), padx=12, cursor="hand2").grid(
            row=r, column=2, sticky="w", padx=(0, 18), ipady=4)

        r += 1
        # 选项
        self.links_var = tk.BooleanVar(value=True)
        self.images_var = tk.BooleanVar(value=False)
        self.raw_var = tk.BooleanVar(value=False)
        opt = tk.Frame(root, bg=BG)
        opt.grid(row=r, column=1, columnspan=2, sticky="w", padx=(0, 18), pady=(2, 4))
        for txt, var in (("包含链接列表", self.links_var),
                         ("包含图片地址", self.images_var),
                         ("同时保存原始 HTML", self.raw_var)):
            tk.Checkbutton(opt, text=txt, variable=var, bg=BG, fg=FG2,
                           selectcolor=BG3, activebackground=BG, activeforeground=FG,
                           relief="flat", font=("Microsoft YaHei UI", 9),
                           cursor="hand2").pack(side="left", padx=(0, 14))

        r += 1
        # 开始按钮
        self.btn_go = tk.Button(root, text="开始抓取", command=self.start, bg=ACC, fg="white",
                                activebackground=ACC2, activeforeground="white", relief="flat",
                                font=("Microsoft YaHei UI", 11, "bold"), cursor="hand2")
        self.btn_go.grid(row=r, column=1, columnspan=2, sticky="ew", padx=(0, 18), pady=(10, 6), ipady=7)

        r += 1
        # 状态
        self.status_var = tk.StringVar(value="就绪")
        tk.Label(root, textvariable=self.status_var, bg=BG, fg=FG2, anchor="w",
                 font=("Microsoft YaHei UI", 9), wraplength=640, justify="left").grid(
            row=r, column=0, columnspan=3, sticky="w", padx=18, pady=(2, 4))

        r += 1
        # ④ 文件大小
        self.size_var = tk.StringVar(value="—")
        box = tk.Frame(root, bg=BG2, highlightbackground=BG3, highlightthickness=1)
        box.grid(row=r, column=0, columnspan=3, sticky="ew", padx=18, pady=(10, 8))
        tk.Label(box, text="④ 文件大小：", bg=BG2, fg=FG2,
                 font=("Microsoft YaHei UI", 10)).pack(side="left", padx=(12, 4), pady=10)
        self.size_label = tk.Label(box, textvariable=self.size_var, bg=BG2, fg=OK,
                                   font=("Consolas", 12, "bold"))
        self.size_label.pack(side="left", pady=10)
        self.path_label = tk.Label(box, text="", bg=BG2, fg=FG2,
                                   font=("Microsoft YaHei UI", 8), anchor="w")
        self.path_label.pack(side="right", padx=12, pady=10)

        r += 1
        # ⑥ 打开输出目录
        self.btn_open = tk.Button(root, text="⑥ 打开输出目录", command=self.open_dir, bg=BG3, fg=FG,
                                  activebackground=ACC, activeforeground="white", relief="flat",
                                  font=("Microsoft YaHei UI", 10), cursor="hand2")
        self.btn_open.grid(row=r, column=0, columnspan=3, sticky="ew", padx=18, pady=(2, 14), ipady=7)

    def _ph(self, entry: tk.Entry, text: str):
        """占位提示"""
        entry.insert(0, text)
        entry.config(fg=FG2)

        def on_in(e):
            if entry.get() == text:
                entry.delete(0, "end")
                entry.config(fg=FG)

        def on_out(e):
            if not entry.get():
                entry.insert(0, text)
                entry.config(fg=FG2)

        entry.bind("<FocusIn>", on_in)
        entry.bind("<FocusOut>", on_out)
        entry._placeholder = text

    def _val(self, var: tk.StringVar, entry: tk.Entry):
        """取值；若内容仍是占位提示，按空处理"""
        v = var.get().strip()
        if v and v == getattr(entry, "_placeholder", None):
            return ""
        return v

    def set_status(self, text, color=FG2):
        self.status_var.set(text)

    def pick_dir(self):
        d = filedialog.askdirectory(initialdir=self.dir_var.get() or ".", title="选择输出目录")
        if d:
            self.dir_var.set(d)

    def open_dir(self):
        d = self.dir_var.get().strip() or DEFAULT_OUTDIR
        if not os.path.isdir(d):
            os.makedirs(d, exist_ok=True)
        try:
            if sys.platform.startswith("win"):
                os.startfile(d)
            elif sys.platform == "darwin":
                subprocess.Popen(["open", d])
            else:
                subprocess.Popen(["xdg-open", d])
            self.status_var.set(f"已打开目录: {d}")
        except Exception as e:
            messagebox.showerror("打开失败", str(e))

    def start(self):
        if self.busy:
            return
        # 支持粘贴进来的多行文本：换行/制表符统一按分隔符处理
        raw = self._val(self.url_var, self.url_entry).replace("\n", " ").replace("\r", " ")
        if not raw:
            messagebox.showwarning("提示", "请先输入网址")
            return
        urls = [u for u in crawl.split_urls(raw) if u]
        if not urls:
            messagebox.showwarning("提示", "网址格式不正确")
            return

        outdir = self.dir_var.get().strip() or DEFAULT_OUTDIR
        base_name = self._val(self.name_var, self.name_entry)
        if base_name.lower().endswith(".txt"):
            base_name = base_name[:-4]
        if not base_name:
            # 默认命名：时间戳，精确到秒
            base_name = datetime.now().strftime("%Y%m%d_%H%M%S")

        self.busy = True
        self.btn_go.config(state="disabled", text="抓取中…", bg=BG3)
        self.size_var.set("—")
        self.size_label.config(fg=OK)
        self.path_label.config(text="")
        n = len(urls)
        self.set_status(f"开始抓取 {n} 个网址，每个网址单独生成一个 txt（独立文件，不合并）…")

        args = (urls, outdir, base_name,
                self.links_var.get(), self.images_var.get(), self.raw_var.get())
        threading.Thread(target=self._worker, args=args, daemon=True).start()

    def _worker(self, urls, outdir, base_name, with_links, with_images, save_raw):
        """每个网址单独写一个 txt，不做合并"""
        made, ok, failed, total_bytes = [], 0, 0, 0
        multi = len(urls) > 1
        try:
            os.makedirs(outdir, exist_ok=True)
            for i, url in enumerate(urls, 1):
                self._status(f"[{i}/{len(urls)}] 抓取中: {url}")
                stem = f"{base_name}_{i:02d}" if multi else base_name
                out_path = unique_path(os.path.join(outdir, stem + ".txt"))

                # ---- 抓取 ----
                try:
                    html, final_url, status = crawl.fetch(url, timeout=20)
                except Exception as e:
                    err_path = unique_path(os.path.join(outdir, stem + "_失败.txt"))
                    try:
                        with open(err_path, "w", encoding="utf-8") as fh:
                            fh.write("=" * 78
                                     + f"\n网址: {url}\n抓取时间: "
                                       f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
                                       f"\n结果: 抓取失败\n错误: {e}\n")
                        size = os.path.getsize(err_path)
                    except Exception:
                        err_path, size = "", 0
                    made.append((err_path, size, False))
                    failed += 1
                    log_error(f"fetch failed url={url}: {type(e).__name__}: {e}")
                    self._status(f"[{i}/{len(urls)}] 失败: {url} -> {e}")
                    continue

                # ---- 解析 + 单独写文件 ----
                data = crawl.extract(html, final_url, with_links=with_links)
                head = [
                    "#" * 78,
                    f"# 网页爬取结果   [{i}/{len(urls)}]",
                    f"# 源链接:    {url}",
                    f"# 最终链接:  {final_url}",
                    f"# HTTP 状态: {status}",
                    f"# 抓取时间:  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
                    "#" * 78, "",
                ]
                with open(out_path, "w", encoding="utf-8") as fh:
                    fh.write("\n".join(head) + "\n"
                             + crawl.build_text_block(data, show_links=with_links,
                                                      show_images=with_images))
                size = os.path.getsize(out_path)
                total_bytes += size
                made.append((out_path, size, True))
                ok += 1
                self._status(f"[{i}/{len(urls)}] {status} | "
                             f"{data['title'][:36] or '(无标题)'} | {human_size(size)}")

                if save_raw:
                    try:
                        with open(out_path[:-4] + ".html", "w", encoding="utf-8") as fh:
                            fh.write(html)
                    except Exception:
                        pass

            valid = [m for m in made if m[0]]
            self.last_file = valid[-1][0] if valid else ""
            self._done(made, ok, failed, total_bytes, outdir)
        except Exception as e:
            log_error(f"worker crashed: {type(e).__name__}: {e}")
            self._fail(str(e))

    def _status(self, text):
        self.root.after(0, lambda: self.status_var.set(text))

    def _done(self, made, ok, failed, total_bytes, outdir):
        def upd():
            files = [m for m in made if m[0]]
            if len(files) == 1:
                self.size_var.set(human_size(files[0][1]))
                self.path_label.config(text=os.path.basename(files[0][0]))
            elif files:
                self.size_var.set(f"{len(files)} 个文件 / 合计 {human_size(total_bytes)}")
                self.path_label.config(text=f"最新: {os.path.basename(files[-1][0])}")
            else:
                self.size_var.set("无")
                self.path_label.config(text="")

            self.btn_go.config(state="normal", text="开始抓取", bg=ACC)
            self.busy = False
            if ok == 0:
                self.size_label.config(fg=ERR)
                self.status_var.set(f"全部失败（{failed} 个），失败原因见 gui_error.log -> {outdir}")
            elif failed:
                self.size_label.config(fg=OK)
                self.status_var.set(f"完成：成功 {ok} 个 / 失败 {failed} 个"
                                    f"（失败详情见 gui_error.log）-> {outdir}")
            else:
                self.size_label.config(fg=OK)
                self.status_var.set(f"完成 {ok} 个页面，已分别保存为 {ok} 个独立 txt -> {outdir}")
        self.root.after(0, upd)

    def _fail(self, msg):
        def upd():
            self.busy = False
            self.btn_go.config(state="normal", text="开始抓取", bg=ACC)
            self.size_label.config(fg=ERR)
            self.status_var.set(f"出错: {msg}")
            messagebox.showerror("抓取失败", msg)
        self.root.after(0, upd)


def run_selftest():
    """隐藏自测开关：验证打包后的 exe 里 requests/lxml/bs4 抓取链路真的可用。
    用法: WebCrawler.exe --selftest [url]
    退出码 0=成功 2=内容太短 3=异常；结果同时写入 gui_error.log。"""
    i = sys.argv.index("--selftest")
    url = sys.argv[i + 1] if len(sys.argv) > i + 1 else "http://127.0.0.1:8899/test_page.html"
    code = 3
    # 注意：sys.exit() 必须在 try 之外调用，否则它抛出的 SystemExit
    # 会被下面的 except BaseException 自己吃掉，成功也变成失败。
    try:
        outdir = os.path.join(BASE_DIR, "output")
        os.makedirs(outdir, exist_ok=True)
        out = os.path.join(outdir, "_selftest.txt")
        html, final_url, status = crawl.fetch(url, timeout=15)
        data = crawl.extract(html, final_url, with_links=True)
        with open(out, "w", encoding="utf-8") as fh:
            fh.write(crawl.build_text_block(data, 1, 1, show_links=True, show_images=True))
        size = os.path.getsize(out)
        log_error(f"SELFTEST ok http={status} title={data['title'][:40]!r} "
                  f"bytes={size} -> {out}")
        code = 0 if size > 100 else 2
    except BaseException as e:
        log_error(f"SELFTEST failed url={url}: {type(e).__name__}: {e}")
    sys.exit(code)


def main():
    if "--selftest" in sys.argv:
        run_selftest()
        return
    smoke = "--smoke" in sys.argv
    root = tk.Tk()
    install_excepthook(root)
    App(root)
    log_error("GUI started")
    if smoke:
        root.after(300, root.destroy)
    root.mainloop()


if __name__ == "__main__":
    import urllib3
    urllib3.disable_warnings()
    main()
