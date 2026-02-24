# Lisca Zarr Layout v1

Schema version: `1`

## Workspace-level files per position

- `Pos{id}_roi.zarr`
- `Pos{id}_bg.zarr`

IDs are unpadded (`Pos58`, `roi/58`).

## `Pos{id}_roi.zarr`

- `attrs.schema_version = 1`
- `roi/{id}/raw`: `uint16`, shape `(T, C, Z, Y, X)`
- `roi/{id}/seg_mask` (optional): `bool`, shape `(T, Z, Y, X)`
- `index/roi_ids`: `int32`, shape `(N,)`
- `index/roi_bboxes`: `int32`, shape `(N, T, 4)`, order `[x, y, w, h]`
- `index/roi_present`: `bool`, shape `(N, T)`

## `Pos{id}_bg.zarr`

- `attrs.schema_version = 1`
- `roi/{id}/background`: `uint16`, shape `(T, C, Z)`
- `index/roi_ids`: `int32`, shape `(N,)`

## Chunking policy

- `raw`: `(min(16, T), min(C, 2), 1, min(256, Y), min(256, X))`
- `seg_mask`: `(min(16, T), 1, min(256, Y), min(256, X))`
- `background`: `(min(64, T), C, Z)`

## Compression policy

- Zarr v3 only.
- Blosc + zstd for all arrays.

## Hard switch

Legacy `crops.zarr` is unsupported in `lisca` v1.
