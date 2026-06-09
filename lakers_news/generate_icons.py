"""Generate Lakers News PWA icons (requires Pillow)."""
import os

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("pip install Pillow  してから再実行してください")
    raise SystemExit(1)

OUT = os.path.join(os.path.dirname(__file__), "frontend", "icons")
os.makedirs(OUT, exist_ok=True)

PURPLE = (85, 37, 131)
GOLD = (253, 185, 39)

def make_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), PURPLE)
    draw = ImageDraw.Draw(img)
    # Gold circle border
    m = size // 16
    draw.ellipse([m, m, size - m, size - m], outline=GOLD, width=max(2, size // 24))
    # Basketball emoji approximation: circle + lines
    cx, cy, r = size // 2, size // 2, size // 3
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=GOLD)
    lw = max(1, size // 32)
    draw.arc([cx - r, cy - r, cx + r, cy + r], 20, 160, fill=PURPLE, width=lw)
    draw.arc([cx - r, cy - r, cx + r, cy + r], 200, 340, fill=PURPLE, width=lw)
    draw.line([cx - r, cy, cx + r, cy], fill=PURPLE, width=lw)
    draw.line([cx, cy - r, cx, cy + r], fill=PURPLE, width=lw)
    return img

for size in (192, 512):
    img = make_icon(size)
    path = os.path.join(OUT, f"icon-{size}.png")
    img.save(path)
    print(f"Saved {path}")
