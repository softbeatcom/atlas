from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.auth import CurrentUser
from app.database import Base
from app.main import publish
from app.models import (
    AuditEvent,
    Dataset,
    DatasetVersion,
    Distribution,
    MembershipRole,
    Project,
    ProjectMembership,
    VersionStatus,
    Visibility,
)
from app.policies import can_read_content, can_read_version_content, can_view_metadata


def session_with_dataset():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    session = Session(engine)
    project = Project(name="Aster", visibility=Visibility.PROJECT, approval_required=True)
    session.add(project)
    session.flush()
    dataset = Dataset(id="ds_test", owner_subject="sub-alice", project_id=project.id)
    version = DatasetVersion(
        id="version-1",
        dataset_id=dataset.id,
        number=1,
        title="Bericht",
        description="Test",
        dataset_type="report",
        keywords=["test"],
        creator="alice",
        version_label="1.0",
    )
    distribution = Distribution(
        id="file-1",
        version_id=version.id,
        position=1,
        original_filename="test.txt",
        storage_key="ds_test/1/test.txt",
        content_size=4,
        media_type="text/plain",
        sha256="0" * 64,
    )
    session.add_all(
        [
            dataset,
            version,
            distribution,
            ProjectMembership(project_id=project.id, subject="sub-bob", role=MembershipRole.MEMBER),
        ]
    )
    session.commit()
    return session, project, dataset, version


def user(subject, *roles):
    return CurrentUser(subject, subject, frozenset(roles))


def test_members_can_read_dataset_but_auditors_cannot_read_files():
    session, project, dataset, version = session_with_dataset()
    assert can_view_metadata(session, user("sub-bob", "user"), dataset, project)
    assert can_read_content(session, user("sub-bob", "user"), dataset, project)
    assert not can_read_content(session, user("auditor", "auditor"), dataset, project)
    version.status = VersionStatus.PENDING
    membership = session.scalar(
        select(ProjectMembership).where(ProjectMembership.subject == "sub-bob")
    )
    membership.role = MembershipRole.APPROVER
    assert can_read_version_content(
        session, user("sub-bob", "user", "approver"), dataset, project, version
    )


def test_publishing_marks_current_version_and_audits_dataset():
    session, _, dataset, version = session_with_dataset()
    publish(session, user("bob", "approver"), dataset, version)
    session.commit()
    assert dataset.current_published_number == 1
    assert version.status == VersionStatus.PUBLISHED
    assert session.scalar(select(AuditEvent)).action == "dataset.published"
