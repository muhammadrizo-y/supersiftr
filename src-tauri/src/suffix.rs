use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::config::{self, ConfigError};

/// Known compound filename suffixes that a rename should preserve as a unit.
/// A suffix is the complete meaningful ending of a filename (e.g. `.tar.gz`),
/// whereas an extension is only its final component (`.gz`). Longest match wins
/// so that `.tar.gz` beats `.gz`.
pub const DEFAULT_SUFFIXES: &[&str] = &[
    ".tar.gz",
    ".tar.bz2",
    ".tar.xz",
    ".tar.zst",
    ".d.ts",
    ".test.ts",
    ".spec.ts",
    ".min.js",
];

/// Current schema version of `suffixes.json`.
pub const SUFFIXES_SCHEMA_VERSION: u32 = 1;

/// Splits a filename into its basename and suffix at the first slice of the
/// longest configured suffix that the name ends with. Falls back to the final
/// dot extension when nothing matches; a dotfile (`.bashrc`) has no suffix.
///
/// `custom` is the user-supplied suffix list; the built-in defaults are always
/// considered first. Returns `(basename, suffix)` where `basename + suffix ==
/// file_name`.
pub fn split<'a>(file_name: &'a str, custom: &[String]) -> (&'a str, &'a str) {
    let mut best_len = 0usize;
    for configured in DEFAULT_SUFFIXES
        .iter()
        .map(|s| *s)
        .chain(custom.iter().map(|s| s.as_str()))
    {
        if file_name.len() > configured.len()
            && file_name.ends_with(configured)
            && configured.len() > best_len
        {
            best_len = configured.len();
        }
    }
    if best_len > 0 {
        return (
            &file_name[..file_name.len() - best_len],
            &file_name[file_name.len() - best_len..],
        );
    }
    match file_name.rfind('.') {
        Some(i) if i > 0 => (&file_name[..i], &file_name[i..]),
        _ => (file_name, ""),
    }
}

/// Normalizes a user-entered suffix: trims, lowercases, and requires a leading
/// dot. Returns `None` for blanks, duplicates, and values already covered by
/// the built-in defaults.
pub fn normalize_custom_suffix(input: &str, existing: &[String]) -> Option<String> {
    let s = input.trim().to_ascii_lowercase();
    if s.is_empty() {
        return None;
    }
    let s = if s.starts_with('.') { s } else { format!(".{s}") };
    if DEFAULT_SUFFIXES.contains(&s.as_str()) || existing.iter().any(|e| e == &s) {
        return None;
    }
    Some(s)
}

/// Full list of every supported suffix (built-in defaults + deduped custom).
pub fn all_suffixes(custom: &[String]) -> Vec<String> {
    let mut all: Vec<String> = DEFAULT_SUFFIXES.iter().map(|s| s.to_string()).collect();
    for c in custom {
        let s = c.trim().to_ascii_lowercase();
        if !s.is_empty() && !all.contains(&s) {
            all.push(s);
        }
    }
    all
}

/// Persisted custom-suffix store, `suffixes.json` (independent of config.json).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuffixStore {
    pub schema_version: u32,
    #[serde(default)]
    pub custom_suffixes: Vec<String>,
}

impl Default for SuffixStore {
    fn default() -> Self {
        Self {
            schema_version: SUFFIXES_SCHEMA_VERSION,
            custom_suffixes: Vec::new(),
        }
    }
}

pub fn suffixes_path() -> Result<PathBuf, ConfigError> {
    Ok(config::config_dir()?.join("suffixes.json"))
}

pub fn load() -> Result<SuffixStore, ConfigError> {
    let path = suffixes_path()?;
    if !path.exists() {
        return Ok(SuffixStore::default());
    }
    let contents = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&contents)?)
}

pub fn save(store: &SuffixStore) -> Result<(), ConfigError> {
    let path = suffixes_path()?;
    let contents = serde_json::to_string_pretty(store)?;
    fs::write(path, contents)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn custom(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn longest_match_wins() {
        assert_eq!(split("old_name.tar.gz", &custom(&[".tar.gz"])), ("old_name", ".tar.gz"));
    }

    #[test]
    fn default_compound_is_recognized() {
        // .tar.gz is a built-in default, no custom needed.
        assert_eq!(split("old_name.tar.gz", &[]), ("old_name", ".tar.gz"));
    }

    #[test]
    fn custom_compound_preserved() {
        assert_eq!(split("index.test.ts", &custom(&[".test.ts"])), ("index", ".test.ts"));
    }

    #[test]
    fn fallback_to_final_extension() {
        assert_eq!(split("report.final.pdf", &[]), ("report.final", ".pdf"));
        assert_eq!(split("2026-09-07_19.32.17.png", &[]), ("2026-09-07_19.32.17", ".png"));
        // A compound that is NOT a configured default still only keeps the last part.
        assert_eq!(split("old_name.tar.zs", &[]), ("old_name.tar", ".zs"));
    }

    #[test]
    fn dotfile_has_no_suffix() {
        assert_eq!(split(".bashrc", &[]), (".bashrc", ""));
    }

    #[test]
    fn no_extension_no_suffix() {
        assert_eq!(split("README", &[]), ("README", ""));
    }

    #[test]
    fn normalize_requires_dot_and_rejects_defaults() {
        assert_eq!(normalize_custom_suffix("gz", &[]), Some(".gz".into()));
        assert_eq!(normalize_custom_suffix("extra.ext", &[]), Some(".extra.ext".into()));
        assert_eq!(normalize_custom_suffix(".dup", &custom(&[".dup"])), None);
        assert_eq!(normalize_custom_suffix("  ", &[]), None);
        assert_eq!(normalize_custom_suffix("tar.gz", &[]), None); // built-in default
    }

    #[test]
    fn all_suffixes_dedupes() {
        let all = all_suffixes(&custom(&[".tar.gz", ".custom"]) );
        assert!(all.contains(&".tar.gz".to_string()));
        assert!(all.contains(&".custom".to_string()));
        // .tar.gz appears only once even though it's also a default.
        let count = all.iter().filter(|s| *s == ".tar.gz").count();
        assert_eq!(count, 1);
    }
}
