import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Activity, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SieveDetail } from "@/components/SieveDetail";
import { SieveForm } from "@/components/SieveForm";
import { SettingsTab } from "@/components/SettingsTab";
import Sidebar from "@/components/Sidebar";
import { WindowControls } from "@/components/WindowControls";
import { fetchUpdate, notifyUpdate } from "@/lib/updater";
import { useProStatus } from "@/lib/license";
import { cn } from "@/lib/utils";
import type { ActivityEntry, ConfigView, Kind, Sieve, View } from "@/types";

function detectDateFormat(): "us" | "uk" {
  try {
    const region =
      new Intl.Locale(navigator.language).region ??
      navigator.language.split("-")[1]?.toUpperCase() ??
      "";
    return region === "US" ? "us" : "uk";
  } catch {
    return "uk";
  }
}

function App() {
  const [sieves, setSieves] = useState<Sieve[]>([]);
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [view, setView] = useState<View>({ kind: "new" });
  const [confirmClear, setConfirmClear] = useState(false);
  const [dateFormat, setDateFormat] = useState<"us" | "uk">("uk");
  const [checkForUpdates, setCheckForUpdates] = useState(false);

  const isPro = useProStatus();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "f5" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r")) {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const nextId = useRef(0);

  const log = useCallback((message: string, level: "info" | "error" = "info") => {
    setActivity((prev) => [...prev, { id: nextId.current++, message, level }]);
  }, []);

  useEffect(() => {
    invoke<Sieve[]>("get_sieves").then((sieves) => {
      setSieves(sieves);
      setView(sieves.length ? { kind: "sieve", index: 0 } : { kind: "new" });
    });
    invoke<Kind[]>("get_kinds").then(setKinds);
    invoke<{ level: string; message: string }[]>("get_logs", { count: 200 }).then((logs) =>
      setActivity(logs.map((l) => ({ id: nextId.current++, message: l.message, level: l.level === "error" ? "error" : "info" }))),
    );
    invoke<ConfigView>("get_config").then(({ config, fresh }) => {
      setDateFormat(config.date_format);
      setCheckForUpdates(config.check_for_updates);
      if (fresh) {
        void invoke("set_date_format", { format: detectDateFormat() });
      }
    });

    const unlistenLog = listen<{ level: string; message: string }>("log-entry", (e) => {
      log(e.payload.message, e.payload.level === "error" ? "error" : "info");
    });

    const unlistenSettings = listen("show-settings", () => setView({ kind: "settings" }));

    return () => {
      unlistenLog.then((f) => f());
      unlistenSettings.then((f) => f());
    };
  }, [log]);

  useEffect(() => {
    if (!checkForUpdates) return;
    let cancelled = false;
    fetchUpdate()
      .then((update) => {
        if (cancelled || !update) return;
        void notifyUpdate(update.version);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [checkForUpdates]);

  const cancelForm = useCallback(() => {
    if (view.kind === "new") {
      setView(sieves.length ? { kind: "sieve", index: 0 } : { kind: "activity" });
    } else if (view.kind === "edit") {
      setView({ kind: "sieve", index: view.index });
    }
  }, [view, sieves]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setView({ kind: "settings" });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setView({ kind: "new" });
        return;
      }
      if (
        e.key !== "Escape" ||
        (view.kind !== "new" && view.kind !== "edit")
      ) {
        return;
      }
      // An open popup (combobox list, select, date picker) closes itself on
      // Escape — don't cancel the whole form underneath it.
      const target = e.target as HTMLElement | null;
      const inSidebarList = target?.closest?.("[data-sieve-list]");
      const inPopup =
        target?.closest?.(
          '[data-popup-open], [data-open], [role="dialog"]',
        ) ||
        (Boolean(target?.closest?.('[role="listbox"]')) && !inSidebarList);
      if (!inPopup) {
        e.preventDefault();
        cancelForm();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancelForm]);

  async function removeSieve(index: number) {
    const removed = sieves[index];
    const updated = await invoke<Sieve[]>("remove_sieve", { index });
    setSieves(updated);
    setView(updated.length ? { kind: "sieve", index: 0 } : { kind: "new" });
    toast.success("Sieve deleted", {
      action: {
        label: "Undo",
        onClick: () => void restoreSieve(removed, index),
      },
    });
  }

  async function restoreSieve(sieve: Sieve, index: number) {
    const updated = await invoke<Sieve[]>("insert_sieve", { index, sieve });
    setSieves(updated);
    setView({ kind: "sieve", index: Math.min(index, updated.length - 1) });
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

  async function addKind(kind: Kind) {
    const updated = await invoke<Kind[]>("add_kind", { kind });
    setKinds(updated);
    toast.success(`Kind "${kind.title}" created`);
  }

  async function updateKind(kind: Kind) {
    const updated = await invoke<Kind[]>("update_kind", { kind });
    setKinds(updated);
  }

  async function deleteKind(name: string) {
    const removed = kinds.find((k) => k.name === name);
    const updated = await invoke<Kind[]>("delete_kind", { name });
    setKinds(updated);
    log(`Deleted kind: ${name}`);
    toast.success(`Kind "${name}" deleted`, {
      action: {
        label: "Undo",
        onClick: () => {
          if (removed) void restoreKind(removed);
        },
      },
    });
  }

  async function restoreKind(kind: Kind) {
    const updated = await invoke<Kind[]>("add_kind", { kind });
    setKinds(updated);
  }

  async function toggleKindEnabled(name: string, enabled: boolean) {
    const updated = await invoke<Kind[]>("set_kind_enabled", { name, enabled });
    setKinds(updated);
  }

  async function setSieveEnabled(index: number, enabled: boolean) {
    const updated = await invoke<Sieve[]>("set_sieve_enabled", { index, enabled });
    setSieves(updated);
  }

  async function clearActivity() {
    await invoke("clear_logs");
    setActivity([]);
  }

  async function resetKind(name: string) {
    const updated = await invoke<Kind[]>("reset_kind", { name });
    setKinds(updated);
  }

  function renderSieveDetail(sieve: Sieve, index: number) {
    return (
      <SieveDetail
        sieve={sieve}
        index={index}
        kinds={kinds}
        isPro={isPro}
        onGoToSettings={() => setView({ kind: "settings" })}
        onEdit={(i) => setView({ kind: "edit", index: i })}
        onToggleEnabled={(i, enabled) => void setSieveEnabled(i, enabled)}
      />
    );
  }

  function renderMain() {
    if (view.kind === "new") {
      return (
        <section className="flex h-full min-h-0 flex-col px-6 pt-5">
          <h2 className="-mx-6 shrink-0 border-b border-border/60 px-6 pb-4 text-2xl font-semibold">New sieve</h2>
          <div className="min-h-0 flex-1">
            <SieveForm
              kinds={kinds}
              onSubmit={addSieve}
              onCancel={cancelForm}
              dateFormat={dateFormat}
            />
          </div>
        </section>
      );
    }

if (view.kind === "activity") {
      return (
        <>
          <section className="px-6 py-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-2xl font-semibold">Activity</h2>
              {activity.length > 0 && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setConfirmClear(true)}
                >
                  <Trash2 className="size-3.5" /> Clear
                </Button>
              )}
            </div>
            {activity.length === 0 ? (
              <Empty className="border-border/70">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Activity className="size-4" />
                  </EmptyMedia>
                  <EmptyTitle>No activity yet</EmptyTitle>
                  <EmptyDescription>
                    When a sieve processes a file, the result will show up here.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
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
          <AlertDialog
            open={confirmClear}
            onOpenChange={(open) => {
              if (!open) setConfirmClear(false);
            }}
          >
            <AlertDialogContent size="sm">
              <AlertDialogHeader>
                <AlertDialogMedia className="bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive">
                  <Trash2 />
                </AlertDialogMedia>
                <AlertDialogTitle>Clear activity?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently remove all activity log entries from the
                  log file. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel variant="ghost">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => {
                    setConfirmClear(false);
                    void clearActivity();
                  }}
                >
                  Clear
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      );
    }

    if (view.kind === "settings") {
      return (
        <SettingsTab
          kinds={kinds}
          onAdd={addKind}
          onUpdate={updateKind}
          onDelete={deleteKind}
          onToggleEnabled={toggleKindEnabled}
          onReset={resetKind}
          dateFormat={dateFormat}
          onDateFormatChange={setDateFormat}
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
        <section className="flex h-full min-h-0 flex-col px-6 pt-5">
          <h2 className="-mx-6 shrink-0 border-b border-border/60 px-6 pb-4 text-2xl font-semibold">Edit sieve</h2>
          <div className="min-h-0 flex-1">
            <SieveForm
              key={view.index}
              kinds={kinds}
              initial={sieve}
              onSubmit={(updated) => void updateSieve(view.index, updated)}
              onCancel={cancelForm}
              dateFormat={dateFormat}
            />
          </div>
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
          <header
            className="flex h-10 shrink-0 items-center justify-end border-b border-border pl-4 pr-0"
            data-tauri-drag-region
          >
            <div className="flex h-full">
              <WindowControls />
            </div>
          </header>
          <ScrollArea className="min-w-0 flex-1" contentClassName="divide-y divide-border">
            {renderMain()}
          </ScrollArea>
        </div>
      </div>
      <Toaster position="top-center" offset={48} />
    </TooltipProvider>
  );
}

export default App;