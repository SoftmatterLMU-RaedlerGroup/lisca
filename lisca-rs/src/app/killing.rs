use image::{imageops::FilterType, GrayImage, ImageBuffer, Luma};
use ndarray::{Array, ArrayViewD, Ix4};
use ort::session::Session;
use ort::value::Tensor;
#[cfg(any(windows, target_os = "linux"))]
use ort::ep::{CUDA, ExecutionProvider};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use crate::cli::commands::killing::KillingArgs;
use crate::common::progress;
use crate::domain::schema;
use crate::io::zarr;

const IMAGE_SIZE: u32 = 224;
const IMAGENET_MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const IMAGENET_STD: [f32; 3] = [0.229, 0.224, 0.225];

struct RoiFrame {
    t: u64,
    roi_id: String,
    data: Vec<u16>,
    height: u64,
    width: u64,
}

struct FrameIndex {
    roi_id: String,
    t: u64,
    height: u64,
    width: u64,
}

fn build_session(model_path: &Path, use_cuda: bool) -> Result<Session, Box<dyn std::error::Error>> {
    #[cfg(any(windows, target_os = "linux"))]
    if use_cuda {
        let mut builder = Session::builder()?;
        let cuda = CUDA::default();
        if cuda.is_available().unwrap_or(false) && cuda.register(&mut builder).is_ok() {
            if let Ok(s) = builder.commit_from_file(model_path) {
                return Ok(s);
            }
        }
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    let _ = use_cuda;
    Ok(Session::builder()?.commit_from_file(model_path)?)
}

fn normalize_frame(data: &[u16]) -> Vec<u8> {
    if data.is_empty() {
        return vec![];
    }
    let (min, max) = data.iter().fold((data[0], data[0]), |(mn, mx), &v| (mn.min(v), mx.max(v)));
    let range = (max - min) as f64;
    data.iter()
        .map(|&v| {
            if range > 0.0 {
                (((v - min) as f64 / range) * 255.0).round() as u8
            } else {
                0
            }
        })
        .collect()
}

fn resize_to_224(data: &[u8], width: u32, height: u32) -> GrayImage {
    let img = ImageBuffer::<Luma<u8>, Vec<u8>>::from_raw(width, height, data.to_vec())
        .unwrap_or_else(|| ImageBuffer::from_raw(width, height, vec![0; (width * height) as usize]).unwrap());
    image::imageops::resize(&img, IMAGE_SIZE, IMAGE_SIZE, FilterType::Triangle)
}

fn to_nchw_normalized(gray: &GrayImage) -> Vec<f32> {
    let n = (IMAGE_SIZE * IMAGE_SIZE) as usize;
    let mut out = vec![0.0f32; 3 * n];
    for (i, &v) in gray.as_raw().iter().enumerate() {
        let normalized = v as f32 / 255.0;
        for c in 0..3 {
            out[c * n + i] = (normalized - IMAGENET_MEAN[c]) / IMAGENET_STD[c];
        }
    }
    out
}

pub fn run(args: KillingArgs, progress_cb: impl Fn(f64, &str)) -> Result<(), Box<dyn std::error::Error>> {
    let workspace = Path::new(&args.workspace);
    let roi_store_path = workspace.join(schema::roi_store_dir(args.pos));
    let roi_root = roi_store_path.join("roi");

    if !roi_root.exists() {
        return Err("No ROIs found for position. Run crop task first.".into());
    }

    let mut roi_ids: Vec<String> = fs::read_dir(&roi_root)?
        .filter_map(|e| {
            let e = e.ok()?;
            if e.file_type().ok()?.is_dir() {
                e.file_name().to_str().map(String::from)
            } else {
                None
            }
        })
        .collect();
    roi_ids.sort();

    if roi_ids.is_empty() {
        return Err("No ROIs found for position.".into());
    }

    let store = zarr::open_store(&roi_store_path)?;

    let mut indices: Vec<FrameIndex> = Vec::new();
    for (i, roi_id) in roi_ids.iter().enumerate() {
        if i > 0 && i % 100 == 0 {
            progress_cb(i as f64 / roi_ids.len() as f64 * 0.2, &format!("Scanning {}/{} rois", i, roi_ids.len()));
        }
        let array_path = schema::raw_array_path(roi_id);
        let arr = zarr::open_array(&store, &array_path)?;
        let shape = arr.shape();
        for t in 0..shape[0] {
            indices.push(FrameIndex {
                roi_id: roi_id.clone(),
                t,
                height: shape[3],
                width: shape[4],
            });
        }
    }

    let total = indices.len();
    if total == 0 {
        fs::create_dir_all(Path::new(&args.output).parent().unwrap_or(Path::new(".")))?;
        fs::write(&args.output, "t,crop,label\n")?;
        progress_cb(1.0, "No frames to predict, wrote empty CSV.");
        return Ok(());
    }

    let model_path = Path::new(&args.model).join("model.onnx");
    if !model_path.exists() {
        return Err(format!("Model not found at {}", model_path.display()).into());
    }

    let mut session = build_session(&model_path, !args.cpu)?;
    let input_name = session.inputs().first().ok_or("Model has no inputs")?.name().to_string();

    let mut rows: Vec<(u64, String, bool)> = Vec::new();
    let mut array_cache: HashMap<String, zarr::StoreArray> = HashMap::new();

    for (batch_start, index_chunk) in indices.chunks(args.batch_size).enumerate() {
        let mut batch_frames: Vec<RoiFrame> = Vec::with_capacity(index_chunk.len());
        for idx in index_chunk {
            if !array_cache.contains_key(&idx.roi_id) {
                let arr = zarr::open_array(&store, &schema::raw_array_path(&idx.roi_id))?;
                array_cache.insert(idx.roi_id.clone(), arr);
            }
            let arr = array_cache.get(&idx.roi_id).unwrap();
            let data = zarr::read_chunk_u16(arr, &[idx.t, 0, 0, 0, 0])?;
            batch_frames.push(RoiFrame {
                t: idx.t,
                roi_id: idx.roi_id.clone(),
                data,
                height: idx.height,
                width: idx.width,
            });
        }

        let batch_len = batch_frames.len();
        let mut batch_data = vec![0.0f32; batch_len * 3 * IMAGE_SIZE as usize * IMAGE_SIZE as usize];

        for (i, frame) in batch_frames.iter().enumerate() {
            let normalized = normalize_frame(&frame.data);
            let resized = resize_to_224(&normalized, frame.width as u32, frame.height as u32);
            let nchw = to_nchw_normalized(&resized);
            let offset = i * 3 * IMAGE_SIZE as usize * IMAGE_SIZE as usize;
            batch_data[offset..offset + nchw.len()].copy_from_slice(&nchw);
        }

        let shape: Ix4 = ndarray::Dim([batch_len, 3, IMAGE_SIZE as usize, IMAGE_SIZE as usize]);
        let arr = Array::from_shape_vec(shape, batch_data)?;
        let input_tensor = Tensor::from_array(arr)?;
        let input = ort::inputs![input_name.as_str() => input_tensor];

        let outputs = session.run(input)?;
        let output = &outputs[0];
        let logits: ArrayViewD<f32> = output.try_extract_array()?;

        let ndim = logits.ndim();
        let num_classes = if ndim >= 2 { logits.shape()[ndim - 1] } else { 2 };
        for (i, frame) in batch_frames.iter().enumerate() {
            let mut max_idx = 0;
            let mut max_val = if ndim == 2 { logits[[i, 0]] } else { logits[[i, 0, 0, 0]] };
            for c in 1..num_classes {
                let v = if ndim == 2 { logits[[i, c]] } else { logits[[i, c, 0, 0]] };
                if v > max_val {
                    max_val = v;
                    max_idx = c;
                }
            }
            rows.push((frame.t, frame.roi_id.clone(), max_idx == 1));
        }

        let processed = (batch_start + 1) * args.batch_size;
        let prog = 0.2 + (processed.min(total) as f64 / total as f64) * 0.8;
        progress_cb(prog, &format!("Predicting {}/{}", processed.min(total), total));
    }

    fs::create_dir_all(Path::new(&args.output).parent().unwrap_or(Path::new(".")))?;
    let mut csv = "t,crop,label\n".to_string();
    for (t, crop, label) in &rows {
        csv.push_str(&format!("{},{},{}\n", t, crop, label.to_string().to_lowercase()));
    }
    fs::write(&args.output, csv)?;
    progress::emit(1.0, &format!("Wrote {} rows to {}", rows.len(), args.output));

    Ok(())
}
