#!/usr/bin/env python3
"""icons/ の正式版アイコンを生成する。
モチーフ: フィルムコマ（パーフォレーション付き）+ 再生三角 + 上下スクロール矢印。
16px でも潰れないよう太い形状で描き、4 倍解像度からダウンサンプルする。
"""

from PIL import Image, ImageDraw

SS = 4  # スーパーサンプル倍率

BG = (15, 15, 20, 255)          # ほぼ黒のダーク背景
FILM = (245, 245, 247, 255)     # フィルム枠（白）
HOLE = (15, 15, 20, 255)        # パーフォレーション（背景色と同色で抜く）
PLAY = (255, 70, 70, 255)       # 再生三角（赤アクセント）
ARROW = (88, 196, 255, 255)     # スクロール矢印（シアン）


def rounded_rect(d, box, r, fill):
    d.rounded_rectangle(box, radius=r, fill=fill)


def draw(size):
    s = size * SS
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    m = s * 0.06  # 外側マージン
    rounded_rect(d, [m, m, s - m, s - m], s * 0.18, BG)

    # フィルムコマ: 中央の横長フレーム
    fx0, fy0, fx1, fy1 = s * 0.16, s * 0.30, s * 0.66, s * 0.70
    rounded_rect(d, [fx0, fy0, fx1, fy1], s * 0.05, FILM)
    # パーフォレーション（上下に 3 つずつの小穴）
    hw = s * 0.045
    for i in range(3):
        cx = fx0 + (fx1 - fx0) * (0.2 + 0.3 * i)
        for cy in (fy0 + s * 0.055, fy1 - s * 0.055):
            d.ellipse([cx - hw, cy - hw, cx + hw, cy + hw], fill=HOLE)

    # 再生三角（コマ中央）
    tcx, tcy = (fx0 + fx1) / 2, (fy0 + fy1) / 2
    tw, th = s * 0.11, s * 0.16
    d.polygon(
        [(tcx - tw * 0.55, tcy - th), (tcx - tw * 0.55, tcy + th), (tcx + tw, tcy)],
        fill=PLAY,
    )

    # スクロール矢印バッジ（右下の円 + 上下シェブロン）
    bx, by, br = s * 0.68, s * 0.68, s * 0.26
    d.ellipse([bx - br, by - br, bx + br, by + br], fill=ARROW)
    # 上下の塗り三角（上=送り・下=戻しの双方向スクロール）
    ax, aw = bx, br * 0.45
    th = br * 0.34
    gap = br * 0.14
    d.polygon(
        [(ax - aw, by - gap), (ax + aw, by - gap), (ax, by - gap - th)],
        fill=BG,
    )
    d.polygon(
        [(ax - aw, by + gap), (ax + aw, by + gap), (ax, by + gap + th)],
        fill=BG,
    )

    return im.resize((size, size), Image.LANCZOS)


for size in (16, 32, 48, 128):
    draw(size).save(f"icons/icon-{size}.png")
    print(f"icons/icon-{size}.png")
