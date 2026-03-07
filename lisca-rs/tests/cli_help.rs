use std::process::Command;

#[test]
fn cli_help_works() {
    let exe = env!("CARGO_BIN_EXE_lisca-rs");
    let output = Command::new(exe)
        .arg("--help")
        .output()
        .expect("failed to run lisca-rs --help");

    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("Lisca Rust CLI"));
    assert!(stdout.contains("convert"));
    assert!(stdout.contains("crop"));
    assert!(stdout.contains("register"));
    assert!(stdout.contains("movie"));
    assert!(stdout.contains("expression"));
    assert!(stdout.contains("killing"));
    assert!(stdout.contains("tissue"));
}

#[test]
fn long_running_commands_expose_no_progress_flag() {
    let exe = env!("CARGO_BIN_EXE_lisca-rs");
    for command in [
        "convert",
        "crop",
        "register",
        "movie",
        "expression",
        "killing",
        "tissue",
    ] {
        let output = Command::new(exe)
            .arg(command)
            .arg("--help")
            .output()
            .unwrap_or_else(|error| panic!("failed to run lisca-rs {command} --help: {error}"));

        assert!(output.status.success(), "{command} --help failed");
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(
            stdout.contains("--no-progress"),
            "{command} help missing --no-progress"
        );
    }
}
