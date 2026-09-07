use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::config::config_dir;

#[derive(Debug, Error)]
pub enum PresetError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Invalid kinds JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Config error: {0}")]
    Config(#[from] crate::config::ConfigError),
    #[error("A kind preset with this name already exists")]
    Duplicate,
    #[error("No kind preset with this name exists")]
    NotFound,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Preset {
    /// Stable identifier (e.g. "movie"). Rules reference kinds by this id;
    /// renaming `title` does not break references.
    pub name: String,
    /// Human-friendly display name (e.g. "Movie").
    pub title: String,
    #[serde(default)]
    pub extensions: Vec<String>,
    /// Whether the kind is active. Default kinds can only be toggled off;
    /// user-created kinds are always enabled.
    #[serde(default)]
    pub enabled: bool,
    /// Built-in kind backed by `default_kinds.json`: cannot be deleted or
    /// edited, only disabled and reset.
    #[serde(default)]
    pub is_default: bool,
}

/// Current schema version of `kinds.json`. Bump only when the kind store
/// shape breaks; independent of config/sieves versions.
const PRESETS_SCHEMA_VERSION: u32 = 1;

/// Current schema version of `default_kinds.json`. Bump only when that file's
/// shape breaks.
const DEFAULT_KINDS_SCHEMA_VERSION: u32 = 1;

/// The built-in kinds shipped with the app. Materialized into
/// `default_kinds.json` on first run; `Reset` restores a kind from there.
fn default_kinds() -> Vec<Preset> {
    vec![
        Preset {
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
        Preset {
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
        Preset {
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
        Preset {
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
        Preset {
            name: "archive".into(),
            title: "Archive".into(),
            extensions: vec!["zip", "rar", "7z", "tar", "gz", "bz2", "xz"]
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
pub struct PresetStore {
    pub schema_version: u32,
    pub presets: Vec<Preset>,
}

impl Default for PresetStore {
    fn default() -> Self {
        Self {
            schema_version: PRESETS_SCHEMA_VERSION,
            presets: default_kinds(),
        }
    }
}

/// The immutable default set kind "Reset" restores from. Written to disk on
/// first run so it has an explicit schema_version like every other JSON file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct DefaultKindStore {
    pub schema_version: u32,
    pub presets: Vec<Preset>,
}

impl Default for DefaultKindStore {
    fn default() -> Self {
        Self {
            schema_version: DEFAULT_KINDS_SCHEMA_VERSION,
            presets: default_kinds(),
        }
    }
}

pub fn presets_path() -> Result<PathBuf, PresetError> {
    Ok(config_dir()?.join("kinds.json"))
}

pub fn default_kinds_path() -> Result<PathBuf, PresetError> {
    Ok(config_dir()?.join("default_kinds.json"))
}

/// The shipped default kinds, materializing `default_kinds.json` on first run.
pub fn load_defaults() -> Result<Vec<Preset>, PresetError> {
    let path = default_kinds_path()?;
    if !path.exists() {
        let store = DefaultKindStore::default();
        let contents = serde_json::to_string_pretty(&store)?;
        fs::write(path, contents)?;
        return Ok(store.presets);
    }
    let contents = fs::read_to_string(path)?;
    let store: DefaultKindStore = serde_json::from_str(&contents)?;
    Ok(store.presets)
}

pub fn load() -> Result<PresetStore, PresetError> {
    let defaults = load_defaults()?;
    let path = presets_path()?;
    if !path.exists() {
        let store = PresetStore {
            schema_version: PRESETS_SCHEMA_VERSION,
            presets: defaults,
        };
        let _ = save(&store);
        return Ok(store);
    }
    let contents = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&contents)?)
}

pub fn save(store: &PresetStore) -> Result<(), PresetError> {
    let path = presets_path()?;
    let contents = serde_json::to_string_pretty(store)?;
    fs::write(path, contents)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_unique() {
        let store = PresetStore::default();
        let mut names: Vec<&str> = store.presets.iter().map(|p| p.name.as_str()).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), store.presets.len());
        assert_eq!(store.schema_version, PRESETS_SCHEMA_VERSION);
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
        assert_eq!(back.presets.len(), store.presets.len());
    }

    #[test]
    fn completed_empty_roundtrip() {
        let store = PresetStore {
            schema_version: PRESETS_SCHEMA_VERSION,
            presets: Vec::new(),
        };
        let json = serde_json::to_string(&store).unwrap();
        let back: PresetStore = serde_json::from_str(&json).unwrap();
        assert!(back.presets.is_empty());
        assert_eq!(back.schema_version, PRESETS_SCHEMA_VERSION);
    }
}
