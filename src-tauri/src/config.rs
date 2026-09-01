use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::rules::Rule;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default)]
    pub rules: Vec<Rule>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self { rules: Vec::new() }
    }
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Invalid config JSON: {0}")]
    Json(#[from] serde_json::Error),
}

pub fn config_dir() -> Result<PathBuf, ConfigError> {
    let dir = dirs::config_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("file-automation-util");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn config_path() -> Result<PathBuf, ConfigError> {
    Ok(config_dir()?.join("config.json"))
}

pub fn load() -> Result<AppConfig, ConfigError> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let contents = fs::read_to_string(path)?;
    let config = serde_json::from_str(&contents)?;
    Ok(config)
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
    fn default_config_is_empty() {
        let config = AppConfig::default();
        assert!(config.rules.is_empty());
    }

    #[test]
    fn roundtrip_serialization() {
        let config = AppConfig {
            rules: vec![Rule {
                name: "PDFs".into(),
                watched_folders: vec!["C:/Downloads".into()],
                kind: vec![],
                match_criteria: Default::default(),
                action: crate::rules::RuleAction::Move {
                    destination: "C:/Documents".into(),
                },
            }],
        };
        let json = serde_json::to_string(&config).unwrap();
        let back: AppConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.rules.len(), 1);
        assert_eq!(back.rules[0].name, "PDFs");
        assert_eq!(back.rules[0].watched_folders, vec!["C:/Downloads"]);
    }
}
