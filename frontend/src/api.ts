import { token } from "./auth";
import { config } from "./config";
import type {
  AuditEvent,
  CurrentUser,
  DirectoryUser,
  Membership,
  MembershipRole,
  Notification,
  Project,
  Dataset,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${await token()}`);
  const response = await fetch(`${config.apiUrl}${path}`, { ...init, headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(payload?.detail ?? "Anfrage fehlgeschlagen", response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

const jsonRequest = <T>(path: string, method: "POST" | "PUT", body: unknown) =>
  request<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export const api = {
  me: () => request<CurrentUser>("/me"),
  users: () => request<DirectoryUser[]>("/users"),
  projects: () => request<Project[]>("/projects"),
  datasets: (query = "", signal?: AbortSignal) =>
    request<Dataset[]>(`/datasets?query=${encodeURIComponent(query)}`, { signal }),
  dataset: (id: string, version?: number) =>
    request<Dataset>(
      version === undefined
        ? `/datasets/${id}`
        : `/datasets/${id}/versions/${version}`,
    ),
  datasetVersions: (id: string) =>
    request<Dataset[]>(`/datasets/${id}/versions`),
  notifications: () => request<Notification[]>("/notifications"),
  approvals: () => request<Dataset[]>("/approvals"),
  createDataset: (form: FormData) =>
    request<Dataset>("/datasets", { method: "POST", body: form }),
  createVersion: (id: string, form: FormData) =>
    request<Dataset>(`/datasets/${id}/versions`, {
      method: "POST",
      body: form,
    }),
  submit: (id: string, version: number) =>
    request<Dataset>(`/datasets/${id}/versions/${version}/submit`, {
      method: "POST",
    }),
  publish: (id: string, version: number) =>
    request<Dataset>(`/datasets/${id}/versions/${version}/publish`, {
      method: "POST",
    }),
  approve: (id: string, version: number, comment = "") =>
    jsonRequest<Dataset>(
      `/datasets/${id}/versions/${version}/approve`,
      "POST",
      { comment },
    ),
  reject: (id: string, version: number, comment: string) =>
    jsonRequest<Dataset>(
      `/datasets/${id}/versions/${version}/reject`,
      "POST",
      { comment },
    ),
  createProject: (body: unknown) =>
    jsonRequest<Project>("/projects", "POST", body),
  updateProject: (id: string, body: unknown) =>
    jsonRequest<Project>(`/projects/${id}`, "PUT", body),
  members: (id: string) =>
    request<Membership[]>(`/projects/${id}/members`),
  putMember: (
    id: string,
    subject: string,
    role: MembershipRole,
  ) =>
    jsonRequest<Membership>(
      `/projects/${id}/members/${encodeURIComponent(subject)}`,
      "PUT",
      { subject, role },
    ),
  removeMember: (id: string, subject: string) =>
    request<{ ok: boolean }>(
      `/projects/${id}/members/${encodeURIComponent(subject)}`,
      { method: "DELETE" },
    ),
  markNotificationRead: (id: string) =>
    request<{ ok: boolean }>(`/notifications/${id}/read`, {
      method: "POST",
    }),
  audit: () => request<AuditEvent[]>("/audit-events"),
  async content(id: string, version: number, distributionId: string) {
    const response = await fetch(
      `${config.apiUrl}/datasets/${id}/versions/${version}/distributions/${distributionId}/content?inline=true`,
      { headers: { Authorization: `Bearer ${await token()}` } },
    );
    if (!response.ok) {
      throw new ApiError("Inhalt konnte nicht geladen werden", response.status);
    }
    return {
      blob: await response.blob(),
      type: response.headers.get("content-type") ?? "application/octet-stream",
    };
  },
};
