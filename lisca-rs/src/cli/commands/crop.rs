use clap::Args;
use serde::{Deserialize, Serialize};

#[derive(Args, Clone, Serialize, Deserialize)]
pub struct CropArgs {
    #[arg(long)]
    pub input: String,
    #[arg(long)]
    pub pos: u32,
    #[arg(long)]
    pub bbox: String,
    #[arg(long)]
    pub output: String,
    #[arg(long, default_value_t = false)]
    pub background: bool,
    #[arg(long, default_value_t = false)]
    pub no_progress: bool,
}
