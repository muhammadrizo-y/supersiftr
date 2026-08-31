import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";

type RuleAction =
  | { type: "Move"; destination: string }
  | { type: "Copy"; destination: string }
  | { type: "Rename"; pattern: string };

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

function App() {
  const [watchedFolders, setWatchedFolders] = useState<string[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);

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
        <h2>Rules</h2>
        {rules.length === 0 ? (
          <p className="empty">
            No rules defined. Add rules to{" "}
            <code>config.json</code> in the app config directory, then restart.
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
