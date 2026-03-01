pub mod app;
pub mod cli;
pub mod common;
pub mod domain;
pub mod io;

pub use crate::cli::{Cli, Commands};
pub use crate::cli::commands::{
    convert::ConvertArgs,
    crop::CropArgs,
    expression::ExpressionArgs,
    killing::KillingArgs,
    movie::MovieArgs,
    register::RegisterArgs,
    tissue::TissueArgs,
};

pub fn run_cli(cli: Cli) -> Result<(), Box<dyn std::error::Error>> {
    run(cli.command, &crate::common::progress::emit)
}

pub fn run(command: Commands, progress: &dyn Fn(f64, &str)) -> Result<(), Box<dyn std::error::Error>> {
    match command {
        Commands::Convert(args) => app::convert::run(args, progress),
        Commands::Crop(args) => app::crop::run(args, progress),
        Commands::Register(args) => app::register::run(args, progress),
        Commands::Movie(args) => app::movie::run(args, progress),
        Commands::Expression(args) => app::expression::run(args, progress),
        Commands::Killing(args) => app::killing::run(args, progress),
        Commands::Tissue(args) => app::tissue::run(args, progress),
    }
}
