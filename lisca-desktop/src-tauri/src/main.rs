#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use lisca_rs::{run, Commands};
use lisca_rs::cli::commands::{
    convert::ConvertArgs,
    crop::CropArgs,
    register::RegisterArgs,
    killing::KillingArgs,
};

#[tauri::command]
fn run_convert(args: ConvertArgs) -> Result<(), String> {
    run(Commands::Convert(args), &|_p, _msg| {}).map_err(|error| error.to_string())
}

#[tauri::command]
fn run_crop(args: CropArgs) -> Result<(), String> {
    run(Commands::Crop(args), &|_p, _msg| {}).map_err(|error| error.to_string())
}

#[tauri::command]
fn run_kill(args: KillingArgs) -> Result<(), String> {
    run(Commands::Killing(args), &|_p, _msg| {}).map_err(|error| error.to_string())
}

#[tauri::command]
fn run_register(args: RegisterArgs) -> Result<(), String> {
    run(Commands::Register(args), &|_p, _msg| {}).map_err(|error| error.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![run_convert, run_crop, run_kill, run_register])
        .run(tauri::generate_context!())
        .expect("failed to run tauri");
}
