import { useEffect, useId, useRef, useState } from "react";
import { api } from "../api";
import type { DatasetSearchFacets, DatasetSearchFilters } from "../api";
import type { CurrentUser, Dataset, Distribution, Project } from "../types";
import {
  formatDate,
  formatSize,
  StatusBadge,
  VisibilityBadge,
} from "../ui";

export function DatasetList({
  items,
  loading,
  filters,
  facets,
  onOpen,
  onUpload,
  onFiltersChange,
}: {
  items: Dataset[];
  loading: boolean;
  filters: DatasetSearchFilters;
  facets: DatasetSearchFacets;
  onOpen: (id: string, version: number) => void;
  onUpload: () => void;
  onFiltersChange: (filters: DatasetSearchFilters) => void;
}) {
  return (
    <>
      <div className="title-row">
        <div>
          <div className="eyebrow">Repository</div>
          <h1>Datensätze</h1>
          <p>Durchsuche veröffentlichte Daten und Projektergebnisse.</p>
        </div>
      </div>

      <DatasetSearchFiltersPanel
        filters={filters}
        facets={facets}
        onChange={onFiltersChange}
      />

      <section className="card list dataset-list" aria-busy={loading}>
        <div className="list-head">
          <h2>Datensätze</h2>
          <span>{loading ? "Suche …" : `${items.length} Treffer`}</span>
        </div>
        <div className="dataset-columns" aria-hidden="true">
          <span>Typ</span>
          <span>Datensatz</span>
          <span className="dataset-project">Projekt</span>
          <span className="dataset-visibility">Sichtbarkeit</span>
          <span className="dataset-status">Status</span>
        </div>
        {items.map((item) => (
          <button
            className="dataset-row"
            key={`${item.id}-${item.version.number}`}
            type="button"
            onClick={() => onOpen(item.id, item.version.number)}
          >
            <span className="file" aria-hidden="true">
              {item.version.distributions[0]?.filename.split(".").pop()?.slice(0, 4).toUpperCase() ?? "—"}
            </span>
            <span className="dataset-title">
              <b>{item.version.title}</b>
              <small>
                {item.version.creator} · v{item.version.version_label} · {item.version.distribution_count} Dateien · {formatSize(item.version.total_size)}
              </small>
            </span>
            <span className="meta dataset-project">
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
            <span className="dataset-visibility">
              <VisibilityBadge visibility={item.project?.visibility} />
            </span>
            <span className="dataset-status">
              <StatusBadge status={item.version.status} />
            </span>
          </button>
        ))}
        {!loading && items.length === 0 && (
          <div className="empty">Keine Datensätze gefunden.</div>
        )}
      </section>
    </>
  );
}

function DatasetSearchFiltersPanel({
  filters,
  facets,
  onChange,
}: {
  filters: DatasetSearchFilters;
  facets: DatasetSearchFacets;
  onChange: (filters: DatasetSearchFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const projectIds = filters.projectIds ?? [];
  const tags = filters.tags ?? [];
  const suffixes = filters.suffixes ?? [];
  const hasFilters = Boolean(filters.title || projectIds.length || tags.length || suffixes.length);
  const projects = [
    { value: "private", label: "Privat" },
    ...facets.projects.map((project) => ({ value: project.id, label: project.name })),
  ];

  return (
    <section className="card search-filters" aria-label="Erweiterte Suche">
      <div className="search-filters-head">
        <div>
          <h2>Erweiterte Suche</h2>
          <p>Grenze Ergebnisse nach Metadaten und Dateien ein.</p>
        </div>
        <button type="button" className="secondary" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Filter ausblenden" : "Filter anzeigen"}
        </button>
      </div>
      {open && (
        <div className="search-filter-fields">
          <label className="search-title-field">
            Titel
            <input
              type="search"
              value={filters.title ?? ""}
              placeholder="Titel enthält …"
              onChange={(event) => onChange({ ...filters, title: event.target.value || undefined })}
            />
          </label>
          <MultiSelectDropdown
            label="Projekt"
            options={projects}
            values={projectIds}
            onChange={(values) => onChange({ ...filters, projectIds: values.length ? values : undefined })}
          />
          <MultiSelectDropdown
            label="Schlagwörter"
            values={tags}
            options={facets.keywords.map((value) => ({ value, label: value }))}
            onChange={(values) => onChange({ ...filters, tags: values.length ? values : undefined })}
          />
          <MultiSelectDropdown
            label="Dateiendungen"
            values={suffixes}
            options={facets.suffixes.map((value) => ({ value, label: `.${value}` }))}
            onChange={(values) => onChange({ ...filters, suffixes: values.length ? values : undefined })}
          />
        </div>
      )}
      {hasFilters && (
        <div className="active-filters" aria-label="Aktive Filter">
          {filters.title && <FilterChip label={`Titel: ${filters.title}`} onRemove={() => onChange({ ...filters, title: undefined })} />}
          {projectIds.map((projectId) => <FilterChip key={projectId} label={`Projekt: ${projects.find((project) => project.value === projectId)?.label ?? projectId}`} onRemove={() => onChange({ ...filters, projectIds: projectIds.filter((item) => item !== projectId) })} />)}
          {tags.map((tag) => <FilterChip key={tag} label={`Tag: ${tag}`} onRemove={() => onChange({ ...filters, tags: tags.filter((item) => item !== tag) })} />)}
          {suffixes.map((suffix) => <FilterChip key={suffix} label={`.${suffix}`} onRemove={() => onChange({ ...filters, suffixes: suffixes.filter((item) => item !== suffix) })} />)}
          <button type="button" className="link-button" onClick={() => onChange({})}>Filter zurücksetzen</button>
        </div>
      )}
    </section>
  );
}

function MultiSelectDropdown({ label, options, values, onChange }: { label: string; options: { value: string; label: string }[]; values: string[]; onChange: (values: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const visibleOptions = options.filter((option) => option.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()));

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const toggleValue = (value: string) => onChange(
    values.includes(value) ? values.filter((item) => item !== value) : [...values, value],
  );
  const summary = values.length === 0 ? "Alle auswählen" : `${values.length} ausgewählt`;

  return <div className="search-select" ref={container}>
    <span className="search-select-label">{label}</span>
    <button type="button" className="search-select-trigger" aria-label={`${label}: ${summary}`} aria-expanded={open} aria-controls={menuId} aria-haspopup="listbox" onClick={() => setOpen(!open)}>
      <span>{summary}</span><span aria-hidden="true">⌄</span>
    </button>
    {open && <div className="search-select-menu" id={menuId} role="listbox" aria-label={`${label} auswählen`} aria-multiselectable="true">
      <input autoFocus type="search" value={search} placeholder={`${label} suchen …`} aria-label={`${label} durchsuchen`} onChange={(event) => setSearch(event.target.value)} />
      <div className="search-select-options">
        {visibleOptions.map((option) => <label key={option.value} className="search-select-option">
          <input type="checkbox" checked={values.includes(option.value)} onChange={() => toggleValue(option.value)} />
          <span>{option.label}</span>
        </label>)}
        {visibleOptions.length === 0 && <p className="search-select-empty">Keine Werte gefunden.</p>}
      </div>
    </div>}
  </div>;
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return <span className="filter-chip">{label}<button type="button" aria-label={`${label} entfernen`} onClick={onRemove}>×</button></span>;
}

export function DatasetForm({
  projects,
  base,
  onDone,
  onError,
}: {
  projects: Project[];
  base?: Dataset;
  onDone: (dataset: Dataset) => Promise<void> | void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const fileHintId = useId();
  const isNewVersion = Boolean(base);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const selected = files;
    const form = new FormData(event.currentTarget);
    if (!selected.length) {
      onError("Bitte wähle mindestens eine Datei.");
      return;
    }
    if (selected.length > 100 || selected.some((file) => file.size > 100 * 1024 * 1024)) {
      onError("Ein Datensatz darf höchstens 100 Dateien mit jeweils 100 MiB enthalten.");
      return;
    }
    if (selected.reduce((total, file) => total + file.size, 0) > 1024 * 1024 * 1024) {
      onError("Die Dateien einer Version dürfen zusammen höchstens 1 GiB groß sein.");
      return;
    }
    form.delete("files");
    selected.forEach((file) => form.append("files", file, file.name));
    setBusy(true);
    try {
      const dataset = base
        ? await api.createVersion(base.id, form)
        : await api.createDataset(form);
      await onDone(dataset);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Upload fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  const knownTypes = ["Bericht", "Spezifikation", "Datensatz", "Modell"];
  const typeOptions =
    base && !knownTypes.includes(base.version.dataset_type)
      ? [base.version.dataset_type, ...knownTypes]
      : knownTypes;

  return (
    <>
      <div className="eyebrow">
        {isNewVersion ? "Neue Version" : "Neuer Datensatz"}
      </div>
      <h1>
        {isNewVersion
          ? `${base?.version.title} überarbeiten`
          : "Dateien und Metadaten anlegen"}
      </h1>
      <p>
        {isNewVersion
          ? "Die vorherige Version bleibt unverändert erreichbar."
          : "Lege einen Entwurf an. Die Projektregel bestimmt Freigabe und Sichtbarkeit."}
      </p>

      <form className="form-grid" onSubmit={submit}>
        <section className="card form">
          <h2>1. Dateien hochladen</h2>
          <label className="drop">
            <input
              type="file"
              name="files"
              multiple
              aria-describedby={fileHintId}
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
            <b>Dateien auswählen</b>
            <span id={fileHintId}>Bis zu 100 Dateien, je 100 MiB und zusammen 1 GiB</span>
            {files.length > 0 && <span className="selected-file">{files.length} Dateien ausgewählt · {formatSize(files.reduce((total, file) => total + file.size, 0))}</span>}
          </label>
          {files.length > 0 && <ul className="file-list">{files.map((file, index) => <li key={`${file.name}-${index}`}><span>{file.name} · {formatSize(file.size)}</span><button type="button" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Entfernen</button></li>)}</ul>}

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
              Datensatztyp *
              <select
                name="dataset_type"
                required
                defaultValue={base?.version.dataset_type ?? knownTypes[0]}
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
            Private Datensätze und Projekte ohne Freigabepflicht kannst du selbst
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

export function DatasetDetail({
  item,
  user,
  onBack,
  onOpenVersion,
  onNewVersion,
  onReload,
  onError,
}: {
  item: Dataset;
  user: CurrentUser;
  onBack: () => void;
  onOpenVersion: (number: number) => void;
  onNewVersion: () => void;
  onReload: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const version = item.version;
  const [versions, setVersions] = useState<Dataset[]>([]);
  const [preview, setPreview] = useState<Preview>(null);
  const [busy, setBusy] = useState(false);
  const [showRejection, setShowRejection] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .datasetVersions(item.id)
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

  const openContent = async (distribution: Distribution) => {
    setBusy(true);
    try {
      const result = await api.content(item.id, version.number, distribution.id);
      if (result.type === "text/plain") {
        setPreview({ kind: "text", content: await result.blob.text() });
      } else if (result.type === "application/pdf") {
        setPreview({ kind: "pdf", url: URL.createObjectURL(result.blob) });
      } else {
        const url = URL.createObjectURL(result.blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = distribution.filename;
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
  const stablePath = `/datasets/${item.id}/versions/${version.number}`;
  const stableUrl = `${window.location.origin}${stablePath}`;

  return (
    <>
      <button className="back" type="button" onClick={onBack}>
        ← Zurück zu Datensätzen
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
          <dt>Datensatztyp</dt>
            <dd>{version.dataset_type}</dd>
            <dt>Schlagwörter</dt>
            <dd>{version.keywords.join(", ") || "—"}</dd>
            <dt>Ersteller:in</dt>
            <dd>{version.creator}</dd>
            <dt>Projekt</dt>
            <dd>{item.project?.name ?? "Privat"}</dd>
          <dt>Dateien</dt>
          <dd>{version.distribution_count} · {formatSize(version.total_size)}</dd>
          </dl>

          <div className="actions">
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

          <div className="distribution-list">
            {version.distributions.map((distribution) => (
              <div className="distribution" key={distribution.id}>
                <span>{distribution.filename} · {formatSize(distribution.content_size)}</span>
                <button className="secondary compact" type="button" disabled={busy} onClick={() => openContent(distribution)}>Vorschau / Download</button>
              </div>
            ))}
          </div>

          {preview?.kind === "text" && (
            <pre className="text-preview">{preview.content}</pre>
          )}
          {preview?.kind === "pdf" && (
            <iframe
              className="preview"
              src={preview.url}
              title="Dateivorschau"
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
