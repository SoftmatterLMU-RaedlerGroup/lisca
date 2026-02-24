use clap::Args;

#[derive(Args, Clone)]
pub struct ExpressionArgs {
    #[arg(long)]
    pub workspace: String,
    #[arg(long)]
    pub pos: u32,
    #[arg(long)]
    pub channel: u32,
    #[arg(long)]
    pub output: String,
}
