use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::Emitter;

const MAX_LOG_SIZE: u64 = 512 * 1024;

pub struct ActivityLog {
    path: PathBuf,
    file: Mutex<Option<fs::File>>,
}

impl ActivityLog {
    /// Creates a log writer rooted at `base_dir` (the app config directory).
    pub fn new(base_dir: PathBuf) -> Self {
        Self {
            path: base_dir.join("activity.log"),
            file: Mutex::new(None),
        }
    }

    /// Appends a timestamped line and emits the same message to the UI.
    pub fn write(&self, app: &tauri::AppHandle, level: &str, message: &str) {
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
        let line = format!("[{timestamp}] [{level}] {message}");

        self.append_line(&line);

        let _ = app.emit(
            "log-entry",
            serde_json::json!({ "level": level, "message": message }),
        );
    }

    /// Appends a line to the log file, rotating it if it grows too large.
    fn append_line(&self, line: &str) {
        let mut guard = self.file.lock().unwrap();
        if guard.is_none() {
            *guard = Some(
                OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&self.path)
                    .expect("failed to open log file"),
            );
        }

        if let Ok(meta) = fs::metadata(&self.path) {
            if meta.len() > MAX_LOG_SIZE {
                let _ = fs::remove_file(&self.path);
                *guard = OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&self.path)
                    .ok();
            }
        }

        if let Some(file) = guard.as_mut() {
            let _ = writeln!(file, "{line}");
        }
    }

    /// Returns the last `count` log entries, oldest first (chronological),
    /// each parsed into `{ level, message }` so persisted errors render the
    /// same as live ones.
    pub fn read_tail(&self, count: usize) -> Vec<LogEntry> {
        let Ok(contents) = fs::read_to_string(&self.path) else {
            return Vec::new();
        };
        let mut lines: Vec<&str> = contents.lines().rev().take(count).collect();
        lines.reverse();
        lines.into_iter().map(parse_line).collect()
    }

    pub fn path(&self) -> &PathBuf {
        &self.path
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_level_and_message() {
        let entry = parse_line("[2026-09-07 12:00:00] [error] \"file\" -> error");
        assert_eq!(entry.level, "error");
        assert_eq!(entry.message, "\"file\" -> error");
    }

    #[test]
    fn unknown_format_falls_back_to_info() {
        let entry = parse_line("not a log line");
        assert_eq!(entry.level, "info");
        assert_eq!(entry.message, "not a log line");
    }

    #[test]
    fn read_tail_returns_chronological() {
        let dir = std::env::temp_dir().join(format!("fau_log_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let log = ActivityLog::new(dir.clone());
        for line in ["[t] [info] first", "[t] [error] second", "[t] [info] third"] {
            fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(log.path())
                .unwrap()
                .write_all(format!("{line}\n").as_bytes())
                .unwrap();
        }

        let entries = log.read_tail(10);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].message, "first");
        assert_eq!(entries[1].message, "second");
        assert_eq!(entries[2].level, "info");
        assert_eq!(entries[2].message, "third");
        let _ = fs::remove_dir_all(&dir);
    }
}

/// A single log entry as consumed by the frontend.
#[derive(Debug, Clone, serde::Serialize)]
pub struct LogEntry {
    pub level: String,
    pub message: String,
}

/// Parses a persisted line (`[timestamp] [level] message`) into its parts.
/// Falls back to an info entry with the whole line when the format is unknown.
fn parse_line(line: &str) -> LogEntry {
    if let Some(rest) = line.strip_prefix('[') {
        if let Some(mid_start) = rest.find("] [") {
            let mid = &rest[mid_start + 3..];
            if let Some(level_end) = mid.find("] ") {
                let level = &mid[..level_end];
                let message = &mid[level_end + 2..];
                if !message.is_empty() {
                    return LogEntry {
                        level: level.to_string(),
                        message: message.to_string(),
                    };
                }
            }
        }
    }
    LogEntry {
        level: "info".into(),
        message: line.into(),
    }
}
