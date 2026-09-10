import { useState, type FormEvent } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Folder,
  FolderSearch,
  Funnel,
  GripVertical,
  Minus,
  Plus,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox, type SelectOption } from "@/components/ui/combobox";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { cn } from "@/lib/utils";
import type {
  ActionType,
  ConditionMode,
  ConditionOperator,
  ConditionProperty,
  DeleteMode,
  Kind,
  RuleAction,
  Sieve,
  SieveCondition,
} from "@/types";

type ConditionRowState = {
  property: ConditionProperty;
  operator: ConditionOperator;
  values: string[];
};

type ActionRowState = {
  id: number;
  type: ActionType;
  folder: string;
  name: string;
  mode: DeleteMode;
};

type SieveFormState = {
  name: string;
  watched_folders: string[];
  mode: ConditionMode;
  conditions: ConditionRowState[];
  actions: ActionRowState[];
};

const PROPERTY_OPTIONS: { value: ConditionProperty; label: string }[] = [
  { value: "type", label: "Type" },
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
    { value: "before", label: "before" },
    { value: "after", label: "after" },
  ],
  type: [{ value: "is", label: "is" }],
};

const TYPE_OPTIONS: { value: "file" | "folder"; label: string }[] = [
  { value: "file", label: "File" },
  { value: "folder", label: "Folder" },
];

const ACTION_OPTIONS: { value: ActionType; label: string }[] = [
  { value: "move", label: "Move" },
  { value: "copy", label: "Copy" },
  { value: "rename", label: "Rename" },
  { value: "delete", label: "Delete" },
];

const DELETE_OPTIONS: { value: DeleteMode; label: string }[] = [
  { value: "recycle", label: "Move to Recycle Bin" },
  { value: "permanent", label: "Delete Permanently" },
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

let nextActionRowId = 0;

function actionRowFromAction(action: RuleAction): ActionRowState {
  switch (action.type) {
    case "move":
    case "copy":
      return {
        id: ++nextActionRowId,
        type: action.type,
        folder: action.folder,
        name: "",
        mode: "recycle",
      };
    case "rename":
      return {
        id: ++nextActionRowId,
        type: "rename",
        folder: "",
        name: action.name,
        mode: "recycle",
      };
    case "delete":
      return {
        id: ++nextActionRowId,
        type: "delete",
        folder: "",
        name: "",
        mode: action.mode,
      };
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

function ActionItemRow({
  action,
  index,
  onTypeChange,
  onPatch,
  onRemove,
}: {
  action: ActionRowState;
  index: number;
  onTypeChange: (index: number, type: ActionType) => void;
  onPatch: (index: number, patch: Partial<ActionRowState>) => void;
  onRemove: (index: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: action.id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "relative flex items-center gap-2 px-3 py-2 transition-colors",
        isDragging ? "z-10 bg-accent/50" : "hover:bg-muted/20",
      )}
    >
      <button
        type="button"
        aria-label="Reorder action"
        className="shrink-0 cursor-grab rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <Select
        value={action.type}
        onValueChange={(value: string | null) => onTypeChange(index, value as ActionType)}
      >
        <SelectTrigger className="h-8 w-28 shrink-0">
          <SelectValue>
            {ACTION_OPTIONS.find((o) => o.value === action.type)?.label ?? action.type}
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
      {action.type === "delete" ? (
        <Select
          value={action.mode}
          onValueChange={(value: string | null) =>
            onPatch(index, { mode: value as DeleteMode })
          }
        >
          <SelectTrigger className="h-8 w-44 shrink-0 gap-1">
            <SelectValue>
              {DELETE_OPTIONS.find((o) => o.value === action.mode)?.label ?? action.mode}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {DELETE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      ) : (
        <>
          <span className="shrink-0 text-xs text-muted-foreground">
            {action.type === "rename" ? "to:" : "to folder:"}
          </span>
          {action.type === "rename" ? (
            <div className="flex flex-1 flex-col gap-1">
              <Input
                value={action.name}
                onChange={(e) => onPatch(index, { name: e.currentTarget.value })}
                placeholder="report"
                className="flex-1"
              />
            </div>
          ) : (
            <>
              <Input
                value={action.folder}
                onChange={(e) => onPatch(index, { folder: e.currentTarget.value })}
                placeholder="D:\Temp"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={async () => {
                  const folder = await pickFolder();
                  if (folder) onPatch(index, { folder });
                }}
              >
                <Folder className="size-3.5" /> Browse…
              </Button>
            </>
          )}
        </>
      )}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="ml-auto size-7 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive!"
              onClick={() => onRemove(index)}
            >
              <Minus className="size-3.5" />
            </Button>
          }
        />
        <TooltipContent>Remove action</TooltipContent>
      </Tooltip>
    </li>
  );
}

export function SieveForm({
  kinds,
  initial,
  onSubmit,
  onCancel,
  dateFormat,
}: {
  kinds: Kind[];
  initial?: Sieve;
  onSubmit: (sieve: Sieve) => void;
  onCancel: () => void;
  dateFormat: "us" | "uk";
}) {
  const [form, setForm] = useState<SieveFormState>(() => formFromSieve(initial));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  function handleActionDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setForm((prev) => {
      const oldIndex = prev.actions.findIndex((a) => a.id === active.id);
      const newIndex = prev.actions.findIndex((a) => a.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      return { ...prev, actions: arrayMove(prev.actions, oldIndex, newIndex) };
    });
  }

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
      values: property === "type" ? ["file"] : [],
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
    updateAction(index, { type, folder: "", name: "", mode: "recycle" });
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
        values:
          c.property === "type"
            ? [c.values[0] ?? "file"]
            : c.values
                .map((v) => (c.property === "extension" ? v.trim().toLowerCase() : v.trim()))
                .filter(Boolean),
      }))
      .filter((c) => c.values.length > 0);

    const actions: RuleAction[] = form.actions
      .map((a) => {
        if (a.type === "rename") {
          return { type: "rename" as const, name: a.name.trim() };
        }
        if (a.type === "delete") {
          return { type: "delete" as const, mode: a.mode };
        }
        return { type: a.type, folder: a.folder.trim() };
      })
      .filter((a) => {
        if (a.type === "delete") return true;
        return a.type === "rename" ? a.name !== "" : a.folder !== "";
      });

    onSubmit({
      name: form.name.trim(),
      watched_folders: form.watched_folders,
      mode: form.mode,
      conditions,
      actions,
      enabled: initial?.enabled ?? true,
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
    <form className="flex h-full min-h-0 flex-col" onSubmit={handleSubmit}>
      <ScrollArea className="-mx-6 min-h-0 flex-1">
        <div className="flex flex-col gap-4 px-6 py-3">
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

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex h-10 items-center justify-between gap-2 border-b border-border bg-muted/40 px-3">
          <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
            <FolderSearch className="size-3.5 shrink-0" />
            <span className="truncate font-semibold uppercase tracking-wider">
              Watched Folders
            </span>
          </div>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-7 shrink-0"
                  aria-label="Add folder"
                  onClick={addWatchedFolder}
                >
                  <Plus className="size-4" />
                </Button>
              }
            />
            <TooltipContent>Add folder</TooltipContent>
          </Tooltip>
        </div>
        {form.watched_folders.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            No folders watched yet. Click <strong>+</strong> to watch one.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {form.watched_folders.map((folder) => (
              <li
                key={folder}
                className="flex items-center justify-between gap-3 px-3 py-2 transition-colors hover:bg-muted/20"
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
                        className="size-7 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive!"
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
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex h-10 items-center justify-between gap-2 border-b border-border bg-muted/40 px-3">
          <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Funnel className="size-3.5 shrink-0" />
            <span className="shrink-0 font-semibold uppercase tracking-wider">
              Match
            </span>
            <span className="font-normal text-muted-foreground/60">—</span>
            <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate font-normal normal-case text-foreground">
              If
              <Select
                value={form.mode}
                onValueChange={(value: string | null) =>
                  set("mode", value as ConditionMode)
                }
              >
                <SelectTrigger className="h-6 w-16 gap-1 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="all">all</SelectItem>
                  <SelectItem value="any">any</SelectItem>
                </SelectPopup>
              </Select>
              of the conditions are met
            </span>
          </div>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-7 shrink-0"
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
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            No conditions defined. Click <strong>+</strong> to match specific
            files.
          </div>
        ) : (
          <ul className="divide-y divide-border">
              {form.conditions.map((c, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 px-3 py-2 transition-colors hover:bg-muted/20"
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
                  {c.property !== "type" && (
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
                  )}
                  <div className="min-w-0 flex-1">
                    {c.property === "kind" && (
                      <Combobox
                        options={kindOptions}
                        selected={c.values}
                        onChange={(values) => updateCondition(i, { values })}
                        allowCustom={false}
                        placeholder="Select kinds…"
                        label="kinds for this condition"
                      />
                    )}
                    {c.property === "extension" && (
                      <Combobox
                        options={extOptions}
                        selected={c.values}
                        onChange={(values) => updateCondition(i, { values })}
                        allowCustom
                        placeholder="Type or select extensions…"
                        label="file extensions"
                      />
                    )}
                    {c.property === "name" && (
                      <Combobox
                        options={[]}
                        selected={c.values}
                        onChange={(values) => updateCondition(i, { values })}
                        allowCustom
                        placeholder="Add name patterns…"
                        label="name patterns"
                      />
                    )}
                    {c.property === "type" && (
                      <Select
                        value={c.values[0] ?? "file"}
                        onValueChange={(value: string | null) =>
                          updateCondition(i, { values: value ? [value] : [] })
                        }
                      >
                        <SelectTrigger className="h-8 w-32 shrink-0">
                          <SelectValue>
                            {TYPE_OPTIONS.find((o) => o.value === c.values[0])?.label ?? "File"}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectPopup>
                          {TYPE_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    )}
                    {c.property === "modified" && (
                      <DatePicker
                        value={c.values[0] ?? ""}
                        onChange={(value) =>
                          updateCondition(i, { values: value ? [value] : [] })
                        }
                        placeholder="e.g. next Friday"
                        className="w-full"
                        dateFormat={dateFormat}
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
                          className="size-7 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive!"
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

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex h-10 items-center justify-between gap-2 border-b border-border bg-muted/40 px-3">
          <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
            <Zap className="size-3.5 shrink-0" />
            <span className="truncate font-semibold uppercase tracking-wider">
              Actions
            </span>
            <span className="truncate font-normal normal-case">
              Do the following to the matched file
            </span>
          </div>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-7 shrink-0"
                  aria-label="Add action"
                  onClick={() =>
                    set("actions", [
                      ...form.actions,
                      {
                        id: ++nextActionRowId,
                        type: "move",
                        folder: "",
                        name: "",
                        mode: "recycle",
                      },
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
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            No actions defined. Click <strong>+</strong> to run one on matched
            files.
          </div>
        ) : (
          <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis, restrictToParentElement]}
              onDragEnd={handleActionDragEnd}
            >
            <SortableContext items={form.actions.map((a) => a.id)} strategy={verticalListSortingStrategy}>
              <ul className="divide-y divide-border">
                {form.actions.map((a, i) => (
                  <ActionItemRow
                    key={a.id}
                    action={a}
                    index={i}
                    onTypeChange={setActionType}
                    onPatch={updateAction}
                    onRemove={removeAction}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
          )}
      <div className="border-t border-border bg-muted/20 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        Rename replaces the file's name while keeping its suffix (the
        recognized file ending). Compound suffixes like{" "}
        <code>.tar.gz</code> are kept whole. Use{" "}
        <code>{"{name}"}</code> in the pattern to keep the original base
        name, e.g. <code>{"{name}_processed"}</code>. Actions run in
        order, each on the result of the previous one.
      </div>
      </div>
      </div>
      </ScrollArea>

      <div className="-mx-6 flex shrink-0 items-center justify-end gap-2 border-t border-border/60 bg-card px-6 py-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{initial ? "Save changes" : "Add sieve"}</Button>
      </div>
    </form>
  );
}