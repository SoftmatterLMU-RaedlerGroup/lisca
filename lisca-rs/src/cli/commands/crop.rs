use clap::Args;

#[derive(Args, Clone)]
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
}
