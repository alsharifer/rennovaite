"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Pencil } from "lucide-react";

import { updateProjectName } from "@/app/_actions/update-project-name";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = {
  projectId: string;
  initialName: string;
};

export function EditableProjectName({ projectId, initialName }: Props) {
  const [name, setName] = useState(initialName);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const beginEdit = () => {
    setDraft(name);
    setError(null);
    setEditing(true);
  };

  const commit = () => {
    const next = draft.trim();
    if (!next) {
      setError("Name cannot be empty.");
      return;
    }
    if (next === name) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      const result = await updateProjectName(projectId, next);
      if (result.success) {
        setName(next);
        setEditing(false);
        setError(null);
      } else {
        setError(result.error);
      }
    });
  };

  const cancel = () => {
    setDraft(name);
    setError(null);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="space-y-2">
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          onBlur={commit}
          disabled={isPending}
          className="h-auto border-bg-border bg-bg-elevated px-3 py-2 font-display text-3xl font-semibold tracking-tight text-text-primary focus-visible:ring-brand-primary/40 sm:text-4xl"
          aria-label="Project name"
        />
        {error && <p className="text-xs text-status-error">{error}</p>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={beginEdit}
      className={cn(
        "group inline-flex items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-bg-elevated/60",
        "font-display text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl",
      )}
      aria-label="Edit project name"
    >
      <span>{name}</span>
      <Pencil className="size-4 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}
