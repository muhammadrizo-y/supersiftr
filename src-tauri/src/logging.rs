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

    pub fn read_tail(&self, count: usize) -> Vec<String> {
        let Ok(contents) = fs::read_to_string(&self.path) else {
            return Vec::new();
        };
        contents.lines().rev().take(count).map(String::from).collect()
    }

    pub fn path(&self) -> &PathBuf {
        &self.path
    }
}
