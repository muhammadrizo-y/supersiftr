import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Activity,
  Check,
  Folder,
  Minus,
  Pencil,
  Plus,
  Settings,
  Square,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

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

/** shadcn/ui combobox pattern (Popover + Command) for multi-select. Selected
 * values render as removable chips; the popover filters and can add custom
 * values (`allowCustom`). */
function Combobox({
  options,
  selected,
  onChange,
  placeholder,
  allowCustom = true,
}: {
  options: SelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  allowCustom?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const merged: SelectOption[] = options.slice();
  for (const s of selected) {
    if (!merged.some((o) => o.value === s)) merged.push({ value: s, label: s });
  }
  const filtered = merged.filter(
    (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
  );
  const exactMatch = merged.some((o) => o.value.toLowerCase() === q);
  const canAddCustom = allowCustom && q.length > 0 && !exactMatch;

  function toggle(value: string) {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );
  }

  function addValue(value: string) {
    const normalized = allowCustom ? value.trim().toLowerCase() : value.trim();
    if (normalized && !selected.includes(normalized)) {
      onChange([...selected, normalized]);
    }
    setQuery("");
    setOpen(true);
  }

  const labelFor = (v: string) =>
    merged.find((o) => o.value === v)?.label ?? v;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className="flex min-h-9 w-full cursor-text flex-wrap items-center gap-1.5 border border-input bg-background px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/40 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {selected.length === 0 && (
            <span className="pl-1 text-muted-foreground">{placeholder}</span>
          )}
          {selected.map((v) => (
            <span
              key={v}
              className="flex items-center gap-1 border border-border bg-muted px-1.5 py-0.5 text-xs"
            >
              {labelFor(v)}
              <span
                role="button"
                tabIndex={-1}
                aria-label={`Remove ${labelFor(v)}`}
                className="flex cursor-pointer text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggle(v);
                }}
              >
                <X className="size-3" />
              </span>
            </span>
          ))}
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search…"
          />
          <CommandList>
            <CommandEmpty>No items found.</CommandEmpty>
            {filtered.map((o) => (
              <CommandItem
                key={o.value}
                value={o.value}
                onSelect={() => {
                  toggle(o.value);
                  setQuery("");
                }}
              >
                <Check
                  className={cn(
                    "size-4",
                    selected.includes(o.value) ? "" : "opacity-0",
                  )}
                />
                {o.label}
              </CommandItem>
            ))}
            {canAddCustom && (
              <CommandItem
                value={query}
                onSelect={() => addValue(query)}
              >
                <Plus className="size-4" />
                Add "{query.trim()}"
              </CommandItem>
            )}
          </CommandList>
          {selected.length > 0 && (
            <div className="border-t border-border">
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                onClick={() => onChange([])}
              >
                Clear all
              </button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
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

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
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

  const kindOptions: SelectOption[] = presets.map((p) => ({
    value: p.name,
    label: p.title,
  }));
  const extOptions: SelectOption[] = allKnownExtensions(presets).map((e) => ({
    value: e,
    label: e,
  }));

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-1.5">
        <Label htmlFor="rule-name">Rule name *</Label>
        <Input
          id="rule-name"
          value={form.name}
          onChange={(e) => set("name", e.currentTarget.value)}
          placeholder="Sort PDFs"
          required
        />
      </div>

      <fieldset className="border border-border p-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Watch
        </legend>
        <p className="mb-2 text-xs text-muted-foreground">
          Files added to any of these folders will be checked against this rule.
        </p>
        {form.watched_folders.length === 0 ? (
          <p className="py-1 text-sm text-muted-foreground">
            No folders selected yet.
          </p>
        ) : (
          <ul className="divide-y divide-border border border-border">
            {form.watched_folders.map((folder) => (
              <li
                key={folder}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <span className="select-text truncate font-mono text-xs">
                  {folder}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  title={`Remove ${folder}`}
                  onClick={() => removeWatchedFolder(folder)}
                >
                  <X className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={addWatchedFolder}
        >
          <Folder className="size-3.5" /> Add folder
        </Button>
      </fieldset>

      <fieldset className="border border-border p-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Match
        </legend>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Kind</Label>
            <Combobox
              options={kindOptions}
              selected={form.kind}
              onChange={(values) => set("kind", values)}
              allowCustom={false}
              placeholder="Select kinds…"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Extension</Label>
            <Combobox
              options={extOptions}
              selected={form.extension}
              onChange={(values) => set("extension", values)}
              allowCustom
              placeholder="Type or select extensions…"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Kinds group extensions (managed in Settings); extensions above are
            matched in addition to any selected kinds.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="name-pattern">Name pattern</Label>
            <Input
              id="name-pattern"
              value={form.name_pattern}
              onChange={(e) => set("name_pattern", e.currentTarget.value)}
              placeholder="*invoice*"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="date-after">Modified after</Label>
              <Input
                id="date-after"
                type="date"
                value={form.date_after}
                onChange={(e) => set("date_after", e.currentTarget.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="date-before">Modified before</Label>
              <Input
                id="date-before"
                type="date"
                value={form.date_before}
                onChange={(e) => set("date_before", e.currentTarget.value)}
              />
            </div>
          </div>
        </div>
      </fieldset>

      <fieldset className="border border-border p-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Action
        </legend>
        <div className="space-y-3">
          <div role="radiogroup" className="flex border border-border">
            {(["move", "copy", "rename"] as ActionType[]).map((t) => (
              <label
                key={t}
                className={cn(
                  "flex-1 cursor-pointer px-3 py-2 text-center text-sm capitalize transition-colors",
                  form.action_type === t
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50",
                  t !== "move" && "border-l border-border",
                )}
              >
                <input
                  type="radio"
                  name="action_type"
                  value={t}
                  checked={form.action_type === t}
                  onChange={() => set("action_type", t)}
                  className="sr-only"
                />
                {t}
              </label>
            ))}
          </div>

          {form.action_type === "rename" ? (
            <div className="space-y-1.5">
              <Label htmlFor="rename-pattern">
                Rename pattern (use {"{name}"} for filename)
              </Label>
              <Input
                id="rename-pattern"
                value={form.pattern}
                onChange={(e) => set("pattern", e.currentTarget.value)}
                placeholder="report_{name}"
                required
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="destination">Destination folder *</Label>
              <div className="flex gap-2">
                <Input
                  id="destination"
                  value={form.destination}
                  onChange={(e) => set("destination", e.currentTarget.value)}
                  placeholder="D:\Temp"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={chooseDestination}
                >
                  <Folder className="size-3.5" /> Browse…
                </Button>
              </div>
            </div>
          )}
        </div>
      </fieldset>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Add rule</Button>
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

function TitleBar() {
  const appWindow = getCurrentWindow();

  return (
    <header
      className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-card"
      data-tauri-drag-region
    >
      <span
        className="pl-3 text-xs font-semibold text-muted-foreground"
        data-tauri-drag-region
      >
        File Automation
      </span>
      <div className="flex h-full items-stretch">
        <button
          type="button"
          title="Minimize"
          onClick={() => appWindow.minimize()}
          className="flex h-full w-11 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <Minus className="size-3.5" />
        </button>
        <button
          type="button"
          title="Maximize"
          onClick={() => appWindow.toggleMaximize()}
          className="flex h-full w-11 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <Square className="size-3" />
        </button>
        <button
          type="button"
          title="Close"
          onClick={() => appWindow.close()}
          className="flex h-full w-11 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </header>
  );
}

function SidebarTab({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-9 w-full cursor-pointer items-center gap-2.5 px-3 text-sm font-medium transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function PresetForm({
  presets,
  initial,
  onSave,
  onCancel,
}: {
  presets: Preset[];
  initial?: Preset;
  onSave: (preset: Preset) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [extensions, setExtensions] = useState<string[]>(initial?.extensions ?? []);

  const extOptions: SelectOption[] = allKnownExtensions(presets).map((e) => ({
    value: e,
    label: e,
  }));

  return (
    <form
      className="mb-4 space-y-3 border border-border bg-muted/30 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          name: name.trim(),
          title: title.trim(),
          extensions,
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="preset-name">Name (id, kebab-case) *</Label>
        <Input
          id="preset-name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="movie"
          disabled={!!initial}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="preset-title">Title *</Label>
        <Input
          id="preset-title"
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          placeholder="Movie"
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label>Extensions</Label>
        <Combobox
          options={extOptions}
          selected={extensions}
          onChange={setExtensions}
          allowCustom
          placeholder="Type or select extensions…"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{initial ? "Save" : "Add preset"}</Button>
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
    <section className="px-6 py-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-base font-semibold">Kind presets</h2>
        <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
          <Plus className="size-3.5" /> Add preset
        </Button>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Kind presets group extensions under a reusable kind. Rules reference
        kinds by id, so renaming a title updates every rule automatically.
      </p>

      {editing && (
        <PresetForm
          presets={presets}
          initial={editing === "new" ? undefined : editing}
          onSave={(preset) => {
            if (editing === "new") onAdd(preset);
            else onUpdate(preset);
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {presets.length === 0 ? (
        <p className="text-sm text-muted-foreground">No kind presets yet.</p>
      ) : (
        <ul className="space-y-2">
          {presets.map((p) => (
            <li key={p.name} className="border border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <strong className="text-sm font-medium">{p.title}</strong>
                <span className="text-xs text-muted-foreground">{p.name}</span>
                <div className="ml-auto flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Edit"
                    onClick={() => setEditing(p)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    title="Delete"
                    onClick={() => onDelete(p.name)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
              <p className="mt-1 select-text text-xs text-muted-foreground">
                {p.extensions.join(", ") || "no extensions"}
              </p>
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
      <section className="px-6 py-5">
        {missing.length > 0 && (
          <div className="mb-4 flex items-start gap-2 border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              Missing kind preset{missing.length > 1 ? "s" : ""}:{" "}
              {missing.map((m) => presetByTitle(presets, m)).join(", ")}. This
              kind preset does not exist.
            </span>
          </div>
        )}
        {!runnable && (
          <div className="mb-4 flex items-start gap-2 border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              This rule has no valid criteria (missing kind preset) and will
              never run.
            </span>
          </div>
        )}
        <h2 className="mb-4 text-base font-semibold">{rule.name}</h2>
        <dl className="grid grid-cols-[92px_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Watch</dt>
          <dd>
            <ul className="space-y-0.5">
              {rule.watched_folders.map((f) => (
                <li key={f} className="select-text font-mono text-xs">
                  {f}
                </li>
              ))}
            </ul>
          </dd>
          <dt className="text-muted-foreground">Kind</dt>
          <dd className="flex flex-wrap items-center gap-1.5">
            {rule.kind.length === 0 && (
              <span className="text-muted-foreground">none</span>
            )}
            {rule.kind.map((k) =>
              presets.some((p) => p.name === k) ? (
                <Badge key={k}>{presetByTitle(presets, k)}</Badge>
              ) : (
                <Badge
                  key={k}
                  variant="destructive"
                  title="This kind preset does not exist"
                >
                  {k}
                </Badge>
              ),
            )}
          </dd>
          <dt className="text-muted-foreground">Match</dt>
          <dd>
            {describeCriteria(
              rule.match_criteria,
              rule.kind.map((k) => presetByTitle(presets, k)),
            )}
          </dd>
          <dt className="text-muted-foreground">Action</dt>
          <dd>{describeAction(rule.action)}</dd>
        </dl>
      </section>
    );
  }

  function renderMain() {
    if (view.kind === "new") {
      return (
        <section className="px-6 py-5">
          <h2 className="mb-4 text-base font-semibold">New rule</h2>
          <RuleForm
            presets={presets}
            onSubmit={addRule}
            onCancel={() =>
              setView(
                rules.length ? { kind: "rule", index: 0 } : { kind: "activity" },
              )
            }
          />
        </section>
      );
    }

    if (view.kind === "activity") {
      return (
        <section className="px-6 py-5">
          <h2 className="mb-4 text-base font-semibold">Activity</h2>
          {activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {activity
                .slice()
                .reverse()
                .map((entry) => (
                  <li
                    key={entry.id}
                    className={cn(
                      "select-text py-1.5 font-mono text-xs",
                      entry.level === "error" && "text-destructive",
                    )}
                  >
                    {entry.message}
                  </li>
                ))}
            </ul>
          )}
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
        <section className="px-6 py-5">
          <p className="text-sm text-muted-foreground">No rule selected.</p>
        </section>
      );
    }

    return renderRuleDetail(rule);
  }

  return (
    <div className="flex h-screen select-none flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card">
          <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
            <h1 className="px-1 text-sm font-semibold">Rules</h1>
            <Button
              size="icon"
              variant="ghost"
              title="New rule"
              onClick={() => setView({ kind: "new" })}
            >
              <Plus className="size-4" />
            </Button>
          </header>

          <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-2">
            {rules.map((rule, i) => (
              <div
                key={i}
                role="button"
                tabIndex={0}
                onClick={() => setView({ kind: "rule", index: i })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    setView({ kind: "rule", index: i });
                  }
                }}
                className={cn(
                  "group flex w-full cursor-pointer items-center justify-between gap-2 px-2 py-1.5 text-sm transition-colors",
                  view.kind === "rule" && view.index === i
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground hover:bg-accent/60",
                )}
              >
                <span className="truncate">{rule.name}</span>
                <button
                  type="button"
                  title="Delete rule"
                  className="flex size-6 shrink-0 cursor-pointer items-center justify-center text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeRule(i);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
            {rules.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                No rules yet.
              </p>
            )}
          </nav>

          <div className="shrink-0 border-t border-border p-2">
            <SidebarTab
              label="Activity"
              icon={<Activity className="size-4" />}
              active={view.kind === "activity"}
              onClick={() => setView({ kind: "activity" })}
            />
            <SidebarTab
              label="Settings"
              icon={<Settings className="size-4" />}
              active={view.kind === "settings"}
              onClick={() => setView({ kind: "settings" })}
            />
          </div>
        </aside>

        <section className="min-w-0 flex-1 divide-y divide-border overflow-y-auto">
          {renderMain()}
        </section>
      </div>
    </div>
  );
}

export default App;