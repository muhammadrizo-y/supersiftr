import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ChevronDown,
  ChevronUp,
  Circle,
  Folder,
  Minus,
  Pencil,
  Plus,
  Square,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
  ActionType,
  AppConfig,
  ActivityEntry,
  MatchCriteria,
  Preset,
  Rule,
  RuleAction,
  View,
} from "@/types";
import Sidebar from "@/components/Sidebar";

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
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const q = query.trim().toLowerCase();
  const labelFor = (v: string) =>
    options.find((o) => o.value === v)?.label ?? v;

  const filtered = options.filter(
    (o) =>
      !selected.includes(o.value) &&
      (q === "" || o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)),
  );

  const showAddRow =
    allowCustom &&
    query.trim() !== "" &&
    !options.some((o) => o.value.toLowerCase() === q) &&
    !selected.includes(query.trim());

  const rows: { type: "existing"; value: string; label: string }[] = filtered.map(
    (o) => ({ type: "existing", value: o.value, label: o.label }),
  );

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function toggle(value: string) {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );
    setQuery("");
    inputRef.current?.focus();
  }

  function addCustom(value: string) {
    const normalized = allowCustom ? value.trim().toLowerCase() : value.trim();
    if (normalized && !selected.includes(normalized)) {
      onChange([...selected, normalized]);
    }
    setQuery("");
    inputRef.current?.focus();
  }

  function removeTag(value: string) {
    onChange(selected.filter((v) => v !== value));
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && query === "" && selected.length > 0) {
      removeTag(selected[selected.length - 1]);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, rows.length + (showAddRow ? 1 : 0) - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const hm = Math.min(highlight, rows.length + (showAddRow ? 1 : 0) - 1);
      if (hm < rows.length) {
        toggle(rows[hm].value);
      } else if (showAddRow) {
        addCustom(query);
      }
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showDropdown = open && (rows.length > 0 || showAddRow || selected.length > 0);

  return (
    <div ref={containerRef} className="relative">
      {showDropdown && (
        <div className="absolute bottom-full left-0 right-0 z-50 mb-1.5 overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md">
          {rows.length === 0 && !showAddRow && (
            <div className="px-3 py-2 text-sm text-muted-foreground">No matches</div>
          )}
          {rows.map((row, i) => {
            const isActive = i === highlight;
            return (
              <div
                key={row.value}
                role="option"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => toggle(row.value)}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <Circle className="size-4 shrink-0 text-muted-foreground" />
                {row.label}
              </div>
            );
          })}
          {showAddRow && (
            <div
              role="option"
              onMouseEnter={() => setHighlight(rows.length)}
              onClick={() => addCustom(query)}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm",
                highlight === rows.length
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Plus className="size-4 shrink-0" />
              <span>
                <span className={cn(highlight === rows.length ? "text-primary-foreground/70" : "text-muted-foreground")}>
                  Add:{" "}
                </span>
                {query.trim()}
              </span>
            </div>
          )}
        </div>
      )}

      <div
        className="flex min-h-8 w-full cursor-text flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/40 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50"
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        {selected.length === 0 && !query && (
          <span className="pl-1 text-muted-foreground">{placeholder}</span>
        )}
        {selected.map((v) => (
          <span
            key={v}
            className="flex items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs"
          >
            {labelFor(v)}
            <button
              type="button"
              aria-label={`Remove ${labelFor(v)}`}
              onClick={(e) => {
                e.stopPropagation();
                removeTag(v);
              }}
              className="flex cursor-pointer rounded-sm p-0.5 text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={selected.length === 0 ? placeholder : ""}
          className="min-w-15 flex-1 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={open ? "Close dropdown" : "Open dropdown"}
        >
          {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
      </div>
    </div>
  );
}

function formFromRule(rule?: Rule): RuleFormState {
  if (!rule) return { ...emptyForm };
  return {
    name: rule.name,
    watched_folders: rule.watched_folders,
    kind: rule.kind,
    extension: rule.match_criteria.extension,
    name_pattern: rule.match_criteria.name_pattern ?? "",
    date_after: rule.match_criteria.date_after ?? "",
    date_before: rule.match_criteria.date_before ?? "",
    action_type: rule.action.type,
    destination:
      rule.action.type === "move" || rule.action.type === "copy"
        ? rule.action.destination
        : "",
    pattern: rule.action.type === "rename" ? rule.action.pattern : "",
  };
}
function RuleForm({
  presets,
  initial,
  onSubmit,
  onCancel,
}: {
  presets: Preset[];
  initial?: Rule;
  onSubmit: (rule: Rule) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<RuleFormState>(() => formFromRule(initial));

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

      <fieldset className="rounded-lg border border-border p-4">
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
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {form.watched_folders.map((folder) => (
              <li
                key={folder}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <span className="select-text truncate font-mono text-xs">
                  {folder}
                </span>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0"
                        onClick={() => removeWatchedFolder(folder)}
                      >
                        <X className="size-3.5" />
                      </Button>
                    }
                  />
                  <TooltipContent>Remove {folder}</TooltipContent>
                </Tooltip>
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

      <fieldset className="rounded-lg border border-border p-4">
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
              <Label>Modified after</Label>
              <DatePicker
                value={form.date_after}
                onChange={(value) => set("date_after", value)}
                placeholder="Pick a date"
                className="w-full"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Modified before</Label>
              <DatePicker
                value={form.date_before}
                onChange={(value) => set("date_before", value)}
                placeholder="Pick a date"
                className="w-full"
              />
            </div>
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-border p-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Action
        </legend>
        <div className="space-y-3">
          <div
            role="radiogroup"
            aria-label="Action"
            className="flex overflow-hidden rounded-lg border border-border"
          >
            {(["move", "copy", "rename"] as ActionType[]).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={form.action_type === t}
                onClick={() => set("action_type", t)}
                className={cn(
                  "flex-1 cursor-pointer px-3 py-2 text-center text-sm capitalize transition-colors",
                  form.action_type === t
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50",
                  t !== "move" && "border-l border-border",
                )}
              >
                {t}
              </button>
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
        <Button type="submit">{initial ? "Save changes" : "Add rule"}</Button>
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

function TitleBar() {
  const appWindow = getCurrentWindow();

  return (
    <header
      className="flex h-8 shrink-0 items-center justify-between bg-card"
      data-tauri-drag-region
    >
      <span
        className="pl-3 text-xs font-semibold text-muted-foreground"
        data-tauri-drag-region
      >
        Supersiftr
      </span>
      <div className="flex h-full items-stretch">
        <button
          type="button"
          title="Minimize"
          onClick={() => appWindow.minimize()}
          className="flex w-11 cursor-pointer items-center justify-center text-foreground/80 transition-colors hover:bg-foreground/10"
        >
          <Minus className="size-3" />
        </button>
        <button
          type="button"
          title="Maximize"
          onClick={() => appWindow.toggleMaximize()}
          className="flex w-11 cursor-pointer items-center justify-center text-foreground/80 transition-colors hover:bg-foreground/10"
        >
          <Square className="size-2.5" />
        </button>
        <button
          type="button"
          title="Close"
          onClick={() => appWindow.close()}
          className="flex w-11 cursor-pointer items-center justify-center text-foreground/80 transition-colors hover:bg-[#c42b1c] hover:text-white"
        >
          <X className="size-3" />
        </button>
      </div>
    </header>
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
      className="mb-4 space-y-3 rounded-lg border border-border bg-muted/30 p-4"
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
            <li key={p.name} className="rounded-lg border border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <strong className="text-sm font-medium">{p.title}</strong>
                <span className="text-xs text-muted-foreground">{p.name}</span>
                <div className="ml-auto flex gap-1">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing(p)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                      }
                    />
                    <TooltipContent>Edit</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => onDelete(p.name)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      }
                    />
                    <TooltipContent>Delete</TooltipContent>
                  </Tooltip>
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
    toast.success("Rule deleted");
  }

  async function addRule(rule: Rule) {
    const updated = await invoke<Rule[]>("add_rule", { rule });
    setRules(updated);
    setView({ kind: "rule", index: updated.length - 1 });
    log(`Added rule: ${rule.name}`);
    toast.success(`Rule "${rule.name}" created`);
  }

  async function updateRule(index: number, rule: Rule) {
    const updated = await invoke<Rule[]>("update_rule", { index, rule });
    setRules(updated);
    setView({ kind: "rule", index });
    log(`Updated rule: ${rule.name}`);
    toast.success(`Rule "${rule.name}" updated`);
  }

  async function addPreset(preset: Preset) {
    const updated = await invoke<Preset[]>("add_preset", { preset });
    setPresets(updated);
    toast.success(`Preset "${preset.title}" created`);
  }

  async function updatePreset(preset: Preset) {
    const updated = await invoke<Preset[]>("update_preset", { preset });
    setPresets(updated);
  }

  async function deletePreset(name: string) {
    const updated = await invoke<Preset[]>("delete_preset", { name });
    setPresets(updated);
    log(`Deleted kind preset: ${name}`);
    toast.success(`Preset "${name}" deleted`);
  }

  function renderRuleDetail(rule: Rule, index: number) {
    const missing = missingKinds(rule, presets);
    const runnable = isRunnable(rule, presets);
    return (
      <section className="px-6 py-5">
        {missing.length > 0 && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              Missing kind preset{missing.length > 1 ? "s" : ""}:{" "}
              {missing.map((m) => presetByTitle(presets, m)).join(", ")}. This
              kind preset does not exist.
            </span>
          </div>
        )}
        {!runnable && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              This rule has no valid criteria (missing kind preset) and will
              never run.
            </span>
          </div>
        )}
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{rule.name}</h2>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setView({ kind: "edit", index })}
                >
                  <Pencil className="size-3.5" /> Edit
                </Button>
              }
            />
            <TooltipContent>Edit this rule</TooltipContent>
          </Tooltip>
        </div>
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
                <Tooltip key={k}>
                  <TooltipTrigger
                    render={<Badge variant="destructive">{k}</Badge>}
                  />
                  <TooltipContent>
                    This kind preset does not exist
                  </TooltipContent>
                </Tooltip>
              )
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

    if (view.kind === "edit") {
      return (
        <section className="px-6 py-5">
          <h2 className="mb-4 text-base font-semibold">Edit rule</h2>
          <RuleForm
            key={view.index}
            presets={presets}
            initial={rule}
            onSubmit={(updated) => void updateRule(view.index, updated)}
            onCancel={() => setView({ kind: "rule", index: view.index })}
          />
        </section>
      );
    }

    return renderRuleDetail(rule, view.index);
  }

  return (
    <TooltipProvider>
      <div
        className="flex h-full select-none flex-col overflow-hidden"
        onContextMenu={(e) => e.preventDefault()}
      >
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          <Sidebar
            rules={rules}
            view={view}
            onSelect={setView}
            onDelete={(index) => void removeRule(index)}
          />

          <section className="min-w-0 flex-1 divide-y divide-border overflow-y-auto">
            {renderMain()}
          </section>
        </div>
      </div>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}

export default App;