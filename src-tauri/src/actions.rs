use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

use thiserror::Error;

use crate::sieves::RuleAction;

const MAX_RETRIES: u32 = 5;
const RETRY_DELAY: Duration = Duration::from_millis(200);

#[derive(Debug, Error)]
pub enum ActionError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Source does not exist: {0}")]
    SourceNotFound(String),
}

impl serde::Serialize for ActionError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub fn execute(source: &Path, action: &RuleAction) -> Result<PathBuf, ActionError> {
    if !source.exists() {
        return Err(ActionError::SourceNotFound(
            source.to_string_lossy().to_string(),
        ));
    }

    match action {
        RuleAction::Move { folder } => {
            let dest = folder_path(source, folder);
            move_file(source, &dest)?;
            Ok(dest)
        }
        RuleAction::Copy { folder } => {
            let dest = folder_path(source, folder);
            retry(|| fs::copy(source, &dest).map(|_| ()))?;
            Ok(dest)
        }
        RuleAction::Rename { name } => {
            let ext = source
                .extension()
                .map(|e| format!(".{}", e.to_string_lossy()))
                .unwrap_or_default();
            let new_name = format!("{name}{ext}");
            let dest = source.with_file_name(&new_name);
            retry(|| fs::rename(source, &dest))?;
            Ok(dest)
        }
    }
}

/// Joins the source filename onto a folder path, so move/copy can only ever
/// relocate a file and never rename it.
fn folder_path(source: &Path, folder: &str) -> PathBuf {
    let mut dest = PathBuf::from(folder);
    if let Some(name) = source.file_name() {
        dest.push(name);
    }
    dest
}

/// Moves `source` to `dest`. On Windows, `fs::rename` cannot move a file
/// across disk volumes (e.g. C: -> D:), so detect that case and fall back to a
/// copy-then-delete. Both paths honor the sharing-violation retry.
fn move_file(source: &Path, dest: &Path) -> std::io::Result<()> {
    match retry(|| fs::rename(source, dest)) {
        Ok(()) => Ok(()),
        Err(e) if is_cross_device(&e) => {
            retry(|| fs::copy(source, dest).map(|_| ()))?;
            retry(|| fs::remove_file(source))?;
            Ok(())
        }
        Err(e) => Err(e),
    }
}

fn is_cross_device(err: &std::io::Error) -> bool {
    #[cfg(windows)]
    {
        err.raw_os_error() == Some(17) // ERROR_NOT_SAME_DEVICE
    }
    #[cfg(not(windows))]
    {
        err.kind() == std::io::ErrorKind::CrossesDevices
    }
}

fn retry<F>(mut op: F) -> std::io::Result<()>
where
    F: FnMut() -> std::io::Result<()>,
{
    let mut attempt = 0;
    loop {
        match op() {
            Ok(()) => return Ok(()),
            Err(e) if attempt < MAX_RETRIES && is_retryable(&e) => {
                attempt += 1;
                thread::sleep(RETRY_DELAY);
            }
            Err(e) => return Err(e),
        }
    }
}

fn is_retryable(err: &std::io::Error) -> bool {
    #[cfg(windows)]
    {
        matches!(err.kind(), std::io::ErrorKind::PermissionDenied)
            || err.raw_os_error() == Some(32) // sharing violation
            || err.raw_os_error() == Some(33) // locked
    }
    #[cfg(not(windows))]
    {
        matches!(err, e if e.kind() == std::io::ErrorKind::PermissionDenied)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("fau_test_{name}_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn move_file_to_folder() {
        let dir = temp_dir("move");
        let src = dir.join("a.txt");
        let dest_dir = dir.join("dest");
        fs::create_dir_all(&dest_dir).unwrap();
        File::create(&src).unwrap();

        let result = execute(
            &src,
            &RuleAction::Move {
                folder: dest_dir.to_string_lossy().to_string(),
            },
        );
        assert!(result.is_ok());
        assert!(result.unwrap() == dest_dir.join("a.txt"));
        assert!(!src.exists());
    }

    #[test]
    fn copy_file_to_folder() {
        let dir = temp_dir("copy");
        let src = dir.join("a.txt");
        let dest_dir = dir.join("dest");
        fs::create_dir_all(&dest_dir).unwrap();
        fs::write(&src, "hello").unwrap();

        let result = execute(
            &src,
            &RuleAction::Copy {
                folder: dest_dir.to_string_lossy().to_string(),
            },
        );
        assert!(result.is_ok());
        assert!(src.exists());
        assert!(dest_dir.join("a.txt").exists());
    }

    #[test]
    fn rename_file_without_extension() {
        let dir = temp_dir("rename");
        let src = dir.join("a.txt");
        fs::write(&src, "hello").unwrap();

        let result = execute(&src, &RuleAction::Rename { name: "new".into() });
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), dir.join("new.txt"));
        assert!(dir.join("new.txt").exists());
        assert!(!src.exists());
    }

    #[test]
    fn rename_file_keeps_extension() {
        let dir = temp_dir("rename_ext");
        let src = dir.join("photo.tar.gz");
        fs::write(&src, "hello").unwrap();

        let result = execute(&src, &RuleAction::Rename { name: "album".into() });
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), dir.join("album.gz"));
        assert!(dir.join("album.gz").exists());
    }

    #[test]
    fn actions_chain_rename_then_move() {
        let dir = temp_dir("chain_rm");
        let src = dir.join("a.txt");
        let dest_dir = dir.join("dest");
        fs::create_dir_all(&dest_dir).unwrap();
        fs::write(&src, "hello").unwrap();

        let renamed = execute(&src, &RuleAction::Rename { name: "b".into() }).unwrap();
        assert_eq!(renamed, dir.join("b.txt"));
        let moved = execute(&renamed, &RuleAction::Move {
            folder: dest_dir.to_string_lossy().to_string(),
        })
        .unwrap();
        assert_eq!(moved, dest_dir.join("b.txt"));
        assert!(dest_dir.join("b.txt").exists());
        assert!(!src.exists());
    }

    #[test]
    fn actions_chain_copy_then_rename() {
        let dir = temp_dir("chain_cr");
        let src = dir.join("a.txt");
        let dest_dir = dir.join("dest");
        fs::create_dir_all(&dest_dir).unwrap();
        fs::write(&src, "hello").unwrap();

        let copy = execute(&src, &RuleAction::Copy {
            folder: dest_dir.to_string_lossy().to_string(),
        })
        .unwrap();
        assert_eq!(copy, dest_dir.join("a.txt"));
        assert!(src.exists());

        let renamed = execute(&copy, &RuleAction::Rename { name: "b".into() }).unwrap();
        assert_eq!(renamed, dest_dir.join("b.txt"));
        assert!(dest_dir.join("b.txt").exists());
        assert!(dest_dir.join("a.txt").exists() == false);
    }

    #[test]
    fn missing_source_errors() {
        let dir = temp_dir("source_err");
        let src = dir.join("nope.txt");

        let result = execute(&src, &RuleAction::Rename { name: "x".into() });
        assert!(matches!(result, Err(ActionError::SourceNotFound(_))));
    }
}
