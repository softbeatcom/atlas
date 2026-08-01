import Keycloak from "keycloak-js";
import { config } from "./config";

export const keycloak = new Keycloak({
  url: config.keycloakUrl,
  realm: config.keycloakRealm,
  clientId: config.keycloakClientId,
});

export async function token(): Promise<string> {
  await keycloak.updateToken(30);
  if (!keycloak.token) throw new Error("Nicht angemeldet");
  return keycloak.token;
}
