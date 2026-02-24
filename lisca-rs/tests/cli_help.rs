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
