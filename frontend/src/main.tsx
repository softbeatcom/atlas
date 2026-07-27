import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { keycloak } from "./auth";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

keycloak
  .init({
    onLoad: "login-required",
    pkceMethod: "S256",
    checkLoginIframe: false,
  })
  .then(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch((error) => {
    console.error("Keycloak initialization failed", error);
    root.render(
      <div className="startup-error" role="alert">
        <h1>Anmeldung nicht verfügbar</h1>
        <p>SoftBeat Atlas konnte die Anmeldung nicht starten. Bitte versuche es erneut.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Erneut versuchen
        </button>
      </div>,
    );
  });
