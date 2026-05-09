#!/usr/bin/env python3
"""
Generate PNG icons for the PWA using only Python standard library.
Creates simple colored square icons with a bento emoji-style design.
"""

import struct
import zlib
import os
from pathlib import Path

ICON_SIZES = [72, 96, 128, 144, 152, 192, 384, 512]
OUTPUT_DIR = Path(__file__).parent / "frontend" / "icons"

# Colors (RGB)
BG_COLOR = (255, 107, 53)      # #FF6B35 orange
FG_COLOR = (255, 255, 255)     # white


def make_png(width, height, pixels):
    """
    Create a minimal valid PNG from a list of (R,G,B,A) tuples (row-major).
    """
    def chunk(name, data):
        c = name + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)

    # PNG signature
    sig = b'\x89PNG\r\n\x1a\n'

    # IHDR
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    # color type 2 = RGB (no alpha for simplicity)
    ihdr_data = struct.pack('>II', width, height) + bytes([8, 2, 0, 0, 0])
    ihdr = chunk(b'IHDR', ihdr_data)

    # IDAT - image data
    raw_rows = []
    for y in range(height):
        row = bytearray([0])  # filter type = None
        for x in range(width):
            r, g, b, a = pixels[y * width + x]
            row += bytearray([r, g, b])
        raw_rows.append(bytes(row))

    raw = b''.join(raw_rows)
    compressed = zlib.compress(raw, 9)
    idat = chunk(b'IDAT', compressed)

    # IEND
    iend = chunk(b'IEND', b'')

    return sig + ihdr + idat + iend


def draw_rounded_square(size, bg, fg, radius_ratio=0.18):
    """Draw a rounded square icon with a simple food icon in the center."""
    pixels = []
    r = int(size * radius_ratio)

    for y in range(size):
        for x in range(size):
            # Rounded corners
            in_corner = False
            cx, cy = None, None

            if x < r and y < r:
                cx, cy = r, r
            elif x >= size - r and y < r:
                cx, cy = size - r - 1, r
            elif x < r and y >= size - r:
                cx, cy = r, size - r - 1
            elif x >= size - r and y >= size - r:
                cx, cy = size - r - 1, size - r - 1

            if cx is not None:
                dist = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
                if dist > r:
                    pixels.append((255, 248, 240, 255))  # bg cream
                    continue

            pixels.append((*bg, 255))

    # Draw a simple bowl/bento icon in the center
    center = size // 2
    icon_r = int(size * 0.28)
    bowl_y_offset = int(size * 0.05)

    result = []
    for i, (y_pos, x_pos) in enumerate([(i // size, i % size) for i in range(size * size)]):
        px = pixels[i]
        if px[:3] == bg:
            # Draw chopsticks (two vertical lines)
            chop_w = max(1, size // 40)
            chop_gap = int(size * 0.06)
            chop_x1 = center - chop_gap
            chop_x2 = center + chop_gap
            chop_top = int(size * 0.12)
            chop_h = int(size * 0.32)

            if (abs(x_pos - chop_x1) <= chop_w or abs(x_pos - chop_x2) <= chop_w) and \
               chop_top <= y_pos <= chop_top + chop_h:
                result.append((*fg, 255))
                continue

            # Draw bowl (semi-ellipse)
            bowl_cx = center
            bowl_cy = center + bowl_y_offset
            bowl_rx = icon_r
            bowl_ry = int(icon_r * 0.65)

            dx = x_pos - bowl_cx
            dy = y_pos - bowl_cy

            # Only lower half of ellipse (bowl shape)
            if dy >= -bowl_ry * 0.3:
                if (dx * dx) / (bowl_rx * bowl_rx) + (dy * dy) / (bowl_ry * bowl_ry) <= 1.0:
                    result.append((*fg, 255))
                    continue

                # Bowl rim (full ellipse top edge)
                if abs(dy + bowl_ry * 0.3) < max(2, size // 48):
                    if abs(dx) <= bowl_rx:
                        result.append((*fg, 255))
                        continue

            result.append(px)
        else:
            result.append(px)

    return result


def generate_icon(size):
    pixels = draw_rounded_square(size, BG_COLOR, FG_COLOR)
    return make_png(size, size, pixels)


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for size in ICON_SIZES:
        png_data = generate_icon(size)
        out_path = OUTPUT_DIR / f"icon-{size}x{size}.png"
        out_path.write_bytes(png_data)
        print(f"Generated: {out_path.name} ({len(png_data)} bytes)")
    print(f"\nAll icons saved to: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
