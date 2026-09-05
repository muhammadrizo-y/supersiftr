# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project overview

A **Tauri v2** desktop app for Windows (also macOS/Linux compatible) that automates
file organization. Users define **rules**: when a file matching certain criteria
appears in one of the watched folders, the app moves/copies/renames it or triggers
a preset. A background `notify` watcher reacts to new/changed files.

Stack:
- **Frontend**: React 19 + TypeScript + Vite 7, Tailwind CSS v4, shadcn/ui CLI with
  **Base UI** (`@base-ui/react`) components, Lucide icons, sonner toasts.
- **Backend**: Rust (Tauri v2), `notify`/`notify-debouncer-mini` file watching,
  `glob` pattern matching, `chrono` dates, `serde` JSON config persistence.
- **State**: config (`rules`) and `presets` are read/written as JSON on disk by the
  Rust backend; the UI calls `#[tauri::command]`s exposed over IPC.

## Commands

Run from the repository root (`D:\Muhammadrizo\Code\Rust\file-automation-util`):

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
  - `App.tsx` — the whole app UI (title bar, sidebar, rule list/detail, forms,
    settings, activity log) plus the custom multi-select `Combobox`.
  - `types.ts` — shared TS types mirroring the Rust domain (`Rule`, `Preset`,
    `RuleAction`, `MatchCriteria`, `AppConfig`, `View`).
  - `main.tsx` — entry; syncs window background with `prefers-color-scheme` and
    shows the window after mount.
  - `components/ui/` — shadcn/Base UI primitives (button, badge, card, calendar,
    date-picker, dialog, input, input-group, label, popover, sonner, textarea,
    tooltip, command).
  - `components/Sidebar.tsx` — left nav.
- `src-tauri/` — Rust backend
  - `src/main.rs` — binary entry (thin).
  - `src/lib.rs` — `#[tauri::command]`s + app setup (`run()` in `file_automation_util_lib`).
  - `src/rules.rs` — `Rule`, `MatchCriteria`, `RuleAction`, matching logic (351 lines).
  - `src/actions.rs` — performs the move/copy/rename actions.
  - `src/config.rs` — loads/saves `config.json`.
  - `src/presets.rs` — "kind" presets (named extension sets).
  - `src/state.rs` — `AppState` (mutex-guarded watcher/config/presets/log) + reload.
  - `src/watcher.rs` — `FileWatcher`, debounced recursive + single-file watching.
  - `src/logging.rs` — activity log persisted to disk.
  - `capabilities/default.json` — Tauri permissions for the main window.
  - `tauri.conf.json` — window config, bundle targets.

## Architecture / data flow

- The Rust side owns persistence and file watching. `AppState` holds a
  `Mutex<FileWatcher>`, `Mutex<AppConfig>`, `Mutex<PresetStore>`, and `ActivityLog`.
- The frontend fetches config/presets via commands and sends rule mutations
  (`add_rule`, `remove_rule`, `update_rule`), which save to disk and then restart
  the watchers so the new rules take effect immediately.
- When a watched file event fires, the backend matches it against the rules and
  performs the action, logging an activity entry.
- `View` in `types.ts` drives what content area is shown: rule detail, edit form,
  new rule form, activity log, or settings.

### Key conventions for new rules/actions
- `RuleAction` is a tagged enum serialized to `{ "type": "move" | "copy" | "rename",
  ... }`. Match criteria are extension (list), optional `name_pattern` (glob),
  optional `date_after`/`date_before` (YYYY-MM-DD strings).
- Kind ids reference presets by name (kebab-case); a missing preset contributes no
  extensions but doesn't break the rule (`Rule::missing_kinds`).
- Rules are evaluated in order; `Rule::applies_to` checks `watched_folders`.

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
