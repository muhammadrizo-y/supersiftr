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
  match_criteria: MatchCriteria;
  action: RuleAction;
};

type AppConfig = {
  watched_folders: string[];
  rules: Rule[];
};

type ActivityEntry = {
  id: number;
  message: string;
  level: "info" | "error";
};

type RuleFormState = {
  name: string;
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
  extension: "",
  name_pattern: "",
  date_after: "",
  date_before: "",
  action_type: "move",
  destination: "",
  pattern: "",
};

function RuleForm({ onSubmit, onCancel }: { onSubmit: (rule: Rule) => void; onCancel: () => void }) {
  const [form, setForm] = useState<RuleFormState>(emptyForm);

  const set = (key: keyof RuleFormState, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

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
          <label>
            Destination folder *
            <input
              value={form.destination}
              onChange={(e) => set("destination", e.currentTarget.value)}
              placeholder="D:\Temp"
              required
            />
          </label>
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

function App() {
  const [watchedFolders, setWatchedFolders] = useState<string[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [showForm, setShowForm] = useState(false);

  const log = useCallback((message: string, level: "info" | "error" = "info") => {
    setActivity((prev) => [...prev, { id: Date.now() + Math.random(), message, level }]);
  }, []);

  useEffect(() => {
    invoke<string[]>("get_watched_folders").then(setWatchedFolders);
    invoke<AppConfig>("get_config").then((config) => setRules(config.rules));
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

  async function pickFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      const folders = await invoke<string[]>("add_watched_folder", { path: selected });
      setWatchedFolders(folders);
      log(`Watching ${selected}`);
    }
  }

  async function removeFolder(path: string) {
    const folders = await invoke<string[]>("remove_watched_folder", { path });
    setWatchedFolders(folders);
    log(`Stopped watching ${path}`);
  }

  async function removeRule(index: number) {
    const updated = await invoke<Rule[]>("remove_rule", { index });
    setRules(updated);
  }

  async function addRule(rule: Rule) {
    const updated = await invoke<Rule[]>("add_rule", { rule });
    setRules(updated);
    setShowForm(false);
    log(`Added rule: ${rule.name}`);
  }

  return (
    <main className="app">
      <header className="app-header">
        <h1>File Automation</h1>
        <button onClick={pickFolder}>+ Add folder to watch</button>
      </header>

      <section className="panel">
        <h2>Watched Folders</h2>
        {watchedFolders.length === 0 ? (
          <p className="empty">No folders being watched yet.</p>
        ) : (
          <ul className="folder-list">
            {watchedFolders.map((folder) => (
              <li key={folder}>
                <span>{folder}</span>
                <button onClick={() => removeFolder(folder)}>Remove</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Rules</h2>
          <button onClick={() => setShowForm(true)}>+ Add rule</button>
        </div>

        {showForm && (
          <RuleForm onSubmit={addRule} onCancel={() => setShowForm(false)} />
        )}

        {rules.length === 0 ? (
          <p className="empty">
            No rules defined yet. Add your first rule with the button above.
          </p>
        ) : (
          <ul className="rule-list">
            {rules.map((rule, i) => (
              <li key={i}>
                <div className="rule-name">
                  <strong>{rule.name}</strong>
                  <button onClick={() => removeRule(i)}>Remove</button>
                </div>
                <pre>{JSON.stringify(rule, null, 2)}</pre>
              </li>
            ))}
          </ul>
        )}
      </section>

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
    </main>
  );
}

export default App;
