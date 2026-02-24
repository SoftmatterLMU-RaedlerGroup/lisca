use regex::Regex;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

pub const TIFF_RE: &str = r"^img_channel(\d+)_position(\d+)_time(\d+)_z(\d+)\.tif$";

pub fn discover_tiffs(
    pos_dir: &Path,
    pos: u32,
) -> Result<HashMap<(u32, u32, u32), PathBuf>, Box<dyn std::error::Error>> {
    let re = Regex::new(TIFF_RE)?;
    let mut index = HashMap::new();
    for entry in fs::read_dir(pos_dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let cap = match re.captures(&name) {
            Some(c) => c,
            None => continue,
        };
        let file_pos: u32 = cap[2].parse()?;
        if file_pos != pos {
            continue;
        }
        let c: u32 = cap[1].parse()?;
        let t: u32 = cap[3].parse()?;
        let z: u32 = cap[4].parse()?;
        index.insert((c, t, z), entry.path());
    }
    Ok(index)
}

pub enum FrameData {
    U16(Vec<u16>),
    U8(Vec<u8>),
}

pub fn read_tiff_frame(path: &Path) -> Result<(FrameData, u32, u32), Box<dyn std::error::Error>> {
    let file = fs::File::open(path)?;
    let mut decoder = tiff::decoder::Decoder::new(file)?;
    let (width, height) = decoder.dimensions()?;
    let result = decoder.read_image()?;
    let data = match result {
        tiff::decoder::DecodingResult::U8(v) => FrameData::U8(v),
        tiff::decoder::DecodingResult::U16(v) => FrameData::U16(v),
        _ => return Err("Unsupported TIFF pixel format (need u8 or u16)".into()),
    };
    Ok((data, width, height))
}
