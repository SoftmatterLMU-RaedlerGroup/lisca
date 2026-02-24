use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use crate::cli::commands::crop::CropArgs;
use crate::domain::schema;
use crate::domain::types::BBox;
use crate::io::tiff::{discover_tiffs, read_tiff_frame, FrameData};
use crate::io::zarr;

fn parse_bbox_csv(path: &Path) -> Result<Vec<BBox>, Box<dyn std::error::Error>> {
    let s = fs::read_to_string(path)?;
    let lines: Vec<&str> = s.trim().lines().collect();
    if lines.len() < 2 {
        return Ok(vec![]);
    }
    let header = lines[0].to_lowercase();
    let cols: Vec<&str> = header.split(',').map(|c| c.trim()).collect();
    let crop_idx = cols.iter().position(|c| *c == "crop").ok_or("Missing crop column")?;
    let x_idx = cols.iter().position(|c| *c == "x").ok_or("Missing x column")?;
    let y_idx = cols.iter().position(|c| *c == "y").ok_or("Missing y column")?;
    let w_idx = cols.iter().position(|c| *c == "w").ok_or("Missing w column")?;
    let h_idx = cols.iter().position(|c| *c == "h").ok_or("Missing h column")?;

    let mut out = Vec::new();
    for line in lines.iter().skip(1) {
        let parts: Vec<&str> = line.split(',').collect();
        if parts.len() <= *[crop_idx, x_idx, y_idx, w_idx, h_idx].iter().max().unwrap() {
            continue;
        }
        out.push(BBox {
            crop: parts[crop_idx].trim().to_string(),
            x: parts[x_idx].trim().parse()?,
            y: parts[y_idx].trim().parse()?,
            w: parts[w_idx].trim().parse()?,
            h: parts[h_idx].trim().parse()?,
        });
    }
    Ok(out)
}

fn extract_crop_u16(frame: &[u16], frame_width: u32, x: u32, y: u32, w: u32, h: u32) -> Vec<u16> {
    let mut out = vec![0u16; (w * h) as usize];
    for r in 0..h {
        let src_start = ((y + r) * frame_width + x) as usize;
        let dst_start = (r * w) as usize;
        out[dst_start..dst_start + w as usize].copy_from_slice(&frame[src_start..src_start + w as usize]);
    }
    out
}

fn median_u16_in_place(values: &mut [u16]) -> u16 {
    if values.is_empty() {
        return 0;
    }
    let mid = values.len() / 2;
    if values.len() % 2 == 1 {
        values.select_nth_unstable(mid);
        values[mid]
    } else {
        values.select_nth_unstable(mid);
        let left_max = values[..mid].iter().max().copied().unwrap();
        ((left_max as u32 + values[mid] as u32) / 2) as u16
    }
}

fn median_outside_mask_u16(frame: &[u16], width: u32, height: u32, mask: &[bool]) -> u16 {
    let mut values = Vec::new();
    let n = (width * height) as usize;
    for i in 0..n {
        if !mask[i] {
            values.push(frame[i]);
        }
    }
    median_u16_in_place(&mut values)
}

fn median_outside_mask_u8(frame: &[u8], width: u32, height: u32, mask: &[bool]) -> u16 {
    let mut values = Vec::new();
    let n = (width * height) as usize;
    for i in 0..n {
        if !mask[i] {
            values.push(frame[i] as u16);
        }
    }
    median_u16_in_place(&mut values)
}

pub fn run(args: CropArgs, progress: impl Fn(f64, &str)) -> Result<(), Box<dyn std::error::Error>> {
    let pos_dir_candidate = Path::new(&args.input).join(format!("Pos{}", args.pos));
    let pos_dir = if pos_dir_candidate.exists() {
        pos_dir_candidate
    } else {
        let p = Path::new(&args.input);
        if p.file_name().map(|v| v.to_string_lossy().to_string()) == Some(format!("Pos{}", args.pos)) {
            p.to_path_buf()
        } else {
            return Err(format!("Position directory not found under input: Pos{}", args.pos).into());
        }
    };

    let bboxes = parse_bbox_csv(Path::new(&args.bbox))?;
    if bboxes.is_empty() {
        return Err("No valid bounding boxes in bbox CSV".into());
    }

    let index = discover_tiffs(&pos_dir, args.pos)?;
    if index.is_empty() {
        return Err(format!("No TIFFs found in {}", pos_dir.display()).into());
    }

    let mut keys: Vec<_> = index.keys().copied().collect();
    keys.sort();

    let channels: HashSet<u32> = keys.iter().map(|k| k.0).collect();
    let times: HashSet<u32> = keys.iter().map(|k| k.1).collect();
    let zs: HashSet<u32> = keys.iter().map(|k| k.2).collect();

    let mut channel_vals: Vec<u32> = channels.into_iter().collect();
    let mut time_vals: Vec<u32> = times.into_iter().collect();
    let mut z_vals: Vec<u32> = zs.into_iter().collect();
    channel_vals.sort();
    time_vals.sort();
    z_vals.sort();

    let c_to_i: HashMap<u32, usize> = channel_vals.iter().enumerate().map(|(i, v)| (*v, i)).collect();
    let t_to_i: HashMap<u32, usize> = time_vals.iter().enumerate().map(|(i, v)| (*v, i)).collect();
    let z_to_i: HashMap<u32, usize> = z_vals.iter().enumerate().map(|(i, v)| (*v, i)).collect();

    let n_channels = channel_vals.len();
    let n_times = time_vals.len();
    let n_z = z_vals.len();

    let first_path = index.get(&keys[0]).unwrap();
    let (_, width, height) = read_tiff_frame(first_path)?;

    let workspace = Path::new(&args.output);
    fs::create_dir_all(workspace)?;
    let roi_path = workspace.join(schema::roi_store_dir(args.pos));
    let bg_path = workspace.join(schema::bg_store_dir(args.pos));

    let roi_store = zarr::open_store(&roi_path)?;
    let bg_store = zarr::open_store(&bg_path)?;
    zarr::ensure_groups(&roi_store, &["/roi", "/index"])?;
    zarr::ensure_groups(&bg_store, &["/roi", "/index"])?;

    let roi_ids: Vec<i32> = bboxes.iter().map(|b| b.crop.parse::<i32>().unwrap_or(0)).collect();
    let idx_roi_ids = zarr::create_array_i32(&roi_store, schema::roi_ids_path(), vec![roi_ids.len() as u64], vec![roi_ids.len() as u64])?;
    zarr::store_chunk_i32(&idx_roi_ids, &[0], &roi_ids)?;
    let idx_bg_roi_ids = zarr::create_array_i32(&bg_store, schema::roi_ids_path(), vec![roi_ids.len() as u64], vec![roi_ids.len() as u64])?;
    zarr::store_chunk_i32(&idx_bg_roi_ids, &[0], &roi_ids)?;

    let idx_bbox = zarr::create_array_i32(&roi_store, schema::roi_bboxes_path(), vec![roi_ids.len() as u64, n_times as u64, 4], vec![roi_ids.len() as u64, n_times as u64, 4])?;
    let mut bbox_data: Vec<i32> = Vec::with_capacity(roi_ids.len() * n_times * 4);
    for bb in &bboxes {
        for _ in 0..n_times {
            bbox_data.extend_from_slice(&[bb.x as i32, bb.y as i32, bb.w as i32, bb.h as i32]);
        }
    }
    zarr::store_chunk_i32(&idx_bbox, &[0, 0, 0], &bbox_data)?;

    let idx_present = zarr::create_array_u8(&roi_store, schema::roi_present_path(), vec![roi_ids.len() as u64, n_times as u64], vec![roi_ids.len() as u64, n_times as u64])?;
    let present_data = vec![1u8; roi_ids.len() * n_times];
    zarr::store_chunk_u8(&idx_present, &[0, 0], &present_data)?;

    let mut raw_arrays: HashMap<String, zarr::StoreArray> = HashMap::new();
    let mut bg_arrays: HashMap<String, zarr::StoreArray> = HashMap::new();

    for bb in &bboxes {
        let roi_id = &bb.crop;
        let raw_path = schema::raw_array_path(roi_id);
        let raw_shape = vec![n_times as u64, n_channels as u64, n_z as u64, bb.h as u64, bb.w as u64];
        let raw_chunks = vec![(16usize.min(n_times)) as u64, (2usize.min(n_channels)) as u64, 1, (256u32.min(bb.h)) as u64, (256u32.min(bb.w)) as u64];
        let attrs = serde_json::json!({"schema_version": schema::SCHEMA_VERSION, "axis_names": ["t","c","z","y","x"]}).as_object().cloned();
        let arr = zarr::create_array_u16(&roi_store, &raw_path, raw_shape, raw_chunks, attrs)?;
        raw_arrays.insert(roi_id.clone(), arr);

        if args.background {
            let bg_path_arr = schema::bg_array_path(roi_id);
            let bg_shape = vec![n_times as u64, n_channels as u64, n_z as u64];
            let bg_chunks = vec![(64usize.min(n_times)) as u64, n_channels as u64, n_z as u64];
            let attrs = serde_json::json!({"schema_version": schema::SCHEMA_VERSION, "axis_names": ["t","c","z"]}).as_object().cloned();
            let arr = zarr::create_array_u16(&bg_store, &bg_path_arr, bg_shape, bg_chunks, attrs)?;
            bg_arrays.insert(roi_id.clone(), arr);
        }
    }

    let mask: Vec<bool> = if args.background {
        let mut m = vec![false; (width * height) as usize];
        for bb in &bboxes {
            for dy in 0..bb.h {
                for dx in 0..bb.w {
                    let idx = ((bb.y + dy) * width + (bb.x + dx)) as usize;
                    if idx < m.len() {
                        m[idx] = true;
                    }
                }
            }
        }
        m
    } else {
        vec![]
    };

    let total = keys.len();
    for (i, &(c, t, z)) in keys.iter().enumerate() {
        let path = index.get(&(c, t, z)).unwrap();
        let (frame_data, _w, _h) = read_tiff_frame(path)?;

        match &frame_data {
            FrameData::U16(frame) => {
                for bb in &bboxes {
                    let crop_data = extract_crop_u16(frame, width, bb.x, bb.y, bb.w, bb.h);
                    let chunk_indices = [
                        *t_to_i.get(&t).unwrap() as u64,
                        *c_to_i.get(&c).unwrap() as u64,
                        *z_to_i.get(&z).unwrap() as u64,
                        0,
                        0,
                    ];
                    let arr = raw_arrays.get(&bb.crop).unwrap();
                    zarr::store_chunk_u16(arr, &chunk_indices, &crop_data)?;
                }
                if args.background {
                    let val = median_outside_mask_u16(frame, width, height, &mask);
                    for bb in &bboxes {
                        let chunk_indices = [
                            *t_to_i.get(&t).unwrap() as u64,
                            *c_to_i.get(&c).unwrap() as u64,
                            *z_to_i.get(&z).unwrap() as u64,
                        ];
                        let arr = bg_arrays.get(&bb.crop).unwrap();
                        zarr::store_chunk_u16(arr, &chunk_indices, &[val])?;
                    }
                }
            }
            FrameData::U8(frame) => {
                let frame_u16: Vec<u16> = frame.iter().map(|&v| v as u16).collect();
                for bb in &bboxes {
                    let crop_data = extract_crop_u16(&frame_u16, width, bb.x, bb.y, bb.w, bb.h);
                    let chunk_indices = [
                        *t_to_i.get(&t).unwrap() as u64,
                        *c_to_i.get(&c).unwrap() as u64,
                        *z_to_i.get(&z).unwrap() as u64,
                        0,
                        0,
                    ];
                    let arr = raw_arrays.get(&bb.crop).unwrap();
                    zarr::store_chunk_u16(arr, &chunk_indices, &crop_data)?;
                }
                if args.background {
                    let val = median_outside_mask_u8(frame, width, height, &mask);
                    for bb in &bboxes {
                        let chunk_indices = [
                            *t_to_i.get(&t).unwrap() as u64,
                            *c_to_i.get(&c).unwrap() as u64,
                            *z_to_i.get(&z).unwrap() as u64,
                        ];
                        let arr = bg_arrays.get(&bb.crop).unwrap();
                        zarr::store_chunk_u16(arr, &chunk_indices, &[val])?;
                    }
                }
            }
        }

        progress((i + 1) as f64 / total as f64, &format!("Reading frames {}/{}", i + 1, total));
    }

    progress(1.0, &format!("Wrote {} and {}", roi_path.display(), bg_path.display()));
    Ok(())
}
