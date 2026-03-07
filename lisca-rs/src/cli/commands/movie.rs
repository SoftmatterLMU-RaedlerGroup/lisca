use clap::Args;
use serde::{Deserialize, Serialize};

#[derive(Args, Clone, Serialize, Deserialize)]
pub struct MovieArgs {
    #[arg(long)]
    pub workspace: String,
    #[arg(long)]
    pub pos: u32,
    #[arg(long)]
    pub roi: u32,
    #[arg(long)]
    pub channel: u32,
    #[arg(long)]
    pub time: String,
    #[arg(long)]
    pub output: String,
    #[arg(long, default_value_t = 10)]
    pub fps: u32,
    #[arg(long, default_value = "grayscale")]
    pub colormap: String,
    #[arg(long)]
    pub spots: Option<String>,
    #[arg(long, default_value_t = false)]
    pub no_progress: bool,
}
