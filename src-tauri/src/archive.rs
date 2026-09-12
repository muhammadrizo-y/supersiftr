use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter, Write};
use std::path::Path;

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use tar;
use thiserror::Error;
use xz2::read::XzDecoder;
use xz2::write::XzEncoder;

use crate::sieves::DeleteMode;

#[derive(Debug, Error)]
pub enum ArchiveError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Zip error: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("Unsupported archive format: {0}")]
    Unsupported(String),
    #[error("Archive is password protected: {0}")]
    PasswordProtected(String),
    #[error("Recycle bin error: {0}")]
    RecycleBin(String),
}

impl serde::Serialize for ArchiveError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

/// Compresses a single file or folder into `dest` (zip or tar.*).
pub fn compress(source: &Path, dest: &Path) -> Result<(), ArchiveError> {
    let name = dest
        .file_name()
        .map(|n| n.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();

    if name.ends_with(".zip") {
        compress_zip(source, dest)
    } else if name.ends_with(".tar.gz") {
        compress_tar_gz(source, dest)
    } else if name.ends_with(".tar.bz2") {
        compress_tar_bz2(source, dest)
    } else if name.ends_with(".tar.xz") {
        compress_tar_xz(source, dest)
    } else if name.ends_with(".tar") {
        compress_tar(source, dest)
    } else {
        Err(ArchiveError::Unsupported(
            dest.to_string_lossy().to_string(),
        ))
    }
}

/// Extracts `source` into `dest_dir` (created if missing). Zip and tar.*
/// only; password-protected zips are rejected.
pub fn extract(source: &Path, dest_dir: &Path) -> Result<(), ArchiveError> {
    let name = source
        .file_name()
        .map(|n| n.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    fs::create_dir_all(dest_dir)?;

    if name.ends_with(".zip") {
        extract_zip(source, dest_dir)
    } else if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
        extract_tar(source, dest_dir, |f| Box::new(GzDecoder::new(f)))
    } else if name.ends_with(".tar.bz2") {
        extract_tar(source, dest_dir, |f| Box::new(bzip2::read::BzDecoder::new(f)))
    } else if name.ends_with(".tar.xz") || name.ends_with(".txz") {
        extract_tar(source, dest_dir, |f| Box::new(XzDecoder::new(f)))
    } else if name.ends_with(".tar") {
        extract_tar(source, dest_dir, |f| Box::new(f))
    } else {
        Err(ArchiveError::Unsupported(
            source.to_string_lossy().to_string(),
        ))
    }
}

fn compress_zip(source: &Path, dest: &Path) -> Result<(), ArchiveError> {
    let file = File::create(dest)?;
    let mut zip = zip::ZipWriter::new(BufWriter::new(file));
    let options: zip::write::SimpleFileOptions =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let root = source.file_name().unwrap_or_default().to_string_lossy().to_string();
    add_to_zip(&mut zip, source, &root, options)?;
    zip.finish()?.flush()?;
    Ok(())
}

fn add_to_zip<W: io::Write + io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    path: &Path,
    arc_name: &str,
    options: zip::write::SimpleFileOptions,
) -> Result<(), ArchiveError> {
    if path.is_dir() {
        let dir_options = options.unix_permissions(0o755);
        zip.add_directory(arc_name, dir_options)?;
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let child_name = format!("{arc_name}/{}", entry.file_name().to_string_lossy());
            add_to_zip(zip, &entry.path(), &child_name, options)?;
        }
        Ok(())
    } else {
        zip.start_file(arc_name, options)?;
        io::copy(&mut File::open(path)?, zip)?;
        Ok(())
    }
}

fn compress_tar(source: &Path, dest: &Path) -> Result<(), ArchiveError> {
    let file = File::create(dest)?;
    let mut tar = tar::Builder::new(BufWriter::new(file));
    let root = source.file_name().unwrap_or_default().to_string_lossy().to_string();
    append_to_tar(&mut tar, source, &root)?;
    tar.finish()?;
    Ok(())
}

fn compress_tar_gz(source: &Path, dest: &Path) -> Result<(), ArchiveError> {
    let file = File::create(dest)?;
    let enc = GzEncoder::new(BufWriter::new(file), flate2::Compression::default());
    write_tar(source, enc, |w| w.finish().map(|_| ()))
}

fn compress_tar_bz2(source: &Path, dest: &Path) -> Result<(), ArchiveError> {
    let file = File::create(dest)?;
    let enc = bzip2::write::BzEncoder::new(BufWriter::new(file), bzip2::Compression::default());
    write_tar(source, enc, |w| w.finish().map(|_| ()))
}

fn compress_tar_xz(source: &Path, dest: &Path) -> Result<(), ArchiveError> {
    let file = File::create(dest)?;
    let enc = XzEncoder::new(BufWriter::new(file), 6);
    write_tar(source, enc, |w| w.finish().map(|_| ()))
}

fn write_tar<W: io::Write, F>(
    source: &Path,
    enc: W,
    finish_encoder: F,
) -> Result<(), ArchiveError>
where
    F: FnOnce(W) -> io::Result<()>,
{
    let mut tar = tar::Builder::new(enc);
    let root = source.file_name().unwrap_or_default().to_string_lossy().to_string();
    append_to_tar(&mut tar, source, &root)?;
    tar.finish()?;
    finish_encoder(tar.into_inner()?)?;
    Ok(())
}

/// Recursively adds `path` to the tar as `arc_name`; directories expand into
/// entries containing their full contents.
fn append_to_tar<W: io::Write>(
    tar: &mut tar::Builder<W>,
    path: &Path,
    arc_name: &str,
) -> io::Result<()> {
    if path.is_dir() {
        tar.append_dir(arc_name, path)?;
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let child = format!("{arc_name}/{}", entry.file_name().to_string_lossy());
            append_to_tar(tar, &entry.path(), &child)?;
        }
    } else {
        tar.append_file(arc_name, &mut File::open(path)?)?;
    }
    Ok(())
}

fn extract_zip(source: &Path, dest_dir: &Path) -> Result<(), ArchiveError> {
    let file = File::open(source)?;
    let mut zip = zip::ZipArchive::new(BufReader::new(file))?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i)?;
        let Some(enclosed_name) = entry.enclosed_name() else {
            // Path traversal (e.g. `..\evil`) — skip rather than fail the
            // whole extraction.
            continue;
        };
        let out_path = dest_dir.join(enclosed_name);
        if entry.is_dir() {
            fs::create_dir_all(&out_path)?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut out = File::create(&out_path)?;
            io::copy(&mut entry, &mut out)?;
        }
    }
    Ok(())
}

fn extract_tar<F>(source: &Path, dest_dir: &Path, decode: F) -> Result<(), ArchiveError>
where
    F: for<'a> Fn(Box<dyn io::Read + 'a>) -> Box<dyn io::Read + 'a>,
{
    let file = File::open(source)?;
    let reader = decode(Box::new(BufReader::new(file)));
    let mut tar = tar::Archive::new(reader);
    // `unpack` refuses entries with `..`/absolute paths by default.
    tar.unpack(dest_dir)?;
    Ok(())
}

/// Deletes the source archive according to the user's chosen mode.
pub fn delete_source(source: &Path, mode: DeleteMode) -> Result<(), ArchiveError> {
    match mode {
        DeleteMode::Recycle => {
            trash::delete(source).map_err(|e| ArchiveError::RecycleBin(e.to_string()))
        }
        DeleteMode::Permanent => {
            if source.is_dir() {
                fs::remove_dir_all(source)?;
            } else {
                fs::remove_file(source)?;
            }
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::collections::HashSet;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("supersiftr_arc_{name}_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn list(dir: &Path) -> HashSet<String> {
        let mut out = HashSet::new();
        fn walk(dir: &Path, base: &Path, out: &mut HashSet<String>) {
            for entry in fs::read_dir(dir).unwrap() {
                let entry = entry.unwrap();
                let rel = entry.path().strip_prefix(base).unwrap().to_path_buf();
                if entry.path().is_dir() {
                    walk(&entry.path(), base, out);
                } else {
                    out.insert(rel.to_string_lossy().replace('\\', "/"));
                }
            }
        }
        walk(dir, dir, &mut out);
        out
    }

    #[test]
    fn zip_roundtrip_file() {
        let dir = temp_dir("zip_file");
        let src = dir.join("a.txt");
        fs::write(&src, "hello").unwrap();
        let arc = dir.join("a.zip");

        compress(&src, &arc).unwrap();
        assert!(arc.exists());

        let out = dir.join("out");
        extract(&arc, &out).unwrap();
        assert_eq!(list(&out), HashSet::from(["a.txt".to_string()]));
        assert_eq!(fs::read_to_string(out.join("a.txt")).unwrap(), "hello");
    }

    #[test]
    fn zip_roundtrip_folder() {
        let dir = temp_dir("zip_dir");
        let src = dir.join("proj");
        fs::create_dir_all(src.join("sub")).unwrap();
        fs::write(src.join("a.txt"), "one").unwrap();
        fs::write(src.join("sub").join("b.txt"), "two").unwrap();
        let arc = dir.join("proj.zip");

        compress(&src, &arc).unwrap();
        let out = dir.join("out");
        extract(&arc, &out).unwrap();
        assert_eq!(
            list(&out),
            HashSet::from(["proj/a.txt".to_string(), "proj/sub/b.txt".to_string()])
        );
    }

    #[test]
    fn tar_roundtrip_all_compressions() {
        for (name, make, extract_fn) in [
            ("t.tar", 1, 0),
            ("t.tar.gz", 2, 1),
            ("t.tar.bz2", 3, 2),
            ("t.tar.xz", 4, 3),
        ] {
            let dir = temp_dir(&format!("tar_{name}"));
            let src = dir.join("doc.txt");
            fs::write(&src, format!("content-{name}")).unwrap();
            let arc = dir.join(name);

            match make {
                1 => compress_tar(&src, &arc).unwrap(),
                2 => compress_tar_gz(&src, &arc).unwrap(),
                3 => compress_tar_bz2(&src, &arc).unwrap(),
                _ => compress_tar_xz(&src, &arc).unwrap(),
            }
            assert!(arc.exists(), "{name}: compress");

            let out = dir.join("out");
            match extract_fn {
                0 => extract_tar(&arc, &out, |f| Box::new(f)).unwrap(),
                1 => extract_tar(&arc, &out, |f| Box::new(GzDecoder::new(f))).unwrap(),
                2 => extract_tar(&arc, &out, |f| Box::new(bzip2::read::BzDecoder::new(f))).unwrap(),
                _ => extract_tar(&arc, &out, |f| Box::new(XzDecoder::new(f))).unwrap(),
            }
            assert_eq!(
                fs::read_to_string(out.join("doc.txt")).unwrap(),
                format!("content-{name}"),
                "{name}: roundtrip"
            );
        }
    }

    #[test]
    fn tar_gz_roundtrip_folder_recurses() {
        let dir = temp_dir("tar_gz_dir");
        let src = dir.join("proj");
        fs::create_dir_all(src.join("sub")).unwrap();
        fs::write(src.join("a.txt"), "one").unwrap();
        fs::write(src.join("sub").join("b.txt"), "two").unwrap();
        let arc = dir.join("proj.tar.gz");

        compress(&src, &arc).unwrap();
        let out = dir.join("out");
        extract(&arc, &out).unwrap();
        assert_eq!(
            list(&out),
            HashSet::from(["proj/a.txt".to_string(), "proj/sub/b.txt".to_string()])
        );
    }

    #[test]
    fn unsupported_format_errors() {
        let dir = temp_dir("unsupported");
        let src = dir.join("a.txt");
        fs::write(&src, "hello").unwrap();
        assert!(compress(&src, &dir.join("a.7z")).is_err());
        assert!(extract(&dir.join("a.rar"), &dir.join("out")).is_err());
    }

    #[test]
    fn zip_traversal_entries_are_skipped() {
        let dir = temp_dir("zip_trav");
        // Build a zip with a `../escape.txt` entry.
        let arc_path = dir.join("evil.zip");
        {
            let file = File::create(&arc_path).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            zip.start_file("../escape.txt", zip::write::SimpleFileOptions::default()).unwrap();
            io::Write::write_all(&mut zip, b"boom").unwrap();
            zip.finish().unwrap();
        }
        let out = dir.join("out");
        extract(&arc_path, &out).unwrap();
        assert!(!dir.join("escape.txt").exists());
        assert!(!out.join("escape.txt").exists());
    }
}
