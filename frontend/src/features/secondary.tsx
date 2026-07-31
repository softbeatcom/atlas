import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Icon } from "../icons";
import type { AuditEvent, Dataset, Notification } from "../types";
import { formatDate, formatSize, StatusBadge } from "../ui";

function isModifiedClick(event: React.MouseEvent) {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

export function Approvals({
  items,
  onOpen,
}: {
  items: Dataset[];
  onOpen: (id: string, version: number) => void;
}) {
  return (
    <>
      <div className="title-row">
        <div>
          <h1>Offene Freigaben</h1>
          <p>
            Prüfe einen eindeutig versionierten Dateistand und seine
            Metadaten vor der Veröffentlichung.
          </p>
        </div>
        <span className="result-count">{items.length} offen</span>
      </div>
      <section className="card list approval-list" aria-label="Offene Freigaben">
        {items.map((item) => (
          <a
            className="approval-row"
            href={`/datasets/${encodeURIComponent(item.id)}/versions/${item.version.number}`}
            key={`${item.id}-${item.version.number}`}
            onClick={(event) => {
              if (isModifiedClick(event)) return;
              event.preventDefault();
              onOpen(item.id, item.version.number);
            }}
          >
            <span className="file">
              <Icon name="file" size={18} />
              <small>
                {item.version.distributions[0]?.filename
                  .split(".")
                  .pop()
                  ?.toUpperCase() ?? "—"}
              </small>
            </span>
            <span className="dataset-title">
              <b>{item.version.title}</b>
              <small>
                {item.project?.name ?? "Privat"} · Version{" "}
                {item.version.version_label} · {item.version.creator}
              </small>
            </span>
            <span className="approval-meta">
              {item.version.distribution_count} Dateien ·{" "}
              {formatSize(item.version.total_size)}
            </span>
            <span className="approval-time">
              Eingereicht {formatDate(item.version.modified_at)}
            </span>
            <StatusBadge status="pending" />
          </a>
        ))}
        {items.length === 0 && (
          <div className="empty">
            <Icon name="check" size={22} />
            <b>Keine offenen Freigaben</b>
            <span>Alle eingereichten Versionen sind bearbeitet.</span>
          </div>
        )}
      </section>
    </>
  );
}

export function Notifications({
  items,
  onOpen,
  onChanged,
  onError,
}: {
  items: Notification[];
  onOpen: (id: string, version: number) => void;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const open = async (
    event: React.MouseEvent<HTMLAnchorElement>,
    notification: Notification,
  ) => {
    if (isModifiedClick(event)) return;
    event.preventDefault();
    try {
      if (!notification.read) {
        await api.markNotificationRead(notification.id);
        await onChanged();
      }
      onOpen(notification.dataset_id, notification.version_number);
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : "Benachrichtigung fehlgeschlagen",
      );
    }
  };

  return (
    <>
      <h1>Benachrichtigungen</h1>
      <p>Freigaben und Entscheidungen zu deinen Ressourcen.</p>
      <section className="card list notification-list">
        {items.map((notification) => (
          <a
            className={`notification-row ${notification.read ? "" : "unread"}`}
            href={`/datasets/${encodeURIComponent(notification.dataset_id)}/versions/${notification.version_number}`}
            key={notification.id}
            onClick={(event) => void open(event, notification)}
          >
            <span className="notification-dot" aria-hidden="true" />
            {!notification.read && <span className="sr-only">Ungelesen: </span>}
            <span>
              <b>{notification.message}</b>
              <small>
                Version {notification.version_number} ·{" "}
                {formatDate(notification.created_at)}
              </small>
            </span>
            <Icon name="chevron-down" size={17} />
          </a>
        ))}
        {items.length === 0 && (
          <div className="empty">
            <Icon name="bell" size={22} />
            <b>Keine Benachrichtigungen</b>
            <span>Neue Workflow-Ereignisse erscheinen hier.</span>
          </div>
        )}
      </section>
    </>
  );
}

const actionLabels: Record<string, string> = {
  "dataset.published": "Ressource veröffentlicht",
  "dataset.version.created": "Version erstellt",
  "dataset.submitted_for_approval": "Zur Freigabe eingereicht",
  "dataset.approved": "Version freigegeben",
  "dataset.rejected": "Version abgelehnt",
  "project.created": "Projekt erstellt",
  "project.updated": "Projekt aktualisiert",
  "project.membership.updated": "Projektzugriff aktualisiert",
  "project.membership.deleted": "Projektzugriff entfernt",
};

export function AuditLog({
  onError,
}: {
  onError: (message: string) => void;
}) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
    api
      .audit()
      .then((result) => active && setEvents(result))
      .catch((error) => onError(error.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [onError]);

  const visibleEvents = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return events;
    return events.filter((event) =>
      [
        actionLabels[event.action] ?? event.action,
        event.actor_subject,
        event.dataset_id ?? "System",
        String(event.version_number ?? ""),
      ].some((value) => value.toLocaleLowerCase().includes(normalized)),
    );
  }, [events, query]);

  return (
    <>
      <div className="title-row">
        <div>
          <h1>Audit-Log</h1>
          <p>Nachvollziehbare Änderungen an Ressourcen und Projekten.</p>
        </div>
        <label className="audit-search">
          <span className="sr-only">Audit-Log filtern</span>
          <Icon name="search" size={16} />
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Aktion, Person oder Ressourcen-ID"
            type="search"
            value={query}
          />
        </label>
      </div>
      <section className="card list audit-list" aria-busy={loading}>
        {visibleEvents.map((event) => (
          <details className="audit" key={event.id}>
            <summary>
              <span className="audit-action">
                <Icon name="activity" size={17} />
                <b>{actionLabels[event.action] ?? event.action}</b>
              </span>
              <span>{event.actor_subject}</span>
              <span>
                {event.dataset_id ?? "System"}
                {event.version_number ? ` · v${event.version_number}` : ""}
              </span>
              <time>{formatDate(event.created_at)}</time>
            </summary>
            <pre>{JSON.stringify(event.details, null, 2)}</pre>
          </details>
        ))}
        {!loading && visibleEvents.length === 0 && (
          <div className="empty">
            <Icon name="activity" size={22} />
            <b>Keine Audit-Ereignisse gefunden</b>
            <span>{query ? "Passe den Filter an." : "Noch keine Ereignisse erfasst."}</span>
          </div>
        )}
      </section>
    </>
  );
}
