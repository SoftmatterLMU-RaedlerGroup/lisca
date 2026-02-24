"""Expression analysis for Lisca layout."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from ..common.progress import ProgressCallback
from ..domain.types import ExpressionRow
from ..io.zarr import list_roi_ids, open_bg_store, open_roi_store


def run_expression(workspace: Path, pos: int, channel: int, output: Path, *, on_progress: ProgressCallback | None = None) -> None:
    roi_root = open_roi_store(workspace, pos, mode="r")
    try:
        bg_root = open_bg_store(workspace, pos, mode="r")
    except Exception:
        bg_root = None

    roi_ids = list_roi_ids(roi_root)
    rows: list[ExpressionRow] = []

    total = len(roi_ids)
    for i, roi_id in enumerate(roi_ids):
        arr = roi_root[f"roi/{roi_id}/raw"]
        bg_arr = None
        if bg_root is not None:
            try:
                bg_arr = bg_root[f"roi/{roi_id}/background"]
            except KeyError:
                bg_arr = None

        n_times = int(arr.shape[0])
        area = int(arr.shape[3] * arr.shape[4])
        for t in range(n_times):
            intensity = int(np.asarray(arr[t, channel, 0]).sum())
            background = int(bg_arr[t, channel, 0]) if bg_arr is not None else 0
            rows.append(ExpressionRow(t=t, crop=roi_id, intensity=intensity, area=area, background=background))
        if on_progress and total > 0:
            on_progress((i + 1) / total, f"Processing ROI {i + 1}/{total}")

    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "w", newline="") as fh:
        fh.write("t,crop,intensity,area,background\n")
        for row in rows:
            fh.write(f"{row.t},{row.crop},{row.intensity},{row.area},{row.background}\n")

    if on_progress:
        on_progress(1.0, f"Wrote {len(rows)} rows to {output}")
