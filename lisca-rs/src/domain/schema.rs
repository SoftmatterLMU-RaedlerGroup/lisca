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

pub fn raw_chunks(shape: &[u64]) -> Vec<u64> {
    vec![1, 1, 1, shape[3], shape[4]]
}

pub fn raw_shards(shape: &[u64]) -> Option<Vec<u64>> {
    let shards = vec![shape[0].min(64), shape[1], shape[2], shape[3], shape[4]];
    (shards != raw_chunks(shape)).then_some(shards)
}

pub fn bg_chunks(_shape: &[u64]) -> Vec<u64> {
    vec![1, 1, 1]
}

pub fn bg_shards(shape: &[u64]) -> Option<Vec<u64>> {
    let shards = vec![shape[0].min(256), shape[1], shape[2]];
    (shards != bg_chunks(shape)).then_some(shards)
}

pub fn mask_chunks(shape: &[u64]) -> Vec<u64> {
    vec![1, shape[1], shape[2]]
}

pub fn mask_shards(shape: &[u64]) -> Option<Vec<u64>> {
    let shards = vec![shape[0].min(64), shape[1], shape[2]];
    (shards != mask_chunks(shape)).then_some(shards)
}
