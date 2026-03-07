use clap::Args;
use serde::{Deserialize, Serialize};

#[derive(Args, Clone, Serialize, Deserialize)]
pub struct ExpressionArgs {
    #[arg(long)]
    pub workspace: String,
    #[arg(long)]
    pub pos: u32,
    #[arg(long)]
    pub channel: u32,
    #[arg(long)]
    pub output: String,
    #[arg(long, default_value_t = false)]
    pub no_progress: bool,
}
