import { Activity, Plus, Settings, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Rule, View } from "@/types";

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
      {label}
    </button>
  );
}

function Sidebar({
  rules,
  view,
  onSelect,
  onDelete,
}: {
  rules: Rule[];
  view: View;
  onSelect: (view: View) => void;
  onDelete: (index: number) => void;
}) {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
        <h1 className="px-1 text-sm font-semibold">Rules</h1>
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
          <TooltipContent>New rule</TooltipContent>
        </Tooltip>
      </header>

      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-2">
        {rules.map((rule, i) => (
          <div
            key={i}
            role="button"
            tabIndex={0}
            onClick={() => onSelect({ kind: "rule", index: i })}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                onSelect({ kind: "rule", index: i });
              }
            }}
            className={cn(
              "group flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
              view.kind === "rule" && view.index === i
                ? "bg-accent text-accent-foreground"
                : "text-foreground hover:bg-accent/60",
            )}
          >
            <span className="truncate">{rule.name}</span>
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
              <TooltipContent side="right">Delete rule</TooltipContent>
            </Tooltip>
          </div>
        ))}
        {rules.length === 0 && (
          <p className="px-2 py-1 text-xs text-muted-foreground">No rules yet.</p>
        )}
      </nav>

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