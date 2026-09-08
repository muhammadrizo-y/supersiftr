import { useEffect, useId, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  File,
  Image,
  Plus,
  Video,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type SelectOption = { value: string; label: string };

const IMAGE_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico", "tif", "tiff",
  "avif", "heic", "heif", "jfif",
]);

const VIDEO_EXTENSIONS = new Set([
  "mp4", "mkv", "avi", "mov", "webm", "wmv", "flv", "m4v", "mpg", "mpeg",
  "3gp", "3g2", "ts", "m2ts", "ogv",
]);

function fileTypeIcon(value: string) {
  const ext = value.toLowerCase().replace(/^\./, "");
  if (IMAGE_EXTENSIONS.has(ext)) return Image;
  if (VIDEO_EXTENSIONS.has(ext)) return Video;
  return File;
}

function optionId(listId: string, i: number) {
  return `${listId}-opt-${i}`;
}

function activeDescId(listId: string, open: boolean, highlight: number, rowsLen: number, showAddRow: boolean) {
  if (!open) return undefined;
  const maxIndex = rowsLen + (showAddRow ? 1 : 0) - 1;
  if (maxIndex < 0) return undefined;
  return optionId(listId, Math.min(highlight, maxIndex));
}

export function Combobox({
  options,
  selected,
  onChange,
  placeholder,
  allowCustom = true,
  onBlur,
  label = "select values",
}: {
  options: SelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  allowCustom?: boolean;
  onBlur?: () => void;
  label?: string;
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

  const optionCount = rows.length + (showAddRow ? 1 : 0);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && query === "" && selected.length > 0) {
      removeTag(selected[selected.length - 1]);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      if (optionCount > 0) {
        setHighlight((h) => (h + 1) % optionCount);
      }
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      if (optionCount > 0) {
        setHighlight((h) => (h - 1 + optionCount) % optionCount);
      }
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

  const listId = useId();
  const actDesc = activeDescId(listId, showDropdown, highlight, rows.length, showAddRow);

  return (
    <div ref={containerRef} className="relative">
      {showDropdown && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          aria-label={`${label} options`}
          className="absolute bottom-full left-0 right-0 z-50 mb-1.5 max-h-56 overflow-y-auto overscroll-contain rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 scrollbar-gutter-stable duration-100 animate-in fade-in-0"
        >
          {rows.length === 0 && !showAddRow && (
            <div className="px-3 py-2 text-sm text-muted-foreground">No matches</div>
          )}
          {rows.map((row, i) => {
            const isActive = i === highlight;
            const Icon = fileTypeIcon(row.value);
            return (
              <div
                key={row.value}
                id={optionId(listId, i)}
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                role="option"
                aria-selected={isActive}
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
              id={optionId(listId, rows.length)}
              ref={(el) => {
                rowRefs.current[rows.length] = el;
              }}
              role="option"
              aria-selected={highlight === rows.length}
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
          role="combobox"
          aria-label={label}
          aria-expanded={showDropdown}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-controls={showDropdown ? listId : undefined}
          aria-activedescendant={actDesc}
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
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={open ? listId : undefined}
        >
          {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
      </div>
    </div>
  );
}