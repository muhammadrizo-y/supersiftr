use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_mini::new_debouncer;
use tauri::Emitter;

#[derive(Clone, serde::Serialize)]
pub struct FileEvent {
    pub path: String,
    pub kind: String,
}

pub struct FileWatcher {
    watched_paths: Vec<PathBuf>,
    stop_tx: Option<mpsc::Sender<()>>,
}

impl FileWatcher {
    pub fn new() -> Self {
        Self {
            watched_paths: Vec::new(),
            stop_tx: None,
        }
    }

    pub fn watch(
        &mut self,
        path: PathBuf,
        app: tauri::AppHandle,
    ) -> Result<(), String> {
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        self.stop_tx = Some(stop_tx);

        let mut debouncer = new_debouncer(
            Duration::from_millis(500),
            move |result: Result<Vec<notify_debouncer_mini::DebouncedEvent>, _>| {
                if let Ok(events) = result {
                    for event in events {
                        let kind = format!("{:?}", event.kind);
                        let file_event = FileEvent {
                            path: event.path.to_string_lossy().to_string(),
                            kind,
                        };
                        let _ = app.emit("file-event", file_event);
                    }
                }
            },
        )
        .map_err(|e| format!("Failed to create debouncer: {e}"))?;

        debouncer
            .watcher()
            .watch(&path, RecursiveMode::Recursive)
            .map_err(|e| format!("Failed to watch path: {e}"))?;

        self.watched_paths.push(path);

        std::thread::spawn(move || {
            let _ = stop_rx.recv();
            drop(debouncer);
        });

        Ok(())
    }

    pub fn stop(&mut self) {
        if let Some(tx) = self.stop_tx.take() {
            let _ = tx.send(());
        }
        self.watched_paths.clear();
    }

    pub fn watched_paths(&self) -> &[PathBuf] {
        &self.watched_paths
    }
}
