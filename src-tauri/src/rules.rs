use std::collections::HashSet;
use std::fs;
use std::path::Path;

use chrono::NaiveDate;
use glob::Pattern;
use serde::{Deserialize, Serialize};

use crate::presets::Preset;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MatchCriteria {
    #[serde(default)]
    pub extension: Option<String>,
    #[serde(default)]
    pub name_pattern: Option<String>,
    #[serde(default)]
    pub date_after: Option<String>,
    #[serde(default)]
    pub date_before: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RuleAction {
    Move { destination: String },
    Copy { destination: String },
    Rename { pattern: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rule {
    pub name: String,
    /// Folders this rule watches (recursively). Only files appearing under one
    /// of these folders are eligible for this rule.
    #[serde(default)]
    pub watched_folders: Vec<String>,
    /// Kind preset ids (kebab-case) whose extension sets are merged into the
    /// rule's matching. References are by id; a missing id simply contributes
    /// no extensions without breaking the rest of the rule.
    #[serde(default)]
    pub kind: Vec<String>,
    #[serde(default)]
    pub match_criteria: MatchCriteria,
    pub action: RuleAction,
}

impl Rule {
    /// True if the file lives inside one of this rule's watched folders.
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

    /// Kind ids referenced by this rule that have no matching preset.
    pub fn missing_kinds(&self, presets: &[Preset]) -> Vec<String> {
        self.kind
            .iter()
            .filter(|k| !presets.iter().any(|p| &p.name == *k))
            .cloned()
            .collect()
    }

    /// True if the rule has at least one criterion that could match a file,
    /// after resolving kind presets. A rule whose only constraint was a
    /// now-missing kind preset has nothing left to run on.
    pub fn is_runnable(&self, presets: &[Preset]) -> bool {
        if !self.resolved_extensions(presets).is_empty() {
            return true;
        }
        self.match_criteria.name_pattern.is_some()
            || self.match_criteria.date_after.is_some()
            || self.match_criteria.date_before.is_some()
    }

    /// All extension strings this rule matches: kind preset extensions (resolved
    /// by id) unioned with the rule's own extension field. Lowercased + unique.
    pub fn resolved_extensions(&self, presets: &[Preset]) -> Vec<String> {
        let mut set: HashSet<String> = HashSet::new();
        for name in &self.kind {
            if let Some(preset) = presets.iter().find(|p| &p.name == name) {
                for ext in &preset.extensions {
                    set.insert(ext.to_lowercase());
                }
            }
        }
        if let Some(ext) = &self.match_criteria.extension {
            set.insert(ext.to_lowercase());
        }
        let mut list: Vec<String> = set.into_iter().collect();
        list.sort_unstable();
        list
    }

    pub fn matches(&self, path: &Path, presets: &[Preset]) -> bool {
        let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
            return false;
        };

        let extensions = self.resolved_extensions(presets);
        if !extensions.is_empty() {
            let actual = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_lowercase());
            if !extensions.iter().any(|ext| Some(ext.as_str()) == actual.as_deref()) {
                return false;
            }
        }

        if let Some(pattern) = &self.match_criteria.name_pattern {
            let pat = Pattern::new(pattern).map_err(|_| ()).unwrap();
            if !pat.matches(file_name) {
                return false;
            }
        }

        if let Some(date_str) = &self.match_criteria.date_after {
            let Some(modified) = fs::metadata(path).and_then(|m| m.modified()).ok() else {
                return false;
            };
            let modified: chrono::DateTime<chrono::Local> = modified.into();
            let Ok(date) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") else {
                return false;
            };
            if modified.date_naive() < date {
                return false;
            }
        }

        if let Some(date_str) = &self.match_criteria.date_before {
            let Some(modified) = fs::metadata(path).and_then(|m| m.modified()).ok() else {
                return false;
            };
            let modified: chrono::DateTime<chrono::Local> = modified.into();
            let Ok(date) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") else {
                return false;
            };
            if modified.date_naive() > date {
                return false;
            }
        }

        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_extension() {
        let rule = Rule {
            name: "PDFs".into(),
            watched_folders: vec!["C:/Downloads".into()],
            kind: vec![],
            match_criteria: MatchCriteria {
                extension: Some("pdf".into()),
                name_pattern: None,
                date_after: None,
                date_before: None,
            },
            action: RuleAction::Move {
                destination: "C:/tmp".into(),
            },
        };
        assert!(rule.matches(Path::new("doc.pdf"), &[]));
        assert!(!rule.matches(Path::new("doc.txt"), &[]));
    }

    #[test]
    fn matches_name_pattern() {
        let rule = Rule {
            name: "Invoices".into(),
            watched_folders: vec!["C:/Downloads".into()],
            kind: vec![],
            match_criteria: MatchCriteria {
                extension: None,
                name_pattern: Some("*invoice*".into()),
                date_after: None,
                date_before: None,
            },
            action: RuleAction::Move {
                destination: "C:/tmp".into(),
            },
        };
        assert!(rule.matches(Path::new("invoice_001.pdf"), &[]));
        assert!(!rule.matches(Path::new("receipt_001.pdf"), &[]));
    }

    #[test]
    fn matches_kind_preset_extension() {
        let presets = vec![Preset {
            name: "movie".into(),
            title: "Movie".into(),
            extensions: vec!["mp4".into(), "mov".into()],
        }];
        let rule = Rule {
            name: "Movies".into(),
            watched_folders: vec!["C:/Downloads".into()],
            kind: vec!["movie".into()],
            match_criteria: MatchCriteria::default(),
            action: RuleAction::Move {
                destination: "C:/Movies".into(),
            },
        };
        assert!(rule.matches(Path::new("clip.mp4"), &presets));
        assert!(rule.matches(Path::new("clip.MOV"), &presets));
        assert!(!rule.matches(Path::new("clip.png"), &presets));
        assert!(rule.missing_kinds(&presets).is_empty());
    }

    #[test]
    fn missing_kind_does_not_break_other_criteria() {
        let rule = Rule {
            name: "Invoices".into(),
            watched_folders: vec!["C:/Downloads".into()],
            kind: vec!["does-not-exist".into()],
            match_criteria: MatchCriteria {
                extension: None,
                name_pattern: Some("*invoice*".into()),
                date_after: None,
                date_before: None,
            },
            action: RuleAction::Move {
                destination: "C:/tmp".into(),
            },
        };
        assert!(rule.matches(Path::new("invoice_001.pdf"), &[]));
        assert!(!rule.matches(Path::new("receipt_001.pdf"), &[]));
        assert_eq!(rule.missing_kinds(&[]), vec!["does-not-exist"]);
        assert!(rule.is_runnable(&[]));
    }

    #[test]
    fn kind_only_missing_makes_rule_not_runnable() {
        let rule = Rule {
            name: "Broken".into(),
            watched_folders: vec!["C:/Downloads".into()],
            kind: vec!["gone".into()],
            match_criteria: MatchCriteria::default(),
            action: RuleAction::Move {
                destination: "C:/tmp".into(),
            },
        };
        assert_eq!(rule.missing_kinds(&[]), vec!["gone"]);
        assert!(!rule.is_runnable(&[]));
        // With no resolvable criteria, matching alone would accept any file;
        // the runnability check is what prevents the rule from acting.
        assert!(rule.matches(Path::new("anything.mp4"), &[]));
    }

    #[test]
    fn kind_and_own_extension_merge() {
        let presets = vec![Preset {
            name: "movie".into(),
            title: "Movie".into(),
            extensions: vec!["mp4".into()],
        }];
        let rule = Rule {
            name: "Movies".into(),
            watched_folders: vec!["C:/Downloads".into()],
            kind: vec!["movie".into()],
            match_criteria: MatchCriteria {
                extension: Some("avi".into()),
                name_pattern: None,
                date_after: None,
                date_before: None,
            },
            action: RuleAction::Move {
                destination: "C:/tmp".into(),
            },
        };
        assert_eq!(rule.resolved_extensions(&presets), vec!["avi", "mp4"]);
        assert!(rule.matches(Path::new("a.mp4"), &presets));
        assert!(rule.matches(Path::new("a.avi"), &presets));
    }

    #[test]
    fn applies_to_watched_folder() {
        let rule = Rule {
            name: "PDFs".into(),
            watched_folders: vec!["C:/Downloads".into()],
            kind: vec![],
            match_criteria: MatchCriteria::default(),
            action: RuleAction::Move {
                destination: "C:/tmp".into(),
            },
        };
        assert!(rule.applies_to(Path::new("C:/Downloads/doc.pdf")));
        assert!(rule.applies_to(Path::new("C:/Downloads/Sub/doc.pdf")));
        assert!(!rule.applies_to(Path::new("C:/Documents/doc.pdf")));
    }

    #[test]
    fn deserializes_lowercase_action_tags() {
        let json = r#"{
            "name": "Sort PDFs",
            "match_criteria": { "extension": "pdf" },
            "action": { "type": "move", "destination": "D:\\Temp" }
        }"#;
        let rule: Rule = serde_json::from_str(json).unwrap();
        assert!(rule.kind.is_empty());
        match rule.action {
            RuleAction::Move { destination } => assert_eq!(destination, "D:\\Temp"),
            _ => panic!("expected Move action"),
        }
    }

    #[test]
    fn roundtrips_frontend_rule_payload() {
        // Mirrors the exact JSON the frontend sends to the `add_rule` command,
        // including explicit nulls for unused match criteria.
        let json = serde_json::json!({
            "name": "Images",
            "watched_folders": ["C:\\Downloads"],
            "kind": [],
            "match_criteria": {
                "extension": null,
                "name_pattern": null,
                "date_after": null,
                "date_before": null
            },
            "action": { "type": "copy", "destination": "D:\\Pictures" }
        });
        let rule: Rule = serde_json::from_value(json).unwrap();
        assert_eq!(rule.name, "Images");
        assert_eq!(rule.watched_folders, vec!["C:\\Downloads"]);
        assert!(rule.kind.is_empty());
        assert_eq!(rule.match_criteria.extension, None);
        match rule.action {
            RuleAction::Copy { destination } => assert_eq!(destination, "D:\\Pictures"),
            _ => panic!("expected Copy action"),
        }
    }
}
