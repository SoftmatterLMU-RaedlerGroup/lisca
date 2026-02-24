"""Killing prediction pipeline for Lisca layout."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image as PILImage

from ..common.progress import ProgressCallback
from ..domain.types import KillingRow
from ..io.zarr import list_roi_ids, open_roi_store


def _clean_df(df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for _roi_id, group in df.groupby("crop"):
        group = group.sort_values("t").copy()
        seen_false = False
        for _, row in group.iterrows():
            if not row["label"]:
                seen_false = True
                rows.append(row)
            elif seen_false:
                new_row = row.copy()
                new_row["label"] = False
                rows.append(new_row)
            else:
                rows.append(row)
    return pd.DataFrame(rows)


def run_killing_predict(
    workspace: Path,
    pos: int,
    model_path: str,
    output: Path,
    batch_size: int = 256,
    cpu: bool = False,
    *,
    on_progress: ProgressCallback | None = None,
) -> None:
    import torch
    from transformers import AutoImageProcessor, AutoModelForImageClassification

    roi_root = open_roi_store(workspace, pos, mode="r")
    roi_ids = list_roi_ids(roi_root)

    if cpu:
        device = torch.device("cpu")
    else:
        if torch.cuda.is_available():
            device = torch.device("cuda")
        elif torch.backends.mps.is_available():
            device = torch.device("mps")
        else:
            device = torch.device("cpu")

    model = AutoModelForImageClassification.from_pretrained(str(model_path))
    model.to(device)
    model.eval()
    processor = AutoImageProcessor.from_pretrained(str(model_path))

    results: list[KillingRow] = []
    batch_imgs: list[PILImage.Image] = []
    batch_meta: list[tuple[int, int]] = []

    def run_batch() -> None:
        nonlocal batch_imgs, batch_meta
        if not batch_imgs:
            return
        inputs = processor(batch_imgs, return_tensors="pt")
        inputs = {k: v.to(device) for k, v in inputs.items()}
        with torch.no_grad():
            outputs = model(**inputs)
        preds = torch.argmax(outputs.logits, dim=-1).cpu().tolist()
        for (t, roi_id), pred in zip(batch_meta, preds, strict=True):
            results.append(KillingRow(t=t, crop=roi_id, label=bool(pred)))
        batch_imgs = []
        batch_meta = []

    total = len(roi_ids)
    for i, roi_id in enumerate(roi_ids):
        arr = roi_root[f"roi/{roi_id}/raw"]
        n_times = int(arr.shape[0])
        for t in range(n_times):
            frame = np.asarray(arr[t, 0, 0])
            lo, hi = float(frame.min()), float(frame.max())
            if hi > lo:
                normalized = ((frame - lo) / (hi - lo) * 255).astype(np.uint8)
            else:
                normalized = np.zeros_like(frame, dtype=np.uint8)
            batch_imgs.append(PILImage.fromarray(normalized, mode="L").convert("RGB"))
            batch_meta.append((t, roi_id))
            if len(batch_imgs) >= batch_size:
                run_batch()
        if on_progress and total > 0:
            on_progress((i + 1) / total, f"Predicting ROI {i + 1}/{total}")

    run_batch()

    df = pd.DataFrame([{"t": r.t, "crop": r.crop, "label": r.label} for r in results]).sort_values(["crop", "t"]).reset_index(drop=True)
    df = _clean_df(df)
    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "w", newline="") as fh:
        fh.write("t,crop,label\n")
        for _, row in df.iterrows():
            label = "true" if bool(row["label"]) else "false"
            fh.write(f"{int(row['t'])},{int(row['crop'])},{label}\n")

    if on_progress:
        on_progress(1.0, f"Wrote predictions to {output}")
