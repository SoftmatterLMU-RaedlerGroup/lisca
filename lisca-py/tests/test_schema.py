from __future__ import annotations

import csv
from pathlib import Path

import numpy as np
import tifffile
import zarr

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from lisca_py.app.crop import run_crop
from lisca_py.app.expression import run_expression


def _write_fixture_tiffs(root: Path, pos: int = 58, n_t: int = 3, n_c: int = 2, n_z: int = 1) -> Path:
    pos_dir = root / f"Pos{pos}"
    pos_dir.mkdir(parents=True)
    for t in range(n_t):
        for c in range(n_c):
            for z in range(n_z):
                img = np.zeros((32, 32), dtype=np.uint16)
                img[8:24, 8:24] = (100 + t + c + z)
                tifffile.imwrite(pos_dir / f"img_channel{c:03d}_position{pos:03d}_time{t:09d}_z{z:03d}.tif", img)
    return pos_dir


def _write_bbox(path: Path) -> None:
    with open(path, "w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=["crop", "x", "y", "w", "h"])
        writer.writeheader()
        writer.writerow({"crop": 7, "x": 8, "y": 8, "w": 16, "h": 16})


def test_crop_writes_v1_schema(tmp_path: Path) -> None:
    _write_fixture_tiffs(tmp_path)
    bbox = tmp_path / "bbox.csv"
    _write_bbox(bbox)

    run_crop(tmp_path, 58, bbox, tmp_path, background=True)

    roi = zarr.open_group(str(tmp_path / "Pos58_roi.zarr"), mode="r", zarr_format=3)
    bg = zarr.open_group(str(tmp_path / "Pos58_bg.zarr"), mode="r", zarr_format=3)

    assert int(roi.attrs["schema_version"]) == 1
    assert int(bg.attrs["schema_version"]) == 1
    assert np.asarray(roi["index/roi_ids"][:]).tolist() == [7]
    assert np.asarray(bg["index/roi_ids"][:]).tolist() == [7]
    assert roi["roi/7/raw"].shape == (3, 2, 1, 16, 16)
    assert bg["roi/7/background"].shape == (3, 2, 1)


def test_expression_reads_v1_schema(tmp_path: Path) -> None:
    _write_fixture_tiffs(tmp_path)
    bbox = tmp_path / "bbox.csv"
    _write_bbox(bbox)
    run_crop(tmp_path, 58, bbox, tmp_path, background=True)

    out = tmp_path / "expression.csv"
    run_expression(tmp_path, 58, 1, out)

    text = out.read_text().strip().splitlines()
    assert text[0] == "t,crop,intensity,area,background"
    assert len(text) == 4
