import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { EllipsisVertical, Pencil, Plus, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { normalizeCustomSuffix } from "@/lib/suffixes";
import { cn } from "@/lib/utils";
import type { AppConfig, Kind, SuffixView } from "@/types";
import { KindForm } from "./KindForm";

export function SettingsTab({
  kinds,
  onAdd,
  onUpdate,
  onDelete,
  onToggleEnabled,
  onReset,
}: {
  kinds: Kind[];
  onAdd: (kind: Kind) => void;
  onUpdate: (kind: Kind) => void;
  onDelete: (name: string) => void;
  onToggleEnabled: (name: string, enabled: boolean) => void;
  onReset: (name: string) => void;
}) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [runAtStartup, setRunAtStartup] = useState<boolean | null>(null);
  const [trayEnabled, setTrayEnabled] = useState<boolean | null>(null);
  const [suffixDefaults, setSuffixDefaults] = useState<string[]>([]);
  const [customSuffixes, setCustomSuffixes] = useState<string[]>([]);
  const [newSuffix, setNewSuffix] = useState("");

  useEffect(() => {
    invoke<AppConfig>("get_config")
      .then((c) => setTrayEnabled(c.show_in_tray))
      .catch(() => setTrayEnabled(false));
    invoke<boolean>("get_run_at_startup").then(setRunAtStartup).catch(() => setRunAtStartup(false));
    invoke<SuffixView>("get_suffixes")
      .then((s) => {
        setSuffixDefaults(s.defaults);
        setCustomSuffixes(s.custom);
      })
      .catch(() => {});
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

  async function addCustomSuffix() {
    const normalized = normalizeCustomSuffix(newSuffix, customSuffixes);
    if (!normalized) {
      toast.error("Invalid or duplicate suffix");
      return;
    }
    try {
      const updated = await invoke<string[]>("add_suffix", { suffix: normalized });
      setCustomSuffixes(updated);
      setNewSuffix("");
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Failed to add suffix");
    }
  }

  async function removeCustomSuffix(suffix: string) {
    try {
      const updated = await invoke<string[]>("remove_suffix", { suffix });
      setCustomSuffixes(updated);
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Failed to remove suffix");
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
            <p className="text-xs leading-relaxed text-muted-foreground">
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
        <KindForm
          kinds={kinds}
          onSave={(kind) => {
            onAdd(kind);
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {kinds.length === 0 ? (
        <p className="text-sm text-muted-foreground">No kinds yet.</p>
      ) : (
        <ul className="space-y-2">
          {kinds.map((k) =>
            editing === k.name ? (
              <li key={k.name}>
                <KindForm
                  kinds={kinds}
                  initial={k}
                  onSave={(kind) => {
                    onUpdate(kind);
                    setEditing(null);
                  }}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <li
                key={k.name}
                className={cn(
                  "rounded-lg border border-border px-4 py-3",
                  !k.enabled && "opacity-50",
                )}
              >
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <strong className="text-sm font-medium">{k.title}</strong>
                    <span className="text-xs text-muted-foreground">{k.name}</span>
                    <div className="ml-auto flex items-center gap-1">
                      {k.is_default ? (
                        <>
                          <Switch
                            checked={k.enabled}
                            onCheckedChange={(next) => onToggleEnabled(k.name, next)}
                          />
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button size="icon" variant="ghost" className="size-8">
                                  <EllipsisVertical className="size-4" />
                                </Button>
                              }
                            />
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setEditing(k.name)}>
                                <Pencil />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => onReset(k.name)}>
                                <Undo2 />
                                Reset
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </>
                      ) : (
                        <>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setEditing(k.name)}
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
                                  onClick={() => onDelete(k.name)}
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              }
                            />
                            <TooltipContent>Delete</TooltipContent>
                          </Tooltip>
                        </>
                      )}
                    </div>
                  </div>
                  <p className="select-text text-xs text-muted-foreground">
                    {k.extensions.join(", ") || "no extensions"}
                  </p>
                  {k.is_default && (
                    <div className="mt-auto">
                      <Badge variant="secondary">Default kind</Badge>
                    </div>
                  )}
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      <div className="mt-8">
        <h2 className="mb-1 text-2xl font-semibold">Rename suffixes</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          When a rename keeps the file's ending, compound suffixes are preserved
          as a unit. <code>.tar.gz</code> stays part of the name instead of being
          reduced to <code>.gz</code>. Custom suffixes let you teach the app
          endings like <code>backup.tar.xz</code>.
        </p>
        {suffixDefaults.length > 0 && (
          <div className="mb-4">
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Recognized by default
            </p>
            <div className="flex flex-wrap gap-1.5">
              {suffixDefaults.map((s) => (
                <Badge key={s} variant="secondary" className="px-2 py-0.5 font-mono text-xs">
                  {s}
                </Badge>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center gap-2">
          <Input
            value={newSuffix}
            onChange={(e) => setNewSuffix(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void addCustomSuffix();
              }
            }}
            placeholder=".backup.tar.xz"
            className="max-w-52"
          />
          <Button size="sm" variant="outline" onClick={() => void addCustomSuffix()}>
            <Plus className="size-3.5" /> Add
          </Button>
        </div>
        {customSuffixes.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No custom suffixes.</p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {customSuffixes.map((s) => (
              <li key={s}>
                <Badge variant="outline" className="gap-1.5 px-2 py-0.5 font-mono text-xs">
                  {s}
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => void removeCustomSuffix(s)}
                    aria-label={`Remove ${s}`}
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}