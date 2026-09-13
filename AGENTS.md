# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project overview

A **Tauri v2** desktop app for Windows that automates file organization. Users define **sieves**: when a file matching certain conditions appears in one of the watched folders, the app runs a list of actions (move/copy/rename) or triggers a kind. A background `notify` watcher reacts to new/changed files.

Stack:
- **Frontend**: React 19 + TypeScript + Vite 7, Tailwind CSS v4, shadcn/ui CLI with
  **Base UI** (`@base-ui/react`) components, Lucide icons, sonner toasts.
- **Backend**: Rust (Tauri v2), `notify`/`notify-debouncer-mini` file watching,
  `glob` pattern matching, `chrono` dates, `serde` JSON config persistence.
- **State**: `sieves`, `kinds`, and settings are read/written as JSON on disk by
  the Rust backend; the UI calls `#[tauri::command]`s exposed over IPC.

## Zero-tolerance rules

- **Default to no code comments.** Add a comment only after solving a bug or
  working through a complex issue, and only when it captures non-obvious context
  a future investigator genuinely needs — e.g. why a fix looks the way it does,
  a platform quirk being worked around, or a non-obvious invariant chosen after
  investigation. Banned: narrating what code does, restating types, JSDoc that
  paraphrases parameter names, "TODO: refactor" notes, and comments that just
  describe the change being made. When in doubt, prefer better naming/types over
  a comment. Applies to Rust, TS, and any other language.
- **Do not commit secrets.** Inspect `git status`/`git diff` before committing and
  only stage intended files.
- **Do not start extra dev servers.** Assume the dev server is already running
  when one is needed.

## Commands

```powershell
npm run build        # TypeScript check (tsc) + Vite production build (outputs dist/)
cargo test           # Rust unit tests — run with workdir src-tauri
npm run tauri dev    # Dev server + launch the desktop app
```

**Verification**: always run `npm run build` and `cargo test` after changes before
committing. The user does the real UI testing manually — no screenshots, do not
keep the app running after verifying.

## Post-edit checks (run before you say "done")

Prefer scoped, fast checks over full gates. There is no formatter/linter
configured (no Biome/ESLint/Prettier/rustfmt/clippy config), so rely on the
compiler and tests:

- Touched any Rust file → `cargo test` (run with workdir `src-tauri`).
- Touched any TS/TSX file → `npm run build` (runs `tsc` + Vite build).
- Touched both → run both.

## Rust — write the clean form the FIRST time

No clippy config is enforced in CI, but keep the code idiomatic so it stays
clippy-clean. Prefer the right column:

| ❌ Don't write | ✅ Write instead |
|---|---|
| `dbg!(x)` | delete it |
| `if a { if b { … } }` | `if a && b { … }` |
| `x.clone()` when `x: Copy` | `x` |
| `iter.map(\|x\| foo(x))` | `iter.map(foo)` |
| `fn f(v: &Vec<T>)` / `fn f(s: &String)` | `fn f(v: &[T])` / `fn f(s: &str)` |
| `v.len() == 0` / `v.len() > 0` | `v.is_empty()` / `!v.is_empty()` |
| `opt.unwrap_or_else(\|\| 42)` (cheap default) | `opt.unwrap_or(42)` |
| `for i in 0..v.len() { v[i] … }` | `for item in &v { … }` or `.iter().enumerate()` |
| `value.min(max).max(min)` | `value.clamp(min, max)` |

Handle every `Result`/`Option` explicitly (`?`, `.unwrap()`, `.ok()`, …). For a
`Result` you consciously discard, `let _ = …;` is the correct escape hatch.

## Architecture / data flow

- The Rust side owns persistence and file watching. `AppState` holds a
  `Mutex<FileWatcher>`, `Mutex<SieveStore>`, `Mutex<KindStore>`, and `ActivityLog`.
- The frontend fetches sieves/kinds/settings via commands and sends sieve
  mutations (`add_sieve`, `remove_sieve`, `update_sieve`), which save to disk and
  then restart the watchers so the new sieves take effect immediately. Sieves are
  also hot-reloaded when `sieves.json` changes on disk (the watcher watches it).
- When a watched file event fires, the backend matches it against the sieves and
  performs the actions in order, logging an activity entry.
- `View` in `types.ts` drives what content area is shown: sieve detail, edit form,
  new sieve form, activity log, or settings.

## Styling / UI conventions

- Tailwind CSS v4 with shadcn theme tokens (`bg-background`, `text-foreground`,
  `bg-primary`, `bg-accent`, `bg-muted`, etc.) defined in `src/index.css`. Dark
  mode is driven by `prefers-color-scheme` via `@custom-variant dark`.
- `cn()` (`src/lib/utils.ts`) merges Tailwind classes — use it for conditional
  classes.
- Base UI components use `render={<.../>}` instead of Radix `asChild`.
- Keep tooltips minimal/native (neutral background, quick linear fade, no arrow).

## Commits

- Conventional style: `type(scope): description` (e.g. `feat(conditions): add type
  (file/folder) condition`, `fix(calendar): use base-ui Select for month/year
  dropdowns`). Types seen in history: `feat`, `fix`, `chore`, `refactor`, `test`.
- Commit each logical change separately. When a task spans multiple independent
  changes, make one commit per change rather than one combined commit.
- Stage only the files that belong to the change. Leave unrelated files — and any
  files the user may have edited manually (e.g. `README.md`) — uncommitted or
  unstaged, preserving their original state.
- Never add `Co-authored-by` or other attribution trailers. Commit as the user
  only.

## Gotchas

- Every `add/remove/update_sieve` calls `AppState::restart_watchers`, which stops
  all watchers and re-registers every watched folder. Correct but O(n) per
  mutation with brief coverage drops; accepted tradeoff for a small sieve count
  (no incremental watch management).

## Deep investigation default

When asked to inspect, review, optimize, secure, or fix something, do not stop at
the obvious local change. Trace the full path first:

- identify the real root cause, not only the symptom
- trace callers, side effects, and platform-specific paths (Windows)
- compare old vs new behavior when reviewing a diff
- call out what is verified vs merely plausible
- prefer the smallest correct fix, but only after checking whether the narrow fix
  misses related consequences
