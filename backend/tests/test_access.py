from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.auth import CurrentUser
from app.database import Base
from app.main import publish
from app.models import (
    AuditEvent,
    MembershipRole,
    Project,
    ProjectMembership,
    Resource,
    ResourceVersion,
    VersionStatus,
    Visibility,
)
from app.policies import (
    can_read_content,
    can_read_version_content,
    can_view_metadata,
)


def setup_session():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    return Session(engine)


def resource(session, visibility=Visibility.PROJECT):
    project = Project(name="Aster", visibility=visibility, approval_required=True)
    session.add(project)
    session.flush()
    item = Resource(id="res_test", owner_subject="sub-alice", project_id=project.id)
    version = ResourceVersion(
        resource_id=item.id,
        number=1,
        title="Bericht",
        description="Test",
        resource_type="report",
        keywords=["test"],
        creator="alice",
        version_label="1.0",
        original_filename="test.txt",
        storage_key="res_test/1/content",
        content_size=4,
        media_type="text/plain",
        sha256="0" * 64,
    )
    session.add_all(
        [
            item,
            version,
            ProjectMembership(
                project_id=project.id,
                subject="sub-bob",
                role=MembershipRole.MEMBER,
            ),
        ]
    )
    session.commit()
    return project, item, version


def user(subject, *roles):
    return CurrentUser(subject, subject, frozenset(roles))


def test_project_member_can_read_but_outsider_cannot():
    session = setup_session()
    project, item, _ = resource(session)
    assert can_view_metadata(session, user("sub-bob", "user"), item, project)
    assert can_read_content(session, user("sub-bob", "user"), item, project)
    assert not can_view_metadata(session, user("eve", "user"), item, project)
    assert not can_read_content(session, user("eve", "user"), item, project)


def test_auditor_sees_metadata_but_not_file_content():
    session = setup_session()
    project, item, _ = resource(session)
    assert can_view_metadata(session, user("auditor", "auditor"), item, project)
    assert not can_read_content(session, user("auditor", "auditor"), item, project)


def test_project_approver_can_read_pending_content_but_global_outsider_cannot():
    session = setup_session()
    project, item, version = resource(session)
    version.status = VersionStatus.PENDING
    membership = session.scalar(
        select(ProjectMembership).where(ProjectMembership.subject == "sub-bob")
    )
    membership.role = MembershipRole.APPROVER
    session.commit()

    assert can_read_version_content(
        session,
        user("sub-bob", "user", "approver"),
        item,
        project,
        version,
    )
    assert not can_read_version_content(
        session,
        user("sub-eve", "user", "approver"),
        item,
        project,
        version,
    )
    assert not can_read_version_content(
        session,
        user("sub-auditor", "user", "auditor"),
        item,
        project,
        version,
    )


def test_publishing_marks_current_version_and_creates_audit_event():
    session = setup_session()
    _, item, version = resource(session)
    publish(session, user("bob", "approver"), item, version)
    session.commit()
    assert item.current_published_number == 1
    assert version.status == VersionStatus.PUBLISHED
    event = session.scalar(select(AuditEvent))
    assert event is not None
    assert event.action == "resource.published"
