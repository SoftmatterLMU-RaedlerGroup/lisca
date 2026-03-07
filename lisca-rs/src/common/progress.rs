use std::cell::RefCell;
use std::io::{self, IsTerminal, Write};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

const DEFAULT_BAR_WIDTH: usize = 28;
const DEFAULT_PLAIN_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProgressKind {
    Start,
    #[default]
    Update,
    Finish,
    Error,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ProgressEvent {
    #[serde(default)]
    pub kind: ProgressKind,
    pub progress: f64,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    #[serde(default)]
    pub timestamp: String,
}

#[derive(Debug)]
struct RendererState {
    last_line_len: usize,
    last_plain_progress: f64,
    last_plain_message: String,
    last_plain_at: Option<Instant>,
}

impl Default for RendererState {
    fn default() -> Self {
        Self {
            last_line_len: 0,
            last_plain_progress: -1.0,
            last_plain_message: String::new(),
            last_plain_at: None,
        }
    }
}

pub struct TerminalProgressRenderer {
    interactive: bool,
    bar_width: usize,
    plain_interval: Duration,
    state: RefCell<RendererState>,
}

impl TerminalProgressRenderer {
    pub fn stderr() -> Self {
        Self::new(io::stderr().is_terminal())
    }

    pub fn new(interactive: bool) -> Self {
        Self {
            interactive,
            bar_width: DEFAULT_BAR_WIDTH,
            plain_interval: DEFAULT_PLAIN_INTERVAL,
            state: RefCell::new(RendererState::default()),
        }
    }

    pub fn handle(&self, event: ProgressEvent) {
        let event = normalize(event);
        if self.interactive {
            self.render_interactive(&event);
        } else {
            self.render_plain(&event);
        }
    }

    fn render_interactive(&self, event: &ProgressEvent) {
        let progress = clamp_progress(event.progress);
        let filled = ((progress * self.bar_width as f64).round() as usize).min(self.bar_width);
        let bar = format!(
            "{}{}",
            "#".repeat(filled),
            "-".repeat(self.bar_width.saturating_sub(filled))
        );
        let percent = (progress * 100.0).round() as u32;
        let line = format!(
            "{percent:>3}% [{bar}] {}{}",
            event.message,
            event_suffix(event)
        );

        let mut state = self.state.borrow_mut();
        let padding = state.last_line_len.saturating_sub(line.len());
        let mut stderr = io::stderr();
        let _ = write!(stderr, "\r{line}{}", " ".repeat(padding));
        let _ = stderr.flush();

        let terminal =
            matches!(event.kind, ProgressKind::Finish | ProgressKind::Error) || progress >= 1.0;
        state.last_line_len = if terminal { 0 } else { line.len() };
        if terminal {
            let _ = writeln!(stderr);
            let _ = stderr.flush();
        }
    }

    fn render_plain(&self, event: &ProgressEvent) {
        let progress = clamp_progress(event.progress);
        let percent = (progress * 100.0).round() as u32;
        let now = Instant::now();
        let mut state = self.state.borrow_mut();
        let should_print = matches!(
            event.kind,
            ProgressKind::Start | ProgressKind::Finish | ProgressKind::Error
        ) || event.message != state.last_plain_message
            || (progress - state.last_plain_progress).abs() >= 0.05
            || state
                .last_plain_at
                .map(|last| now.duration_since(last) >= self.plain_interval)
                .unwrap_or(true);
        if !should_print {
            return;
        }

        let mut stderr = io::stderr();
        let _ = writeln!(
            stderr,
            "{:>6} {percent:>3}% {}{}",
            kind_label(event.kind),
            event.message,
            event_suffix(event)
        );
        let _ = stderr.flush();

        state.last_plain_progress = progress;
        state.last_plain_message = event.message.clone();
        state.last_plain_at = Some(now);
    }
}

pub fn progress_event(progress: f64, message: impl Into<String>) -> ProgressEvent {
    ProgressEvent {
        kind: ProgressKind::Update,
        progress: clamp_progress(progress),
        message: message.into(),
        step: None,
        current: None,
        total: None,
        timestamp: progress_timestamp(),
    }
}

pub fn start(progress: f64, message: impl Into<String>) -> ProgressEvent {
    ProgressEvent {
        kind: ProgressKind::Start,
        ..progress_event(progress, message)
    }
}

pub fn finish(progress: f64, message: impl Into<String>) -> ProgressEvent {
    ProgressEvent {
        kind: ProgressKind::Finish,
        ..progress_event(progress, message)
    }
}

pub fn error(progress: f64, message: impl Into<String>) -> ProgressEvent {
    ProgressEvent {
        kind: ProgressKind::Error,
        ..progress_event(progress, message)
    }
}

pub fn legacy_adapter<'a>(sink: &'a dyn Fn(ProgressEvent)) -> impl Fn(f64, &str) + 'a {
    move |progress, message| sink(progress_event(progress, message))
}

pub fn progress_timestamp() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{:09}Z", now.as_secs(), now.subsec_nanos())
}

fn clamp_progress(progress: f64) -> f64 {
    progress.clamp(0.0, 1.0)
}

fn normalize(mut event: ProgressEvent) -> ProgressEvent {
    event.progress = clamp_progress(event.progress);
    if event.timestamp.is_empty() {
        event.timestamp = progress_timestamp();
    }
    event
}

fn event_suffix(event: &ProgressEvent) -> String {
    if let (Some(current), Some(total)) = (event.current, event.total) {
        return format!(" ({current}/{total})");
    }
    if let Some(step) = event.step.as_deref() {
        return format!(" [{step}]");
    }
    String::new()
}

fn kind_label(kind: ProgressKind) -> &'static str {
    match kind {
        ProgressKind::Start => "start",
        ProgressKind::Update => "update",
        ProgressKind::Finish => "finish",
        ProgressKind::Error => "error",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn legacy_adapter_emits_update_events() {
        let events = RefCell::new(Vec::new());
        {
            let sink = |event: ProgressEvent| events.borrow_mut().push(event);
            let callback = legacy_adapter(&sink);
            callback(0.4, "Processing");
        }

        let events = events.into_inner();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, ProgressKind::Update);
        assert_eq!(events[0].progress, 0.4);
        assert_eq!(events[0].message, "Processing");
    }

    #[test]
    fn finish_event_uses_finish_kind() {
        let event = finish(1.0, "Done");
        assert_eq!(event.kind, ProgressKind::Finish);
        assert_eq!(event.progress, 1.0);
        assert_eq!(event.message, "Done");
    }
}
