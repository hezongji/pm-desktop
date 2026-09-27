"""生成应用图标与托盘角标资源（Linear 紫 + 白色 PM 字样）。

产物（build/ 目录）：
  icon.ico / installerIcon.ico / uninstallerIcon.ico / icon-test.ico
  tray.png / tray-test.png
  badge-1..9.png / badge-9plus.png      （32px 托盘角标）
  overlay-1..9.png / overlay-9plus.png  （16px 任务栏叠加角标）
用法: python scripts/gen-icons.py
"""

from __future__ import annotations

import io
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# Git Bash/CMD 控制台默认 GBK，中文输出需显式切 UTF-8
if isinstance(sys.stdout, io.TextIOWrapper):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
BUILD.mkdir(parents=True, exist_ok=True)

JADE = (94, 106, 210, 255)  # Linear 紫 #5E6AD2
JADE_DARK = (78, 90, 192, 255)  # #4E5AC0
WHITE = (255, 255, 255, 255)
RED = (220, 53, 69, 255)

FONT_CANDIDATES = [
    ("C:/Windows/Fonts/msyhbd.ttc", 0),
    ("C:/Windows/Fonts/arialbd.ttf", 0),
    ("C:/Windows/Fonts/seguisb.ttf", 0),
]


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path, index in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size=size, index=index)
            except OSError:
                continue
    return ImageFont.load_default()


def rounded_square(size: int, color: tuple[int, int, int, int], radius_ratio: float = 0.22) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    radius = int(size * radius_ratio)
    draw.rounded_rectangle([(0, 0), (size - 1, size - 1)], radius=radius, fill=color)
    return image


def draw_logo(size: int, test_mark: bool = False) -> Image.Image:
    image = rounded_square(size, JADE)
    draw = ImageDraw.Draw(image)
    font = load_font(int(size * 0.44))
    text = "PM"
    bbox = draw.textbbox((0, 0), text, font=font)
    x = (size - (bbox[2] - bbox[0])) / 2 - bbox[0]
    y = (size - (bbox[3] - bbox[1])) / 2 - bbox[1]
    draw.text((x, y), text, font=font, fill=WHITE)
    if test_mark:
        dot = max(6, int(size * 0.16))
        margin = max(2, int(size * 0.06))
        draw.ellipse(
            [(size - dot - margin, margin), (size - margin, dot + margin)],
            fill=RED,
            outline=WHITE,
            width=max(1, int(size * 0.02)),
        )
    return image


def save_ico(image: Image.Image, target: Path) -> None:
    sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
    image.save(target, format="ICO", sizes=sizes)


def badge_image(size: int, label: str) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.ellipse([(0, 0), (size - 1, size - 1)], fill=RED, outline=WHITE, width=max(1, size // 16))
    font = load_font(int(size * (0.62 if len(label) == 1 else 0.46)))
    bbox = draw.textbbox((0, 0), label, font=font)
    x = (size - (bbox[2] - bbox[0])) / 2 - bbox[0]
    y = (size - (bbox[3] - bbox[1])) / 2 - bbox[1]
    draw.text((x, y), label, font=font, fill=WHITE)
    return image


def main() -> None:
    logo256 = draw_logo(256)
    save_ico(logo256, BUILD / "icon.ico")
    save_ico(logo256, BUILD / "installerIcon.ico")
    save_ico(logo256, BUILD / "uninstallerIcon.ico")
    save_ico(draw_logo(256, test_mark=True), BUILD / "icon-test.ico")

    logo256.resize((32, 32), Image.Resampling.LANCZOS).save(BUILD / "tray.png")
    draw_logo(256, test_mark=True).resize((32, 32), Image.Resampling.LANCZOS).save(BUILD / "tray-test.png")

    for number in range(1, 10):
        label = str(number)
        badge_image(32, label).save(BUILD / f"badge-{number}.png")
        badge_image(16, label).save(BUILD / f"overlay-{number}.png")
    badge_image(32, "9+").save(BUILD / "badge-9plus.png")
    badge_image(16, "9+").save(BUILD / "overlay-9plus.png")

    # 自检：ICO 至少含 256 与 16 两种尺寸
    with Image.open(BUILD / "icon.ico") as ico:
        sizes = sorted(ico.info.get("sizes", set()))
    print(f"[icons] 已生成：icon.ico sizes={sizes} tray.png badge(1-9,9+) overlay(1-9,9+)")


if __name__ == "__main__":
    main()
