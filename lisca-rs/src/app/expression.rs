use std::fs;
use std::path::Path;

use crate::cli::commands::expression::ExpressionArgs;
use crate::domain::schema;
use crate::io::zarr;

fn list_roi_ids_from_store(roi_store_path: &Path) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let roi_root = roi_store_path.join("roi");
    if !roi_root.exists() {
        return Ok(vec![]);
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
    Ok(roi_ids)
}

pub fn run(args: ExpressionArgs, progress: impl Fn(f64, &str)) -> Result<(), Box<dyn std::error::Error>> {
    let workspace = Path::new(&args.workspace);
    let roi_store_path = workspace.join(schema::roi_store_dir(args.pos));
    let bg_store_path = workspace.join(schema::bg_store_dir(args.pos));

    let roi_ids = list_roi_ids_from_store(&roi_store_path)?;
    if roi_ids.is_empty() {
        fs::create_dir_all(Path::new(&args.output).parent().unwrap_or(Path::new(".")))?;
        fs::write(&args.output, "t,crop,intensity,area,background\n")?;
        return Ok(());
    }

    let roi_store = zarr::open_store(&roi_store_path)?;
    let bg_store = if bg_store_path.exists() { Some(zarr::open_store(&bg_store_path)?) } else { None };

    let mut rows: Vec<String> = vec!["t,crop,intensity,area,background".to_string()];
    let total = roi_ids.len();

    for (i, roi_id) in roi_ids.iter().enumerate() {
        let raw_path = schema::raw_array_path(roi_id);
        let arr = zarr::open_array(&roi_store, &raw_path)?;
        let shape = arr.shape();
        let n_t = shape[0] as usize;
        let area = (shape[3] * shape[4]) as u64;

        let bg_arr = if let Some(ref bg_store) = bg_store {
            let p = schema::bg_array_path(roi_id);
            zarr::open_array(bg_store, &p).ok()
        } else {
            None
        };

        for t in 0..n_t {
            let data = zarr::read_chunk_u16(&arr, &[t as u64, args.channel as u64, 0, 0, 0])?;
            let intensity: u64 = data.iter().map(|&v| v as u64).sum();
            let background = if let Some(ref bg_arr) = bg_arr {
                zarr::read_chunk_u16(bg_arr, &[t as u64, args.channel as u64, 0])
                    .ok()
                    .and_then(|d| d.first().copied())
                    .unwrap_or(0)
            } else {
                0
            };
            rows.push(format!("{},{},{},{},{}", t, roi_id, intensity, area, background));
        }

        progress((i + 1) as f64 / total as f64, &format!("Processing ROI {}/{}", i + 1, total));
    }

    fs::create_dir_all(Path::new(&args.output).parent().unwrap_or(Path::new(".")))?;
    fs::write(&args.output, rows.join("\n"))?;
    progress(1.0, &format!("Wrote {} rows to {}", rows.len() - 1, args.output));
    Ok(())
}
