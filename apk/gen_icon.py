#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生成应用图标 PNG（纯标准库，不依赖 Pillow）。
图案：蓝色圆角底 + 白色蜘蛛网（呼应"爬"取）。"""

import math
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(ROOT, "res")

BLUE = (13, 110, 253)
WHITE = (255, 255, 255)


def png_bytes(size, pixels):
    raw = bytearray()
    for y in range(size):
        raw.append(0)                      # filter type 0
        for x in range(size):
            r, g, b, a = pixels[y][x]
            raw += bytes((r, g, b, a))

    def chunk(typ, data):
        return (struct.pack(">I", len(data)) + typ + data
                + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF))

    out = b"\x89PNG\r\n\x1a\n"
    out += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    out += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    out += chunk(b"IEND", b"")
    return out


def in_round_rect(x, y, size, radius):
    cx = min(max(x, radius), size - radius)
    cy = min(max(y, radius), size - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2


def draw(size, with_bg, web_scale=0.34):
    px = [[(0, 0, 0, 0) for _ in range(size)] for _ in range(size)]
    radius = size * 0.22
    cx = cy = size / 2.0
    R = size * web_scale
    lw = max(1.0, size * 0.020)
    rings = (0.40, 0.68, 1.0)
    spokes = 8

    for y in range(size):
        yy = y + 0.5
        for x in range(size):
            xx = x + 0.5
            if with_bg:
                if not in_round_rect(xx, yy, size, radius):
                    continue
                px[y][x] = (BLUE[0], BLUE[1], BLUE[2], 255)

            dx, dy = xx - cx, yy - cy
            r = math.hypot(dx, dy)
            if r > R + lw * 2:
                continue
            ang = math.atan2(dy, dx)
            web = r < lw * 0.9
            if not web:
                for k in rings:
                    if abs(r - R * k) < lw:
                        web = True
                        break
            if not web:
                for k in range(spokes):
                    a = k * math.pi * 2 / spokes
                    da = abs((ang - a + math.pi) % (2 * math.pi) - math.pi)
                    if da * r < lw:
                        web = True
                        break
            if web:
                px[y][x] = (WHITE[0], WHITE[1], WHITE[2], 255)
    return px


DENSITIES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}


def main():
    for name, size in DENSITIES.items():
        d = os.path.join(RES, "mipmap-" + name)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "ic_launcher.png"), "wb") as fh:
            fh.write(png_bytes(size, draw(size, True)))
        fg = int(size * 1.5)               # adaptive icon 前景画布
        with open(os.path.join(d, "ic_launcher_foreground.png"), "wb") as fh:
            fh.write(png_bytes(fg, draw(fg, False, web_scale=0.22)))
        print("  %-8s 图标 %3dpx / 前景 %3dpx" % (name, size, fg))

    anydpi = os.path.join(RES, "mipmap-anydpi-v26")
    os.makedirs(anydpi, exist_ok=True)
    with open(os.path.join(anydpi, "ic_launcher.xml"), "w", encoding="utf-8") as fh:
        fh.write('<?xml version="1.0" encoding="utf-8"?>\n'
                 '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
                 '    <background android:drawable="@color/ic_launcher_background" />\n'
                 '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n'
                 '</adaptive-icon>\n')

    vals = os.path.join(RES, "values")
    os.makedirs(vals, exist_ok=True)
    with open(os.path.join(vals, "colors.xml"), "w", encoding="utf-8") as fh:
        fh.write('<?xml version="1.0" encoding="utf-8"?>\n'
                 '<resources>\n'
                 '    <color name="ic_launcher_background">#0D6EFD</color>\n'
                 '</resources>\n')
    print("  adaptive icon (mipmap-anydpi-v26) 与背景色已写入")


if __name__ == "__main__":
    main()
