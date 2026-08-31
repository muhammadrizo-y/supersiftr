use std::fs;
use std::path::Path;

use chrono::NaiveDate;
use glob::Pattern;
use serde::{Deserialize, Serialize};

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
    #[serde(default)]
    pub match_criteria: MatchCriteria,
    pub action: RuleAction,
}

impl Rule {
    pub fn matches(&self, path: &Path) -> bool {
        let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
            return false;
        };

        if let Some(ext) = &self.match_criteria.extension {
            let actual = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_lowercase());
            if actual.as_deref() != Some(ext.to_lowercase().as_str()) {
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
        assert!(rule.matches(Path::new("doc.pdf")));
        assert!(!rule.matches(Path::new("doc.txt")));
    }

    #[test]
    fn matches_name_pattern() {
        let rule = Rule {
            name: "Invoices".into(),
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
        assert!(rule.matches(Path::new("invoice_001.pdf")));
        assert!(!rule.matches(Path::new("receipt_001.pdf")));
    }

    #[test]
    fn deserializes_lowercase_action_tags() {
        let json = r#"{
            "name": "Sort PDFs",
            "match_criteria": { "extension": "pdf" },
            "action": { "type": "move", "destination": "D:\\Temp" }
        }"#;
        let rule: Rule = serde_json::from_str(json).unwrap();
        match rule.action {
            RuleAction::Move { destination } => assert_eq!(destination, "D:\\Temp"),
            _ => panic!("expected Move action"),
        }
    }
}
