pub mod commands {
    pub mod convert;
    pub mod crop;
    pub mod expression;
    pub mod killing;
    pub mod movie;
    pub mod tissue;
}

use clap::{Parser, Subcommand};

use self::commands::{
    convert::ConvertArgs, crop::CropArgs, expression::ExpressionArgs, killing::KillingArgs,
    movie::MovieArgs, tissue::TissueArgs,
};

#[derive(Parser)]
#[command(name = "lisca-rs", about = "Lisca Rust CLI: convert, crop, movie, expression, killing, tissue")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
    Convert(ConvertArgs),
    Crop(CropArgs),
    Movie(MovieArgs),
    Expression(ExpressionArgs),
    Killing(KillingArgs),
    Tissue(TissueArgs),
}
