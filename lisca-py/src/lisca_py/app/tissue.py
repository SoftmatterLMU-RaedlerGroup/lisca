"""Tissue segmentation + analysis for Lisca layout."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import zarr

from ..common.progress import ProgressCallback
from ..domain import schema
from ..domain.types import TissueRow
from ..io.zarr import list_roi_ids, open_bg_store, open_roi_store


def run_tissue(
    workspace: Path,
    pos: int,
    channel_phase: int,
    channel_fluorescence: int,
    method: str,
    model: str,
    output: Path,
    masks_path: Path | None,
    *,
    on_progress: ProgressCallback | None = None,
) -> None:
    del model

    roi_root = open_roi_store(workspace, pos, mode="r")
    roi_ids = list_roi_ids(roi_root)
    try:
        bg_root = open_bg_store(workspace, pos, mode="r")
    except Exception:
        bg_root = None

    if masks_path is None:
        masks_path = workspace / f"Pos{pos}_masks.zarr"
    masks_root = zarr.open_group(str(masks_path), mode="a", zarr_format=3)
    masks_root.attrs["schema_version"] = schema.SCHEMA_VERSION
    masks_root.create_array(schema.INDEX_ROI_IDS_PATH, data=np.asarray(roi_ids, dtype=np.int32), overwrite=True)

    if method == "cellpose":
        from cellpose.models import CellposeModel

        try:
            seg_model = CellposeModel(pretrained_model="cpsam", gpu=True)
        except Exception:
            seg_model = CellposeModel(pretrained_model="cpsam", gpu=False)
        segment = "cellpose"
    elif method == "cellsam":
        import torch
        from cellSAM import get_model, segment_cellular_image

        device = "cuda" if torch.cuda.is_available() else "cpu"
        seg_model = get_model().to(device)
        seg_model.eval()
        segment = "cellsam"
    else:
        raise ValueError("method must be 'cellpose' or 'cellsam'")

    total_frames = sum(int(roi_root[f"roi/{roi_id}/raw"].shape[0]) for roi_id in roi_ids)

    done = 0
    rows: list[TissueRow] = []
    for i, roi_id in enumerate(roi_ids):
        arr = roi_root[f"roi/{roi_id}/raw"]
        n_times, _, _, h, w = arr.shape
        mask_shape = (n_times, h, w)
        mask_kwargs: dict[str, object] = {}
        mask_shards = schema.mask_shards(mask_shape)
        if mask_shards is not None:
            mask_kwargs["shards"] = mask_shards
        mask_arr = masks_root.create_array(
            name=f"roi/{roi_id}/mask",
            shape=mask_shape,
            chunks=schema.mask_chunks(mask_shape),
            dtype=np.uint32,
            overwrite=True,
            fill_value=0,
            **mask_kwargs,
        )
        bg_arr = None
        if bg_root is not None:
            try:
                bg_arr = bg_root[f"roi/{roi_id}/background"]
            except KeyError:
                bg_arr = None

        for t in range(n_times):
            phase = np.asarray(arr[t, channel_phase, 0], dtype=np.float32)
            fluo = np.asarray(arr[t, channel_fluorescence, 0], dtype=np.float32)
            image = np.stack([phase, fluo, phase], axis=-1)

            if segment == "cellpose":
                masks_list, *_ = seg_model.eval([image], channel_axis=-1, batch_size=1, normalize=True)
                masks = masks_list[0] if isinstance(masks_list, list) else masks_list
            else:
                from cellSAM import segment_cellular_image

                masks, _, _ = segment_cellular_image(image, model=seg_model, normalize=True)

            masks = np.asarray(masks, dtype=np.uint32)
            mask_arr[t] = masks

            background = int(bg_arr[t, channel_fluorescence, 0]) if bg_arr is not None else int(np.median(fluo))
            for cell_id in np.unique(masks):
                if int(cell_id) == 0:
                    continue
                cell_mask = masks == cell_id
                rows.append(
                    TissueRow(
                        t=t,
                        crop=roi_id,
                        cell=int(cell_id),
                        total_fluorescence=float(np.sum(fluo[cell_mask])),
                        cell_area=int(np.sum(cell_mask)),
                        background=background,
                    )
                )

            done += 1
            if on_progress and total_frames > 0:
                on_progress(done / total_frames, f"ROI {i + 1}/{len(roi_ids)}, frame {t + 1}/{n_times}")

    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "w", newline="") as fh:
        fh.write("t,crop,cell,total_fluorescence,cell_area,background\n")
        for row in rows:
            fh.write(f"{row.t},{row.crop},{row.cell},{row.total_fluorescence},{row.cell_area},{row.background}\n")

    if on_progress:
        on_progress(1.0, f"Wrote tissue CSV to {output}")
