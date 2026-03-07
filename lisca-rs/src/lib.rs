pub mod app;
pub mod cli;
pub mod common;
pub mod domain;
pub mod io;

pub use crate::cli::commands::{
    convert::ConvertArgs, crop::CropArgs, expression::ExpressionArgs, killing::KillingArgs,
    movie::MovieArgs, register::RegisterArgs, tissue::TissueArgs,
};
pub use crate::cli::{Cli, Commands};

pub fn run_cli(cli: Cli) -> Result<(), Box<dyn std::error::Error>> {
    let no_progress = command_no_progress(&cli.command);
    if no_progress {
        run_events(cli.command, &|_event| {})
    } else {
        let renderer = crate::common::progress::TerminalProgressRenderer::stderr();
        run_events(cli.command, &move |event| renderer.handle(event))
    }
}

pub fn run(
    command: Commands,
    progress: &dyn Fn(f64, &str),
) -> Result<(), Box<dyn std::error::Error>> {
    run_events(command, &|event| progress(event.progress, &event.message))
}

pub fn run_events(
    command: Commands,
    progress: &dyn Fn(crate::common::progress::ProgressEvent),
) -> Result<(), Box<dyn std::error::Error>> {
    match command {
        Commands::Convert(args) => {
            app::convert::run(args, crate::common::progress::legacy_adapter(progress))
        }
        Commands::Crop(args) => {
            app::crop::run(args, crate::common::progress::legacy_adapter(progress))
        }
        Commands::Register(args) => {
            app::register::run(args, crate::common::progress::legacy_adapter(progress))
        }
        Commands::Movie(args) => {
            app::movie::run(args, crate::common::progress::legacy_adapter(progress))
        }
        Commands::Expression(args) => {
            app::expression::run(args, crate::common::progress::legacy_adapter(progress))
        }
        Commands::Killing(args) => {
            app::killing::run(args, crate::common::progress::legacy_adapter(progress))
        }
        Commands::Tissue(args) => {
            app::tissue::run(args, crate::common::progress::legacy_adapter(progress))
        }
    }
}

fn command_no_progress(command: &Commands) -> bool {
    match command {
        Commands::Convert(args) => args.no_progress,
        Commands::Crop(args) => args.no_progress,
        Commands::Register(args) => args.no_progress,
        Commands::Movie(args) => args.no_progress,
        Commands::Expression(args) => args.no_progress,
        Commands::Killing(args) => args.no_progress,
        Commands::Tissue(args) => args.no_progress,
    }
}
