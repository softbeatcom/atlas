export type Visibility = "project" | "organization";
export type VersionStatus = "draft" | "pending" | "published" | "rejected";
export type MembershipRole = "member" | "approver";

export type Project = {
  id: string;
  name: string;
  visibility: Visibility;
  approval_required: boolean;
};

export type ResourceVersion = {
  number: number;
  status: VersionStatus;
  title: string;
  description: string;
  resource_type: string;
  keywords: string[];
  creator: string;
  version_label: string;
  filename: string;
  content_size: number;
  media_type: string;
  sha256: string;
  created_at: string;
  modified_at: string;
  published_at: string | null;
};

export type Resource = {
  id: string;
  project: Project | null;
  owner: string;
  current_published_number: number | null;
  latest_number: number;
  is_current: boolean;
  newer_version: number | null;
  version: ResourceVersion;
};

export type CurrentUser = {
  subject: string;
  username: string;
  roles: string[];
};

export type Notification = {
  id: string;
  kind: string;
  message: string;
  resource_id: string;
  version_number: number;
  read: boolean;
  created_at: string;
};

export type Membership = {
  id: string;
  subject: string;
  role: MembershipRole;
};

export type DirectoryUser = {
  subject: string;
  username: string;
  display_name: string;
};

export type AuditEvent = {
  id: string;
  actor_subject: string;
  action: string;
  resource_id: string | null;
  version_number: number | null;
  details: Record<string, unknown>;
  created_at: string;
};
