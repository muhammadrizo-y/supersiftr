import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";

type RuleAction =
  | { type: "move"; destination: string }
  | { type: "copy"; destination: string }
  | { type: "rename"; pattern: string };

type ActionType = RuleAction["type"];

type MatchCriteria = {
  extension: string[];
  name_pattern?: string | null;
  date_after?: string | null;
  date_before?: string | null;
};

type Preset = {
  name: string;
  title: string;
  extensions: string[];
};

type Rule = {
  name: string;
  watched_folders: string[];
  kind: string[];
  match_criteria: MatchCriteria;
  action: RuleAction;
};

type AppConfig = {
  rules: Rule[];
};

type ActivityEntry = {
  id: number;
  message: string;
  level: "info" | "error";
};

type RuleFormState = {
  name: string;
  watched_folders: string[];
  kind: string[];
  extension: string[];
  name_pattern: string;
  date_after: string;
  date_before: string;
  action_type: ActionType;
  destination: string;
  pattern: string;
};

const emptyForm: RuleFormState = {
  name: "",
  watched_folders: [],
  kind: [],
  extension: [],
  name_pattern: "",
  date_after: "",
  date_before: "",
  action_type: "move",
  destination: "",
  pattern: "",
};

async function pickFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}

function presetByTitle(presets: Preset[], key: string): string {
  const p = presets.find((x) => x.name === key);
  return p ? p.title : key;
}

/** Deduplicated, sorted extensions across all presets (source list for the
 * extension multiselect). */
function allKnownExtensions(presets: Preset[]): string[] {
  const set = new Set<string>();
  for (const p of presets) for (const e of p.extensions) set.add(e.toLowerCase());
  return Array.from(set).sort();
}

/** Extensions this rule matches: union of its kinds' preset extensions and its
 * own extension list. Mirrors the backend's `resolved_extensions`. */
function resolvedExtensions(rule: Pick<Rule, "kind" | "match_criteria">, presets: Preset[]): string[] {
  const set = new Set<string>();
  for (const name of rule.kind) {
    const p = presets.find((x) => x.name === name);
    if (p) for (const e of p.extensions) set.add(e.toLowerCase());
  }
  for (const e of rule.match_criteria.extension) set.add(e.toLowerCase());
  return Array.from(set).sort();
}

function missingKinds(rule: Pick<Rule, "kind">, presets: Preset[]): string[] {
  return rule.kind.filter((k) => !presets.some((p) => p.name === k));
}

/** Mirrors the backend's `is_runnable`: a rule whose only constraint was a
 * now-missing kind preset has nothing left to run on. */
function isRunnable(rule: Rule, presets: Preset[]): boolean {
  if (resolvedExtensions(rule, presets).length > 0) return true;
  return !!(
    rule.match_criteria.name_pattern ||
    rule.match_criteria.date_after ||
    rule.match_criteria.date_before
  );
}

type SelectOption = { value: string; label: string };

function MultiSelect({
  options,
  selected,
  onChange,
  placeholder,
}: {
  options: SelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}) {
  const merged = options.slice();
  for (const s of selected) {
    if (!merged.some((o) => o.value === s)) merged.push({ value: s, label: s });
  }
  return (
    <select
      multiple
      className="multi-select"
      size={Math.min(8, Math.max(2, merged.length))}
      value={selected}
      onChange={(e) => {
        const values = Array.from(e.currentTarget.selectedOptions, (o) => o.value);
        onChange(values);
      }}
    >
      {merged.length === 0 && placeholder && (
        <option disabled>{placeholder}</option>
      )}
      {merged.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function RuleForm({
  presets,
  onSubmit,
  onCancel,
}: {
  presets: Preset[];
  onSubmit: (rule: Rule) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<RuleFormState>(emptyForm);

  const set = <K extends keyof RuleFormState>(key: K, value: RuleFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function addWatchedFolder() {
    const folder = await pickFolder();
    if (folder && !form.watched_folders.includes(folder)) {
      set("watched_folders", [...form.watched_folders, folder]);
    }
  }

  function removeWatchedFolder(folder: string) {
    set(
      "watched_folders",
      form.watched_folders.filter((f) => f !== folder),
    );
  }

  async function chooseDestination() {
    const folder = await pickFolder();
    if (folder) set("destination", folder);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const criteria: MatchCriteria = {
      extension: form.extension.map((x) => x.trim().toLowerCase()).filter(Boolean),
      name_pattern: form.name_pattern.trim() || null,
      date_after: form.date_after.trim() || null,
      date_before: form.date_before.trim() || null,
    };
    const action: RuleAction =
      form.action_type === "move"
        ? { type: "move", destination: form.destination.trim() }
        : form.action_type === "copy"
          ? { type: "copy", destination: form.destination.trim() }
          : { type: "rename", pattern: form.pattern.trim() };
    onSubmit({
      name: form.name.trim(),
      watched_folders: form.watched_folders,
      kind: form.kind,
      match_criteria: criteria,
      action,
    });
  }

  const kindOptions: SelectOption[] = presets.map((p) => ({ value: p.name, label: p.title }));
  const extOptions: SelectOption[] = allKnownExtensions(presets).map((e) => ({
    value: e,
    label: e,
  }));
  const selectedExtOptions = form.extension.map((e) => ({ value: e, label: e }));
  const extOptionSet = new Set(extOptions.map((o) => o.value));

  return (
    <form className="rule-form" onSubmit={handleSubmit}>
      <label>
        Rule name *
        <input
          value={form.name}
          onChange={(e) => set("name", e.currentTarget.value)}
          placeholder="Sort PDFs"
          required
        />
      </label>

      <fieldset>
        <legend>Watch these folders</legend>
        <p className="hint">Files added to any of these folders will be checked against this rule.</p>
        {form.watched_folders.length === 0 ? (
          <p className="empty">No folders selected yet.</p>
        ) : (
          <ul className="folder-list">
            {form.watched_folders.map((folder) => (
              <li key={folder}>
                <span>{folder}</span>
                <button type="button" onClick={() => removeWatchedFolder(folder)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" onClick={addWatchedFolder} className="secondary">
          + Add folder
        </button>
      </fieldset>

      <fieldset>
        <legend>Match</legend>
        <label>
          Kind
          <MultiSelect
            options={kindOptions}
            selected={form.kind}
            onChange={(values) => set("kind", values)}
          />
        </label>
        <label>
          Extension
          <MultiSelect
            options={extOptions}
            selected={form.extension}
            onChange={(values) => set("extension", values)}
          />
        </label>
        {selectedExtOptions.some((o) => !extOptionSet.has(o.value)) && (
          <p className="hint">
            Custom extensions aren't in any kind preset; you can manage lists in
            Settings.
          </p>
        )}
        <label>
          Name pattern
          <input
            value={form.name_pattern}
            onChange={(e) => set("name_pattern", e.currentTarget.value)}
            placeholder="*invoice*"
          />
        </label>
        <div className="row-grid">
          <label>
            Modified after (YYYY-MM-DD)
            <input
              type="date"
              value={form.date_after}
              onChange={(e) => set("date_after", e.currentTarget.value)}
            />
          </label>
          <label>
            Modified before (YYYY-MM-DD)
            <input
              type="date"
              value={form.date_before}
              onChange={(e) => set("date_before", e.currentTarget.value)}
            />
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Action</legend>
        <div className="action-type">
          {(["move", "copy", "rename"] as ActionType[]).map((t) => (
            <label key={t}>
              <input
                type="radio"
                name="action_type"
                value={t}
                checked={form.action_type === t}
                onChange={() => set("action_type", t)}
              />
              {t}
            </label>
          ))}
        </div>

        {form.action_type === "rename" ? (
          <label>
            Rename pattern (use {"{name}"} for filename)
            <input
              value={form.pattern}
              onChange={(e) => set("pattern", e.currentTarget.value)}
              placeholder="report_{name}"
              required
            />
          </label>
        ) : (
          <div>
            <span className="field-label">Destination folder *</span>
            <div className="picker-row">
              <input
                value={form.destination}
                onChange={(e) => set("destination", e.currentTarget.value)}
                placeholder="D:\Temp"
                required
              />
              <button type="button" onClick={chooseDestination}>
                Browse…
              </button>
            </div>
          </div>
        )}
      </fieldset>

      <div className="form-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit">Add rule</button>
      </div>
    </form>
  );
}

function describeCriteria(criteria: MatchCriteria, kinds: string[]): string {
  const parts: string[] = [];
  if (kinds.length) parts.push(`kinds: ${kinds.join(", ")}`);
  if (criteria.extension.length) parts.push(`extensions: ${criteria.extension.join(", ")}`);
  if (criteria.name_pattern) parts.push(`name matches "${criteria.name_pattern}"`);
  if (criteria.date_after) parts.push(`modified after ${criteria.date_after}`);
  if (criteria.date_before) parts.push(`modified before ${criteria.date_before}`);
  return parts.length ? parts.join(", ") : "any file";
}

function describeAction(action: RuleAction): string {
  switch (action.type) {
    case "move":
      return `Move to ${action.destination}`;
    case "copy":
      return `Copy to ${action.destination}`;
    case "rename":
      return `Rename to ${action.pattern}`;
  }
}

type View =
  | { kind: "rule"; index: number }
  | { kind: "new" }
  | { kind: "activity" }
  | { kind: "settings" };

function PresetForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Preset;
  onSave: (preset: Omit<Preset, "extensions"> & { extensions: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [extensions, setExtensions] = useState(initial?.extensions.join(", ") ?? "");

  return (
    <form
      className="rule-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          name: name.trim(),
          title: title.trim(),
          extensions: extensions.trim(),
        });
      }}
    >
      <label>
        Name (id, kebab-case) *
        <input
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="movie"
          disabled={!!initial}
          required
        />
      </label>
      <label>
        Title *
        <input
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          placeholder="Movie"
          required
        />
      </label>
      <label>
        Extensions (comma separated)
        <input
          value={extensions}
          onChange={(e) => setExtensions(e.currentTarget.value)}
          placeholder="mp4, mkv, mov"
        />
      </label>
      <div className="form-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit">{initial ? "Save" : "Add preset"}</button>
      </div>
    </form>
  );
}

function SettingsTab({
  presets,
  onAdd,
  onUpdate,
  onDelete,
}: {
  presets: Preset[];
  onAdd: (preset: Preset) => void;
  onUpdate: (preset: Preset) => void;
  onDelete: (name: string) => void;
}) {
  const [editing, setEditing] = useState<Preset | "new" | null>(null);

  return (
    <section className="panel">
      <div className="panel-header-inline">
        <h2>Kind presets</h2>
        <button onClick={() => setEditing("new")}>+ Add preset</button>
      </div>
      <p className="hint">
        Kind presets group extensions under a reusable kind. Rules reference
        kinds by id, so renaming a title updates every rule automatically.
      </p>

      {editing && (
        <PresetForm
          initial={editing === "new" ? undefined : editing}
          onSave={(v) => {
            const preset: Preset = {
              name: v.name,
              title: v.title,
              extensions: v.extensions
                .split(",")
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean),
            };
            if (editing === "new") onAdd(preset);
            else onUpdate(preset);
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {presets.length === 0 ? (
        <p className="empty">No kind presets yet.</p>
      ) : (
        <ul className="preset-list">
          {presets.map((p) => (
            <li key={p.name} className="preset-card">
              <div className="preset-title">
                <strong>{p.title}</strong>
                <span className="preset-name">{p.name}</span>
                <div className="preset-actions">
                  <button
                    onClick={() => setEditing(p)}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => onDelete(p.name)}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <p className="preset-extensions">{p.extensions.join(", ")}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function App() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [view, setView] = useState<View>({ kind: "new" });

  const log = useCallback((message: string, level: "info" | "error" = "info") => {
    setActivity((prev) => [...prev, { id: Date.now() + Math.random(), message, level }]);
  }, []);

  useEffect(() => {
    invoke<AppConfig>("get_config").then((config) => {
      setRules(config.rules);
      setView(config.rules.length ? { kind: "rule", index: 0 } : { kind: "new" });
    });
    invoke<Preset[]>("get_presets").then(setPresets);
    invoke<string[]>("get_logs", { count: 200 }).then((logs) =>
      setActivity(logs.map((l, i) => ({ id: i, message: l, level: "info" }))),
    );

    const unlistenLog = listen<{ level: string; message: string }>("log-entry", (e) => {
      log(e.payload.message, e.payload.level === "error" ? "error" : "info");
    });

    return () => {
      unlistenLog.then((f) => f());
    };
  }, [log]);

  async function removeRule(index: number) {
    const updated = await invoke<Rule[]>("remove_rule", { index });
    setRules(updated);
    setView(updated.length ? { kind: "rule", index: 0 } : { kind: "new" });
  }

  async function addRule(rule: Rule) {
    const updated = await invoke<Rule[]>("add_rule", { rule });
    setRules(updated);
    setView({ kind: "rule", index: updated.length - 1 });
    log(`Added rule: ${rule.name}`);
  }

  async function addPreset(preset: Preset) {
    const updated = await invoke<Preset[]>("add_preset", { preset });
    setPresets(updated);
  }

  async function updatePreset(preset: Preset) {
    const updated = await invoke<Preset[]>("update_preset", { preset });
    setPresets(updated);
  }

  async function deletePreset(name: string) {
    const updated = await invoke<Preset[]>("delete_preset", { name });
    setPresets(updated);
    log(`Deleted kind preset: ${name}`);
  }

  function renderRuleDetail(rule: Rule) {
    const missing = missingKinds(rule, presets);
    const runnable = isRunnable(rule, presets);
    return (
      <section className="panel">
        {missing.length > 0 && (
          <div className="banner error">
            Missing kind preset{missing.length > 1 ? "s" : ""}:{" "}
            {missing.map((m) => presetByTitle(presets, m)).join(", ")}. This kind
            preset does not exist.
          </div>
        )}
        {!runnable && (
          <div className="banner error">
            This rule has no valid criteria (missing kind preset) and will never
            run.
          </div>
        )}
        <h2>{rule.name}</h2>
        <div className="rule-body">
          <div className="rule-row">
            <span className="rule-label">Watch</span>
            <ul className="rule-folders">
              {rule.watched_folders.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
          <div className="rule-row">
            <span className="rule-label">Kind</span>
            <span>
              {rule.kind.length === 0 && <span>none</span>}
              {rule.kind.map((k) =>
                presets.some((p) => p.name === k) ? (
                  <span key={k} className="kind-chip">
                    {presetByTitle(presets, k)}
                  </span>
                ) : (
                  <span
                    key={k}
                    className="kind-chip missing"
                    title="This kind preset does not exist"
                  >
                    {k}
                  </span>
                ),
              )}
            </span>
          </div>
          <div className="rule-row">
            <span className="rule-label">Match</span>
            <span>{describeCriteria(rule.match_criteria, rule.kind.map((k) => presetByTitle(presets, k)))}</span>
          </div>
          <div className="rule-row">
            <span className="rule-label">Action</span>
            <span>{describeAction(rule.action)}</span>
          </div>
        </div>
      </section>
    );
  }

  function renderMain() {
    if (view.kind === "new") {
      return (
        <section className="panel">
          <h2>New rule</h2>
          <RuleForm
            presets={presets}
            onSubmit={addRule}
            onCancel={() =>
              setView(rules.length ? { kind: "rule", index: 0 } : { kind: "activity" })
            }
          />
        </section>
      );
    }

    if (view.kind === "activity") {
      return (
        <section className="panel">
          <h2>Activity</h2>
          <ul className="activity-list">
            {activity
              .slice()
              .reverse()
              .map((entry) => (
                <li key={entry.id} className={entry.level}>
                  {entry.message}
                </li>
              ))}
          </ul>
        </section>
      );
    }

    if (view.kind === "settings") {
      return (
        <SettingsTab
          presets={presets}
          onAdd={addPreset}
          onUpdate={updatePreset}
          onDelete={deletePreset}
        />
      );
    }

    const rule = rules[view.index];
    if (!rule) {
      return (
        <section className="panel">
          <p className="empty">No rule selected.</p>
        </section>
      );
    }

    return renderRuleDetail(rule);
  }

  return (
    <main className="app">
      <aside className="sidebar">
        <header className="sidebar-header">
          <h1>File Automation</h1>
          <button
            className="icon-btn"
            title="New rule"
            onClick={() => setView({ kind: "new" })}
          >
            +
          </button>
        </header>

        <nav className="sidebar-rules">
          {rules.map((rule, i) => (
            <div
              key={i}
              className={
                "sidebar-rule" +
                (view.kind === "rule" && view.index === i ? " active" : "")
              }
              onClick={() => setView({ kind: "rule", index: i })}
            >
              <span className="sidebar-rule-name">{rule.name}</span>
              <button
                className="trash-btn"
                title="Delete rule"
                onClick={(e) => {
                  e.stopPropagation();
                  removeRule(i);
                }}
              >
                🗑
              </button>
            </div>
          ))}
        </nav>

        <div className="sidebar-spacer" />

        <button
          className={"sidebar-tab" + (view.kind === "activity" ? " active" : "")}
          onClick={() => setView({ kind: "activity" })}
        >
          Activity
        </button>
        <button
          className={"sidebar-tab" + (view.kind === "settings" ? " active" : "")}
          onClick={() => setView({ kind: "settings" })}
        >
          Settings
        </button>
      </aside>

      <section className="main">{renderMain()}</section>
    </main>
  );
}

export default App;