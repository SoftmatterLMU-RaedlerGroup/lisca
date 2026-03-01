use clap::Args;
use serde::{Deserialize, Serialize};

#[derive(Args, Clone, Serialize, Deserialize)]
pub struct TissueArgs {
    #[arg(long)]
    pub workspace: String,
    #[arg(long)]
    pub pos: u32,
    #[arg(long)]
    pub channel_phase: u32,
    #[arg(long)]
    pub channel_fluorescence: u32,
    #[arg(long, default_value = "cellpose")]
    pub method: String,
    #[arg(long)]
    pub model: String,
    #[arg(long)]
    pub output: String,
    #[arg(long)]
    pub masks: Option<String>,
    #[arg(long, default_value_t = 1)]
    pub batch_size: usize,
    #[arg(long)]
    pub cpu: bool,
}
