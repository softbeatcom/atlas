type AtlasRuntimeConfig = {
  VITE_API_URL?: string;
  VITE_KEYCLOAK_URL?: string;
  VITE_KEYCLOAK_REALM?: string;
  VITE_KEYCLOAK_CLIENT_ID?: string;
  VITE_THEME_PRIMARY_COLOR?: string;
  VITE_THEME_PRIMARY_HOVER_COLOR?: string;
  VITE_THEME_SIDEBAR_COLOR?: string;
  VITE_THEME_SURFACE_COLOR?: string;
  VITE_THEME_ACCENT_COLOR?: string;
};

declare global {
  interface Window {
    __ATLAS_CONFIG__?: AtlasRuntimeConfig;
  }
}

const runtime = window.__ATLAS_CONFIG__ ?? {};

function themeColor(value: string | undefined): string | undefined {
  return value?.trim().match(/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i)
    ? value.trim()
    : undefined;
}

function configuredThemeColor(name: keyof AtlasRuntimeConfig): string | undefined {
  return themeColor(runtime[name] ?? import.meta.env[name]);
}

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
  theme: {
    primary: configuredThemeColor("VITE_THEME_PRIMARY_COLOR"),
    primaryHover: configuredThemeColor("VITE_THEME_PRIMARY_HOVER_COLOR"),
    sidebar: configuredThemeColor("VITE_THEME_SIDEBAR_COLOR"),
    surface: configuredThemeColor("VITE_THEME_SURFACE_COLOR"),
    accent: configuredThemeColor("VITE_THEME_ACCENT_COLOR"),
  },
};
