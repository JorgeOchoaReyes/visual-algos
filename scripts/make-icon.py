#!/usr/bin/env python3
"""Generate build/icon.png — the app icon.

A rounded-square with a diagonal brand gradient and a stylized "sorted bar
chart" motif (evoking an algorithm visualizer). No external fonts needed.
Run with any Python that has Pillow + numpy (e.g. the bundled runtime):

    resources/pyruntime/bin/python3 scripts/make-icon.py
"""
import os
import numpy as np
from PIL import Image, ImageDraw

SIZE = 1024
RADIUS = 224

# Brand colors (match the app's accent / accent2).
C1 = (91, 140, 255)   # #5b8cff
C2 = (138, 107, 255)  # #8a6bff


def diagonal_gradient(size, c1, c2):
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    t = (x + y) / (2 * (size - 1))  # 0 at top-left → 1 at bottom-right
    t = t[..., None]
    c1a = np.array(c1, np.float32)
    c2a = np.array(c2, np.float32)
    rgb = (c1a * (1 - t) + c2a * t).astype(np.uint8)
    return Image.fromarray(rgb, "RGB")


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def main():
    base = diagonal_gradient(SIZE, C1, C2).convert("RGBA")

    # Soft vignette highlight in the top-left for a bit of depth.
    glow = Image.new("L", (SIZE, SIZE), 0)
    gd = ImageDraw.Draw(glow)
    gd.ellipse([-SIZE * 0.3, -SIZE * 0.4, SIZE * 0.8, SIZE * 0.7], fill=60)
    base = Image.composite(Image.new("RGBA", base.size, (255, 255, 255, 255)), base, glow)

    draw = ImageDraw.Draw(base)

    # Bar-chart motif: five ascending rounded bars, centered.
    heights = [0.30, 0.44, 0.58, 0.72, 0.86]
    n = len(heights)
    area_w = SIZE * 0.52
    bar_w = area_w / (n * 1.6)
    gap = (area_w - n * bar_w) / (n - 1)
    baseline = SIZE * 0.74
    start_x = (SIZE - area_w) / 2

    for i, h in enumerate(heights):
        bh = SIZE * 0.5 * h
        x0 = start_x + i * (bar_w + gap)
        x1 = x0 + bar_w
        y0 = baseline - bh
        y1 = baseline
        # White bars with slight transparency; tallest is brightest.
        alpha = int(210 + 45 * (i / (n - 1)))
        draw.rounded_rectangle([x0, y0, x1, y1], radius=bar_w / 2, fill=(255, 255, 255, alpha))

    # A subtle "scan line" dot on the tallest bar (the 'current' element).
    cx = start_x + (n - 1) * (bar_w + gap) + bar_w / 2
    r = bar_w * 0.42
    top_y = baseline - SIZE * 0.5 * heights[-1]
    draw.ellipse([cx - r, top_y - r, cx + r, top_y + r], fill=(11, 14, 20, 255))

    # Apply rounded-square mask.
    out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    out.paste(base, (0, 0), rounded_mask(SIZE, RADIUS))

    os.makedirs("build", exist_ok=True)
    out.save("build/icon.png")
    print("wrote build/icon.png")


if __name__ == "__main__":
    main()
