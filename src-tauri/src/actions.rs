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
    #[error("Rename pattern missing placeholder `{{name}}`")]
    MissingPlaceholder,
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
        RuleAction::Move { destination } => {
            let dest = resolve_destination(source, destination);
            move_file(source, &dest)?;
            Ok(dest)
        }
        RuleAction::Copy { destination } => {
            let dest = resolve_destination(source, destination);
            retry(|| fs::copy(source, &dest).map(|_| ()))?;
            Ok(dest)
        }
        RuleAction::Rename { pattern } => {
            let file_name = source
                .file_name()
                .and_then(|n| n.to_str())
                .ok_or_else(|| ActionError::Io(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "source has no valid file name",
                )))?;
            if !pattern.contains("{name}") {
                return Err(ActionError::MissingPlaceholder);
            }
            let new_name = pattern.replace("{name}", file_name);
            let dest = source.with_file_name(new_name);
            retry(|| fs::rename(source, &dest))?;
            Ok(dest)
        }
    }
}

fn resolve_destination(source: &Path, destination: &str) -> PathBuf {
    let mut dest = PathBuf::from(destination);
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
    fn move_file_to_destination() {
        let dir = temp_dir("move");
        let src = dir.join("a.txt");
        let dest_dir = dir.join("dest");
        fs::create_dir_all(&dest_dir).unwrap();
        File::create(&src).unwrap();

        let result = execute(
            &src,
            &RuleAction::Move {
                destination: dest_dir.to_string_lossy().to_string(),
            },
        );
        assert!(result.is_ok());
        assert!(result.unwrap() == dest_dir.join("a.txt"));
        assert!(!src.exists());
    }

    #[test]
    fn copy_file_to_destination() {
        let dir = temp_dir("copy");
        let src = dir.join("a.txt");
        let dest_dir = dir.join("dest");
        fs::create_dir_all(&dest_dir).unwrap();
        fs::write(&src, "hello").unwrap();

        let result = execute(
            &src,
            &RuleAction::Copy {
                destination: dest_dir.to_string_lossy().to_string(),
            },
        );
        assert!(result.is_ok());
        assert!(src.exists());
        assert!(dest_dir.join("a.txt").exists());
    }

    #[test]
    fn rename_file_with_placeholder() {
        let dir = temp_dir("rename");
        let src = dir.join("a.txt");
        fs::write(&src, "hello").unwrap();

        let result = execute(&src, &RuleAction::Rename { pattern: "new_{name}".into() });
        assert!(result.is_ok());
        assert!(dir.join("new_a.txt").exists());
        assert!(!src.exists());
    }

    #[test]
    fn missing_placeholder_errors() {
        let dir = temp_dir("rename_err");
        let src = dir.join("a.txt");
        fs::write(&src, "hello").unwrap();

        let result = execute(&src, &RuleAction::Rename { pattern: "fixed".into() });
        assert!(matches!(result, Err(ActionError::MissingPlaceholder)));
    }
}
