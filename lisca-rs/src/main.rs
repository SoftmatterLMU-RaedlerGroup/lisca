mod app;
mod cli;
mod common;
mod domain;
mod io;

use clap::Parser;

fn main() {
    let cli = cli::Cli::parse();
    let result = match cli.command {
        cli::Commands::Convert(args) => app::convert::run(args, common::progress::emit),
        cli::Commands::Crop(args) => app::crop::run(args, common::progress::emit),
        cli::Commands::Register(args) => app::register::run(args, common::progress::emit),
        cli::Commands::Movie(args) => app::movie::run(args, common::progress::emit),
        cli::Commands::Expression(args) => app::expression::run(args, common::progress::emit),
        cli::Commands::Killing(args) => app::killing::run(args, common::progress::emit),
        cli::Commands::Tissue(args) => app::tissue::run(args, common::progress::emit),
    };

    if let Err(e) = result {
        eprintln!("{}", e);
        std::process::exit(1);
    }
}
