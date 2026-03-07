use std::collections::BTreeSet;
use std::env;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use lisca_rs::app::crop as crop_app;
use lisca_rs::app::killing as killing_app;
use lisca_rs::app::register as register_app;
use lisca_rs::cli::commands::{
    crop::CropArgs,
    killing::KillingArgs,
    register::{GridShape, RegisterArgs},
};
use lisca_rs::domain::schema;
use lisca_rs::io::tiff::{read_tiff_frame, FrameData};
use lisca_rs::io::zarr;
use reqwest::blocking;
use rfd::FileDialog;
use rusqlite::{params, Connection};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{self, json, Value};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;
use zip::ZipArchive;

const SETTINGS_DOWNLOAD_PROGRESS_CHANNEL: &str = "settings:download-assets-progress";
const APP_SQLITE_FILE: &str = "lisca-desktop.sqlite";
const MODEL_DOWNLOADS: [(&str, &str); 3] = [
    (
        "model.onnx",
        "https://huggingface.co/keejkrej/resnet18/resolve/main/model.onnx",
    ),
    (
        "config.json",
        "https://huggingface.co/keejkrej/resnet18/resolve/main/config.json",
    ),
    (
        "preprocessor_config.json",
        "https://huggingface.co/keejkrej/resnet18/resolve/main/preprocessor_config.json",
    ),
];
const FFMPEG_ZIP_URL: &str = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";

#[derive(Serialize, Deserialize, Clone)]
struct AssayRecord {
    id: String,
    name: String,
    time: String,
    #[serde(rename = "type")]
    assay_type: String,
    folder: String,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    updated_at: String,
}

#[derive(Serialize)]
struct AssayListItem {
    id: String,
    name: String,
    time: String,
    #[serde(rename = "type")]
    assay_type: String,
    folder: String,
    has_assay_yaml: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    missing_reason: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct AssayUpsert {
    #[serde(default)]
    id: Option<String>,
    name: String,
    time: String,
    #[serde(rename = "type")]
    assay_type: String,
    folder: String,
}

#[derive(Deserialize)]
struct AssaysPathExistsPayload {
    folder: String,
}

#[derive(Serialize)]
struct FolderScan {
    path: String,
    name: String,
    positions: Vec<u32>,
    channels: Vec<u32>,
    times: Vec<u32>,
    #[serde(rename = "zSlices")]
    z_slices: Vec<u32>,
    #[serde(rename = "registrationPositions")]
    registration_positions: Vec<u32>,
    #[serde(rename = "roiPositions")]
    roi_positions: Vec<u32>,
    #[serde(rename = "predictionPositions")]
    prediction_positions: Vec<u32>,
}

#[derive(Deserialize)]
struct RegisterScanPayload {
    folder: String,
}

#[derive(Deserialize)]
struct RegisterReadImagePayload {
    folder: String,
    pos: u32,
    channel: u32,
    time: u32,
    z: u32,
}

#[derive(Deserialize)]
struct RegisterReadRegistrationPayload {
    folder: String,
    pos: u32,
}

#[derive(Deserialize)]
struct RegisterAutoDetectPayload {
    folder: String,
    pos: u32,
    channel: u32,
    time: u32,
    z: u32,
    grid: String,
    w: f64,
    h: f64,
}

#[derive(Deserialize)]
struct RegisterSaveBboxPayload {
    folder: String,
    pos: u32,
    csv: String,
    #[serde(rename = "registrationYaml")]
    registration_yaml: Option<String>,
}

#[derive(Deserialize)]
struct RoiDiscoverPayload {
    folder: String,
    pos: u32,
}

#[derive(Serialize)]
struct RoiCrop {
    #[serde(rename = "cropId")]
    crop_id: String,
    shape: Vec<u64>,
}

#[derive(Serialize)]
struct RoiDiscoverResponse {
    crops: Vec<RoiCrop>,
}

#[derive(Deserialize)]
struct RoiLoadFramePayload {
    folder: String,
    pos: u32,
    #[serde(rename = "cropId")]
    crop_id: String,
    t: u32,
    c: u32,
    z: u32,
}

#[derive(Deserialize)]
struct AnnotationLoadPayload {
    folder: String,
    pos: u32,
}

#[derive(Deserialize)]
struct AnnotationSavePayload {
    folder: String,
    pos: u32,
    classifications: Vec<AnnotationClassificationRow>,
    spots: Vec<AnnotationSpotRow>,
    segmentations: Vec<AnnotationSegmentationRow>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
struct AnnotationClassificationRow {
    roi: String,
    t: u32,
    c: u32,
    z: u32,
    #[serde(rename = "className")]
    class_name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
struct AnnotationSpotRow {
    roi: String,
    t: u32,
    c: u32,
    z: u32,
    #[serde(rename = "spotIdx")]
    spot_idx: u32,
    x: f64,
    y: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
struct AnnotationSegmentationRow {
    roi: String,
    t: u32,
    c: u32,
    z: u32,
    #[serde(rename = "contourIdx")]
    contour_idx: u32,
    #[serde(rename = "nodeIdx")]
    node_idx: u32,
    x: f64,
    y: f64,
}

#[derive(Serialize, Clone, Default, Debug, PartialEq)]
struct AnnotationLoadResponse {
    classifications: Vec<AnnotationClassificationRow>,
    spots: Vec<AnnotationSpotRow>,
    segmentations: Vec<AnnotationSegmentationRow>,
}

#[derive(Serialize, Deserialize)]
struct AnnotationClassificationCsvRow {
    roi: String,
    t: u32,
    c: u32,
    z: u32,
    #[serde(rename = "class")]
    class_name: String,
}

#[derive(Serialize, Deserialize)]
struct AnnotationSpotCsvRow {
    roi: String,
    t: u32,
    c: u32,
    z: u32,
    spot_idx: u32,
    x: f64,
    y: f64,
}

#[derive(Serialize, Deserialize)]
struct AnnotationSegmentationCsvRow {
    roi: String,
    t: u32,
    c: u32,
    z: u32,
    contour_idx: u32,
    node_idx: u32,
    x: f64,
    y: f64,
}

impl From<AnnotationClassificationCsvRow> for AnnotationClassificationRow {
    fn from(value: AnnotationClassificationCsvRow) -> Self {
        Self {
            roi: value.roi,
            t: value.t,
            c: value.c,
            z: value.z,
            class_name: value.class_name,
        }
    }
}

impl From<&AnnotationClassificationRow> for AnnotationClassificationCsvRow {
    fn from(value: &AnnotationClassificationRow) -> Self {
        Self {
            roi: value.roi.clone(),
            t: value.t,
            c: value.c,
            z: value.z,
            class_name: value.class_name.clone(),
        }
    }
}

impl From<AnnotationSpotCsvRow> for AnnotationSpotRow {
    fn from(value: AnnotationSpotCsvRow) -> Self {
        Self {
            roi: value.roi,
            t: value.t,
            c: value.c,
            z: value.z,
            spot_idx: value.spot_idx,
            x: value.x,
            y: value.y,
        }
    }
}

impl From<&AnnotationSpotRow> for AnnotationSpotCsvRow {
    fn from(value: &AnnotationSpotRow) -> Self {
        Self {
            roi: value.roi.clone(),
            t: value.t,
            c: value.c,
            z: value.z,
            spot_idx: value.spot_idx,
            x: value.x,
            y: value.y,
        }
    }
}

impl From<AnnotationSegmentationCsvRow> for AnnotationSegmentationRow {
    fn from(value: AnnotationSegmentationCsvRow) -> Self {
        Self {
            roi: value.roi,
            t: value.t,
            c: value.c,
            z: value.z,
            contour_idx: value.contour_idx,
            node_idx: value.node_idx,
            x: value.x,
            y: value.y,
        }
    }
}

impl From<&AnnotationSegmentationRow> for AnnotationSegmentationCsvRow {
    fn from(value: &AnnotationSegmentationRow) -> Self {
        Self {
            roi: value.roi.clone(),
            t: value.t,
            c: value.c,
            z: value.z,
            contour_idx: value.contour_idx,
            node_idx: value.node_idx,
            x: value.x,
            y: value.y,
        }
    }
}

#[derive(Deserialize)]
struct TaskRunRegisterAutoPayload {
    #[serde(rename = "taskId")]
    task_id: String,
    folder: String,
    pos: u32,
    channel: u32,
    time: u32,
    z: u32,
    grid: String,
    w: f64,
    h: f64,
}

#[derive(Deserialize)]
struct TaskRunCropPayload {
    #[serde(rename = "taskId")]
    task_id: String,
    folder: String,
    pos: u32,
    background: bool,
}

#[derive(Deserialize)]
struct TaskRunKillingPayload {
    #[serde(rename = "taskId")]
    task_id: String,
    folder: String,
    pos: u32,
    #[serde(rename = "batchSize")]
    batch_size: Option<usize>,
    cpu: Option<bool>,
}

#[derive(Deserialize)]
struct LoadPredictionPayload {
    folder: String,
    pos: u32,
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct TaskProgressEvent {
    progress: f64,
    message: String,
    timestamp: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct TaskRecord {
    id: String,
    kind: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    started_at: Option<String>,
    #[serde(default)]
    finished_at: Option<String>,
    #[serde(default)]
    request: Value,
    #[serde(default)]
    result: Option<Value>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    logs: Vec<String>,
    #[serde(default)]
    progress_events: Vec<TaskProgressEvent>,
}

#[derive(Serialize, Deserialize)]
struct TaskUpdate {
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    started_at: Option<String>,
    #[serde(default)]
    finished_at: Option<String>,
    #[serde(default)]
    result: Option<Value>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    logs: Option<Vec<String>>,
    #[serde(default)]
    progress_events: Option<Vec<TaskProgressEvent>>,
}

#[derive(Serialize, Deserialize)]
struct WriteYamlPayload {
    folder: String,
    yaml: String,
}

#[derive(Deserialize)]
struct AssayUpsertPayload {
    meta: AssayUpsert,
}

#[derive(Serialize)]
struct TiffRecord {
    pos: u32,
    channel: u32,
    time: u32,
    z: u32,
    path: PathBuf,
}

#[derive(Default)]
struct AssetStatus {
    model_path: PathBuf,
    ffmpeg_path: PathBuf,
    missing: Vec<String>,
    all_present: bool,
}
#[tauri::command]
fn assays_list() -> Vec<AssayListItem> {
    let conn = match open_app_database() {
        Ok(connection) => connection,
        Err(_) => return Vec::new(),
    };

    let mut statement = match conn.prepare(
        "SELECT id, name, time, type, folder, created_at, updated_at FROM assays ORDER BY updated_at DESC",
    ) {
        Ok(statement) => statement,
        Err(_) => return Vec::new(),
    };

    let records = match statement.query_map([], |row| {
        Ok(AssayRecord {
            id: row.get(0)?,
            name: row.get(1)?,
            time: row.get(2)?,
            assay_type: row.get(3)?,
            folder: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    }) {
        Ok(values) => values,
        Err(_) => return Vec::new(),
    };

    records
        .filter_map(Result::ok)
        .map(|item| {
            let folder_path = Path::new(&item.folder);
            let yaml_path = folder_path.join("assay.yaml");
            let has_assay_yaml = folder_path.exists() && yaml_path.exists();
            let missing_reason = if !folder_path.exists() {
                Some("folder not found".to_string())
            } else if !yaml_path.exists() {
                Some("assay.yaml not found".to_string())
            } else {
                None
            };
            AssayListItem {
                id: item.id,
                name: item.name,
                time: item.time,
                assay_type: item.assay_type,
                folder: item.folder,
                has_assay_yaml,
                missing_reason,
            }
        })
        .collect()
}

#[tauri::command]
fn assays_remove(id: String) -> bool {
    let conn = match open_app_database() {
        Ok(connection) => connection,
        Err(_) => return false,
    };
    conn.execute("DELETE FROM assays WHERE id = ?1", params![id])
        .map(|removed| removed > 0)
        .unwrap_or_default()
}

#[tauri::command]
fn assays_upsert(payload: AssayUpsertPayload) -> Value {
    let conn = match open_app_database() {
        Ok(connection) => connection,
        Err(_) => return json!({"id":""}),
    };

    let now = chrono_now();
    let requested_id = payload
        .meta
        .id
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let requested_type = if payload.meta.assay_type == "expression" {
        "expression".to_string()
    } else {
        "killing".to_string()
    };

    let mut record = AssayRecord {
        id: requested_id,
        name: payload.meta.name,
        time: payload.meta.time,
        assay_type: requested_type,
        folder: payload.meta.folder,
        created_at: now.clone(),
        updated_at: now,
    };

    if let Ok(existing_created_at) = conn.query_row(
        "SELECT created_at FROM assays WHERE id = ?1",
        params![record.id],
        |row| row.get::<_, String>(0),
    ) {
        record.created_at = existing_created_at;
    } else if let Ok((existing_id, existing_created_at)) = conn.query_row(
        "SELECT id, created_at FROM assays WHERE folder = ?1",
        params![record.folder],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    ) {
        record.id = existing_id;
        record.created_at = existing_created_at;
    }

    let row_exists = conn
        .query_row(
            "SELECT id FROM assays WHERE id = ?1",
            params![record.id],
            |row| row.get::<_, String>(0),
        )
        .is_ok();

    let result = if row_exists {
        conn.execute(
            "UPDATE assays SET name = ?1, time = ?2, type = ?3, folder = ?4, updated_at = ?5 WHERE id = ?6",
            params![
                record.name,
                record.time,
                record.assay_type,
                record.folder,
                record.updated_at,
                record.id
            ],
        )
    } else {
        conn.execute(
            "INSERT INTO assays (id, name, time, type, folder, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                record.id,
                record.name,
                record.time,
                record.assay_type,
                record.folder,
                record.created_at,
                record.updated_at
            ],
        )
    };

    if result.is_err() {
        return json!({"id":""});
    }

    json!({"id":record.id})
}

#[tauri::command]
fn assays_pick_data_folder() -> Option<Value> {
    FileDialog::new()
        .set_title("Select assay data folder")
        .pick_folder()
        .map(|path| json!({ "path": path.to_string_lossy() }))
}

#[tauri::command]
fn assays_pick_assay_yaml() -> Option<Value> {
    FileDialog::new()
        .set_title("Select assay.yaml")
        .add_filter("YAML", &["yaml", "yml"])
        .pick_file()
        .and_then(|path| {
            let file_name = path.file_name()?.to_string_lossy().to_ascii_lowercase();
            if file_name != "assay.yaml" {
                return None;
            }
            let folder = path.parent()?.to_string_lossy().to_string();
            let file = path.to_string_lossy().to_string();
            if folder.is_empty() || file.is_empty() {
                None
            } else {
                Some(json!({"file": file, "folder": folder}))
            }
        })
}

#[tauri::command]
fn assays_read_yaml(folder: String) -> Value {
    let path = Path::new(&folder).join("assay.yaml");
    match fs::read_to_string(&path) {
        Ok(yaml) => json!({"ok": true, "yaml": yaml}),
        Err(error) => json!({"ok": false, "error": error.to_string()}),
    }
}

#[tauri::command]
fn assays_write_yaml(payload: WriteYamlPayload) -> Value {
    let folder = Path::new(&payload.folder);
    if let Err(error) = fs::create_dir_all(folder) {
        return json!({"ok": false, "error": error.to_string()});
    }

    let path = folder.join("assay.yaml");
    let yaml = if payload.yaml.ends_with('\n') {
        payload.yaml
    } else {
        format!("{}\n", payload.yaml)
    };
    match File::create(&path).and_then(|mut file| file.write_all(yaml.as_bytes())) {
        Ok(()) => json!({"ok": true}),
        Err(error) => json!({"ok": false, "error": error.to_string()}),
    }
}

#[tauri::command]
fn assays_path_exists(payload: AssaysPathExistsPayload) -> bool {
    Path::new(&payload.folder).metadata().is_ok()
}

#[tauri::command]
fn register_scan(payload: RegisterScanPayload) -> FolderScan {
    let folder = Path::new(&payload.folder);
    let mut fallback = FolderScan {
        path: payload.folder.clone(),
        name: folder
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(".")
            .to_string(),
        positions: Vec::new(),
        channels: Vec::new(),
        times: Vec::new(),
        z_slices: Vec::new(),
        registration_positions: Vec::new(),
        roi_positions: Vec::new(),
        prediction_positions: Vec::new(),
    };

    let records = match scan_tiff_records(folder) {
        Ok(values) => values,
        Err(_) => return fallback,
    };

    let mut positions = BTreeSet::new();
    let mut channels = BTreeSet::new();
    let mut times = BTreeSet::new();
    let mut z_slices = BTreeSet::new();

    for record in &records {
        positions.insert(record.pos);
        channels.insert(record.channel);
        times.insert(record.time);
        z_slices.insert(record.z);
    }

    fallback.positions = positions.into_iter().collect();
    fallback.channels = channels.into_iter().collect();
    fallback.times = times.into_iter().collect();
    fallback.z_slices = z_slices.into_iter().collect();

    for pos in &fallback.positions {
        if resolve_registration_yaml(folder, *pos).is_some()
            || resolve_bbox_csv(folder, *pos).is_some()
        {
            fallback.registration_positions.push(*pos);
        }
        if folder.join(format!("Pos{}_roi.zarr", pos)).exists() {
            fallback.roi_positions.push(*pos);
        }
        if folder.join(format!("Pos{}_prediction.csv", pos)).exists() {
            fallback.prediction_positions.push(*pos);
        }
    }

    fallback
}

#[tauri::command]
fn register_read_image(payload: RegisterReadImagePayload) -> Value {
    let records = match scan_tiff_records(Path::new(&payload.folder)) {
        Ok(values) => values,
        Err(error) => {
            return json!({"ok": false, "error": error.to_string()});
        }
    };

    let target = records.iter().find(|record| {
        record.pos == payload.pos
            && record.channel == payload.channel
            && record.time == payload.time
            && record.z == payload.z
    });
    let Some(found) = target else {
        return json!({"ok": false, "error": "Requested frame not found"});
    };

    match read_tiff_frame(&found.path) {
        Ok((frame, width, height)) => {
            let base_name = found
                .path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("frame.tif")
                .to_string();

            let rgba = match frame {
                FrameData::U8(values) => frame_u8_to_rgba(&values),
                FrameData::U16(values) => frame_u16_to_rgba(&values),
            };

            json!({
                "ok": true,
                "baseName": base_name,
                "width": width,
                "height": height,
                "rgba": rgba,
            })
        }
        Err(error) => json!({"ok": false, "error": error.to_string()}),
    }
}

#[tauri::command]
fn register_read_registration(payload: RegisterReadRegistrationPayload) -> Value {
    let folder = Path::new(&payload.folder);
    let Some(path) = resolve_registration_yaml(folder, payload.pos) else {
        return json!({"ok": false, "error": "registration yaml not found", "code": "not_found"});
    };
    match fs::read_to_string(path) {
        Ok(yaml) => json!({"ok": true, "yaml": yaml}),
        Err(error) => {
            if error.kind() == std::io::ErrorKind::NotFound {
                json!({"ok": false, "error": error.to_string(), "code": "not_found"})
            } else {
                json!({"ok": false, "error": error.to_string()})
            }
        }
    }
}

#[tauri::command]
fn register_auto_detect(payload: RegisterAutoDetectPayload) -> Value {
    let Some(grid) = parse_grid_shape(&payload.grid) else {
        return json!({"ok": false, "error": "invalid grid", "code": "invalid_payload"});
    };

    let args = RegisterArgs {
        input: payload.folder,
        pos: payload.pos,
        channel: payload.channel,
        time: payload.time,
        z: payload.z,
        grid,
        w: payload.w,
        h: payload.h,
        local_var_radius: 5,
        morph_radius: 2,
        peak_merge_radius: 10,
        peak_min_abs: 3.0,
        peak_min_ratio: 0.1,
        peak_drop_max_frac: 0.3,
        peak_cv_threshold: 0.2,
        inlier_frac: 0.95,
        refine_iters: 50,
        diagnostics: true,
        pretty: false,
        no_progress: false,
    };

    match register_app::run_and_collect(args, |_progress, _message| {}) {
        Ok(output) => {
            let mut out = serde_json::Map::new();
            out.insert("ok".to_string(), serde_json::Value::Bool(true));
            out.insert(
                "params".to_string(),
                json!({
                    "shape": output.shape,
                    "a": output.a,
                    "alpha": output.alpha,
                    "b": output.b,
                    "beta": output.beta,
                    "w": output.w,
                    "h": output.h,
                    "dx": output.dx,
                    "dy": output.dy,
                }),
            );
            if let Some(diagnostics) = output.diagnostics {
                out.insert(
                    "diagnostics".to_string(),
                    json!({
                        "detected_points": diagnostics.detected_points,
                        "inlier_points": diagnostics.inlier_points,
                        "initial_mse": diagnostics.initial_mse,
                        "final_mse": diagnostics.final_mse,
                    }),
                );
            }
            Value::Object(out)
        }
        Err(error) => json!({"ok": false, "error": error.to_string(), "code": "exec_error"}),
    }
}

#[tauri::command]
fn register_save_bbox(payload: RegisterSaveBboxPayload) -> Value {
    let folder = Path::new(&payload.folder);
    if let Err(error) = fs::create_dir_all(folder) {
        return json!({"ok": false, "error": error.to_string()});
    }

    for bbox_path in bbox_csv_paths(folder, payload.pos) {
        let normalized_csv = if payload.csv.ends_with('\n') {
            payload.csv.clone()
        } else {
            format!("{}\n", payload.csv)
        };
        if let Err(error) =
            File::create(&bbox_path).and_then(|mut file| file.write_all(normalized_csv.as_bytes()))
        {
            return json!({"ok": false, "error": error.to_string()});
        }
    }

    if let Some(yaml) = payload.registration_yaml {
        let normalized_yaml = if yaml.ends_with('\n') {
            yaml
        } else {
            format!("{}\n", yaml)
        };
        for register_path in registration_yaml_paths(folder, payload.pos) {
            if let Err(error) = File::create(&register_path)
                .and_then(|mut file| file.write_all(normalized_yaml.as_bytes()))
            {
                return json!({"ok": false, "error": error.to_string()});
            }
        }
    }

    json!({"ok": true})
}

#[tauri::command]
fn roi_discover(payload: RoiDiscoverPayload) -> RoiDiscoverResponse {
    let mut crops = Vec::new();
    let path = Path::new(&payload.folder).join(format!("Pos{}_roi.zarr", payload.pos));
    if !path.exists() {
        return RoiDiscoverResponse { crops };
    }

    let root = path.join("roi");
    if !root.exists() {
        return RoiDiscoverResponse { crops };
    }

    let store = match zarr::open_store(&path) {
        Ok(store) => store,
        Err(_) => return RoiDiscoverResponse { crops },
    };

    for entry in fs::read_dir(root).into_iter().flatten() {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
        if !is_dir {
            continue;
        }
        let crop_id = match entry.file_name().to_str() {
            Some(name) => name.to_string(),
            None => continue,
        };

        let raw_path = schema::raw_array_path(&crop_id);
        let raw = match zarr::open_array(&store, &raw_path) {
            Ok(raw) => raw,
            Err(_) => continue,
        };
        let shape = raw.shape();
        if shape.len() >= 5 {
            crops.push(RoiCrop {
                crop_id,
                shape: vec![shape[0], shape[1], shape[2], shape[3], shape[4]],
            });
        }
    }

    RoiDiscoverResponse { crops }
}

#[tauri::command]
fn roi_load_frame(payload: RoiLoadFramePayload) -> Value {
    let records = match scan_tiff_records(Path::new(&payload.folder)) {
        Ok(values) => values,
        Err(error) => {
            return json!({"ok": false, "error": error.to_string()});
        }
    };

    let pos_records: Vec<&TiffRecord> = records
        .iter()
        .filter(|item| item.pos == payload.pos)
        .collect();
    if pos_records.is_empty() {
        return json!({"ok": false, "error": "position not found"});
    }

    let mut channels = BTreeSet::new();
    let mut times = BTreeSet::new();
    let mut zs = BTreeSet::new();
    for rec in &pos_records {
        channels.insert(rec.channel);
        times.insert(rec.time);
        zs.insert(rec.z);
    }

    let channels: Vec<u32> = channels.into_iter().collect();
    let times: Vec<u32> = times.into_iter().collect();
    let zs: Vec<u32> = zs.into_iter().collect();

    let ci = channels
        .iter()
        .position(|value| *value == payload.c)
        .map(|v| v as u64);
    let ti = times
        .iter()
        .position(|value| *value == payload.t)
        .map(|v| v as u64);
    let zi = zs
        .iter()
        .position(|value| *value == payload.z)
        .map(|v| v as u64);

    if ci.is_none() || ti.is_none() || zi.is_none() {
        return json!({"ok": false, "error": "Requested index not found"});
    }
    let (c_i, t_i, z_i) = (ci.unwrap(), ti.unwrap(), zi.unwrap());

    let roi_path = Path::new(&payload.folder).join(format!("Pos{}_roi.zarr", payload.pos));
    if !roi_path.exists() {
        return json!({"ok": false, "error": "roi store not found"});
    }

    let store = match zarr::open_store(&roi_path) {
        Ok(store) => store,
        Err(error) => return json!({"ok": false, "error": error.to_string()}),
    };

    let raw_path = schema::raw_array_path(&payload.crop_id);
    let raw = match zarr::open_array(&store, &format!("{raw_path}")) {
        Ok(raw) => raw,
        Err(error) => return json!({"ok": false, "error": error.to_string()}),
    };
    let shape = raw.shape();
    if shape.len() < 5 {
        return json!({"ok": false, "error": "invalid raw array shape"});
    }

    let h = shape[3] as u32;
    let w = shape[4] as u32;
    let data = match zarr::read_raw_frame_u16(&raw, t_i, c_i, z_i) {
        Ok(data) => data,
        Err(error) => return json!({"ok": false, "error": error.to_string()}),
    };

    json!({
        "ok": true,
        "width": w,
        "height": h,
        "data": data,
    })
}

#[tauri::command]
fn annotations_load(payload: AnnotationLoadPayload) -> Result<AnnotationLoadResponse, String> {
    load_annotation_bundle(Path::new(&payload.folder), payload.pos)
}

#[tauri::command]
fn annotations_save(payload: AnnotationSavePayload) -> Result<bool, String> {
    let bundle = AnnotationLoadResponse {
        classifications: payload.classifications,
        spots: payload.spots,
        segmentations: payload.segmentations,
    };
    save_annotation_bundle(Path::new(&payload.folder), payload.pos, &bundle)?;
    Ok(true)
}

#[tauri::command]
fn tasks_insert(task: TaskRecord) -> bool {
    let conn = match open_app_database() {
        Ok(connection) => connection,
        Err(_) => return false,
    };
    let mut task = task;
    if task.created_at.is_empty() {
        task.created_at = chrono_now();
    }
    persist_task_record(&conn, &task).is_ok()
}

#[tauri::command]
fn tasks_update(id: String, updates: TaskUpdate) -> bool {
    let conn = match open_app_database() {
        Ok(connection) => connection,
        Err(_) => return false,
    };
    let mut task = match load_task_record(&conn, &id) {
        Some(task) => task,
        None => return false,
    };

    if let Some(status) = updates.status {
        task.status = status;
    }
    if let Some(started_at) = updates.started_at {
        task.started_at = Some(started_at);
    }
    if let Some(finished_at) = updates.finished_at {
        task.finished_at = Some(finished_at);
    }
    if let Some(result) = updates.result {
        task.result = Some(result);
    }
    if let Some(error) = updates.error {
        task.error = Some(error);
    }
    if let Some(logs) = updates.logs {
        task.logs = logs;
    }
    if let Some(progress_events) = updates.progress_events {
        task.progress_events = progress_events;
    }

    persist_task_record(&conn, &task).is_ok()
}

fn load_task_record(connection: &Connection, id: &str) -> Option<TaskRecord> {
    connection
        .query_row(
            "SELECT id, kind, status, created_at, started_at, finished_at, request_json, result_json, error, logs_json, progress_events_json FROM tasks WHERE id = ?1",
            params![id],
            |row| {
                let request: String = row.get(6)?;
                let result_raw: Option<String> = row.get(7)?;
                let logs_raw: String = row.get(9)?;
                let progress_raw: String = row.get(10)?;
                Ok(TaskRecord {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    status: row.get(2)?,
                    created_at: row.get(3)?,
                    started_at: row.get(4)?,
                    finished_at: row.get(5)?,
                    request: parse_json_field(Some(request)),
                    result: parse_json_field::<Option<Value>>(result_raw),
                    error: row.get(8)?,
                    logs: parse_json_field::<Vec<String>>(Some(logs_raw)),
                    progress_events: parse_json_field::<Vec<TaskProgressEvent>>(Some(progress_raw)),
                })
            },
        )
        .ok()
}

fn persist_task_record(connection: &Connection, task: &TaskRecord) -> Result<(), String> {
    let request_json = serde_json::to_string(&task.request).map_err(|error| error.to_string())?;
    let logs_json = serde_json::to_string(&task.logs).map_err(|error| error.to_string())?;
    let progress_json =
        serde_json::to_string(&task.progress_events).map_err(|error| error.to_string())?;
    let result_json = task
        .result
        .as_ref()
        .map(|value| serde_json::to_string(value).map_err(|error| error.to_string()))
        .transpose()?;

    connection
        .execute(
            "INSERT INTO tasks (id, kind, status, created_at, started_at, finished_at, request_json, result_json, error, logs_json, progress_events_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, status = excluded.status, created_at = excluded.created_at, started_at = excluded.started_at, finished_at = excluded.finished_at, request_json = excluded.request_json, result_json = excluded.result_json, error = excluded.error, logs_json = excluded.logs_json, progress_events_json = excluded.progress_events_json",
            params![
                task.id,
                task.kind,
                task.status,
                task.created_at,
                task.started_at,
                task.finished_at,
                request_json,
                result_json,
                task.error,
                logs_json,
                progress_json,
            ],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn update_task(id: String, updates: TaskUpdate) -> bool {
    tasks_update(id, updates)
}

#[tauri::command]
fn tasks_list() -> Vec<TaskRecord> {
    let conn = match open_app_database() {
        Ok(connection) => connection,
        Err(_) => return Vec::new(),
    };
    let mut statement = match conn.prepare(
        "SELECT id, kind, status, created_at, started_at, finished_at, request_json, result_json, error, logs_json, progress_events_json FROM tasks ORDER BY created_at DESC",
    ) {
        Ok(statement) => statement,
        Err(_) => return Vec::new(),
    };
    let rows = match statement.query_map([], |row| {
        let request: String = row.get(6)?;
        let result_raw: Option<String> = row.get(7)?;
        let logs_raw: String = row.get(9)?;
        let progress_raw: String = row.get(10)?;
        Ok(TaskRecord {
            id: row.get(0)?,
            kind: row.get(1)?,
            status: row.get(2)?,
            created_at: row.get(3)?,
            started_at: row.get(4)?,
            finished_at: row.get(5)?,
            request: parse_json_field(Some(request)),
            result: parse_json_field::<Option<Value>>(result_raw),
            error: row.get(8)?,
            logs: parse_json_field::<Vec<String>>(Some(logs_raw)),
            progress_events: parse_json_field::<Vec<TaskProgressEvent>>(Some(progress_raw)),
        })
    }) {
        Ok(values) => values,
        Err(_) => return Vec::new(),
    };
    rows.filter_map(Result::ok).collect()
}

#[tauri::command]
fn tasks_delete_completed() -> usize {
    let conn = match open_app_database() {
        Ok(connection) => connection,
        Err(_) => return 0,
    };
    conn.execute(
        "DELETE FROM tasks WHERE status IN ('succeeded', 'failed')",
        [],
    )
    .unwrap_or(0) as usize
}

#[tauri::command]
fn tasks_run_register_auto_detect(payload: TaskRunRegisterAutoPayload) -> Value {
    let started_at = chrono_now();
    let mut progress_events = vec![TaskProgressEvent {
        progress: 0.0,
        message: "Running auto-detect".to_string(),
        timestamp: started_at.clone(),
    }];
    let _ = update_task(
        payload.task_id.clone(),
        TaskUpdate {
            status: Some("running".to_string()),
            started_at: Some(started_at.clone()),
            finished_at: None,
            result: None,
            error: None,
            logs: None,
            progress_events: Some(progress_events.clone()),
        },
    );

    let result = register_auto_detect(RegisterAutoDetectPayload {
        folder: payload.folder,
        pos: payload.pos,
        channel: payload.channel,
        time: payload.time,
        z: payload.z,
        grid: payload.grid,
        w: payload.w,
        h: payload.h,
    });
    let finished_at = chrono_now();
    let (status, error, task_result) = if result.get("ok").and_then(Value::as_bool).unwrap_or(false)
    {
        (
            "succeeded".to_string(),
            None,
            Some(json!({
                "params": result.get("params").cloned().unwrap_or_else(|| json!({})),
                "diagnostics": result.get("diagnostics").cloned().unwrap_or(Value::Null),
            })),
        )
    } else {
        (
            "failed".to_string(),
            result
                .get("error")
                .and_then(Value::as_str)
                .map(str::to_string),
            None,
        )
    };
    let message = if status == "succeeded" {
        "Auto-detect completed".to_string()
    } else {
        let reason = error.as_deref().unwrap_or("Auto-detect failed");
        format!("Auto-detect failed: {reason}")
    };
    progress_events.push(TaskProgressEvent {
        progress: if status == "succeeded" { 1.0 } else { 0.0 },
        message,
        timestamp: finished_at.clone(),
    });
    let _ = update_task(
        payload.task_id,
        TaskUpdate {
            status: Some(status),
            started_at: None,
            finished_at: Some(finished_at),
            result: task_result,
            error,
            logs: None,
            progress_events: Some(progress_events),
        },
    );
    result
}

#[tauri::command]
fn tasks_run_crop(payload: TaskRunCropPayload) -> Value {
    let started_at = chrono_now();
    let folder = payload.folder;
    let bbox = match resolve_bbox_csv(Path::new(&folder), payload.pos) {
        Some(path) => path,
        None => {
            return json!({"ok": false, "error": "No bbox csv found", "code": "invalid_payload"});
        }
    };
    if !bbox.exists() {
        return json!({"ok": false, "error": "No bbox csv found", "code": "invalid_payload"});
    }

    let args = CropArgs {
        input: folder.clone(),
        pos: payload.pos,
        bbox: bbox.to_string_lossy().to_string(),
        output: folder.clone(),
        background: payload.background,
    };

    let mut progress_events = vec![TaskProgressEvent {
        progress: 0.0,
        message: "Running crop".to_string(),
        timestamp: started_at.clone(),
    }];
    let _ = update_task(
        payload.task_id.clone(),
        TaskUpdate {
            status: Some("running".to_string()),
            started_at: Some(started_at.clone()),
            finished_at: None,
            result: None,
            error: None,
            logs: None,
            progress_events: Some(progress_events.clone()),
        },
    );

    let result = match crop_app::run(args, |_p, _m| {}) {
        Ok(_) => {
            progress_events.push(TaskProgressEvent {
                progress: 1.0,
                message: "Crop completed".to_string(),
                timestamp: chrono_now(),
            });
            json!({
                "ok": true,
                "output": folder,
            })
        }
        Err(error) => {
            progress_events.push(TaskProgressEvent {
                progress: 0.0,
                message: format!("Crop failed: {error}"),
                timestamp: chrono_now(),
            });
            json!({"ok": false, "error": error.to_string(), "code": "exec_error"})
        }
    };
    let finished_at = chrono_now();
    let (status, error, task_result) = if result.get("ok").and_then(Value::as_bool).unwrap_or(false)
    {
        (
            "succeeded".to_string(),
            None,
            Some(json!({
                "output": result.get("output").and_then(Value::as_str).unwrap_or_default().to_string(),
            })),
        )
    } else {
        (
            "failed".to_string(),
            result
                .get("error")
                .and_then(Value::as_str)
                .map(str::to_string),
            None,
        )
    };
    let _ = update_task(
        payload.task_id,
        TaskUpdate {
            status: Some(status),
            started_at: None,
            finished_at: Some(finished_at),
            result: task_result,
            error,
            logs: None,
            progress_events: Some(progress_events),
        },
    );
    result
}

#[tauri::command]
fn tasks_run_killing_predict(payload: TaskRunKillingPayload) -> Value {
    let started_at = chrono_now();
    let model_path = resolve_default_model_dir().join("model.onnx");
    if !model_path.exists() {
        return json!({"ok": false, "error": format!("model not found at {}", model_path.display()), "code": "exec_error"});
    }

    let output = Path::new(&payload.folder).join(format!("Pos{}_prediction.csv", payload.pos));
    let args = KillingArgs {
        workspace: payload.folder.clone(),
        pos: payload.pos,
        model: resolve_default_model_dir().to_string_lossy().to_string(),
        output: output.to_string_lossy().to_string(),
        batch_size: payload.batch_size.unwrap_or(256),
        cpu: payload.cpu.unwrap_or(false),
    };

    let mut progress_events = vec![TaskProgressEvent {
        progress: 0.0,
        message: "Running killing inference".to_string(),
        timestamp: started_at.clone(),
    }];
    let _ = update_task(
        payload.task_id.clone(),
        TaskUpdate {
            status: Some("running".to_string()),
            started_at: Some(started_at),
            finished_at: None,
            result: None,
            error: None,
            logs: None,
            progress_events: Some(progress_events.clone()),
        },
    );

    let result = match killing_app::run(args, |_p, _m| {}) {
        Ok(_) => match parse_prediction_csv(&output) {
            Ok(rows) => {
                progress_events.push(TaskProgressEvent {
                    progress: 1.0,
                    message: "Killing inference completed".to_string(),
                    timestamp: chrono_now(),
                });
                json!({
                    "ok": true,
                    "output": output.to_string_lossy(),
                    "rows": rows,
                })
            }
            Err(error) => {
                progress_events.push(TaskProgressEvent {
                    progress: 0.0,
                    message: format!("Killing inference failed: {error}"),
                    timestamp: chrono_now(),
                });
                json!({"ok": false, "error": error, "code": "invalid_payload"})
            }
        },
        Err(error) => {
            progress_events.push(TaskProgressEvent {
                progress: 0.0,
                message: format!("Killing inference failed: {error}"),
                timestamp: chrono_now(),
            });
            json!({"ok": false, "error": error.to_string(), "code": "exec_error"})
        }
    };
    let finished_at = chrono_now();
    let (status, error, task_result) = if result.get("ok").and_then(Value::as_bool).unwrap_or(false)
    {
        (
            "succeeded".to_string(),
            None,
            Some(json!({
                "output": result.get("output").and_then(Value::as_str).unwrap_or_default().to_string(),
                "rows": result.get("rows").cloned().unwrap_or_else(|| json!([])),
            })),
        )
    } else {
        (
            "failed".to_string(),
            result
                .get("error")
                .and_then(Value::as_str)
                .map(str::to_string),
            None,
        )
    };
    let _ = update_task(
        payload.task_id,
        TaskUpdate {
            status: Some(status),
            started_at: None,
            finished_at: Some(finished_at),
            result: task_result,
            error,
            logs: None,
            progress_events: Some(progress_events),
        },
    );
    result
}

#[tauri::command]
fn application_load_prediction_csv(payload: LoadPredictionPayload) -> Value {
    let path = Path::new(&payload.folder).join(format!("Pos{}_prediction.csv", payload.pos));
    match parse_prediction_csv(&path) {
        Ok(rows) => json!({"ok": true, "rows": rows}),
        Err(error) => json!({"ok": false, "error": error}),
    }
}

fn chrono_now() -> String {
    let now = std::time::SystemTime::now();
    let elapsed = now
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{:09}Z", elapsed.as_secs(), elapsed.subsec_nanos())
}

fn download_file(url: &str, destination: &Path) -> Result<(), String> {
    let response = blocking::get(url).map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("request failed: {}", response.status()));
    }

    let parent = destination
        .parent()
        .ok_or_else(|| "invalid destination path".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;

    let tempfile = destination.with_extension("tmp");
    {
        let mut out = File::create(&tempfile).map_err(|error| error.to_string())?;
        let mut response = response;
        std::io::copy(&mut response, &mut out).map_err(|error| error.to_string())?;
    }
    fs::rename(&tempfile, destination).map_err(|error| error.to_string())?;
    Ok(())
}

fn extract_ffmpeg_executable(zip_path: &Path, destination: &Path) -> Result<(), String> {
    let file = File::open(zip_path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|error| error.to_string())?;
    let mut found = false;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_ascii_lowercase();
        if !name.ends_with("ffmpeg.exe") {
            continue;
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut output = File::create(destination).map_err(|error| error.to_string())?;
        std::io::copy(&mut entry, &mut output).map_err(|error| error.to_string())?;
        found = true;
        break;
    }
    if found {
        return Ok(());
    }
    Err("ffmpeg.exe not found in downloaded archive.".to_string())
}

fn download_default_assets() -> Result<Vec<String>, String> {
    let model_dir = resolve_default_model_dir();
    let ffmpeg_path = resolve_default_ffmpeg_path();
    let mut downloaded_files = Vec::new();

    for (name, url) in MODEL_DOWNLOADS.iter() {
        let path = model_dir.join(name);
        if path.exists() {
            continue;
        }
        download_file(url, &path)?;
        downloaded_files.push(path.to_string_lossy().to_string());
    }

    if !cfg!(windows) {
        return Ok(downloaded_files);
    }
    if ffmpeg_path.exists() {
        return Ok(downloaded_files);
    }

    let archive = env::temp_dir().join(format!(
        "lisca-ffmpeg-{}.zip",
        chrono_now().replace(":", "-")
    ));
    download_file(FFMPEG_ZIP_URL, &archive)?;
    let ffmpeg_parent = ffmpeg_path
        .parent()
        .ok_or_else(|| "invalid ffmpeg path".to_string())?;
    fs::create_dir_all(ffmpeg_parent).map_err(|error| error.to_string())?;
    extract_ffmpeg_executable(&archive, &ffmpeg_path)?;
    downloaded_files.push(ffmpeg_path.to_string_lossy().to_string());
    let _ = fs::remove_file(&archive);
    Ok(downloaded_files)
}

#[tauri::command]
fn settings_download_assets(app: AppHandle) -> Value {
    emit_download_progress(&app, "start", 0.0, "starting");
    let ffmpeg_path = resolve_default_ffmpeg_path();
    emit_download_progress(&app, "model", 0.2, "checking model files");
    match download_default_assets() {
        Ok(downloaded_files) => {
            emit_download_progress(&app, "done", 1.0, "done");
            let status = resolve_asset_status();
            if status.all_present || !cfg!(windows) {
                if !cfg!(windows) && !status.all_present {
                    return json!({
                        "ok": false,
                        "modelDir": status.model_path.to_string_lossy(),
                        "ffmpegPath": ffmpeg_path.to_string_lossy(),
                        "downloadedFiles": downloaded_files,
                        "error": "ffmpeg.exe download is only supported on Windows.",
                    });
                }
                return json!({
                    "ok": true,
                    "modelDir": status.model_path.to_string_lossy(),
                    "ffmpegPath": status.ffmpeg_path.to_string_lossy(),
                    "downloadedFiles": downloaded_files,
                });
            }
            json!({
                "ok": false,
                "modelDir": status.model_path.to_string_lossy(),
                "ffmpegPath": status.ffmpeg_path.to_string_lossy(),
                "downloadedFiles": downloaded_files,
                "error": "required assets are missing",
            })
        }
        Err(error) => {
            emit_download_progress(&app, "error", 1.0, &error);
            let status = resolve_asset_status();
            json!({
                "ok": false,
                "modelDir": status.model_path.to_string_lossy(),
                "ffmpegPath": status.ffmpeg_path.to_string_lossy(),
                "downloadedFiles": [],
                "error": error,
            })
        }
    }
}

#[tauri::command]
fn settings_get_asset_status() -> Value {
    let status = resolve_asset_status();
    let all_present = status.all_present;
    json!({
        "ok": true,
        "modelPath": status.model_path.to_string_lossy(),
        "ffmpegPath": status.ffmpeg_path.to_string_lossy(),
        "missing": status.missing,
        "allPresent": all_present,
    })
}

fn resolve_default_model_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".lisca")
        .join("models")
        .join("resnet18")
}

fn resolve_default_ffmpeg_path() -> PathBuf {
    if cfg!(windows) {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".lisca")
            .join("bin")
            .join("ffmpeg.exe")
    } else {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".lisca")
            .join("bin")
            .join("ffmpeg")
    }
}

fn resolve_asset_status() -> AssetStatus {
    let model_path = resolve_default_model_dir().join("model.onnx");
    let ffmpeg_path = resolve_default_ffmpeg_path();
    let mut status = AssetStatus {
        model_path,
        ffmpeg_path,
        missing: Vec::new(),
        all_present: true,
    };
    if !status.model_path.exists() {
        status.all_present = false;
        status
            .missing
            .push(status.model_path.to_string_lossy().to_string());
    }
    if !status.ffmpeg_path.exists() && cfg!(windows) {
        status.all_present = false;
        status
            .missing
            .push(status.ffmpeg_path.to_string_lossy().to_string());
    }
    status
}

fn parse_grid_shape(raw: &str) -> Option<GridShape> {
    match raw {
        "square" | "Square" | "SQUARE" => Some(GridShape::Square),
        "hex" | "Hex" | "HEX" => Some(GridShape::Hex),
        _ => None,
    }
}

fn frame_u8_to_rgba(values: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(values.len() * 4);
    for value in values {
        out.push(*value);
        out.push(*value);
        out.push(*value);
        out.push(255);
    }
    out
}

fn frame_u16_to_rgba(values: &[u16]) -> Vec<u8> {
    let mut out = Vec::with_capacity(values.len() * 4);
    let max = values.iter().copied().max().unwrap_or(1).max(1);
    if max == 0 {
        for _ in values {
            out.push(0);
            out.push(0);
            out.push(0);
            out.push(255);
        }
        return out;
    }

    let max_f = max as f64;
    for value in values {
        let scaled = (*value as f64 / max_f * 255.0).round().clamp(0.0, 255.0) as u8;
        out.push(scaled);
        out.push(scaled);
        out.push(scaled);
        out.push(255);
    }
    out
}

fn parse_position_dir(name: &str) -> Option<u32> {
    let lower = name
        .trim()
        .to_ascii_lowercase()
        .replace([' ', '\t', '\n', '\r'], "");
    if lower.is_empty() {
        return None;
    }
    if let Some(rest) = lower.strip_prefix("position") {
        return rest.trim_start_matches(&['_', '-'][..]).parse().ok();
    }
    if let Some(rest) = lower.strip_prefix("pos") {
        return rest.trim_start_matches(&['_', '-'][..]).parse().ok();
    }
    lower.parse().ok()
}

fn parse_tiff_filename(name: &str) -> Option<(u32, u32, u32, u32)> {
    let lower = name.to_ascii_lowercase();
    let stem = if lower.ends_with(".tiff") {
        &lower[..lower.len().saturating_sub(5)]
    } else if lower.ends_with(".tif") {
        &lower[..lower.len().saturating_sub(4)]
    } else {
        return None;
    };
    let normalized = stem.replace('-', "_");
    let parts: Vec<&str> = normalized.split('_').collect();
    let (channel_part, pos_part, time_part, z_part) = match parts.as_slice() {
        [first, pos, time, z] => (*first, *pos, *time, *z),
        ["img", second, pos, time, z] => (*second, *pos, *time, *z),
        _ => return None,
    };

    let parse_axis = |value: &str, prefix: &str| -> Option<u32> {
        value.strip_prefix(prefix)?.parse().ok()
    };

    let channel = if channel_part.starts_with("img_channel") {
        parse_axis(channel_part, "img_channel")
    } else {
        parse_axis(channel_part, "channel")
    }?;
    let pos = parse_axis(pos_part, "position")?;
    let time = parse_axis(time_part, "time")?;
    let z = parse_axis(z_part, "z")?;

    Some((channel, pos, time, z))
}

fn collect_tiff_records_in_position(
    position_path: &Path,
    position: u32,
) -> Result<Vec<TiffRecord>, Box<dyn std::error::Error>> {
    let mut records = Vec::new();

    for entry in fs::read_dir(position_path)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            records.extend(collect_tiff_records_in_position(&path, position)?);
            continue;
        }
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if let Some((channel, _, time, z)) = parse_tiff_filename(name) {
            records.push(TiffRecord {
                pos: position,
                channel,
                time,
                z,
                path,
            });
        }
    }

    Ok(records)
}

fn scan_tiff_records(folder: &Path) -> Result<Vec<TiffRecord>, Box<dyn std::error::Error>> {
    let mut records = Vec::new();
    let mut scanned_pos_dirs = false;

    for entry in fs::read_dir(folder)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let pos_dir = match entry.file_name().to_str() {
            Some(name) => parse_position_dir(name),
            None => None,
        };
        let Some(pos) = pos_dir else {
            continue;
        };
        scanned_pos_dirs = true;
        records.extend(collect_tiff_records_in_position(&path, pos)?);
    }

    if !scanned_pos_dirs {
        for entry in fs::read_dir(folder)? {
            let entry = entry?;
            if !entry.file_type()?.is_file() {
                continue;
            }
            let file_name = entry.file_name();
            let file_name = file_name.to_string_lossy();
            if let Some((channel, pos, time, z)) = parse_tiff_filename(file_name.as_ref()) {
                records.push(TiffRecord {
                    pos,
                    channel,
                    time,
                    z,
                    path: entry.path(),
                });
            }
        }
    }

    records.sort_by(|a, b| (a.pos, a.channel, a.time, a.z).cmp(&(b.pos, b.channel, b.time, b.z)));

    Ok(records)
}

fn parse_csv_bool(value: &str) -> Option<bool> {
    match value.to_ascii_lowercase().as_str() {
        "1" | "t" | "true" | "yes" | "y" => Some(true),
        "0" | "f" | "false" | "no" | "n" => Some(false),
        _ => None,
    }
}

fn parse_prediction_csv(path: &Path) -> Result<Vec<Value>, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let reader = BufReader::new(file);
    let mut rows = Vec::new();

    for (line_idx, line) in reader.lines().enumerate() {
        let line = line.map_err(|error| error.to_string())?;
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split(',').map(|value| value.trim()).collect();
        if parts.len() < 3 {
            continue;
        }
        if line_idx == 0 {
            let first = parts
                .first()
                .copied()
                .unwrap_or_default()
                .to_ascii_lowercase();
            if first == "t" || first == "time" {
                continue;
            }
        }

        let t = parts
            .first()
            .ok_or_else(|| "missing t value".to_string())?
            .parse::<u32>()
            .map_err(|_| "invalid t value in prediction csv".to_string())?;
        let crop = parts
            .get(1)
            .ok_or_else(|| "missing crop value".to_string())?
            .to_string();
        let label = parts
            .get(2)
            .and_then(|value| parse_csv_bool(value))
            .ok_or_else(|| "invalid label value in prediction csv".to_string())?;
        rows.push(json!({"t": t, "crop": crop, "label": label}));
    }

    Ok(rows)
}

fn parse_json_field<T>(raw: Option<String>) -> T
where
    T: DeserializeOwned + Default,
{
    raw.and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default()
}

fn annotation_classification_csv_path(folder: &Path, pos: u32) -> PathBuf {
    folder.join(format!("Pos{}_annotation_classification.csv", pos))
}

fn annotation_spot_csv_path(folder: &Path, pos: u32) -> PathBuf {
    folder.join(format!("Pos{}_annotation_spots.csv", pos))
}

fn annotation_segmentation_csv_path(folder: &Path, pos: u32) -> PathBuf {
    folder.join(format!("Pos{}_annotation_segmentation.csv", pos))
}

fn load_csv_rows<TCsv, TRow>(path: &Path) -> Result<Vec<TRow>, String>
where
    TCsv: DeserializeOwned,
    TRow: From<TCsv>,
{
    if !path.exists() {
        return Ok(Vec::new());
    }

    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::All)
        .from_path(path)
        .map_err(|error| error.to_string())?;
    let mut rows = Vec::new();
    for row in reader.deserialize::<TCsv>() {
        rows.push(TRow::from(row.map_err(|error| error.to_string())?));
    }
    Ok(rows)
}

fn write_csv_rows<TCsv>(path: &Path, rows: &[TCsv]) -> Result<(), String>
where
    TCsv: Serialize,
{
    if rows.is_empty() {
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
        return Ok(());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let mut writer = csv::WriterBuilder::new()
        .has_headers(true)
        .from_path(path)
        .map_err(|error| error.to_string())?;
    for row in rows {
        writer.serialize(row).map_err(|error| error.to_string())?;
    }
    writer.flush().map_err(|error| error.to_string())
}

fn load_annotation_bundle(folder: &Path, pos: u32) -> Result<AnnotationLoadResponse, String> {
    Ok(AnnotationLoadResponse {
        classifications: load_csv_rows::<
            AnnotationClassificationCsvRow,
            AnnotationClassificationRow,
        >(&annotation_classification_csv_path(folder, pos))?,
        spots: load_csv_rows::<AnnotationSpotCsvRow, AnnotationSpotRow>(
            &annotation_spot_csv_path(folder, pos),
        )?,
        segmentations: load_csv_rows::<AnnotationSegmentationCsvRow, AnnotationSegmentationRow>(
            &annotation_segmentation_csv_path(folder, pos),
        )?,
    })
}

fn save_annotation_bundle(
    folder: &Path,
    pos: u32,
    bundle: &AnnotationLoadResponse,
) -> Result<(), String> {
    let mut classifications = bundle.classifications.clone();
    classifications.sort_by(|a, b| {
        (a.roi.as_str(), a.t, a.c, a.z, a.class_name.as_str()).cmp(&(
            b.roi.as_str(),
            b.t,
            b.c,
            b.z,
            b.class_name.as_str(),
        ))
    });

    let mut spots = bundle.spots.clone();
    spots.sort_by(|a, b| {
        (a.roi.as_str(), a.t, a.c, a.z, a.spot_idx).cmp(&(
            b.roi.as_str(),
            b.t,
            b.c,
            b.z,
            b.spot_idx,
        ))
    });

    let mut segmentations = bundle.segmentations.clone();
    segmentations.sort_by(|a, b| {
        (a.roi.as_str(), a.t, a.c, a.z, a.contour_idx, a.node_idx).cmp(&(
            b.roi.as_str(),
            b.t,
            b.c,
            b.z,
            b.contour_idx,
            b.node_idx,
        ))
    });

    let classification_rows: Vec<AnnotationClassificationCsvRow> = classifications
        .iter()
        .map(AnnotationClassificationCsvRow::from)
        .collect();
    let spot_rows: Vec<AnnotationSpotCsvRow> =
        spots.iter().map(AnnotationSpotCsvRow::from).collect();
    let segmentation_rows: Vec<AnnotationSegmentationCsvRow> = segmentations
        .iter()
        .map(AnnotationSegmentationCsvRow::from)
        .collect();

    write_csv_rows(
        &annotation_classification_csv_path(folder, pos),
        &classification_rows,
    )?;
    write_csv_rows(&annotation_spot_csv_path(folder, pos), &spot_rows)?;
    write_csv_rows(
        &annotation_segmentation_csv_path(folder, pos),
        &segmentation_rows,
    )?;
    Ok(())
}

fn bbox_csv_paths(folder: &Path, pos: u32) -> Vec<PathBuf> {
    vec![
        folder.join(format!("Pos{}_bbox.csv", pos)),
        folder.join(format!("Pos{}_bboxes.csv", pos)),
    ]
}

fn registration_yaml_paths(folder: &Path, pos: u32) -> Vec<PathBuf> {
    vec![
        folder.join(format!("Pos{}_registration.yaml", pos)),
        folder.join(format!("Pos{}_register.yaml", pos)),
    ]
}

fn resolve_bbox_csv(folder: &Path, pos: u32) -> Option<PathBuf> {
    for path in bbox_csv_paths(folder, pos) {
        if path.exists() {
            return Some(path);
        }
    }
    None
}

fn resolve_registration_yaml(folder: &Path, pos: u32) -> Option<PathBuf> {
    for path in registration_yaml_paths(folder, pos) {
        if path.exists() {
            return Some(path);
        }
    }
    None
}

fn app_state_dir() -> PathBuf {
    dirs::config_dir()
        .or_else(dirs::data_dir)
        .or_else(dirs::cache_dir)
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("lisca")
        .join("desktop")
}

fn app_db_path() -> PathBuf {
    let mut path = app_state_dir();
    path.push(APP_SQLITE_FILE);
    path
}

fn open_app_database() -> Result<Connection, String> {
    let path = app_db_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS assays (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                time TEXT NOT NULL,
                type TEXT NOT NULL,
                folder TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                started_at TEXT,
                finished_at TEXT,
                request_json TEXT NOT NULL,
                result_json TEXT,
                error TEXT,
                logs_json TEXT NOT NULL,
                progress_events_json TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS assays_updated_at_idx ON assays (updated_at DESC);
            CREATE INDEX IF NOT EXISTS tasks_created_at_idx ON tasks (created_at DESC);
            ",
        )
        .map_err(|error| error.to_string())?;
    Ok(connection)
}

fn emit_download_progress(app: &AppHandle, phase: &str, progress: f64, message: &str) {
    let payload = json!({
        "phase": phase,
        "progress": progress,
        "message": message,
    });
    let _ = app.emit("download-assets-progress", payload.clone());
    let _ = app.emit(SETTINGS_DOWNLOAD_PROGRESS_CHANNEL, payload);
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            assays_list,
            assays_remove,
            assays_upsert,
            assays_pick_data_folder,
            assays_pick_assay_yaml,
            assays_read_yaml,
            assays_write_yaml,
            assays_path_exists,
            register_scan,
            register_read_image,
            register_read_registration,
            register_auto_detect,
            register_save_bbox,
            roi_discover,
            roi_load_frame,
            annotations_load,
            annotations_save,
            tasks_insert,
            tasks_update,
            tasks_list,
            tasks_delete_completed,
            tasks_run_register_auto_detect,
            tasks_run_crop,
            tasks_run_killing_predict,
            application_load_prediction_csv,
            settings_download_assets,
            settings_get_asset_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempTestDir {
        path: PathBuf,
    }

    impl TempTestDir {
        fn new() -> Self {
            let path = env::temp_dir().join(format!("lisca-desktop-annotation-{}", Uuid::new_v4()));
            fs::create_dir_all(&path).expect("create temp dir");
            Self { path }
        }
    }

    impl Drop for TempTestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn annotation_load_missing_files_returns_empty() {
        let temp_dir = TempTestDir::new();
        let bundle = load_annotation_bundle(&temp_dir.path, 3).expect("load empty annotations");
        assert_eq!(bundle, AnnotationLoadResponse::default());
    }

    #[test]
    fn annotation_classifications_round_trip_quoted_values() {
        let temp_dir = TempTestDir::new();
        let bundle = AnnotationLoadResponse {
            classifications: vec![AnnotationClassificationRow {
                roi: "roi_1".to_string(),
                t: 2,
                c: 1,
                z: 0,
                class_name: "dead, late".to_string(),
            }],
            ..AnnotationLoadResponse::default()
        };

        save_annotation_bundle(&temp_dir.path, 7, &bundle).expect("save annotations");
        let loaded = load_annotation_bundle(&temp_dir.path, 7).expect("load annotations");

        assert_eq!(loaded.classifications, bundle.classifications);
    }

    #[test]
    fn annotation_save_then_load_preserves_all_row_fields() {
        let temp_dir = TempTestDir::new();
        let bundle = AnnotationLoadResponse {
            classifications: vec![AnnotationClassificationRow {
                roi: "roi_a".to_string(),
                t: 1,
                c: 0,
                z: 4,
                class_name: "alive".to_string(),
            }],
            spots: vec![AnnotationSpotRow {
                roi: "roi_a".to_string(),
                t: 1,
                c: 0,
                z: 4,
                spot_idx: 0,
                x: 12.5,
                y: 33.75,
            }],
            segmentations: vec![
                AnnotationSegmentationRow {
                    roi: "roi_a".to_string(),
                    t: 1,
                    c: 0,
                    z: 4,
                    contour_idx: 0,
                    node_idx: 0,
                    x: 1.0,
                    y: 2.0,
                },
                AnnotationSegmentationRow {
                    roi: "roi_a".to_string(),
                    t: 1,
                    c: 0,
                    z: 4,
                    contour_idx: 0,
                    node_idx: 1,
                    x: 3.0,
                    y: 4.0,
                },
            ],
        };

        save_annotation_bundle(&temp_dir.path, 9, &bundle).expect("save annotations");
        let loaded = load_annotation_bundle(&temp_dir.path, 9).expect("load annotations");

        assert_eq!(loaded, bundle);
    }

    #[test]
    fn annotation_save_empty_rows_removes_files() {
        let temp_dir = TempTestDir::new();
        let pos = 5;
        let bundle = AnnotationLoadResponse {
            classifications: vec![AnnotationClassificationRow {
                roi: "roi_x".to_string(),
                t: 0,
                c: 0,
                z: 0,
                class_name: "control".to_string(),
            }],
            spots: vec![AnnotationSpotRow {
                roi: "roi_x".to_string(),
                t: 0,
                c: 0,
                z: 0,
                spot_idx: 0,
                x: 8.0,
                y: 9.0,
            }],
            segmentations: vec![AnnotationSegmentationRow {
                roi: "roi_x".to_string(),
                t: 0,
                c: 0,
                z: 0,
                contour_idx: 0,
                node_idx: 0,
                x: 1.0,
                y: 1.0,
            }],
        };

        save_annotation_bundle(&temp_dir.path, pos, &bundle).expect("save annotations");
        assert!(annotation_classification_csv_path(&temp_dir.path, pos).exists());
        assert!(annotation_spot_csv_path(&temp_dir.path, pos).exists());
        assert!(annotation_segmentation_csv_path(&temp_dir.path, pos).exists());

        save_annotation_bundle(&temp_dir.path, pos, &AnnotationLoadResponse::default())
            .expect("clear annotations");

        assert!(!annotation_classification_csv_path(&temp_dir.path, pos).exists());
        assert!(!annotation_spot_csv_path(&temp_dir.path, pos).exists());
        assert!(!annotation_segmentation_csv_path(&temp_dir.path, pos).exists());
    }

    #[test]
    fn parse_tiff_filename_accepts_img_channel_prefix() {
        let parsed = parse_tiff_filename("img_channel000_position140_time000000000_z000.tif");
        assert_eq!(parsed, Some((0, 140, 0, 0)));
    }

    #[test]
    fn parse_tiff_filename_accepts_img_prefix_segments() {
        let parsed = parse_tiff_filename("img_channel000-position140-time000000001-z000.tif");
        assert_eq!(parsed, Some((0, 140, 1, 0)));
    }
}
