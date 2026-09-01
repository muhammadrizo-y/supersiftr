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
  extension?: string | null;
  name_pattern?: string | null;
  date_after?: string | null;
  date_before?: string | null;
};

type Rule = {
  name: string;
  watched_folders: string[];
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
  extension: string;
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
  extension: "",
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

function RuleForm({ onSubmit, onCancel }: { onSubmit: (rule: Rule) => void; onCancel: () => void }) {
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
      extension: form.extension.trim() || null,
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
      match_criteria: criteria,
      action,
    });
  }

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
          Extension
          <input
            value={form.extension}
            onChange={(e) => set("extension", e.currentTarget.value)}
            placeholder="pdf"
          />
        </label>
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

function describeCriteria(criteria: MatchCriteria): string {
  const parts: string[] = [];
  if (criteria.extension) parts.push(`extension "${criteria.extension}"`);
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
  | { kind: "activity" };

function App() {
  const [rules, setRules] = useState<Rule[]>([]);
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

  function renderMain() {
    if (view.kind === "new") {
      return (
        <section className="panel">
          <h2>New rule</h2>
          <RuleForm
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

    const rule = rules[view.index];
    if (!rule) {
      return (
        <section className="panel">
          <p className="empty">No rule selected.</p>
        </section>
      );
    }

    return (
      <section className="panel">
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
            <span className="rule-label">Match</span>
            <span>{describeCriteria(rule.match_criteria)}</span>
          </div>
          <div className="rule-row">
            <span className="rule-label">Action</span>
            <span>{describeAction(rule.action)}</span>
          </div>
        </div>
      </section>
    );
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
      </aside>

      <section className="main">{renderMain()}</section>
    </main>
  );
}

export default App;
