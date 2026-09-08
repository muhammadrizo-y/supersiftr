import { Activity, Plus, Settings, Trash2 } from "lucide-react";
import { useRef } from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Sieve, View } from "@/types";

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
        "flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-3 text-sm font-medium transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground",
      )}
    >
      {icon}
      <span className="leading-none">{label}</span>
    </button>
  );
}

function Sidebar({
  sieves,
  view,
  onSelect,
  onDelete,
}: {
  sieves: Sieve[];
  view: View;
  onSelect: (view: View) => void;
  onDelete: (index: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  const selectedIndex =
    view.kind === "sieve" || view.kind === "edit" ? view.index : -1;

  function focusRow(index: number) {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-sieve-index="${index}"]`)
      ?.focus();
  }

  function moveSelection(dir: 1 | -1) {
    const count = sieves.length;
    if (count === 0) return;
    const base = selectedIndex >= 0 ? selectedIndex : dir === 1 ? -1 : count;
    const next = Math.min(count - 1, Math.max(0, base + dir));
    onSelect({ kind: "sieve", index: next });
    focusRow(next);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveSelection(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveSelection(-1);
    }
  }

  return (
    <aside
      className="flex w-60 shrink-0 flex-col border-r border-border bg-background"
      onKeyDown={handleKeyDown}
    >
      <header
        className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3"
        data-tauri-drag-region
      >
        <h1
          className="px-1 text-sm leading-none font-semibold"
          data-tauri-drag-region
        >
          <span>Sieves</span>
        </h1>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon"
                variant="ghost"
                onClick={() => onSelect({ kind: "new" })}
              >
                <Plus className="size-4" />
              </Button>
            }
          />
          <TooltipContent>New sieve</TooltipContent>
        </Tooltip>
      </header>

      <ScrollArea className="min-h-0 flex-1" contentClassName="flex flex-col gap-0.5 px-2 py-2">
        {sieves.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">No sieves yet.</p>
        ) : (
          <div
            ref={listRef}
            role="listbox"
            aria-label="Sieves"
            aria-activedescendant={
              selectedIndex >= 0 ? `sieve-option-${selectedIndex}` : undefined
            }
            data-sieve-list
            tabIndex={0}
            className="flex flex-col gap-0.5 outline-none"
          >
            {sieves.map((sieve, i) => (
              <div
                key={i}
                id={`sieve-option-${i}`}
                role="option"
                aria-selected={i === selectedIndex}
                data-sieve-index={i}
                tabIndex={0}
                onClick={() => onSelect({ kind: "sieve", index: i })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    onSelect({ kind: "sieve", index: i });
                  }
                }}
                className={cn(
                  "group flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                  i === selectedIndex
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground hover:bg-accent/60",
                )}
              >
                <span className="truncate">{sieve.name}</span>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(i);
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    }
                  />
                  <TooltipContent side="right">Delete sieve</TooltipContent>
                </Tooltip>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      <div className="flex shrink-0 flex-col gap-0.5 border-t border-border p-2">
        <SidebarTab
          label="Activity"
          icon={<Activity className="size-4" />}
          active={view.kind === "activity"}
          onClick={() => onSelect({ kind: "activity" })}
        />
        <SidebarTab
          label="Settings"
          icon={<Settings className="size-4" />}
          active={view.kind === "settings"}
          onClick={() => onSelect({ kind: "settings" })}
        />
      </div>
    </aside>
  );
}

export default Sidebar;