use clap::Args;
use serde::{Deserialize, Serialize};

#[derive(Args, Clone, Serialize, Deserialize)]
pub struct ConvertArgs {
    #[arg(long)]
    pub input: String,
    #[arg(long)]
    pub pos: String,
    #[arg(long)]
    pub time: String,
    #[arg(long)]
    pub output: String,
    #[arg(long, default_value_t = false)]
    pub no_progress: bool,
}
