"""Movie export for Lisca layout."""

from __future__ import annotations

import csv
from pathlib import Path

import numpy as np

from ..common.progress import ProgressCallback
from ..common.slices import parse_slice_string
from ..io.zarr import open_roi_store


def _draw_marker(frame: np.ndarray, y: int, x: int, h: int, w: int, size: int = 1) -> None:
    white = 255 if frame.ndim == 2 else np.array([255, 255, 255], dtype=np.uint8)
    for d in range(-size, size + 1):
        for yy, xx in ((y + d, x + d), (y + d, x - d)):
            if 0 <= yy < h and 0 <= xx < w:
                frame[yy, xx] = white


def run_movie(
    workspace: Path,
    pos: int,
    roi: int,
    channel: int,
    time_slice: str,
    output: Path,
    fps: int,
    colormap: str,
    spots_path: Path | None = None,
    *,
    on_progress: ProgressCallback | None = None,
) -> None:
    import imageio
    import matplotlib.cm as cm

    roi_root = open_roi_store(workspace, pos, mode="r")
    arr = roi_root[f"roi/{roi}/raw"]
    n_times = int(arr.shape[0])
    n_channels = int(arr.shape[1])

    if channel >= n_channels:
        raise ValueError(f"Channel {channel} out of range (0-{n_channels - 1})")

    time_indices = parse_slice_string(time_slice, n_times)

    spots_by_t_crop: dict[tuple[int, str], list[tuple[float, float]]] = {}
    if spots_path is not None:
        with open(spots_path, newline="") as fh:
            for row in csv.DictReader(fh):
                key = (int(row["t"]), str(row["crop"]))
                spots_by_t_crop.setdefault(key, []).append((float(row["y"]), float(row["x"])))

    frames_raw: list[np.ndarray] = []
    for i, t in enumerate(time_indices):
        frame = np.asarray(arr[t, channel, 0])
        frames_raw.append(frame)
        if on_progress:
            n = len(time_indices)
            on_progress((i + 1) / n * 0.4, f"Reading frames {i + 1}/{n}")

    if not frames_raw:
        raise ValueError("No frames to write")

    global_min = float(min(f.min() for f in frames_raw))
    global_max = float(max(f.max() for f in frames_raw))
    cmap = None if colormap == "grayscale" else cm.get_cmap(colormap)

    frames: list[np.ndarray] = []
    for frame in frames_raw:
        if global_max > global_min:
            normalized = (frame - global_min) / (global_max - global_min)
        else:
            normalized = np.zeros_like(frame, dtype=np.float64)
        if cmap is None:
            frame_uint8 = (normalized * 255).astype(np.uint8)
        else:
            colored = cmap(normalized)
            frame_uint8 = (colored[:, :, :3] * 255).astype(np.uint8)
        frames.append(frame_uint8)

    roi_key = str(roi)
    if spots_path is not None and spots_by_t_crop:
        for i, t_val in enumerate(time_indices):
            for y_f, x_f in spots_by_t_crop.get((t_val, roi_key), []):
                y_p, x_p = int(round(y_f)), int(round(x_f))
                frame = frames[i]
                _draw_marker(frame, y_p, x_p, frame.shape[0], frame.shape[1])

    if frames:
        if frames[0].ndim == 2:
            h, w = frames[0].shape
            pads = ((0, (16 - h % 16) % 16), (0, (16 - w % 16) % 16))
        else:
            h, w, _ = frames[0].shape
            pads = ((0, (16 - h % 16) % 16), (0, (16 - w % 16) % 16), (0, 0))
        if any(p[1] > 0 for p in pads):
            frames = [np.pad(f, pads, mode="constant") for f in frames]

    output.parent.mkdir(parents=True, exist_ok=True)
    with imageio.get_writer(output, fps=fps, codec="libx264", quality=8) as writer:
        for i, frame in enumerate(frames):
            writer.append_data(frame)
            if on_progress:
                on_progress(0.4 + (i + 1) / len(frames) * 0.6, f"Writing movie {i + 1}/{len(frames)}")

    if on_progress:
        on_progress(1.0, f"Wrote movie to {output}")
