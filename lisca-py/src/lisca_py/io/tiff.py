from __future__ import annotations

import re
from pathlib import Path

import tifffile

TIFF_RE = re.compile(r"img_channel(\d+)_position(\d+)_time(\d+)_z(\d+)\.tif")


def discover_tiffs(pos_dir: Path, pos: int) -> dict[tuple[int, int, int], Path]:
    out: dict[tuple[int, int, int], Path] = {}
    for p in sorted(pos_dir.iterdir()):
        m = TIFF_RE.match(p.name)
        if m is None:
            continue
        c, p_idx, t, z = (int(v) for v in m.groups())
        if p_idx != pos:
            continue
        out[(c, t, z)] = p
    return out


def read(path: Path):
    return tifffile.imread(path)


def write(path: Path, data) -> None:
    tifffile.imwrite(str(path), data)
