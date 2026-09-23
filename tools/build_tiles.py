#!/usr/bin/env python3
"""
孙茜作品集 · 网页版 —— 图片导出脚本（UI 全项目版）

和前两版一样，素材是 PNG 浏览器整页截图，不是 PDF。但这一版比品牌版多一层：
**五张素材混在一起用**，各自的宽度还不一样。

    目录- UI设计.png        3840×2160    目录（三张卡片：01 APP设计 / 02 可视化 / 03 AI原型）
    app设计/租车.png         2425×32768   ← 注意这张只有 2425 宽，其他四张都是 3840
    可视化.png              3840×25402
    智能体设计-ai衣橱.png     3840×12722
    app设计/时愈.png         3840×18512

所以这里做两件事：

1. **每张图分别自己决定母版宽度**（`MASTER_W` 是上限，不是目标）：
   比 2880 宽的缩到 2880；比 2880 窄的**保持原生不放大**，并把原生宽度
   本身也加成一个档位。租车那张是 2425，于是它的档位是 1440 / 1920 / 2425 ——
   最大档给足 2425，而不是卡在 1920，否则 Retina 屏会白白丢掉 21% 的真实像素。
   （不把它插值放大到 2880：多出来的像素是算出来的，体积变大但不会真变清晰。）

2. **每张图的窗口栏裁切线自动探测**，因为五张的截图缩放不一样，裁切线也不同
   （3840 宽的那几张是 160px，2425 宽的那张是 101px）。探测法见 detect_crop()。

长图的刀口仍然由 snap_cuts() 吸附到整行同色的位置。

用法：
    python3 tools/build_tiles.py                # 用下面 SRC_DIR 的默认素材
    python3 tools/build_tiles.py 别的目录/        # 临时换一套素材

依赖 Pillow：
    pip3 install --user Pillow
"""

import json
import shutil
import sys
import time
from collections import Counter
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("缺少依赖，请先运行：pip3 install --user Pillow")

Image.MAX_IMAGE_PIXELS = None       # 长图会超过 Pillow 默认的「解压炸弹」阈值

# ── 参数 ──────────────────────────────────────────────────────────
SRC_DIR = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
    "/Users/zaizai/Documents/作品集/投递/单独项目/ui全项目（驾-可视化-原型（ai-app）")

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "assets" / "img"

# 母版宽度**上限**。源图比它宽就缩到它，比它窄就保持原样（见文件头说明）。
MASTER_W = 2880

# 每张图输出的档位宽度。比母版宽的那档会自动跳过。
#   手机 390px@3x  需要 1170  → 拿 1440
#   笔记本 1440@1x 需要 1440  → 拿 1440
#   台式 1920@1x   需要 1920  → 拿 1920
#   Retina 1440@2x 需要 2880  → 拿 2880
TIER_WIDTHS = [1440, 1920, 2880]
DEFAULT_TIER = 1920          # 不支持 srcset 的老浏览器兜底用这档

WEBP_QUALITY = 80            # 这版界面截图里小字极多，压低会把笔画压糊

# 切片高度，单位是「母版像素」，只用来决定大概切几刀。
# 实际切点是算出来的、不一定正好落在这里 —— 见 snap_cuts()。
TILE_H = 3000

OG_SIZE = (1200, 630)        # 链接分享预览卡尺寸（微信 / 邮件 / 招聘系统）

# ── 素材表 ────────────────────────────────────────────────────────
# (相对 SRC_DIR 的路径, 输出子目录, 单页名或 None, 章节名)
# 给了单页名 = 这一张整张出一张图（封面）；None = 进长图序列，自动切片。
#
# ch3 和 ch4 都属于「03 APP&AI智能体原型设计」这一章（衣橱 + 时愈两个项目），
# 网页上它们合成同一个 section 展示，只是分两个文件夹存图、两张长图各自切片。
SOURCES = [
    ("目录- UI设计.png",     "ch0", "cover", None),
    ("app设计/租车.png",      "ch1", None, "01 APP设计"),
    ("可视化.png",           "ch2", None, "02 可视化设计"),
    ("智能体设计-ai衣橱.png",  "ch3", None, "03 APP&AI智能体原型设计"),
    ("app设计/时愈.png",      "ch4", None, "03 APP&AI智能体原型设计"),
]

# 裁切线的兜底值。正常情况下 detect_crop() 会自己算出来，这里只是给它一个
# 上限参考：窗口栏高度 = 图宽 × 0.04167（macOS 浏览器标题栏占整窗高的比例）。
# 探测失败时会退回到按这个比例算出来的值，并打印警告。
CHROME_RATIO = 0.04167


def detect_crop(img):
    """找出顶部 macOS 浏览器窗口栏的下边界（要裁掉多少像素）。

    第 0 行一定是 #F8F8F8 的窗口栏。往下找第一处「相邻两行的整行平均亮度
    跳变 > 60」的位置，就是窗口栏底边。

    为什么用整行均值 + 突变，而不是「第一个不够亮的行」：
    窗口栏内部有一条浅灰分割线（#EFEFED），下面还有一层渐变的投影阴影，
    亮度是 248 → 243 → 226 → 220 → 211 这样慢慢降的。逐行阈值法会在分割线
    或阴影起步处就误判，而窗口栏底边那一下是 248 → 0 / 144 / 152 的陡降，
    用突变判据非常干净。
    """
    h = img.height
    rows = img.resize((1, h)).load()          # 1×H = 每行整行的平均色
    for y in range(1, min(600, h)):
        if abs(sum(rows[0, y]) / 3 - sum(rows[0, y - 1]) / 3) > 60:
            return y
    # 兜底：按窗口栏占整窗的比例估一个
    guess = round(img.width * CHROME_RATIO)
    print(f"    ⚠️ 没探测到窗口栏底边，按比例估 {guess}px，请人工核对")
    return guess


def load_master(path, cut):
    """读一张 PNG，裁掉顶部 cut 像素，再按 MASTER_W 上限缩放，返回 RGB Image。"""
    if not path.exists():
        sys.exit(f"找不到素材：{path}")
    im = Image.open(path).convert("RGB")
    orig = im.size
    if cut:
        im = im.crop((0, cut, im.width, im.height))
    if im.width > MASTER_W:
        ratio = im.width / MASTER_W
        im = im.resize((MASTER_W, max(1, round(im.height / ratio))), Image.LANCZOS)
        print(f"    {orig[0]}×{orig[1]}  裁 {cut}px  →  母版 {im.width}×{im.height}（降采样 {ratio:.2f}x）")
    else:
        print(f"    {orig[0]}×{orig[1]}  裁 {cut}px  →  母版 {im.width}×{im.height}"
              f"（源图本来就没到 {MASTER_W}，保持原生不放大）")
    return im


def snap_cuts(img, tile_h, win=360):
    """把长图等分成若干段，再让每一刀落在「整行同色」的那一行上。

    直接按固定高度硬切，刀刃有可能从一张截图、一段文字中间横穿过去，相邻两张
    切片之间就会出现一道能看出来的接缝。改成一刀落在纯色行上，接缝就落在内容
    之间的空隙里，几乎看不出来。找不到纯色行时（整段都是满幅界面截图），退化成
    「这一行里颜色变化最小的那一行」，也比硬切好。

    win 是搜索范围（母版像素）。段长 3000 左右时，±360 足够找到空隙又不会
    让两刀撞在一起。
    """
    w, h = img.size
    n = max(1, round(h / tile_h))
    cuts = [round(i * h / n) for i in range(n + 1)]

    sample_w = max(2, w // 24)      # 横向抽样：取间隔 24px 的真实像素点
    for i in range(1, n):
        lo = max(cuts[i - 1] + 600, cuts[i] - win)
        hi = min(cuts[i + 1] - 600, cuts[i] + win)
        if hi <= lo:
            continue
        best, best_spread = cuts[i], None
        for y in range(lo, hi):
            # NEAREST 是取真实像素，不是求平均 —— 求平均会把变化抹平，量不准
            strip = img.crop((0, y, w, y + 1)).resize((sample_w, 1), Image.NEAREST)
            spread = max(mx - mn for mn, mx in strip.getextrema())
            if best_spread is None or spread < best_spread:
                best_spread, best = spread, y
                if spread == 0:     # 整行纯色，没有更好的了
                    break
        cuts[i] = best

    return cuts


def edge_bg(img):
    """取图片左边缘的众数颜色，作为这张图加载完成前的占位底色。

    这版的页面黑底、白底、紫底段段相接，统一给一个占位色必然闪错，所以逐张算。
    """
    w, h = img.size
    strip = img.crop((0, 0, min(4, w), h))
    return "#%02X%02X%02X" % Counter(strip.getdata()).most_common(1)[0][0]


def tier_widths_for(master):
    """这张母版能出哪些档位。

    常规情况是 [1440, 1920, 2880]。母版比 2880 窄时（比如租车那张 2425），
    把原生宽度本身也加成一档 —— 否则最大档卡在 1920，Retina 屏拿不到本该
    拿得到的那些真实像素。
    """
    widths = [w for w in TIER_WIDTHS if w < master.width]
    widths.append(master.width)          # 母版本身永远作为最大档
    return sorted(set(widths))


def emit(master, dest_dir, stem):
    """把母版图写成各档 WebP，返回清单条目。"""
    srcs = []
    for w in tier_widths_for(master):
        tier = master if w == master.width else master.resize(
            (w, max(1, round(master.height * w / master.width))), Image.LANCZOS)
        out = dest_dir / f"{stem}-{w}.webp"
        tier.save(out, "WEBP", quality=WEBP_QUALITY, method=6)
        srcs.append((w, f"assets/img/{dest_dir.name}/{out.name}"))

    by_w = dict(srcs)
    default_w = DEFAULT_TIER if DEFAULT_TIER in by_w else srcs[0][0]
    # 清单里 w/h 用默认档的真实尺寸，供 <img width height> 占位、避免布局跳动
    dw = default_w
    dh = round(master.height * default_w / master.width)

    return {
        "src": by_w[default_w],
        "srcset": ", ".join(f"{url} {w}w" for w, url in srcs),
        "hi": by_w[max(by_w)],          # 放大查看时用最大档，看得清细节
        "w": dw,
        "h": dh,
        "bg": edge_bg(master),
    }, [u for _, u in srcs]


def main():
    print(f"素材目录：{SRC_DIR}")
    print(f"母版宽度上限：{MASTER_W}   档位：{TIER_WIDTHS}   WebP 画质：{WEBP_QUALITY}")
    print(f"输出到：{OUT_DIR}\n")

    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    OUT_DIR.mkdir(parents=True)

    manifest = {}
    pages = {}
    total_bytes = 0
    tier_bytes = {w: 0 for w in TIER_WIDTHS}
    t0 = time.time()

    def record(entry, urls):
        nonlocal total_bytes
        for u in urls:
            sz = (ROOT / u).stat().st_size
            total_bytes += sz
            w = int(u.rsplit("-", 1)[1].split(".")[0])
            tier_bytes[w] = tier_bytes.get(w, 0) + sz

    for rel, chapter, standalone, label in SOURCES:
        src = SRC_DIR / rel
        if not src.exists():
            sys.exit(f"找不到素材：{src}")
        print(f"{rel}")
        im = Image.open(src)
        cut = detect_crop(im.convert("RGB"))
        print(f"    窗口栏裁切线探测：{cut}px"
              f"（按比例预期 {round(im.width * CHROME_RATIO)}px）")
        im.close()
        master = load_master(src, cut)

        dest_dir = OUT_DIR / chapter
        dest_dir.mkdir(parents=True, exist_ok=True)

        if standalone:
            pages[standalone], urls = emit(master, dest_dir, standalone)
            record(pages[standalone], urls)
            print(f"    → {chapter}/{standalone}   整张单页\n")
            continue

        cuts = snap_cuts(master, TILE_H)
        bucket = manifest.setdefault(chapter, [])
        for i, (y0, y1) in enumerate(zip(cuts, cuts[1:])):
            stem = f"tile-{i:02d}"
            entry, urls = emit(master.crop((0, y0, master.width, y1)), dest_dir, stem)
            bucket.append(entry)
            record(entry, urls)
            tag = ""
            if i < len(cuts) - 2:       # 最后一刀的下面没有内容了，跳过检查
                sp = max(mx - mn for mn, mx in master.crop(
                    (0, y1, master.width, y1 + 1)).resize((120, 1), Image.NEAREST).getextrema())
                tag = "  切口落在纯色行 ✓" if sp == 0 else f"  切口色差 {sp}"
            print(f"    → {chapter}/{stem}  y {y0:>6}–{y1:<6} ({y1-y0:>4}px){tag}")
        print(f"    {label}：{len(bucket)} 张切片\n")

    # ── 分享预览卡（og:image）─────────────────────────────────────
    # 用最大档做 og 图（按宽度数值取，不能按文件名字典序——2425 会排在 2880 后面）
    cover_files = list((OUT_DIR / "ch0").glob("cover-*.webp"))
    cov = Image.open(max(cover_files, key=lambda p: int(p.stem.rsplit("-", 1)[1])))
    cw, ch = cov.size
    tw, th = OG_SIZE
    ratio = max(tw / cw, th / ch)
    cov = cov.resize((round(cw * ratio), round(ch * ratio)), Image.LANCZOS)
    left = (cov.width - tw) // 2
    top = (cov.height - th) // 2
    cov.crop((left, top, left + tw, top + th)).save(
        OUT_DIR / "og-cover.jpg", "JPEG", quality=88, optimize=True)
    og_size = (OUT_DIR / "og-cover.jpg").stat().st_size
    total_bytes += og_size
    print(f"  og-cover.jpg  {og_size/1024:.0f} KB")

    # ── 清单：供 main.js 构建长图序列 ──────────────────────────────
    js = "// 由 tools/build_tiles.py 自动生成，请勿手改。\n"
    js += "window.PORTFOLIO_TILES = " + json.dumps(manifest, ensure_ascii=False, indent=2) + ";\n"
    js += "window.PORTFOLIO_PAGES = " + json.dumps(pages, ensure_ascii=False, indent=2) + ";\n"
    (ROOT / "assets" / "js").mkdir(parents=True, exist_ok=True)
    (ROOT / "assets" / "js" / "manifest.js").write_text(js, encoding="utf-8")

    n_tiles = sum(len(v) for v in manifest.values())
    print(f"\n完成：{n_tiles} 张章节切片 + {len(pages)} 张单页")
    print(f"仓库图片总量：{total_bytes/1e6:.1f} MB")
    for w in sorted(tier_bytes):
        print(f"    {w:>4} 档：{tier_bytes[w]/1e6:>5.1f} MB   "
              f"（{'手机 / 笔记本' if w == 1440 else '台式' if w == 1920 else '原生/Retina'}）")
    print(f"耗时：{time.time()-t0:.1f} 秒")


if __name__ == "__main__":
    main()
