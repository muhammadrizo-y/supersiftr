import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Combobox, type SelectOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { allKnownExtensions } from "@/lib/sieves";
import type { Kind } from "@/types";

export function KindForm({
  kinds,
  initial,
  onSave,
  onCancel,
}: {
  kinds: Kind[];
  initial?: Kind;
  onSave: (kind: Kind) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [extensions, setExtensions] = useState<string[]>(initial?.extensions ?? []);
  const [extTouched, setExtTouched] = useState(false);

  const extOptions: SelectOption[] = allKnownExtensions(kinds).map((e) => ({
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
          enabled: true,
          is_default: initial?.is_default ?? false,
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="kind-name">Name (id) *</Label>
        <Input
          id="kind-name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="movie"
          disabled={!!initial}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="kind-title">Title *</Label>
        <Input
          id="kind-title"
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