use clap::Args;
use serde::{Deserialize, Serialize};

#[derive(Args, Clone, Serialize, Deserialize)]
pub struct KillingArgs {
    #[arg(long)]
    pub workspace: String,
    #[arg(long)]
    pub pos: u32,
    #[arg(long)]
    pub model: String,
    #[arg(long)]
    pub output: String,
    #[arg(long, default_value_t = 256)]
    pub batch_size: usize,
    #[arg(long)]
    pub cpu: bool,
}
