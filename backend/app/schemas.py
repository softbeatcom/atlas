from datetime import datetime

from pydantic import BaseModel, Field

from .models import MembershipRole, VersionStatus, Visibility


class ProjectCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    visibility: Visibility = Visibility.PROJECT
    approval_required: bool = True


class ProjectOut(ProjectCreate):
    id: str

    model_config = {"from_attributes": True}


class MembershipIn(BaseModel):
    subject: str = Field(min_length=1, max_length=255)
    role: MembershipRole = MembershipRole.MEMBER


class MembershipOut(MembershipIn):
    id: str

    model_config = {"from_attributes": True}


class DirectoryUserOut(BaseModel):
    subject: str
    username: str
    display_name: str


class DecisionIn(BaseModel):
    comment: str | None = Field(default=None, max_length=4000)


class MeOut(BaseModel):
    subject: str
    username: str
    roles: list[str]


class DistributionOut(BaseModel):
    id: str
    position: int
    filename: str
    content_size: int
    media_type: str
    sha256: str


class DatasetVersionOut(BaseModel):
    number: int
    status: VersionStatus
    title: str
    description: str
    dataset_type: str
    keywords: list[str]
    creator: str
    version_label: str
    distributions: list[DistributionOut]
    distribution_count: int
    total_size: int
    created_at: datetime
    modified_at: datetime
    published_at: datetime | None


class DatasetOut(BaseModel):
    id: str
    project: ProjectOut | None
    owner: str
    current_published_number: int | None
    latest_number: int
    is_current: bool
    newer_version: int | None
    version: DatasetVersionOut


class NotificationOut(BaseModel):
    id: str
    kind: str
    message: str
    dataset_id: str
    version_number: int
    read: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class AuditOut(BaseModel):
    id: str
    actor_subject: str
    action: str
    dataset_id: str | None
    version_number: int | None
    details: dict
    created_at: datetime

    model_config = {"from_attributes": True}


class OkOut(BaseModel):
    ok: bool = True
