import { useEffect, useState } from "react";
import { api } from "../api";
import type { AuditEvent, Dataset, Notification } from "../types";
import { formatDate, StatusBadge } from "../ui";

export function Approvals({
  items,
  onOpen,
}: {
  items: Dataset[];
  onOpen: (id: string, version: number) => void;
}) {
  return (
    <>
      <div className="eyebrow">Freigaben</div>
      <h1>Offene Prüfungen</h1>
      <p>Freigaben veröffentlichen den geprüften Stand automatisch.</p>
      <section className="card list">
        {items.map((item) => (
          <button
            className="dataset-row approval-row"
            key={`${item.id}-${item.version.number}`}
            type="button"
            onClick={() => onOpen(item.id, item.version.number)}
          >
            <span className="file" aria-hidden="true">
              {item.version.distributions[0]?.filename.split(".").pop()?.toUpperCase() ?? "—"}
            </span>
            <span className="dataset-title">
              <b>{item.version.title}</b>
              <small>
                {item.project?.name} · eingereicht von {item.version.creator}
              </small>
            </span>
            <StatusBadge status="pending" />
          </button>
        ))}
        {items.length === 0 && (
          <div className="empty">Keine offenen Freigaben.</div>
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
  const open = async (notification: Notification) => {
    try {
      if (!notification.read) {
        await api.markNotificationRead(notification.id);
        await onChanged();
      }
      onOpen(notification.dataset_id, notification.version_number);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Benachrichtigung fehlgeschlagen");
    }
  };

  return (
    <>
      <div className="eyebrow">Benachrichtigungen</div>
      <h1>Aktuelles</h1>
      <p>Freigaben und Entscheidungen zu deinen Datensätzen.</p>
      <section className="card list">
        {items.map((notification) => (
          <button
            className={`notification-row ${notification.read ? "" : "unread"}`}
            key={notification.id}
            type="button"
            onClick={() => open(notification)}
          >
            <span className="notification-dot" aria-hidden="true" />
            <span>
              <b>{notification.message}</b>
              <small>{formatDate(notification.created_at)}</small>
            </span>
          </button>
        ))}
        {items.length === 0 && (
          <div className="empty">Keine Benachrichtigungen.</div>
        )}
      </section>
    </>
  );
}

export function AuditLog({
  onError,
}: {
  onError: (message: string) => void;
}) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <>
      <div className="eyebrow">Audit</div>
      <h1>Audit-Log</h1>
      <section className="card list" aria-busy={loading}>
        {events.map((event) => (
          <div className="audit" key={event.id}>
            <b>{event.action}</b>
            <span>
              {event.actor_subject} · {formatDate(event.created_at)} ·{" "}
              {event.dataset_id ?? "System"}
            </span>
          </div>
        ))}
        {!loading && events.length === 0 && (
          <div className="empty">Keine Audit-Ereignisse.</div>
        )}
      </section>
    </>
  );
}
