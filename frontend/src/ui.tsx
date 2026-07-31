import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";
import type { VersionStatus, Visibility } from "./types";

export const formatSize = (size: number) => {
  if (size >= 1024 * 1024 * 1024) {
    return `${(size / 1024 / 1024 / 1024).toFixed(1)} GiB`;
  }
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MiB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KiB`;
  return `${size} B`;
};

export const formatDate = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat("de-DE", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";

export const statusLabels: Record<VersionStatus, string> = {
  draft: "Entwurf",
  pending: "In Prüfung",
  published: "Veröffentlicht",
  rejected: "Abgelehnt",
};

export const visibilityLabels: Record<Visibility, string> = {
  project: "Projektintern",
  organization: "Organisationsweit",
};

export function StatusBadge({ status }: { status: VersionStatus }) {
  return <span className={`tag ${status}`}>{statusLabels[status]}</span>;
}

export function VisibilityBadge({
  visibility,
}: {
  visibility?: Visibility;
}) {
  return (
    <span className={`tag ${visibility ?? "private"}`}>
      {visibility ? visibilityLabels[visibility] : "Privat"}
    </span>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  tone = "default",
  busy = false,
  children,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  tone?: "default" | "danger";
  busy?: boolean;
  children?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCancelRef = useRef(onCancel);
  const busyRef = useRef(busy);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    cancelRef.current?.focus();
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]",
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyboard);
    return () => {
      document.removeEventListener("keydown", handleKeyboard);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="dialog-backdrop" onMouseDown={() => !busy && onCancel()}>
      <section
        aria-describedby="confirm-dialog-description"
        aria-labelledby="confirm-dialog-title"
        aria-modal="true"
        className="confirm-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="alertdialog"
      >
        <div className="dialog-icon" aria-hidden="true">
          <Icon name={tone === "danger" ? "close" : "check"} />
        </div>
        <div>
          <h2 id="confirm-dialog-title">{title}</h2>
          <div id="confirm-dialog-description">
            {description && <p>{description}</p>}
            {children && <p>{children}</p>}
          </div>
        </div>
        <div className="dialog-actions">
          <button
            className="secondary"
            disabled={busy}
            onClick={onCancel}
            ref={cancelRef}
            type="button"
          >
            Abbrechen
          </button>
          <button
            className={`primary ${tone === "danger" ? "danger" : ""}`}
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {busy ? "Wird ausgeführt …" : confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
