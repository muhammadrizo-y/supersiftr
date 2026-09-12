use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use chrono::NaiveDate;
use glob::Pattern;
use serde::{Deserialize, Serialize};

use crate::config::{config_dir, ConfigError};
use crate::kinds::Kind;

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
    Type,
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

/// Whether any configured extension is a suffix of `file_name`, case-
/// insensitively, with at least one character before it. Multi-dot entries
/// (`tar.gz`) match as a unit (longest tail wins by nature of `ends_with`);
/// the guard makes `.env`-style dotfiles never match their own name.
fn extension_set_matches(file_name: &str, exts: &HashSet<String>) -> bool {
    let lower = file_name.to_ascii_lowercase();
    exts.iter().any(|ext| {
        let needle = format!(".{ext}");
        lower.len() > needle.len() && lower.ends_with(&needle)
    })
}

/// First enabled kind whose extensions match `file_name`'s suffix,
/// case-insensitively. Used by the sort-into-subfolder action to derive the
/// destination subfolder.
pub fn matching_kind<'a>(file_name: &str, kinds: &'a [Kind]) -> Option<&'a Kind> {
    kinds.iter().find(|k| {
        k.enabled
            && extension_set_matches(
                file_name,
                &k.extensions.iter().map(|e| e.to_lowercase()).collect(),
            )
    })
}

impl SieveCondition {
    /// Resolves the extension set this condition matches against, depending on
    /// property: kind ids expand to their kind extensions; extension
    /// values are used as-is; other properties yield an empty set. Values are
    /// lowercased and deduplicated.
    fn target_extensions(&self, kinds: &[Kind]) -> HashSet<String> {
        let mut set: HashSet<String> = HashSet::new();
        match self.property {
            SieveProperty::Kind => {
                for id in &self.values {
                    if let Some(kind) = kinds.iter().find(|p| &p.name == id) {
                        // Disabled kinds are inactive: they contribute no
                        // extensions (matching nothing for `is`, everything
                        // for `is_not`), like missing kinds.
                        if !kind.enabled {
                            continue;
                        }
                        for ext in &kind.extensions {
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

    pub fn matches(&self, path: &Path, kinds: &[Kind]) -> bool {
        let file_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name,
            None => return false,
        };

        match self.property {
            SieveProperty::Kind | SieveProperty::Extension => {
                let exts = self.target_extensions(kinds);
                // No resolvable extensions: `is` matches nothing, `is_not`
                // matches everything (covers missing kinds).
                // Directories are always treated as extensionless: a folder
                // literally named "report.pdf" is not a pdf.
                let hit = !path.is_dir()
                    && !exts.is_empty()
                    && extension_set_matches(file_name, &exts);
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
            SieveProperty::Type => {
                let Some(entry) = self.values.first() else {
                    return false;
                };
                let is_dir = path.is_dir();
                let hit = match entry.as_str() {
                    "file" => !is_dir,
                    "folder" => is_dir,
                    _ => false,
                };
                match self.operator {
                    SieveOperator::Is => hit,
                    SieveOperator::IsNot => !hit,
                    _ => false,
                }
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeleteMode {
    Recycle,
    Permanent,
}

/// What a sort-into-subfolder action names the destination subfolder after.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortKey {
    Extension,
    Kind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RuleAction {
    Move { folder: String },
    Copy { folder: String },
    Rename { name: String },
    Delete { mode: DeleteMode },
    SortInto { folder: String, by: SortKey },
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
    /// Disabled sieves are skipped entirely: they never match and their
    /// folders are not watched.
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
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

    /// Kind ids referenced by any `kind` condition with no matching kind.
    /// Used to warn the user; such conditions just match nothing (or
    /// everything for `is_not`) rather than breaking the sieve.
    pub fn missing_kinds(&self, kinds: &[Kind]) -> Vec<String> {
        let mut missing: Vec<String> = Vec::new();
        for condition in &self.conditions {
            if condition.property != SieveProperty::Kind {
                continue;
            }
            for id in &condition.values {
                if !kinds.iter().any(|p| &p.name == id) && !missing.contains(id) {
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

    pub fn matches(&self, path: &Path, kinds: &[Kind]) -> bool {
        if !self.enabled {
            return false;
        }
        if self.conditions.is_empty() {
            return false;
        }
        let mut results = self.conditions.iter().map(|c| c.matches(path, kinds));
        match self.mode {
            SieveMode::All => results.all(|m| m),
            SieveMode::Any => results.any(|m| m),
        }
    }
}

/// Current schema version of `sieves.json`. Bump only when the sieve store
/// shape breaks; independent of config/kinds versions.
const SIEVES_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SieveStore {
    pub schema_version: u32,
    #[serde(default)]
    pub sieves: Vec<Sieve>,
}

impl Default for SieveStore {
    fn default() -> Self {
        Self {
            schema_version: SIEVES_SCHEMA_VERSION,
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

    fn kind(name: &str, exts: &[&str]) -> Kind {
        Kind {
            name: name.into(),
            title: name.into(),
            extensions: exts.iter().map(|s| s.to_string()).collect(),
            enabled: true,
            is_default: false,
        }
    }

    fn sieve(conditions: Vec<SieveCondition>, actions: Vec<RuleAction>) -> Sieve {
        Sieve {
            name: "Test".into(),
            watched_folders: vec!["C:/Downloads".into()],
            mode: SieveMode::All,
            conditions,
            actions,
            enabled: true,
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

    fn type_condition(value: &str) -> SieveCondition {
        SieveCondition {
            property: SieveProperty::Type,
            operator: SieveOperator::Is,
            values: vec![value.into()],
        }
    }

    #[test]
    fn matches_type_folder_only() {
        let dir = std::env::temp_dir();
        let file = std::env::current_exe().unwrap();
        let s = sieve(vec![type_condition("folder")], Vec::new());
        assert!(s.matches(dir.as_path(), &[]));
        assert!(!s.matches(file.as_path(), &[]));
    }

    #[test]
    fn matches_type_file_only() {
        let dir = std::env::temp_dir();
        let file = std::env::current_exe().unwrap();
        let s = sieve(vec![type_condition("file")], Vec::new());
        assert!(s.matches(file.as_path(), &[]));
        assert!(!s.matches(dir.as_path(), &[]));
    }

    #[test]
    fn extension_condition_ignores_dotted_folder() {
        let dir = std::env::temp_dir().join(format!(
            "supersiftr-dotted-folder-{}.pdf",
            std::process::id()
        ));
        std::fs::create_dir(&dir).unwrap();
        let s = sieve(
            vec![SieveCondition {
                property: SieveProperty::Extension,
                operator: SieveOperator::Is,
                values: vec!["pdf".into()],
            }],
            Vec::new(),
        );
        assert!(!s.matches(dir.as_path(), &[]));
        let not_s = sieve(
            vec![SieveCondition {
                property: SieveProperty::Extension,
                operator: SieveOperator::IsNot,
                values: vec!["pdf".into()],
            }],
            Vec::new(),
        );
        assert!(not_s.matches(dir.as_path(), &[]));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn name_condition_matches_folder() {
        let dir = std::env::temp_dir();
        let s = sieve(vec![name_condition(SieveOperator::Matches, vec!["*".into()])], Vec::new());
        assert!(s.matches(dir.as_path(), &[]));
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
    fn kind_matches_compound_extension() {
        let s = sieve(
            vec![kind_condition(SieveOperator::Is, vec!["archive".into()])],
            Vec::new(),
        );
        // `tar.gz` is a compound extension: it must match as a unit even
        // though the file's final dot segment is only `gz`.
        let compound = kind("archive", &["tar.gz"]);
        assert!(s.matches(Path::new("photos.tar.gz"), &[compound.clone()]));
        assert!(!s.matches(Path::new("photos.gz"), &[compound.clone()]));
        // A `tar`-only kind (no compound entry) never swallows `.tar.gz`.
        let plain = kind("archive", &["zip", "tar"]);
        assert!(!s.matches(Path::new("photos.tar.gz"), &[plain]));
    }

    #[test]
    fn extension_condition_matches_compound() {
        let s = sieve(
            vec![SieveCondition {
                property: SieveProperty::Extension,
                operator: SieveOperator::Is,
                values: vec!["tar.gz".into()],
            }],
            Vec::new(),
        );
        assert!(s.matches(Path::new("docs.tar.gz"), &[]));
        assert!(!s.matches(Path::new("docs.gz"), &[]));
    }

    #[test]
    fn compound_dotfile_is_not_matched() {
        let s = sieve(
            vec![SieveCondition {
                property: SieveProperty::Extension,
                operator: SieveOperator::Is,
                values: vec!["tar.gz".into()],
            }],
            Vec::new(),
        );
        assert!(!s.matches(Path::new(".tar.gz"), &[]));
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
            enabled: true,
        };
        let kinds = vec![kind("movie", &["mp4", "mov"])];
        // Kind matches even though name does not.
        assert!(s.matches(Path::new("clip.mp4"), &kinds));
        // Name matches even though kind does not.
        assert!(s.matches(Path::new("myphoto.jpg"), &kinds));
        // Neither matches.
        assert!(!s.matches(Path::new("stuff.txt"), &kinds));
    }

    #[test]
    fn missing_kind_is_not_matches_everything() {
        let s = Sieve {
            name: "Broken".into(),
            watched_folders: vec!["C:/Downloads".into()],
            mode: SieveMode::All,
            conditions: vec![kind_condition(SieveOperator::IsNot, vec!["gone".into()])],
            actions: Vec::new(),
            enabled: true,
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
    fn disabled_sieve_never_matches() {
        let mut s = sieve(
            vec![SieveCondition {
                property: SieveProperty::Extension,
                operator: SieveOperator::Is,
                values: vec!["pdf".into()],
            }],
            Vec::new(),
        );
        s.enabled = false;
        assert!(!s.matches(Path::new("doc.pdf"), &[]));
    }

    #[test]
    fn missing_kinds_are_reported() {
        let s = sieve(vec![kind_condition(SieveOperator::Is, vec!["gone".into()])], Vec::new());
        assert_eq!(s.missing_kinds(&[]), vec!["gone"]);
        assert!(s.missing_kinds(&[kind("gone", &["mp4"])]).is_empty());
    }

    #[test]
    fn disabled_kind_contributes_no_extensions() {
        let s = sieve(
            vec![kind_condition(SieveOperator::Is, vec!["movie".into()])],
            Vec::new(),
        );
        let mut movie = kind("movie", &["mp4", "mov"]);
        movie.enabled = false;
        // The kind exists but is disabled, so it matches nothing...
        assert!(!s.matches(Path::new("clip.mp4"), &[movie.clone()]));
        // ...and `is_not` matches everything (like a missing kind).
        let s2 = sieve(
            vec![kind_condition(SieveOperator::IsNot, vec!["movie".into()])],
            Vec::new(),
        );
        assert!(s2.matches(Path::new("clip.mp4"), &[movie]));
    }

    #[test]
    fn matching_kind_skips_disabled_and_requires_suffix() {
        let kinds = vec![kind("movie", &["mp4"])];
        assert_eq!(
            matching_kind("clip.mp4", &kinds).map(|k| k.name.as_str()),
            Some("movie")
        );
        assert_eq!(matching_kind("clip.txt", &kinds).map(|k| k.name.as_str()), None);
        let mut disabled = kind("movie", &["mp4"]);
        disabled.enabled = false;
        assert_eq!(
            matching_kind("clip.mp4", &[disabled]).map(|k| k.name.as_str()),
            None
        );
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
            schema_version: SIEVES_SCHEMA_VERSION,
            sieves: vec![sieve(
                vec![name_condition(SieveOperator::Matches, vec!["*invoice*".into()])],
                vec![RuleAction::Move {
                    folder: "D:\\Temp".into(),
                }],
            )],
        };
        let json = serde_json::to_string(&store).unwrap();
        let back: SieveStore = serde_json::from_str(&json).unwrap();
        assert_eq!(back.schema_version, SIEVES_SCHEMA_VERSION);
        assert_eq!(back.sieves.len(), 1);
        assert_eq!(back.sieves[0].conditions[0].operator, SieveOperator::Matches);
        match &back.sieves[0].actions[0] {
            RuleAction::Move { folder } => assert_eq!(folder, "D:\\Temp"),
            _ => panic!("expected Move action"),
        }
    }

    #[test]
    fn default_store_has_current_version() {
        let store = SieveStore::default();
        assert_eq!(store.schema_version, SIEVES_SCHEMA_VERSION);
        assert!(store.sieves.is_empty());
    }

    #[test]
    fn delete_action_roundtrip() {
        let store = SieveStore {
            schema_version: SIEVES_SCHEMA_VERSION,
            sieves: vec![sieve(
                vec![name_condition(SieveOperator::Matches, vec!["*tmp*".into()])],
                vec![RuleAction::Delete {
                    mode: DeleteMode::Recycle,
                }],
            )],
        };
        let json = serde_json::to_string(&store).unwrap();
        assert!(json.contains("\"type\":\"delete\""));
        assert!(json.contains("\"mode\":\"recycle\""));
        let back: SieveStore = serde_json::from_str(&json).unwrap();
        match &back.sieves[0].actions[0] {
            RuleAction::Delete { mode } => {
                assert_eq!(*mode, DeleteMode::Recycle);
            }
            _ => panic!("expected Delete action"),
        }
    }
}