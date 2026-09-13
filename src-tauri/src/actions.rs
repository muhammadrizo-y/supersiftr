use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

use thiserror::Error;

use crate::archive;
use crate::kinds::Kind;
use crate::sieves::{DeleteMode, ExtractSourceMode, RuleAction, SortKey};
use crate::compound_extensions;

const MAX_RETRIES: u32 = 5;
const RETRY_DELAY: Duration = Duration::from_millis(200);

/// Catch-all subfolder for items a sort-into-subfolder action can't classify:
/// extensionless files and files matching no enabled kind. Bracketed so it
/// can never collide with a real extension or kind name.
const MISC_FOLDER: &str = "[misc]";

/// Strips characters a Windows folder name can't contain and trailing dots or
/// spaces, falling back to `fallback` when nothing valid remains (an all-
/// illegal title, e.g. one that is only "?:").
fn sanitize_folder_name(input: &str, fallback: &str) -> String {
    let mut out: String = input
        .chars()
        .filter(|c| !matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') && *c as u32 >= 32)
        .collect();
    while out.ends_with('.') || out.ends_with(' ') {
        out.pop();
    }
    if out.is_empty() { fallback.to_string() } else { out }
}

#[derive(Debug, Error)]
pub enum ActionError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Source does not exist: {0}")]
    SourceNotFound(String),
    #[error("Recycle bin error: {0}")]
    RecycleBin(String),
    #[error("Archive error: {0}")]
    Archive(#[from] crate::archive::ArchiveError),
}

impl serde::Serialize for ActionError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub fn execute(
    source: &Path,
    action: &RuleAction,
    custom_extensions: &[String],
    kinds: &[Kind],
) -> Result<PathBuf, ActionError> {
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
            let file_name = source
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let (base_name, extension) = compound_extensions::split(&file_name, custom_extensions);
            // `{name}` interpolates the original base name (extension stripped)
            // so a template like "{name}_backup" keeps the file distinct; a
            // plain literal stays a full name replacement.
            let resolved_name = name.replace("{name}", &base_name);
            let new_name = format!("{resolved_name}{extension}");
            let dest = source.with_file_name(&new_name);
            retry(|| fs::rename(source, &dest))?;
            Ok(dest)
        }
        RuleAction::SortInto { folder, by } => {
            let file_name = source
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let key = match by {
                SortKey::Extension => {
                    let (_, extension) = compound_extensions::split(&file_name, custom_extensions);
                    let ext = extension.trim_start_matches('.');
                    if ext.is_empty() {
                        MISC_FOLDER.to_string()
                    } else {
                        ext.to_ascii_lowercase()
                    }
                }
                SortKey::Kind => match crate::sieves::matching_kind(&file_name, kinds) {
                    Some(kind) => sanitize_folder_name(&kind.title, &kind.name),
                    None => MISC_FOLDER.to_string(),
                },
            };
            let dest_dir = PathBuf::from(folder).join(key);
            fs::create_dir_all(&dest_dir)?;
            let dest = dest_dir.join(&file_name);
            move_file(source, &dest)?;
            Ok(dest)
        }
        RuleAction::Compress {
            format,
            source: source_mode,
        } => {
            let file_name = source
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let (base, _) = compound_extensions::split(&file_name, custom_extensions);
            let dest = source.with_file_name(format!("{base}.{format}"));
            archive::compress(source, &dest)?;
            match source_mode {
                ExtractSourceMode::Keep => {}
                ExtractSourceMode::Recycle => {
                    archive::delete_source(source, DeleteMode::Recycle)?
                }
                ExtractSourceMode::Delete => {
                    archive::delete_source(source, DeleteMode::Permanent)?
                }
            }
            Ok(dest)
        }
        RuleAction::Extract { source: source_mode } => {
            let stem = source
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            // Always extract into a folder named after the archive so the
            // contents can't spray into the watched folder and re-trigger
            // sieves per file.
            let dest_dir = source.with_file_name(&stem);
            archive::extract(source, &dest_dir)?;
            match source_mode {
                ExtractSourceMode::Keep => {}
                ExtractSourceMode::Recycle => {
                    archive::delete_source(source, DeleteMode::Recycle)?
                }
                ExtractSourceMode::Delete => {
                    archive::delete_source(source, DeleteMode::Permanent)?
                }
            }
            Ok(dest_dir)
        }
        RuleAction::Delete { mode } => {
            match mode {
                DeleteMode::Recycle => {
                    trash::delete(source).map_err(|e| ActionError::RecycleBin(e.to_string()))?
                }
                DeleteMode::Permanent => retry(|| fs::remove_file(source))?,
            }
            Ok(source.to_path_buf())
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
        err.kind() == std::io::ErrorKind::PermissionDenied
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sieves::ArchiveFormat;
    use std::io::Write;
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

        let result = execute(&src,
            &RuleAction::Move {
                folder: dest_dir.to_string_lossy().to_string(),
            },
            &[], &[]);
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

        let result = execute(&src,
            &RuleAction::Copy {
                folder: dest_dir.to_string_lossy().to_string(),
            },
            &[], &[]);
        assert!(result.is_ok());
        assert!(src.exists());
        assert!(dest_dir.join("a.txt").exists());
    }

    #[test]
    fn rename_file_without_extension() {
        let dir = temp_dir("rename");
        let src = dir.join("a.txt");
        fs::write(&src, "hello").unwrap();

        let result = execute(&src, &RuleAction::Rename { name: "new".into() }, &[], &[]);
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

        let result = execute(&src, &RuleAction::Rename { name: "album".into() }, &[], &[]);
        // .tar.gz is a recognized compound extension, so the full extension is kept.
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), dir.join("album.tar.gz"));
        assert!(dir.join("album.tar.gz").exists());
    }

    #[test]
    fn rename_interpolates_original_name() {
        let dir = temp_dir("rename_interp");
        let src = dir.join("a.txt");
        fs::write(&src, "hello").unwrap();

        let result = execute(&src, &RuleAction::Rename { name: "{name}_copy".into() }, &[], &[]);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), dir.join("a_copy.txt"));
        assert!(dir.join("a_copy.txt").exists());
        assert!(!src.exists());
    }

    #[test]
    fn rename_name_alone_keeps_original_base() {
        let dir = temp_dir("rename_name_only");
        let src = dir.join("a.txt");
        fs::write(&src, "hello").unwrap();

        let result = execute(&src, &RuleAction::Rename { name: "{name}".into() }, &[], &[]);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), dir.join("a.txt"));
        assert!(dir.join("a.txt").exists());
    }

    #[test]
    fn rename_dotfile_without_extension() {
        let dir = temp_dir("rename_dot");
        let src = dir.join(".env");
        fs::write(&src, "x=1").unwrap();

        let result = execute(&src, &RuleAction::Rename { name: "config".into() }, &[], &[]);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), dir.join("config"));
        assert!(dir.join("config").exists());
        assert!(!src.exists());
    }

    #[test]
    fn rename_dotfile_keeps_extension() {
        let dir = temp_dir("rename_dot_ext");
        let src = dir.join(".example.env");
        fs::write(&src, "x=1").unwrap();

        let result = execute(&src, &RuleAction::Rename { name: "config".into() }, &[], &[]);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), dir.join("config.env"));
        assert!(dir.join("config.env").exists());
        assert!(!src.exists());
    }

    #[test]
    fn rename_prefix_keeps_compound_extension() {
        let dir = temp_dir("rename_prefix");
        let src = dir.join("photo.tar.gz");
        fs::write(&src, "hello").unwrap();

        let result = execute(&src, &RuleAction::Rename { name: "archive-{name}".into() }, &[], &[]);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), dir.join("archive-photo.tar.gz"));
        assert!(dir.join("archive-photo.tar.gz").exists());
    }

    #[test]
    fn rename_preserves_custom_compound_extension() {
        let dir = temp_dir("rename_custom");
        let src = dir.join("index.test.ts");
        fs::write(&src, "hello").unwrap();

        let result = execute(&src, &RuleAction::Rename { name: "router".into() }, &[".test.ts".into()], &[]);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), dir.join("router.test.ts"));
        assert!(dir.join("router.test.ts").exists());
    }

    #[test]
    fn rename_drops_unrecognized_intermediate_extension() {
        let dir = temp_dir("rename_other");
        let src = dir.join("report.final.pdf");
        fs::write(&src, "hello").unwrap();

        // .pdf is the only recognized extension here; .final is part of the name.
        let result = execute(&src, &RuleAction::Rename { name: "final".into() }, &[], &[]);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), dir.join("final.pdf"));
        assert!(dir.join("final.pdf").exists());
    }

    #[test]
    fn actions_chain_rename_then_move() {
        let dir = temp_dir("chain_rm");
        let src = dir.join("a.txt");
        let dest_dir = dir.join("dest");
        fs::create_dir_all(&dest_dir).unwrap();
        fs::write(&src, "hello").unwrap();

        let renamed = execute(&src, &RuleAction::Rename { name: "b".into() }, &[], &[]).unwrap();
        assert_eq!(renamed, dir.join("b.txt"));
        let moved = execute(&renamed, &RuleAction::Move {
            folder: dest_dir.to_string_lossy().to_string(),
        }, &[], &[])
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
        }, &[], &[])
        .unwrap();
        assert_eq!(copy, dest_dir.join("a.txt"));
        assert!(src.exists());

        let renamed = execute(&copy, &RuleAction::Rename { name: "b".into() }, &[], &[]).unwrap();
        assert_eq!(renamed, dest_dir.join("b.txt"));
        assert!(dest_dir.join("b.txt").exists());
        assert!(dest_dir.join("a.txt").exists() == false);
    }

    #[test]
    fn sort_into_subfolder_by_extension() {
        let dir = temp_dir("sort_ext");
        let src = dir.join("photo.tar.gz");
        fs::write(&src, "hello").unwrap();

        let result = execute(
            &src,
            &RuleAction::SortInto {
                folder: dir.to_string_lossy().to_string(),
                by: SortKey::Extension,
            },
            &[],
            &[],
        );
        assert!(result.is_ok());
        let dest = dir.join("tar.gz").join("photo.tar.gz");
        assert_eq!(result.unwrap(), dest);
        assert!(dest.exists());
        assert!(!src.exists());
    }

    #[test]
    fn sort_into_subfolder_keeps_extension_lowercase() {
        let dir = temp_dir("sort_ext_lower");
        let src = dir.join("PHOTO.TAR.GZ");
        fs::write(&src, "hello").unwrap();

        let result = execute(
            &src,
            &RuleAction::SortInto {
                folder: dir.to_string_lossy().to_string(),
                by: SortKey::Extension,
            },
            &[],
            &[],
        );
        assert!(result.is_ok());
        let dest = dir.join("tar.gz").join("PHOTO.TAR.GZ");
        assert_eq!(result.unwrap(), dest);
        assert!(dest.exists());
    }

    #[test]
    fn sort_into_sanitizes_kind_subfolder() {
        let dir = temp_dir("sort_sanitize");
        let kinds = vec![
            crate::kinds::Kind {
                name: "movie".into(),
                title: "Movie: Final Cut?".into(),
                extensions: vec!["mp4".into()],
                enabled: true,
                is_default: false,
            },
            crate::kinds::Kind {
                name: "docs".into(),
                title: ">>".into(),
                extensions: vec!["txt".into()],
                enabled: true,
                is_default: false,
            },
        ];

        let clip = dir.join("clip.mp4");
        fs::write(&clip, "hello").unwrap();
        let result = execute(
            &clip,
            &RuleAction::SortInto {
                folder: dir.to_string_lossy().to_string(),
                by: SortKey::Kind,
            },
            &[],
            &kinds,
        );
        assert_eq!(result.unwrap(), dir.join("Movie Final Cut").join("clip.mp4"));

        let notes = dir.join("notes.txt");
        fs::write(&notes, "hello").unwrap();
        let result = execute(
            &notes,
            &RuleAction::SortInto {
                folder: dir.to_string_lossy().to_string(),
                by: SortKey::Kind,
            },
            &[],
            &kinds,
        );
        // ">>" strips to nothing, so the slug name is used instead.
        assert_eq!(result.unwrap(), dir.join("docs").join("notes.txt"));
    }

    #[test]
    fn sort_into_subfolder_by_kind_falls_back_to_misc() {
        let dir = temp_dir("sort_kind");
        let src = dir.join("notes.txt");
        fs::write(&src, "hello").unwrap();

        let result = execute(
            &src,
            &RuleAction::SortInto {
                folder: dir.to_string_lossy().to_string(),
                by: SortKey::Kind,
            },
            &[],
            &[],
        );
        assert!(result.is_ok());
        let dest = dir.join("[misc]").join("notes.txt");
        assert_eq!(result.unwrap(), dest);
        assert!(dest.exists());
    }

    #[test]
    fn sort_into_subfolder_by_kind_uses_matching_kind() {
        let dir = temp_dir("sort_kind_hit");
        let src = dir.join("clip.mp4");
        fs::write(&src, "hello").unwrap();
        let kinds = vec![crate::kinds::Kind {
            name: "movie".into(),
            title: "Movie".into(),
            extensions: vec!["mp4".into()],
            enabled: true,
            is_default: false,
        }];

        let result = execute(
            &src,
            &RuleAction::SortInto {
                folder: dir.to_string_lossy().to_string(),
                by: SortKey::Kind,
            },
            &[],
            &kinds,
        );
        assert!(result.is_ok());
        let dest = dir.join("Movie").join("clip.mp4");
        assert_eq!(result.unwrap(), dest);
        assert!(dest.exists());
    }

    #[test]
    fn sort_into_subfolder_extensionless_goes_to_misc() {
        let dir = temp_dir("sort_noext");
        let src = dir.join("README");
        fs::write(&src, "hello").unwrap();

        let result = execute(
            &src,
            &RuleAction::SortInto {
                folder: dir.to_string_lossy().to_string(),
                by: SortKey::Extension,
            },
            &[],
            &[],
        );
        assert!(result.is_ok());
        let dest = dir.join("[misc]").join("README");
        assert_eq!(result.unwrap(), dest);
        assert!(dest.exists());
        assert!(!src.exists());
    }

    #[test]
    fn compress_creates_zip_next_to_source() {
        let dir = temp_dir("compress_zip");
        let src = dir.join("report.pdf");
        fs::write(&src, "hello").unwrap();

        let result = execute(
            &src,
            &RuleAction::Compress {
                format: ArchiveFormat::Zip,
                source: ExtractSourceMode::Keep,
            },
            &[],
            &[],
        );
        assert!(result.is_ok());
        let dest = dir.join("report.zip");
        assert_eq!(result.unwrap(), dest);
        assert!(dest.exists());
        assert!(src.exists());
    }

    #[test]
    fn compress_tar_gz_strips_compound_extension() {
        let dir = temp_dir("compress_tgz");
        let src = dir.join("backup.tar");
        fs::write(&src, "hello").unwrap();

        let result = execute(
            &src,
            &RuleAction::Compress {
                format: ArchiveFormat::TarGz,
                source: ExtractSourceMode::Keep,
            },
            &[],
            &[],
        );
        assert!(result.is_ok());
        let dest = dir.join("backup.tar.gz");
        assert_eq!(result.unwrap(), dest);
        assert!(dest.exists());
    }

    #[test]
    fn extract_creates_folder_and_keeps_source() {
        let dir = temp_dir("extract_keep");
        let src = dir.join("bundle.zip");
        {
            let file = File::create(&src).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            zip.start_file("inner/a.txt", zip::write::SimpleFileOptions::default()).unwrap();
            Write::write_all(&mut zip, b"data").unwrap();
            zip.finish().unwrap();
        }

        let result = execute(
            &src,
            &RuleAction::Extract {
                source: ExtractSourceMode::Keep,
            },
            &[],
            &[],
        );
        assert!(result.is_ok());
        let dest_dir = dir.join("bundle");
        assert_eq!(result.unwrap(), dest_dir);
        assert!(dest_dir.join("inner").join("a.txt").exists());
        assert!(src.exists());
    }

    #[test]
    fn extract_can_recycle_source() {
        let dir = temp_dir("extract_recycle");
        let src = dir.join("bundle.zip");
        {
            let file = File::create(&src).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            zip.start_file("a.txt", zip::write::SimpleFileOptions::default()).unwrap();
            Write::write_all(&mut zip, b"data").unwrap();
            zip.finish().unwrap();
        }

        let result = execute(
            &src,
            &RuleAction::Extract {
                source: ExtractSourceMode::Recycle,
            },
            &[],
            &[],
        );
        assert!(result.is_ok());
        assert!(!src.exists());
        assert!(dir.join("bundle").join("a.txt").exists());
    }

    #[test]
    fn missing_source_errors() {
        let dir = temp_dir("source_err");
        let src = dir.join("nope.txt");

        let result = execute(&src, &RuleAction::Rename { name: "x".into() }, &[], &[]);
        assert!(matches!(result, Err(ActionError::SourceNotFound(_))));
    }

    #[test]
    fn delete_permanent_removes_file() {
        let dir = temp_dir("delete");
        let src = dir.join("a.txt");
        fs::write(&src, "hello").unwrap();

        let result = execute(&src,
            &RuleAction::Delete {
                mode: DeleteMode::Permanent,
            },
            &[], &[]);
        assert!(result.is_ok());
        assert!(!src.exists());
    }
}
