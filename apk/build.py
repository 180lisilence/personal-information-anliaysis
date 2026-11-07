#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
构建 WebCrawler.apk（不使用 Gradle，全程离线）

流程: aapt2 link -> javac -> d8 -> 合并 dex -> zipalign -> apksigner 签名
依赖本机已有的 JDK 与 Android SDK（见下方路径常量）。
"""

import os
import shutil
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))

SDK = r"D:\TOOL\Android\Sdk"
BUILD_TOOLS = os.path.join(SDK, "build-tools", "35.0.0")
PLATFORM_JAR = os.path.join(SDK, "platforms", "android-35", "android.jar")
JDK = r"D:\TOOL\jdk"

JAVA = os.path.join(JDK, "bin", "java.exe")
JAVAC = os.path.join(JDK, "bin", "javac.exe")
KEYTOOL = os.path.join(JDK, "bin", "keytool.exe")
AAPT2 = os.path.join(BUILD_TOOLS, "aapt2.exe")
ZIPALIGN = os.path.join(BUILD_TOOLS, "zipalign.exe")
D8_JAR = os.path.join(BUILD_TOOLS, "lib", "d8.jar")
APKSIGNER_JAR = os.path.join(BUILD_TOOLS, "lib", "apksigner.jar")

OUT = os.path.join(ROOT, "out")
CLASSES = os.path.join(OUT, "classes")
DEX = os.path.join(OUT, "dex")
BASE_APK = os.path.join(OUT, "base.apk")
UNALIGNED = os.path.join(OUT, "unaligned.apk")
ALIGNED = os.path.join(OUT, "aligned.apk")
KEYSTORE = os.path.join(ROOT, "keystore.jks")
FINAL_APK = os.path.join(ROOT, "WebCrawler.apk")

MIN_SDK, TARGET_SDK = "29", "34"
KS_PASS, KS_ALIAS = "123456", "webcrawler"


def decode(b: bytes) -> str:
    for enc in ("utf-8", "gbk", "mbcs"):
        try:
            return b.decode(enc)
        except Exception:
            continue
    return b.decode("utf-8", "replace")


def run(cmd, quiet=False):
    printable = " ".join(cmd) if isinstance(cmd, list) else cmd
    if not quiet:
        print("  >", printable if len(printable) < 200 else printable[:200] + " ...")
    r = subprocess.run(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    out = (decode(r.stdout or b"") + decode(r.stderr or b"")).strip()
    if out and not quiet:
        tail = out if len(out) < 4000 else out[-4000:]
        for line in tail.splitlines():
            print("    " + line)
    if r.returncode != 0:
        raise SystemExit("\n[构建失败] 退出码 %d\n%s" % (r.returncode, out))
    return out


def step(n, total, title):
    print("\n[%d/%d] %s" % (n, total, title))


def collect_sources():
    files = []
    for dirpath, _, names in os.walk(os.path.join(ROOT, "src")):
        for n in names:
            if n.endswith(".java"):
                files.append(os.path.relpath(os.path.join(dirpath, n), ROOT))
    return files


def main():
    total = 8
    for p in (AAPT2, JAVAC, JAVA, PLATFORM_JAR):
        if not os.path.exists(p):
            raise SystemExit("缺少工具: %s" % p)

    step(1, total, "清理输出目录")
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(CLASSES)
    os.makedirs(DEX)

    step(2, total, "aapt2 compile 编译资源（图标等）")
    res_dir = os.path.join(ROOT, "res")
    res_zip = os.path.join(OUT, "res.zip")
    has_res = os.path.isdir(res_dir) and bool(os.listdir(res_dir))
    if has_res:
        run([AAPT2, "compile", "--dir", res_dir, "-o", res_zip])
    else:
        print("    没有 res 目录，跳过")

    step(3, total, "aapt2 link 生成基础 APK（清单 + 资源）")
    link_cmd = [AAPT2, "link", "-o", BASE_APK, "-I", PLATFORM_JAR,
                "--manifest", os.path.join(ROOT, "AndroidManifest.xml"),
                "--min-sdk-version", MIN_SDK, "--target-sdk-version", TARGET_SDK,
                "--version-code", "1", "--version-name", "1.0"]
    if has_res:
        link_cmd += ["-R", res_zip, "--auto-add-overlay"]
    run(link_cmd)

    step(4, total, "javac 编译 Java 源码")
    sources = collect_sources()
    if not sources:
        raise SystemExit("src/ 下没有找到 .java 文件")
    for s in sources:
        print("    源码:", s)
    src_list = os.path.join(OUT, "sources.txt")
    with open(src_list, "w", encoding="utf-8") as fh:
        fh.write("\n".join(sources))
    run([JAVAC, "-encoding", "UTF-8", "-source", "1.8", "-target", "1.8",
         "-nowarn", "-classpath", PLATFORM_JAR, "-d", CLASSES, "@" + src_list])

    step(5, total, "d8 转换为 classes.dex")
    class_files = []
    for dirpath, _, names in os.walk(CLASSES):
        for n in names:
            if n.endswith(".class"):
                class_files.append(os.path.join(dirpath, n))
    if not class_files:
        raise SystemExit("javac 没有产出 class 文件")
    run([JAVA, "-cp", D8_JAR, "com.android.tools.r8.D8",
         "--release", "--min-api", MIN_SDK, "--lib", PLATFORM_JAR,
         "--output", DEX] + class_files)

    dex_file = os.path.join(DEX, "classes.dex")
    if not os.path.exists(dex_file):
        raise SystemExit("d8 未生成 classes.dex")

    step(6, total, "把 dex 打包进 APK")
    shutil.copyfile(BASE_APK, UNALIGNED)
    with zipfile.ZipFile(UNALIGNED, "a", zipfile.ZIP_DEFLATED) as z:
        z.write(dex_file, "classes.dex")
    print("    APK 条目:", len(zipfile.ZipFile(UNALIGNED).namelist()))

    step(7, total, "zipalign 对齐")
    run([ZIPALIGN, "-f", "4", UNALIGNED, ALIGNED])

    step(8, total, "生成签名并签名 APK")
    if not os.path.exists(KEYSTORE):
        run([KEYTOOL, "-genkeypair", "-keystore", KEYSTORE, "-alias", KS_ALIAS,
             "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
             "-storetype", "JKS", "-storepass", KS_PASS, "-keypass", KS_PASS,
             "-dname", "CN=WebCrawler,OU=Angel,O=Angel,L=Beijing,ST=Beijing,C=CN"])
    else:
        print("    复用已有签名:", os.path.basename(KEYSTORE))
    run([JAVA, "-cp", APKSIGNER_JAR, "com.android.apksigner.ApkSignerTool", "sign",
         "--ks", KEYSTORE, "--ks-key-alias", KS_ALIAS,
         "--ks-pass", "pass:" + KS_PASS, "--key-pass", "pass:" + KS_PASS,
         "--out", FINAL_APK, ALIGNED])
    run([JAVA, "-cp", APKSIGNER_JAR, "com.android.apksigner.ApkSignerTool",
         "verify", "--print-certs", FINAL_APK])

    size = os.path.getsize(FINAL_APK)
    print("\n构建完成")
    print("  产物 : %s" % FINAL_APK)
    print("  大小 : %.2f MB (%d 字节)" % (size / 1024.0 / 1024.0, size))


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        sys.exit(1)
