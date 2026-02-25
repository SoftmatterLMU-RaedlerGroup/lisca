use std::cmp::Ordering;
use std::collections::VecDeque;
use std::f64::consts::PI;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::cli::commands::register::{GridShape, RegisterArgs};
use crate::io::tiff::{discover_tiffs, read_tiff_frame, FrameData};

#[derive(Clone, Copy, Debug)]
struct Point {
    x: f64,
    y: f64,
}

#[derive(Clone, Debug)]
struct FitResult {
    a: f64,
    alpha: f64,
    b: f64,
    beta: f64,
    tx: f64,
    ty: f64,
    inlier_points: usize,
    initial_mse: f64,
    final_mse: f64,
}

#[derive(Serialize)]
struct RegisterDiagnostics {
    detected_points: usize,
    inlier_points: usize,
    initial_mse: f64,
    final_mse: f64,
}

#[derive(Serialize)]
struct RegisterOutput {
    shape: String,
    a: f64,
    alpha: f64,
    b: f64,
    beta: f64,
    w: f64,
    h: f64,
    dx: f64,
    dy: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    diagnostics: Option<RegisterDiagnostics>,
}

const MAX_ESTIMATED_PATTERNS: f64 = 500.0;

fn js_round(value: f64) -> f64 {
    if value >= 0.0 {
        (value + 0.5).floor()
    } else {
        (value - 0.5).ceil()
    }
}

fn normalize_angle_rad(value: f64) -> f64 {
    ((value + PI) % (2.0 * PI)) - PI
}

fn rad_to_deg(value: f64) -> f64 {
    value * 180.0 / PI
}

fn resolve_pos_dir(input: &Path, pos: u32) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let candidate = input.join(format!("Pos{}", pos));
    if candidate.is_dir() {
        return Ok(candidate);
    }
    let name = input
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if input.is_dir() && name == format!("pos{}", pos).to_ascii_lowercase() {
        return Ok(input.to_path_buf());
    }
    Err(format!("Position directory not found under input: Pos{}", pos).into())
}

fn load_requested_frame(
    args: &RegisterArgs,
) -> Result<(Vec<f32>, usize, usize), Box<dyn std::error::Error>> {
    let input = Path::new(&args.input);
    let pos_dir = resolve_pos_dir(input, args.pos)?;
    let index = discover_tiffs(&pos_dir, args.pos)?;
    let key = (args.channel, args.time, args.z);
    let frame_path = index.get(&key).ok_or_else(|| {
        format!(
            "Requested frame not found for channel={}, time={}, z={} in {}",
            args.channel,
            args.time,
            args.z,
            pos_dir.display()
        )
    })?;

    let (frame, width, height) = read_tiff_frame(frame_path)?;
    let out = match frame {
        FrameData::U16(v) => v.into_iter().map(|x| x as f32).collect(),
        FrameData::U8(v) => v.into_iter().map(|x| x as f32).collect(),
    };
    Ok((out, width as usize, height as usize))
}

fn local_variance(gray: &[f32], w: usize, h: usize, radius: usize) -> Vec<f32> {
    if radius == 0 {
        return vec![0.0; w * h];
    }
    let n = w * h;
    let mut int_sum = vec![0.0f64; n];
    let mut int_sq = vec![0.0f64; n];

    for y in 0..h {
        let mut row_sum = 0.0f64;
        let mut row_sq = 0.0f64;
        for x in 0..w {
            let idx = y * w + x;
            let v = gray[idx] as f64;
            row_sum += v;
            row_sq += v * v;
            int_sum[idx] = row_sum + if y > 0 { int_sum[idx - w] } else { 0.0 };
            int_sq[idx] = row_sq + if y > 0 { int_sq[idx - w] } else { 0.0 };
        }
    }

    let mut out = vec![0.0f32; n];
    for y in 0..h {
        for x in 0..w {
            let x0 = x.saturating_sub(radius);
            let y0 = y.saturating_sub(radius);
            let x1 = (x + radius).min(w - 1);
            let y1 = (y + radius).min(h - 1);

            let br = y1 * w + x1;
            let tl = if y0 > 0 && x0 > 0 {
                Some((y0 - 1) * w + (x0 - 1))
            } else {
                None
            };
            let tr = if y0 > 0 {
                Some((y0 - 1) * w + x1)
            } else {
                None
            };
            let bl = if x0 > 0 {
                Some(y1 * w + (x0 - 1))
            } else {
                None
            };

            let mut sum = int_sum[br];
            let mut sq = int_sq[br];
            if let Some(i) = tr {
                sum -= int_sum[i];
                sq -= int_sq[i];
            }
            if let Some(i) = bl {
                sum -= int_sum[i];
                sq -= int_sq[i];
            }
            if let Some(i) = tl {
                sum += int_sum[i];
                sq += int_sq[i];
            }

            let count = ((x1 - x0 + 1) * (y1 - y0 + 1)) as f64;
            let mean = sum / count;
            let variance = (sq / count) - mean * mean;
            out[y * w + x] = variance.max(0.0) as f32;
        }
    }

    out
}

fn otsu_threshold(data: &[f32]) -> f64 {
    if data.is_empty() {
        return 0.0;
    }
    let mut min_val = f32::INFINITY;
    let mut max_val = f32::NEG_INFINITY;
    for &v in data {
        if v < min_val {
            min_val = v;
        }
        if v > max_val {
            max_val = v;
        }
    }
    if (max_val - min_val).abs() <= f32::EPSILON {
        return min_val as f64;
    }

    let bins = 256usize;
    let mut hist = vec![0.0f64; bins];
    let range = (max_val - min_val) as f64;
    for &v in data {
        let normalized = ((v - min_val) as f64 / range).clamp(0.0, 1.0);
        let bin = (normalized * (bins as f64 - 1.0)).floor() as usize;
        hist[bin] += 1.0;
    }

    let total = data.len() as f64;
    let mut sum_all = 0.0f64;
    for (i, &hval) in hist.iter().enumerate() {
        sum_all += i as f64 * hval;
    }

    let mut sum_b = 0.0f64;
    let mut w_b = 0.0f64;
    let mut best_var = -1.0f64;
    let mut best_thresh = 0usize;
    for (i, &hval) in hist.iter().enumerate() {
        w_b += hval;
        if w_b == 0.0 {
            continue;
        }
        let w_f = total - w_b;
        if w_f == 0.0 {
            break;
        }
        sum_b += i as f64 * hval;
        let mean_b = sum_b / w_b;
        let mean_f = (sum_all - sum_b) / w_f;
        let diff = mean_b - mean_f;
        let between_var = w_b * w_f * diff * diff;
        if between_var > best_var {
            best_var = between_var;
            best_thresh = i;
        }
    }

    min_val as f64 + (best_thresh as f64 / (bins as f64 - 1.0)) * range
}

fn erode(src: &[f64], w: usize, h: usize, r: usize) -> Vec<f64> {
    let mut dst = vec![0.0f64; w * h];
    for y in 0..h {
        for x in 0..w {
            let mut all_one = true;
            'outer: for dy in -(r as isize)..=(r as isize) {
                for dx in -(r as isize)..=(r as isize) {
                    let ny = y as isize + dy;
                    let nx = x as isize + dx;
                    if ny < 0 || ny >= h as isize || nx < 0 || nx >= w as isize {
                        all_one = false;
                        break 'outer;
                    }
                    if src[ny as usize * w + nx as usize] == 0.0 {
                        all_one = false;
                        break 'outer;
                    }
                }
            }
            dst[y * w + x] = if all_one { 1.0 } else { 0.0 };
        }
    }
    dst
}

fn dilate(src: &[f64], w: usize, h: usize, r: usize) -> Vec<f64> {
    let mut dst = vec![0.0f64; w * h];
    for y in 0..h {
        for x in 0..w {
            let mut any_one = false;
            'outer: for dy in -(r as isize)..=(r as isize) {
                for dx in -(r as isize)..=(r as isize) {
                    let ny = y as isize + dy;
                    let nx = x as isize + dx;
                    if ny < 0 || ny >= h as isize || nx < 0 || nx >= w as isize {
                        continue;
                    }
                    if src[ny as usize * w + nx as usize] == 1.0 {
                        any_one = true;
                        break 'outer;
                    }
                }
            }
            dst[y * w + x] = if any_one { 1.0 } else { 0.0 };
        }
    }
    dst
}

fn morph_open(src: &[f64], w: usize, h: usize, r: usize) -> Vec<f64> {
    dilate(&erode(src, w, h, r), w, h, r)
}

fn morph_close(src: &[f64], w: usize, h: usize, r: usize) -> Vec<f64> {
    erode(&dilate(src, w, h, r), w, h, r)
}

fn fill_holes(src: &[f64], w: usize, h: usize) -> Vec<f64> {
    let mut dst = src.to_vec();
    let mut visited = vec![0u8; w * h];
    let mut queue = VecDeque::new();

    let enqueue =
        |idx: usize, dst: &mut [f64], visited: &mut [u8], queue: &mut VecDeque<usize>| {
            if visited[idx] == 0 && dst[idx] == 0.0 {
                visited[idx] = 1;
                queue.push_back(idx);
            }
        };

    for x in 0..w {
        enqueue(x, &mut dst, &mut visited, &mut queue);
        enqueue((h - 1) * w + x, &mut dst, &mut visited, &mut queue);
    }
    for y in 0..h {
        enqueue(y * w, &mut dst, &mut visited, &mut queue);
        enqueue(y * w + (w - 1), &mut dst, &mut visited, &mut queue);
    }

    while let Some(idx) = queue.pop_front() {
        let x = idx % w;
        let y = idx / w;
        if x > 0 {
            enqueue(idx - 1, &mut dst, &mut visited, &mut queue);
        }
        if x + 1 < w {
            enqueue(idx + 1, &mut dst, &mut visited, &mut queue);
        }
        if y > 0 {
            enqueue(idx - w, &mut dst, &mut visited, &mut queue);
        }
        if y + 1 < h {
            enqueue(idx + w, &mut dst, &mut visited, &mut queue);
        }
    }

    for i in 0..dst.len() {
        if dst[i] == 0.0 && visited[i] == 0 {
            dst[i] = 1.0;
        }
    }
    dst
}

fn dt1d(length: usize, f: &mut [f64], d: &mut [f64], v: &mut [usize], z: &mut [f64]) {
    const INF: f64 = 1e20;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    let mut k: isize = 0;

    for q in 1..length {
        let mut s = (f[q] + (q * q) as f64
            - (f[v[k as usize]] + (v[k as usize] * v[k as usize]) as f64))
            / (2.0 * q as f64 - 2.0 * v[k as usize] as f64);
        while s <= z[k as usize] {
            k -= 1;
            s = (f[q] + (q * q) as f64
                - (f[v[k as usize]] + (v[k as usize] * v[k as usize]) as f64))
                / (2.0 * q as f64 - 2.0 * v[k as usize] as f64);
        }
        k += 1;
        v[k as usize] = q;
        z[k as usize] = s;
        z[k as usize + 1] = INF;
    }

    k = 0;
    for q in 0..length {
        while z[k as usize + 1] < q as f64 {
            k += 1;
        }
        let dq = q as f64 - v[k as usize] as f64;
        d[q] = dq * dq + f[v[k as usize]];
    }
}

fn distance_transform(buf: &mut [f64], w: usize, h: usize) {
    const INF: f64 = 1e20;
    for v in buf.iter_mut() {
        *v = if *v == 0.0 { 0.0 } else { INF };
    }

    let max_dim = w.max(h);
    let mut f = vec![0.0f64; max_dim];
    let mut d = vec![0.0f64; max_dim];
    let mut v = vec![0usize; max_dim];
    let mut z = vec![0.0f64; max_dim + 1];

    for x in 0..w {
        for y in 0..h {
            f[y] = buf[y * w + x];
        }
        dt1d(h, &mut f, &mut d, &mut v, &mut z);
        for y in 0..h {
            buf[y * w + x] = d[y];
        }
    }

    for y in 0..h {
        let offset = y * w;
        for x in 0..w {
            f[x] = buf[offset + x];
        }
        dt1d(w, &mut f, &mut d, &mut v, &mut z);
        for x in 0..w {
            buf[offset + x] = d[x];
        }
    }

    for value in buf.iter_mut() {
        *value = value.sqrt();
    }
}

fn find_peaks(data: &[f64], w: usize, h: usize, min_val: f64, merge_radius: usize) -> Vec<Point> {
    if w < 3 || h < 3 {
        return vec![];
    }

    let mut raw = Vec::<(usize, usize, f64)>::new();
    for y in 1..(h - 1) {
        for x in 1..(w - 1) {
            let idx = y * w + x;
            let val = data[idx];
            if val < min_val {
                continue;
            }
            if val > data[idx - 1]
                && val > data[idx + 1]
                && val > data[idx - w]
                && val > data[idx + w]
                && val > data[idx - w - 1]
                && val > data[idx - w + 1]
                && val > data[idx + w - 1]
                && val > data[idx + w + 1]
            {
                raw.push((x, y, val));
            }
        }
    }
    raw.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(Ordering::Equal));

    let r2 = (merge_radius * merge_radius) as f64;
    let mut kept = Vec::<Point>::new();
    for (x, y, _) in raw {
        let px = x as f64;
        let py = y as f64;
        let mut too_close = false;
        for k in &kept {
            let dx = px - k.x;
            let dy = py - k.y;
            if dx * dx + dy * dy < r2 {
                too_close = true;
                break;
            }
        }
        if !too_close {
            kept.push(Point { x: px, y: py });
        }
    }
    kept
}

fn detect_grid_points(gray: &[f32], w: usize, h: usize, args: &RegisterArgs) -> Vec<Point> {
    let variance = local_variance(gray, w, h, args.local_var_radius);
    let mut log_var = vec![0.0f32; variance.len()];
    for (i, &v) in variance.iter().enumerate() {
        log_var[i] = (1.0 + v).ln();
    }
    let threshold = otsu_threshold(&log_var);

    let mut binary = vec![0.0f64; w * h];
    for i in 0..binary.len() {
        binary[i] = if log_var[i] as f64 >= threshold {
            1.0
        } else {
            0.0
        };
    }

    let mut cleaned = morph_open(&binary, w, h, args.morph_radius);
    cleaned = morph_close(&cleaned, w, h, args.morph_radius);
    cleaned = fill_holes(&cleaned, w, h);

    distance_transform(&mut cleaned, w, h);
    let mut max_dt = 0.0f64;
    for &v in &cleaned {
        if v > max_dt {
            max_dt = v;
        }
    }
    let min_val = args.peak_min_abs.max(max_dt * args.peak_min_ratio);
    let raw_peaks = find_peaks(&cleaned, w, h, min_val, args.peak_merge_radius);

    let mut peaks_with_dt = Vec::<(Point, f64)>::with_capacity(raw_peaks.len());
    for p in raw_peaks {
        peaks_with_dt.push((p, cleaned[p.y as usize * w + p.x as usize]));
    }
    peaks_with_dt.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(Ordering::Equal));

    let max_drop = (((peaks_with_dt.len() as f64) * args.peak_drop_max_frac.max(0.0)) as usize)
        .min(peaks_with_dt.len());
    let mut start_idx = 0usize;
    for i in 0..max_drop {
        let tail = &peaks_with_dt[i..];
        if tail.len() <= 3 {
            break;
        }
        let mut sum = 0.0f64;
        for (_, dt) in tail {
            sum += *dt;
        }
        let mean = sum / tail.len() as f64;
        if mean <= 0.0 {
            start_idx = i + 1;
            continue;
        }
        let mut var = 0.0f64;
        for (_, dt) in tail {
            let diff = *dt - mean;
            var += diff * diff;
        }
        var /= tail.len() as f64;
        let cv = var.sqrt() / mean;
        if cv < args.peak_cv_threshold {
            break;
        }
        start_idx = i + 1;
    }

    peaks_with_dt[start_idx..].iter().map(|row| row.0).collect()
}

fn fractional_offset(
    px: f64,
    py: f64,
    ax: f64,
    ay: f64,
    bx: f64,
    by: f64,
    det: f64,
    cx: f64,
    cy: f64,
) -> (f64, f64) {
    let rx = px - cx;
    let ry = py - cy;
    let u = (by * rx - bx * ry) / det;
    let v = (-ay * rx + ax * ry) / det;
    (u - js_round(u), v - js_round(v))
}

fn lattice_residual2(
    px: f64,
    py: f64,
    ax: f64,
    ay: f64,
    bx: f64,
    by: f64,
    det: f64,
    cx: f64,
    cy: f64,
) -> f64 {
    let (du, dv) = fractional_offset(px, py, ax, ay, bx, by, det, cx, cy);
    let ex = du * ax + dv * bx;
    let ey = du * ay + dv * by;
    ex * ex + ey * ey
}

fn median(values: &mut [f64]) -> f64 {
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));
    let mid = values.len() / 2;
    if values.len() % 2 == 1 {
        values[mid]
    } else {
        (values[mid - 1] + values[mid]) / 2.0
    }
}

fn median_origin(
    points: &[Point],
    ax: f64,
    ay: f64,
    bx: f64,
    by: f64,
    det: f64,
    cx: f64,
    cy: f64,
) -> (f64, f64) {
    let mut frac_u = Vec::<f64>::with_capacity(points.len());
    let mut frac_v = Vec::<f64>::with_capacity(points.len());
    for p in points {
        let (du, dv) = fractional_offset(p.x, p.y, ax, ay, bx, by, det, cx, cy);
        frac_u.push(du);
        frac_v.push(dv);
    }
    let mu = median(&mut frac_u);
    let mv = median(&mut frac_v);
    (mu * ax + mv * bx, mu * ay + mv * by)
}

fn compute_mse(
    points: &[Point],
    a: f64,
    alpha: f64,
    tx: f64,
    ty: f64,
    cx: f64,
    cy: f64,
    basis_angle: f64,
) -> f64 {
    let ax = a * alpha.cos();
    let ay = a * alpha.sin();
    let bx = a * (alpha + basis_angle).cos();
    let by = a * (alpha + basis_angle).sin();
    let det = ax * by - bx * ay;
    if det.abs() < 1e-9 {
        return f64::INFINITY;
    }
    let mut sum = 0.0f64;
    for p in points {
        sum += lattice_residual2(p.x - tx, p.y - ty, ax, ay, bx, by, det, cx, cy);
    }
    sum / points.len() as f64
}

fn estimate_pattern_count(
    canvas_w: usize,
    canvas_h: usize,
    a: f64,
    alpha: f64,
    b: f64,
    beta: f64,
) -> Option<f64> {
    let ax = a * alpha.cos();
    let ay = a * alpha.sin();
    let bx = b * beta.cos();
    let by = b * beta.sin();
    let det = ax * by - ay * bx;
    if det.abs() < 1e-9 {
        return None;
    }
    Some((canvas_w as f64 * canvas_h as f64) / det.abs())
}

fn fit_grid(
    points: &[Point],
    canvas_w: usize,
    canvas_h: usize,
    basis_angle: f64,
    inlier_frac: f64,
    refine_iters: usize,
) -> Option<FitResult> {
    if points.len() < 3 {
        return None;
    }

    let cx = canvas_w as f64 / 2.0;
    let cy = canvas_h as f64 / 2.0;

    let mut nn_vecs = Vec::<(f64, f64, f64)>::with_capacity(points.len());
    for i in 0..points.len() {
        let mut best_dist = f64::INFINITY;
        let mut best_dx = 0.0f64;
        let mut best_dy = 0.0f64;
        for j in 0..points.len() {
            if i == j {
                continue;
            }
            let dx = points[j].x - points[i].x;
            let dy = points[j].y - points[i].y;
            let d2 = dx * dx + dy * dy;
            if d2 < best_dist {
                best_dist = d2;
                best_dx = dx;
                best_dy = dy;
            }
        }
        if best_dist.is_finite() {
            nn_vecs.push((best_dx, best_dy, best_dist.sqrt()));
        }
    }
    if nn_vecs.is_empty() {
        return None;
    }

    let num_bins = 36usize;
    let bin_width = PI / num_bins as f64;
    let mut bin_entries = vec![Vec::<(f64, f64)>::new(); num_bins];
    for (dx, dy, mag) in nn_vecs {
        let mut ang = dy.atan2(dx);
        if ang < 0.0 {
            ang += PI;
        }
        let mut bin = (ang / bin_width).floor() as usize;
        if bin >= num_bins {
            bin = num_bins - 1;
        }
        bin_entries[bin].push((ang, mag));
    }

    let mut best_bin_idx = 0usize;
    for i in 1..num_bins {
        if bin_entries[i].len() > bin_entries[best_bin_idx].len() {
            best_bin_idx = i;
        }
    }
    if bin_entries[best_bin_idx].is_empty() {
        return None;
    }

    let mut angs_a: Vec<f64> = bin_entries[best_bin_idx].iter().map(|e| e.0).collect();
    let mut mags_a: Vec<f64> = bin_entries[best_bin_idx].iter().map(|e| e.1).collect();
    let alpha_a = median(&mut angs_a);
    let mag_a = median(&mut mags_a);

    let target_bin = (((((alpha_a + basis_angle) % PI) / bin_width).round() as isize)
        .rem_euclid(num_bins as isize)) as usize;
    let search_range = 3isize;
    let mut best_b_bin_idx = None::<usize>;
    let mut best_b_count = 0usize;
    for offset in -search_range..=search_range {
        let idx = (target_bin as isize + offset).rem_euclid(num_bins as isize) as usize;
        let count = bin_entries[idx].len();
        if count > best_b_count {
            best_b_count = count;
            best_b_bin_idx = Some(idx);
        }
    }
    if best_b_count == 0 || (best_b_count as f64) < (bin_entries[best_bin_idx].len() as f64 * 0.2) {
        return None;
    }
    let best_b_bin_idx = best_b_bin_idx?;
    let mut mags_b: Vec<f64> = bin_entries[best_b_bin_idx].iter().map(|e| e.1).collect();
    let mag_b = median(&mut mags_b);

    let mag = (mag_a + mag_b) / 2.0;
    let mut a = mag;
    let mut alpha = alpha_a;

    let ax = mag * alpha_a.cos();
    let ay = mag * alpha_a.sin();
    let bx = mag * (alpha_a + basis_angle).cos();
    let by = mag * (alpha_a + basis_angle).sin();
    let det = ax * by - bx * ay;
    if det.abs() < 1e-9 {
        return None;
    }

    let (mut tx, mut ty) = median_origin(points, ax, ay, bx, by, det, cx, cy);

    let mut with_res = Vec::<(Point, f64)>::with_capacity(points.len());
    for &p in points {
        with_res.push((
            p,
            lattice_residual2(p.x - tx, p.y - ty, ax, ay, bx, by, det, cx, cy),
        ));
    }
    with_res.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(Ordering::Equal));
    let clamped_frac = inlier_frac.clamp(0.05, 1.0);
    let inlier_count = ((points.len() as f64) * clamped_frac).ceil() as usize;
    let inlier_count = inlier_count.max(1).min(points.len());
    let inliers: Vec<Point> = with_res
        .iter()
        .take(inlier_count)
        .map(|entry| entry.0)
        .collect();

    let initial_mse = compute_mse(&inliers, a, alpha, tx, ty, cx, cy, basis_angle);

    let init = [a, alpha, tx, ty];
    let clamp_range = [a * 0.1, (5.0 * PI) / 180.0, 10.0, 10.0];
    let fd = [0.1, 0.0005, 0.1, 0.1];
    let mut params = [a, alpha, tx, ty];

    for _ in 0..refine_iters.max(1) {
        let mse = compute_mse(
            &inliers,
            params[0],
            params[1],
            params[2],
            params[3],
            cx,
            cy,
            basis_angle,
        );
        let mut grad = [0.0f64; 4];
        for d in 0..4 {
            let mut p1 = params;
            let mut p2 = params;
            p1[d] += fd[d];
            p2[d] -= fd[d];
            grad[d] = (compute_mse(&inliers, p1[0], p1[1], p1[2], p1[3], cx, cy, basis_angle)
                - compute_mse(&inliers, p2[0], p2[1], p2[2], p2[3], cx, cy, basis_angle))
                / (2.0 * fd[d]);
        }

        let mut improved = false;
        let mut step = 4.0f64;
        for _ in 0..15 {
            let mut candidate = [0.0f64; 4];
            for i in 0..4 {
                candidate[i] = params[i] - step * grad[i];
            }
            let mut clamped = false;
            for i in 0..4 {
                if (candidate[i] - init[i]).abs() > clamp_range[i] {
                    clamped = true;
                    break;
                }
            }
            if clamped {
                step *= 0.5;
                continue;
            }
            let candidate_mse = compute_mse(
                &inliers,
                candidate[0],
                candidate[1],
                candidate[2],
                candidate[3],
                cx,
                cy,
                basis_angle,
            );
            if candidate_mse < mse {
                params = candidate;
                improved = true;
                break;
            }
            step *= 0.5;
        }
        if !improved {
            break;
        }
    }

    a = params[0];
    alpha = params[1];
    tx = params[2];
    ty = params[3];
    let beta = alpha + basis_angle;
    let final_mse = compute_mse(&inliers, a, alpha, tx, ty, cx, cy, basis_angle);

    Some(FitResult {
        a,
        alpha: normalize_angle_rad(alpha),
        b: a,
        beta: normalize_angle_rad(beta),
        tx,
        ty,
        inlier_points: inliers.len(),
        initial_mse,
        final_mse,
    })
}

pub fn run(
    args: RegisterArgs,
    progress: impl Fn(f64, &str),
) -> Result<(), Box<dyn std::error::Error>> {
    if !args.no_progress {
        progress(0.05, "Loading frame");
    }
    let (gray, width, height) = load_requested_frame(&args)?;

    if !args.no_progress {
        progress(0.25, "Detecting grid points");
    }
    let points = detect_grid_points(&gray, width, height, &args);
    if points.len() < 3 {
        return Err(format!(
            "grid_fit_failed: detected only {} point(s); need at least 3",
            points.len()
        )
        .into());
    }

    let basis_angle = match args.grid {
        GridShape::Square => PI / 2.0,
        GridShape::Hex => PI / 3.0,
    };
    if !args.no_progress {
        progress(
            0.65,
            &format!("Fitting lattice from {} points", points.len()),
        );
    }
    let fit = fit_grid(
        &points,
        width,
        height,
        basis_angle,
        args.inlier_frac,
        args.refine_iters,
    )
    .ok_or("grid_fit_failed: insufficient peaks or unstable lattice fit")?;

    let estimated_patterns = estimate_pattern_count(
        width,
        height,
        fit.a,
        fit.alpha,
        fit.b,
        fit.beta,
    )
    .ok_or("grid_fit_failed: degenerate lattice basis")?;
    if estimated_patterns > MAX_ESTIMATED_PATTERNS {
        return Err(format!(
            "grid_fit_failed: estimated pattern count {} exceeds limit {}",
            estimated_patterns.round() as usize,
            MAX_ESTIMATED_PATTERNS as usize
        )
        .into());
    }

    if !args.no_progress {
        progress(1.0, "Register fit complete");
    }

    let shape = match args.grid {
        GridShape::Square => "square".to_string(),
        GridShape::Hex => "hex".to_string(),
    };
    let output = RegisterOutput {
        shape,
        a: fit.a,
        alpha: rad_to_deg(fit.alpha),
        b: fit.b,
        beta: rad_to_deg(fit.beta),
        w: args.w,
        h: args.h,
        dx: fit.tx,
        dy: fit.ty,
        diagnostics: if args.diagnostics {
            Some(RegisterDiagnostics {
                detected_points: points.len(),
                inlier_points: fit.inlier_points,
                initial_mse: fit.initial_mse,
                final_mse: fit.final_mse,
            })
        } else {
            None
        },
    };

    let json = if args.pretty {
        serde_json::to_string_pretty(&output)?
    } else {
        serde_json::to_string(&output)?
    };
    println!("{}", json);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fit_grid_square_from_synthetic_points() {
        let mut points = Vec::<Point>::new();
        let cx = 120.0f64;
        let cy = 100.0f64;
        let a = 30.0f64;
        for i in -3..=3 {
            for j in -3..=3 {
                points.push(Point {
                    x: cx + i as f64 * a,
                    y: cy + j as f64 * a,
                });
            }
        }

        let fit = fit_grid(&points, 240, 200, PI / 2.0, 0.95, 30).expect("fit should succeed");
        let beta_expected = fit.alpha + PI / 2.0;
        let angle_diff = normalize_angle_rad(fit.beta - beta_expected).abs();
        assert!(fit.a > 20.0 && fit.a < 40.0);
        assert!(angle_diff < 0.05);
    }

    #[test]
    fn estimate_pattern_count_rejects_dense_square_lattice() {
        let count = estimate_pattern_count(256, 256, 8.0, 0.0, 8.0, PI / 2.0).expect("finite det");
        assert!(count > MAX_ESTIMATED_PATTERNS);
    }
}
