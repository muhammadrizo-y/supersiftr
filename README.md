<p align="center">
  <img src="src-tauri\icons\icon.png" width="64" alt="">
</p>

<h1 align="center">Supersiftr</h1>

<p align="center">
  <a href="https://supersiftr.vercel.app">Website</a> ·
  <a href="https://supersiftr.vercel.app/download">Download</a> ·
  <a href="https://supersiftr.vercel.app/docs">Docs</a> ·
  <a href="https://supersiftr.vercel.app#pricing">Pricing</a>
</p>

<!-- landing cover -->
<!-- <img src=""> -->

Supersiftr is the open-source Windows alternative to Hazel on macOS. It watches
your folders and sorts files automatically the moment they appear — no scripts,
no scheduled scans, no manual dragging. Define a rule once and every download,
screenshot, or export lands where it belongs, named the way you want.

Everything runs locally on your machine. Your rules and your files never leave
it, and the watcher reacts to changes in real time instead of polling on a
timer.

## Why Supersiftr

- **Real-time, not scheduled.** A native file watcher reacts the instant a file
  appears or changes — not minutes later on the next scan.
- **Rules that read like sentences.** Pick watched folders, stack conditions
  (match all or any), and chain actions in order. No scripting required.
- **Modern UI.** A clean, native-feeling interface built for keyboard-first
  workflows.
- **Fast Rust backend.** The watcher and file operations run on Rust — light
  on resources, quick on every event.
- **Kinds keep rules small.** Group extensions under a named kind like
  `Image` or `Movie`, then match whole groups in one condition. Rename a
  kind once and every rule that uses it updates automatically.
- **Compound-extension aware.** Renames preserve endings like `.tar.gz` as a
  unit instead of mangling them into `.gz`.
- **Private by design.** Everything is stored and processed locally. No
  accounts, no telemetry, no cloud.
- **Open source.** The full source is here, licensed under AGPLv3.

## How it works

### Sieves

A **sieve** is a rule: *when a file matching these conditions appears in one of
these folders, run these actions, in order.*

- **Watched folders** — the folders the sieve monitors. New and changed files
  in them are matched against the sieve's conditions.
- **Conditions** — each condition checks one property of a file:
  - **Kind** — matches a named group of extensions (see Kinds below).
  - **Extension** — matches specific extensions, e.g. `pdf`.
  - **Name** — matches the file name with glob patterns, e.g. `invoice*`.
  - **Date modified** — matches files modified before or after a date.
  - **Type** — matches whether the entry is a file or a folder.
  - Operators include *is / is not* and *matches / does not match*, and the
    sieve matches when **all** conditions hold or when **any** of them does.
- **Actions** — run top to bottom when a file matches:
  - **Move** or **Copy** to a folder of your choice.
  - **Rename** using a pattern with the original name, extension, and date
    placeholders.
  - **Delete**, to the Recycle Bin or permanently.

Sieves can be enabled or disabled individually, and every match is recorded in
the activity log so you can always see what moved where, and why.

### Kinds

A **kind** bundles related extensions under a name — `Image` for `png, jpg,
webp`, `archives` for `zip, tar.gz, 7z`, and so on. Sieve conditions match a
kind instead of listing every extension, which keeps rules short and readable.
Supersiftr ships with sensible default kinds, and you can add your own or edit
the defaults. Renaming a kind updates every sieve that references it.

### Settings

- **License** — activate your Pro key to unlock paid features on this device.
  Keys can be deactivated to free a seat for another machine.
- **Run at Startup** — launch Supersiftr automatically when you sign in.
- **Show in System Tray** — keep a tray icon so you can open or quit
  Supersiftr without a taskbar window.
- **Date format** — how dates like `01/02/2026` and natural-language ones
  ("next Friday") are read: US (month/day) or UK (day/month).
- **Kinds** — manage kinds and compound extensions (endings like `.tar.gz`
  that renames treat as a single unit).

## Building from source

```powershell
npm install
npm run tauri dev    # dev server + launch the desktop app
npm run build        # TypeScript check + production build
cargo test           # Rust unit tests (run with workdir src-tauri)
```

Requires Node.js, npm, and the Rust toolchain. Windows is the supported
platform.

## License

- **Open source (AGPLv3)** — the full source code is available here, free for
  everyone to use, study, modify, and share under the
  [GNU AGPLv3](https://www.gnu.org/licenses/agpl-3.0.html).
- **Free for personal use** — the official desktop binary is free for
  individuals.
- **Commercial license** — required to use the official desktop binary in a
  business. **$25 per user, one-time**, and includes Pro features.

In short: the code is open to all, the official binary is free for personal
use, and businesses buy a Pro license per user.
[Get a license →](https://supersiftr.vercel.app/pricing)

Contributions are welcome. By submitting a contribution you agree that it may
be licensed under both AGPLv3 and future commercial licenses of Supersiftr.
