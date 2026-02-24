from __future__ import annotations

SCHEMA_VERSION = 1

ROI_STORE_TEMPLATE = "Pos{pos}_roi.zarr"
BG_STORE_TEMPLATE = "Pos{pos}_bg.zarr"

RAW_ARRAY_PATH_TEMPLATE = "roi/{roi_id}/raw"
BG_ARRAY_PATH_TEMPLATE = "roi/{roi_id}/background"
SEG_ARRAY_PATH_TEMPLATE = "roi/{roi_id}/seg_mask"

INDEX_ROI_IDS_PATH = "index/roi_ids"
INDEX_ROI_BBOXES_PATH = "index/roi_bboxes"
INDEX_ROI_PRESENT_PATH = "index/roi_present"

RAW_AXIS_NAMES = ["t", "c", "z", "y", "x"]
SEG_AXIS_NAMES = ["t", "z", "y", "x"]
BG_AXIS_NAMES = ["t", "c", "z"]


def raw_chunks(shape: tuple[int, int, int, int, int]) -> tuple[int, int, int, int, int]:
    t, c, _z, y, x = shape
    return (min(16, t), min(c, 2), 1, min(256, y), min(256, x))


def seg_chunks(shape: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    t, _z, y, x = shape
    return (min(16, t), 1, min(256, y), min(256, x))


def bg_chunks(shape: tuple[int, int, int]) -> tuple[int, int, int]:
    t, c, z = shape
    return (min(64, t), c, z)
