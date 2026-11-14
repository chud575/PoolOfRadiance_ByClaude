#!/usr/bin/env python3
"""Import a "Phlan EGA views" picture pack into src/assets/classic/views/ for 1988 mode.

  python3 -I tools/classic_views_import.py [--map phlan_civilized] [--cols 16] [--width 768] <unpacked pack dir>...

Each pack holds views/P<id>_<N|E|S|W>.png where id = row * cols + column (zero based, column 0
at the west edge, row 0 at the north edge, north up) -- the same axes as MapGrid, so the square
is x = id % cols, y = id // cols. Files are written as <map>_<x>_<y>_<dir>.png, the name
explore/ClassicView.js looks up. Pictures are scaled to --width and stored with a 256-colour
palette (the 1536x1024 RGB originals are ~3 MB each). Needs Pillow.
"""
import argparse
import re
import sys
from pathlib import Path

from PIL import Image

NAME = re.compile(r'^P(\d+)_([NESW])\.png$', re.I)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('packs', nargs='+', type=Path)
    ap.add_argument('--map', default='phlan_civilized')
    ap.add_argument('--cols', type=int, default=16)
    ap.add_argument('--width', type=int, default=768)
    ap.add_argument('--out', type=Path, default=Path(__file__).resolve().parent.parent / 'src/assets/classic/views')
    a = ap.parse_args()

    a.out.mkdir(parents=True, exist_ok=True)
    seen = {}
    for pack in a.packs:
        for f in sorted(pack.rglob('views/*.png')):
            m = NAME.match(f.name)
            if not m:
                print(f'skipped (name not P<id>_<dir>.png): {f}', file=sys.stderr)
                continue
            pid, d = int(m.group(1)), m.group(2).lower()
            name = f'{a.map}_{pid % a.cols}_{pid // a.cols}_{d}.png'
            if name in seen:
                print(f'{name}: {f} replaces {seen[name]}', file=sys.stderr)
            seen[name] = f
            im = Image.open(f).convert('RGB')
            if im.width > a.width:
                im = im.resize((a.width, round(im.height * a.width / im.width)), Image.LANCZOS)
            im = im.quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
            im.save(a.out / name, optimize=True)
    print(f'{len(seen)} pictures -> {a.out}')


if __name__ == '__main__':
    main()
