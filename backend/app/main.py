import os
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import CurrentUser, get_current_user, require_admin
from .config import settings
from .database import engine, get_session
from .demo import DEMO_SUBJECTS, DEMO_USERS
from .models import (
    ApprovalRequest,
    AuditEvent,
    MembershipRole,
    Notification,
    Project,
    ProjectMembership,
    Resource,
    ResourceVersion,
    VersionStatus,
    Visibility,
    utcnow,
)
from .policies import (
    can_contribute_to_project,
    can_manage_resource,
    can_read_version_content,
    can_view_version_metadata,
    is_project_approver,
    membership,
)
from .schemas import (
    AuditOut,
    DecisionIn,
    DirectoryUserOut,
    MembershipIn,
    MembershipOut,
    MeOut,
    NotificationOut,
    OkOut,
    ProjectCreate,
    ProjectOut,
    ResourceOut,
)
from .storage import storage


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialise()
    yield


app = FastAPI(
    title="SoftBeat Atlas API",
    version="0.1.0",
    openapi_url="/api/v1/openapi.json",
    docs_url="/docs",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware, allow_origins=settings.allowed_origins, allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)


def initialise() -> None:
    if not settings.seed_demo_data:
        return
    with Session(engine) as session:
        aster = session.scalar(select(Project).where(Project.name == "Aster"))
        if aster is None:
            aster = Project(name="Aster", visibility=Visibility.PROJECT, approval_required=True)
            session.add(aster)
            session.flush()
        platform = session.scalar(select(Project).where(Project.name == "Platform"))
        if platform is None:
            platform = Project(name="Platform", visibility=Visibility.ORGANIZATION, approval_required=False)
            session.add(platform)
            session.flush()
        _repair_demo_memberships(session)
        _ensure_membership(
            session, aster.id, DEMO_SUBJECTS["alice"], MembershipRole.MEMBER
        )
        _ensure_membership(
            session, aster.id, DEMO_SUBJECTS["bob"], MembershipRole.APPROVER
        )
        _ensure_membership(
            session, platform.id, DEMO_SUBJECTS["alice"], MembershipRole.MEMBER
        )
        session.commit()


def _repair_demo_memberships(session: Session) -> None:
    for username, subject in DEMO_SUBJECTS.items():
        for item in session.scalars(
            select(ProjectMembership).where(ProjectMembership.subject == username)
        ).all():
            existing = membership(session, item.project_id, subject)
            if existing:
                session.delete(item)
            else:
                item.subject = subject


def _ensure_membership(
    session: Session,
    project_id: str,
    subject: str,
    role: MembershipRole,
) -> None:
    item = membership(session, project_id, subject)
    if item is None:
        session.add(ProjectMembership(project_id=project_id, subject=subject, role=role))
    else:
        item.role = role


def api_error(code: int, detail: str) -> None:
    raise HTTPException(code, detail)


def audit(session: Session, user: CurrentUser, action: str, resource: Resource | None = None,
          version: ResourceVersion | None = None, details: dict | None = None) -> None:
    session.add(AuditEvent(actor_subject=user.subject, action=action,
                           resource_id=resource.id if resource else None,
                           version_number=version.number if version else None,
                           details=details or {}))


def project_for(session: Session, project_id: str | None) -> Project | None:
    if not project_id:
        return None
    project = session.get(Project, project_id)
    if not project:
        api_error(status.HTTP_404_NOT_FOUND, "Projekt nicht gefunden")
    return project


def get_resource(session: Session, resource_id: str) -> Resource:
    resource = session.get(Resource, resource_id)
    if not resource:
        api_error(status.HTTP_404_NOT_FOUND, "Ressource nicht gefunden")
    return resource


def get_version(session: Session, resource: Resource, number: int | None = None) -> ResourceVersion:
    if number is not None:
        version = session.scalar(select(ResourceVersion).where(
            ResourceVersion.resource_id == resource.id, ResourceVersion.number == number))
    elif resource.current_published_number:
        version = session.scalar(select(ResourceVersion).where(
            ResourceVersion.resource_id == resource.id,
            ResourceVersion.number == resource.current_published_number))
    else:
        version = session.scalar(select(ResourceVersion).where(
            ResourceVersion.resource_id == resource.id).order_by(ResourceVersion.number.desc()))
    if not version:
        api_error(status.HTTP_404_NOT_FOUND, "Version nicht gefunden")
    return version


def latest_version(session: Session, resource: Resource) -> ResourceVersion:
    version = session.scalar(
        select(ResourceVersion)
        .where(ResourceVersion.resource_id == resource.id)
        .order_by(ResourceVersion.number.desc())
    )
    if not version:
        api_error(status.HTTP_404_NOT_FOUND, "Version nicht gefunden")
    return version


def resource_out(session: Session, resource: Resource, version: ResourceVersion) -> dict:
    project = project_for(session, resource.project_id)
    current = resource.current_published_number
    latest = session.scalar(
        select(ResourceVersion.number)
        .where(ResourceVersion.resource_id == resource.id)
        .order_by(ResourceVersion.number.desc())
    )
    return {
        "id": resource.id, "project": {"id": project.id, "name": project.name,
        "visibility": project.visibility.value, "approval_required": project.approval_required} if project else None,
        "owner": resource.owner_subject, "current_published_number": current, "latest_number": latest,
        "is_current": version.number == current, "newer_version": current if current and version.number < current else None,
        "version": {"number": version.number, "status": version.status.value, "title": version.title,
                    "description": version.description, "resource_type": version.resource_type,
                    "keywords": version.keywords, "creator": version.creator,
                    "version_label": version.version_label, "filename": version.original_filename,
                    "content_size": version.content_size, "media_type": version.media_type,
                    "sha256": version.sha256, "created_at": version.created_at,
                    "modified_at": version.modified_at, "published_at": version.published_at},
    }


def publish(session: Session, user: CurrentUser, resource: Resource, version: ResourceVersion) -> None:
    version.status = VersionStatus.PUBLISHED
    version.published_at = utcnow()
    resource.current_published_number = version.number
    audit(session, user, "resource.published", resource, version)


def clean_required(value: str, field: str, maximum: int) -> str:
    cleaned = value.strip()
    if not cleaned:
        api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, f"{field} darf nicht leer sein")
    if len(cleaned) > maximum:
        api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"{field} darf höchstens {maximum} Zeichen lang sein",
        )
    return cleaned


def parse_keywords(value: str) -> list[str]:
    if len(value) > 2000:
        api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "Schlagwörter sind zu lang")
    keywords = list(dict.fromkeys(item.strip() for item in value.split(",") if item.strip()))
    if len(keywords) > 50 or any(len(item) > 80 for item in keywords):
        api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Höchstens 50 Schlagwörter mit jeweils 80 Zeichen sind erlaubt",
        )
    return keywords


def upload_filename(file: UploadFile) -> str:
    filename = Path(file.filename or "upload").name
    if len(filename) > 512:
        api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "Dateiname ist zu lang")
    return filename


@app.get("/health/live", tags=["system"])
def liveness():
    return {"status": "ok"}


@app.get("/health", tags=["system"])
@app.get("/health/ready", tags=["system"])
def readiness(session: Session = Depends(get_session)):
    session.execute(select(1))
    if not settings.storage_root.exists() or not os.access(settings.storage_root, os.W_OK):
        api_error(status.HTTP_503_SERVICE_UNAVAILABLE, "Storage ist nicht schreibbar")
    return {"status": "ok"}


@app.get("/api/v1/me", response_model=MeOut, tags=["auth"])
def me(user: CurrentUser = Depends(get_current_user)):
    return {"subject": user.subject, "username": user.username, "roles": sorted(user.roles)}


@app.get("/api/v1/users", response_model=list[DirectoryUserOut], tags=["auth"])
def directory_users(user: CurrentUser = Depends(require_admin)):
    if not settings.seed_demo_data:
        return []
    return [
        {
            "subject": item.subject,
            "username": item.username,
            "display_name": item.display_name,
        }
        for item in DEMO_USERS
    ]


@app.get("/api/v1/projects", response_model=list[ProjectOut], tags=["projects"])
def list_projects(session: Session = Depends(get_session), user: CurrentUser = Depends(get_current_user)):
    projects = session.scalars(select(Project).order_by(Project.name)).all()
    return [project for project in projects if user.has("admin") or user.has("auditor") or
            project.visibility == Visibility.ORGANIZATION or membership(session, project.id, user.subject)]


@app.post("/api/v1/projects", response_model=ProjectOut, status_code=201, tags=["projects"])
def create_project(data: ProjectCreate, session: Session = Depends(get_session), user: CurrentUser = Depends(require_admin)):
    project = Project(**data.model_dump())
    session.add(project)
    audit(session, user, "project.created", details={"project": project.name})
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Projektname ist bereits vergeben") from exc
    session.refresh(project)
    return project


@app.put("/api/v1/projects/{project_id}", response_model=ProjectOut, tags=["projects"])
def update_project(project_id: str, data: ProjectCreate, session: Session = Depends(get_session), user: CurrentUser = Depends(require_admin)):
    project = project_for(session, project_id)
    for field, value in data.model_dump().items():
        setattr(project, field, value)
    audit(session, user, "project.updated", details={"project": project.name})
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Projektname ist bereits vergeben") from exc
    return project


@app.get("/api/v1/projects/{project_id}/members", response_model=list[MembershipOut], tags=["projects"])
def list_members(project_id: str, session: Session = Depends(get_session), user: CurrentUser = Depends(require_admin)):
    project_for(session, project_id)
    return session.scalars(select(ProjectMembership).where(ProjectMembership.project_id == project_id)).all()


@app.put("/api/v1/projects/{project_id}/members/{subject}", response_model=MembershipOut, tags=["projects"])
def put_member(project_id: str, subject: str, data: MembershipIn, session: Session = Depends(get_session), user: CurrentUser = Depends(require_admin)):
    if subject != data.subject:
        api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "Subject stimmt nicht mit URL überein")
    project_for(session, project_id)
    item = membership(session, project_id, subject)
    if item:
        item.role = data.role
    else:
        item = ProjectMembership(project_id=project_id, **data.model_dump())
        session.add(item)
    audit(session, user, "project.membership.updated", details={"project_id": project_id, "subject": subject, "role": data.role.value})
    session.commit()
    session.refresh(item)
    return item


@app.delete(
    "/api/v1/projects/{project_id}/members/{subject}",
    response_model=OkOut,
    tags=["projects"],
)
def delete_member(
    project_id: str,
    subject: str,
    session: Session = Depends(get_session),
    user: CurrentUser = Depends(require_admin),
):
    project_for(session, project_id)
    item = membership(session, project_id, subject)
    if item is None:
        api_error(status.HTTP_404_NOT_FOUND, "Mitgliedschaft nicht gefunden")
    session.delete(item)
    audit(
        session,
        user,
        "project.membership.deleted",
        details={"project_id": project_id, "subject": subject},
    )
    session.commit()
    return {"ok": True}


@app.post(
    "/api/v1/resources",
    response_model=ResourceOut,
    status_code=201,
    tags=["resources"],
)
async def create_resource(
    title: str = Form(...), description: str = Form(...), resource_type: str = Form(...),
    keywords: str = Form(""), version_label: str = Form("1.0"), project_id: str | None = Form(None),
    file: UploadFile = File(...), session: Session = Depends(get_session), user: CurrentUser = Depends(get_current_user),
):
    project = project_for(session, project_id)
    if project and not can_contribute_to_project(session, user, project.id):
        api_error(status.HTTP_403_FORBIDDEN, "Keine Berechtigung für dieses Projekt")
    resource = Resource(id=f"res_{uuid4().hex[:20]}", owner_subject=user.subject, project_id=project_id)
    session.add(resource)
    session.flush()
    key = f"{resource.id}/{uuid4().hex}/content"
    try:
        size, checksum, media_type = await storage.store(key, file)
        version = ResourceVersion(
            resource_id=resource.id,
            number=1,
            title=clean_required(title, "Titel", 300),
            description=clean_required(description, "Beschreibung", 20_000),
            resource_type=clean_required(resource_type, "Ressourcentyp", 100),
            keywords=parse_keywords(keywords),
            creator=user.username,
            version_label=clean_required(version_label or "1.0", "Version", 100),
            original_filename=upload_filename(file),
            storage_key=key,
            content_size=size,
            media_type=media_type,
            sha256=checksum,
        )
        session.add(version)
        audit(session, user, "resource.version.created", resource, version)
        session.commit()
    except Exception:
        session.rollback()
        storage.remove(key)
        raise
    return resource_out(session, resource, version)


@app.post(
    "/api/v1/resources/{resource_id}/versions",
    response_model=ResourceOut,
    status_code=201,
    tags=["resources"],
)
async def create_next_version(
    resource_id: str, title: str = Form(...), description: str = Form(...), resource_type: str = Form(...),
    keywords: str = Form(""), version_label: str = Form(...), file: UploadFile = File(...),
    session: Session = Depends(get_session), user: CurrentUser = Depends(get_current_user),
):
    resource = get_resource(session, resource_id)
    if not can_manage_resource(user, resource):
        api_error(status.HTTP_403_FORBIDDEN, "Nur Ersteller:in oder Admin darf eine neue Version anlegen")
    previous = latest_version(session, resource)
    if previous.status not in {VersionStatus.PUBLISHED, VersionStatus.REJECTED}:
        api_error(
            status.HTTP_409_CONFLICT,
            "Vor einer neuen Version muss der aktuelle Entwurf abgeschlossen werden",
        )
    number = previous.number + 1
    key = f"{resource.id}/{uuid4().hex}/content"
    try:
        size, checksum, media_type = await storage.store(key, file)
        version = ResourceVersion(
            resource_id=resource.id,
            number=number,
            title=clean_required(title, "Titel", 300),
            description=clean_required(description, "Beschreibung", 20_000),
            resource_type=clean_required(resource_type, "Ressourcentyp", 100),
            keywords=parse_keywords(keywords),
            creator=user.username,
            version_label=clean_required(version_label, "Version", 100),
            original_filename=upload_filename(file),
            storage_key=key,
            content_size=size,
            media_type=media_type,
            sha256=checksum,
        )
        session.add(version)
        audit(session, user, "resource.version.created", resource, version)
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        storage.remove(key)
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Eine neue Version wurde bereits parallel angelegt",
        ) from exc
    except Exception:
        session.rollback()
        storage.remove(key)
        raise
    return resource_out(session, resource, version)


@app.get("/api/v1/resources", response_model=list[ResourceOut], tags=["resources"])
def list_resources(query: str = "", project_id: str | None = None, resource_type: str | None = None,
                   session: Session = Depends(get_session), user: CurrentUser = Depends(get_current_user)):
    rows = []
    for resource in session.scalars(select(Resource).order_by(Resource.created_at.desc())).all():
        project = project_for(session, resource.project_id)
        if project_id and resource.project_id != project_id:
            continue
        version = (
            latest_version(session, resource)
            if user.has("admin") or user.has("auditor") or resource.owner_subject == user.subject
            else get_version(session, resource)
        )
        if not can_view_version_metadata(session, user, resource, project, version):
            continue
        haystack = " ".join([version.title, version.description, version.resource_type, *version.keywords]).lower()
        if query.lower() not in haystack:
            continue
        if resource_type and version.resource_type != resource_type:
            continue
        rows.append(resource_out(session, resource, version))
    return rows


@app.get(
    "/api/v1/resources/{resource_id}/versions",
    response_model=list[ResourceOut],
    tags=["resources"],
)
def list_resource_versions(
    resource_id: str,
    session: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
):
    resource = get_resource(session, resource_id)
    project = project_for(session, resource.project_id)
    versions = session.scalars(
        select(ResourceVersion)
        .where(ResourceVersion.resource_id == resource.id)
        .order_by(ResourceVersion.number.desc())
    ).all()
    return [
        resource_out(session, resource, version)
        for version in versions
        if can_view_version_metadata(session, user, resource, project, version)
    ]


@app.get(
    "/api/v1/resources/{resource_id}",
    response_model=ResourceOut,
    tags=["resources"],
)
def get_resource_detail(resource_id: str, version: int | None = Query(None), session: Session = Depends(get_session), user: CurrentUser = Depends(get_current_user)):
    resource = get_resource(session, resource_id)
    project = project_for(session, resource.project_id)
    selected = get_version(session, resource, version)
    if not can_view_version_metadata(session, user, resource, project, selected):
        api_error(status.HTTP_404_NOT_FOUND, "Ressource nicht gefunden")
    return resource_out(session, resource, selected)


@app.get(
    "/api/v1/resources/{resource_id}/versions/{number}",
    response_model=ResourceOut,
    tags=["resources"],
)
def get_resource_version_detail(
    resource_id: str,
    number: int,
    session: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
):
    return get_resource_detail(resource_id, number, session, user)


@app.post(
    "/api/v1/resources/{resource_id}/versions/{number}/submit",
    response_model=ResourceOut,
    tags=["approval"],
)
def submit(resource_id: str, number: int, session: Session = Depends(get_session), user: CurrentUser = Depends(get_current_user)):
    resource = get_resource(session, resource_id)
    version = get_version(session, resource, number)
    project = project_for(session, resource.project_id)
    if not can_manage_resource(user, resource):
        api_error(status.HTTP_403_FORBIDDEN, "Keine Berechtigung")
    if not project or not project.approval_required:
        api_error(status.HTTP_409_CONFLICT, "Für diese Ressource ist keine Freigabe erforderlich")
    if version.status != VersionStatus.DRAFT:
        api_error(status.HTTP_409_CONFLICT, "Nur Entwürfe können eingereicht werden")
    version.status = VersionStatus.PENDING
    request = ApprovalRequest(version_id=version.id, submitter_subject=user.subject)
    session.add(request)
    for item in session.scalars(select(ProjectMembership).where(
        ProjectMembership.project_id == project.id, ProjectMembership.role == MembershipRole.APPROVER)).all():
        if item.subject != user.subject:
            session.add(Notification(recipient_subject=item.subject, kind="approval_requested",
                                     message=f"Freigabe angefordert: {version.title}", resource_id=resource.id,
                                     version_number=number))
    audit(session, user, "resource.submitted_for_approval", resource, version)
    session.commit()
    return resource_out(session, resource, version)


@app.post(
    "/api/v1/resources/{resource_id}/versions/{number}/publish",
    response_model=ResourceOut,
    tags=["approval"],
)
def direct_publish(resource_id: str, number: int, session: Session = Depends(get_session), user: CurrentUser = Depends(get_current_user)):
    resource = get_resource(session, resource_id)
    version = get_version(session, resource, number)
    project = project_for(session, resource.project_id)
    if not can_manage_resource(user, resource):
        api_error(status.HTTP_403_FORBIDDEN, "Keine Berechtigung")
    if project and project.approval_required:
        api_error(status.HTTP_409_CONFLICT, "Das Projekt erfordert eine Freigabe")
    if version.status != VersionStatus.DRAFT:
        api_error(status.HTTP_409_CONFLICT, "Diese Version kann nicht veröffentlicht werden")
    publish(session, user, resource, version)
    session.commit()
    return resource_out(session, resource, version)


@app.get("/api/v1/approvals", response_model=list[ResourceOut], tags=["approval"])
def approvals(session: Session = Depends(get_session), user: CurrentUser = Depends(get_current_user)):
    if not user.has("approver") and not user.has("admin"):
        api_error(status.HTTP_403_FORBIDDEN, "Approverrechte erforderlich")
    result = []
    for request in session.scalars(select(ApprovalRequest).where(ApprovalRequest.decided_at.is_(None))).all():
        version = session.get(ResourceVersion, request.version_id)
        resource = session.get(Resource, version.resource_id)
        project = project_for(session, resource.project_id)
        allowed = is_project_approver(session, user, project)
        if allowed:
            result.append(resource_out(session, resource, version))
    return result


def decide(resource_id: str, number: int, data: DecisionIn, approved: bool, session: Session, user: CurrentUser):
    resource = get_resource(session, resource_id)
    version = get_version(session, resource, number)
    project = project_for(session, resource.project_id)
    request = session.scalar(select(ApprovalRequest).where(ApprovalRequest.version_id == version.id))
    item = membership(session, project.id, user.subject) if project else None
    if not request or version.status != VersionStatus.PENDING:
        api_error(status.HTTP_409_CONFLICT, "Keine offene Freigabe vorhanden")
    if request.submitter_subject == user.subject:
        api_error(status.HTTP_403_FORBIDDEN, "Eigene Einreichungen dürfen nicht freigegeben werden")
    if not user.has("admin") and not (user.has("approver") and item and item.role == MembershipRole.APPROVER):
        api_error(status.HTTP_403_FORBIDDEN, "Keine Freigabeberechtigung")
    if not approved and not (data.comment or "").strip():
        api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "Eine Ablehnungsbegründung ist erforderlich")
    request.decision_subject = user.subject
    request.decision_comment = data.comment
    request.decided_at = utcnow()
    if approved:
        publish(session, user, resource, version)
        action, message = "resource.approved", f"Freigegeben und veröffentlicht: {version.title}"
        audit(session, user, action, resource, version, {"comment": data.comment})
    else:
        version.status = VersionStatus.REJECTED
        reason = (data.comment or "").strip()
        action = "resource.rejected"
        message = f"Abgelehnt: {version.title} — {reason}"[:500]
        audit(session, user, action, resource, version, {"comment": data.comment})
    session.add(Notification(recipient_subject=request.submitter_subject, kind=action, message=message,
                             resource_id=resource.id, version_number=version.number))
    session.commit()
    return resource_out(session, resource, version)


@app.post(
    "/api/v1/resources/{resource_id}/versions/{number}/approve",
    response_model=ResourceOut,
    tags=["approval"],
)
def approve(resource_id: str, number: int, data: DecisionIn, session: Session = Depends(get_session), user: CurrentUser = Depends(get_current_user)):
    return decide(resource_id, number, data, True, session, user)


@app.post(
    "/api/v1/resources/{resource_id}/versions/{number}/reject",
    response_model=ResourceOut,
    tags=["approval"],
)
def reject(resource_id: str, number: int, data: DecisionIn, session: Session = Depends(get_session), user: CurrentUser = Depends(get_current_user)):
    return decide(resource_id, number, data, False, session, user)


@app.get("/api/v1/resources/{resource_id}/versions/{number}/content", tags=["content"])
def content(resource_id: str, number: int, inline: bool = False, session: Session = Depends(get_session), user: CurrentUser = Depends(get_current_user)):
    resource = get_resource(session, resource_id)
    project = project_for(session, resource.project_id)
    version = get_version(session, resource, number)
    if not can_read_version_content(session, user, resource, project, version):
        api_error(status.HTTP_404_NOT_FOUND, "Ressource nicht gefunden")
    path = storage.path(version.storage_key)
    if not path.exists():
        api_error(status.HTTP_404_NOT_FOUND, "Datei nicht gefunden")
    previewable = version.media_type in {"application/pdf", "text/plain"}
    disposition = "inline" if inline and previewable else "attachment"
    return FileResponse(
        path,
        media_type=version.media_type,
        filename=version.original_filename,
        content_disposition_type=disposition,
        headers={
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox; default-src 'none'",
            "Cross-Origin-Resource-Policy": "same-origin",
        },
    )


@app.get("/api/v1/notifications", response_model=list[NotificationOut], tags=["notifications"])
def notifications(session: Session = Depends(get_session), user: CurrentUser = Depends(get_current_user)):
    return session.scalars(select(Notification).where(Notification.recipient_subject == user.subject)
                           .order_by(Notification.created_at.desc())).all()


@app.post(
    "/api/v1/notifications/{notification_id}/read",
    response_model=OkOut,
    tags=["notifications"],
)
def read_notification(notification_id: str, session: Session = Depends(get_session), user: CurrentUser = Depends(get_current_user)):
    notification = session.get(Notification, notification_id)
    if not notification or notification.recipient_subject != user.subject:
        api_error(status.HTTP_404_NOT_FOUND, "Benachrichtigung nicht gefunden")
    notification.read = True
    session.commit()
    return {"ok": True}


@app.get("/api/v1/audit-events", response_model=list[AuditOut], tags=["audit"])
def audit_events(session: Session = Depends(get_session), user: CurrentUser = Depends(get_current_user)):
    if not user.has("admin") and not user.has("auditor"):
        api_error(status.HTTP_403_FORBIDDEN, "Auditorrechte erforderlich")
    return session.scalars(select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(500)).all()
