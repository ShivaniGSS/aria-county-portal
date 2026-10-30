"""Web-size panorama cube faces for the portal's street view.

Each survey stop's six 2048-px cube faces (0 W, 1 N, 2 E, 3 S, 4 up, 5 down) are resized to SIZE px JPEGs at
public/data/roads/<slug>/pano/<station>/<k>.jpg. Detection boxes stay in 2048-px units; the viewer scales them.

usage: export_panoramas.py <faces_root> <slug> [--size 768]
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]


def one(src: Path, dst: Path, size: int):
    if dst.exists():
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    Image.open(src).convert("RGB").resize((size, size), Image.LANCZOS).save(dst, quality=74, optimize=True, progressive=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("slug")
    ap.add_argument("--size", type=int, default=768)
    a = ap.parse_args()
    out = ROOT / "public" / "data" / "roads" / a.slug / "pano"
    jobs = [(f, out / s.name / f"{k}.jpg") for s in Path(a.root).iterdir() if s.is_dir()
            for k in range(6) if (f := s / f"Img_{k}_2048.jpg").exists()]
    with ThreadPoolExecutor(8) as ex:
        list(ex.map(lambda j: one(*j, a.size), jobs))
    print(len(jobs), "faces ->", out)


if __name__ == "__main__":
    main()
