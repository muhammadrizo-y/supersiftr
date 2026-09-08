import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Pencil, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Toaster } from "@/components/ui/sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SieveForm } from "@/components/SieveForm";
import { SettingsTab } from "@/components/SettingsTab";
import Sidebar from "@/components/Sidebar";
import { WindowControls } from "@/components/WindowControls";
import { cn } from "@/lib/utils";
import {
  describeActions,
  describeConditions,
  isRunnable,
  kindByTitle,
  missingKinds,
} from "@/lib/sieves";
import type { ActivityEntry, Kind, Sieve, View } from "@/types";

function App() {
  const [sieves, setSieves] = useState<Sieve[]>([]);
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [view, setView] = useState<View>({ kind: "new" });

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
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setView({ kind: "settings" });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
    const updated = await invoke<Kind[]>("delete_kind", { name });
    setKinds(updated);
    log(`Deleted kind: ${name}`);
    toast.success(`Kind "${name}" deleted`);
  }

  async function toggleKindEnabled(name: string, enabled: boolean) {
    const updated = await invoke<Kind[]>("set_kind_enabled", { name, enabled });
    setKinds(updated);
  }

  async function resetKind(name: string) {
    const updated = await invoke<Kind[]>("reset_kind", { name });
    setKinds(updated);
  }

  function renderSieveDetail(sieve: Sieve, index: number) {
    const missing = missingKinds(sieve, kinds);
    return (
      <section className="px-6 py-5">
        {missing.length > 0 && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              Missing kind{missing.length > 1 ? "s" : ""}:{" "}
              {missing.map((m) => kindByTitle(kinds, m)).join(", ")}.
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
          <dd>{describeConditions(sieve, kinds)}</dd>
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
            kinds={kinds}
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
          kinds={kinds}
          onAdd={addKind}
          onUpdate={updateKind}
          onDelete={deleteKind}
          onToggleEnabled={toggleKindEnabled}
          onReset={resetKind}
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
            kinds={kinds}
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