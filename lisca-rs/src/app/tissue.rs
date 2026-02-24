use cellpose_rs::{CellposeSession, SegmentParams as CellposeParams};
use cellsam_rs::{CellsamSession, SegmentParams as CellsamParams};
use std::fs;
use std::io::Write;
use std::path::Path;

use crate::cli::commands::tissue::TissueArgs;
use crate::domain::schema;
use crate::io::zarr;

fn median_u16(values: &[u16]) -> u16 {
    if values.is_empty() {
        return 0;
    }
    let mut v: Vec<u16> = values.to_vec();
    let mid = v.len() / 2;
    if v.len() % 2 == 1 {
        v.select_nth_unstable(mid);
        v[mid]
    } else {
        v.select_nth_unstable(mid);
        let left_max = v[..mid].iter().max().copied().unwrap();
        ((left_max as u32 + v[mid] as u32) / 2) as u16
    }
}

fn build_chw_cellsam(mut phase: Vec<f32>, mut fluo: Vec<f32>, h: usize, w: usize) -> Vec<f32> {
    cellsam_rs::preprocess::minmax_normalize(&mut phase);
    cellsam_rs::preprocess::minmax_normalize(&mut fluo);
    let mut out = vec![0.0f32; 3 * h * w];
    out[..h * w].copy_from_slice(&phase);
    out[h * w..2 * h * w].copy_from_slice(&fluo);
    out[2 * h * w..].copy_from_slice(&phase);
    out
}

fn read_frame_f32(
    crop_arr: &zarr::StoreArray,
    t: u64,
    channel: u64,
    h: usize,
    w: usize,
) -> Result<Vec<f32>, Box<dyn std::error::Error>> {
    let chunk = zarr::read_chunk_u16(crop_arr, &[t, channel, 0, 0, 0])?;
    let out: Vec<f32> = chunk.iter().map(|&v| v as f32).collect();
    debug_assert_eq!(out.len(), h * w);
    Ok(out)
}

fn list_roi_ids(roi_store_path: &Path) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let roi_root = roi_store_path.join("roi");
    if !roi_root.exists() {
        return Ok(vec![]);
    }
    let mut ids: Vec<String> = fs::read_dir(&roi_root)?
        .filter_map(|e| {
            let e = e.ok()?;
            if e.file_type().ok()?.is_dir() {
                e.file_name().to_str().map(String::from)
            } else {
                None
            }
        })
        .collect();
    ids.sort();
    Ok(ids)
}

fn run_segment(
    args: &TissueArgs,
    roi_store_path: &Path,
    masks_path: &Path,
    progress: &impl Fn(f64, &str),
) -> Result<(), Box<dyn std::error::Error>> {
    let roi_ids = list_roi_ids(roi_store_path)?;
    if roi_ids.is_empty() {
        return Err("No ROIs found. Run crop task first.".into());
    }

    let model_dir = Path::new(&args.model);
    let method = args.method.as_str();

    if method == "cellpose" {
        let model_file = model_dir.join("model.onnx");
        if !model_file.exists() {
            return Err(format!("Cellpose model not found at {}", model_file.display()).into());
        }
    } else if method == "cellsam" {
        for name in ["image_encoder.onnx", "cellfinder.onnx", "mask_decoder.onnx", "image_pe.npy"] {
            if !model_dir.join(name).exists() {
                return Err(format!("CellSAM model file not found: {}/{}", model_dir.display(), name).into());
            }
        }
    } else {
        return Err(format!("Unknown method {method:?}. Use 'cellpose' or 'cellsam'.").into());
    }

    let crop_store = zarr::open_store(roi_store_path)?;
    let mask_store = zarr::open_store(masks_path)?;
    zarr::ensure_groups(&mask_store, &["/roi", "/index"])?;

    let mut total_frames = 0u64;
    for roi_id in &roi_ids {
        let arr = zarr::open_array(&crop_store, &schema::raw_array_path(roi_id))?;
        total_frames += arr.shape()[0];
    }
    let n_rois = roi_ids.len();

    if method == "cellpose" {
        let mut session = CellposeSession::new(&model_dir.join("model.onnx"), args.cpu)?;
        let mut done = 0u64;
        for (ci, roi_id) in roi_ids.iter().enumerate() {
            let arr = zarr::open_array(&crop_store, &schema::raw_array_path(roi_id))?;
            let shape = arr.shape();
            let n_t = shape[0] as usize;
            let h = shape[3] as usize;
            let w = shape[4] as usize;

            let mask_arr = zarr::create_array_u16(
                &mask_store,
                &format!("/roi/{}/mask", roi_id),
                vec![n_t as u64, h as u64, w as u64],
                vec![1, h as u64, w as u64],
                Some(serde_json::json!({"axis_names": ["t","y","x"]}).as_object().cloned().unwrap()),
            )?;

            for t in 0..n_t {
                let phase = read_frame_f32(&arr, t as u64, args.channel_phase as u64, h, w)?;
                let fluo = read_frame_f32(&arr, t as u64, args.channel_fluorescence as u64, h, w)?;
                let chw = cellpose_rs::preprocess::build_chw_image(phase, fluo, h, w);
                let params = CellposeParams { batch_size: args.batch_size, ..Default::default() };
                let masks_u32 = session.segment(&chw, h, w, params)?;
                let masks_u16: Vec<u16> = masks_u32.iter().map(|&v| v as u16).collect();
                zarr::store_chunk_u16(&mask_arr, &[t as u64, 0, 0], &masks_u16)?;
                done += 1;
                progress(done as f64 / total_frames as f64 * 0.5, &format!("Segment roi {}/{}, frame {}/{}", ci + 1, n_rois, t + 1, n_t));
            }
        }
    } else {
        let mut session = CellsamSession::new(model_dir, args.cpu)?;
        let mut done = 0u64;
        for (ci, roi_id) in roi_ids.iter().enumerate() {
            let arr = zarr::open_array(&crop_store, &schema::raw_array_path(roi_id))?;
            let shape = arr.shape();
            let n_t = shape[0] as usize;
            let h = shape[3] as usize;
            let w = shape[4] as usize;

            let mask_arr = zarr::create_array_u16(
                &mask_store,
                &format!("/roi/{}/mask", roi_id),
                vec![n_t as u64, h as u64, w as u64],
                vec![1, h as u64, w as u64],
                Some(serde_json::json!({"axis_names": ["t","y","x"]}).as_object().cloned().unwrap()),
            )?;

            for t in 0..n_t {
                let phase = read_frame_f32(&arr, t as u64, args.channel_phase as u64, h, w)?;
                let fluo = read_frame_f32(&arr, t as u64, args.channel_fluorescence as u64, h, w)?;
                let chw = build_chw_cellsam(phase, fluo, h, w);
                let params = CellsamParams::default();
                let masks_u32 = session.segment(&chw, h, w, params)?;
                let masks_u16: Vec<u16> = masks_u32.iter().map(|&v| v as u16).collect();
                zarr::store_chunk_u16(&mask_arr, &[t as u64, 0, 0], &masks_u16)?;
                done += 1;
                progress(done as f64 / total_frames as f64 * 0.5, &format!("Segment roi {}/{}, frame {}/{}", ci + 1, n_rois, t + 1, n_t));
            }
        }
    }

    Ok(())
}

fn run_analyze(
    args: &TissueArgs,
    roi_store_path: &Path,
    bg_store_path: &Path,
    masks_path: &Path,
    progress: &impl Fn(f64, &str),
) -> Result<(), Box<dyn std::error::Error>> {
    let roi_ids = list_roi_ids(roi_store_path)?;

    let crop_store = zarr::open_store(roi_store_path)?;
    let bg_store = if bg_store_path.exists() { Some(zarr::open_store(bg_store_path)?) } else { None };
    let mask_store = zarr::open_store(masks_path)?;

    let mut wtr = fs::File::create(Path::new(&args.output))?;
    writeln!(wtr, "t,crop,cell,total_fluorescence,cell_area,background")?;

    let n_rois = roi_ids.len();
    let mut total_frames = 0u64;
    for roi_id in &roi_ids {
        let arr = zarr::open_array(&crop_store, &schema::raw_array_path(roi_id))?;
        total_frames += arr.shape()[0];
    }
    let mut done = 0u64;

    for (ci, roi_id) in roi_ids.iter().enumerate() {
        let arr = zarr::open_array(&crop_store, &schema::raw_array_path(roi_id))?;
        let shape = arr.shape();
        let n_t = shape[0] as usize;
        let h = shape[3] as usize;
        let w = shape[4] as usize;

        let mask_arr = zarr::open_array(&mask_store, &format!("/roi/{}/mask", roi_id))?;
        let bg_arr = if let Some(ref bg_store) = bg_store {
            zarr::open_array(bg_store, &schema::bg_array_path(roi_id)).ok()
        } else {
            None
        };

        for t in 0..n_t {
            let fluo_raw = zarr::read_chunk_u16(&arr, &[t as u64, args.channel_fluorescence as u64, 0, 0, 0])?;
            let masks = zarr::read_chunk_u16(&mask_arr, &[t as u64, 0, 0])?;

            let max_label = *masks.iter().max().unwrap_or(&0) as usize;
            if max_label == 0 {
                done += 1;
                progress(0.5 + done as f64 / total_frames as f64 * 0.5, &format!("Analyze roi {}/{}, frame {}/{}", ci + 1, n_rois, t + 1, n_t));
                continue;
            }

            let mut sums = vec![0.0f64; max_label + 1];
            let mut counts = vec![0u64; max_label + 1];
            for i in 0..h * w {
                let lbl = masks[i] as usize;
                if lbl > 0 {
                    sums[lbl] += fluo_raw[i] as f64;
                    counts[lbl] += 1;
                }
            }

            let bg_val = if let Some(ref bg_arr) = bg_arr {
                zarr::read_chunk_u16(bg_arr, &[t as u64, args.channel_fluorescence as u64, 0])
                    .ok()
                    .and_then(|d| d.first().copied())
                    .unwrap_or_else(|| median_u16(&fluo_raw))
            } else {
                median_u16(&fluo_raw)
            };

            for lbl in 1..=max_label {
                if counts[lbl] > 0 {
                    writeln!(wtr, "{},{},{},{},{},{}", t, roi_id, lbl, sums[lbl], counts[lbl], bg_val)?;
                }
            }

            done += 1;
            progress(0.5 + done as f64 / total_frames as f64 * 0.5, &format!("Analyze roi {}/{}, frame {}/{}", ci + 1, n_rois, t + 1, n_t));
        }
    }

    Ok(())
}

pub fn run(args: TissueArgs, progress: impl Fn(f64, &str)) -> Result<(), Box<dyn std::error::Error>> {
    let workspace = Path::new(&args.workspace);
    let roi_store_path = workspace.join(schema::roi_store_dir(args.pos));
    let bg_store_path = workspace.join(schema::bg_store_dir(args.pos));
    let masks_path = args
        .masks
        .as_ref()
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| workspace.join(format!("Pos{}_masks.zarr", args.pos)));

    run_segment(&args, &roi_store_path, &masks_path, &progress)?;
    run_analyze(&args, &roi_store_path, &bg_store_path, &masks_path, &progress)?;

    progress(1.0, "Done");
    Ok(())
}
