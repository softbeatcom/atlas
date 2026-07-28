import os
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
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
    Dataset,
    DatasetVersion,
    DatasetVersionKeyword,
    Distribution,
    FileExtension,
    Keyword,
    MembershipRole,
    Notification,
    Project,
    ProjectMembership,
    VersionStatus,
    Visibility,
    utcnow,
)
from .policies import (
    can_contribute_to_project,
    can_manage_dataset,
    can_read_version_content,
    can_view_version_metadata,
    is_project_approver,
    membership,
)
from .schemas import (
    AuditOut,
    DatasetOut,
    DatasetSearchFacetsOut,
    DecisionIn,
    DirectoryUserOut,
    MembershipIn,
    MembershipOut,
    MeOut,
    NotificationOut,
    OkOut,
    ProjectCreate,
    ProjectOut,
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
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
            platform = Project(
                name="Platform", visibility=Visibility.ORGANIZATION, approval_required=False
            )
            session.add(platform)
            session.flush()
        _repair_demo_memberships(session)
        _ensure_membership(session, aster.id, DEMO_SUBJECTS["alice"], MembershipRole.MEMBER)
        _ensure_membership(session, aster.id, DEMO_SUBJECTS["bob"], MembershipRole.APPROVER)
        _ensure_membership(session, platform.id, DEMO_SUBJECTS["alice"], MembershipRole.MEMBER)
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


def audit(
    session: Session,
    user: CurrentUser,
    action: str,
    dataset: Dataset | None = None,
    version: DatasetVersion | None = None,
    details: dict | None = None,
) -> None:
    session.add(
        AuditEvent(
            actor_subject=user.subject,
            action=action,
            dataset_id=dataset.id if dataset else None,
            version_number=version.number if version else None,
            details=details or {},
        )
    )


def project_for(session: Session, project_id: str | None) -> Project | None:
    if not project_id:
        return None
    project = session.get(Project, project_id)
    if not project:
        api_error(status.HTTP_404_NOT_FOUND, "Projekt nicht gefunden")
    return project


def get_dataset(session: Session, dataset_id: str) -> Dataset:
    dataset = session.get(Dataset, dataset_id)
    if not dataset:
        api_error(status.HTTP_404_NOT_FOUND, "Datensatz nicht gefunden")
    return dataset


def get_version(session: Session, dataset: Dataset, number: int | None = None) -> DatasetVersion:
    if number is not None:
        version = session.scalar(
            select(DatasetVersion).where(
                DatasetVersion.dataset_id == dataset.id, DatasetVersion.number == number
            )
        )
    elif dataset.current_published_number:
        version = session.scalar(
            select(DatasetVersion).where(
                DatasetVersion.dataset_id == dataset.id,
                DatasetVersion.number == dataset.current_published_number,
            )
        )
    else:
        version = session.scalar(
            select(DatasetVersion)
            .where(DatasetVersion.dataset_id == dataset.id)
            .order_by(DatasetVersion.number.desc())
        )
    if not version:
        api_error(status.HTTP_404_NOT_FOUND, "Version nicht gefunden")
    return version


def latest_version(session: Session, dataset: Dataset) -> DatasetVersion:
    version = session.scalar(
        select(DatasetVersion)
        .where(DatasetVersion.dataset_id == dataset.id)
        .order_by(DatasetVersion.number.desc())
    )
    if not version:
        api_error(status.HTTP_404_NOT_FOUND, "Version nicht gefunden")
    return version


def dataset_out(session: Session, dataset: Dataset, version: DatasetVersion) -> dict:
    project = project_for(session, dataset.project_id)
    current = dataset.current_published_number
    latest = session.scalar(
        select(DatasetVersion.number)
        .where(DatasetVersion.dataset_id == dataset.id)
        .order_by(DatasetVersion.number.desc())
    )
    distributions = session.scalars(
        select(Distribution)
        .where(Distribution.version_id == version.id)
        .order_by(Distribution.position)
    ).all()
    keywords = version_keyword_labels(session, version.id)
    return {
        "id": dataset.id,
        "project": {
            "id": project.id,
            "name": project.name,
            "visibility": project.visibility.value,
            "approval_required": project.approval_required,
        }
        if project
        else None,
        "owner": dataset.owner_subject,
        "current_published_number": current,
        "latest_number": latest,
        "is_current": version.number == current,
        "newer_version": current if current and version.number < current else None,
        "version": {
            "number": version.number,
            "status": version.status.value,
            "title": version.title,
            "description": version.description,
            "dataset_type": version.dataset_type,
            "keywords": keywords,
            "creator": version.creator,
            "version_label": version.version_label,
            "distributions": [
                {
                    "id": item.id,
                    "position": item.position,
                    "filename": item.original_filename,
                    "content_size": item.content_size,
                    "media_type": item.media_type,
                    "sha256": item.sha256,
                }
                for item in distributions
            ],
            "distribution_count": len(distributions),
            "total_size": sum(item.content_size for item in distributions),
            "created_at": version.created_at,
            "modified_at": version.modified_at,
            "published_at": version.published_at,
        },
    }


def version_keyword_labels(session: Session, version_id: str) -> list[str]:
    return list(session.scalars(
        select(Keyword.label)
        .join(DatasetVersionKeyword, DatasetVersionKeyword.keyword_id == Keyword.id)
        .where(DatasetVersionKeyword.version_id == version_id)
        .order_by(Keyword.label)
    ).all())


def publish(session: Session, user: CurrentUser, dataset: Dataset, version: DatasetVersion) -> None:
    version.status = VersionStatus.PUBLISHED
    version.published_at = utcnow()
    dataset.current_published_number = version.number
    audit(session, user, "dataset.published", dataset, version)


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
    keywords: list[str] = []
    seen: set[str] = set()
    for item in value.split(","):
        label = item.strip()
        normalized = label.lower()
        if label and normalized not in seen:
            keywords.append(label)
            seen.add(normalized)
    if len(keywords) > 50 or any(len(item) > 80 for item in keywords):
        api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Höchstens 50 Schlagwörter mit jeweils 80 Zeichen sind erlaubt",
        )
    return keywords


def file_suffix(filename: str) -> str | None:
    if "." not in filename or filename.endswith("."):
        return None
    suffix = filename.rsplit(".", 1)[-1].strip().lower()
    return suffix or None


def ensure_keyword_links(session: Session, version: DatasetVersion, labels: list[str]) -> None:
    for label in labels:
        normalized = label.lower()
        keyword = session.scalar(select(Keyword).where(Keyword.normalized == normalized))
        if keyword is None:
            keyword = Keyword(id=str(uuid4()), normalized=normalized, label=label)
            session.add(keyword)
        session.add(DatasetVersionKeyword(version_id=version.id, keyword_id=keyword.id))


def extension_for(session: Session, filename: str) -> FileExtension | None:
    suffix = file_suffix(filename)
    if suffix is None:
        return None
    extension = session.scalar(select(FileExtension).where(FileExtension.value == suffix))
    if extension is None:
        extension = FileExtension(id=str(uuid4()), value=suffix)
        session.add(extension)
    return extension


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
def list_projects(
    session: Session = Depends(get_session), user: CurrentUser = Depends(get_current_user)
):
    projects = session.scalars(select(Project).order_by(Project.name)).all()
    return [
        project
        for project in projects
        if user.has("admin")
        or user.has("auditor")
        or project.visibility == Visibility.ORGANIZATION
        or membership(session, project.id, user.subject)
    ]


@app.post("/api/v1/projects", response_model=ProjectOut, status_code=201, tags=["projects"])
def create_project(
    data: ProjectCreate,
    session: Session = Depends(get_session),
    user: CurrentUser = Depends(require_admin),
):
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
def update_project(
    project_id: str,
    data: ProjectCreate,
    session: Session = Depends(get_session),
    user: CurrentUser = Depends(require_admin),
):
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


@app.get(
    "/api/v1/projects/{project_id}/members", response_model=list[MembershipOut], tags=["projects"]
)
def list_members(
    project_id: str,
    session: Session = Depends(get_session),
    user: CurrentUser = Depends(require_admin),
):
    project_for(session, project_id)
    return session.scalars(
        select(ProjectMembership).where(ProjectMembership.project_id == project_id)
    ).all()


@app.put(
    "/api/v1/projects/{project_id}/members/{subject}",
    response_model=MembershipOut,
    tags=["projects"],
)
def put_member(
    project_id: str,
    subject: str,
    data: MembershipIn,
    session: Session = Depends(get_session),
    user: CurrentUser = Depends(require_admin),
):
    if subject != data.subject:
        api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "Subject stimmt nicht mit URL überein")
    project_for(session, project_id)
    item = membership(session, project_id, subject)
    if item:
        item.role = data.role
    else:
        item = ProjectMembership(project_id=project_id, **data.model_dump())
        session.add(item)
    audit(
        session,
        user,
        "project.membership.updated",
        details={"project_id": project_id, "subject": subject, "role": data.role.value},
    )
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


def validate_files(files: list[UploadFile]) -> None:
    if not files:
        api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "Mindestens eine Datei ist erforderlich")
    if len(files) > 100:
        api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Ein Datensatz darf höchstens 100 Dateien enthalten",
        )
    names = [upload_filename(item) for item in files]
    if len(set(names)) != len(names):
        api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Dateinamen müssen innerhalb einer Version eindeutig sein",
        )


async def add_distributions(
    session: Session, dataset: Dataset, version: DatasetVersion, files: list[UploadFile]
) -> list[Distribution]:
    validate_files(files)
    distributions: list[Distribution] = []
    extensions: dict[str, FileExtension] = {}
    total_size = 0
    try:
        for position, file in enumerate(files, start=1):
            filename = upload_filename(file)
            suffix = file_suffix(filename)
            extension = extensions.get(suffix) if suffix else None
            if suffix and extension is None:
                extension = extension_for(session, filename)
                if extension:
                    extensions[suffix] = extension
            distribution = Distribution(
                id=str(uuid4()),
                version_id=version.id,
                position=position,
                original_filename=filename,
                storage_key="",
                content_size=0,
                media_type="",
                sha256="",
                file_extension_id=extension.id if extension else None,
            )
            key = f"{dataset.id}/{version.id}/{distribution.id}/content"
            size, checksum, media_type = await storage.store(key, file)
            total_size += size
            if total_size > settings.max_dataset_upload_bytes:
                storage.remove(key)
                raise HTTPException(
                    status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    "Die Dateien einer Version dürfen zusammen höchstens 1 GiB groß sein",
                )
            distribution.storage_key = key
            distribution.content_size = size
            distribution.media_type = media_type
            distribution.sha256 = checksum
            distributions.append(distribution)
    except Exception:
        for distribution in distributions:
            storage.remove(distribution.storage_key)
        raise
    return distributions


@app.post("/api/v1/datasets", response_model=DatasetOut, status_code=201, tags=["datasets"])
async def create_dataset(
    title: str = Form(...),
    description: str = Form(...),
    dataset_type: str = Form(...),
    keywords: str = Form(""),
    version_label: str = Form("1.0"),
    project_id: str | None = Form(None),
    files: list[UploadFile] = File(...),
    session: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
):
    project = project_for(session, project_id)
    if project and not can_contribute_to_project(session, user, project.id):
        api_error(status.HTTP_403_FORBIDDEN, "Keine Berechtigung für dieses Projekt")
    dataset = Dataset(
        id=f"ds_{uuid4().hex[:20]}", owner_subject=user.subject, project_id=project_id
    )
    version = DatasetVersion(
        id=str(uuid4()),
        dataset_id=dataset.id,
        number=1,
        title=clean_required(title, "Titel", 300),
        description=clean_required(description, "Beschreibung", 20_000),
        dataset_type=clean_required(dataset_type, "Datensatztyp", 100),
        creator=user.username,
        version_label=clean_required(version_label or "1.0", "Version", 100),
    )
    try:
        ensure_keyword_links(session, version, parse_keywords(keywords))
        distributions = await add_distributions(session, dataset, version, files)
        session.add_all([dataset, version, *distributions])
        audit(session, user, "dataset.version.created", dataset, version)
        session.commit()
    except Exception:
        session.rollback()
        for distribution in locals().get("distributions", []):
            storage.remove(distribution.storage_key)
        raise
    return dataset_out(session, dataset, version)


@app.post(
    "/api/v1/datasets/{dataset_id}/versions",
    response_model=DatasetOut,
    status_code=201,
    tags=["datasets"],
)
async def create_next_version(
    dataset_id: str,
    title: str = Form(...),
    description: str = Form(...),
    dataset_type: str = Form(...),
    keywords: str = Form(""),
    version_label: str = Form(...),
    files: list[UploadFile] = File(...),
    session: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
):
    dataset = get_dataset(session, dataset_id)
    if not can_manage_dataset(user, dataset):
        api_error(status.HTTP_403_FORBIDDEN, "Keine Berechtigung")
    previous = latest_version(session, dataset)
    if previous.status not in {VersionStatus.PUBLISHED, VersionStatus.REJECTED}:
        api_error(
            status.HTTP_409_CONFLICT,
            "Vor einer neuen Version muss der aktuelle Entwurf abgeschlossen werden",
        )
    version = DatasetVersion(
        id=str(uuid4()),
        dataset_id=dataset.id,
        number=previous.number + 1,
        title=clean_required(title, "Titel", 300),
        description=clean_required(description, "Beschreibung", 20_000),
        dataset_type=clean_required(dataset_type, "Datensatztyp", 100),
        creator=user.username,
        version_label=clean_required(version_label, "Version", 100),
    )
    try:
        ensure_keyword_links(session, version, parse_keywords(keywords))
        distributions = await add_distributions(session, dataset, version, files)
        session.add_all([version, *distributions])
        audit(session, user, "dataset.version.created", dataset, version)
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        for distribution in locals().get("distributions", []):
            storage.remove(distribution.storage_key)
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Eine neue Version wurde bereits parallel angelegt"
        ) from exc
    except Exception:
        session.rollback()
        for distribution in locals().get("distributions", []):
            storage.remove(distribution.storage_key)
        raise
    return dataset_out(session, dataset, version)


@app.get("/api/v1/datasets", response_model=list[DatasetOut], tags=["datasets"])
def list_datasets(
    query: str = "",
    title: str = "",
    project_id: list[str] = Query(default=[]),
    dataset_type: str | None = None,
    tag: list[str] = Query(default=[]),
    suffix: list[str] = Query(default=[]),
    session: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
):
    tags = {item.strip().lower() for item in tag if item.strip()}
    suffixes = {item.strip().lower().lstrip(".") for item in suffix if item.strip(".")}
    rows = []
    project_ids = set(project_id)
    for dataset in session.scalars(select(Dataset).order_by(Dataset.created_at.desc())).all():
        project = project_for(session, dataset.project_id)
        if project_ids and (
            (dataset.project_id is None and "private" not in project_ids)
            or (dataset.project_id is not None and dataset.project_id not in project_ids)
        ):
            continue
        version = (
            latest_version(session, dataset)
            if (user.has("admin") or user.has("auditor") or dataset.owner_subject == user.subject)
            else get_version(session, dataset)
        )
        if not can_view_version_metadata(session, user, dataset, project, version):
            continue
        if (
            query.lower()
            not in " ".join(
                [version.title, version.description, version.dataset_type, *version_keyword_labels(session, version.id)]
            ).lower()
        ):
            continue
        if title.lower() not in version.title.lower():
            continue
        if dataset_type and version.dataset_type != dataset_type:
            continue
        keyword_values = set(session.scalars(
            select(Keyword.normalized)
            .join(DatasetVersionKeyword, DatasetVersionKeyword.keyword_id == Keyword.id)
            .where(DatasetVersionKeyword.version_id == version.id)
        ))
        if tags and tags.isdisjoint(keyword_values):
            continue
        if suffixes:
            version_suffixes = set(session.scalars(
                select(FileExtension.value)
                .join(Distribution, Distribution.file_extension_id == FileExtension.id)
                .where(Distribution.version_id == version.id)
            ))
            if suffixes.isdisjoint(version_suffixes):
                continue
        rows.append(dataset_out(session, dataset, version))
    return rows


@app.get(
    "/api/v1/datasets/search-facets",
    response_model=DatasetSearchFacetsOut,
    tags=["datasets"],
)
def dataset_search_facets(
    session: Session = Depends(get_session), user: CurrentUser = Depends(get_current_user)
):
    projects = list_projects(session, user)
    visible_version_ids: list[str] = []
    for dataset in session.scalars(select(Dataset)).all():
        project = project_for(session, dataset.project_id)
        version = (
            latest_version(session, dataset)
            if (user.has("admin") or user.has("auditor") or dataset.owner_subject == user.subject)
            else get_version(session, dataset)
        )
        if can_view_version_metadata(session, user, dataset, project, version):
            visible_version_ids.append(version.id)

    if not visible_version_ids:
        return {"projects": projects, "keywords": [], "suffixes": []}

    keywords = session.scalars(
        select(Keyword.label)
        .join(DatasetVersionKeyword, DatasetVersionKeyword.keyword_id == Keyword.id)
        .where(DatasetVersionKeyword.version_id.in_(visible_version_ids))
        .distinct()
        .order_by(Keyword.label)
    ).all()
    suffixes = session.scalars(
        select(FileExtension.value)
        .join(Distribution, Distribution.file_extension_id == FileExtension.id)
        .where(Distribution.version_id.in_(visible_version_ids))
        .distinct()
        .order_by(FileExtension.value)
    ).all()
    return {"projects": projects, "keywords": keywords, "suffixes": suffixes}


@app.get(
    "/api/v1/datasets/{dataset_id}/versions", response_model=list[DatasetOut], tags=["datasets"]
)
def list_dataset_versions(
    dataset_id: str,
    session: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
):
    dataset = get_dataset(session, dataset_id)
    project = project_for(session, dataset.project_id)
    versions = session.scalars(
        select(DatasetVersion)
        .where(DatasetVersion.dataset_id == dataset.id)
        .order_by(DatasetVersion.number.desc())
    ).all()
    return [
        dataset_out(session, dataset, version)
        for version in versions
        if can_view_version_metadata(session, user, dataset, project, version)
    ]


def dataset_detail(
    dataset_id: str, number: int | None, session: Session, user: CurrentUser
) -> dict:
    dataset = get_dataset(session, dataset_id)
    project = project_for(session, dataset.project_id)
    version = get_version(session, dataset, number)
    if not can_view_version_metadata(session, user, dataset, project, version):
        api_error(status.HTTP_404_NOT_FOUND, "Datensatz nicht gefunden")
    return dataset_out(session, dataset, version)


@app.get("/api/v1/datasets/{dataset_id}", response_model=DatasetOut, tags=["datasets"])
def get_dataset_detail(
    dataset_id: str,
    version: int | None = Query(None),
    session: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
):
    return dataset_detail(dataset_id, version, session, user)


@app.get(
    "/api/v1/datasets/{dataset_id}/versions/{number}", response_model=DatasetOut, tags=["datasets"]
)
def get_dataset_version_detail(
    dataset_id: str,
    number: int,
    session: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
):
    return dataset_detail(dataset_id, number, session, user)


@app.post(
    "/api/v1/datasets/{dataset_id}/versions/{number}/submit",
    response_model=DatasetOut,
    tags=["approval"],
)
def submit(
    dataset_id: str,
    number: int,
    session: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
):
    dataset = get_dataset(session, dataset_id)
    version = get_version(session, dataset, number)
    project = project_for(session, dataset.project_id)
    if not can_manage_dataset(user, dataset):
        api_error(status.HTTP_403_FORBIDDEN, "Keine Berechtigung")
    if not project or not project.approval_required:
        api_error(status.HTTP_409_CONFLICT, "Für diesen Datensatz ist keine Freigabe erforderlich")
    if version.status != VersionStatus.DRAFT:
        api_error(status.HTTP_409_CONFLICT, "Nur Entwürfe können eingereicht werden")
    version.status = VersionStatus.PENDING
    session.add(ApprovalRequest(version_id=version.id, submitter_subject=user.subject))
    for item in session.scalars(
        select(ProjectMembership).where(
            ProjectMembership.project_id == project.id,
            ProjectMembership.role == MembershipRole.APPROVER,
        )
    ).all():
        if item.subject != user.subject:
            session.add(
                Notification(
                    recipient_subject=item.subject,
                    kind="approval_requested",
                    message=f"Freigabe angefordert: {version.title}",
                    dataset_id=dataset.id,
                    version_number=number,
                )
            )
    audit(session, user, "dataset.submitted_for_approval", dataset, version)
    session.commit()
    return dataset_out(session, dataset, version)


@app.post(
    "/api/v1/datasets/{dataset_id}/versions/{number}/publish",
    response_model=DatasetOut,
    tags=["approval"],
)
def direct_publish(
    dataset_id: str,
    number: int,
    session: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
):
    dataset = get_dataset(session, dataset_id)
    version = get_version(session, dataset, number)
    project = project_for(session, dataset.project_id)
    if not can_manage_dataset(user, dataset):
        api_error(status.HTTP_403_FORBIDDEN, "Keine Berechtigung")
    if project and project.approval_required:
        api_error(status.HTTP_409_CONFLICT, "Das Projekt erfordert eine Freigabe")
    if version.status != VersionStatus.DRAFT:
        api_error(status.HTTP_409_CONFLICT, "Diese Version kann nicht veröffentlicht werden")
    publish(session, user, dataset, version)
    session.commit()
    return dataset_out(session, dataset, version)


@app.get("/api/v1/approvals", response_model=list[DatasetOut], tags=["approval"])
def approvals(
    session: Session = Depends(get_session), user: CurrentUser = Depends(get_current_user)
):
    if not user.has("approver") and not user.has("admin"):
        api_error(status.HTTP_403_FORBIDDEN, "Approverrechte erforderlich")
    result = []
    for request in session.scalars(
        select(ApprovalRequest).where(ApprovalRequest.decided_at.is_(None))
    ).all():
        version = session.get(DatasetVersion, request.version_id)
        if version is None:
            continue
        dataset = session.get(Dataset, version.dataset_id)
        project = project_for(session, dataset.project_id)
        if is_project_approver(session, user, project):
            result.append(dataset_out(session, dataset, version))
    return result


def decide(
    dataset_id: str,
    number: int,
    data: DecisionIn,
    approved: bool,
    session: Session,
    user: CurrentUser,
):
    dataset = get_dataset(session, dataset_id)
    version = get_version(session, dataset, number)
    project = project_for(session, dataset.project_id)
    request = session.scalar(
        select(ApprovalRequest).where(ApprovalRequest.version_id == version.id)
    )
    item = membership(session, project.id, user.subject) if project else None
    if not request or version.status != VersionStatus.PENDING:
        api_error(status.HTTP_409_CONFLICT, "Keine offene Freigabe vorhanden")
    if request.submitter_subject == user.subject:
        api_error(status.HTTP_403_FORBIDDEN, "Eigene Einreichungen dürfen nicht freigegeben werden")
    if not user.has("admin") and not (
        user.has("approver") and item and item.role == MembershipRole.APPROVER
    ):
        api_error(status.HTTP_403_FORBIDDEN, "Keine Freigabeberechtigung")
    if not approved and not (data.comment or "").strip():
        api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Eine Ablehnungsbegründung ist erforderlich"
        )
    request.decision_subject = user.subject
    request.decision_comment = data.comment
    request.decided_at = utcnow()
    if approved:
        publish(session, user, dataset, version)
        action, message = "dataset.approved", f"Freigegeben und veröffentlicht: {version.title}"
    else:
        version.status = VersionStatus.REJECTED
        action = "dataset.rejected"
        message = f"Abgelehnt: {version.title} — {(data.comment or '').strip()}"[:500]
    audit(session, user, action, dataset, version, {"comment": data.comment})
    session.add(
        Notification(
            recipient_subject=request.submitter_subject,
            kind=action,
            message=message,
            dataset_id=dataset.id,
            version_number=version.number,
        )
    )
    session.commit()
    return dataset_out(session, dataset, version)


@app.post(
    "/api/v1/datasets/{dataset_id}/versions/{number}/approve",
    response_model=DatasetOut,
    tags=["approval"],
)
def approve(
    dataset_id: str,
    number: int,
    data: DecisionIn,
    session: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
):
    return decide(dataset_id, number, data, True, session, user)


@app.post(
    "/api/v1/datasets/{dataset_id}/versions/{number}/reject",
    response_model=DatasetOut,
    tags=["approval"],
)
def reject(
    dataset_id: str,
    number: int,
    data: DecisionIn,
    session: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
):
    return decide(dataset_id, number, data, False, session, user)


def content_response(
    dataset: Dataset,
    version: DatasetVersion,
    distribution: Distribution,
    inline: bool,
    session: Session,
    user: CurrentUser,
):
    if not can_read_version_content(
        session, user, dataset, project_for(session, dataset.project_id), version
    ):
        api_error(status.HTTP_404_NOT_FOUND, "Datensatz nicht gefunden")
    path = storage.path(distribution.storage_key)
    if not path.exists():
        api_error(status.HTTP_404_NOT_FOUND, "Datei nicht gefunden")
    return FileResponse(
        path,
        media_type=distribution.media_type,
        filename=distribution.original_filename,
        content_disposition_type="inline"
        if inline and distribution.media_type in {"application/pdf", "text/plain"}
        else "attachment",
        headers={
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox; default-src 'none'",
            "Cross-Origin-Resource-Policy": "same-origin",
        },
    )


@app.get(
    "/api/v1/datasets/{dataset_id}/versions/{number}/distributions/{distribution_id}/content",
    tags=["content"],
)
def distribution_content(
    dataset_id: str,
    number: int,
    distribution_id: str,
    inline: bool = False,
    session: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
):
    dataset = get_dataset(session, dataset_id)
    version = get_version(session, dataset, number)
    distribution = session.get(Distribution, distribution_id)
    if not distribution or distribution.version_id != version.id:
        api_error(status.HTTP_404_NOT_FOUND, "Datei nicht gefunden")
    return content_response(dataset, version, distribution, inline, session, user)


@app.get("/api/v1/datasets/{dataset_id}/versions/{number}/dcat.jsonld", tags=["dcat"])
def dcat_jsonld(
    dataset_id: str,
    number: int,
    session: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
):
    dataset = get_dataset(session, dataset_id)
    version = get_version(session, dataset, number)
    project = project_for(session, dataset.project_id)
    if not can_view_version_metadata(session, user, dataset, project, version):
        api_error(status.HTTP_404_NOT_FOUND, "Datensatz nicht gefunden")
    base = settings.public_api_url.rstrip("/")
    version_url = f"{base}/datasets/{dataset.id}/versions/{version.number}"
    distributions = session.scalars(
        select(Distribution)
        .where(Distribution.version_id == version.id)
        .order_by(Distribution.position)
    ).all()
    return JSONResponse(
        {
            "@context": {
                "dcat": "http://www.w3.org/ns/dcat#",
                "dct": "http://purl.org/dc/terms/",
                "spdx": "http://spdx.org/rdf/terms#",
            },
            "@id": version_url,
            "@type": "dcat:Dataset",
            "dct:identifier": dataset.id,
            "dct:title": version.title,
            "dct:description": version.description,
            "dcat:keyword": version_keyword_labels(session, version.id),
            "dcat:version": version.version_label,
            "dcat:distribution": [
                {
                    "@id": f"{version_url}/distributions/{item.id}",
                    "@type": "dcat:Distribution",
                    "dct:title": item.original_filename,
                    "dcat:byteSize": item.content_size,
                    "dcat:mediaType": item.media_type,
                    "spdx:checksum": {"@type": "spdx:Checksum", "spdx:checksumValue": item.sha256},
                    "dcat:downloadURL": f"{version_url}/distributions/{item.id}/content",
                }
                for item in distributions
            ],
        },
        media_type="application/ld+json",
    )


@app.get("/api/v1/notifications", response_model=list[NotificationOut], tags=["notifications"])
def notifications(
    session: Session = Depends(get_session), user: CurrentUser = Depends(get_current_user)
):
    return session.scalars(
        select(Notification)
        .where(Notification.recipient_subject == user.subject)
        .order_by(Notification.created_at.desc())
    ).all()


@app.post(
    "/api/v1/notifications/{notification_id}/read",
    response_model=OkOut,
    tags=["notifications"],
)
def read_notification(
    notification_id: str,
    session: Session = Depends(get_session),
    user: CurrentUser = Depends(get_current_user),
):
    notification = session.get(Notification, notification_id)
    if not notification or notification.recipient_subject != user.subject:
        api_error(status.HTTP_404_NOT_FOUND, "Benachrichtigung nicht gefunden")
    notification.read = True
    session.commit()
    return {"ok": True}


@app.get("/api/v1/audit-events", response_model=list[AuditOut], tags=["audit"])
def audit_events(
    session: Session = Depends(get_session), user: CurrentUser = Depends(get_current_user)
):
    if not user.has("admin") and not user.has("auditor"):
        api_error(status.HTTP_403_FORBIDDEN, "Auditorrechte erforderlich")
    return session.scalars(
        select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(500)
    ).all()
