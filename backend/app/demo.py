from dataclasses import dataclass


@dataclass(frozen=True)
class DemoUser:
    subject: str
    username: str
    display_name: str


DEMO_USERS = (
    DemoUser("00000000-0000-4000-8000-000000000001", "admin", "Admin"),
    DemoUser("00000000-0000-4000-8000-000000000002", "alice", "Alice"),
    DemoUser("00000000-0000-4000-8000-000000000003", "bob", "Bob"),
    DemoUser("00000000-0000-4000-8000-000000000004", "auditor", "Auditor"),
)

DEMO_SUBJECTS = {user.username: user.subject for user in DEMO_USERS}
