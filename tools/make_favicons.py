"""Generate the portfolio favicon set (PNG + ICO + web manifest).

Draws the same mark as the inline SVG favicon -- a violet rounded square with a
white lowercase "m" -- at the sizes browsers and the web manifest expect.
Run from the repo root:  python tools/make_favicons.py
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
ASSETS.mkdir(exist_ok=True)

# Brand colors (match styles.css tokens).
VIOLET = (139, 92, 246)
VIOLET_DARK = (109, 40, 217)
WHITE = (255, 255, 255)


def _font(size: int) -> ImageFont.FreeTypeFont:
    """Pick a bold monospace font at the requested pixel size."""
    candidates = [
        "C:/Windows/Fonts/consolab.ttf",
        "C:/Windows/Fonts/consola.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def _rounded_mask(size: int, radius: int) -> Image.Image:
    """A white-on-black rounded-rect mask used to clip the tile."""
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def make_tile(size: int) -> Image.Image:
    """Render one square icon tile at the given size (RGBA)."""
    radius = int(size * 0.22)
    # Vertical gradient background (violet -> darker violet).
    grad = Image.new("RGBA", (size, size))
    top, bottom = VIOLET, VIOLET_DARK
    for y in range(size):
        t = y / max(size - 1, 1)
        r = int(top[0] + (bottom[0] - top[0]) * t)
        g = int(top[1] + (bottom[1] - top[1]) * t)
        b = int(top[2] + (bottom[2] - top[2]) * t)
        for x in range(size):
            grad.putpixel((x, y), (r, g, b, 255))

    # Draw the "m" centered.
    d = ImageDraw.Draw(grad)
    font = _font(int(size * 0.62))
    text = "m"
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((size - tw) / 2 - bbox[0], (size - th) / 2 - bbox[1]), text, font=font, fill=WHITE)

    # Clip to the rounded tile.
    mask = _rounded_mask(size, radius)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(grad, (0, 0), mask)
    return out


def main() -> None:
    sizes = {
        "favicon-16x16.png": 16,
        "favicon-32x32.png": 32,
        "favicon-192x192.png": 192,
        "favicon-512x512.png": 512,
        "apple-touch-icon.png": 180,
    }
    for name, size in sizes.items():
        make_tile(size).save(ASSETS / name)
        print(f"wrote {name} ({size}px)")

    # Multi-size ICO (16/32/48) for legacy browsers.
    ico = make_tile(16)
    ico.save(ASSETS / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    print("wrote favicon.ico (16/32/48)")

    manifest = {
        "name": "Muath Alsawaier | Software Developer",
        "short_name": "Muath",
        "description": (
            "Backend systems, API contract enforcement, and real-time "
            "observability, shipped and tested."
        ),
        "start_url": "/",
        "display": "standalone",
        "background_color": "#020202",
        "theme_color": "#8b5cf6",
        "icons": [
            {"src": "assets/favicon-192x192.png", "sizes": "192x192", "type": "image/png"},
            {"src": "assets/favicon-512x512.png", "sizes": "512x512", "type": "image/png"},
        ],
    }
    (ASSETS / "site.webmanifest").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print("wrote site.webmanifest")


if __name__ == "__main__":
    main()
