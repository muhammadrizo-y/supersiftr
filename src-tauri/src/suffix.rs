use std::fs;

use serde::Deserialize;

use crate::config::{self, AppConfig};

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

/// Legacy shape of `suffixes.json` (custom compounds lived there before they
/// moved into `config.json` as `compound_extensions`).
#[derive(Debug, Deserialize)]
struct LegacySuffixStore {
    #[serde(default)]
    custom_suffixes: Vec<String>,
}

/// One-time move of custom compounds from `suffixes.json` into the config,
/// then deletion of the legacy file. Returns true if anything changed.
pub fn migrate_legacy_custom(config: &mut AppConfig) -> bool {
    let Ok(dir) = config::config_dir() else { return false };
    migrate_legacy_custom_in(&dir, config)
}

fn migrate_legacy_custom_in(dir: &std::path::Path, config: &mut AppConfig) -> bool {
    let path = dir.join("suffixes.json");
    if !path.exists() {
        return false;
    }
    if let Ok(contents) = fs::read_to_string(&path) {
        if let Ok(store) = serde_json::from_str::<LegacySuffixStore>(&contents) {
            for s in store.custom_suffixes {
                let s = s.trim().to_ascii_lowercase();
                if !s.is_empty()
                    && !DEFAULT_SUFFIXES.contains(&s.as_str())
                    && !config.compound_extensions.contains(&s)
                {
                    config.compound_extensions.push(s);
                }
            }
        }
    }
    let _ = fs::remove_file(path);
    true
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
    fn migrate_legacy_custom_imports_and_deletes() {
        use std::fs;
        let dir = std::env::temp_dir().join(format!("supersiftr_suffix_test_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("suffixes.json");
        fs::write(
            &path,
            r#"{"schema_version":1,"custom_suffixes":[".backup",".backup",".tar.gz"]}"#,
        )
        .unwrap();
        let mut config = AppConfig { compound_extensions: vec![], ..AppConfig::default() };
        let migrated = migrate_legacy_custom_in(&dir, &mut config);
        assert!(migrated);
        assert_eq!(config.compound_extensions, vec![".backup".to_string()]);
        assert!(!path.exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn migrate_legacy_custom_is_noop_without_file() {
        let mut config = AppConfig::default();
        let migrated = migrate_legacy_custom_in(&std::env::temp_dir(), &mut config);
        assert!(!migrated);
        assert!(config.compound_extensions.is_empty());
    }
}
