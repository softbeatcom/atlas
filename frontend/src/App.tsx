import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { DatasetSearchFacets, DatasetSearchFilters } from "./api";
import { keycloak } from "./auth";
import { AdminProjects } from "./features/admin";
import {
  DatasetDetail,
  DatasetForm,
  DatasetList,
} from "./features/datasets";
import {
  Approvals,
  AuditLog,
  Notifications,
} from "./features/secondary";
import type {
  CurrentUser,
  DirectoryUser,
  Notification,
  Project,
  Dataset,
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

function routeFromLocation(): Route {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
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
  return { page: "datasets" };
}

export function App() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [page, setPage] = useState<Page>(routeFromLocation().page);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [approvals, setApprovals] = useState<Dataset[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([]);
  const [selected, setSelected] = useState<Dataset | null>(null);
  const [message, setMessage] = useState("");
  const [initialLoading, setInitialLoading] = useState(true);
  const [searchLoading, setSearchLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<DatasetSearchFilters>({});
  const [searchFacets, setSearchFacets] = useState<DatasetSearchFacets>({
    projects: [],
    keywords: [],
    suffixes: [],
  });
  const [menuOpen, setMenuOpen] = useState(false);

  const refresh = useCallback(async () => {
    const me = await api.me();
    const canApprove = me.roles.includes("approver") || me.roles.includes("admin");
    const isAdmin = me.roles.includes("admin");
    const [projectItems, datasetItems, notificationItems, approvalItems, users, facets] =
      await Promise.all([
        api.projects(),
        api.datasets(),
        api.notifications(),
        canApprove ? api.approvals() : Promise.resolve([]),
        isAdmin ? api.users() : Promise.resolve([]),
        api.datasetSearchFacets(),
      ]);
    setUser(me);
    setProjects(projectItems);
    setDatasets(datasetItems);
    setNotifications(notificationItems);
    setApprovals(approvalItems);
    setDirectoryUsers(users);
    setSearchFacets(facets);
  }, []);

  const applyRoute = useCallback(async (route: Route) => {
    setMenuOpen(false);
    if (route.page === "detail" && route.datasetId && route.version) {
      setSelected(await api.dataset(route.datasetId, route.version));
    } else if (route.page === "new-version" && route.datasetId) {
      const versions = await api.datasetVersions(route.datasetId);
      if (versions.length === 0) throw new Error("Datensatz nicht gefunden");
      setSelected(versions[0]);
    } else {
      setSelected(null);
    }
    setPage(route.page);
  }, []);

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      try {
        await refresh();
        if (active) await applyRoute(routeFromLocation());
      } catch (error) {
        if (active) {
          setMessage(error instanceof Error ? error.message : "SoftBeat Atlas konnte nicht geladen werden");
        }
      } finally {
        if (active) setInitialLoading(false);
      }
    };
    const handlePopState = () => {
      applyRoute(routeFromLocation()).catch((error) =>
        setMessage(error instanceof Error ? error.message : "Seite konnte nicht geladen werden"),
      );
    };
    initialize();
    window.addEventListener("popstate", handlePopState);
    return () => {
      active = false;
      window.removeEventListener("popstate", handlePopState);
    };
  }, [applyRoute, refresh]);

  useEffect(() => {
    if (initialLoading || page !== "datasets") return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearchLoading(true);
      api
        .datasets(query, filters, controller.signal)
        .then(setDatasets)
        .catch((error) => {
          if (error.name !== "AbortError") setMessage(error.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchLoading(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [filters, initialLoading, page, query]);

  const navigate = (next: NavigationPage) => {
    window.history.pushState({}, "", pagePaths[next]);
    setMenuOpen(false);
    setSelected(null);
    setPage(next);
  };

  const searchDatasets = (nextQuery: string) => {
    setQuery(nextQuery);
    if (page !== "datasets") navigate("datasets");
  };

  const openDataset = async (id: string, version: number) => {
    try {
      const dataset = await api.dataset(id, version);
      setSelected(dataset);
      setPage("detail");
      setMenuOpen(false);
      window.history.pushState(
        {},
        "",
        `/datasets/${encodeURIComponent(id)}/versions/${version}`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Datensatz konnte nicht geladen werden");
    }
  };

  const openNewVersion = () => {
    if (!selected) return;
    setPage("new-version");
    window.history.pushState(
      {},
      "",
      `/datasets/${encodeURIComponent(selected.id)}/versions/new`,
    );
  };

  const openSavedDataset = async (dataset: Dataset) => {
    setSelected(dataset);
    setPage("detail");
    window.history.replaceState(
      {},
      "",
      `/datasets/${encodeURIComponent(dataset.id)}/versions/${dataset.version.number}`,
    );
    await refresh();
  };

  const reloadSelected = async () => {
    if (!selected) return;
    setSelected(await api.dataset(selected.id, selected.version.number));
    await refresh();
  };

  if (initialLoading || !user) {
    return <div className="loading">SoftBeat Atlas wird geladen …</div>;
  }

  const roles = user.roles;
  const unread = notifications.filter((item) => !item.read).length;
  const canApprove = roles.includes("approver") || roles.includes("admin");
  const isAdmin = roles.includes("admin");
  const canAudit = roles.includes("auditor") || isAdmin;
  const activeNavigation = activeNavigationPage(page);

  const navButton = (
    destination: NavigationPage,
    label: string,
    icon: string,
    badge?: number,
  ) => (
    <button
      className={activeNavigation === destination ? "active" : ""}
      type="button"
      aria-current={activeNavigation === destination ? "page" : undefined}
      onClick={() => navigate(destination)}
    >
      <span aria-hidden="true">{icon}</span> {label}
      {badge !== undefined && badge > 0 && <b>{badge}</b>}
    </button>
  );

  return (
    <div className="app">
      {menuOpen && (
        <button
          className="menu-backdrop"
          type="button"
          aria-label="Navigation schließen"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="sidebar-heading">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">⌘</span>
            SoftBeat Atlas
          </div>
          <button
            className="close-menu"
            type="button"
            aria-label="Navigation schließen"
            onClick={() => setMenuOpen(false)}
          >
            ×
          </button>
        </div>
        <div className="workspace">Arbeitsbereich</div>
        <nav className="primary-navigation" aria-label="Hauptnavigation">
          {navButton("datasets", "Datensätze", "▦")}
          {navButton("upload", "Datensatz anlegen", "＋")}
          {canApprove && navButton("approvals", "Freigaben", "✓", approvals.length)}
          {navButton("notifications", "Benachrichtigungen", "♧", unread)}
          {isAdmin && navButton("admin", "Verwaltung", "⚙")}
          {canAudit && navButton("audit", "Audit-Log", "◷")}
        </nav>
        <div className="side-bottom">
          <strong>{user.username}</strong>
          {roles
            .filter((role) => ["admin", "auditor", "approver", "user"].includes(role))
            .join(" · ")}
        </div>
      </aside>

      <main>
        <header className="app-header">
          <button
            className="mobile-menu"
            type="button"
            aria-label="Navigation öffnen"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            ☰
          </button>
          <div className="search">
            <label className="sr-only" htmlFor="dataset-search">
              Datensätze durchsuchen
            </label>
            <input
              id="dataset-search"
              type="search"
              value={query}
              placeholder="Titel, Beschreibung, Schlagwort …"
              onChange={(event) => searchDatasets(event.target.value)}
            />
          </div>
          <div className="header-actions">
            <button
              className="notice-icon"
              type="button"
              aria-label={`Benachrichtigungen${unread ? `, ${unread} ungelesen` : ""}`}
              onClick={() => navigate("notifications")}
            >
              <span aria-hidden="true">♧</span>
              {unread > 0 && <i>{unread}</i>}
            </button>
            <button
              className="logout"
              type="button"
              onClick={() => keycloak.logout({ redirectUri: window.location.origin })}
            >
              Abmelden
            </button>
          </div>
        </header>

        <div className="content">
          {message && (
            <div className="flash" role="alert">
              {message}
              <button
                type="button"
                aria-label="Meldung schließen"
                onClick={() => setMessage("")}
              >
                ×
              </button>
            </div>
          )}

          {page === "datasets" && (
            <DatasetList
              items={datasets}
              loading={searchLoading}
              filters={filters}
              facets={searchFacets}
              onOpen={openDataset}
              onUpload={() => navigate("upload")}
              onFiltersChange={setFilters}
            />
          )}
          {page === "upload" && (
            <DatasetForm
              projects={projects}
              onDone={openSavedDataset}
              onError={setMessage}
            />
          )}
          {page === "new-version" && selected && (
            <DatasetForm
              projects={projects}
              base={selected}
              onDone={openSavedDataset}
              onError={setMessage}
            />
          )}
          {page === "detail" && selected && (
            <DatasetDetail
              item={selected}
              user={user}
              onBack={() => navigate("datasets")}
              onOpenVersion={(version) => openDataset(selected.id, version)}
              onNewVersion={openNewVersion}
              onReload={reloadSelected}
              onError={setMessage}
            />
          )}
          {page === "approvals" && (
            <Approvals items={approvals} onOpen={openDataset} />
          )}
          {page === "notifications" && (
            <Notifications
              items={notifications}
              onOpen={openDataset}
              onChanged={refresh}
              onError={setMessage}
            />
          )}
          {page === "admin" && (
            <AdminProjects
              projects={projects}
              users={directoryUsers}
              onReload={refresh}
              onError={setMessage}
            />
          )}
          {page === "audit" && <AuditLog onError={setMessage} />}
        </div>
      </main>
    </div>
  );
}
