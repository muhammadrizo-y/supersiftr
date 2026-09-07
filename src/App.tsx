import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ChevronDown,
  ChevronUp,
  File,
  Folder,
  Image,
  Minus,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
  Video,
  X,
} from "lucide-react";

import closeIcon from "@/assets/close.svg?raw";
import maximizeIcon from "@/assets/maximize.svg?raw";
import minimizeIcon from "@/assets/minimize.svg?raw";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  ActivityEntry,
  AppConfig,
  ConditionMode,
  ConditionOperator,
  ConditionProperty,
  Preset,
  RuleAction,
  Sieve,
  SieveCondition,
  View,
} from "@/types";
import Sidebar from "@/components/Sidebar";

type ConditionRowState = {
  property: ConditionProperty;
  operator: ConditionOperator;
  values: string[];
};

type ActionRowState = {
  type: ActionType;
  folder: string;
  name: string;
};

type SieveFormState = {
  name: string;
  watched_folders: string[];
  mode: ConditionMode;
  conditions: ConditionRowState[];
  actions: ActionRowState[];
};

const PROPERTY_OPTIONS: { value: ConditionProperty; label: string }[] = [
  { value: "kind", label: "Kind" },
  { value: "extension", label: "Extension" },
  { value: "name", label: "Name" },
  { value: "modified", label: "Modified" },
];

const OPERATOR_OPTIONS: Record<
  ConditionProperty,
  { value: ConditionOperator; label: string }[]
> = {
  kind: [
    { value: "is", label: "is" },
    { value: "is_not", label: "isn't" },
  ],
  extension: [
    { value: "is", label: "is" },
    { value: "is_not", label: "isn't" },
  ],
  name: [
    { value: "matches", label: "matches" },
    { value: "not_matches", label: "doesn't match" },
  ],
  modified: [
    { value: "after", label: "after" },
    { value: "before", label: "before" },
  ],
};

const ACTION_OPTIONS: { value: ActionType; label: string }[] = [
  { value: "move", label: "Move" },
  { value: "copy", label: "Copy" },
  { value: "rename", label: "Rename" },
];

const emptyForm: SieveFormState = {
  name: "",
  watched_folders: [],
  mode: "all",
  conditions: [],
  actions: [],
};

async function pickFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}

function presetByTitle(presets: Preset[], key: string): string {
  const p = presets.find((x) => x.name === key);
  return p ? p.title : key;
}

function allKnownExtensions(presets: Preset[]): string[] {
  const set = new Set<string>();
  for (const p of presets) for (const e of p.extensions) set.add(e.toLowerCase());
  return Array.from(set).sort();
}

function missingKinds(sieve: Sieve, presets: Preset[]): string[] {
  const set = new Set<string>();
  for (const c of sieve.conditions) {
    if (c.property !== "kind") continue;
    for (const v of c.values) {
      if (!presets.some((p) => p.name === v)) set.add(v);
    }
  }
  return Array.from(set);
}

function isRunnable(sieve: Sieve): boolean {
  return sieve.conditions.length > 0 && sieve.actions.length > 0;
}

type SelectOption = { value: string; label: string };

const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "bmp",
  "svg",
  "ico",
  "tiff",
  "tif",
  "avif",
  "heic",
  "heif",
]);

const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "mkv",
  "avi",
  "mov",
  "webm",
  "m4v",
  "wmv",
  "flv",
  "mpg",
  "mpeg",
  "3gp",
  "ts",
  "mts",
]);

function itemIcon(value: string) {
  const ext = value.toLowerCase().replace(/^[.*]*\./, "");
  if (IMAGE_EXTENSIONS.has(ext)) return Image;
  if (VIDEO_EXTENSIONS.has(ext)) return Video;
  return File;
}

function Combobox({
  options,
  selected,
  onChange,
  placeholder,
  allowCustom = true,
  onBlur,
}: {
  options: SelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  allowCustom?: boolean;
  onBlur?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

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
    if (!open) return;
    const list = listRef.current;
    const row = rowRefs.current[highlight];
    if (!list || !row) return;
    const rowTop = row.offsetTop;
    const rowBottom = rowTop + row.offsetHeight;
    if (rowTop < list.scrollTop) {
      list.scrollTop = rowTop;
    } else if (rowBottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = rowBottom - list.clientHeight;
    }
  }, [open, highlight]);

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
      if (!open) return;
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
        <div
          ref={listRef}
          className="absolute bottom-full left-0 right-0 z-50 mb-1.5 max-h-56 overflow-y-auto overscroll-contain rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 scrollbar-gutter-stable duration-100 animate-in fade-in-0"
        >
          {rows.length === 0 && !showAddRow && (
            <div className="px-3 py-2 text-sm text-muted-foreground">No matches</div>
          )}
          {rows.map((row, i) => {
            const isActive = i === highlight;
            const Icon = itemIcon(row.value);
            return (
              <div
                key={row.value}
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                role="option"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => toggle(row.value)}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                {row.label}
              </div>
            );
          })}
          {showAddRow && (
            <div
              ref={(el) => {
                rowRefs.current[rows.length] = el;
              }}
              role="option"
              onMouseEnter={() => setHighlight(rows.length)}
              onClick={() => addCustom(query)}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm",
                highlight === rows.length
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Plus className="size-4 shrink-0" />
              <span>
                <span className={cn(highlight === rows.length ? "text-accent-foreground/70" : "text-muted-foreground")}>
                  Add:{" "}
                </span>
                {query.trim()}
              </span>
            </div>
          )}
        </div>
      )}

      <div
        data-popup-open={open || undefined}
        className="flex min-h-8 w-full cursor-text flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background px-2 py-1.5 text-left text-sm transition-colors outline-none hover:bg-accent/40 data-popup-open:border-ring data-popup-open:outline-3 data-popup-open:outline-ring/50"
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
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
          onBlur={onBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
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

function actionRowFromAction(action: RuleAction): ActionRowState {
  switch (action.type) {
    case "move":
    case "copy":
      return { type: action.type, folder: action.folder, name: "" };
    case "rename":
      return { type: "rename", folder: "", name: action.name };
  }
}

function formFromSieve(sieve?: Sieve): SieveFormState {
  if (!sieve) return { ...emptyForm };
  return {
    name: sieve.name,
    watched_folders: sieve.watched_folders,
    mode: sieve.mode,
    conditions: sieve.conditions.map((c) => ({ ...c })),
    actions: sieve.actions.map(actionRowFromAction),
  };
}

function SieveForm({
  presets,
  initial,
  onSubmit,
  onCancel,
}: {
  presets: Preset[];
  initial?: Sieve;
  onSubmit: (sieve: Sieve) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<SieveFormState>(() => formFromSieve(initial));

  const set = <K extends keyof SieveFormState>(key: K, value: SieveFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const updateCondition = (index: number, patch: Partial<ConditionRowState>) =>
    setForm((prev) => ({
      ...prev,
      conditions: prev.conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    }));

  function setConditionProperty(index: number, property: ConditionProperty) {
    updateCondition(index, {
      property,
      operator: OPERATOR_OPTIONS[property][0].value,
      values: [],
    });
  }

  function removeCondition(index: number) {
    setForm((prev) => ({
      ...prev,
      conditions: prev.conditions.filter((_, i) => i !== index),
    }));
  }

  const updateAction = (index: number, patch: Partial<ActionRowState>) =>
    setForm((prev) => ({
      ...prev,
      actions: prev.actions.map((a, i) => (i === index ? { ...a, ...patch } : a)),
    }));

  function setActionType(index: number, type: ActionType) {
    updateAction(index, { type, folder: "", name: "" });
  }

  function removeAction(index: number) {
    setForm((prev) => ({
      ...prev,
      actions: prev.actions.filter((_, i) => i !== index),
    }));
  }

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

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const conditions: SieveCondition[] = form.conditions
      .map((c) => ({
        property: c.property,
        operator: c.operator,
        values: c.values
          .map((v) => (c.property === "extension" ? v.trim().toLowerCase() : v.trim()))
          .filter(Boolean),
      }))
      .filter((c) => c.values.length > 0);

    const actions: RuleAction[] = form.actions
      .map((a) => {
        if (a.type === "rename") {
          return { type: "rename" as const, name: a.name.trim() };
        }
        return { type: a.type, folder: a.folder.trim() };
      })
      .filter(
        (a) => (a.type === "rename" ? a.name !== "" : a.folder !== ""),
      );

    onSubmit({
      name: form.name.trim(),
      watched_folders: form.watched_folders,
      mode: form.mode,
      conditions,
      actions,
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
        <Label htmlFor="sieve-name">Sieve name *</Label>
        <Input
          id="sieve-name"
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
          Files added to any of these folders will be checked against this sieve.
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
                        variant="outline"
                        size="icon"
                        className="size-8 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => removeWatchedFolder(folder)}
                      >
                        <Minus className="size-3.5" />
                      </Button>
                    }
                  />
                  <TooltipContent>Remove folder</TooltipContent>
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
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm">
              If
              <Select
                value={form.mode}
                onValueChange={(value: string | null) =>
                  set("mode", value as ConditionMode)
                }
              >
                <SelectTrigger className="h-8 w-18 gap-1 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="all">all</SelectItem>
                  <SelectItem value="any">any</SelectItem>
                </SelectPopup>
              </Select>
              of the conditions are met
            </p>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-8 shrink-0"
                    aria-label="Add condition"
                    onClick={() =>
                      set("conditions", [
                        ...form.conditions,
                        { property: "kind", operator: "is", values: [] },
                      ])
                    }
                  >
                    <Plus className="size-4" />
                  </Button>
                }
              />
              <TooltipContent>Add condition</TooltipContent>
            </Tooltip>
          </div>

          {form.conditions.length === 0 ? (
            <p className="py-1 text-sm text-muted-foreground">
              Add a condition to define what files match.
            </p>
          ) : (
            <ul className="space-y-2">
              {form.conditions.map((c, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 rounded-lg border border-border p-2"
                >
                  <Select
                    value={c.property}
                    onValueChange={(value: string | null) =>
                      setConditionProperty(i, value as ConditionProperty)
                    }
                  >
                    <SelectTrigger className="h-8 w-34 shrink-0">
                      <SelectValue>
                        {PROPERTY_OPTIONS.find((p) => p.value === c.property)?.label ?? c.property}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      {PROPERTY_OPTIONS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                  <Select
                    value={c.operator}
                    onValueChange={(value: string | null) =>
                      updateCondition(i, {
                        operator: value as ConditionOperator,
                      })
                    }
                  >
                    <SelectTrigger className="h-8 w-32 shrink-0">
                      <SelectValue>
                        {OPERATOR_OPTIONS[c.property].find((o) => o.value === c.operator)?.label ?? c.operator}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      {OPERATOR_OPTIONS[c.property].map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                  <div className="min-w-0 flex-1">
                    {c.property === "kind" && (
                      <Combobox
                        options={kindOptions}
                        selected={c.values}
                        onChange={(values) => updateCondition(i, { values })}
                        allowCustom={false}
                        placeholder="Select kinds…"
                      />
                    )}
                    {c.property === "extension" && (
                      <Combobox
                        options={extOptions}
                        selected={c.values}
                        onChange={(values) => updateCondition(i, { values })}
                        allowCustom
                        placeholder="Type or select extensions…"
                      />
                    )}
                    {c.property === "name" && (
                      <Combobox
                        options={[]}
                        selected={c.values}
                        onChange={(values) => updateCondition(i, { values })}
                        allowCustom
                        placeholder="Add name patterns…"
                      />
                    )}
                    {c.property === "modified" && (
                      <DatePicker
                        value={c.values[0] ?? ""}
                        onChange={(value) =>
                          updateCondition(i, { values: value ? [value] : [] })
                        }
                        placeholder="Pick a date"
                        className="w-full"
                      />
                    )}
                  </div>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="size-8 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => removeCondition(i)}
                        >
                          <Minus className="size-3.5" />
                        </Button>
                      }
                    />
                    <TooltipContent>Remove condition</TooltipContent>
                  </Tooltip>
                </li>
              ))}
            </ul>
          )}
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-border p-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Action
        </legend>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm">Do the following to the matched file:</p>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-8 shrink-0"
                    aria-label="Add action"
                    onClick={() =>
                      set("actions", [
                        ...form.actions,
                        { type: "move", folder: "", name: "" },
                      ])
                    }
                  >
                    <Plus className="size-4" />
                  </Button>
                }
              />
              <TooltipContent>Add action</TooltipContent>
            </Tooltip>
          </div>

          {form.actions.length === 0 ? (
            <p className="py-1 text-sm text-muted-foreground">
              Add an action to run on matched files.
            </p>
          ) : (
            <ul className="space-y-2">
              {form.actions.map((a, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 rounded-lg border border-border p-2"
                >
                  <Select
                    value={a.type}
                    onValueChange={(value: string | null) =>
                      setActionType(i, value as ActionType)
                    }
                  >
                    <SelectTrigger className="h-8 w-28 shrink-0">
                      <SelectValue>
                        {ACTION_OPTIONS.find((o) => o.value === a.type)?.label ?? a.type}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      {ACTION_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {a.type === "rename" ? "to:" : "to folder:"}
                  </span>
                  {a.type === "rename" ? (
                    <Input
                      value={a.name}
                      onChange={(e) => updateAction(i, { name: e.currentTarget.value })}
                      placeholder="report"
                      className="flex-1"
                    />
                  ) : (
                    <>
                      <Input
                        value={a.folder}
                        onChange={(e) => updateAction(i, { folder: e.currentTarget.value })}
                        placeholder="D:\Temp"
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          const folder = await pickFolder();
                          if (folder) updateAction(i, { folder });
                        }}
                      >
                        <Folder className="size-3.5" /> Browse…
                      </Button>
                    </>
                  )}
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="size-8 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => removeAction(i)}
                        >
                          <Minus className="size-3.5" />
                        </Button>
                      }
                    />
                    <TooltipContent>Remove action</TooltipContent>
                  </Tooltip>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Rename uses a new name without the extension (kept from the file).
            Actions run in order, each on the result of the previous one.
          </p>
        </div>
      </fieldset>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{initial ? "Save changes" : "Add sieve"}</Button>
      </div>
    </form>
  );
}

function describeCondition(c: SieveCondition, presets: Preset[]): string {
  const values = c.values
    .map((v) => (c.property === "kind" ? presetByTitle(presets, v) : v))
    .join(", ");
  switch (c.property) {
    case "kind":
      return `Kind ${c.operator === "is" ? "is" : "isn't"} ${values}`;
    case "extension":
      return `Extension ${c.operator === "is" ? "is" : "isn't"} ${values}`;
    case "name":
      return `Name ${c.operator === "matches" ? "matches" : "doesn't match"} ${values}`;
    case "modified":
      return `Modified ${c.operator} ${values}`;
  }
}

function describeConditions(sieve: Sieve, presets: Preset[]): string {
  if (sieve.conditions.length === 0) return "any file";
  const parts = sieve.conditions.map((c) => describeCondition(c, presets));
  return sieve.mode === "all" ? parts.join(" and ") : parts.join(" or ");
}

function describeAction(action: RuleAction): string {
  switch (action.type) {
    case "move":
      return `Move to ${action.folder}`;
    case "copy":
      return `Copy to ${action.folder}`;
    case "rename":
      return `Rename to ${action.name}`;
  }
}

function describeActions(actions: RuleAction[]): string {
  return actions.map(describeAction).join("; then ");
}

function FluentIcon({ svg, className }: { svg: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(className)}
      aria-hidden="true"
      dangerouslySetInnerHTML={{
        __html: svg.replace(/fill="#212121"/g, 'fill="currentColor"'),
      }}
    />
  );
}

function WindowControls() {
  const appWindow = getCurrentWindow();

  return (
    <div className="flex h-full items-stretch">
      <button
        type="button"
        tabIndex={-1}
        title="Minimize"
        onClick={() => appWindow.minimize()}
        className="flex w-11 cursor-pointer items-center justify-center text-foreground/80 transition-colors hover:bg-foreground/10"
      >
        <FluentIcon svg={minimizeIcon} className="size-3.5" />
      </button>
      <button
        type="button"
        tabIndex={-1}
        title="Maximize"
        onClick={() => appWindow.toggleMaximize()}
        className="flex w-11 cursor-pointer items-center justify-center text-foreground/80 transition-colors hover:bg-foreground/10"
      >
        <FluentIcon svg={maximizeIcon} className="size-3" />
      </button>
      <button
        type="button"
        tabIndex={-1}
        title="Close"
        onClick={() => appWindow.close()}
        className="flex w-11 cursor-pointer items-center justify-center text-foreground/80 transition-colors hover:bg-[#c42b1c] hover:text-white"
      >
        <FluentIcon svg={closeIcon} className="size-3.5" />
      </button>
    </div>
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
  const [extTouched, setExtTouched] = useState(false);

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
        <Label htmlFor="preset-name">Name (id) *</Label>
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
          onBlur={() => setExtTouched(true)}
        />
        {extTouched && extensions.length === 0 && (
          <p className="text-xs text-destructive">Add at least one extension.</p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={extensions.length === 0}>
          {initial ? "Save" : "Add"}
        </Button>
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
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [runAtStartup, setRunAtStartup] = useState<boolean | null>(null);
  const [trayEnabled, setTrayEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    invoke<AppConfig>("get_config")
      .then((c) => setTrayEnabled(c.show_in_tray))
      .catch(() => setTrayEnabled(false));
    invoke<boolean>("get_run_at_startup").then(setRunAtStartup).catch(() => setRunAtStartup(false));
  }, []);

  async function onToggleRunAtStartup(next: boolean) {
    try {
      const enabled = await invoke<boolean>("set_run_at_startup", { enabled: next });
      setRunAtStartup(enabled);
    } catch {
      // ignore
    }
  }

  async function onToggleTray(next: boolean) {
    try {
      await invoke<AppConfig>("set_show_in_tray", { enabled: next });
      setTrayEnabled(next);
    } catch {
      // ignore
    }
  }

  return (
    <section className="px-6 py-5">
      <h2 className="mb-4 text-2xl font-semibold">Settings</h2>
      <div className="mb-6 overflow-hidden rounded-lg border border-border">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div>
            <p className="text-sm font-medium">Run at Startup</p>
            <p className="text-xs text-muted-foreground">
              Launch Supersiftr automatically.
            </p>
          </div>
          <Switch
            checked={runAtStartup ?? false}
            disabled={runAtStartup === null}
            onCheckedChange={(next) => void onToggleRunAtStartup(next)}
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-3">
          <div>
            <p className="text-sm font-medium">Show in System Tray</p>
            <p className="text-xs text-muted-foreground">
              Show a tray icon for Supersiftr while it runs, so you can open
              or quit it from the system tray.
            </p>
          </div>
          <Switch
            checked={trayEnabled ?? false}
            disabled={trayEnabled === null}
            onCheckedChange={(next) => void onToggleTray(next)}
          />
        </div>
      </div>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Kinds</h2>
        <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
          <Plus className="size-3.5" /> Add kind
        </Button>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        A kind bundles related extensions under a name. Sieve conditions
        can match a kind instead of listing each extension, and renaming a
        kind updates every sieve automatically.
      </p>

      {editing === "new" && (
        <PresetForm
          presets={presets}
          onSave={(preset) => {
            onAdd(preset);
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {presets.length === 0 ? (
        <p className="text-sm text-muted-foreground">No kinds yet.</p>
      ) : (
        <ul className="space-y-2">
          {presets.map((p) =>
            editing === p.name ? (
              <li key={p.name}>
                <PresetForm
                  presets={presets}
                  initial={p}
                  onSave={(preset) => {
                    onUpdate(preset);
                    setEditing(null);
                  }}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <li
                key={p.name}
                className="rounded-lg border border-border px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <strong className="text-sm font-medium">{p.title}</strong>
                  <span className="text-xs text-muted-foreground">{p.name}</span>
                  <div className="ml-auto flex gap-1">
                    <Tooltip>
                      <TooltipTrigger
                        render={
<Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditing(p.name)}
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
                            variant="outline"
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
            ),
          )}
        </ul>
      )}
    </section>
  );
}

function App() {
  const [sieves, setSieves] = useState<Sieve[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [view, setView] = useState<View>({ kind: "new" });

  const log = useCallback((message: string, level: "info" | "error" = "info") => {
    setActivity((prev) => [...prev, { id: Date.now() + Math.random(), message, level }]);
  }, []);

  useEffect(() => {
    invoke<Sieve[]>("get_sieves").then((sieves) => {
      setSieves(sieves);
      setView(sieves.length ? { kind: "sieve", index: 0 } : { kind: "new" });
    });
    invoke<Preset[]>("get_presets").then(setPresets);
    invoke<string[]>("get_logs", { count: 200 }).then((logs) =>
      setActivity(logs.map((l, i) => ({ id: i, message: l, level: "info" }))),
    );

    const unlistenLog = listen<{ level: string; message: string }>("log-entry", (e) => {
      log(e.payload.message, e.payload.level === "error" ? "error" : "info");
    });

    const unlistenSettings = listen("show-settings", () => setView({ kind: "settings" }));

    return () => {
      unlistenLog.then((f) => f());
      unlistenSettings.then((f) => f());
    };
  }, [log]);

  async function removeSieve(index: number) {
    const updated = await invoke<Sieve[]>("remove_sieve", { index });
    setSieves(updated);
    setView(updated.length ? { kind: "sieve", index: 0 } : { kind: "new" });
    toast.success("Sieve deleted");
  }

  async function addSieve(sieve: Sieve) {
    const updated = await invoke<Sieve[]>("add_sieve", { sieve });
    setSieves(updated);
    setView({ kind: "sieve", index: updated.length - 1 });
    log(`Added sieve: ${sieve.name}`);
    toast.success(`Sieve "${sieve.name}" created`);
  }

  async function updateSieve(index: number, sieve: Sieve) {
    const updated = await invoke<Sieve[]>("update_sieve", { index, sieve });
    setSieves(updated);
    setView({ kind: "sieve", index });
    log(`Updated sieve: ${sieve.name}`);
    toast.success(`Sieve "${sieve.name}" updated`);
  }

  async function addPreset(preset: Preset) {
    const updated = await invoke<Preset[]>("add_preset", { preset });
    setPresets(updated);
    toast.success(`Kind "${preset.title}" created`);
  }

  async function updatePreset(preset: Preset) {
    const updated = await invoke<Preset[]>("update_preset", { preset });
    setPresets(updated);
  }

  async function deletePreset(name: string) {
    const updated = await invoke<Preset[]>("delete_preset", { name });
    setPresets(updated);
    log(`Deleted kind: ${name}`);
    toast.success(`Kind "${name}" deleted`);
  }

  function renderSieveDetail(sieve: Sieve, index: number) {
    const missing = missingKinds(sieve, presets);
    return (
      <section className="px-6 py-5">
        {missing.length > 0 && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              Missing kind{missing.length > 1 ? "s" : ""}:{" "}
              {missing.map((m) => presetByTitle(presets, m)).join(", ")}.
              This kind does not exist.
            </span>
          </div>
        )}
        {!isRunnable(sieve) && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>This sieve has no conditions or actions and will never run.</span>
          </div>
        )}
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-2xl font-semibold">{sieve.name}</h2>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setView({ kind: "edit", index })}
                >
                  <Pencil className="size-3.5" /> Edit
                </Button>
              }
            />
            <TooltipContent>Edit this sieve</TooltipContent>
          </Tooltip>
        </div>
        <dl className="grid grid-cols-[92px_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Watch</dt>
          <dd>
            <ul className="space-y-0.5">
              {sieve.watched_folders.map((f) => (
                <li key={f} className="select-text font-mono text-xs">
                  {f}
                </li>
              ))}
            </ul>
          </dd>
          <dt className="text-muted-foreground">Match</dt>
          <dd>{describeConditions(sieve, presets)}</dd>
          <dt className="text-muted-foreground">Action</dt>
          <dd>{describeActions(sieve.actions)}</dd>
        </dl>
      </section>
    );
  }

  function renderMain() {
    if (view.kind === "new") {
      return (
        <section className="px-6 py-5">
          <h2 className="mb-4 text-2xl font-semibold">New sieve</h2>
          <SieveForm
            presets={presets}
            onSubmit={addSieve}
            onCancel={() =>
              setView(
                sieves.length ? { kind: "sieve", index: 0 } : { kind: "activity" },
              )
            }
          />
        </section>
      );
    }

    if (view.kind === "activity") {
      return (
        <section className="px-6 py-5">
          <h2 className="mb-4 text-2xl font-semibold">Activity</h2>
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

    const sieve = sieves[view.index];
    if (!sieve) {
      return (
        <section className="px-6 py-5">
          <p className="text-sm text-muted-foreground">No sieve selected.</p>
        </section>
      );
    }

    if (view.kind === "edit") {
      return (
        <section className="px-6 py-5">
          <h2 className="mb-4 text-2xl font-semibold">Edit sieve</h2>
          <SieveForm
            key={view.index}
            presets={presets}
            initial={sieve}
            onSubmit={(updated) => void updateSieve(view.index, updated)}
            onCancel={() => setView({ kind: "sieve", index: view.index })}
          />
        </section>
      );
    }

    return renderSieveDetail(sieve, view.index);
  }

  return (
    <TooltipProvider>
      <div
        className="flex h-full select-none overflow-hidden"
        onContextMenu={(e) => e.preventDefault()}
      >
        <Sidebar
          sieves={sieves}
          view={view}
          onSelect={setView}
          onDelete={(index) => void removeSieve(index)}
        />

        <div className="flex min-w-0 flex-1 flex-col bg-card">
          <div
            className="flex h-9 shrink-0 items-center justify-end"
            data-tauri-drag-region
          >
            <div className="h-full" data-tauri-drag-region>
              <WindowControls />
            </div>
          </div>
          <ScrollArea className="min-w-0 flex-1" contentClassName="divide-y divide-border">
            {renderMain()}
          </ScrollArea>
        </div>
      </div>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}

export default App;