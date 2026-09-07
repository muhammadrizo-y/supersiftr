# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project overview

A **Tauri v2** desktop app for Windows (also macOS/Linux compatible) that automates
file organization. Users define **sieves**: when a file matching certain
conditions appears in one of the watched folders, the app runs a list of actions
(move/copy/rename) or triggers a preset. A background `notify` watcher reacts to
new/changed files.

Stack:
- **Frontend**: React 19 + TypeScript + Vite 7, Tailwind CSS v4, shadcn/ui CLI with
  **Base UI** (`@base-ui/react`) components, Lucide icons, sonner toasts.
- **Backend**: Rust (Tauri v2), `notify`/`notify-debouncer-mini` file watching,
  `glob` pattern matching, `chrono` dates, `serde` JSON config persistence.
- **State**: `sieves`, `presets`, and settings are read/written as JSON on disk by
  the Rust backend; the UI calls `#[tauri::command]`s exposed over IPC.

## Commands

Run from the repository root (`D:\Muhammadrizo\Code\supersiftr`):

```powershell
npm run build        # TypeScript check (tsc) + Vite production build (outputs dist/)
cargo test           # Rust unit tests — run with workdir src-tauri
npm run tauri dev    # Dev server + launch the desktop app
```

**Verification**: always run `npm run build` and `cargo test` after changes before
committing. The user does the real UI testing manually — no screenshots, do not
keep the app running after verifying.

## Project layout

- `src/` — React frontend
  - `App.tsx` — the whole app UI (title bar, sidebar, sieve list/detail, forms,
    settings, activity log) plus the custom multi-select `Combobox`.
  - `types.ts` — shared TS types mirroring the Rust domain (`Sieve`, `Preset`,
    `RuleAction`, `SieveCondition`, `AppConfig`, `View`).
  - `main.tsx` — entry; syncs window background with `prefers-color-scheme` and
    shows the window after mount.
  - `components/ui/` — shadcn/Base UI primitives (button, badge, card, calendar,
    date-picker, dialog, input, input-group, label, popover, sonner, textarea,
    tooltip, command).
  - `components/Sidebar.tsx` — left nav.
- `src-tauri/` — Rust backend
  - `src/main.rs` — binary entry (thin).
  - `src/lib.rs` — `#[tauri::command]`s + app setup (`run()` in `supersiftr_lib`).
  - `src/sieves.rs` — `Sieve`, `SieveCondition`, `RuleAction`, matching logic.
  - `src/actions.rs` — performs the move/copy/rename actions.
  - `src/config.rs` — loads/saves `config.json` (settings only).
  - `src/presets.rs` — "kind" presets (named extension sets).
  - `src/state.rs` — `AppState` (mutex-guarded watcher/sieves/presets/log) + reload.
  - `src/watcher.rs` — `FileWatcher`, debounced recursive + single-file watching.
  - `src/logging.rs` — activity log persisted to disk.
  - `capabilities/default.json` — Tauri permissions for the main window.
  - `tauri.conf.json` — window config, bundle targets.

## Architecture / data flow

- The Rust side owns persistence and file watching. `AppState` holds a
  `Mutex<FileWatcher>`, `Mutex<SieveStore>`, `Mutex<PresetStore>`, and `ActivityLog`.
- The frontend fetches sieves/presets/settings via commands and sends sieve
  mutations (`add_sieve`, `remove_sieve`, `update_sieve`), which save to disk and
  then restart the watchers so the new sieves take effect immediately. Sieves are
  also hot-reloaded when `sieves.json` changes on disk (the watcher watches it).
- When a watched file event fires, the backend matches it against the sieves and
  performs the actions in order, logging an activity entry.
- `View` in `types.ts` drives what content area is shown: sieve detail, edit form,
  new sieve form, activity log, or settings.

### Key conventions for new sieves/actions
- `Sieve` is `{ name, watched_folders, mode: all|any, conditions, actions }`.
  `SieveCondition` is `{ property: kind|extension|name|modified, operator, values }`:
  kind/extension use `is`/`is_not`; name uses `matches`/`not_matches`; modified uses
  `after`/`before`. Kind values are preset ids; extension/name values are lists;
  modified uses a single YYYY-MM-DD in `values[0]`.
- `RuleAction` is a tagged enum serialized to `{ "type": "move" | "copy" | "rename",
  ... }` with `destination` or `pattern`; rename patterns can contain `{name}`.
- Kind ids reference presets by name (kebab-case); a missing preset contributes no
  extensions for `is` but matches everything for `is_not` and doesn't break the
  sieve (`Sieve::missing_kinds`).
- Sieves are evaluated in order; `Sieve::applies_to` checks `watched_folders`.
  Empty conditions never match; `Sieve::is_runnable` requires >=1 condition and
  >=1 action.
- Versioning: each JSON file (`config.json`, `sieves.json`, `kinds.json`,
  `default_kinds.json`) carries its own integer `"schema_version"` field,
  independently maintained per file (`CONFIG_SCHEMA_VERSION`,
  `SIEVES_SCHEMA_VERSION`, `PRESETS_SCHEMA_VERSION`,
  `DEFAULT_KINDS_SCHEMA_VERSION`, currently all 1) that only bumps on that
  file's schema breaks. Loading is tolerant: missing/unknown versions are
  treated as latest. Migrations (per-file version dispatch) are not
  implemented yet.

## Windows / window management

- `decorations: false` → custom title bar in `TitleBar()` (`src/App.tsx`) with
  native-looking minimize/maximize/close buttons using `title` attributes (native
  OS tooltips). Tauri's `titleBarStyle: "Overlay"`/`hiddenTitle` are macOS-only;
  on Windows there's no native control overlay, so controls are custom HTML.
- Window starts hidden (`visible: false`) and is shown from the frontend after
  mount to avoid white flash; background color is synced with the OS theme.
- Watch out: layout must stay desktop-safe (sidebar flush/square, body
  `overflow-hidden`, `h-full`).

## Styling / UI conventions

- Tailwind CSS v4 with shadcn theme tokens (`bg-background`, `text-foreground`,
  `bg-primary`, `bg-accent`, `bg-muted`, etc.) defined in `src/index.css`. Dark
  mode is driven by `prefers-color-scheme` via `@custom-variant dark`.
- `cn()` (`src/lib/utils.ts`) merges Tailwind classes — use it for conditional
  classes.
- Base UI components use `render={<.../>}` instead of Radix `asChild`.
- Keep tooltips minimal/native (neutral background, quick linear fade, no arrow).
- Follow the existing one-commit-per-logical-change style with conventional commit
  messages: `type(scope): description`.

## Gotchas

- Do not add code comments unless requested.
- Do not commit secrets. Inspect `git status`/`git diff` before committing and only
  stage intended files.
