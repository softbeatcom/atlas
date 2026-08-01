export default class KeycloakMock {
  token = "e2e-token";

  async init(): Promise<boolean> {
    return true;
  }

  async updateToken(): Promise<boolean> {
    return true;
  }

  async logout(): Promise<void> {}
}
