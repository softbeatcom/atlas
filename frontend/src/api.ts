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
  Resource,
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
  resources: (query = "", signal?: AbortSignal) =>
    request<Resource[]>(`/resources?query=${encodeURIComponent(query)}`, { signal }),
  resource: (id: string, version?: number) =>
    request<Resource>(
      version === undefined
        ? `/resources/${id}`
        : `/resources/${id}/versions/${version}`,
    ),
  resourceVersions: (id: string) =>
    request<Resource[]>(`/resources/${id}/versions`),
  notifications: () => request<Notification[]>("/notifications"),
  approvals: () => request<Resource[]>("/approvals"),
  createResource: (form: FormData) =>
    request<Resource>("/resources", { method: "POST", body: form }),
  createVersion: (id: string, form: FormData) =>
    request<Resource>(`/resources/${id}/versions`, {
      method: "POST",
      body: form,
    }),
  submit: (id: string, version: number) =>
    request<Resource>(`/resources/${id}/versions/${version}/submit`, {
      method: "POST",
    }),
  publish: (id: string, version: number) =>
    request<Resource>(`/resources/${id}/versions/${version}/publish`, {
      method: "POST",
    }),
  approve: (id: string, version: number, comment = "") =>
    jsonRequest<Resource>(
      `/resources/${id}/versions/${version}/approve`,
      "POST",
      { comment },
    ),
  reject: (id: string, version: number, comment: string) =>
    jsonRequest<Resource>(
      `/resources/${id}/versions/${version}/reject`,
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
  async content(id: string, version: number) {
    const response = await fetch(
      `${config.apiUrl}/resources/${id}/versions/${version}/content?inline=true`,
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
