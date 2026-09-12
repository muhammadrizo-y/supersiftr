import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { EllipsisVertical, Pencil, Plus, Trash2, Undo2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Combobox } from "@/components/ui/combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { isValidCompoundSuffix } from "@/lib/sieves";

import type { AppConfig, CompoundExtensionsView, ConfigView, Kind, LicenseStore } from "@/types";
import { KindForm } from "./KindForm";

function LicenseSection() {
  const [license, setLicense] = useState<LicenseStore | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<LicenseStore>("get_license_status").then(setLicense).catch(() => {});
  }, []);

  async function onActivate() {
    setBusy(true);
    setError(null);
    try {
      const result = await invoke<LicenseStore>("activate_license", { key: keyInput.trim() });
      setLicense(result);
      setKeyInput("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onDeactivate() {
    setBusy(true);
    setError(null);
    try {
      const result = await invoke<LicenseStore>("deactivate_license");
      setLicense(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const isLicensed = license?.status === "active" && license.activation_id !== null;

  return (
    <div className="mb-6 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <div>
          <p className="text-sm font-medium">License</p>
          {isLicensed ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Activated on this device
              {license?.device_label ? ` as "${license.device_label}"` : ""}.
            </p>
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Enter your license key to unlock paid features on this device.
            </p>
          )}
        </div>
        <Badge variant={isLicensed ? "secondary" : "outline"} className="shrink-0">
          {isLicensed ? "Active" : license?.status === "invalid" ? "Invalid" : "Not activated"}
        </Badge>
      </div>
      <div className="flex items-center gap-2 border-t border-border px-4 py-3">
        {isLicensed ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void onDeactivate()}>
            Deactivate this device
          </Button>
        ) : (
          <>
            <Input
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="License key"
              className="max-w-xs"
              disabled={busy}
            />
            <Button
              size="sm"
              disabled={busy || keyInput.trim().length === 0}
              onClick={() => void onActivate()}
            >
              Activate
            </Button>
          </>
        )}
      </div>
      {error && (
        <p className="border-t border-border px-4 py-2 text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}

export function SettingsTab({
  kinds,
  onAdd,
  onUpdate,
  onDelete,
  onToggleEnabled,
  onReset,
  dateFormat,
  onDateFormatChange,
}: {
  kinds: Kind[];
  onAdd: (kind: Kind) => void;
  onUpdate: (kind: Kind) => void;
  onDelete: (name: string) => void;
  onToggleEnabled: (name: string, enabled: boolean) => void;
  onReset: (name: string) => void;
  dateFormat: "us" | "uk";
  onDateFormatChange: (format: "us" | "uk") => void;
}) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [runAtStartup, setRunAtStartup] = useState<boolean | null>(null);
  const [trayEnabled, setTrayEnabled] = useState<boolean | null>(null);
  const [compoundDefaults, setCompoundDefaults] = useState<string[]>([]);
  const [customCompounds, setCustomCompounds] = useState<string[]>([]);

  useEffect(() => {
    invoke<ConfigView>("get_config")
      .then((v) => setTrayEnabled(v.config.show_in_tray))
      .catch(() => setTrayEnabled(false));
    invoke<boolean>("get_run_at_startup").then(setRunAtStartup).catch(() => setRunAtStartup(false));
    invoke<CompoundExtensionsView>("get_compound_extensions")
      .then((s) => {
        setCompoundDefaults(s.defaults);
        setCustomCompounds(s.custom);
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

  async function onToggleDateFormat(next: "us" | "uk") {
    try {
      const config = await invoke<AppConfig>("set_date_format", { format: next });
      onDateFormatChange(config.date_format);
    } catch {
      // ignore
    }
  }

  const validateCompound = (raw: string) => {
    const s = raw.trim().toLowerCase();
    return isValidCompoundSuffix(s) && !compoundDefaults.includes(s);
  };

  async function saveCustomCompounds(custom: string[]) {
    try {
      const updated = await invoke<string[]>("set_compound_extensions", { custom });
      setCustomCompounds(updated);
    } catch {
      // ignore
    }
  }

  return (
    <section className="px-6 py-5">
      <h2 className="mb-4 text-2xl font-semibold">Settings</h2>
      <LicenseSection />
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
      <div className="mb-6 overflow-hidden rounded-lg border border-border">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div>
            <p className="text-sm font-medium">Date format</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              How dates like <code className="font-mono">01/02/2026</code> and
              natural-language ones ("next Friday") are read: US (month/day) or
              UK (day/month).
            </p>
          </div>
          <Select
            value={dateFormat}
            onValueChange={(value: string | null) => {
              if (value) void onToggleDateFormat(value as "us" | "uk");
            }}
          >
            <SelectTrigger className="w-32">
              <SelectValue className="uppercase" />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="us">US</SelectItem>
              <SelectItem value="uk">UK</SelectItem>
            </SelectPopup>
          </Select>
        </div>
      </div>
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Kinds</h3>
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
                    {k.is_default && (
                      <Badge
                        variant="secondary"
                        className="px-1.5 py-0 text-[10px] font-normal tracking-wide"
                      >
                        Default
                      </Badge>
                    )}
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
                                  onClick={() => setDeleteTarget(k.name)}
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
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      <div className="mt-8">
        <h3 className="mb-1 text-lg font-semibold">Compound extensions</h3>
        <p className="mb-4 text-xs text-muted-foreground">
          Endings a rename preserves as a unit, so <code>.tar.gz</code> stays
          part of the name instead of being reduced to <code>.gz</code>. The
          built-in ones are always on and can't be removed; add your own to
          teach the app endings like <code>backup.tar.xz</code> (case
          doesn't matter).
        </p>
        <Combobox
          options={compoundDefaults.map((s) => ({ value: s, label: s }))}
          selected={[...compoundDefaults, ...customCompounds]}
          locked={compoundDefaults}
          validateCustom={validateCompound}
          onChange={(values) => {
            const custom = values.filter((v) => !compoundDefaults.includes(v));
            void saveCustomCompounds(custom);
          }}
          placeholder="backup.tar.xz"
          label="compound extensions"
        />
      </div>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive">
              <Trash2 />
            </AlertDialogMedia>
            <AlertDialogTitle>Delete kind?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget !== null && kinds.find((k) => k.name === deleteTarget) ? (
                <>
                  This will delete{" "}
                  <span className="font-medium text-foreground">
                    "{kinds.find((k) => k.name === deleteTarget)!.title}"
                  </span>{" "}
                  and every sieve that references it will stop matching its
                  files. This action cannot be undone.
                </>
              ) : (
                "This will delete the kind. This action cannot be undone."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="ghost">Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleteTarget !== null) onDelete(deleteTarget);
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}