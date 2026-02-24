from __future__ import annotations

import csv
from pathlib import Path

import numpy as np
import tifffile


def write_fixture_tiffs(root: Path, pos: int = 58, n_t: int = 3, n_c: int = 2, n_z: int = 1) -> Path:
    pos_dir = root / f"Pos{pos}"
    pos_dir.mkdir(parents=True)
    for t in range(n_t):
        for c in range(n_c):
            for z in range(n_z):
                img = np.zeros((32, 32), dtype=np.uint16)
                img[8:24, 8:24] = (100 + t + c + z)
                tifffile.imwrite(pos_dir / f"img_channel{c:03d}_position{pos:03d}_time{t:09d}_z{z:03d}.tif", img)
    return pos_dir


def write_bbox(path: Path) -> None:
    with open(path, "w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=["crop", "x", "y", "w", "h"])
        writer.writeheader()
        writer.writerow({"crop": 7, "x": 8, "y": 8, "w": 16, "h": 16})
