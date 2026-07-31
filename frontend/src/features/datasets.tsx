import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { DatasetSearchFacets, DatasetSearchFilters } from "../api";
import { Icon } from "../icons";
import type { CurrentUser, Dataset, Distribution, Project } from "../types";
import {
  ConfirmDialog,
  formatDate,
  formatSize,
  StatusBadge,
  VisibilityBadge,
} from "../ui";

export type DatasetSort =
  | "updated-desc"
  | "title-asc"
  | "project-asc"
  | "status-asc";

export function DatasetList({
  items,
  loading,
  filters,
  facets,
  sort,
  onOpen,
  onUpload,
  onFiltersChange,
  onSortChange,
}: {
  items: Dataset[];
  loading: boolean;
  filters: DatasetSearchFilters;
  facets: DatasetSearchFacets;
  sort: DatasetSort;
  onOpen: (id: string, version: number) => void;
  onUpload: () => void;
  onFiltersChange: (filters: DatasetSearchFilters) => void;
  onSortChange: (sort: DatasetSort) => void;
}) {
  const sortedItems = useMemo(() => {
    const copy = [...items];
    if (sort === "title-asc") {
      return copy.sort((left, right) =>
        left.version.title.localeCompare(right.version.title, "de"),
      );
    }
    if (sort === "project-asc") {
      return copy.sort((left, right) =>
        (left.project?.name ?? "Privat").localeCompare(
          right.project?.name ?? "Privat",
          "de",
        ),
      );
    }
    if (sort === "status-asc") {
      return copy.sort((left, right) =>
        left.version.status.localeCompare(right.version.status),
      );
    }
    return copy.sort(
      (left, right) =>
        new Date(right.version.modified_at).getTime() -
        new Date(left.version.modified_at).getTime(),
    );
  }, [items, sort]);

  return (
    <>
      <div className="title-row">
        <div>
          <h1>Ressourcen</h1>
          <p>Dokumente und Daten zuverlässig finden, prüfen und wiederverwenden.</p>
        </div>
        <button className="primary title-action" onClick={onUpload} type="button">
          <Icon name="plus" size={18} />
          Ressource anlegen
        </button>
      </div>

      <DatasetSearchFiltersPanel
        filters={filters}
        facets={facets}
        onChange={onFiltersChange}
      />

      <section
        aria-busy={loading}
        aria-label="Ressourcen"
        className="card list dataset-list"
        role="table"
      >
        <div className="list-head">
          <strong aria-live="polite">
            {loading ? "Ressourcen werden aktualisiert …" : `${items.length} Ergebnisse`}
          </strong>
          <label className="sort-control">
            <span>Sortieren</span>
            <select
              aria-label="Ressourcen sortieren"
              onChange={(event) => onSortChange(event.target.value as DatasetSort)}
              value={sort}
            >
              <option value="updated-desc">Zuletzt aktualisiert</option>
              <option value="title-asc">Titel A–Z</option>
              <option value="project-asc">Projekt A–Z</option>
              <option value="status-asc">Status</option>
            </select>
          </label>
        </div>
        <div className="dataset-columns" role="row">
          <span role="columnheader">Typ</span>
          <span role="columnheader">Ressource</span>
          <span className="dataset-project" role="columnheader">Projekt</span>
          <span className="dataset-visibility" role="columnheader">Zugriff</span>
          <span className="dataset-status" role="columnheader">Status</span>
          <span className="dataset-updated" role="columnheader">Aktualisiert</span>
        </div>
        {sortedItems.map((item) => (
          <a
            className="dataset-row"
            href={`/datasets/${encodeURIComponent(item.id)}/versions/${item.version.number}`}
            key={`${item.id}-${item.version.number}`}
            onClick={(event) => {
              if (
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              ) return;
              event.preventDefault();
              onOpen(item.id, item.version.number);
            }}
            role="row"
          >
            <span className="file" role="cell">
              <Icon aria-hidden="true" name="file" size={18} />
              <small aria-hidden="true">
                {item.version.distributions[0]?.filename
                  .split(".")
                  .pop()
                  ?.slice(0, 4)
                  .toUpperCase() ?? "—"}
              </small>
            </span>
            <span className="dataset-title" role="cell">
              <b>{item.version.title}</b>
              <small>
                {item.version.dataset_type} · v{item.version.version_label} ·{" "}
                {item.version.distribution_count} Dateien ·{" "}
                {formatSize(item.version.total_size)}
              </small>
            </span>
            <span className="meta dataset-project" role="cell">
              <span
                className="project-name"
                title={item.project?.name ?? "Privat"}
              >
                {item.project?.name ?? "Privat"}
              </span>
              <small>{item.version.creator}</small>
            </span>
            <span className="dataset-visibility" role="cell">
              <VisibilityBadge visibility={item.project?.visibility} />
            </span>
            <span className="dataset-status" role="cell">
              <StatusBadge status={item.version.status} />
            </span>
            <span className="dataset-updated meta" role="cell">
              {formatDate(item.version.modified_at)}
            </span>
          </a>
        ))}
        {!loading && items.length === 0 && (
          <div className="empty">
            <Icon name="search" size={22} />
            <b>Keine Ressourcen gefunden</b>
            <span>Passe die Suche oder die aktiven Filter an.</span>
          </div>
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
  const [open, setOpen] = useState(true);
  const projectIds = filters.projectIds ?? [];
  const tags = filters.tags ?? [];
  const suffixes = filters.suffixes ?? [];
  const hasFilters = Boolean(projectIds.length || tags.length || suffixes.length);
  const projects = [
    { value: "private", label: "Privat" },
    ...facets.projects.map((project) => ({ value: project.id, label: project.name })),
  ];

  return (
    <section className="card search-filters" aria-label="Ressourcen filtern">
      <div className="search-filters-head">
        <div>
          <h2>Filter</h2>
          <p>Ergebnisse nach Metadaten und Dateiformat eingrenzen.</p>
        </div>
        <button
          aria-expanded={open}
          className="secondary filter-toggle"
          onClick={() => setOpen(!open)}
          type="button"
        >
          <Icon name="filter" size={16} />
          {open ? "Ausblenden" : "Filter anzeigen"}
        </button>
      </div>
      {open && (
        <div className="search-filter-fields">
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
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const visibleOptions = options.filter((option) => option.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()));

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
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
  const summary = values.length === 0 ? "Alle" : `${values.length} ausgewählt`;

  return <div className="search-select" ref={container}>
    <span className="search-select-label">{label}</span>
    <button type="button" className="search-select-trigger" aria-label={`${label}: ${summary}`} aria-expanded={open} aria-controls={menuId} aria-haspopup="dialog" onClick={() => setOpen(!open)} ref={trigger}>
      <span>{summary}</span><Icon name="chevron-down" size={15} />
    </button>
    {open && <div className="search-select-menu" id={menuId} role="dialog" aria-label={`${label} auswählen`}>
      <input autoFocus type="search" value={search} placeholder={`${label} suchen …`} aria-label={`${label} durchsuchen`} onChange={(event) => setSearch(event.target.value)} />
      <div className="search-select-options" role="group" aria-label={label}>
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
  return <span className="filter-chip">{label}<button type="button" aria-label={`${label} entfernen`} onClick={onRemove}><Icon name="close" size={12} /></button></span>;
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
  const [fileError, setFileError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [projectId, setProjectId] = useState(base?.project?.id ?? "");
  const fileHintId = useId();
  const fileErrorId = useId();
  const isNewVersion = Boolean(base);
  const selectedProject =
    base?.project ?? projects.find((project) => project.id === projectId) ?? null;

  const acceptFiles = (nextFiles: File[]) => {
    setFiles(nextFiles);
    setFileError("");
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const selected = files;
    const form = new FormData(event.currentTarget);
    if (!selected.length) {
      setFileError("Bitte wähle mindestens eine Datei aus.");
      return;
    }
    if (selected.length > 100 || selected.some((file) => file.size > 100 * 1024 * 1024)) {
      setFileError("Maximal 100 Dateien mit jeweils höchstens 100 MiB sind erlaubt.");
      return;
    }
    if (selected.reduce((total, file) => total + file.size, 0) > 1024 * 1024 * 1024) {
      setFileError("Die Dateien einer Version dürfen zusammen höchstens 1 GiB groß sein.");
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
      <h1>
        {isNewVersion
          ? `${base?.version.title} überarbeiten`
          : "Ressource anlegen"}
      </h1>
      <p>
        {isNewVersion
          ? "Die vorherige Version bleibt unverändert erreichbar."
          : "Dateien und beschreibende Metadaten als kontrollierten Entwurf erfassen."}
      </p>

      <form className="form-grid" onSubmit={submit}>
        <section className="card form">
          <h2>1. Dateien</h2>
          <label
            className={`drop ${dragActive ? "drag-active" : ""} ${fileError ? "invalid" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              acceptFiles(Array.from(event.dataTransfer.files));
            }}
          >
            <Icon name="upload" size={24} />
            <b>Dateien auswählen oder hier ablegen</b>
            <span id={fileHintId}>
              Bis zu 100 Dateien, je 100 MiB und zusammen 1 GiB
            </span>
            <input
              aria-describedby={`${fileHintId}${fileError ? ` ${fileErrorId}` : ""}`}
              aria-invalid={Boolean(fileError)}
              multiple
              name="files"
              onChange={(event) => acceptFiles(Array.from(event.target.files ?? []))}
              type="file"
            />
          </label>
          {fileError && (
            <p className="field-error" id={fileErrorId} role="alert">
              {fileError}
            </p>
          )}
          {files.length > 0 && (
            <div className="file-selection">
              <div className="file-selection-summary">
                <strong>{files.length} Dateien ausgewählt</strong>
                <span>
                  {formatSize(files.reduce((total, file) => total + file.size, 0))}
                </span>
              </div>
              <ul className="file-list">
                {files.map((file, index) => (
                  <li key={`${file.name}-${index}`}>
                    <Icon name="file" size={18} />
                    <span>
                      <b>{file.name}</b>
                      <small>{file.type || "Unbekannter Dateityp"} · {formatSize(file.size)}</small>
                    </span>
                    <button
                      onClick={() =>
                        setFiles((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                      title={`${file.name} entfernen`}
                      type="button"
                    >
                      Entfernen
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

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
              <select
                name="project_id"
                onChange={(event) => setProjectId(event.target.value)}
                value={projectId}
              >
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

        <aside className="card workflow workflow-summary">
          <h2>Speicher- und Freigabestatus</h2>
          <dl>
            <dt>Projekt</dt>
            <dd>{selectedProject?.name ?? "Privat"}</dd>
            <dt>Sichtbarkeit</dt>
            <dd>
              <VisibilityBadge visibility={selectedProject?.visibility} />
            </dd>
            <dt>Freigabe</dt>
            <dd>
              {selectedProject?.approval_required
                ? "Vier-Augen-Prüfung erforderlich"
                : "Direkte Veröffentlichung möglich"}
            </dd>
          </dl>
          <div className="workflow-note">
            <Icon name={selectedProject?.approval_required ? "approval" : "check"} size={18} />
            <p>
              {selectedProject?.approval_required
                ? "Nach dem Einreichen prüfen berechtigte Approver genau diesen Dateistand."
                : "Die Ressource wird zuerst als Entwurf gespeichert und kann anschließend veröffentlicht werden."}
            </p>
          </div>
        </aside>
      </form>
    </>
  );
}

type Preview =
  | { kind: "pdf"; url: string; filename: string }
  | { kind: "text"; content: string; filename: string }
  | null;

type WorkflowAction = "submit" | "publish" | "approve";

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
  const [integrationMessage, setIntegrationMessage] = useState("");
  const [confirmAction, setConfirmAction] = useState<WorkflowAction | null>(
    null,
  );

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
    action: WorkflowAction,
    comment = "",
  ) => {
    setBusy(true);
    try {
      if (action === "approve") {
        await api.approve(item.id, version.number, comment);
      } else {
        await api[action](item.id, version.number);
      }
      setConfirmAction(null);
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
      if (
        result.type.startsWith("text/") ||
        result.type.includes("json") ||
        result.type.includes("xml")
      ) {
        setPreview({
          kind: "text",
          content: await result.blob.text(),
          filename: distribution.filename,
        });
      } else if (result.type.startsWith("application/pdf")) {
        setPreview({
          kind: "pdf",
          url: URL.createObjectURL(result.blob),
          filename: distribution.filename,
        });
      } else {
        onError(
          `Für ${distribution.filename} ist keine sichere Vorschau verfügbar. Nutze den Download.`,
        );
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "Inhalt konnte nicht geladen werden");
    } finally {
      setBusy(false);
    }
  };

  const downloadContent = async (distribution: Distribution) => {
    setBusy(true);
    try {
      const result = await api.content(
        item.id,
        version.number,
        distribution.id,
        false,
      );
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = distribution.filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : "Datei konnte nicht heruntergeladen werden",
      );
    } finally {
      setBusy(false);
    }
  };

  const copyIntegrationValue = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setIntegrationMessage(`${label} kopiert.`);
    } catch {
      onError(`${label} konnte nicht kopiert werden`);
    }
  };

  const downloadDcat = async () => {
    setBusy(true);
    try {
      const blob = await api.dcat(item.id, version.number);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `dcat-${item.id}-v${version.number}.jsonld`;
      link.click();
      URL.revokeObjectURL(url);
      setIntegrationMessage("DCAT JSON-LD heruntergeladen.");
    } catch (error) {
      onError(error instanceof Error ? error.message : "DCAT-Metadaten konnten nicht geladen werden");
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
  const conceptPath = `/datasets/${encodeURIComponent(item.id)}`;
  const versionPath =
    `${conceptPath}/versions/${version.number}`;
  const conceptUrl = `${window.location.origin}${conceptPath}`;
  const versionUrl = `${window.location.origin}${versionPath}`;
  const datasetApiUrl = api.datasetVersionUrl(item.id, version.number);
  const datasetCurlCommand = `curl --fail --location \\
  -H "Authorization: Bearer $ATLAS_ACCESS_TOKEN" \\
  "${datasetApiUrl}"`;
  const actionCopy: Record<
    WorkflowAction,
    { title: string; description: string; label: string }
  > = {
    submit: {
      title: "Version zur Freigabe einreichen?",
      description:
        "Die Dateien und Metadaten werden für diese Version eingefroren, bis die Prüfung abgeschlossen ist.",
      label: "Verbindlich einreichen",
    },
    publish: {
      title: "Version veröffentlichen?",
      description:
        "Diese Version wird für berechtigte Nutzer sichtbar und über ihre stabile URL referenzierbar.",
      label: "Jetzt veröffentlichen",
    },
    approve: {
      title: "Version freigeben und veröffentlichen?",
      description:
        "Du bestätigst, dass du genau diesen Dateistand und seine Metadaten geprüft hast.",
      label: "Freigeben & veröffentlichen",
    },
  };

  return (
    <>
      <button className="back" type="button" onClick={onBack}>
        ← Zurück zu Ressourcen
      </button>
      <div className="title-row">
        <div>
          <h1>{version.title}</h1>
          <p>
            {version.dataset_type} · Version {version.version_label} ·{" "}
            {item.project?.name ?? "Privat"}
          </p>
        </div>
        <div className="title-status">
          <VisibilityBadge visibility={item.project?.visibility} />
          <StatusBadge status={version.status} />
        </div>
      </div>

      {item.newer_version && (
        <div className="flash info" role="status">
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
        <div className="detail-main">
          <section className="card resource-summary">
            <div className="section-heading">
              <div>
                <h2>Beschreibung</h2>
                <p>{version.description}</p>
              </div>
            </div>
            <dl className="metadata-grid">
              <div>
                <dt>Ressourcen-ID</dt>
                <dd><code>{item.id}</code></dd>
              </div>
              <div>
                <dt>Fachliche Version</dt>
                <dd>{version.version_label} (Revision {version.number})</dd>
              </div>
              <div>
                <dt>Ersteller:in</dt>
                <dd>{version.creator}</dd>
              </div>
              <div>
                <dt>Dateien</dt>
                <dd>
                  {version.distribution_count} · {formatSize(version.total_size)}
                </dd>
              </div>
            </dl>
            <div className="keyword-row" aria-label="Schlagwörter">
              {version.keywords.length > 0
                ? version.keywords.map((keyword) => (
                    <span className="keyword" key={keyword}>{keyword}</span>
                  ))
                : <span className="muted">Keine Schlagwörter erfasst</span>}
            </div>
          </section>

          <div className="actions">
            {version.status === "draft" && canManage && (
              <button
                className="primary"
                type="button"
                disabled={busy}
                onClick={() =>
                  setConfirmAction(needsApproval ? "submit" : "publish")
                }
              >
                <Icon
                  name={needsApproval ? "approval" : "check"}
                  size={17}
                />
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
                  <Icon name="close" size={16} />
                  Ablehnen
                </button>
                <button
                  className="primary"
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmAction("approve")}
                >
                  <Icon name="check" size={17} />
                  Freigeben &amp; veröffentlichen
                </button>
              </>
            )}
            {canCreateVersion && (
              <button className="primary" type="button" onClick={onNewVersion}>
                <Icon name="plus" size={17} />
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

          <section className="card file-section">
            <div className="section-heading">
              <div>
                <h2>Dateien</h2>
                <p>
                  Vorschauen öffnen Inhalte eingebettet. Downloads werden
                  separat und unverändert ausgeliefert.
                </p>
              </div>
              <span>{formatSize(version.total_size)}</span>
            </div>
            <div className="distribution-list">
            {version.distributions.map((distribution) => (
              <div className="distribution" key={distribution.id}>
                <Icon name="file" size={20} />
                <span className="distribution-name">
                  <b>{distribution.filename}</b>
                  <small>
                    {distribution.media_type} ·{" "}
                    {formatSize(distribution.content_size)}
                  </small>
                </span>
                <code
                  className="checksum"
                  title={`SHA-256: ${distribution.sha256}`}
                >
                  SHA-256 {distribution.sha256.slice(0, 10)}…
                </code>
                <div className="distribution-actions">
                  <button
                    className="secondary compact"
                    type="button"
                    disabled={busy}
                    onClick={() => openContent(distribution)}
                  >
                    <Icon name="eye" size={16} />
                    Vorschau
                  </button>
                  <button
                    className="secondary compact"
                    type="button"
                    disabled={busy}
                    onClick={() => downloadContent(distribution)}
                  >
                    <Icon name="download" size={16} />
                    Download
                  </button>
                </div>
              </div>
            ))}
            </div>

          {preview?.kind === "text" && (
            <div className="preview-panel">
              <div>
                <strong>Vorschau: {preview.filename}</strong>
                <button type="button" onClick={() => setPreview(null)}>
                  Schließen
                </button>
              </div>
              <pre className="text-preview">{preview.content}</pre>
            </div>
          )}
          {preview?.kind === "pdf" && (
            <div className="preview-panel">
              <div>
                <strong>Vorschau: {preview.filename}</strong>
                <button type="button" onClick={() => setPreview(null)}>
                  Schließen
                </button>
              </div>
              <iframe
                className="preview"
                src={preview.url}
                title={`Dateivorschau: ${preview.filename}`}
                sandbox=""
              />
            </div>
          )}
          </section>
        </div>

        <aside className="card workflow">
          <h2>Status &amp; Provenienz</h2>
          <dl>
            <dt>Status</dt>
            <dd><StatusBadge status={version.status} /></dd>
            <dt>Erstellt</dt>
            <dd>{formatDate(version.created_at)}</dd>
            <dt>Aktualisiert</dt>
            <dd>{formatDate(version.modified_at)}</dd>
            <dt>Veröffentlicht</dt>
            <dd>{formatDate(version.published_at)}</dd>
          </dl>

          <h2>Persistente Referenzen</h2>
          <span className="integration-label">Ressource (aktuelle Version)</span>
          <a className="stable-link" href={conceptPath}>{conceptPath}</a>
          <button
            className="secondary compact"
            type="button"
            onClick={() => copyIntegrationValue(conceptUrl, "Ressourcen-URL")}
          >
            <Icon name="copy" size={15} />
            Ressourcen-URL kopieren
          </button>
          <span className="integration-label">Diese Version</span>
          <a className="stable-link" href={versionPath}>{versionPath}</a>
          <button
            className="secondary compact"
            type="button"
            onClick={() => copyIntegrationValue(versionUrl, "Versions-URL")}
          >
            <Icon name="copy" size={15} />
            Versions-URL kopieren
          </button>

          <h2>Versionen</h2>
          <div className="version-list">
            {versions.map((entry) => (
              <a
                href={`${conceptPath}/versions/${entry.version.number}`}
                className={entry.version.number === version.number ? "active" : ""}
                key={entry.version.number}
                onClick={(event) => {
                  if (
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  ) return;
                  event.preventDefault();
                  onOpenVersion(entry.version.number);
                }}
              >
                v{entry.version.version_label}
                <small>
                  <StatusBadge status={entry.version.status} />
                </small>
              </a>
            ))}
          </div>
        </aside>
      </div>

      <section
        className="card integration-panel"
        aria-labelledby="integration-heading"
      >
        <div className="section-heading">
          <div>
            <h2 id="integration-heading">Technische Integration</h2>
            <p>
              Versionsgenaue Metadaten für Pipelines, Kataloge und
              automatisierte Weiterverarbeitung.
            </p>
          </div>
          <button
            className="secondary"
            type="button"
            disabled={busy}
            onClick={downloadDcat}
          >
            <Icon name="download" size={16} />
            DCAT JSON-LD herunterladen
          </button>
        </div>
        <span className="integration-label">Ressourcen-API (GET)</span>
        <code className="integration-code">{datasetApiUrl}</code>
        <div className="integration-actions">
          <button
            className="secondary compact"
            type="button"
            onClick={() => copyIntegrationValue(datasetApiUrl, "API-URL")}
          >
            <Icon name="copy" size={15} />
            API-URL kopieren
          </button>
          <button
            className="secondary compact"
            type="button"
            onClick={() =>
              copyIntegrationValue(datasetCurlCommand, "curl-Beispiel")
            }
          >
            <Icon name="copy" size={15} />
            curl-Beispiel kopieren
          </button>
        </div>
        {integrationMessage && (
          <p className="integration-message" role="status">
            {integrationMessage}
          </p>
        )}
      </section>

      <ConfirmDialog
        busy={busy}
        confirmLabel={
          confirmAction ? actionCopy[confirmAction].label : "Bestätigen"
        }
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => {
          if (confirmAction) void runAction(confirmAction);
        }}
        open={confirmAction !== null}
        title={
          confirmAction ? actionCopy[confirmAction].title : "Aktion bestätigen"
        }
      >
        {confirmAction ? actionCopy[confirmAction].description : null}
      </ConfirmDialog>
    </>
  );
}
