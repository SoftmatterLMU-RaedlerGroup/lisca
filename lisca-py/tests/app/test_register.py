from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import tifffile

from lisca_py.app.register import MAX_ESTIMATED_PATTERNS, _estimate_pattern_count, run_register


def _angle_diff_deg(a: float, b: float) -> float:
    diff = (a - b + 180.0) % 360.0 - 180.0
    return abs(diff)


def _write_grid_frame(path: Path, *, width: int = 192, height: int = 192, spacing: int = 30, dx: int = 8, dy: int = -6) -> None:
    yy, xx = np.ogrid[:height, :width]
    image = np.zeros((height, width), dtype=np.uint16)
    cx0 = width // 2 + dx
    cy0 = height // 2 + dy
    radius2 = 6 * 6
    for i in range(-4, 5):
        for j in range(-4, 5):
            cx = cx0 + i * spacing
            cy = cy0 + j * spacing
            if cx < 8 or cy < 8 or cx >= width - 8 or cy >= height - 8:
                continue
            mask = (xx - cx) ** 2 + (yy - cy) ** 2 <= radius2
            image[mask] = 4000
    tifffile.imwrite(path, image)


def test_register_returns_square_params(tmp_path: Path) -> None:
    pos = 3
    pos_dir = tmp_path / f"Pos{pos}"
    pos_dir.mkdir(parents=True)
    frame_path = pos_dir / "img_channel000_position003_time000000000_z000.tif"
    _write_grid_frame(frame_path)

    result = run_register(
        input_dir=tmp_path,
        pos=pos,
        channel=0,
        time=0,
        z=0,
        grid="square",
        diagnostics=True,
    )

    assert result["shape"] == "square"
    assert result["a"] > 10
    assert result["b"] > 10
    assert _angle_diff_deg(result["beta"], result["alpha"] + 90.0) < 2.0
    assert "diagnostics" in result
    assert result["diagnostics"]["detected_points"] >= 9
    assert result["diagnostics"]["inlier_points"] >= 3


def test_register_fails_on_flat_image(tmp_path: Path) -> None:
    pos = 1
    pos_dir = tmp_path / f"Pos{pos}"
    pos_dir.mkdir(parents=True)
    frame_path = pos_dir / "img_channel000_position001_time000000000_z000.tif"
    tifffile.imwrite(frame_path, np.zeros((96, 96), dtype=np.uint16))

    with pytest.raises(ValueError, match="grid_fit_failed"):
        run_register(
            input_dir=tmp_path,
            pos=pos,
            channel=0,
            time=0,
            z=0,
            grid="square",
        )


def test_estimated_pattern_count_dense_grid_exceeds_limit() -> None:
    estimated = _estimate_pattern_count(
        canvas_w=256,
        canvas_h=256,
        a=8.0,
        alpha=0.0,
        b=8.0,
        beta=np.pi / 2.0,
    )
    assert estimated is not None
    assert estimated > MAX_ESTIMATED_PATTERNS
