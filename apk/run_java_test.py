#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""抓取逻辑离线验证：不需要手机、不需要 Android，
用纯 JDK 编译 Crawler.java 并真实抓取本地测试页。

用法:  python run_java_test.py
测试页取自 ../crawler/test_page.html 与 test_gbk_*.html
"""

import functools
import http.server
import os
import socketserver
import subprocess
import threading

BASE_DIR = r"E:\workaddress3\crawler"          # 测试页所在目录
APK_DIR = r"E:\workaddress3\apk"
JAVA = r"D:\TOOL\jdk\bin\java.exe"
JAVAC = r"D:\TOOL\jdk\bin\javac.exe"


def compile_test():
    """把 Crawler.java + TestCrawler.java 用纯 JDK 编译到 out/test"""
    out = os.path.join(APK_DIR, "out", "test")
    os.makedirs(out, exist_ok=True)
    cmd = [JAVAC, "-encoding", "UTF-8", "-nowarn", "-cp", "src", "-d", out,
           os.path.join("src", "com", "angel", "webcrawler", "Crawler.java"),
           os.path.join("tests", "TestCrawler.java")]
    r = subprocess.run(cmd, cwd=APK_DIR, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if r.returncode != 0:
        print(r.stdout.decode("utf-8", "replace"))
        raise SystemExit("测试类编译失败")
    print("测试类编译完成 ->", out)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


compile_test()

srv = Server(("127.0.0.1", 0), functools.partial(Quiet, directory=BASE_DIR))
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
print("测试服务已启动，端口:", port)

try:
    for name in ("test_page.html", "test_gbk_declared.html", "test_gbk_nodeclare.html"):
        url = "http://127.0.0.1:%d/%s" % (port, name)
        print("\n" + "=" * 72)
        print("抓取:", url)
        print("=" * 72)
        r = subprocess.run([JAVA, "-Dstdout.encoding=UTF-8", "-Dfile.encoding=UTF-8",
                            "-cp", os.path.join(APK_DIR, "out", "test"),
                            "TestCrawler", url],
                           cwd=APK_DIR, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        out = r.stdout.decode("utf-8", "replace")
        print(out[:1800])
        if r.returncode != 0:
            print("[非零退出码]", r.returncode)
finally:
    srv.shutdown()
    print("\n测试服务已关闭")
