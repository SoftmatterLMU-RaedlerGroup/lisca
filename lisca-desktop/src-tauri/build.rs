use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use ffmpeg_sidecar::download::{download_ffmpeg_package, ffmpeg_download_url, unpack_ffmpeg};

fn main() {
    prepare_ffmpeg_sidecar().expect("failed to prepare ffmpeg sidecar");
    tauri_build::build()
}

fn prepare_ffmpeg_sidecar() -> Result<(), String> {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=TARGET");
    println!("cargo:rerun-if-env-changed=CARGO_CFG_TARGET_OS");

    let target_os = env::var("CARGO_CFG_TARGET_OS").map_err(|error| error.to_string())?;
    if target_os != "windows" {
        return Ok(());
    }

    let target_triple = env::var("TARGET").map_err(|error| error.to_string())?;
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").map_err(|error| error.to_string())?);
    let stage_dir = manifest_dir.join("target").join("ffmpeg-sidecars");
    let stage_path = stage_dir.join(format!("ffmpeg-{target_triple}.exe"));
    if stage_path.exists() {
        return Ok(());
    }

    let cache_dir = manifest_dir.join("target").join("ffmpeg-sidecar-cache");
    if cache_dir.exists() {
        fs::remove_dir_all(&cache_dir).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(&cache_dir).map_err(|error| error.to_string())?;
    fs::create_dir_all(&stage_dir).map_err(|error| error.to_string())?;

    let download_url = ffmpeg_download_url().map_err(|error| error.to_string())?;
    let archive_path =
        download_ffmpeg_package(download_url, &cache_dir).map_err(|error| error.to_string())?;
    unpack_ffmpeg(&archive_path, &cache_dir).map_err(|error| error.to_string())?;

    copy_file(&cache_dir.join("ffmpeg.exe"), &stage_path)?;
    fs::remove_dir_all(&cache_dir).map_err(|error| error.to_string())?;
    Ok(())
}

fn copy_file(from: &Path, to: &Path) -> Result<(), String> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::copy(from, to).map_err(|error| error.to_string())?;
    Ok(())
}
