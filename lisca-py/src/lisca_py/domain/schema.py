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
    _t, _c, _z, y, x = shape
    return (1, 1, 1, y, x)


def raw_shards(shape: tuple[int, int, int, int, int]) -> tuple[int, int, int, int, int] | None:
    t, c, z, y, x = shape
    shards = (min(64, t), c, z, y, x)
    return None if shards == raw_chunks(shape) else shards


def seg_chunks(shape: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    _t, z, y, x = shape
    return (1, z, y, x)


def seg_shards(shape: tuple[int, int, int, int]) -> tuple[int, int, int, int] | None:
    t, z, y, x = shape
    shards = (min(64, t), z, y, x)
    return None if shards == seg_chunks(shape) else shards


def mask_chunks(shape: tuple[int, int, int]) -> tuple[int, int, int]:
    _t, y, x = shape
    return (1, y, x)


def mask_shards(shape: tuple[int, int, int]) -> tuple[int, int, int] | None:
    t, y, x = shape
    shards = (min(64, t), y, x)
    return None if shards == mask_chunks(shape) else shards


def bg_chunks(shape: tuple[int, int, int]) -> tuple[int, int, int]:
    _t, _c, _z = shape
    return (1, 1, 1)


def bg_shards(shape: tuple[int, int, int]) -> tuple[int, int, int] | None:
    t, c, z = shape
    shards = (min(256, t), c, z)
    return None if shards == bg_chunks(shape) else shards
