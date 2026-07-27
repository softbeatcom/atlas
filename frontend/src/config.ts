type AtlasRuntimeConfig = {
  VITE_API_URL?: string;
  VITE_KEYCLOAK_URL?: string;
  VITE_KEYCLOAK_REALM?: string;
  VITE_KEYCLOAK_CLIENT_ID?: string;
};

declare global {
  interface Window {
    __ATLAS_CONFIG__?: AtlasRuntimeConfig;
  }
}

const runtime = window.__ATLAS_CONFIG__ ?? {};

export const config = {
  apiUrl:
    runtime.VITE_API_URL ??
    import.meta.env.VITE_API_URL ??
    "http://localhost:8000/api/v1",
  keycloakUrl:
    runtime.VITE_KEYCLOAK_URL ??
    import.meta.env.VITE_KEYCLOAK_URL ??
    "http://localhost:8080",
  keycloakRealm:
    runtime.VITE_KEYCLOAK_REALM ??
    import.meta.env.VITE_KEYCLOAK_REALM ??
    "atlas",
  keycloakClientId:
    runtime.VITE_KEYCLOAK_CLIENT_ID ??
    import.meta.env.VITE_KEYCLOAK_CLIENT_ID ??
    "atlas-web",
};
