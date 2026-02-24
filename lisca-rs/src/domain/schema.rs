pub const SCHEMA_VERSION: u64 = 1;

pub fn roi_store_dir(pos: u32) -> String {
    format!("Pos{}_roi.zarr", pos)
}

pub fn bg_store_dir(pos: u32) -> String {
    format!("Pos{}_bg.zarr", pos)
}

pub fn raw_array_path(roi_id: &str) -> String {
    format!("/roi/{}/raw", roi_id)
}

pub fn bg_array_path(roi_id: &str) -> String {
    format!("/roi/{}/background", roi_id)
}

pub fn roi_ids_path() -> &'static str {
    "/index/roi_ids"
}

pub fn roi_bboxes_path() -> &'static str {
    "/index/roi_bboxes"
}

pub fn roi_present_path() -> &'static str {
    "/index/roi_present"
}
