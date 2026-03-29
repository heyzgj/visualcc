#!/usr/bin/env python3
"""Generate VisualCC app icon — connected tiles on a dark canvas."""

from PIL import Image, ImageDraw
import math

W = 1024
img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# --- Background: rounded square ---
R = 200
draw.rounded_rectangle([0, 0, W-1, W-1], radius=R, fill=(20, 20, 19, 255))

# --- Dot grid (subtle canvas texture) ---
for x in range(100, W - 80, 40):
    for y in range(100, W - 80, 40):
        draw.ellipse([x-1, y-1, x+1, y+1], fill=(255, 255, 255, 10))

# --- Helper functions ---
def draw_tile(draw, x, y, w, h, accent, status_color, is_active=False):
    r = 16
    # Outer glow (approximate with larger rounded rect)
    glow_color = (*accent, 25 if not is_active else 45)
    draw.rounded_rectangle([x-8, y-8, x+w+8, y+h+8], radius=r+8, fill=glow_color)

    # Tile body
    draw.rounded_rectangle([x, y, x+w, y+h], radius=r, fill=(28, 28, 26, 255))

    # Border
    draw.rounded_rectangle([x, y, x+w, y+h], radius=r, outline=status_color, width=3 if is_active else 2)

    # Header bar
    draw.rounded_rectangle([x+1, y+1, x+w-1, y+36], radius=r, fill=(37, 37, 34, 255))
    draw.rectangle([x+1, y+20, x+w-1, y+36], fill=(37, 37, 34, 255))

    # Header separator
    draw.line([(x, y+36), (x+w, y+36)], fill=(42, 42, 39, 255), width=1)

    # Tool dot
    draw.ellipse([x+16, y+12, x+28, y+24], fill=accent)

    # Title placeholder bars
    draw.rectangle([x+38, y+14, x+118, y+22], fill=(250, 249, 245, 180))
    draw.rectangle([x+128, y+14, x+178, y+22], fill=(250, 249, 245, 70))

    # Content lines (preview placeholder)
    import random
    random.seed(x + y)  # Deterministic
    for i in range(4):
        lw = 60 + int(random.random() * 140)
        draw.rectangle([x+16, y+52+i*22, x+16+lw, y+58+i*22], fill=(250, 249, 245, 30))

    # Status dot in footer
    draw.ellipse([x+w-28, y+h-20, x+w-18, y+h-10], fill=status_color)

    # Connection handles
    # Bottom
    draw.ellipse([x+w//2-5, y+h-5, x+w//2+5, y+h+5], fill=(37, 37, 34, 255), outline=(58, 58, 54, 255), width=2)
    # Top
    draw.ellipse([x+w//2-5, y-5, x+w//2+5, y+5], fill=(37, 37, 34, 255), outline=(58, 58, 54, 255), width=2)

def draw_bezier_edge(draw, x1, y1, x2, y2, color, width=3):
    """Draw a bezier curve between two points."""
    alpha_color = (*color, 140)
    points = []
    for t_i in range(51):
        t = t_i / 50.0
        # Cubic bezier with control points for smooth curve
        cx1, cy1 = (x1 + x2) / 2, y1
        cx2, cy2 = (x1 + x2) / 2, y2

        px = (1-t)**3 * x1 + 3*(1-t)**2*t * cx1 + 3*(1-t)*t**2 * cx2 + t**3 * x2
        py = (1-t)**3 * y1 + 3*(1-t)**2*t * cy1 + 3*(1-t)*t**2 * cy2 + t**3 * y2
        points.append((px, py))

    for i in range(len(points) - 1):
        draw.line([points[i], points[i+1]], fill=alpha_color, width=width)

def draw_arrow(draw, x, y, angle, color, size=12):
    """Draw small arrow head."""
    alpha_color = (*color, 140)
    cos_a = math.cos(angle)
    sin_a = math.sin(angle)

    p1 = (x + size * cos_a, y + size * sin_a)
    p2 = (x - size * cos_a - size * 0.6 * sin_a, y - size * sin_a + size * 0.6 * cos_a)
    p3 = (x - size * cos_a + size * 0.6 * sin_a, y - size * sin_a - size * 0.6 * cos_a)

    draw.polygon([p1, p2, p3], fill=alpha_color)

# Colors
ORANGE = (217, 119, 87)
BLUE = (106, 155, 204)
GREEN = (120, 140, 93)

# --- Draw tiles ---
# Tile 1 (top-left) — done (green status)
draw_tile(draw, 180, 200, 280, 200, ORANGE, GREEN)

# Tile 2 (right) — running (blue status)
draw_tile(draw, 540, 320, 280, 200, BLUE, BLUE)

# Tile 3 (bottom-left) — needs input (orange status, active pulse)
draw_tile(draw, 240, 560, 280, 200, ORANGE, ORANGE, is_active=True)

# --- Draw edges ---
# Tile 1 bottom → Tile 2 top
draw_bezier_edge(draw, 320, 400, 680, 320, BLUE)
draw_arrow(draw, 680, 322, math.atan2(320-400, 680-320), BLUE)

# Tile 1 bottom → Tile 3 top
draw_bezier_edge(draw, 320, 400, 380, 560, ORANGE)
draw_arrow(draw, 380, 555, math.atan2(560-400, 380-320), ORANGE)

# Tile 2 bottom → Tile 3 top
draw_bezier_edge(draw, 680, 520, 380, 560, GREEN)
draw_arrow(draw, 385, 558, math.atan2(560-520, 380-680), GREEN)

# Save
output = '/Users/supergeorge/Desktop/project/visualcc/scripts/icon-source.png'
img.save(output, 'PNG')
print(f'Icon saved to {output}')
print(f'Size: {img.size}')
