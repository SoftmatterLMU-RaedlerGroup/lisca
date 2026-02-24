"""Crop TIFFs into Lisca Zarr layout."""

from __future__ import annotations

import csv
from pathlib import Path

import numpy as np

from ..common.progress import ProgressCallback
from ..domain import schema
from ..io import tiff
from ..io.zarr import (
    bg_store_path,
    codec,
    ensure_schema_attrs,
    open_bg_store,
    open_roi_store,
)


def _read_bbox_csv(csv_path: Path) -> list[dict[str, int]]:
    rows: list[dict[str, int]] = []
    with open(csv_path, newline="") as fh:
        for row in csv.DictReader(fh):
            rows.append({k: int(v) for k, v in row.items()})
    if not rows:
        raise ValueError("No rows in bbox csv")
    return rows


def _median_outside_mask(frame: np.ndarray, mask: np.ndarray) -> np.uint16:
    values = np.asarray(frame[~mask].flatten(), dtype=np.uint32)
    if values.size == 0:
        return np.uint16(0)
    return np.uint16(np.median(values))


def run_crop(input_dir: Path, pos: int, bbox: Path, output_workspace: Path, background: bool = False, *, on_progress: ProgressCallback | None = None) -> None:
    pos_dir_candidate = input_dir / f"Pos{pos}"
    if pos_dir_candidate.is_dir():
        pos_dir = pos_dir_candidate
    elif input_dir.name == f"Pos{pos}" and input_dir.is_dir():
        pos_dir = input_dir
    else:
        raise FileNotFoundError(f"Position directory not found under input: Pos{pos}")

    bboxes = _read_bbox_csv(bbox)
    index = tiff.discover_tiffs(pos_dir, pos)
    if not index:
        raise ValueError(f"No TIFFs found in {pos_dir}")

    channels = sorted({k[0] for k in index})
    times = sorted({k[1] for k in index})
    zs = sorted({k[2] for k in index})
    c_to_i = {c: i for i, c in enumerate(channels)}
    t_to_i = {t: i for i, t in enumerate(times)}
    z_to_i = {z: i for i, z in enumerate(zs)}
    n_channels = len(channels)
    n_times = len(times)
    n_z = len(zs)

    sample = tiff.read(next(iter(index.values())))
    frame_h, frame_w = int(sample.shape[0]), int(sample.shape[1])
    dtype = sample.dtype

    output_workspace.mkdir(parents=True, exist_ok=True)
    roi_root = open_roi_store(output_workspace, pos, mode="a")
    bg_root = open_bg_store(output_workspace, pos, mode="a")
    ensure_schema_attrs(roi_root)
    ensure_schema_attrs(bg_root)

    roi_ids = np.array([int(bb.get("crop", i)) for i, bb in enumerate(bboxes)], dtype=np.int32)
    n_roi = int(roi_ids.size)
    roi_bboxes = np.zeros((n_roi, n_times, 4), dtype=np.int32)
    roi_present = np.ones((n_roi, n_times), dtype=bool)
    for i, bb in enumerate(bboxes):
        roi_bboxes[i, :, 0] = int(bb["x"])
        roi_bboxes[i, :, 1] = int(bb["y"])
        roi_bboxes[i, :, 2] = int(bb["w"])
        roi_bboxes[i, :, 3] = int(bb["h"])

    roi_root.create_array(schema.INDEX_ROI_IDS_PATH, data=roi_ids, overwrite=True, compressors=[codec()])
    roi_root.create_array(schema.INDEX_ROI_BBOXES_PATH, data=roi_bboxes, overwrite=True, compressors=[codec()])
    roi_root.create_array(schema.INDEX_ROI_PRESENT_PATH, data=roi_present, overwrite=True, compressors=[codec()])
    bg_root.create_array(schema.INDEX_ROI_IDS_PATH, data=roi_ids, overwrite=True, compressors=[codec()])

    arrays: dict[int, object] = {}
    bg_arrays: dict[int, object] = {}
    for i, bb in enumerate(bboxes):
        roi_id = int(roi_ids[i])
        h, w = int(bb["h"]), int(bb["w"])
        shape = (n_times, n_channels, n_z, h, w)
        arr = roi_root.create_array(
            name=schema.RAW_ARRAY_PATH_TEMPLATE.format(roi_id=roi_id),
            shape=shape,
            chunks=schema.raw_chunks(shape),
            dtype=dtype,
            overwrite=True,
            fill_value=0,
            compressors=[codec()],
        )
        arr.attrs["axis_names"] = schema.RAW_AXIS_NAMES
        arr.attrs["schema_version"] = schema.SCHEMA_VERSION
        arrays[roi_id] = arr
        if background:
            bg_shape = (n_times, n_channels, n_z)
            bg_arr = bg_root.create_array(
                name=schema.BG_ARRAY_PATH_TEMPLATE.format(roi_id=roi_id),
                shape=bg_shape,
                chunks=schema.bg_chunks(bg_shape),
                dtype=np.uint16,
                overwrite=True,
                fill_value=0,
                compressors=[codec()],
            )
            bg_arr.attrs["axis_names"] = schema.BG_AXIS_NAMES
            bg_arr.attrs["schema_version"] = schema.SCHEMA_VERSION
            bg_arrays[roi_id] = bg_arr

    mask = np.zeros((frame_h, frame_w), dtype=bool)
    if background:
        for bb in bboxes:
            x, y, w, h = int(bb["x"]), int(bb["y"]), int(bb["w"]), int(bb["h"])
            mask[y : y + h, x : x + w] = True

    sorted_keys = sorted(index.keys())
    total = len(sorted_keys)
    for i, (c, t, z) in enumerate(sorted_keys):
        frame = tiff.read(index[(c, t, z)])
        ci, ti, zi = c_to_i[c], t_to_i[t], z_to_i[z]
        for bb, roi_id in zip(bboxes, roi_ids, strict=True):
            x, y, w, h = int(bb["x"]), int(bb["y"]), int(bb["w"]), int(bb["h"])
            arrays[int(roi_id)][ti, ci, zi] = frame[y : y + h, x : x + w]
            if background:
                bg_arrays[int(roi_id)][ti, ci, zi] = _median_outside_mask(frame, mask)
        if on_progress and total > 0:
            on_progress((i + 1) / total, f"Reading frames {i + 1}/{total}")

    if on_progress:
        on_progress(1.0, f"Wrote {bg_store_path(output_workspace, pos).name} and Pos{pos}_roi.zarr")
