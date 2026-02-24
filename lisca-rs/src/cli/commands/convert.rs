use clap::Args;

#[derive(Args, Clone)]
pub struct ConvertArgs {
    #[arg(long)]
    pub input: String,
    #[arg(long)]
    pub pos: String,
    #[arg(long)]
    pub time: String,
    #[arg(long)]
    pub output: String,
}
