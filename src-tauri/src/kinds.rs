use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::config::config_dir;

#[derive(Debug, Error)]
pub enum KindError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Invalid kinds JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Config error: {0}")]
    Config(#[from] crate::config::ConfigError),
    #[error("A kind with this name already exists")]
    Duplicate,
    #[error("No kind with this name exists")]
    NotFound,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Kind {
    /// Stable identifier (e.g. "movie"). Rules/sieves reference kinds by this
    /// id; renaming `title` does not break references.
    pub name: String,
    /// Human-friendly display name (e.g. "Movie").
    pub title: String,
    #[serde(default)]
    pub extensions: Vec<String>,
    /// Whether the kind is active. Disabled kinds neither match nor contribute
    /// extensions in sieve conditions.
    #[serde(default)]
    pub enabled: bool,
    /// Built-in kind backed by `default_kinds.json`: can't be deleted, but can
    /// be edited and reset to its shipped defaults.
    #[serde(default)]
    pub is_default: bool,
}

/// Current schema version of `kinds.json`. Bump only when the kind store
/// shape breaks; independent of config/sieves versions.
const KINDS_SCHEMA_VERSION: u32 = 1;

/// Current schema version of `default_kinds.json`. Bump only when that file's
/// shape breaks.
const DEFAULT_KINDS_SCHEMA_VERSION: u32 = 1;

/// The built-in kinds shipped with the app. Materialized into
/// `default_kinds.json` on first run; `Reset` restores a kind from there.
fn default_kinds() -> Vec<Kind> {
    vec![
        Kind {
            name: "movie".into(),
            title: "Movie".into(),
            extensions: vec![
                "mp4", "mkv", "mov", "avi", "wmv", "m4v", "webm", "flv", "mpg", "mpeg",
            ]
            .into_iter()
            .map(String::from)
            .collect(),
            enabled: true,
            is_default: true,
        },
        Kind {
            name: "image".into(),
            title: "Image".into(),
            extensions: vec![
                "jpg", "jpeg", "png", "gif", "bmp", "webp", "tiff", "svg", "heic",
            ]
            .into_iter()
            .map(String::from)
            .collect(),
            enabled: true,
            is_default: true,
        },
        Kind {
            name: "audio".into(),
            title: "Audio".into(),
            extensions: vec![
                "mp3", "wav", "flac", "aac", "ogg", "m4a", "wma", "opus",
            ]
            .into_iter()
            .map(String::from)
            .collect(),
            enabled: true,
            is_default: true,
        },
        Kind {
            name: "document".into(),
            title: "Document".into(),
            extensions: vec![
                "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "odt",
                "md",
            ]
            .into_iter()
            .map(String::from)
            .collect(),
            enabled: true,
            is_default: true,
        },
        Kind {
            name: "archive".into(),
            title: "Archive".into(),
            extensions: vec!["zip", "rar", "7z", "tar", "tar.gz", "gz", "bz2", "xz"]
                .into_iter()
                .map(String::from)
                .collect(),
            enabled: true,
            is_default: true,
        },
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct KindStore {
    pub schema_version: u32,
    pub kinds: Vec<Kind>,
}

impl Default for KindStore {
    fn default() -> Self {
        Self {
            schema_version: KINDS_SCHEMA_VERSION,
            kinds: default_kinds(),
        }
    }
}

/// The shipped default kinds "Reset" restores from. Written to disk on first
/// run so it has an explicit schema_version like every other JSON file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct DefaultKindStore {
    pub schema_version: u32,
    pub kinds: Vec<Kind>,
}

impl Default for DefaultKindStore {
    fn default() -> Self {
        Self {
            schema_version: DEFAULT_KINDS_SCHEMA_VERSION,
            kinds: default_kinds(),
        }
    }
}

/// Normalize a title into a kebab-case id: lowercase, spaces/underscores to
/// hyphens, non-alphanumeric (except hyphen) dropped, leading/trailing hyphens
/// trimmed. Returns `None` when nothing remains (e.g. all-symbol input).
pub fn slugify(input: &str) -> Option<String> {
    let mut out = String::with_capacity(input.len());
    let mut last_was_sep = false;
    for c in input.trim().chars() {
        if c.is_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            last_was_sep = false;
        } else if !last_was_sep {
            out.push('-');
            last_was_sep = true;
        }
    }
    let trimmed = out.trim_matches('-');
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Return a unique id derived from `base`, appending `-2`, `-3`, … when the
/// base (or a previous suffix) is already taken by an existing kind.
pub fn unique_name(base: &str, existing: &[Kind]) -> String {
    if !existing.iter().any(|k| k.name == base) {
        return base.to_string();
    }
    let mut n = 2;
    loop {
        let candidate = format!("{base}-{n}");
        if !existing.iter().any(|k| k.name == candidate) {
            return candidate;
        }
        n += 1;
    }
}

pub fn kinds_path() -> Result<PathBuf, KindError> {
    Ok(config_dir()?.join("kinds.json"))
}

pub fn default_kinds_path() -> Result<PathBuf, KindError> {
    Ok(config_dir()?.join("default_kinds.json"))
}

/// The shipped default kinds, materializing `default_kinds.json` on first run.
pub fn load_defaults() -> Result<Vec<Kind>, KindError> {
    let path = default_kinds_path()?;
    if !path.exists() {
        let store = DefaultKindStore::default();
        let contents = serde_json::to_string_pretty(&store)?;
        fs::write(path, contents)?;
        return Ok(store.kinds);
    }
    let contents = fs::read_to_string(path)?;
    let store: DefaultKindStore = serde_json::from_str(&contents)?;
    Ok(store.kinds)
}

pub fn load() -> Result<KindStore, KindError> {
    let defaults = load_defaults()?;
    let path = kinds_path()?;
    if !path.exists() {
        let store = KindStore {
            schema_version: KINDS_SCHEMA_VERSION,
            kinds: defaults,
        };
        let _ = save(&store);
        return Ok(store);
    }
    let contents = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&contents)?)
}

pub fn save(store: &KindStore) -> Result<(), KindError> {
    let path = kinds_path()?;
    let contents = serde_json::to_string_pretty(store)?;
    fs::write(path, contents)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_normalizes_titles() {
        assert_eq!(slugify("Movie").as_deref(), Some("movie"));
        assert_eq!(slugify("My Movie").as_deref(), Some("my-movie"));
        assert_eq!(slugify("  Screenshots  ").as_deref(), Some("screenshots"));
        assert_eq!(slugify("C++ Files").as_deref(), Some("c-files"));
        assert_eq!(slugify("!!!").as_deref(), None);
    }

    #[test]
    fn unique_name_appends_suffix_on_collision() {
        let kinds = vec![
            Kind {
                name: "movie".into(),
                title: "Movie".into(),
                extensions: vec![],
                enabled: true,
                is_default: true,
            },
            Kind {
                name: "movie-2".into(),
                title: "Movie 2".into(),
                extensions: vec![],
                enabled: true,
                is_default: false,
            },
        ];
        assert_eq!(unique_name("movie", &kinds), "movie-3");
        assert_eq!(unique_name("image", &kinds), "image");
    }

    #[test]
    fn defaults_are_unique() {
        let store = KindStore::default();
        let mut names: Vec<&str> = store.kinds.iter().map(|p| p.name.as_str()).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), store.kinds.len());
        assert_eq!(store.schema_version, KINDS_SCHEMA_VERSION);
    }

    #[test]
    fn default_kinds_are_marked_default_and_enabled() {
        let kinds = default_kinds();
        assert!(!kinds.is_empty());
        assert!(kinds.iter().all(|p| p.is_default && p.enabled));
    }

    #[test]
    fn default_kind_store_roundtrip() {
        let store = DefaultKindStore::default();
        let json = serde_json::to_string(&store).unwrap();
        let back: DefaultKindStore = serde_json::from_str(&json).unwrap();
        assert_eq!(back.schema_version, DEFAULT_KINDS_SCHEMA_VERSION);
        assert_eq!(back.kinds.len(), store.kinds.len());
    }

    #[test]
    fn completed_empty_roundtrip() {
        let store = KindStore {
            schema_version: KINDS_SCHEMA_VERSION,
            kinds: Vec::new(),
        };
        let json = serde_json::to_string(&store).unwrap();
        let back: KindStore = serde_json::from_str(&json).unwrap();
        assert!(back.kinds.is_empty());
        assert_eq!(back.schema_version, KINDS_SCHEMA_VERSION);
    }
}
