use clap::Parser;

fn main() {
    let cli = lisca_rs::Cli::parse();
    let result = lisca_rs::run_cli(cli);

    if let Err(e) = result {
        eprintln!("{}", e);
        std::process::exit(1);
    }
}
