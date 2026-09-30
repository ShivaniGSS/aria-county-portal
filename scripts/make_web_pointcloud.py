"""
Re-encode the binary point cloud into a base64-in-JSON file for web publishing.

The raw .bin is the most compact form and is what the local dev server uses, but
static hosts that only serve standard web media types (e.g. the Artifact platform)
won't serve application/octet-stream. This emits the same payload base64-encoded
inside a JSON wrapper, decimated to a smaller point budget so the encoded text stays
well under file-size limits.

Input:  public/data/pointcloud/<track>.bin  (+ .json metadata)
Output: public/data/pointcloud/<track>_points.json  {point_count, b64}
"""
import base64
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
PC_DIR = ROOT / "public" / "data" / "pointcloud"
TARGET_POINTS = 300_000
RNG_SEED = 42


def main(track="garp_t1"):
    meta = json.loads((PC_DIR / f"{track}.json").read_text())
    n = meta["point_count"]
    raw = (PC_DIR / f"{track}.bin").read_bytes()

    xyz = np.frombuffer(raw, dtype=np.float32, count=n * 3).reshape(n, 3)
    rgb = np.frombuffer(raw, dtype=np.uint8, offset=n * 3 * 4, count=n * 3).reshape(n, 3)

    keep = min(n, TARGET_POINTS)
    if keep < n:
        idx = np.random.default_rng(RNG_SEED).choice(n, size=keep, replace=False)
        idx.sort()
        xyz, rgb = xyz[idx], rgb[idx]

    payload = xyz.astype(np.float32).tobytes() + rgb.astype(np.uint8).tobytes()
    out = {"point_count": int(keep), "b64": base64.b64encode(payload).decode("ascii")}

    dest = PC_DIR / f"{track}_points.json"
    dest.write_text(json.dumps(out))
    print(f"{dest.name}: {keep:,} points (from {n:,}), {dest.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main(*sys.argv[1:])
