from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import CurrentUser
from .models import (
    Dataset,
    DatasetVersion,
    MembershipRole,
    Project,
    ProjectMembership,
    VersionStatus,
    Visibility,
)


def membership(
    session: Session,
    project_id: str,
    subject: str,
) -> ProjectMembership | None:
    return session.scalar(
        select(ProjectMembership).where(
            ProjectMembership.project_id == project_id,
            ProjectMembership.subject == subject,
        )
    )


def can_contribute_to_project(
    session: Session,
    user: CurrentUser,
    project_id: str,
) -> bool:
    return user.has("admin") or membership(session, project_id, user.subject) is not None


def is_project_approver(
    session: Session,
    user: CurrentUser,
    project: Project | None,
) -> bool:
    if user.has("admin"):
        return True
    if project is None or not user.has("approver"):
        return False
    item = membership(session, project.id, user.subject)
    return bool(item and item.role == MembershipRole.APPROVER)


def can_view_metadata(
    session: Session,
    user: CurrentUser,
    dataset: Dataset,
    project: Project | None,
) -> bool:
    if user.has("admin") or user.has("auditor") or dataset.owner_subject == user.subject:
        return True
    if project is None:
        return False
    if project.visibility == Visibility.ORGANIZATION:
        return True
    return membership(session, project.id, user.subject) is not None


def can_read_content(
    session: Session,
    user: CurrentUser,
    dataset: Dataset,
    project: Project | None,
) -> bool:
    if user.has("admin") or dataset.owner_subject == user.subject:
        return True
    if user.has("auditor"):
        return False
    if project is None:
        return False
    if project.visibility == Visibility.ORGANIZATION:
        return True
    return membership(session, project.id, user.subject) is not None


def can_view_version_metadata(
    session: Session,
    user: CurrentUser,
    dataset: Dataset,
    project: Project | None,
    version: DatasetVersion,
) -> bool:
    if version.status == VersionStatus.PUBLISHED:
        return can_view_metadata(session, user, dataset, project)
    if user.has("admin") or user.has("auditor") or dataset.owner_subject == user.subject:
        return True
    return version.status == VersionStatus.PENDING and is_project_approver(session, user, project)


def can_manage_dataset(user: CurrentUser, dataset: Dataset) -> bool:
    return user.has("admin") or dataset.owner_subject == user.subject


def can_read_version_content(
    session: Session,
    user: CurrentUser,
    dataset: Dataset,
    project: Project | None,
    version: DatasetVersion,
) -> bool:
    if version.status == VersionStatus.PUBLISHED:
        return can_read_content(session, user, dataset, project)
    if user.has("admin") or dataset.owner_subject == user.subject:
        return True
    return version.status == VersionStatus.PENDING and is_project_approver(session, user, project)
