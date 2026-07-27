import { useEffect, useId, useState } from "react";
import { api } from "../api";
import type { CurrentUser, Project, Resource } from "../types";
import {
  formatDate,
  formatSize,
  StatusBadge,
  VisibilityBadge,
} from "../ui";

export function ResourceList({
  items,
  loading,
  onOpen,
  onUpload,
}: {
  items: Resource[];
  loading: boolean;
  onOpen: (id: string, version: number) => void;
  onUpload: () => void;
}) {
  return (
    <>
      <div className="title-row">
        <div>
          <div className="eyebrow">Repository</div>
          <h1>Ressourcen</h1>
          <p>Durchsuche veröffentlichte Dokumente, Daten und Projektergebnisse.</p>
        </div>
        <button className="primary" type="button" onClick={onUpload}>
          <span aria-hidden="true">＋</span> Ressource anlegen
        </button>
      </div>

      <div className="stats" aria-label="Ressourcenübersicht">
        <div>
          <strong>{items.length}</strong>
          <span>sichtbare Ressourcen</span>
        </div>
        <div>
          <strong>{items.filter((item) => item.version.status === "draft").length}</strong>
          <span>Entwürfe</span>
        </div>
        <div>
          <strong>
            {items.filter((item) => item.version.status === "published").length}
          </strong>
          <span>veröffentlicht</span>
        </div>
      </div>

      <section className="card list resource-list" aria-busy={loading}>
        <div className="list-head">
          <h2>Ressourcen</h2>
          <span>{loading ? "Suche …" : `${items.length} Treffer`}</span>
        </div>
        <div className="resource-columns" aria-hidden="true">
          <span>Typ</span>
          <span>Ressource</span>
          <span className="resource-project">Projekt</span>
          <span className="resource-visibility">Sichtbarkeit</span>
          <span className="resource-status">Status</span>
        </div>
        {items.map((item) => (
          <button
            className="resource"
            key={`${item.id}-${item.version.number}`}
            type="button"
            onClick={() => onOpen(item.id, item.version.number)}
          >
            <span className="file" aria-hidden="true">
              {item.version.filename.split(".").pop()?.slice(0, 4).toUpperCase()}
            </span>
            <span className="resource-title">
              <b>{item.version.title}</b>
              <small>
                {item.version.creator} · v{item.version.version_label} ·{" "}
                {formatSize(item.version.content_size)}
              </small>
            </span>
            <span className="meta resource-project">
              <span
                className="project-name"
                title={item.project?.name ?? "Privat"}
              >
                {item.project?.name ?? "Privat"}
              </span>
              <small>
                {formatDate(item.version.published_at ?? item.version.created_at)}
              </small>
            </span>
            <span className="resource-visibility">
              <VisibilityBadge visibility={item.project?.visibility} />
            </span>
            <span className="resource-status">
              <StatusBadge status={item.version.status} />
            </span>
          </button>
        ))}
        {!loading && items.length === 0 && (
          <div className="empty">Keine Ressourcen gefunden.</div>
        )}
      </section>
    </>
  );
}

export function ResourceForm({
  projects,
  base,
  onDone,
  onError,
}: {
  projects: Project[];
  base?: Resource;
  onDone: (resource: Resource) => Promise<void> | void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [filename, setFilename] = useState("");
  const fileHintId = useId();
  const isNewVersion = Boolean(base);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fileInput = event.currentTarget.elements.namedItem("file");
    const file =
      fileInput instanceof HTMLInputElement ? fileInput.files?.[0] : undefined;
    const form = new FormData(event.currentTarget);
    if (!file?.size) {
      onError("Bitte wähle eine Datei.");
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      onError("SoftBeat Atlas unterstützt Dateien bis 100 MiB.");
      return;
    }
    form.set("file", file, file.name);
    setBusy(true);
    try {
      const resource = base
        ? await api.createVersion(base.id, form)
        : await api.createResource(form);
      await onDone(resource);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Upload fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  const knownTypes = ["Bericht", "Spezifikation", "Datensatz", "Modell"];
  const typeOptions =
    base && !knownTypes.includes(base.version.resource_type)
      ? [base.version.resource_type, ...knownTypes]
      : knownTypes;

  return (
    <>
      <div className="eyebrow">
        {isNewVersion ? "Neue Version" : "Neue Ressource"}
      </div>
      <h1>
        {isNewVersion
          ? `${base?.version.title} überarbeiten`
          : "Datei und Metadaten anlegen"}
      </h1>
      <p>
        {isNewVersion
          ? "Die vorherige Version bleibt unverändert erreichbar."
          : "Lege einen Entwurf an. Die Projektregel bestimmt Freigabe und Sichtbarkeit."}
      </p>

      <form className="form-grid" onSubmit={submit}>
        <section className="card form">
          <h2>1. Datei hochladen</h2>
          <label className="drop">
            <input
              type="file"
              name="file"
              required
              aria-describedby={fileHintId}
              onChange={(event) => setFilename(event.target.files?.[0]?.name ?? "")}
            />
            <b>Datei auswählen</b>
            <span id={fileHintId}>Alle Formate bis 100 MiB</span>
            {filename && <span className="selected-file">Ausgewählt: {filename}</span>}
          </label>

          <h2>2. Basisinformationen</h2>
          <label>
            Titel *
            <input name="title" required maxLength={300} defaultValue={base?.version.title} />
          </label>
          <label>
            Beschreibung *
            <textarea
              name="description"
              required
              maxLength={20_000}
              defaultValue={base?.version.description}
            />
          </label>
          <div className="two">
            <label>
              Ressourcentyp *
              <select
                name="resource_type"
                required
                defaultValue={base?.version.resource_type ?? knownTypes[0]}
              >
                {typeOptions.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            <label>
              Fachliches Versionslabel *
              <input
                name="version_label"
                required
                maxLength={100}
                defaultValue={base ? "" : "1.0"}
                placeholder={base ? "z. B. 1.1" : undefined}
              />
            </label>
          </div>
          <label>
            Schlagwörter
            <input
              name="keywords"
              maxLength={2000}
              defaultValue={base?.version.keywords.join(", ")}
              placeholder="Validierung, Sensorik, Qualität"
            />
          </label>
          {!base && (
            <label>
              Projekt
              <select name="project_id" defaultValue="">
                <option value="">Privat – nur für mich sichtbar</option>
                {projects.map((project) => (
                  <option value={project.id} key={project.id}>
                    {project.name} ·{" "}
                    {project.approval_required ? "Freigabe" : "direkt"}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="form-actions">
            <button className="primary" disabled={busy}>
              {busy
                ? "Upload läuft …"
                : isNewVersion
                  ? "Neue Version als Entwurf anlegen"
                  : "Entwurf anlegen"}
            </button>
          </div>
        </section>

        <aside className="card workflow">
          <h2>Weiterer Ablauf</h2>
          <p>
            Private Ressourcen und Projekte ohne Freigabepflicht kannst du selbst
            veröffentlichen.
          </p>
          <p>
            Bei freigabepflichtigen Projekten werden die zuständigen Approver nach
            der Einreichung benachrichtigt.
          </p>
        </aside>
      </form>
    </>
  );
}

type Preview =
  | { kind: "pdf"; url: string }
  | { kind: "text"; content: string }
  | null;

export function ResourceDetail({
  item,
  user,
  onBack,
  onOpenVersion,
  onNewVersion,
  onReload,
  onError,
}: {
  item: Resource;
  user: CurrentUser;
  onBack: () => void;
  onOpenVersion: (number: number) => void;
  onNewVersion: () => void;
  onReload: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const version = item.version;
  const [versions, setVersions] = useState<Resource[]>([]);
  const [preview, setPreview] = useState<Preview>(null);
  const [busy, setBusy] = useState(false);
  const [showRejection, setShowRejection] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .resourceVersions(item.id)
      .then((result) => active && setVersions(result))
      .catch((error) => onError(error.message));
    return () => {
      active = false;
    };
  }, [item.id, item.version.number, onError]);

  useEffect(
    () => () => {
      if (preview?.kind === "pdf") URL.revokeObjectURL(preview.url);
    },
    [preview],
  );

  const runAction = async (
    action: "submit" | "publish" | "approve",
    comment = "",
  ) => {
    setBusy(true);
    try {
      if (action === "approve") {
        await api.approve(item.id, version.number, comment);
      } else {
        await api[action](item.id, version.number);
      }
      await onReload();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Aktion fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  const reject = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const comment = String(new FormData(event.currentTarget).get("comment") ?? "").trim();
    if (!comment) return;
    setBusy(true);
    try {
      await api.reject(item.id, version.number, comment);
      setShowRejection(false);
      await onReload();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Ablehnung fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  const openContent = async () => {
    setBusy(true);
    try {
      const result = await api.content(item.id, version.number);
      if (result.type === "text/plain") {
        setPreview({ kind: "text", content: await result.blob.text() });
      } else if (result.type === "application/pdf") {
        setPreview({ kind: "pdf", url: URL.createObjectURL(result.blob) });
      } else {
        const url = URL.createObjectURL(result.blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = version.filename;
        link.click();
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "Inhalt konnte nicht geladen werden");
    } finally {
      setBusy(false);
    }
  };

  const canManage = user.roles.includes("admin") || item.owner === user.subject;
  const canApprove =
    item.owner !== user.subject &&
    (user.roles.includes("admin") || user.roles.includes("approver"));
  const needsApproval = item.project?.approval_required ?? false;
  const canCreateVersion =
    canManage &&
    version.number === item.latest_number &&
    (version.status === "published" || version.status === "rejected");
  const stablePath = `/resources/${item.id}/versions/${version.number}`;
  const stableUrl = `${window.location.origin}${stablePath}`;

  return (
    <>
      <button className="back" type="button" onClick={onBack}>
        ← Zurück zu Ressourcen
      </button>
      <div className="title-row">
        <div>
          <div className="eyebrow">
            {item.id} · Version {version.number}
          </div>
          <h1>{version.title}</h1>
          <p>{version.description}</p>
        </div>
        <StatusBadge status={version.status} />
      </div>

      {item.newer_version && (
        <div className="flash" role="status">
          Es gibt eine neuere veröffentlichte Version: v{item.newer_version}.
          <button
            type="button"
            onClick={() => onOpenVersion(item.newer_version!)}
          >
            Öffnen
          </button>
        </div>
      )}

      <div className="detail-grid">
        <section className="card form">
          <h2>Metadaten</h2>
          <dl>
            <dt>Ressourcentyp</dt>
            <dd>{version.resource_type}</dd>
            <dt>Schlagwörter</dt>
            <dd>{version.keywords.join(", ") || "—"}</dd>
            <dt>Ersteller:in</dt>
            <dd>{version.creator}</dd>
            <dt>Projekt</dt>
            <dd>{item.project?.name ?? "Privat"}</dd>
            <dt>Datei</dt>
            <dd>
              {version.filename} · {formatSize(version.content_size)}
            </dd>
            <dt>SHA-256</dt>
            <dd className="hash">{version.sha256}</dd>
          </dl>

          <div className="actions">
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={openContent}
            >
              Vorschau / Download
            </button>
            {version.status === "draft" && canManage && (
              <button
                className="primary"
                type="button"
                disabled={busy}
                onClick={() => runAction(needsApproval ? "submit" : "publish")}
              >
                {needsApproval ? "Zur Freigabe einreichen" : "Veröffentlichen"}
              </button>
            )}
            {version.status === "pending" && canApprove && (
              <>
                <button
                  className="secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => setShowRejection(true)}
                >
                  Ablehnen
                </button>
                <button
                  className="primary"
                  type="button"
                  disabled={busy}
                  onClick={() => runAction("approve")}
                >
                  Freigeben &amp; veröffentlichen
                </button>
              </>
            )}
            {canCreateVersion && (
              <button className="primary" type="button" onClick={onNewVersion}>
                Überarbeitete Version anlegen
              </button>
            )}
          </div>

          {showRejection && (
            <form className="rejection-panel" onSubmit={reject}>
              <label>
                Ablehnungsbegründung *
                <textarea name="comment" required maxLength={4000} autoFocus />
              </label>
              <div className="actions">
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setShowRejection(false)}
                >
                  Abbrechen
                </button>
                <button className="primary danger" disabled={busy}>
                  Ablehnung bestätigen
                </button>
              </div>
            </form>
          )}

          {preview?.kind === "text" && (
            <pre className="text-preview">{preview.content}</pre>
          )}
          {preview?.kind === "pdf" && (
            <iframe
              className="preview"
              src={preview.url}
              title={`Vorschau von ${version.filename}`}
              sandbox=""
            />
          )}
        </section>

        <aside className="card workflow">
          <h2>Status</h2>
          <p>
            <StatusBadge status={version.status} />
          </p>
          <p>Erstellt: {formatDate(version.created_at)}</p>
          <p>Veröffentlicht: {formatDate(version.published_at)}</p>
          <h2>Stabile URL</h2>
          <a className="stable-link" href={stablePath}>
            {stablePath}
          </a>
          <button
            className="secondary compact"
            type="button"
            onClick={() =>
              navigator.clipboard
                .writeText(stableUrl)
                .catch(() => onError("URL konnte nicht kopiert werden"))
            }
          >
            URL kopieren
          </button>

          <h2>Versionen</h2>
          <div className="version-list">
            {versions.map((entry) => (
              <button
                type="button"
                className={entry.version.number === version.number ? "active" : ""}
                key={entry.version.number}
                onClick={() => onOpenVersion(entry.version.number)}
              >
                v{entry.version.version_label}
                <small>
                  <StatusBadge status={entry.version.status} />
                </small>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </>
  );
}
