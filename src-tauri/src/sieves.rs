use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use chrono::NaiveDate;
use glob::Pattern;
use serde::{Deserialize, Serialize};

use crate::config::{config_dir, ConfigError, SCHEMA_VERSION};
use crate::presets::Preset;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SieveMode {
    #[default]
    All,
    Any,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SieveProperty {
    Kind,
    Extension,
    Name,
    Modified,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SieveOperator {
    Is,
    IsNot,
    Matches,
    NotMatches,
    After,
    Before,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SieveCondition {
    pub property: SieveProperty,
    pub operator: SieveOperator,
    #[serde(default)]
    pub values: Vec<String>,
}

impl SieveCondition {
    /// Resolves the extension set this condition matches against, depending on
    /// property: kind preset ids expand to their preset extensions; extension
    /// values are used as-is; other properties yield an empty set. Values are
    /// lowercased and deduplicated.
    fn target_extensions(&self, presets: &[Preset]) -> HashSet<String> {
        let mut set: HashSet<String> = HashSet::new();
        match self.property {
            SieveProperty::Kind => {
                for id in &self.values {
                    if let Some(preset) = presets.iter().find(|p| &p.name == id) {
                        for ext in &preset.extensions {
                            set.insert(ext.to_lowercase());
                        }
                    }
                }
            }
            SieveProperty::Extension => {
                for ext in &self.values {
                    set.insert(ext.to_lowercase());
                }
            }
            _ => {}
        }
        set
    }

    pub fn matches(&self, path: &Path, presets: &[Preset]) -> bool {
        let file_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name,
            None => return false,
        };

        match self.property {
            SieveProperty::Kind | SieveProperty::Extension => {
                let exts = self.target_extensions(presets);
                // No resolvable extensions: `is` matches nothing, `is_not`
                // matches everything (covers missing kind presets).
                let hit = !exts.is_empty()
                    && path
                        .extension()
                        .and_then(|e| e.to_str())
                        .map(|e| exts.contains(&e.to_lowercase()))
                        .unwrap_or(false);
                match self.operator {
                    SieveOperator::Is => hit,
                    SieveOperator::IsNot => !hit,
                    _ => false,
                }
            }
            SieveProperty::Name => {
                if self.values.is_empty() {
                    return false;
                }
                let hit = self.values.iter().any(|pattern| {
                    Pattern::new(pattern)
                        .map(|pat| pat.matches(file_name))
                        .unwrap_or(false)
                });
                match self.operator {
                    SieveOperator::Matches => hit,
                    SieveOperator::NotMatches => !hit,
                    _ => false,
                }
            }
            SieveProperty::Modified => {
                let Some(date_str) = self.values.first() else {
                    return false;
                };
                let Ok(date) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") else {
                    return false;
                };
                let Some(modified) = fs::metadata(path).and_then(|m| m.modified()).ok() else {
                    return false;
                };
                let modified: chrono::DateTime<chrono::Local> = modified.into();
                let modified = modified.date_naive();
                match self.operator {
                    SieveOperator::After => modified >= date,
                    SieveOperator::Before => modified <= date,
                    _ => false,
                }
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RuleAction {
    Move {
        #[serde(alias = "destination")]
        folder: String,
    },
    Copy {
        #[serde(alias = "destination")]
        folder: String,
    },
    Rename {
        #[serde(alias = "pattern")]
        name: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sieve {
    pub name: String,
    /// Folders this sieve watches (recursively). Only files appearing under one
    /// of these folders are eligible for this sieve.
    #[serde(default)]
    pub watched_folders: Vec<String>,
    #[serde(default)]
    pub mode: SieveMode,
    /// Conditions evaluated against a file; combined with `mode` (all/any).
    #[serde(default)]
    pub conditions: Vec<SieveCondition>,
    /// Actions executed in order when the sieve matches.
    #[serde(default)]
    pub actions: Vec<RuleAction>,
}

impl Sieve {
    /// True if the file lives inside one of this sieve's watched folders.
    pub fn applies_to(&self, path: &Path) -> bool {
        let file_path = if path.is_dir() {
            path
        } else {
            match path.parent() {
                Some(parent) => parent,
                None => return false,
            }
        };
        for folder in &self.watched_folders {
            let folder_path = Path::new(folder);
            if file_path.starts_with(folder_path) {
                return true;
            }
        }
        false
    }

    /// Kind preset ids referenced by any `kind` condition with no matching
    /// preset. Used to warn the user; such conditions just match nothing (or
    /// everything for `is_not`) rather than breaking the sieve.
    pub fn missing_kinds(&self, presets: &[Preset]) -> Vec<String> {
        let mut missing: Vec<String> = Vec::new();
        for condition in &self.conditions {
            if condition.property != SieveProperty::Kind {
                continue;
            }
            for id in &condition.values {
                if !presets.iter().any(|p| &p.name == id) && !missing.contains(id) {
                    missing.push(id.clone());
                }
            }
        }
        missing
    }

    /// True if the sieve has at least one condition and one action, i.e. it can
    /// actually run. Empty conditions/actions mean the sieve is inert.
    pub fn is_runnable(&self) -> bool {
        !self.conditions.is_empty() && !self.actions.is_empty()
    }

    pub fn matches(&self, path: &Path, presets: &[Preset]) -> bool {
        if self.conditions.is_empty() {
            return false;
        }
        let mut results = self.conditions.iter().map(|c| c.matches(path, presets));
        match self.mode {
            SieveMode::All => results.all(|m| m),
            SieveMode::Any => results.any(|m| m),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SieveStore {
    pub version: u32,
    #[serde(default)]
    pub sieves: Vec<Sieve>,
}

impl Default for SieveStore {
    fn default() -> Self {
        Self {
            version: SCHEMA_VERSION,
            sieves: Vec::new(),
        }
    }
}

pub fn sieves_path() -> Result<PathBuf, ConfigError> {
    Ok(config_dir()?.join("sieves.json"))
}

pub fn load() -> Result<SieveStore, ConfigError> {
    let path = sieves_path()?;
    if !path.exists() {
        let store = SieveStore::default();
        save(&store)?;
        return Ok(store);
    }
    let contents = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&contents)?)
}

pub fn save(store: &SieveStore) -> Result<(), ConfigError> {
    let path = sieves_path()?;
    let contents = serde_json::to_string_pretty(store)?;
    fs::write(path, contents)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn preset(name: &str, exts: &[&str]) -> Preset {
        Preset {
            name: name.into(),
            title: name.into(),
            extensions: exts.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn sieve(conditions: Vec<SieveCondition>, actions: Vec<RuleAction>) -> Sieve {
        Sieve {
            name: "Test".into(),
            watched_folders: vec!["C:/Downloads".into()],
            mode: SieveMode::All,
            conditions,
            actions,
        }
    }

    fn kind_condition(operator: SieveOperator, values: Vec<String>) -> SieveCondition {
        SieveCondition {
            property: SieveProperty::Kind,
            operator,
            values,
        }
    }

    fn name_condition(operator: SieveOperator, values: Vec<String>) -> SieveCondition {
        SieveCondition {
            property: SieveProperty::Name,
            operator,
            values,
        }
    }

    #[test]
    fn matches_extension_is() {
        let s = sieve(
            vec![SieveCondition {
                property: SieveProperty::Extension,
                operator: SieveOperator::Is,
                values: vec!["pdf".into()],
            }],
            Vec::new(),
        );
        assert!(s.matches(Path::new("doc.pdf"), &[]));
        assert!(!s.matches(Path::new("doc.txt"), &[]));
    }

    #[test]
    fn matches_extension_is_not() {
        let s = sieve(
            vec![SieveCondition {
                property: SieveProperty::Extension,
                operator: SieveOperator::IsNot,
                values: vec!["pdf".into()],
            }],
            Vec::new(),
        );
        assert!(s.matches(Path::new("doc.txt"), &[]));
        assert!(!s.matches(Path::new("doc.pdf"), &[]));
    }

    #[test]
    fn matches_name_matches() {
        let s = sieve(
            vec![name_condition(SieveOperator::Matches, vec!["*invoice*".into()])],
            Vec::new(),
        );
        assert!(s.matches(Path::new("invoice_001.pdf"), &[]));
        assert!(!s.matches(Path::new("receipt_001.pdf"), &[]));
    }

    #[test]
    fn matches_name_not_matches() {
        let s = sieve(
            vec![name_condition(
                SieveOperator::NotMatches,
                vec!["*invoice*".into()],
            )],
            Vec::new(),
        );
        assert!(s.matches(Path::new("report.txt"), &[]));
        assert!(!s.matches(Path::new("invoice.txt"), &[]));
    }

    #[test]
    fn mode_any_combines_conditions() {
        let s = Sieve {
            name: "Any".into(),
            watched_folders: vec!["C:/Downloads".into()],
            mode: SieveMode::Any,
            conditions: vec![
                kind_condition(SieveOperator::Is, vec!["movie".into()]),
                name_condition(SieveOperator::Matches, vec!["*photo*".into()]),
            ],
            actions: Vec::new(),
        };
        let presets = vec![preset("movie", &["mp4", "mov"])];
        // Kind matches even though name does not.
        assert!(s.matches(Path::new("clip.mp4"), &presets));
        // Name matches even though kind does not.
        assert!(s.matches(Path::new("myphoto.jpg"), &presets));
        // Neither matches.
        assert!(!s.matches(Path::new("stuff.txt"), &presets));
    }

    #[test]
    fn missing_kind_is_not_matches_everything() {
        let s = Sieve {
            name: "Broken".into(),
            watched_folders: vec!["C:/Downloads".into()],
            mode: SieveMode::All,
            conditions: vec![kind_condition(SieveOperator::IsNot, vec!["gone".into()])],
            actions: Vec::new(),
        };
        assert_eq!(s.missing_kinds(&[]), vec!["gone"]);
        assert!(s.matches(Path::new("anything.mp4"), &[]));
    }

    #[test]
    fn empty_conditions_never_match() {
        let s = sieve(Vec::new(), Vec::new());
        assert!(!s.is_runnable());
        assert!(!s.matches(Path::new("anything.mp4"), &[]));
    }

    #[test]
    fn missing_kinds_are_reported() {
        let s = sieve(vec![kind_condition(SieveOperator::Is, vec!["gone".into()])], Vec::new());
        assert_eq!(s.missing_kinds(&[]), vec!["gone"]);
        assert!(s.missing_kinds(&[preset("gone", &["mp4"])]).is_empty());
    }

    #[test]
    fn applies_to_watched_folder() {
        let s = sieve(Vec::new(), Vec::new());
        assert!(s.applies_to(Path::new("C:/Downloads/doc.pdf")));
        assert!(s.applies_to(Path::new("C:/Downloads/Sub/doc.pdf")));
        assert!(!s.applies_to(Path::new("C:/Documents/doc.pdf")));
    }

    #[test]
    fn store_roundtrip() {
        let store = SieveStore {
            version: SCHEMA_VERSION,
            sieves: vec![sieve(
                vec![name_condition(SieveOperator::Matches, vec!["*invoice*".into()])],
                vec![RuleAction::Move {
                    folder: "D:\\Temp".into(),
                }],
            )],
        };
        let json = serde_json::to_string(&store).unwrap();
        let back: SieveStore = serde_json::from_str(&json).unwrap();
        assert_eq!(back.version, SCHEMA_VERSION);
        assert_eq!(back.sieves.len(), 1);
        assert_eq!(back.sieves[0].conditions[0].operator, SieveOperator::Matches);
        match &back.sieves[0].actions[0] {
            RuleAction::Move { folder } => assert_eq!(folder, "D:\\Temp"),
            _ => panic!("expected Move action"),
        }
    }

    #[test]
    fn legacy_action_fields_load_via_aliases() {
        let json = r#"{
            "version": 1,
            "sieves": [{
                "name": "legacy",
                "watched_folders": [],
                "mode": "all",
                "conditions": [],
                "actions": [
                    { "type": "move", "destination": "D:\\Temp" },
                    { "type": "rename", "pattern": "new_{name}" }
                ]
            }]
        }"#;
        let store: SieveStore = serde_json::from_str(json).unwrap();
        match &store.sieves[0].actions[0] {
            RuleAction::Move { folder } => assert_eq!(folder, "D:\\Temp"),
            _ => panic!("expected Move action"),
        }
        match &store.sieves[0].actions[1] {
            RuleAction::Rename { name } => assert_eq!(name, "new_{name}"),
            _ => panic!("expected Rename action"),
        }
    }

    #[test]
    fn default_store_has_current_version() {
        let store = SieveStore::default();
        assert_eq!(store.version, SCHEMA_VERSION);
        assert!(store.sieves.is_empty());
    }
}