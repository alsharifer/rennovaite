"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { updateProjectName } from "@/app/_actions/update-project-name";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = {
  projectId: string;
  initialName: string;
  /**
   * Optional override for the size/typography of the rendered name.
   * Defaults to `text-3xl sm:text-4xl` (the plan-page sizing).
   */
  className?: string;
};

export function EditableProjectName({
  projectId,
  initialName,
  className,
}: Props) {
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
          className={cn(
            "h-auto border-ink-100 bg-paper px-3 py-2 font-semibold tracking-tight text-ink-900",
            className ?? "font-display text-3xl sm:text-4xl",
          )}
          aria-label="Project name"
        />
        {error && <p className="text-xs text-error">{error}</p>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={beginEdit}
      className={cn(
        "group inline-flex items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-surface-container-low",
        "font-semibold tracking-tight text-ink-900",
        className ?? "font-display text-3xl sm:text-4xl",
      )}
      aria-label="Edit project name"
    >
      <span>{name}</span>
      <span
        className="material-symbols-outlined text-[18px] text-ink-500 opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden="true"
      >
        edit
      </span>
    </button>
  );
}
