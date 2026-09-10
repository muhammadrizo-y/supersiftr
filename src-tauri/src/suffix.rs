use std::sync::OnceLock;

use regex::Regex;

/// Known compound filename suffixes that a rename should preserve as a unit.
/// A suffix is the complete meaningful ending of a filename (e.g. `tar.gz`),
/// whereas an extension is only its final component (`gz`). Longest match wins
/// so that `tar.gz` beats `gz`.
pub const DEFAULT_SUFFIXES: &[&str] = &[
    "tar.gz",
    "tar.bz2",
    "tar.xz",
    "tar.zst",
    "d.ts",
    "test.ts",
    "spec.ts",
    "min.js",
];

fn suffix_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[a-zA-Z0-9]+(?:\.[a-zA-Z0-9]+)+$").expect("valid regex"))
}

/// Splits a filename into its basename and suffix at the first slice of the
/// longest configured suffix that the name ends with (case-insensitively).
/// Falls back to the final dot extension when nothing matches; a dotfile
/// (`.bashrc`) has no suffix.
///
/// `custom` is the user-supplied suffix list; the built-in defaults are always
/// considered first. Entries may carry a leading dot (legacy data) or not.
/// Returns `(basename, suffix)` where `basename + suffix == file_name`.
pub fn split<'a>(file_name: &'a str, custom: &[String]) -> (&'a str, &'a str) {
    let lowercase = file_name.to_ascii_lowercase();
    let mut best_len = 0usize;
    for s in DEFAULT_SUFFIXES
        .iter()
        .copied()
        .chain(custom.iter().map(String::as_str))
    {
        let configured = format!(".{}", s.trim_start_matches('.'));
        if lowercase.len() > configured.len()
            && lowercase.ends_with(&configured)
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

/// Normalizes a user-entered suffix: trims and lowercases, then requires the
/// compound shape `part.part` (at least two dot-separated alphanumeric
/// segments). Returns `None` for blanks, malformed values, duplicates, and
/// values already covered by the built-in defaults.
pub fn normalize_custom_suffix(input: &str, existing: &[String]) -> Option<String> {
    let s = input.trim().to_ascii_lowercase();
    if !suffix_regex().is_match(&s) {
        return None;
    }
    if DEFAULT_SUFFIXES.contains(&s.as_str()) || existing.iter().any(|e| e == &s) {
        return None;
    }
    Some(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn custom(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn longest_match_wins() {
        assert_eq!(split("old_name.tar.gz", &custom(&["tar.gz"])), ("old_name", ".tar.gz"));
    }

    #[test]
    fn default_compound_is_recognized() {
        // tar.gz is a built-in default, no custom needed.
        assert_eq!(split("old_name.tar.gz", &[]), ("old_name", ".tar.gz"));
    }

    #[test]
    fn matching_is_case_insensitive() {
        assert_eq!(split("PHOTO.TAR.GZ", &[]), ("PHOTO", ".TAR.GZ"));
        assert_eq!(split("docs.min.JS", &custom(&["min.js"])), ("docs", ".min.JS"));
        assert_eq!(
            split("archive.TAR.xz", &custom(&["tar.xz", "TAR.GZ"])),
            ("archive", ".TAR.xz")
        );
    }

    #[test]
    fn custom_compound_preserved() {
        assert_eq!(split("index.test.ts", &custom(&["test.ts"])), ("index", ".test.ts"));
        // Legacy dotted entries still match.
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
    fn normalize_accepts_compound_and_lowercases() {
        assert_eq!(normalize_custom_suffix("notes.backup", &[]), Some("notes.backup".into()));
        assert_eq!(normalize_custom_suffix("TAR.GZ", &[]), None); // built-in default
        assert_eq!(normalize_custom_suffix("backup.TAR.xz", &[]), Some("backup.tar.xz".into()));
        assert_eq!(normalize_custom_suffix("a.b", &[]), Some("a.b".into()));
    }

    #[test]
    fn normalize_rejects_malformed() {
        assert_eq!(normalize_custom_suffix(".tar.gz", &[]), None); // leading dot
        assert_eq!(normalize_custom_suffix("gz", &[]), None); // single part
        assert_eq!(normalize_custom_suffix("a..b", &[]), None); // empty part
        assert_eq!(normalize_custom_suffix("a b.c", &[]), None); // space
        assert_eq!(normalize_custom_suffix("", &[]), None);
        assert_eq!(normalize_custom_suffix("  ", &[]), None);
    }

    #[test]
    fn normalize_rejects_duplicates_and_defaults() {
        assert_eq!(normalize_custom_suffix("a.b", &custom(&["a.b"])), None);
        assert_eq!(normalize_custom_suffix("A.B", &custom(&["a.b"])), None);
        assert_eq!(normalize_custom_suffix("d.ts", &[]), None); // built-in default
    }
}