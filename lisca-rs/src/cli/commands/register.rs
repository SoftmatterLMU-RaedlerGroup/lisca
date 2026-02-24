use clap::{Args, ValueEnum};

#[derive(Copy, Clone, Debug, Eq, PartialEq, ValueEnum)]
pub enum GridShape {
    Square,
    Hex,
}

#[derive(Args, Clone, Debug)]
pub struct RegisterArgs {
    #[arg(long)]
    pub input: String,
    #[arg(long)]
    pub pos: u32,
    #[arg(long, default_value_t = 0)]
    pub channel: u32,
    #[arg(long, default_value_t = 0)]
    pub time: u32,
    #[arg(long, default_value_t = 0)]
    pub z: u32,
    #[arg(long, value_enum, default_value_t = GridShape::Square)]
    pub grid: GridShape,
    #[arg(long, default_value_t = 50.0)]
    pub w: f64,
    #[arg(long, default_value_t = 50.0)]
    pub h: f64,
    #[arg(long, default_value_t = 5)]
    pub local_var_radius: usize,
    #[arg(long, default_value_t = 2)]
    pub morph_radius: usize,
    #[arg(long, default_value_t = 10)]
    pub peak_merge_radius: usize,
    #[arg(long, default_value_t = 3.0)]
    pub peak_min_abs: f64,
    #[arg(long, default_value_t = 0.1)]
    pub peak_min_ratio: f64,
    #[arg(long, default_value_t = 0.3)]
    pub peak_drop_max_frac: f64,
    #[arg(long, default_value_t = 0.2)]
    pub peak_cv_threshold: f64,
    #[arg(long, default_value_t = 0.95)]
    pub inlier_frac: f64,
    #[arg(long, default_value_t = 50)]
    pub refine_iters: usize,
    #[arg(long, default_value_t = false)]
    pub diagnostics: bool,
    #[arg(long, default_value_t = false)]
    pub pretty: bool,
    #[arg(long, default_value_t = false)]
    pub no_progress: bool,
}
