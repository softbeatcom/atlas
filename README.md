# SoftBeat Atlas MVP

**SoftBeat Atlas – FAIR repository for organizational knowledge**

SoftBeat Atlas ist ein community-orientiertes Repository für versionierte Unternehmensdatensätze. Ein Datensatzstand enthält bis zu 100 Dateien (DCAT-Distributionen), die gemeinsam geprüft und veröffentlicht werden.

SoftBeat Atlas orientiert sich an den FAIR-Prinzipien: **Findable, Accessible,
Interoperable, Reusable**. Persistent referenzierbare Datensätze, Metadaten,
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

### Interner Python-Paketmirror

Für einen normalen Build über PyPI verwende ausschließlich die
Standard-Compose-Datei; sie baut mit `backend/Dockerfile`:

```bash
docker compose up --build
```

Wenn Docker-Abhängigkeiten über einen internen Artifactory-Mirror bezogen
werden, verwende stattdessen `backend/Dockerfile.artifactory` zusammen mit dem
Compose-Override. Lege dessen `pip.conf` und das Root-CA-Zertifikat außerhalb
dieses Repositories ab und trage auf dem Docker-Host die absoluten Pfade in
`.env` ein:

```bash
PIP_CONFIG_FILE=/path/to/pip.conf
CORPORATE_CA_FILE=/path/to/company-root-ca.crt
```

Starte den Stack dann mit:

```bash
docker compose -f docker-compose.yml -f docker-compose.artifactory.yml up --build
```

Compose stellt beide Dateien nur während des Image-Builds als BuildKit-Secrets
bereit. Sie werden weder in das Image kopiert noch im Repository gespeichert.
Die `pip.conf` muss den Artifactory-`index-url` enthalten; das Zertifikat muss
PEM-formatiert sein und die Endung `.crt` haben.

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

### Umfangreichen Demo-Suchkorpus einrichten

Für die Beurteilung von Suche, Filtern, Berechtigungen und Freigabezuständen kann ein
deterministischer Demo-Korpus angelegt werden:

```bash
./setup-demo-data.sh
```

**Achtung:** Das Skript entfernt alle lokalen Atlas-Metadaten, Docker-Compose-Volumes
und Dateien unter `data/storage` unwiderruflich. Vor dem Zurücksetzen muss deshalb
`RESET` bestätigt werden. Für einen bewusst nicht-interaktiven Aufruf steht
`./setup-demo-data.sh --yes` zur Verfügung.

Das Skript startet anschließend den vollständigen Stack und erzeugt 100 Datensätze mit
120 Versionen und 180 kleinen Beispieldateien. Der Korpus enthält deutsche
Business-Metadaten mit einigen englischen Beispielen, sechs Projekte, private
Datensätze, unterschiedliche Sichtbarkeiten sowie veröffentlichte, offene, abgelehnte
und noch nicht eingereichte Stände. Die Formate CSV, JSON, Text, Markdown, PDF, XML,
ZIP und PNG ermöglichen außerdem die Beurteilung der Dateiformatfilter und Vorschauen.

Für unterschiedliche Suchperspektiven eignen sich insbesondere `alice` als
Beitragende, `bob` als Projekt-Freigeber, `admin` mit vollständigem Zugriff und
`auditor` mit organisationsweiter Metadateneinsicht ohne Zugriff auf Rohdateien.

Dateien bis 100 MiB werden unter `./data/storage` abgelegt. Aktive Formate wie HTML und SVG werden nicht inline dargestellt. Vorschauen sind auf erkanntes PDF und sicheren Klartext begrenzt.

### Storage-Berechtigungen

Compose richtet das Storage-Stammverzeichnis vor jedem Backend-Start für die feste Backend-UID/GID `1000:1000` ein. Vorhandene Unterverzeichnisse werden dabei bewusst nicht rekursiv verändert. Dateien aus einer älteren Entwicklungsfassung, die unter einer anderen UID angelegt wurden, bleiben lesbar, können aber das Anlegen einer Folgeversion verhindern. Das Backend meldet diesen Zustand als `503 Storage ist nicht schreibbar`.

### Entwicklungsdaten zurücksetzen

Die Metadaten liegen in PostgreSQL, die RDF-Projektion im benannten Volume
`rdf-data` und die Rohdateien als Host-Bind-Mount unter `./data/storage`. Das
Datei-Storage ist **kein** benanntes Docker-Volume: `docker compose down
--volumes` entfernt daher Metadaten-Datenbank und RDF-Projektion, aber nicht die
hochgeladenen Dateien.

Um nur die Rohdateien zu entfernen, ohne die Datenbank zurückzusetzen, führe
aus `atlas/` Folgendes aus:

```bash
docker compose run --rm --no-deps --user 0 backend \
  find /data/storage -mindepth 1 -delete
```

**Achtung:** Dadurch bleiben Datensatz-Metadaten in PostgreSQL erhalten, deren
Dateien nicht mehr existieren. Das eignet sich nur für gezielte Tests.

Für einen sauberen Entwicklungsreset entferne Metadaten-Datenbank und
Rohdateien gemeinsam und starte den Stack neu. **Dieser Befehl löscht alle
lokalen Metadaten und hochgeladenen Dateien unwiderruflich:**

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
.venv/bin/pip install -e '.[dev,rdf]' -c constraints.txt
DATABASE_URL=postgresql+psycopg://atlas:atlas@localhost:5432/atlas \
KEYCLOAK_ISSUER=http://localhost:8080/realms/atlas \
KEYCLOAK_JWKS_URL=http://localhost:8080/realms/atlas/protocol/openid-connect/certs \
SEED_DEMO_DATA=true \
RDF_GRAPH_ENABLED=true \
.venv/bin/python -m app.migrate
DATABASE_URL=postgresql+psycopg://atlas:atlas@localhost:5432/atlas \
KEYCLOAK_ISSUER=http://localhost:8080/realms/atlas \
KEYCLOAK_JWKS_URL=http://localhost:8080/realms/atlas/protocol/openid-connect/certs \
SEED_DEMO_DATA=true \
RDF_GRAPH_ENABLED=true \
.venv/bin/uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## Konfiguration

Kopiere für Docker Compose zuerst `.env.example` nach `.env`. Die Datei enthält die
Verbindungsdaten für PostgreSQL, die öffentlichen API- und Keycloak-URLs sowie die
Frontend-Anmeldung. Bewahre echte Zugangsdaten ausschließlich außerhalb des Repositories
auf. Das Entwicklungsfrontend liest `VITE_*`-Variablen zur Build-Zeit; das
Produktionsfrontend liest sie beim Start aus `/runtime-config.js`, sodass ein neues Image
für Konfigurationsänderungen nicht erforderlich ist.

### Erscheinungsbild

Betreibende können die Hauptfarben ohne ein neues Frontend-Image festlegen. Setze dazu in
der Compose-`.env` oder den Helm-Werten eine oder mehrere der folgenden optionalen
Variablen auf eine Hex-Farbe (`#RGB`, `#RGBA`, `#RRGGBB` oder `#RRGGBBAA`):

```dotenv
VITE_THEME_PRIMARY_COLOR=#1f6feb
VITE_THEME_PRIMARY_HOVER_COLOR=#1757b8
VITE_THEME_SIDEBAR_COLOR=#102a43
VITE_THEME_SURFACE_COLOR=#f4f8fc
VITE_THEME_ACCENT_COLOR=#79c2ff
```

`PRIMARY` steuert primäre Aktionen und Links, `SIDEBAR` die Navigation, `SURFACE` den
Seitenhintergrund und `ACCENT` die Markenmarkierung. Nicht gesetzte Werte behalten das
Atlas-Standarddesign. Wähle Farben mit ausreichendem Kontrast zu weißem Text; ungültige
Werte werden bewusst ignoriert.

Im Helm-Chart heißen die entsprechenden Werte `config.themePrimaryColor`,
`config.themePrimaryHoverColor`, `config.themeSidebarColor`, `config.themeSurfaceColor`
und `config.themeAccentColor`.

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

## Datensatz-API und DCAT

`POST /api/v1/datasets` und `POST /api/v1/datasets/{id}/versions` akzeptieren
mehrere Multipart-Felder namens `files`. Jede Version enthält den vollständigen,
unveränderlichen Dateisatz; sie übernimmt keine Dateien aus der vorherigen
Version. Pro Version gelten maximal 100 Dateien, 100 MiB je Datei und 1 GiB
insgesamt.

Für berechtigte Nutzer liefert
`GET /api/v1/datasets/{id}/versions/{number}/dcat.jsonld` den exakten Stand
als DCAT JSON-LD. Die Download-URLs bleiben ebenfalls berechtigungsgeschützt.
Setze `PUBLIC_API_URL` auf die von Nutzenden erreichbare API-Basis-URL, damit
sie außerhalb der lokalen Entwicklung korrekt sind.

Für die Integration eines exakten Datensatzstands verwende
`GET /api/v1/datasets/{id}/versions/{number}`. Beide Endpunkte erwarten einen
OIDC-Bearer-Token einer Identität mit Zugriffsrecht auf den Datensatz, zum Beispiel:

```bash
curl --fail --location \
  -H "Authorization: Bearer $ATLAS_ACCESS_TOKEN" \
  "https://atlas.example/api/v1/datasets/ds_example/versions/1"
```

Speichere Tokens nicht im Quellcode oder in Pipeline-Definitionen. Verwende für
unbeaufsichtigte Abläufe eine entsprechend berechtigte OIDC-Identität und einen
sicheren Secret-Speicher.

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
