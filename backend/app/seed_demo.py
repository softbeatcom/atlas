from __future__ import annotations

import base64
import hashlib
import io
import json
import re
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import settings
from .database import engine
from .demo import DEMO_SUBJECTS
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
)
from .storage import detect_media_type


@dataclass(frozen=True)
class DemoSeedSummary:
    projects: int
    datasets: int
    versions: int
    files: int


@dataclass(frozen=True)
class ProjectSpec:
    name: str
    visibility: Visibility
    approval_required: bool


@dataclass(frozen=True)
class DomainSpec:
    name: str
    slug: str
    subject: str
    keywords: tuple[str, str, str]


PROJECT_SPECS = (
    ProjectSpec("Aster", Visibility.PROJECT, True),
    ProjectSpec("Platform", Visibility.ORGANIZATION, False),
    ProjectSpec("Finanzplanung", Visibility.PROJECT, True),
    ProjectSpec("Nachhaltigkeit", Visibility.ORGANIZATION, True),
    ProjectSpec("Kundenservice", Visibility.ORGANIZATION, True),
    ProjectSpec("People & Culture", Visibility.PROJECT, True),
)

DOMAINS = (
    DomainSpec(
        "Produktanalyse",
        "produktanalyse",
        "Produktnutzung, Zielgruppen und Kennzahlen für die Weiterentwicklung des Portfolios.",
        ("Produkt", "Analytics", "KPI"),
    ),
    DomainSpec(
        "Betriebssteuerung",
        "betriebssteuerung",
        "Messwerte, Kapazitäten und Qualitätsindikatoren aus dem laufenden Betrieb.",
        ("Betrieb", "Messung", "Qualität"),
    ),
    DomainSpec(
        "IT-Plattform",
        "it-plattform",
        "Technische Betriebsdaten und Schnittstellen der zentralen Plattformdienste.",
        ("Plattform", "API", "Monitoring"),
    ),
    DomainSpec(
        "Unternehmensarchitektur",
        "unternehmensarchitektur",
        "Anwendungslandschaft, Integrationen und verbindliche technische Standards.",
        ("Architektur", "Integration", "Standards"),
    ),
    DomainSpec(
        "Finanzsteuerung",
        "finanzsteuerung",
        "Planungs- und Ist-Daten für Budgetierung, Forecast und Managementberichte.",
        ("Finanzen", "Forecast", "Controlling"),
    ),
    DomainSpec(
        "Lieferkette",
        "lieferkette",
        "Lieferanten-, Bestands- und Transportdaten zur operativen Lieferfähigkeit.",
        ("Lieferkette", "Beschaffung", "Logistik"),
    ),
    DomainSpec(
        "Nachhaltigkeit",
        "nachhaltigkeit",
        "Energie-, Emissions- und ESG-Kennzahlen für die Nachhaltigkeitsberichterstattung.",
        ("Nachhaltigkeit", "CO2", "ESG"),
    ),
    DomainSpec(
        "Kundenservice",
        "kundenservice",
        "Servicevolumen, Lösungszeiten und Rückmeldungen aus den Supportkanälen.",
        ("Kundenservice", "Support", "SLA"),
    ),
    DomainSpec(
        "Personalentwicklung",
        "personalentwicklung",
        "Organisations-, Lern- und Kapazitätsdaten für die Personalentwicklung.",
        ("Personal", "Organisation", "Lernen"),
    ),
    DomainSpec(
        "Informationssicherheit",
        "informationssicherheit",
        "Kontrollen, Risiken und Nachweise aus Sicherheit und Compliance.",
        ("Sicherheit", "Compliance", "Risiko"),
    ),
)

GERMAN_KINDS = (
    ("Kennzahlenübersicht", "Bericht", "Reporting"),
    ("Monatsbericht", "Bericht", "Reporting"),
    ("Datenexport", "Datensatz", "Referenzdaten"),
    ("Prognosemodell", "Modell", "Planung"),
    ("Quality Review", "Bericht", "Analyse"),
    ("Referenzdaten", "Datensatz", "Referenzdaten"),
    ("Schnittstellenspezifikation", "Spezifikation", "Standards"),
    ("Jahresvergleich", "Datensatz", "Analyse"),
    ("Arbeitsstand", "Modell", "Planung"),
    ("Freigabepaket", "Spezifikation", "Standards"),
)

FILE_SUFFIXES = ("csv", "json", "txt", "md", "pdf", "xml", "zip", "png")
PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


class DemoSeedError(RuntimeError):
    pass


def _stable_id(kind: str, value: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"https://softbeat.example/atlas/demo/{kind}/{value}"))


def _project_name(index: int) -> str | None:
    if index <= 20:
        return "Aster"
    if index <= 40:
        return "Platform"
    if index <= 55:
        return "Finanzplanung"
    if index <= 70:
        return "Nachhaltigkeit"
    if index <= 85:
        return "Kundenservice"
    if index <= 90 or index >= 96:
        return "People & Culture"
    return None


def _owner(index: int, project_name: str | None) -> tuple[str, str]:
    if project_name == "Finanzplanung":
        return DEMO_SUBJECTS["admin"], "admin"
    if project_name is None and index >= 94:
        return DEMO_SUBJECTS["bob"], "bob"
    return DEMO_SUBJECTS["alice"], "alice"


def _latest_nonpublished_status(index: int) -> VersionStatus:
    decade = (index - 1) // 10
    if decade < 4:
        return VersionStatus.DRAFT
    if decade < 7:
        return VersionStatus.PENDING
    return VersionStatus.REJECTED


def _version_statuses(index: int) -> tuple[VersionStatus, ...]:
    remainder = index % 10
    if remainder == 8:
        return (VersionStatus.PUBLISHED, VersionStatus.PUBLISHED)
    if remainder == 9:
        return (VersionStatus.PUBLISHED, _latest_nonpublished_status(index))
    if remainder == 0:
        return (_latest_nonpublished_status(index),)
    return (VersionStatus.PUBLISHED,)


def _ensure_project(session: Session, spec: ProjectSpec) -> Project:
    project = session.scalar(select(Project).where(Project.name == spec.name))
    if project is None:
        project = Project(
            id=_stable_id("project", spec.name),
            name=spec.name,
            visibility=spec.visibility,
            approval_required=spec.approval_required,
        )
        session.add(project)
        session.flush()
    else:
        project.visibility = spec.visibility
        project.approval_required = spec.approval_required
    return project


def _ensure_membership(
    session: Session, project: Project, username: str, role: MembershipRole
) -> None:
    subject = DEMO_SUBJECTS[username]
    item = session.scalar(
        select(ProjectMembership).where(
            ProjectMembership.project_id == project.id,
            ProjectMembership.subject == subject,
        )
    )
    if item is None:
        session.add(ProjectMembership(project_id=project.id, subject=subject, role=role))
    else:
        item.role = role


def _seed_projects(session: Session) -> dict[str, Project]:
    projects = {spec.name: _ensure_project(session, spec) for spec in PROJECT_SPECS}
    for name in ("Aster", "Platform", "Nachhaltigkeit", "Kundenservice", "People & Culture"):
        _ensure_membership(session, projects[name], "alice", MembershipRole.MEMBER)
    for name in ("Aster", "Finanzplanung", "Nachhaltigkeit", "Kundenservice", "People & Culture"):
        _ensure_membership(session, projects[name], "bob", MembershipRole.APPROVER)
    session.flush()
    return projects


def _pdf_bytes(text: str) -> bytes:
    safe_text = re.sub(r"[^A-Za-z0-9 .,:;()/_-]", "?", text)[:90]
    stream = f"BT /F1 11 Tf 50 760 Td ({safe_text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"
        ),
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    content = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for number, item in enumerate(objects, start=1):
        offsets.append(len(content))
        content.extend(f"{number} 0 obj\n".encode())
        content.extend(item)
        content.extend(b"\nendobj\n")
    xref = len(content)
    content.extend(f"xref\n0 {len(objects) + 1}\n".encode())
    content.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        content.extend(f"{offset:010d} 00000 n \n".encode())
    content.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    )
    return bytes(content)


def _file_bytes(suffix: str, title: str, description: str, keywords: list[str]) -> bytes:
    if suffix == "csv":
        return f"kategorie,wert,einheit\n{keywords[0]},42,Anzahl\n{keywords[1]},17,Prozent\n".encode()
    if suffix == "json":
        return json.dumps(
            {"title": title, "description": description, "keywords": keywords, "value": 42},
            ensure_ascii=False,
            indent=2,
        ).encode()
    if suffix == "txt":
        return f"{title}\n\n{description}\n\nSchlagwörter: {', '.join(keywords)}\n".encode()
    if suffix == "md":
        heading = f"# {title}\n\n{description}\n\n## Schlagwörter\n\n- "
        return heading.encode() + "\n- ".join(keywords).encode() + b"\n"
    if suffix == "pdf":
        return _pdf_bytes(f"{title}: {description}")
    if suffix == "xml":
        return (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            f"<dataset><title>{title}</title><value>42</value></dataset>\n"
        ).encode()
    if suffix == "zip":
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("README.txt", f"{title}\n\n{description}\n")
        return buffer.getvalue()
    return PNG_1X1


def _write_file(storage_root: Path, storage_key: str, content: bytes) -> Path:
    root = storage_root.resolve()
    destination = (root / storage_key).resolve()
    if root not in destination.parents:
        raise DemoSeedError(f"Unsafe demo storage key: {storage_key}")
    if destination.exists():
        raise DemoSeedError(f"Demo storage path already exists: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(content)
    return destination


def _keyword(
    session: Session, cache: dict[str, Keyword], label: str
) -> Keyword:
    normalized = label.lower()
    item = cache.get(normalized)
    if item is None:
        item = Keyword(
            id=_stable_id("keyword", normalized),
            normalized=normalized,
            label=label,
        )
        cache[normalized] = item
        session.add(item)
    return item


def _extension(
    session: Session, cache: dict[str, FileExtension], suffix: str
) -> FileExtension:
    item = cache.get(suffix)
    if item is None:
        item = FileExtension(
            id=_stable_id("extension", suffix),
            value=suffix,
        )
        cache[suffix] = item
        session.add(item)
    return item


def _add_audit(
    session: Session,
    actor_subject: str,
    action: str,
    dataset: Dataset,
    version: DatasetVersion,
    created_at: datetime,
    details: dict | None = None,
) -> None:
    session.add(
        AuditEvent(
            actor_subject=actor_subject,
            action=action,
            dataset_id=dataset.id,
            version_number=version.number,
            details=details or {},
            created_at=created_at,
        )
    )


def _add_workflow(
    session: Session,
    dataset: Dataset,
    version: DatasetVersion,
    project: Project | None,
    owner_subject: str,
    anchor_date: datetime,
) -> None:
    created_at = version.created_at
    _add_audit(
        session,
        owner_subject,
        "dataset.version.created",
        dataset,
        version,
        created_at,
    )
    if version.status == VersionStatus.DRAFT:
        return

    if project is None or not project.approval_required:
        if version.status != VersionStatus.PUBLISHED:
            raise DemoSeedError("Non-approval demo records may only be drafts or published")
        _add_audit(
            session,
            owner_subject,
            "dataset.published",
            dataset,
            version,
            version.published_at or created_at,
        )
        return

    submitted_at = created_at + timedelta(days=1)
    decided_at = created_at + timedelta(days=2)
    approver_subject = DEMO_SUBJECTS["bob"]
    request = ApprovalRequest(
        id=_stable_id("approval", version.id),
        version_id=version.id,
        submitter_subject=owner_subject,
        submitted_at=submitted_at,
    )
    session.add(request)
    session.add(
        Notification(
            id=_stable_id("notification-requested", version.id),
            recipient_subject=approver_subject,
            kind="approval_requested",
            message=f"Freigabe angefordert: {version.title}",
            dataset_id=dataset.id,
            version_number=version.number,
            read=submitted_at < anchor_date - timedelta(days=30),
            created_at=submitted_at,
        )
    )
    _add_audit(
        session,
        owner_subject,
        "dataset.submitted_for_approval",
        dataset,
        version,
        submitted_at,
    )
    if version.status == VersionStatus.PENDING:
        return

    request.decision_subject = approver_subject
    request.decided_at = decided_at
    if version.status == VersionStatus.REJECTED:
        comment = "Bitte Datenstand und fachliche Erläuterung vor der Freigabe ergänzen."
        request.decision_comment = comment
        session.add(
            Notification(
                id=_stable_id("notification-rejected", version.id),
                recipient_subject=owner_subject,
                kind="dataset.rejected",
                message=f"Abgelehnt: {version.title} — {comment}",
                dataset_id=dataset.id,
                version_number=version.number,
                read=False,
                created_at=decided_at,
            )
        )
        _add_audit(
            session,
            approver_subject,
            "dataset.rejected",
            dataset,
            version,
            decided_at,
            {"comment": comment},
        )
        return

    request.decision_comment = "Demo-Freigabe nach fachlicher Prüfung."
    _add_audit(
        session,
        approver_subject,
        "dataset.published",
        dataset,
        version,
        decided_at,
    )
    _add_audit(
        session,
        approver_subject,
        "dataset.approved",
        dataset,
        version,
        decided_at + timedelta(minutes=1),
        {"comment": request.decision_comment},
    )
    session.add(
        Notification(
            id=_stable_id("notification-approved", version.id),
            recipient_subject=owner_subject,
            kind="dataset.approved",
            message=f"Freigegeben und veröffentlicht: {version.title}",
            dataset_id=dataset.id,
            version_number=version.number,
            read=decided_at < anchor_date - timedelta(days=30),
            created_at=decided_at,
        )
    )


def seed_demo(
    session: Session,
    storage_root: Path,
    anchor_date: datetime | None = None,
) -> DemoSeedSummary:
    if session.scalar(select(func.count()).select_from(Dataset)):
        raise DemoSeedError(
            "The database already contains datasets; use setup-demo-data.sh to reset it first."
        )

    anchor = anchor_date or datetime.now(UTC).replace(hour=12, minute=0, second=0, microsecond=0)
    if anchor.tzinfo is None:
        raise DemoSeedError("The demo anchor date must include a timezone")

    created_paths: list[Path] = []
    keyword_cache: dict[str, Keyword] = {}
    extension_cache: dict[str, FileExtension] = {}
    version_count = 0
    file_count = 0

    try:
        projects = _seed_projects(session)
        for domain in DOMAINS:
            for label in domain.keywords:
                _keyword(session, keyword_cache, label)
        for _, _, common_keyword in GERMAN_KINDS:
            _keyword(session, keyword_cache, common_keyword)
        for suffix in FILE_SUFFIXES:
            _extension(session, extension_cache, suffix)
        session.flush()

        for index in range(1, 101):
            domain = DOMAINS[(index - 1) // 10]
            kind_name, dataset_type, common_keyword = GERMAN_KINDS[(index - 1) % 10]
            english = index % 10 == 5
            title = (
                f"{domain.name} Quality Review {2024 + index % 3}"
                if english
                else f"{domain.name} – {kind_name} {2024 + index % 3}"
            )
            description = (
                f"Curated sample data for {domain.name}, including ownership, quality signals, "
                "and reusable operational context."
                if english
                else f"{domain.subject} Dieser Demo-Datensatz dokumentiert {kind_name.lower()} "
                "mit fachlicher Verantwortung, Qualitätsmerkmalen und Wiederverwendungshinweisen."
            )
            project_name = _project_name(index)
            project = projects.get(project_name) if project_name else None
            owner_subject, creator = _owner(index, project_name)
            statuses = _version_statuses(index)
            created_at = anchor - timedelta(days=(101 - index) * 4 + (len(statuses) - 1) * 45)
            dataset = Dataset(
                id=f"ds_demo_{index:03d}",
                owner_subject=owner_subject,
                project_id=project.id if project else None,
                current_published_number=None,
                created_at=created_at,
            )
            session.add(dataset)
            session.flush()

            for number, version_status in enumerate(statuses, start=1):
                version_created_at = created_at + timedelta(days=(number - 1) * 45)
                published_at = (
                    version_created_at + timedelta(days=2)
                    if version_status == VersionStatus.PUBLISHED
                    else None
                )
                version = DatasetVersion(
                    id=_stable_id("version", f"{dataset.id}-{number}"),
                    dataset_id=dataset.id,
                    number=number,
                    status=version_status,
                    title=title,
                    description=(
                        description
                        if number == 1
                        else f"{description} Aktualisierte Fassung mit konsolidierten Kennzahlen."
                    ),
                    dataset_type=dataset_type,
                    creator=creator,
                    version_label="1.0" if number == 1 else "1.1",
                    created_at=version_created_at,
                    modified_at=published_at or version_created_at,
                    published_at=published_at,
                )
                session.add(version)
                session.flush()
                version_count += 1
                labels = list(
                    {label.lower(): label for label in (*domain.keywords, common_keyword)}.values()
                )
                for label in labels:
                    keyword = _keyword(session, keyword_cache, label)
                    session.add(
                        DatasetVersionKeyword(version_id=version.id, keyword_id=keyword.id)
                    )

                distribution_total = 1 if index % 2 else 2
                for position in range(1, distribution_total + 1):
                    suffix = FILE_SUFFIXES[(index + number + position - 3) % len(FILE_SUFFIXES)]
                    filename = f"{domain.slug}_v{number}_{position}.{suffix}"
                    content = _file_bytes(suffix, title, description, labels)
                    distribution_id = _stable_id(
                        "distribution", f"{dataset.id}-{number}-{position}"
                    )
                    storage_key = f"{dataset.id}/{version.id}/{distribution_id}/content"
                    created_paths.append(_write_file(storage_root, storage_key, content))
                    extension = _extension(session, extension_cache, suffix)
                    session.add(
                        Distribution(
                            id=distribution_id,
                            version_id=version.id,
                            position=position,
                            original_filename=filename,
                            storage_key=storage_key,
                            content_size=len(content),
                            media_type=detect_media_type(filename, content[: 16 * 1024]),
                            sha256=hashlib.sha256(content).hexdigest(),
                            file_extension_id=extension.id,
                            created_at=version_created_at,
                        )
                    )
                    file_count += 1

                _add_workflow(session, dataset, version, project, owner_subject, anchor)
                if version_status == VersionStatus.PUBLISHED:
                    dataset.current_published_number = number

        session.commit()
    except Exception:
        session.rollback()
        for path in reversed(created_paths):
            path.unlink(missing_ok=True)
        raise

    return DemoSeedSummary(
        projects=len(projects),
        datasets=100,
        versions=version_count,
        files=file_count,
    )


def main() -> None:
    with Session(engine) as session:
        summary = seed_demo(session, settings.storage_root)
    print(
        "Demo data ready: "
        f"{summary.projects} projects, {summary.datasets} datasets, "
        f"{summary.versions} versions, {summary.files} files."
    )


if __name__ == "__main__":
    main()
