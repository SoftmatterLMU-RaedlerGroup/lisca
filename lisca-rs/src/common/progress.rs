use std::io::{self, Write};

pub fn emit(progress: f64, message: &str) {
    let _ = writeln!(
        io::stderr(),
        "{}",
        serde_json::json!({"progress": progress, "message": message})
    );
    let _ = io::stderr().flush();
}
