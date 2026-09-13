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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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
    /// Derived from the hardcoded default list on read; the persisted value is
    /// ignored, kept only so older `kinds.json` files still deserialize.
    #[serde(default)]
    pub is_default: bool,
}

/// Current schema version of `kinds.json`. Bump only when the kind store
/// shape breaks; independent of config/sieves versions.
const KINDS_SCHEMA_VERSION: u32 = 1;

/// The shipped default kinds, compiled in. `kinds.json` stores only user
/// overrides of these plus custom kinds; effective kinds are the defaults
/// merged with those entries.
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

/// The hardcoded default kind with the given name, if any.
pub fn default_kind(name: &str) -> Option<Kind> {
    default_kinds().into_iter().find(|k| k.name == name)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct KindStore {
    pub schema_version: u32,
    /// User overrides of default kinds plus custom kinds — never a full copy
    /// of the defaults. See `effective`.
    pub kinds: Vec<Kind>,
}

impl Default for KindStore {
    fn default() -> Self {
        Self {
            schema_version: KINDS_SCHEMA_VERSION,
            kinds: Vec::new(),
        }
    }
}

impl KindStore {
    /// Defaults merged with stored overrides, then custom kinds. `is_default`
    /// is derived from the hardcoded list, so an override of a default that a
    /// later version removes degrades to a custom kind.
    pub fn effective(&self) -> Vec<Kind> {
        let defaults = default_kinds();
        let mut out: Vec<Kind> = defaults
            .iter()
            .map(|d| match self.kinds.iter().find(|k| k.name == d.name) {
                Some(override_kind) => Kind {
                    is_default: true,
                    ..override_kind.clone()
                },
                None => d.clone(),
            })
            .collect();
        out.extend(
            self.kinds
                .iter()
                .filter(|k| !defaults.iter().any(|d| d.name == k.name))
                .cloned()
                .map(|k| Kind { is_default: false, ..k }),
        );
        out
    }

    /// Inserts or replaces the stored entry for `kind.name`.
    pub fn upsert_override(&mut self, kind: Kind) {
        match self.kinds.iter_mut().find(|k| k.name == kind.name) {
            Some(existing) => *existing = kind,
            None => self.kinds.push(kind),
        }
    }

    /// Drops stored entries identical to the shipped default, so updated
    /// defaults reach users who never customized that kind.
    fn normalized(mut self) -> Self {
        self.kinds
            .retain(|k| match default_kind(&k.name) {
                Some(d) => *k != d,
                None => true,
            });
        self
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
/// base (or a previous candidate) is already taken by an existing kind.
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

pub fn load() -> Result<KindStore, KindError> {
    let path = kinds_path()?;
    if !path.exists() {
        return Ok(KindStore::default());
    }
    let contents = fs::read_to_string(path)?;
    let store: KindStore = serde_json::from_str(&contents)?;
    Ok(store.normalized())
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

    fn custom_kind(name: &str) -> Kind {
        Kind {
            name: name.into(),
            title: name.into(),
            extensions: vec!["xyz".into()],
            enabled: true,
            is_default: false,
        }
    }

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
    fn default_kinds_are_unique_default_and_enabled() {
        let kinds = default_kinds();
        assert!(!kinds.is_empty());
        let mut names: Vec<&str> = kinds.iter().map(|k| k.name.as_str()).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), kinds.len());
        assert!(kinds.iter().all(|k| k.is_default && k.enabled));
    }

    #[test]
    fn effective_without_overrides_is_the_defaults() {
        let store = KindStore::default();
        assert_eq!(store.effective(), default_kinds());
    }

    #[test]
    fn effective_merges_overrides_and_appends_customs() {
        let mut movie = default_kind("movie").unwrap();
        movie.extensions = vec!["mp4".into()];
        let store = KindStore {
            schema_version: KINDS_SCHEMA_VERSION,
            kinds: vec![movie, custom_kind("screenshots")],
        };
        let effective = store.effective();
        assert_eq!(effective.len(), default_kinds().len() + 1);
        let movie = effective.iter().find(|k| k.name == "movie").unwrap();
        assert_eq!(movie.extensions, vec!["mp4"]);
        assert!(movie.is_default);
        let screenshots = effective.iter().find(|k| k.name == "screenshots").unwrap();
        assert!(!screenshots.is_default);
    }

    #[test]
    fn normalized_drops_overrides_identical_to_defaults() {
        let movie = default_kind("movie").unwrap();
        let store = KindStore {
            schema_version: KINDS_SCHEMA_VERSION,
            kinds: vec![movie, custom_kind("screenshots")],
        };
        assert_eq!(store.normalized().kinds, vec![custom_kind("screenshots")]);
    }

    #[test]
    fn orphaned_default_degrades_to_custom() {
        let orphan = Kind {
            name: "legacy".into(),
            title: "Legacy".into(),
            extensions: vec!["old".into()],
            enabled: true,
            is_default: true,
        };
        let store = KindStore { schema_version: KINDS_SCHEMA_VERSION, kinds: vec![orphan] };
        let effective = store.effective();
        let legacy = effective.iter().find(|k| k.name == "legacy").unwrap();
        assert!(!legacy.is_default);
    }

    #[test]
    fn upsert_override_replaces_existing_entry() {
        let mut store = KindStore::default();
        store.upsert_override(custom_kind("screenshots"));
        let mut renamed = custom_kind("screenshots");
        renamed.title = "Screenshots".into();
        store.upsert_override(renamed);
        assert_eq!(store.kinds.len(), 1);
        assert_eq!(store.kinds[0].title, "Screenshots");
    }

    #[test]
    fn empty_store_roundtrip() {
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
