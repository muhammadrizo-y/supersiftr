use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEvent};

const DEBOUNCE_MS: u64 = 500;

pub struct FileWatcher {
    watched_paths: Vec<PathBuf>,
    stop_txs: Vec<mpsc::Sender<()>>,
}

impl Default for FileWatcher {
    fn default() -> Self {
        Self::new()
    }
}

impl FileWatcher {
    pub fn new() -> Self {
        Self {
            watched_paths: Vec::new(),
            stop_txs: Vec::new(),
        }
    }

    /// Watches a path recursively. Every debounced file event triggers the
    /// `processor` callback (on the watcher thread).
    pub fn watch<P>(
        &mut self,
        path: PathBuf,
        processor: P,
    ) -> Result<(), String>
    where
        P: Fn(PathBuf) + Send + 'static,
    {
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        self.stop_txs.push(stop_tx);

        let mut debouncer = new_debouncer(
            Duration::from_millis(DEBOUNCE_MS),
            move |result: Result<Vec<DebouncedEvent>, _>| {
                if let Ok(events) = result {
                    for event in events {
                        processor(event.path);
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

    /// Watches a single file (non-recursive) and invokes `on_change` when the
    /// file is modified. Used to hot-reload the config file.
    pub fn watch_file<F>(
        &mut self,
        path: PathBuf,
        on_change: F,
    ) -> Result<(), String>
    where
        F: Fn() + Send + 'static,
    {
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        self.stop_txs.push(stop_tx);

        let mut debouncer = new_debouncer(
            Duration::from_millis(DEBOUNCE_MS),
            move |result: Result<Vec<DebouncedEvent>, _>| {
                if let Ok(events) = result {
                    let _ = events; // any event on the file means it changed
                    on_change();
                }
            },
        )
        .map_err(|e| format!("Failed to create debouncer: {e}"))?;

        debouncer
            .watcher()
            .watch(&path, RecursiveMode::NonRecursive)
            .map_err(|e| format!("Failed to watch file: {e}"))?;

        std::thread::spawn(move || {
            let _ = stop_rx.recv();
            drop(debouncer);
        });

        Ok(())
    }

    pub fn stop(&mut self) {
        for tx in self.stop_txs.drain(..) {
            let _ = tx.send(());
        }
        self.watched_paths.clear();
    }

    pub fn watched_paths(&self) -> &[PathBuf] {
        &self.watched_paths
    }
}
