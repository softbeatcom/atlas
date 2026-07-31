import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useLocation, useSearch } from "wouter";
import { api } from "./api";
import type { DatasetSearchFacets, DatasetSearchFilters } from "./api";
import { keycloak } from "./auth";
import { AdminProjects } from "./features/admin";
import {
  DatasetDetail,
  DatasetForm,
  DatasetList,
} from "./features/datasets";
import type { DatasetSort } from "./features/datasets";
import {
  Approvals,
  AuditLog,
  Notifications,
} from "./features/secondary";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import type {
  CurrentUser,
  Dataset,
  DirectoryUser,
  Notification,
  Project,
} from "./types";

type Page =
  | "datasets"
  | "upload"
  | "detail"
  | "new-version"
  | "approvals"
  | "notifications"
  | "admin"
  | "audit";

type NavigationPage = Exclude<Page, "detail" | "new-version">;

type Route = {
  page: Page;
  datasetId?: string;
  version?: number;
};

type Notice = {
  message: string;
  tone: "error" | "success" | "info";
};

const pagePaths: Record<NavigationPage, string> = {
  datasets: "/datasets",
  upload: "/datasets/new",
  approvals: "/approvals",
  notifications: "/notifications",
  admin: "/admin/projects",
  audit: "/audit",
};

function activeNavigationPage(page: Page): NavigationPage {
  if (page === "detail" || page === "new-version") return "datasets";
  return page;
}

function routeFromPath(pathname: string): Route {
  const path = pathname.replace(/\/+$/, "") || "/";
  const newVersion = path.match(/^\/datasets\/([^/]+)\/versions\/new$/);
  if (newVersion) {
    return { page: "new-version", datasetId: decodeURIComponent(newVersion[1]) };
  }
  const detail = path.match(/^\/datasets\/([^/]+)\/versions\/(\d+)$/);
  if (detail) {
    return {
      page: "detail",
      datasetId: decodeURIComponent(detail[1]),
      version: Number(detail[2]),
    };
  }
  const entry = Object.entries(pagePaths).find(([, candidate]) => candidate === path);
  if (entry) return { page: entry[0] as Route["page"] };
  const current = path.match(/^\/datasets\/([^/]+)$/);
  if (current) {
    return { page: "detail", datasetId: decodeURIComponent(current[1]) };
  }
  return { page: "datasets" };
}

function readCatalogState(search: string): {
  query: string;
  filters: DatasetSearchFilters;
  sort: DatasetSort;
} {
  const params = new URLSearchParams(search);
  const projectIds = params.getAll("project");
  const tags = params.getAll("tag");
  const suffixes = params.getAll("format");
  const sort = params.get("sort");
  return {
    query: params.get("q") ?? "",
    filters: {
      projectIds: projectIds.length ? projectIds : undefined,
      tags: tags.length ? tags : undefined,
      suffixes: suffixes.length ? suffixes : undefined,
    },
    sort:
      sort === "title-asc" || sort === "project-asc" || sort === "status-asc"
        ? sort
        : "updated-desc",
  };
}

function catalogSearch(
  query: string,
  filters: DatasetSearchFilters,
  sort: DatasetSort,
): string {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  filters.projectIds?.forEach((value) => params.append("project", value));
  filters.tags?.forEach((value) => params.append("tag", value));
  filters.suffixes?.forEach((value) => params.append("format", value));
  if (sort !== "updated-desc") params.set("sort", sort);
  const value = params.toString();
  return value ? `?${value}` : "";
}

function NavigationLink({
  destination,
  current,
  icon,
  label,
  badge,
  onNavigate,
}: {
  destination: NavigationPage;
  current: NavigationPage;
  icon: IconName;
  label: string;
  badge?: number;
  onNavigate: () => void;
}) {
  return (
    <Link
      aria-current={current === destination ? "page" : undefined}
      className={current === destination ? "active" : ""}
      onClick={onNavigate}
      href={pagePaths[destination]}
    >
      <Icon name={icon} />
      <span>{label}</span>
      {badge !== undefined && badge > 0 && (
        <b aria-label={`${badge} offen`}>{badge}</b>
      )}
    </Link>
  );
}

export function App() {
  const [pathname, navigate] = useLocation();
  const browserSearch = useSearch();
  const search = browserSearch ? `?${browserSearch}` : "";
  const route = useMemo(() => routeFromPath(pathname), [pathname]);
  const page = route.page;
  const catalogState = useMemo(
    () => readCatalogState(search),
    [search],
  );
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [approvals, setApprovals] = useState<Dataset[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([]);
  const [selected, setSelected] = useState<Dataset | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchFacets, setSearchFacets] = useState<DatasetSearchFacets>({
    projects: [],
    keywords: [],
    suffixes: [],
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [headerQuery, setHeaderQuery] = useState(catalogState.query);
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeMenuRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const lastCatalogSearch = useRef(search);

  const showError = useCallback((message: string) => {
    setNotice({ message, tone: "error" });
  }, []);

  const loadShell = useCallback(async (currentUser: CurrentUser) => {
    const canApprove =
      currentUser.roles.includes("approver") ||
      currentUser.roles.includes("admin");
    const isAdmin = currentUser.roles.includes("admin");
    const [projectItems, notificationItems, approvalItems, users, facets] =
      await Promise.all([
        api.projects(),
        api.notifications(),
        canApprove ? api.approvals() : Promise.resolve([]),
        isAdmin ? api.users() : Promise.resolve([]),
        api.datasetSearchFacets(),
      ]);
    setProjects(projectItems);
    setNotifications(notificationItems);
    setApprovals(approvalItems);
    setDirectoryUsers(users);
    setSearchFacets(facets);
  }, []);

  const refresh = useCallback(async () => {
    const currentUser = await api.me();
    setUser(currentUser);
    await loadShell(currentUser);
    setCatalogRefresh((value) => value + 1);
  }, [loadShell]);

  useEffect(() => {
    let active = true;
    api
      .me()
      .then((currentUser) => {
        if (!active) return;
        setUser(currentUser);
        setInitialLoading(false);
        return loadShell(currentUser);
      })
      .catch((error) => {
        if (active) {
          showError(
            error instanceof Error
              ? error.message
              : "SoftBeat Atlas konnte nicht geladen werden",
          );
          setInitialLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [loadShell, showError]);

  useEffect(() => {
    if (page === "datasets") {
      lastCatalogSearch.current = search;
      setHeaderQuery(catalogState.query);
    }
  }, [catalogState.query, page, search]);

  useEffect(() => {
    if (page !== "detail" && page !== "new-version") {
      setSelected(null);
      setSelectedLoading(false);
      return;
    }
    if (!route.datasetId) return;

    let active = true;
    setSelectedLoading(true);
    const request =
      page === "new-version"
        ? api.datasetVersions(route.datasetId).then((versions) => {
            if (versions.length === 0) throw new Error("Ressource nicht gefunden");
            return versions[0];
          })
        : api.dataset(route.datasetId, route.version);
    request
      .then((dataset) => {
        if (active) setSelected(dataset);
      })
      .catch((error) => {
        if (active) showError(error instanceof Error ? error.message : "Ressource konnte nicht geladen werden");
      })
      .finally(() => {
        if (active) setSelectedLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, route.datasetId, route.version, showError]);

  useEffect(() => {
    if (initialLoading || page !== "datasets") return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearchLoading(true);
      api
        .datasets(catalogState.query, catalogState.filters, controller.signal)
        .then(setDatasets)
        .catch((error) => {
          if (error.name !== "AbortError") showError(error.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchLoading(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    catalogRefresh,
    catalogState.filters,
    catalogState.query,
    initialLoading,
    page,
    showError,
  ]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (
        event.key === "/" &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement) &&
        !(event.target instanceof HTMLSelectElement)
      ) {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", focusSearch);
    return () => document.removeEventListener("keydown", focusSearch);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    closeMenuRef.current?.focus();
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
        return;
      }
      if (event.key !== "Tab" || !sidebarRef.current) return;
      const focusable = Array.from(
        sidebarRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled])',
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
    return () => document.removeEventListener("keydown", handleKeyboard);
  }, [menuOpen]);

  const updateCatalog = useCallback(
    (
      query: string,
      filters: DatasetSearchFilters,
      sort: DatasetSort,
      replace = true,
    ) => {
      navigate(
        `${pagePaths.datasets}${catalogSearch(query, filters, sort)}`,
        { replace },
      );
    },
    [navigate],
  );

  const submitGlobalSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateCatalog(
      headerQuery,
      page === "datasets" ? catalogState.filters : {},
      page === "datasets" ? catalogState.sort : "updated-desc",
      page === "datasets",
    );
  };

  const changeGlobalSearch = (value: string) => {
    setHeaderQuery(value);
    if (page === "datasets") {
      updateCatalog(value, catalogState.filters, catalogState.sort);
    }
  };

  const openDataset = (id: string, version: number) => {
    navigate(`/datasets/${encodeURIComponent(id)}/versions/${version}`);
    setMenuOpen(false);
  };

  const openNewVersion = () => {
    if (selected) {
      navigate(`/datasets/${encodeURIComponent(selected.id)}/versions/new`);
    }
  };

  const openSavedDataset = async (dataset: Dataset) => {
    navigate(
      `/datasets/${encodeURIComponent(dataset.id)}/versions/${dataset.version.number}`,
      { replace: true },
    );
    await refresh();
  };

  const reloadSelected = async () => {
    if (!selected) return;
    setSelected(await api.dataset(selected.id, selected.version.number));
    await refresh();
  };

  if (initialLoading) {
    return <div className="loading">SoftBeat Atlas wird geladen …</div>;
  }
  if (!user) {
    return (
      <main className="startup-error">
        <section className="card">
          <Icon name="archive" size={30} />
          <h1>Atlas konnte nicht geladen werden</h1>
          <p>{notice?.message ?? "Die Anmeldung oder API ist nicht erreichbar."}</p>
          <button
            className="primary"
            onClick={() => window.location.reload()}
            type="button"
          >
            Erneut versuchen
          </button>
        </section>
      </main>
    );
  }

  const roles = user.roles;
  const unread = notifications.filter((item) => !item.read).length;
  const canApprove = roles.includes("approver") || roles.includes("admin");
  const isAdmin = roles.includes("admin");
  const canAudit = roles.includes("auditor") || isAdmin;
  const activeNavigation = activeNavigationPage(page);
  const closeNavigation = () => setMenuOpen(false);

  return (
    <div className="app">
      <a className="skip-link" href="#main-content">
        Zum Inhalt springen
      </a>
      {menuOpen && (
        <button
          aria-label="Navigation schließen"
          className="menu-backdrop"
          onClick={() => {
            setMenuOpen(false);
            menuButtonRef.current?.focus();
          }}
          type="button"
        />
      )}
      <aside
        aria-label="Anwendungsnavigation"
        className={`sidebar ${menuOpen ? "open" : ""}`}
        ref={sidebarRef}
      >
        <div className="sidebar-heading">
          <Link className="brand" onClick={closeNavigation} href="/datasets">
            <span className="brand-mark" aria-hidden="true">A</span>
            <span>SoftBeat<br />Atlas</span>
          </Link>
          <button
            aria-label="Navigation schließen"
            className="close-menu icon-button"
            onClick={() => {
              setMenuOpen(false);
              menuButtonRef.current?.focus();
            }}
            ref={closeMenuRef}
            type="button"
          >
            <Icon name="close" size={22} />
          </button>
        </div>

        <nav className="primary-navigation" aria-label="Hauptnavigation">
          <div className="nav-group">
            <span className="nav-heading">Repository</span>
            <NavigationLink
              current={activeNavigation}
              destination="datasets"
              icon="archive"
              label="Ressourcen"
              onNavigate={closeNavigation}
            />
            <NavigationLink
              current={activeNavigation}
              destination="upload"
              icon="upload"
              label="Ressource anlegen"
              onNavigate={closeNavigation}
            />
          </div>
          <div className="nav-group">
            <span className="nav-heading">Workflow</span>
            {canApprove && (
              <NavigationLink
                badge={approvals.length}
                current={activeNavigation}
                destination="approvals"
                icon="approval"
                label="Freigaben"
                onNavigate={closeNavigation}
              />
            )}
            <NavigationLink
              badge={unread}
              current={activeNavigation}
              destination="notifications"
              icon="bell"
              label="Benachrichtigungen"
              onNavigate={closeNavigation}
            />
          </div>
          {(isAdmin || canAudit) && (
            <div className="nav-group">
              <span className="nav-heading">Betrieb</span>
              {isAdmin && (
                <NavigationLink
                  current={activeNavigation}
                  destination="admin"
                  icon="folder"
                  label="Projekte & Zugriffe"
                  onNavigate={closeNavigation}
                />
              )}
              {canAudit && (
                <NavigationLink
                  current={activeNavigation}
                  destination="audit"
                  icon="activity"
                  label="Audit-Log"
                  onNavigate={closeNavigation}
                />
              )}
            </div>
          )}
        </nav>

        <div className="side-bottom">
          <span className="avatar" aria-hidden="true">
            {user.username.slice(0, 2).toUpperCase()}
          </span>
          <span>
            <strong>{user.username}</strong>
            {roles
              .filter((role) => ["admin", "auditor", "approver", "user"].includes(role))
              .join(" · ")}
          </span>
        </div>
      </aside>

      <main id="main-content" tabIndex={-1}>
        <header className="app-header">
          <button
            aria-expanded={menuOpen}
            aria-label="Navigation öffnen"
            className="mobile-menu icon-button"
            onClick={() => setMenuOpen(true)}
            ref={menuButtonRef}
            type="button"
          >
            <Icon name="menu" size={21} />
          </button>
          <form className="search" onSubmit={submitGlobalSearch} role="search">
            <label className="sr-only" htmlFor="dataset-search">
              Ressourcen durchsuchen
            </label>
            <Icon className="search-icon" name="search" size={18} />
            <input
              id="dataset-search"
              onChange={(event) => changeGlobalSearch(event.target.value)}
              placeholder="Titel, Beschreibung oder Schlagwort suchen …"
              ref={searchInputRef}
              type="search"
              value={headerQuery}
            />
            <kbd aria-label="Tastenkürzel: Schrägstrich">/</kbd>
          </form>
          <div className="header-actions">
            <Link
              aria-label={`Benachrichtigungen${unread ? `, ${unread} ungelesen` : ""}`}
              className="notice-icon icon-button"
              href={pagePaths.notifications}
            >
              <Icon name="bell" size={20} />
              {unread > 0 && <i>{unread}</i>}
            </Link>
            <div className="account-summary">
              <span className="avatar small" aria-hidden="true">
                {user.username.slice(0, 2).toUpperCase()}
              </span>
              <span>
                <strong>{user.username}</strong>
                <small>Angemeldet</small>
              </span>
            </div>
            <button
              aria-label="Abmelden"
              className="logout icon-button"
              onClick={() => keycloak.logout({ redirectUri: window.location.origin })}
              title="Abmelden"
              type="button"
            >
              <Icon name="logout" size={19} />
            </button>
          </div>
        </header>

        <div className="content">
          {notice && (
            <div className={`flash ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
              {notice.message}
              <button
                aria-label="Meldung schließen"
                onClick={() => setNotice(null)}
                type="button"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          )}

          {page === "datasets" && (
            <DatasetList
              facets={searchFacets}
              filters={catalogState.filters}
              items={datasets}
              loading={searchLoading}
              onFiltersChange={(filters) =>
                updateCatalog(catalogState.query, filters, catalogState.sort)
              }
              onOpen={openDataset}
              onSortChange={(sort) =>
                updateCatalog(catalogState.query, catalogState.filters, sort)
              }
              onUpload={() => navigate(pagePaths.upload)}
              sort={catalogState.sort}
            />
          )}
          {page === "upload" && (
            <DatasetForm
              onDone={openSavedDataset}
              onError={showError}
              projects={projects}
            />
          )}
          {page === "new-version" && selected && !selectedLoading && (
            <DatasetForm
              base={selected}
              onDone={openSavedDataset}
              onError={showError}
              projects={projects}
            />
          )}
          {page === "detail" && selected && !selectedLoading && (
            <DatasetDetail
              item={selected}
              onBack={() => navigate(`/datasets${lastCatalogSearch.current}`)}
              onError={showError}
              onNewVersion={openNewVersion}
              onOpenVersion={(version) => openDataset(selected.id, version)}
              onReload={reloadSelected}
              user={user}
            />
          )}
          {(page === "detail" || page === "new-version") && selectedLoading && (
            <div className="page-loading" role="status">
              <span className="spinner" aria-hidden="true" />
              Ressource wird geladen …
            </div>
          )}
          {page === "approvals" && (
            <Approvals items={approvals} onOpen={openDataset} />
          )}
          {page === "notifications" && (
            <Notifications
              items={notifications}
              onChanged={refresh}
              onError={showError}
              onOpen={openDataset}
            />
          )}
          {page === "admin" && (
            <AdminProjects
              onError={showError}
              onReload={refresh}
              projects={projects}
              users={directoryUsers}
            />
          )}
          {page === "audit" && <AuditLog onError={showError} />}
        </div>
      </main>
    </div>
  );
}
