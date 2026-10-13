"use client";

// =============================================================================
// components/blueprint/projects/ProjectActions.tsx — rename · archive · delete
// (K10 #1, spec §6.12; Figma 76:2719 menu · 76:2981 confirm · 77:2905 Recently
// deleted; dark 77:8601 · 77:8908 · 77:9218).
//
// ProjectActionsMenu   the trailing "⋯" (32 px, "Actions for <project>") on a
//                      Projects-home row and in the Overview / hub top bar.
//                      Menu button pattern: Enter / Space / ↓ opens on the
//                      first item, ↑ ↓ Home End move, Esc closes and returns
//                      focus, Tab closes. Open · Rename · Archive (Unarchive)
//                      · hairline · Delete project… — disabled WITH its reason
//                      for anyone but the creator (owner project) / a firm
//                      admin (firm project).
// DeleteDialog         the confirm (76:2981): real counts, the inverse "a
//                      proposal was issued" block + Download pack, the name to
//                      type (case-insensitive, trimmed), Cancel / Delete
//                      project (disabled with its reason until the name
//                      matches), "Archive instead". After delete → the
//                      Projects home with the undo toast.
// DeleteNowDialog      Recently deleted → "Delete now": the name again.
// UndoToast            ink toast, role="status", 8 s: "<name> moved to Recently
//                      deleted · Undo".
// MoveFirmDialog       K11 #5 "Move to firm…" (76:2981's layout): one of the
//                      caller's firms or "No firm — personal project"; what
//                      changes, in two sentences; an option that is not allowed
//                      says why (the creator rule; who is not in the firm; a
//                      member of the current firm to detach) — the preview
//                      (GET …/move-preview) and PATCH { firm_id } share the
//                      rules (lib/projects/move-firm.ts, assignProjectFirm).
// Copy rule: archive is never called delete — "hidden from your list, nothing
// lost".
// =============================================================================

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Button } from "../Button";
import { Icon } from "../Icon";

export interface ActionProject {
  id: string;
  name: string;
  archived: boolean;
  deletable: { allowed: boolean; reason: string | null };
}

const nameMatches = (typed: string, name: string) => typed.trim().toLowerCase() === name.trim().toLowerCase() && name.trim().length > 0;

async function send(url: string, method: string, body?: unknown): Promise<{ ok: boolean; error: string | null; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, error: res.ok ? null : String(data.error ?? `Request failed (${res.status}).`), data };
  } catch {
    return { ok: false, error: "The request did not reach the server. Try again.", data: {} };
  }
}

// --- the dialog shell: native <dialog> (focus trap, Esc, focus returned) ---------------------

function Dialog({ open, onClose, labelledBy, children, testId }: { open: boolean; onClose: () => void; labelledBy: string; children: ReactNode; testId?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      data-testid={testId}
      className="m-auto w-[min(544px,calc(100vw-32px))] text-left max-h-[calc(100vh-32px)] overflow-y-auto rounded-none border border-bp-line-strong bg-bp-surface-base p-0 text-bp-ink-primary backdrop:bg-black/55"
    >
      {open ? children : null}
    </dialog>
  );
}

// --- Rename ---------------------------------------------------------------------------------

function RenameDialog({ project, open, onClose }: { project: ActionProject; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const titleId = useId();
  const reasonId = useId();
  const [name, setName] = useState(project.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();
  const unchanged = trimmed === project.name.trim();
  const reason = !trimmed ? "Enter a name" : unchanged ? "The name has not changed" : null;
  async function save() {
    if (reason) return;
    setBusy(true);
    const r = await send(`/api/projects/${project.id}`, "PATCH", { name: trimmed });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onClose();
    router.refresh();
  }
  return (
    <Dialog open={open} onClose={onClose} labelledBy={titleId} testId="rename-dialog">
      <form
        className="p-8"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="t-label-caps text-bp-ink-tertiary">RENAME PROJECT</p>
        <h2 id={titleId} className="t-heading-lg mt-3">
          Rename {project.name}
        </h2>
        <label className="mt-6 block">
          <span className="t-nav-item-active block text-bp-ink-primary">Project name</span>
          <input
            autoFocus
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            className="t-body-md mt-2 h-11 w-full border border-bp-line-control bg-bp-surface-base px-3 text-bp-ink-primary outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring"
          />
        </label>
        {error ? <p className="surface-inverse t-body-sm mt-4 bg-bp-alert-surface px-4 py-3 text-bp-alert-ink" role="alert">{error}</p> : null}
        <div className="mt-6 flex items-center justify-end gap-5">
          <Button kind="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="primary" type="submit" disabled={reason || busy ? { reason: busy ? "Saving…" : reason!, reasonId, showReason: !busy } : false}>
            {busy ? "Saving…" : "Save name"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// --- Delete ---------------------------------------------------------------------------------

interface Preview {
  name: string;
  permission: { allowed: boolean; reason: string | null };
  counts: { revisions: number; renders: number; uploads: number; proposals: number };
  proposalIssued: boolean;
  packHref: string | null;
}

export function DeleteDialog({ project, open, onClose, onArchive }: { project: ActionProject; open: boolean; onClose: () => void; onArchive: () => void }) {
  const router = useRouter();
  const titleId = useId();
  const reasonId = useId();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void send(`/api/projects/${project.id}/delete-preview`, "GET").then((r) => {
      if (!live) return;
      if (r.ok) setPreview(r.data as unknown as Preview);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [open, project.id]);

  const name = preview?.name ?? project.name;
  const matches = nameMatches(typed, name);
  const reason = !preview ? "Loading what gets deleted…" : !preview.permission.allowed ? (preview.permission.reason ?? "Not allowed") : !matches ? "Type the project name to confirm" : null;

  async function remove() {
    if (reason) return;
    setBusy(true);
    const r = await send(`/api/projects/${project.id}`, "DELETE", { confirm_name: typed });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onClose();
    router.push(`/projects?undo=${project.id}`);
    router.refresh();
  }

  const rows: [number, string][] = preview
    ? [
        [preview.counts.revisions, `BoQ revision${preview.counts.revisions === 1 ? "" : "s"} and their approval history`],
        [preview.counts.renders, "renders and design choices"],
        [preview.counts.uploads, `uploaded drawing${preview.counts.uploads === 1 ? "" : "s"} and photos`],
        [preview.counts.proposals, `issued proposal${preview.counts.proposals === 1 ? "" : "s"} (PDF and record)`],
      ]
    : [];

  return (
    <Dialog open={open} onClose={onClose} labelledBy={titleId} testId="delete-dialog">
      <form
        className="p-8"
        onSubmit={(e) => {
          e.preventDefault();
          void remove();
        }}
      >
        <p className="t-label-caps text-bp-ink-tertiary">DELETE PROJECT</p>
        <h2 id={titleId} className="t-heading-lg mt-3">
          Delete {name}?
        </h2>
        <p className="t-body-md mt-4 text-bp-ink-primary">It moves to Recently deleted for 30 days, hidden from everyone on the project. After 30 days it is removed permanently.</p>

        <p className="t-label-caps mt-6 text-bp-ink-tertiary">WHAT GETS DELETED</p>
        {preview ? (
          <ul className="mt-1" data-delete-counts>
            {rows.map(([n, label]) => (
              <li key={label} className="flex gap-6 border-b border-bp-line-hairline py-2.5">
                <span className="t-num-md w-7 shrink-0 font-bp-mono tabular-nums text-bp-ink-primary">{n}</span>
                <span className="t-body-sm text-bp-ink-primary">{label}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="t-body-sm mt-2 text-bp-ink-tertiary" aria-live="polite">
            Counting…
          </p>
        )}

        {preview?.proposalIssued ? (
          <div className="surface-inverse mt-5 flex flex-wrap items-start gap-x-6 gap-y-3 bg-bp-alert-surface px-4 py-4 text-bp-alert-ink" role="note" data-proposal-issued>
            <Icon name="info" size={18} />
            <div className="min-w-0 flex-1">
              <p className="t-nav-item-active">A proposal was issued to a client from this project.</p>
              <p className="t-body-sm mt-1">Download the pack first if you need to keep a record.</p>
            </div>
            {preview.packHref ? (
              <Button kind="quiet" tone="inverse" href={preview.packHref}>
                Download pack
              </Button>
            ) : null}
          </div>
        ) : null}

        {preview && !preview.permission.allowed ? (
          <p className="surface-inverse t-body-sm mt-5 bg-bp-alert-surface px-4 py-3 text-bp-alert-ink" role="note">
            {preview.permission.reason}.
          </p>
        ) : (
          <label className="mt-6 block">
            <span className="t-nav-item-active block text-bp-ink-primary">Type the project name to confirm</span>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-describedby={reason ? reasonId : undefined}
              placeholder={name}
              className="t-body-md mt-2 h-11 w-full border border-bp-line-control bg-bp-surface-base px-3 text-bp-ink-primary outline-none placeholder:text-bp-ink-tertiary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring"
              data-testid="delete-confirm-name"
            />
          </label>
        )}

        {error ? <p className="surface-inverse t-body-sm mt-4 bg-bp-alert-surface px-4 py-3 text-bp-alert-ink" role="alert">{error}</p> : null}

        <div className="mt-6 flex flex-wrap items-center gap-5">
          <button
            type="button"
            onClick={() => {
              onClose();
              onArchive();
            }}
            className="t-body-sm mr-auto text-bp-ink-secondary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring"
          >
            {project.archived ? "Keep it archived instead" : "Archive instead"}
          </button>
          <Button kind="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="primary" type="submit" testId="delete-confirm" disabled={reason || busy ? { reason: busy ? "Deleting…" : reason!, reasonId, showReason: false } : false}>
            {busy ? "Deleting…" : "Delete project"}
          </Button>
        </div>
        {/* The disabled Primary's reason (K7: every disabled control's describedby resolves). Shown under the
            button while the name is still to type; read out otherwise (loading, refused, deleting). */}
        <p id={reasonId} className={reason && preview?.permission.allowed && !busy ? "t-body-sm mt-2 text-right text-bp-ink-tertiary" : "sr-only"}>
          {busy ? "Deleting…" : (reason ?? "")}
        </p>
      </form>
    </Dialog>
  );
}

// --- Move to firm (K11 #5) ------------------------------------------------------------------

interface MoveOption {
  firmId: string | null;
  name: string;
  current: boolean;
  allowed: boolean;
  reason: string | null;
  outside: string[];
}
interface MovePreview {
  name: string;
  currentFirm: { id: string; name: string } | null;
  options: MoveOption[];
}

export function MoveFirmDialog({ project, open, onClose }: { project: ActionProject; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const titleId = useId();
  const reasonId = useId();
  const groupId = useId();
  const [preview, setPreview] = useState<MovePreview | null>(null);
  const [choice, setChoice] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void send(`/api/projects/${project.id}/move-preview`, "GET").then((r) => {
      if (!live) return;
      if (!r.ok) return setError(r.error);
      const p = r.data as unknown as MovePreview;
      setPreview(p);
      // Start on the first option that is not where the project is now.
      setChoice((p.options.find((o) => !o.current) ?? p.options[0])?.firmId);
    });
    return () => {
      live = false;
    };
  }, [open, project.id]);

  const selected = preview?.options.find((o) => o.firmId === choice) ?? null;
  const reason = !preview ? "Loading your firms…" : !selected ? "Choose where the project goes" : selected.allowed ? null : (selected.reason ?? "Not allowed");
  const name = preview?.name ?? project.name;

  async function move() {
    if (reason || !selected) return;
    setBusy(true);
    const r = await send(`/api/projects/${project.id}`, "PATCH", { firm_id: selected.firmId });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onClose();
    router.refresh();
  }

  return (
    <Dialog open={open} onClose={onClose} labelledBy={titleId} testId="move-firm-dialog">
      <form
        className="p-8"
        onSubmit={(e) => {
          e.preventDefault();
          void move();
        }}
      >
        <p className="t-label-caps text-bp-ink-tertiary">MOVE PROJECT</p>
        <h2 id={titleId} className="t-heading-lg mt-3">
          Move {name} to a firm
        </h2>
        <p className="t-body-md mt-4 text-bp-ink-primary">
          On a firm project everyone works the firm&rsquo;s journey (00&ndash;08), and the next regenerate prices the BoQ from the firm&rsquo;s rate book. Every member of the project must be a member of the firm.
        </p>
        {preview?.currentFirm ? (
          <p className="t-body-sm mt-2 text-bp-ink-secondary" data-current-firm>
            Now in {preview.currentFirm.name}.
          </p>
        ) : null}

        <p id={groupId} className="t-label-caps mt-6 text-bp-ink-tertiary">
          MOVE TO
        </p>
        {preview ? (
          <div role="radiogroup" aria-labelledby={groupId} className="mt-1" data-move-options>
            {preview.options.map((o) => (
              <label key={o.firmId ?? "none"} className={`flex items-start gap-3 border-b border-bp-line-hairline py-3 ${o.current ? "cursor-default" : "cursor-pointer"}`} data-move-option={o.firmId ?? "none"} data-allowed={o.allowed ? "true" : "false"}>
                <input type="radio" name={`${groupId}-firm`} checked={choice === o.firmId} disabled={o.current} onChange={() => setChoice(o.firmId)} className="mt-1 size-4 accent-bp-ink-primary" />
                <span className="min-w-0 flex-1">
                  <span className={`t-nav-item-active block ${o.current ? "text-bp-ink-tertiary" : "text-bp-ink-primary"}`}>
                    {o.name}
                    {o.current ? " · now" : ""}
                  </span>
                  {o.firmId === null && !o.current ? <span className="t-body-sm block text-bp-ink-secondary">The owner&rsquo;s journey (00&ndash;06); the firm&rsquo;s book no longer prices it.</span> : null}
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p className="t-body-sm mt-2 text-bp-ink-tertiary" aria-live="polite">
            Loading your firms…
          </p>
        )}

        {selected && !selected.allowed && !selected.current ? (
          <div className="surface-inverse mt-5 bg-bp-alert-surface px-4 py-3 text-bp-alert-ink" role="note" data-move-blocked>
            {/* The reason names everyone outside the firm (the PATCH refuses with the same sentence). */}
            <p className="t-body-sm">{selected.reason}</p>
          </div>
        ) : null}

        {error ? (
          <p className="surface-inverse t-body-sm mt-4 bg-bp-alert-surface px-4 py-3 text-bp-alert-ink" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center justify-end gap-5">
          <Button kind="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="primary" type="submit" testId="move-firm-confirm" disabled={reason || busy ? { reason: busy ? "Moving…" : reason!, reasonId, showReason: false } : false}>
            {busy ? "Moving…" : selected?.firmId === null ? "Make it personal" : "Move project"}
          </Button>
        </div>
        <p id={reasonId} className="sr-only">
          {busy ? "Moving…" : (reason ?? "")}
        </p>
      </form>
    </Dialog>
  );
}

// --- Delete now (Recently deleted) ----------------------------------------------------------

export function DeleteNowDialog({ project, open, onClose }: { project: { id: string; name: string }; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const titleId = useId();
  const reasonId = useId();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reason = !nameMatches(typed, project.name) ? "Type the project name to confirm" : null;
  async function purge() {
    if (reason) return;
    setBusy(true);
    const r = await send(`/api/projects/${project.id}/delete-now`, "POST", { confirm_name: typed });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onClose();
    router.refresh();
  }
  return (
    <Dialog open={open} onClose={onClose} labelledBy={titleId} testId="delete-now-dialog">
      <form
        className="p-8"
        onSubmit={(e) => {
          e.preventDefault();
          void purge();
        }}
      >
        <p className="t-label-caps text-bp-ink-tertiary">DELETE NOW</p>
        <h2 id={titleId} className="t-heading-lg mt-3">
          Remove {project.name} permanently?
        </h2>
        <p className="t-body-md mt-4">Everything goes now — its revisions, renders, uploaded drawings and photos, and its documents. This cannot be undone.</p>
        <label className="mt-6 block">
          <span className="t-nav-item-active block">Type the project name to confirm</span>
          <input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder={project.name}
            className="t-body-md mt-2 h-11 w-full border border-bp-line-control bg-bp-surface-base px-3 text-bp-ink-primary outline-none placeholder:text-bp-ink-tertiary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring"
          />
        </label>
        {error ? <p className="surface-inverse t-body-sm mt-4 bg-bp-alert-surface px-4 py-3 text-bp-alert-ink" role="alert">{error}</p> : null}
        <div className="mt-6 flex items-center justify-end gap-5">
          <Button kind="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="primary" type="submit" disabled={reason || busy ? { reason: busy ? "Removing…" : reason!, reasonId, showReason: !busy } : false}>
            {busy ? "Removing…" : "Delete now"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// --- The menu -------------------------------------------------------------------------------

export function ProjectActionsMenu({ project, size = "row" }: { project: ActionProject; size?: "row" | "topbar" }) {
  const router = useRouter();
  const menuId = useId();
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<null | "rename" | "delete" | "move">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  /** The menu's items, in order — read from the DOM when a key is pressed, never during render. */
  const menuItems = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  const focusItem = (i: number) => {
    const list = menuItems();
    list[(i + list.length) % list.length]?.focus();
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  useEffect(() => {
    // Opening puts focus on the first item (menu button pattern).
    if (open) requestAnimationFrame(() => menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
  }, [open]);

  async function archive() {
    setBusy(true);
    const r = await send(`/api/projects/${project.id}`, "PATCH", { archived: !project.archived });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    const list = menuItems();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const to: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: list.length - 1 };
    if (e.key in to) {
      e.preventDefault();
      focusItem(to[e.key]!);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") close(false);
  }

  const itemCls = "t-body-sm flex w-full min-h-10 items-center gap-3 px-4 py-2 text-left text-bp-ink-primary outline-none hover:bg-bp-surface-sunken focus-visible:bg-bp-surface-sunken focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-bp-focus-ring";

  return (
    <div ref={wrap} className="relative inline-flex">
      <button
        ref={button}
        type="button"
        aria-label={`Actions for ${project.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        data-testid="project-actions"
        className={`relative inline-flex items-center justify-center text-bp-ink-secondary hover:bg-bp-surface-sunken hover:text-bp-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring ${size === "row" ? "h-8 w-8" : "h-9 w-9 border border-bp-line-control"}`}
      >
        <Icon name="more_horiz" size={20} />
      </button>
      {open ? (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={`Actions for ${project.name}`}
          onKeyDown={onMenuKey}
          className="absolute right-0 top-full z-40 mt-1 w-[248px] border border-bp-line-strong bg-bp-surface-raised py-1 text-left shadow-none"
          data-testid="project-actions-menu"
        >
          <Link role="menuitem" tabIndex={-1} href={`/project/${project.id}`} className={itemCls} onClick={() => close(false)}>
            <Icon name="open_in_new" size={20} />
            Open
          </Link>
          <button
            role="menuitem"
            tabIndex={-1}
            type="button"
            className={itemCls}
            onClick={() => {
              close(false);
              setDialog("rename");
            }}
          >
            <Icon name="edit" size={20} />
            Rename
          </button>
          <button
            role="menuitem"
            tabIndex={-1}
            type="button"
            className={itemCls}
            onClick={() => {
              close();
              void archive();
            }}
          >
            <Icon name={project.archived ? "unarchive" : "archive"} size={20} />
            {project.archived ? "Unarchive" : "Archive"}
          </button>
          <button
            role="menuitem"
            tabIndex={-1}
            type="button"
            className={itemCls}
            onClick={() => {
              close(false);
              setDialog("move");
            }}
            data-testid="project-move-firm"
          >
            <Icon name="domain" size={20} />
            Move to firm…
          </button>
          <div role="separator" className="my-1 border-t border-bp-line-hairline" />
          <button
            role="menuitem"
            tabIndex={-1}
            type="button"
            aria-disabled={!project.deletable.allowed || undefined}
            aria-describedby={!project.deletable.allowed ? reasonId : undefined}
            className={`${itemCls} ${project.deletable.allowed ? "" : "cursor-not-allowed text-bp-ink-tertiary hover:bg-transparent"}`}
            onClick={() => {
              if (!project.deletable.allowed) return;
              close(false);
              setDialog("delete");
            }}
            data-testid="project-delete"
          >
            <Icon name="delete" size={20} />
            Delete project…
          </button>
          {!project.deletable.allowed ? (
            <p id={reasonId} className="t-body-sm px-4 pb-2 pl-[52px] text-bp-ink-tertiary">
              {project.deletable.reason}
            </p>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="surface-inverse t-body-sm absolute right-0 top-full z-40 mt-1 w-[248px] text-left bg-bp-alert-surface px-3 py-2 text-bp-alert-ink">
          {error}
        </p>
      ) : null}
      {dialog === "rename" ? <RenameDialog project={project} open onClose={() => setDialog(null)} /> : null}
      {dialog === "move" ? <MoveFirmDialog project={project} open onClose={() => setDialog(null)} /> : null}
      {dialog === "delete" ? <DeleteDialog project={project} open onClose={() => setDialog(null)} onArchive={() => (project.archived ? undefined : void archive())} /> : null}
    </div>
  );
}

// --- Undo toast -----------------------------------------------------------------------------

export function UndoToast({ projectId, name, onDone }: { projectId: string; name: string; onDone: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(onDone, 8000);
    return () => clearTimeout(t);
  }, [onDone]);
  async function undo() {
    setBusy(true);
    const r = await send(`/api/projects/${projectId}/restore`, "POST");
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onDone();
    router.refresh();
  }
  return (
    <div role="status" className="surface-inverse fixed bottom-6 right-4 z-50 flex max-w-[calc(100vw-32px)] items-center gap-4 bg-bp-alert-surface px-5 py-3.5 text-bp-alert-ink md:right-12" data-testid="undo-toast">
      <Icon name="check" size={18} />
      <span className="t-body-sm">{error ?? `${name} moved to Recently deleted`}</span>
      <button type="button" onClick={() => void undo()} disabled={busy} className="t-nav-item-active text-bp-alert-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring-inverse">
        {busy ? "Restoring…" : "Undo"}
      </button>
    </div>
  );
}
