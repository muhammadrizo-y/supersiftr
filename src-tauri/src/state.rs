use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

use tauri::Manager;

use crate::actions;
use crate::config::{self, AppConfig};
use crate::kinds::{self, KindStore};
use crate::license::{self, LicenseStore};
use crate::logging::ActivityLog;
use crate::sieves::{self, DeleteMode, RuleAction, Sieve, SieveStore};
use crate::watcher::FileWatcher;

pub struct AppState {
    pub watcher: Mutex<FileWatcher>,
    pub config: Mutex<AppConfig>,
    pub first_run: bool,
    pub sieves: Mutex<SieveStore>,
    pub kinds: Mutex<KindStore>,
    pub license: Mutex<LicenseStore>,
    pub log: ActivityLog,
    pub tray: Mutex<Option<tauri::tray::TrayIcon>>,
    pub handled: Mutex<HandledFiles>,
}

// Lock ordering: any block that holds more than one of these mutexes must
// acquire them in this canonical order — sieves → kinds → config → watcher.
// `process()` is the only nested acquisition today and starts with `sieves`.
// Keep it that way or a new command that locks the reverse order will deadlock.
// `handled` is a leaf: `process()` only ever takes it on its own, never while
// holding another lock.

impl AppState {
    pub fn new() -> Self {
        let config_dir = config::config_dir().unwrap_or_default();
        let (config, first_run) = config::load().unwrap_or_default();
        Self {
            watcher: Mutex::new(FileWatcher::new()),
            config: Mutex::new(config),
            first_run,
            sieves: Mutex::new(sieves::load().unwrap_or_default()),
            kinds: Mutex::new(kinds::load().unwrap_or_default()),
            license: Mutex::new(license::load().unwrap_or_default()),
            log: ActivityLog::new(config_dir),
            tray: Mutex::new(None),
            handled: Mutex::new(HandledFiles::new()),
        }
    }

    /// Reloads the persisted sieves into state, then restarts watchers — but
    /// only when the file actually changed. The app itself writes `sieves.json`
    /// on every mutation, which the file watcher also sees; without this guard
    /// each save would trigger an unnecessary `restart_watchers` (and the
    /// re-watch churn would look like an endless loop from the outside).
    pub fn reload(app: &tauri::AppHandle) -> Result<(), String> {
        let state = app.state::<AppState>();
        let loaded = sieves::load().map_err(|e| e.to_string())?;
        {
            let current = state.sieves.lock().unwrap();
            if serde_json::to_string(&current.sieves).unwrap_or_default()
                == serde_json::to_string(&loaded.sieves).unwrap_or_default()
            {
                return Ok(());
            }
            drop(current);
        }
        {
            let mut sieves = state.sieves.lock().unwrap();
            *sieves = loaded;
        }
        Self::restart_watchers(app)
    }

    pub fn restart_watchers(app: &tauri::AppHandle) -> Result<(), String> {
        let state = app.state::<AppState>();

        let folders: Vec<String> = {
            let sieves = state.sieves.lock().unwrap();
            collect_watch_folders(&sieves.sieves)
        };

        {
            let mut watcher = state.watcher.lock().unwrap();
            watcher.stop();
            for folder in folders {
                let folder_path = std::path::PathBuf::from(folder);
                let folder_str = folder_path.display().to_string();
                if !folder_path.is_dir() {
                    state.log.write(
                        app,
                        "error",
                        &format!("Cannot watch non-existent folder: \"{folder_str}\""),
                    );
                    continue;
                }
                let app_handle = app.clone();
                if let Err(e) = watcher.watch(folder_path, move |path| {
                    Self::process(app_handle.clone(), path);
                }) {
                    state.log.write(
                        app,
                        "error",
                        &format!("Failed to watch \"{folder_str}\": {e}"),
                    );
                }
            }

            // Hot-reload the sieves file: any edit restarts watchers against
            // the freshly loaded sieves.
            if let Ok(path) = sieves::sieves_path() {
                let app_handle = app.clone();
                if let Err(e) = watcher.watch_file(path, move || {
                    let _ = Self::reload(&app_handle);
                }) {
                    state.log.write(app, "error", &format!("Failed to watch sieves file: {e}"));
                }
            }
        }
        Ok(())
    }

    /// Applies sieves to `path`. Called from the watcher thread on every event.
    /// Skips files that no longer exist (already handled by a prior event).
    pub fn process(app: tauri::AppHandle, path: std::path::PathBuf) {
        let state = app.state::<AppState>();
        let (sieves, kinds, compound_extensions) = {
            let sieves = state.sieves.lock().unwrap();
            let kinds = state.kinds.lock().unwrap();
            (sieves.sieves.clone(), kinds.effective(), state.config.lock().unwrap().compound_extensions.clone())
        };

        if !path.exists() {
            return;
        }

        // Skip the echo of our own work: rename/move keep a file's mtime and
        // size, so the events they generate at the result path would
        // otherwise match the same sieve again (Rename `{name}_renamed`
        // looping into `_renamed_renamed_...`). A later external edit changes
        // mtime/size and re-arms the file.
        if let Some(fingerprint) = file_fingerprint(&path) {
            if state.handled.lock().unwrap().is_echo(&fingerprint, &path) {
                return;
            }
        }

        let licensed = state.license.lock().unwrap().is_licensed();

        for sieve in &sieves {
            if !sieve.applies_to(&path) {
                continue;
            }
            if !sieve.is_runnable() {
                continue;
            }
            if sieve.uses_pro_features() && !licensed {
                continue;
            }
            if sieve.matches(&path, &kinds) {
                let mut current = path.to_owned();
                for action in &sieve.actions {
                    match actions::execute(&current, action, &compound_extensions, &kinds) {
                        Ok(dest) => {
                            let verb = action_verb(action);
                            let target = match action {
                                RuleAction::Delete { .. } => String::new(),
                                _ => format!(" -> \"{}\"", dest.to_string_lossy()),
                            };
                            state.log.write(
                                &app,
                                "info",
                                &format!(
                                    "[{}] {verb} \"{}\"{target}",
                                    sieve.name,
                                    current
                                        .file_name()
                                        .map(|n| n.to_string_lossy().to_string())
                                        .unwrap_or_default(),
                                ),
                            );
                            current = dest;
                            if matches!(action, RuleAction::Delete { .. }) {
                                break;
                            }
                        }
                        Err(actions::ActionError::SourceNotFound(_)) => {
                            // A prior action in this chain already moved the file,
                            // or a duplicate event fired; not an error.
                        }
                        Err(e) => {
                            let mut error = e.to_string();
                            // Trim the redundant path prefix.
                            if let Some(pos) = error.find(": ") {
                                let shorthand = &error[pos + 2..];
                                if !shorthand.is_empty() {
                                    error = shorthand.to_string();
                                }
                            }
                            state.log.write(
                                &app,
                                "error",
                                &format!(
                                    "[{}] \"{}\": {error}",
                                    sieve.name,
                                    current.to_string_lossy()
                                ),
                            );
                        }
                    }
                }
                if let Some(fingerprint) = file_fingerprint(&current) {
                    state.handled.lock().unwrap().record(fingerprint, current);
                }
                break;
            }
        }
    }
}

/// (mtime, byte length): unchanged by rename/move, changed by edits.
type Fingerprint = (SystemTime, u64);

/// Result paths a sieve already produced, with the fingerprint they had.
/// Echo events from our own rename/move arrive at the recorded path with an
/// unchanged fingerprint and are skipped; anything else (new file, edited
/// file, externally renamed file) falls through and is processed normally.
pub struct HandledFiles {
    entries: HashMap<PathBuf, (Fingerprint, Instant)>,
}

const MAX_HANDLED: usize = 8192;
const HANDLED_TTL: Duration = Duration::from_secs(60);

impl HandledFiles {
    fn new() -> Self {
        Self {
            entries: HashMap::new(),
        }
    }

    fn is_echo(&self, fingerprint: &Fingerprint, path: &Path) -> bool {
        matches!(self.entries.get(path), Some((f, _)) if f == fingerprint)
    }

    fn record(&mut self, fingerprint: Fingerprint, path: PathBuf) {
        if self.entries.len() >= MAX_HANDLED {
            self.entries.retain(|_, (_, at)| at.elapsed() < HANDLED_TTL);
            if self.entries.len() >= MAX_HANDLED {
                self.entries.clear();
            }
        }
        self.entries.insert(path, (fingerprint, Instant::now()));
    }
}

fn file_fingerprint(path: &Path) -> Option<Fingerprint> {
    let meta = std::fs::metadata(path).ok()?;
    let modified = meta.modified().ok()?;
    Some((modified, meta.len()))
}

fn action_verb(action: &RuleAction) -> &'static str {
    match action {
        RuleAction::Move { .. } => "Moved",
        RuleAction::Copy { .. } => "Copied",
        RuleAction::Rename { .. } => "Renamed",
        RuleAction::Delete { mode: DeleteMode::Recycle } => "Sent to recycle bin",
        RuleAction::Delete { mode: DeleteMode::Permanent } => "Deleted",
        RuleAction::SortInto { .. } => "Sorted",
        RuleAction::Compress { .. } => "Compressed",
        RuleAction::Extract { .. } => "Extracted",
    }
}

/// Returns the deduplicated set of folders watched across all enabled sieves.
fn collect_watch_folders(sieves: &[Sieve]) -> Vec<String> {
    let mut folders: Vec<String> = Vec::new();
    for sieve in sieves {
        if !sieve.enabled {
            continue;
        }
        for folder in &sieve.watched_folders {
            if !folders.contains(folder) {
                folders.push(folder.clone());
            }
        }
    }
    folders
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("ss_handled_test_{name}_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_file(dir: &Path, name: &str, content: &[u8]) -> PathBuf {
        let path = dir.join(name);
        fs::File::create(&path)
            .unwrap()
            .write_all(content)
            .unwrap();
        path
    }

    #[test]
    fn rename_keeps_fingerprint_and_matches_recorded_echo() {
        let dir = temp_dir("rename_echo");
        let before = write_file(&dir, "photo.jpg", b"data");
        let fingerprint = file_fingerprint(&before).unwrap();
        let after = dir.join("photo_renamed.jpg");
        fs::rename(&before, &after).unwrap();
        let fingerprint_after = file_fingerprint(&after).unwrap();
        assert_eq!(fingerprint, fingerprint_after);

        let mut handled = HandledFiles::new();
        handled.record(fingerprint_after, after.clone());
        assert!(handled.is_echo(&fingerprint_after, &after));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn edited_file_is_not_an_echo() {
        let dir = temp_dir("edited");
        let path = write_file(&dir, "doc.txt", b"one");
        let fingerprint = file_fingerprint(&path).unwrap();
        let mut handled = HandledFiles::new();
        handled.record(fingerprint, path.clone());

        write_file(&dir, "doc.txt", b"one two");
        let fingerprint_after = file_fingerprint(&path).unwrap();
        assert!(!handled.is_echo(&fingerprint_after, &path));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn same_file_at_another_path_is_not_an_echo() {
        let dir = temp_dir("other_path");
        let before = write_file(&dir, "a.txt", b"data");
        let fingerprint = file_fingerprint(&before).unwrap();
        let mut handled = HandledFiles::new();
        handled.record(fingerprint, before.clone());

        let after = dir.join("b.txt");
        fs::rename(&before, &after).unwrap();
        let fingerprint_after = file_fingerprint(&after).unwrap();
        assert_eq!(fingerprint, fingerprint_after);
        assert!(!handled.is_echo(&fingerprint_after, &after));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn record_stays_bounded() {
        let mut handled = HandledFiles::new();
        for i in 0..=MAX_HANDLED + 10 {
            handled.record(
                (SystemTime::UNIX_EPOCH, i as u64),
                PathBuf::from(format!("x{i}")),
            );
        }
        assert!(handled.entries.len() <= MAX_HANDLED);
    }
}
