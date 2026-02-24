"""Auto-register lattice parameters from a TIFF frame."""

from __future__ import annotations

import math
from pathlib import Path
from typing import TypedDict

import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree

from ..common.progress import ProgressCallback
from ..io import tiff


class FitDiagnostics(TypedDict):
    detected_points: int
    inlier_points: int
    initial_mse: float
    final_mse: float


class RegisterResult(TypedDict, total=False):
    shape: str
    a: float
    alpha: float
    b: float
    beta: float
    w: float
    h: float
    dx: float
    dy: float
    diagnostics: FitDiagnostics


class _FitResult(TypedDict):
    a: float
    alpha: float
    b: float
    beta: float
    tx: float
    ty: float
    inlier_points: int
    initial_mse: float
    final_mse: float


MAX_ESTIMATED_PATTERNS = 500.0


def _resolve_pos_dir(input_dir: Path, pos: int) -> Path:
    pos_dir_candidate = input_dir / f"Pos{pos}"
    if pos_dir_candidate.is_dir():
        return pos_dir_candidate
    if input_dir.name.lower() == f"pos{pos}".lower() and input_dir.is_dir():
        return input_dir
    raise FileNotFoundError(f"Position directory not found under input: Pos{pos}")


def _load_requested_frame(input_dir: Path, pos: int, channel: int, time: int, z: int) -> np.ndarray:
    pos_dir = _resolve_pos_dir(input_dir, pos)
    index = tiff.discover_tiffs(pos_dir, pos)
    frame_path = index.get((channel, time, z))
    if frame_path is None:
        raise ValueError(
            f"Requested frame not found for channel={channel}, time={time}, z={z} in {pos_dir}"
        )
    frame = np.asarray(tiff.read(frame_path))
    while frame.ndim > 2:
        frame = frame[0]
    if frame.ndim != 2:
        raise ValueError(f"Expected 2D frame after squeeze, got shape={frame.shape}")
    return frame.astype(np.float32, copy=False)


def _js_round(value: float) -> float:
    if value >= 0:
        return math.floor(value + 0.5)
    return math.ceil(value - 0.5)


def _normalize_angle_rad(value: float) -> float:
    return ((value + math.pi) % (2 * math.pi)) - math.pi


def _to_grayscale(image: np.ndarray) -> np.ndarray:
    if image.ndim == 2:
        return image.astype(np.float32, copy=False)
    if image.ndim == 3 and image.shape[2] >= 3:
        rgb = image[:, :, :3].astype(np.float32, copy=False)
        return 0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]
    raise ValueError(f"Unsupported image shape for grayscale conversion: {image.shape}")


def _local_variance(gray: np.ndarray, radius: int) -> np.ndarray:
    if radius <= 0:
        return np.zeros_like(gray, dtype=np.float32)
    size = radius * 2 + 1
    mean = ndimage.uniform_filter(gray.astype(np.float32, copy=False), size=size, mode="nearest")
    mean_sq = ndimage.uniform_filter((gray * gray).astype(np.float32, copy=False), size=size, mode="nearest")
    variance = mean_sq - mean * mean
    return np.maximum(variance, 0.0).astype(np.float32, copy=False)


def _otsu_threshold(data: np.ndarray) -> float:
    flat = np.asarray(data, dtype=np.float32).ravel()
    if flat.size == 0:
        return 0.0
    min_val = float(np.min(flat))
    max_val = float(np.max(flat))
    if max_val == min_val:
        return min_val

    bins = 256
    hist, _ = np.histogram(flat, bins=bins, range=(min_val, max_val))
    hist = hist.astype(np.float64, copy=False)

    total = float(flat.size)
    sum_all = float(np.dot(np.arange(bins, dtype=np.float64), hist))

    sum_b = 0.0
    w_b = 0.0
    best_variance = -1.0
    best_thresh_bin = 0

    for i in range(bins):
        w_b += hist[i]
        if w_b == 0:
            continue
        w_f = total - w_b
        if w_f == 0:
            break
        sum_b += i * hist[i]
        mean_b = sum_b / w_b
        mean_f = (sum_all - sum_b) / w_f
        diff = mean_b - mean_f
        between_var = w_b * w_f * diff * diff
        if between_var > best_variance:
            best_variance = between_var
            best_thresh_bin = i

    return float(min_val + (best_thresh_bin / (bins - 1)) * (max_val - min_val))


def _find_peaks(
    data: np.ndarray,
    min_val: float,
    merge_radius: int = 10,
) -> list[tuple[float, float]]:
    h, w = data.shape
    if h < 3 or w < 3:
        return []

    core = data[1:-1, 1:-1]
    mask = core >= min_val
    mask &= core > data[1:-1, :-2]
    mask &= core > data[1:-1, 2:]
    mask &= core > data[:-2, 1:-1]
    mask &= core > data[2:, 1:-1]
    mask &= core > data[:-2, :-2]
    mask &= core > data[:-2, 2:]
    mask &= core > data[2:, :-2]
    mask &= core > data[2:, 2:]

    coords = np.argwhere(mask)
    if coords.size == 0:
        return []
    vals = core[mask]
    order = np.argsort(-vals)

    r2 = float(merge_radius * merge_radius)
    kept: list[tuple[float, float]] = []
    for idx in order.tolist():
        y = float(coords[idx, 0] + 1)
        x = float(coords[idx, 1] + 1)
        too_close = False
        for kx, ky in kept:
            dx = x - kx
            dy = y - ky
            if dx * dx + dy * dy < r2:
                too_close = True
                break
        if not too_close:
            kept.append((x, y))
    return kept


def detect_grid_points(
    image: np.ndarray,
    *,
    local_var_radius: int = 5,
    morph_radius: int = 2,
    peak_merge_radius: int = 10,
    peak_min_abs: float = 3.0,
    peak_min_ratio: float = 0.1,
    peak_drop_max_frac: float = 0.3,
    peak_cv_threshold: float = 0.2,
) -> list[tuple[float, float]]:
    gray = _to_grayscale(image)

    variance = _local_variance(gray, local_var_radius)
    log_var = np.log1p(variance).astype(np.float32, copy=False)
    threshold = _otsu_threshold(log_var)
    binary = log_var >= threshold

    structure = np.ones((morph_radius * 2 + 1, morph_radius * 2 + 1), dtype=bool)
    cleaned = ndimage.binary_opening(binary, structure=structure)
    cleaned = ndimage.binary_closing(cleaned, structure=structure)
    cleaned = ndimage.binary_fill_holes(cleaned)

    dt = ndimage.distance_transform_edt(cleaned)
    max_dt = float(np.max(dt)) if dt.size > 0 else 0.0
    min_val = max(peak_min_abs, max_dt * peak_min_ratio)
    raw_peaks = _find_peaks(dt, min_val=min_val, merge_radius=peak_merge_radius)

    peaks_with_dt = [(x, y, float(dt[int(y), int(x)])) for x, y in raw_peaks]
    peaks_with_dt.sort(key=lambda row: row[2])

    max_drop = int(math.floor(len(peaks_with_dt) * max(0.0, peak_drop_max_frac)))
    start_idx = 0
    for i in range(max_drop):
        tail = peaks_with_dt[i:]
        if len(tail) <= 3:
            break
        values = np.array([row[2] for row in tail], dtype=np.float64)
        mean = float(values.mean())
        if mean <= 0:
            start_idx = i + 1
            continue
        cv = float(values.std(ddof=0) / mean)
        if cv < peak_cv_threshold:
            break
        start_idx = i + 1

    return [(x, y) for x, y, _ in peaks_with_dt[start_idx:]]


def _fractional_offset(
    px: float,
    py: float,
    ax: float,
    ay: float,
    bx: float,
    by: float,
    det: float,
    cx: float,
    cy: float,
) -> tuple[float, float]:
    rx = px - cx
    ry = py - cy
    u = (by * rx - bx * ry) / det
    v = (-ay * rx + ax * ry) / det
    return u - _js_round(u), v - _js_round(v)


def _lattice_residual2(
    px: float,
    py: float,
    ax: float,
    ay: float,
    bx: float,
    by: float,
    det: float,
    cx: float,
    cy: float,
) -> float:
    du, dv = _fractional_offset(px, py, ax, ay, bx, by, det, cx, cy)
    ex = du * ax + dv * bx
    ey = du * ay + dv * by
    return ex * ex + ey * ey


def _median_origin(
    points: list[tuple[float, float]],
    ax: float,
    ay: float,
    bx: float,
    by: float,
    det: float,
    cx: float,
    cy: float,
) -> tuple[float, float]:
    frac_u: list[float] = []
    frac_v: list[float] = []
    for px, py in points:
        du, dv = _fractional_offset(px, py, ax, ay, bx, by, det, cx, cy)
        frac_u.append(du)
        frac_v.append(dv)
    mu = float(np.median(np.array(frac_u, dtype=np.float64)))
    mv = float(np.median(np.array(frac_v, dtype=np.float64)))
    return mu * ax + mv * bx, mu * ay + mv * by


def _estimate_pattern_count(
    canvas_w: int,
    canvas_h: int,
    a: float,
    alpha: float,
    b: float,
    beta: float,
) -> float | None:
    ax = a * math.cos(alpha)
    ay = a * math.sin(alpha)
    bx = b * math.cos(beta)
    by = b * math.sin(beta)
    det = ax * by - ay * bx
    if abs(det) < 1e-9:
        return None
    return (float(canvas_w) * float(canvas_h)) / abs(det)


def fit_grid(
    points: list[tuple[float, float]],
    canvas_w: int,
    canvas_h: int,
    basis_angle: float = math.pi / 2,
    *,
    inlier_frac: float = 0.95,
    refine_iters: int = 50,
) -> _FitResult | None:
    if len(points) < 3:
        return None

    cx = canvas_w / 2.0
    cy = canvas_h / 2.0

    point_array = np.array(points, dtype=np.float64)
    tree = cKDTree(point_array)
    distances, indices = tree.query(point_array, k=2)
    if indices.shape[1] < 2:
        return None

    nn_points = point_array[indices[:, 1]]
    nn_vec = nn_points - point_array
    mags = distances[:, 1]
    angles = np.arctan2(nn_vec[:, 1], nn_vec[:, 0])
    angles = np.where(angles < 0, angles + math.pi, angles)

    num_bins = 36
    bin_width = math.pi / num_bins
    bin_entries: list[list[tuple[float, float]]] = [[] for _ in range(num_bins)]
    bin_indices = np.minimum(np.floor(angles / bin_width).astype(int), num_bins - 1)
    for ang, mag, bin_idx in zip(angles.tolist(), mags.tolist(), bin_indices.tolist(), strict=True):
        bin_entries[bin_idx].append((float(ang), float(mag)))

    best_bin_idx = max(range(num_bins), key=lambda idx: len(bin_entries[idx]))
    if len(bin_entries[best_bin_idx]) == 0:
        return None

    alpha_a = float(np.median(np.array([row[0] for row in bin_entries[best_bin_idx]], dtype=np.float64)))
    mag_a = float(np.median(np.array([row[1] for row in bin_entries[best_bin_idx]], dtype=np.float64)))

    target_bin = int(round(((alpha_a + basis_angle) % math.pi) / bin_width)) % num_bins
    search_range = 3
    best_b_bin_idx = -1
    best_b_count = 0
    for offset in range(-search_range, search_range + 1):
        idx = (target_bin + offset) % num_bins
        count = len(bin_entries[idx])
        if count > best_b_count:
            best_b_count = count
            best_b_bin_idx = idx

    if (
        best_b_bin_idx < 0
        or best_b_count == 0
        or best_b_count < int(math.floor(len(bin_entries[best_bin_idx]) * 0.2))
    ):
        return None

    mag_b = float(np.median(np.array([row[1] for row in bin_entries[best_b_bin_idx]], dtype=np.float64)))
    mag = (mag_a + mag_b) / 2.0
    a = mag
    alpha = alpha_a

    ax = mag * math.cos(alpha_a)
    ay = mag * math.sin(alpha_a)
    bx = mag * math.cos(alpha_a + basis_angle)
    by = mag * math.sin(alpha_a + basis_angle)
    det = ax * by - bx * ay
    if abs(det) < 1e-9:
        return None

    tx, ty = _median_origin(points, ax, ay, bx, by, det, cx, cy)

    def compute_mse(
        pts: list[tuple[float, float]],
        cand_a: float,
        cand_alpha: float,
        cand_tx: float,
        cand_ty: float,
    ) -> float:
        cand_ax = cand_a * math.cos(cand_alpha)
        cand_ay = cand_a * math.sin(cand_alpha)
        cand_bx = cand_a * math.cos(cand_alpha + basis_angle)
        cand_by = cand_a * math.sin(cand_alpha + basis_angle)
        cand_det = cand_ax * cand_by - cand_bx * cand_ay
        if abs(cand_det) < 1e-9:
            return float("inf")
        total = 0.0
        for px, py in pts:
            total += _lattice_residual2(
                px - cand_tx,
                py - cand_ty,
                cand_ax,
                cand_ay,
                cand_bx,
                cand_by,
                cand_det,
                cx,
                cy,
            )
        return total / len(pts)

    with_res = [
        (
            pt,
            _lattice_residual2(pt[0] - tx, pt[1] - ty, ax, ay, bx, by, det, cx, cy),
        )
        for pt in points
    ]
    with_res.sort(key=lambda row: row[1])
    inlier_count = max(1, min(len(points), int(math.ceil(len(points) * max(0.05, min(1.0, inlier_frac))))))
    inliers = [row[0] for row in with_res[:inlier_count]]

    initial_mse = compute_mse(inliers, a, alpha, tx, ty)

    init = np.array([a, alpha, tx, ty], dtype=np.float64)
    clamp_range = np.array([a * 0.1, math.radians(5), 10.0, 10.0], dtype=np.float64)
    fd = np.array([0.1, 0.0005, 0.1, 0.1], dtype=np.float64)
    params = np.array([a, alpha, tx, ty], dtype=np.float64)

    for _ in range(max(1, refine_iters)):
        mse = compute_mse(inliers, float(params[0]), float(params[1]), float(params[2]), float(params[3]))
        grad = np.zeros(4, dtype=np.float64)
        for d in range(4):
            p1 = params.copy()
            p2 = params.copy()
            p1[d] += fd[d]
            p2[d] -= fd[d]
            grad[d] = (
                compute_mse(inliers, float(p1[0]), float(p1[1]), float(p1[2]), float(p1[3]))
                - compute_mse(inliers, float(p2[0]), float(p2[1]), float(p2[2]), float(p2[3]))
            ) / (2.0 * fd[d])

        improved = False
        step = 4.0
        for _ in range(15):
            candidate = params - step * grad
            if np.any(np.abs(candidate - init) > clamp_range):
                step *= 0.5
                continue
            candidate_mse = compute_mse(
                inliers,
                float(candidate[0]),
                float(candidate[1]),
                float(candidate[2]),
                float(candidate[3]),
            )
            if candidate_mse < mse:
                params = candidate
                improved = True
                break
            step *= 0.5
        if not improved:
            break

    a = float(params[0])
    alpha = float(params[1])
    tx = float(params[2])
    ty = float(params[3])
    beta = alpha + basis_angle
    final_mse = compute_mse(inliers, a, alpha, tx, ty)

    return {
        "a": a,
        "alpha": _normalize_angle_rad(alpha),
        "b": a,
        "beta": _normalize_angle_rad(beta),
        "tx": tx,
        "ty": ty,
        "inlier_points": len(inliers),
        "initial_mse": initial_mse,
        "final_mse": final_mse,
    }


def run_register(
    input_dir: Path,
    pos: int,
    channel: int,
    time: int,
    z: int,
    *,
    grid: str = "square",
    w: float = 50.0,
    h: float = 50.0,
    local_var_radius: int = 5,
    morph_radius: int = 2,
    peak_merge_radius: int = 10,
    peak_min_abs: float = 3.0,
    peak_min_ratio: float = 0.1,
    peak_drop_max_frac: float = 0.3,
    peak_cv_threshold: float = 0.2,
    inlier_frac: float = 0.95,
    refine_iters: int = 50,
    diagnostics: bool = False,
    on_progress: ProgressCallback | None = None,
) -> RegisterResult:
    shape = "hex" if grid == "hex" else "square"
    basis_angle = math.pi / 3 if shape == "hex" else math.pi / 2

    if on_progress:
        on_progress(0.05, "Loading frame")
    frame = _load_requested_frame(input_dir, pos, channel, time, z)

    if on_progress:
        on_progress(0.25, "Detecting grid points")
    points = detect_grid_points(
        frame,
        local_var_radius=local_var_radius,
        morph_radius=morph_radius,
        peak_merge_radius=peak_merge_radius,
        peak_min_abs=peak_min_abs,
        peak_min_ratio=peak_min_ratio,
        peak_drop_max_frac=peak_drop_max_frac,
        peak_cv_threshold=peak_cv_threshold,
    )

    if len(points) < 3:
        raise ValueError(f"grid_fit_failed: detected only {len(points)} point(s); need at least 3")

    if on_progress:
        on_progress(0.65, f"Fitting lattice from {len(points)} points")
    fit = fit_grid(
        points,
        canvas_w=int(frame.shape[1]),
        canvas_h=int(frame.shape[0]),
        basis_angle=basis_angle,
        inlier_frac=inlier_frac,
        refine_iters=refine_iters,
    )
    if fit is None:
        raise ValueError("grid_fit_failed: insufficient peaks or unstable lattice fit")

    estimated_patterns = _estimate_pattern_count(
        canvas_w=int(frame.shape[1]),
        canvas_h=int(frame.shape[0]),
        a=float(fit["a"]),
        alpha=float(fit["alpha"]),
        b=float(fit["b"]),
        beta=float(fit["beta"]),
    )
    if estimated_patterns is None:
        raise ValueError("grid_fit_failed: degenerate lattice basis")
    if estimated_patterns > MAX_ESTIMATED_PATTERNS:
        raise ValueError(
            f"grid_fit_failed: estimated pattern count {int(round(estimated_patterns))} exceeds limit {int(MAX_ESTIMATED_PATTERNS)}"
        )

    if on_progress:
        on_progress(1.0, "Register fit complete")

    result: RegisterResult = {
        "shape": shape,
        "a": float(fit["a"]),
        "alpha": float(math.degrees(fit["alpha"])),
        "b": float(fit["b"]),
        "beta": float(math.degrees(fit["beta"])),
        "w": float(w),
        "h": float(h),
        "dx": float(fit["tx"]),
        "dy": float(fit["ty"]),
    }
    if diagnostics:
        result["diagnostics"] = {
            "detected_points": len(points),
            "inlier_points": int(fit["inlier_points"]),
            "initial_mse": float(fit["initial_mse"]),
            "final_mse": float(fit["final_mse"]),
        }
    return result
