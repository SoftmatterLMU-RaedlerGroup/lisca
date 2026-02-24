from __future__ import annotations

from pathlib import Path

import numpy as np
import zarr

from ..domain import schema


def codec() -> object:
    return zarr.codecs.BloscCodec(cname="zstd", clevel=5, shuffle="shuffle")


def roi_store_path(workspace: Path, pos: int) -> Path:
    return workspace / schema.ROI_STORE_TEMPLATE.format(pos=pos)


def bg_store_path(workspace: Path, pos: int) -> Path:
    return workspace / schema.BG_STORE_TEMPLATE.format(pos=pos)


def open_roi_store(workspace: Path, pos: int, mode: str = "r") -> zarr.Group:
    return zarr.open_group(str(roi_store_path(workspace, pos)), mode=mode, zarr_format=3)


def open_bg_store(workspace: Path, pos: int, mode: str = "r") -> zarr.Group:
    return zarr.open_group(str(bg_store_path(workspace, pos)), mode=mode, zarr_format=3)


def ensure_schema_attrs(store: zarr.Group) -> None:
    store.attrs["schema_version"] = schema.SCHEMA_VERSION


def list_roi_ids(roi_root: zarr.Group) -> list[int]:
    try:
        arr = np.asarray(roi_root[schema.INDEX_ROI_IDS_PATH][:], dtype=np.int32)
        return [int(v) for v in arr.tolist()]
    except KeyError:
        rg = roi_root.get("roi")
        if rg is None or not hasattr(rg, "keys"):
            return []
        out: list[int] = []
        for key in rg.keys():
            try:
                out.append(int(key))
            except ValueError:
                continue
        return sorted(out)
