import { useEffect, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Folder, Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox, type SelectOption } from "@/components/ui/combobox";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { allKnownExtensions } from "@/lib/sieves";
import { formatRenamePreview } from "@/lib/suffixes";
import type {
  ActionType,
  ConditionMode,
  ConditionOperator,
  ConditionProperty,
  Kind,
  RuleAction,
  Sieve,
  SieveCondition,
  SuffixView,
} from "@/types";

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

export function SieveForm({
  kinds,
  initial,
  onSubmit,
  onCancel,
}: {
  kinds: Kind[];
  initial?: Sieve;
  onSubmit: (sieve: Sieve) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<SieveFormState>(() => formFromSieve(initial));
  const [customSuffixes, setCustomSuffixes] = useState<string[]>([]);
  const [previewFile, setPreviewFile] = useState("photo.tar.gz");

  useEffect(() => {
    invoke<SuffixView>("get_suffixes").then((s) => setCustomSuffixes(s.custom)).catch(() => {});
  }, []);

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

  const kindOptions: SelectOption[] = kinds
    .filter((k) => k.enabled)
    .map((k) => ({
      value: k.name,
      label: k.title,
    }));
  const extOptions: SelectOption[] = allKnownExtensions(kinds).map((e) => ({
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
                    <div className="flex flex-1 flex-col gap-1">
                      <Input
                        value={a.name}
                        onChange={(e) => updateAction(i, { name: e.currentTarget.value })}
                        placeholder="report"
                        className="flex-1"
                      />
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Input
                          value={previewFile}
                          onChange={(e) => setPreviewFile(e.currentTarget.value)}
                          aria-label="Sample file name for preview"
                          className="h-6 w-40 font-mono text-[11px]"
                        />
                        <span>→</span>
                        <span className="font-mono">
                          {formatRenamePreview(previewFile, a.name, customSuffixes)}
                        </span>
                      </div>
                    </div>
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
            Rename replaces the file's name while keeping its suffix (the
            recognized file ending). Compound suffixes like{" "}
            <code>.tar.gz</code> are kept whole. Actions run in order, each on
            the result of the previous one.
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