# SoftBeat Atlas MVP

**SoftBeat Atlas – FAIR repository for organizational knowledge**

SoftBeat Atlas ist ein community-orientiertes Repository für versionierte Unternehmensressourcen. Der MVP umfasst Projektrechte, lokale Dateiablage, Metadatensuche, Freigabe mit Vier-Augen-Prinzip, Benachrichtigungen, Audit-Ereignisse und stabile Versions-URLs.

SoftBeat Atlas orientiert sich an den FAIR-Prinzipien: **Findable, Accessible,
Interoperable, Reusable**. Persistent referenzierbare Ressourcen, Metadaten,
kontrollierter Zugriff und semantische Erweiterungen sollen Wissen für Menschen
und Maschinen auffindbar und wiederverwendbar machen. FAIR ist dabei ein
Entwicklungsziel und keine formale Zertifizierung. Siehe die [FAIR-Prinzipien
von GO FAIR](https://www.go-fair.org/fair-principles/).

Der Quellcode steht unter Apache-2.0. SoftBeat Atlas kann selbst betrieben oder
als gehosteter Dienst mit Support, Betrieb und Integrationen angeboten werden.

## Lokal mit Docker starten

Voraussetzungen sind Docker mit Compose-Unterstützung und die freien Ports 5173, 8000 und 8080.

```bash
cp .env.example .env
docker compose up --build
```

Danach stehen folgende Endpunkte bereit:

- Anwendung: `http://localhost:5173`
- API-Dokumentation: `http://localhost:8000/docs`
- Keycloak: `http://localhost:8080`

Compose startet PostgreSQL, Keycloak, Backend und das statisch gebaute Frontend. Das Backend führt ausstehende Alembic-Migrationen vor dem Start automatisch aus. Ein Schema, das mit einer älteren Atlas-Version über `create_all` erzeugt wurde, wird als Ausgangsversion erkannt und anschließend migriert.

### Health-Check-Einträge im Log

Docker Compose prüft Backend und Frontend alle fünf Sekunden über `/health` beziehungsweise `/healthz`. Im Backend-Log erscheinen deshalb regelmäßig erfolgreiche Zugriffe wie:

```text
INFO: 127.0.0.1:45142 - "GET /health HTTP/1.1" 200 OK
```

Die wechselnde Zahl hinter `127.0.0.1` ist der kurzlebige lokale Quellport der jeweiligen Prüfanfrage, nicht der Port des Backend-Dienstes. Das Backend lauscht weiterhin auf Port 8000. Solche Einträge mit Status `200 OK` sind erwartbar; wiederholte Fehler, Zeitüberschreitungen oder ein Containerstatus `unhealthy` weisen dagegen auf ein Problem hin.

Der Demo-Realm enthält diese Nutzer:

| Nutzer | Passwort | Rolle |
|---|---|---|
| `admin` | `password` | Administration und Freigabe |
| `alice` | `password` | Projektmitglied |
| `bob` | `password` | Projekt-Approver |
| `auditor` | `password` | Metadaten und Audit-Log |

Die Demo-Zugangsdaten, Keycloak `start-dev` und die lokalen Standardpasswörter sind ausschließlich für die lokale Entwicklung vorgesehen.

Dateien bis 100 MiB werden unter `./data/storage` abgelegt. Aktive Formate wie HTML und SVG werden nicht inline dargestellt. Vorschauen sind auf erkanntes PDF und sicheren Klartext begrenzt.

### Storage-Berechtigungen

Compose richtet das Storage-Stammverzeichnis vor jedem Backend-Start für die feste Backend-UID/GID `1000:1000` ein. Vorhandene Unterverzeichnisse werden dabei bewusst nicht rekursiv verändert. Dateien aus einer älteren Entwicklungsfassung, die unter einer anderen UID angelegt wurden, bleiben lesbar, können aber das Anlegen einer Folgeversion verhindern. Das Backend meldet diesen Zustand als `503 Storage ist nicht schreibbar`.

### Entwicklungsdaten zurücksetzen

Die Rohdateien liegen als Host-Bind-Mount in `./data/storage`; sie sind **kein**
benanntes Docker-Volume. `docker compose down --volumes` entfernt deshalb die
PostgreSQL-Daten, aber nicht die hochgeladenen Dateien.

Um nur die Rohdateien zu entfernen, ohne die Datenbank zurückzusetzen, führe
aus `atlas/` Folgendes aus:

```bash
docker compose run --rm --no-deps --user 0 backend \
  find /data/storage -mindepth 1 -delete
```

**Achtung:** Dadurch bleiben Ressourcen-Metadaten in PostgreSQL erhalten, deren
Dateien nicht mehr existieren. Das eignet sich nur für gezielte Tests.

Für einen sauberen Entwicklungsreset entferne Datenbank und Rohdateien
gemeinsam und starte den Stack neu:

```bash
docker compose down --volumes
docker compose run --rm --no-deps --user 0 backend \
  find /data/storage -mindepth 1 -delete
docker compose up --build
```

## Docker-Deployment stoppen

Führe im Verzeichnis `atlas` folgenden Befehl aus:

```bash
docker compose down
```

Die PostgreSQL-Daten im benannten Volume `postgres-data` und die Dateien unter `./data/storage` bleiben erhalten.

Für einen vollständigen Neustart **ohne PostgreSQL-Daten**:

```bash
docker compose down --volumes
```

Die Dateien unter `./data/storage` werden auch dadurch nicht gelöscht und müssen bei Bedarf bewusst separat gesichert oder entfernt werden.

## Entwicklung ohne vollständigen Compose-Stack

PostgreSQL und Keycloak können separat gestartet werden:

```bash
docker compose up postgres keycloak
```

Backend:

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]' -c constraints.txt
DATABASE_URL=postgresql+psycopg://atlas:atlas@localhost:5432/atlas \
KEYCLOAK_ISSUER=http://localhost:8080/realms/atlas \
KEYCLOAK_JWKS_URL=http://localhost:8080/realms/atlas/protocol/openid-connect/certs \
SEED_DEMO_DATA=true \
.venv/bin/python -m app.migrate
DATABASE_URL=postgresql+psycopg://atlas:atlas@localhost:5432/atlas \
KEYCLOAK_ISSUER=http://localhost:8080/realms/atlas \
KEYCLOAK_JWKS_URL=http://localhost:8080/realms/atlas/protocol/openid-connect/certs \
SEED_DEMO_DATA=true \
.venv/bin/uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Das Entwicklungsfrontend liest die `VITE_*`-Variablen zur Build-Zeit. Das Produktionsfrontend liest dieselben Werte zur Laufzeit aus `/runtime-config.js`.

## Qualitätssicherung

Backend:

```bash
cd backend
.venv/bin/ruff check app tests migrations
.venv/bin/pytest -q
```

Frontend:

```bash
cd frontend
npm run check
npm test
npx playwright install chromium  # einmalig pro Entwicklungsumgebung
npm run test:e2e
# oder alle Frontend-Suites:
npm run test:all
npm audit
```

`npm test` führt die Vitest-Komponententests sowie den Test des
Produktionsservers aus. `npm run test:e2e` startet ausschließlich einen lokalen
Vite-Server und mockt Authentifizierung und API in Playwright. Die E2E-Tests
benötigen deshalb weder Docker noch PostgreSQL oder Keycloak.

Migrationen lassen sich ohne PostgreSQL-Verbindung als SQL prüfen:

```bash
cd backend
.venv/bin/alembic upgrade head --sql
```

## Produktionskonfiguration

Das Helm-Chart unter `infra/helm` erwartet:

- eine externe PostgreSQL-Datenbank;
- einen vorhandenen Kubernetes-Secret mit der Datenbank-URL;
- einen produktiv betriebenen OIDC-/Keycloak-Endpunkt;
- gültige öffentliche URLs für API, Frontend-CORS und Keycloak;
- eine StorageClass oder einen vorhandenen PersistentVolumeClaim.

Die relevanten Werte stehen in `infra/helm/values.yaml`; `values.schema.json` validiert den grundlegenden Vertrag. Das Backend ist wegen des lokalen `ReadWriteOnce`-Storages bewusst auf eine Replik begrenzt. Für horizontale Skalierung muss zuerst ein gemeinsam nutzbarer Storage-Adapter, beispielsweise S3, eingeführt werden.

## Weitere Dokumentation

- Vollständiger Review: [`PROJECT_REVIEW.md`](PROJECT_REVIEW.md)
- Umgesetzte Verbesserungen und verbleibende Punkte: [`IMPLEMENTATION_NOTES.md`](IMPLEMENTATION_NOTES.md)
- Fachliche Abnahmekriterien: [`storycards/`](storycards/)
