from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://atlas:atlas@localhost:5432/atlas"
    storage_root: Path = Path("../data/storage")
    cors_origins: str = "http://localhost:5173"
    keycloak_issuer: str = "http://localhost:8080/realms/atlas"
    keycloak_jwks_url: str | None = None
    keycloak_audience: str = "atlas-api"
    keycloak_algorithm: str = "RS256"
    jwks_cache_seconds: int = 300
    max_upload_bytes: int = 100 * 1024 * 1024
    max_dataset_upload_bytes: int = 1024 * 1024 * 1024
    public_api_url: str = "http://localhost:8000/api/v1"
    seed_demo_data: bool = False

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
