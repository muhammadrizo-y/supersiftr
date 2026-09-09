use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Current schema version of `config.json`. Bump when the app settings shape
/// breaks; loading is tolerant (missing version is assumed to be the latest).
pub const CONFIG_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DateFormat {
    Us,
    Uk,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub schema_version: u32,
    pub show_in_tray: bool,
    pub date_format: DateFormat,
    pub compound_extensions: Vec<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            schema_version: CONFIG_SCHEMA_VERSION,
            show_in_tray: true,
            date_format: DateFormat::Uk,
            compound_extensions: Vec::new(),
        }
    }
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Invalid JSON: {0}")]
    Json(#[from] serde_json::Error),
}

pub fn config_dir() -> Result<PathBuf, ConfigError> {
    let dir = dirs::config_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("supersiftr");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn config_path() -> Result<PathBuf, ConfigError> {
    Ok(config_dir()?.join("config.json"))
}

/// Loads the saved config, creating and persisting the default on first run.
/// Returns `(config, fresh)` where `fresh` is true only when the file had to
/// be created (i.e. the very first launch).
pub fn load() -> Result<(AppConfig, bool), ConfigError> {
    let path = config_path()?;
    if !path.exists() {
        let config = AppConfig::default();
        save(&config)?;
        return Ok((config, true));
    }
    let contents = fs::read_to_string(path)?;
    Ok((serde_json::from_str(&contents)?, false))
}

pub fn save(config: &AppConfig) -> Result<(), ConfigError> {
    let path = config_path()?;
    let contents = serde_json::to_string_pretty(config)?;
    fs::write(path, contents)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_has_current_version() {
        let config = AppConfig::default();
        assert_eq!(config.schema_version, CONFIG_SCHEMA_VERSION);
        assert_eq!(config.date_format, DateFormat::Uk);
    }

    #[test]
    fn roundtrip_serialization() {
        let config = AppConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        let back: AppConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.schema_version, CONFIG_SCHEMA_VERSION);
    }

    #[test]
    fn roundtrip_preserves_date_format() {
        let config = AppConfig {
            date_format: DateFormat::Us,
            ..AppConfig::default()
        };
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("\"us\""));
        let back: AppConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.date_format, DateFormat::Us);
    }

    #[test]
    fn missing_date_format_defaults_to_uk() {
        let back: AppConfig =
            serde_json::from_str(r#"{"schema_version":1,"show_in_tray":true}"#).unwrap();
        assert_eq!(back.date_format, DateFormat::Uk);
    }
}