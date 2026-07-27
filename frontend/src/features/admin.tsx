import { useMemo, useState } from "react";
import { api } from "../api";
import type {
  DirectoryUser,
  Membership,
  MembershipRole,
  Project,
} from "../types";

export function AdminProjects({
  projects,
  users,
  onReload,
  onError,
}: {
  projects: Project[];
  users: DirectoryUser[];
  onReload: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [selected, setSelected] = useState<Project | null>(null);
  const [members, setMembers] = useState<Membership[]>([]);
  const [busy, setBusy] = useState(false);
  const usersBySubject = useMemo(
    () => new Map(users.map((user) => [user.subject, user])),
    [users],
  );

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    try {
      await api.createProject({
        name: form.get("name"),
        visibility: form.get("visibility"),
        approval_required: form.get("approval_required") === "on",
      });
      await onReload();
      formElement.reset();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Projekt konnte nicht angelegt werden");
    } finally {
      setBusy(false);
    }
  };

  const choose = async (project: Project) => {
    setBusy(true);
    try {
      setSelected(project);
      setMembers(await api.members(project.id));
    } catch (error) {
      onError(error instanceof Error ? error.message : "Mitglieder konnten nicht geladen werden");
    } finally {
      setBusy(false);
    }
  };

  const update = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const updated = await api.updateProject(selected.id, {
        name: form.get("name"),
        visibility: form.get("visibility"),
        approval_required: form.get("approval_required") === "on",
      });
      setSelected(updated);
      await onReload();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Projekt konnte nicht aktualisiert werden");
    } finally {
      setBusy(false);
    }
  };

  const addMember = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const subject = String(form.get("subject") ?? "");
    const role = String(form.get("role") ?? "member") as MembershipRole;
    setBusy(true);
    try {
      await api.putMember(selected.id, subject, role);
      setMembers(await api.members(selected.id));
      formElement.reset();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Mitglied konnte nicht gespeichert werden");
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (subject: string) => {
    if (!selected) return;
    setBusy(true);
    try {
      await api.removeMember(selected.id, subject);
      setMembers(await api.members(selected.id));
    } catch (error) {
      onError(error instanceof Error ? error.message : "Mitglied konnte nicht entfernt werden");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="eyebrow">Verwaltung</div>
      <h1>Projekte und Zugriffe</h1>
      <div className="admin-grid">
        <section className="card form">
          <h2>Neues Projekt</h2>
          <form onSubmit={create}>
            <label>
              Name
              <input name="name" minLength={2} maxLength={160} required />
            </label>
            <label>
              Sichtbarkeit
              <select name="visibility">
                <option value="project">Projektintern</option>
                <option value="organization">Organisationsweit</option>
              </select>
            </label>
            <label className="check">
              <input name="approval_required" type="checkbox" defaultChecked />
              Freigabe erforderlich
            </label>
            <button className="primary" disabled={busy}>
              Projekt anlegen
            </button>
          </form>

          <h2>Bestehende Projekte</h2>
          {projects.map((project) => (
            <button
              className="project-row"
              type="button"
              aria-pressed={selected?.id === project.id}
              onClick={() => choose(project)}
              key={project.id}
            >
              {project.name}
              <small>
                {project.visibility} ·{" "}
                {project.approval_required ? "Freigabe" : "direkt"}
              </small>
            </button>
          ))}
        </section>

        <section className="card form">
          <h2>{selected ? `${selected.name} bearbeiten` : "Projekt auswählen"}</h2>
          {selected && (
            <>
              <form onSubmit={update}>
                <label>
                  Name
                  <input
                    name="name"
                    required
                    minLength={2}
                    maxLength={160}
                    defaultValue={selected.name}
                    key={`${selected.id}-name`}
                  />
                </label>
                <label>
                  Sichtbarkeit
                  <select
                    name="visibility"
                    defaultValue={selected.visibility}
                    key={`${selected.id}-visibility`}
                  >
                    <option value="project">Projektintern</option>
                    <option value="organization">Organisationsweit</option>
                  </select>
                </label>
                <label className="check">
                  <input
                    name="approval_required"
                    type="checkbox"
                    defaultChecked={selected.approval_required}
                    key={`${selected.id}-approval`}
                  />
                  Freigabe erforderlich
                </label>
                <button className="secondary" disabled={busy}>
                  Einstellungen speichern
                </button>
              </form>

              <h2>Mitglieder</h2>
              <form onSubmit={addMember}>
                {users.length > 0 ? (
                  <label>
                    Benutzer:in
                    <select name="subject" required defaultValue="">
                      <option value="" disabled>
                        Benutzer:in auswählen
                      </option>
                      {users.map((user) => (
                        <option value={user.subject} key={user.subject}>
                          {user.display_name} ({user.username})
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label>
                    OIDC-Subject
                    <input name="subject" required />
                  </label>
                )}
                <label>
                  Projektrolle
                  <select name="role">
                    <option value="member">Mitglied</option>
                    <option value="approver">Approver</option>
                  </select>
                </label>
                <button className="primary" disabled={busy}>
                  Mitglied speichern
                </button>
              </form>

              <div className="member-list">
                {members.map((member) => {
                  const directoryUser = usersBySubject.get(member.subject);
                  return (
                    <div className="member-row" key={member.id}>
                      <span>
                        <b>{directoryUser?.display_name ?? member.subject}</b>
                        <small>
                          {directoryUser?.username
                            ? `@${directoryUser.username} · `
                            : ""}
                          {member.role}
                        </small>
                      </span>
                      <button
                        className="text-danger"
                        type="button"
                        disabled={busy}
                        aria-label={`${directoryUser?.display_name ?? member.subject} entfernen`}
                        onClick={() => removeMember(member.subject)}
                      >
                        Entfernen
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
