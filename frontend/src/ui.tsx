import type { VersionStatus, Visibility } from "./types";

export const formatSize = (size: number) => {
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
