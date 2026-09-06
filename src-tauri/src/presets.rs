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
}

/// Current schema version of `kinds.json`. Bump only when the kind store
/// shape breaks; independent of config/sieves versions.
const PRESETS_SCHEMA_VERSION: u32 = 1;

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
            presets: Self::defaults_presets(),
        }
    }
}

impl PresetStore {
    pub fn defaults_presets() -> Vec<Preset> {
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
                },
                Preset {
                    name: "archive".into(),
                    title: "Archive".into(),
                    extensions: vec!["zip", "rar", "7z", "tar", "gz", "bz2", "xz"]
                        .into_iter()
                        .map(String::from)
                        .collect(),
                },
            ]
    }
}

pub fn presets_path() -> Result<PathBuf, PresetError> {
    Ok(config_dir()?.join("kinds.json"))
}

pub fn load() -> Result<PresetStore, PresetError> {
    let path = presets_path()?;
    if !path.exists() {
        let store = PresetStore::default();
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
