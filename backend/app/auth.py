from dataclasses import dataclass
from threading import Lock
from time import monotonic

import requests
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from .config import settings

bearer = HTTPBearer(auto_error=False)
_jwks_cache: dict | None = None
_jwks_expires_at = 0.0
_jwks_lock = Lock()


@dataclass(frozen=True)
class CurrentUser:
    subject: str
    username: str
    roles: frozenset[str]

    def has(self, role: str) -> bool:
        return role in self.roles


def jwks(force_refresh: bool = False) -> dict:
    global _jwks_cache, _jwks_expires_at

    with _jwks_lock:
        if not force_refresh and _jwks_cache is not None and monotonic() < _jwks_expires_at:
            return _jwks_cache
        url = settings.keycloak_jwks_url or (
            f"{settings.keycloak_issuer}/protocol/openid-connect/certs"
        )
        response = requests.get(url, timeout=5)
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload.get("keys"), list):
            raise requests.RequestException("JWKS response does not contain keys")
        _jwks_cache = payload
        _jwks_expires_at = monotonic() + settings.jwks_cache_seconds
        return payload


def unauthorized(detail: str = "Ungültiges Zugangstoken") -> HTTPException:
    return HTTPException(
        status.HTTP_401_UNAUTHORIZED,
        detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def signing_key(header: dict) -> dict:
    if header.get("alg") != settings.keycloak_algorithm:
        raise JWTError("Unexpected signing algorithm")
    kid = header.get("kid")
    if not isinstance(kid, str) or not kid:
        raise JWTError("Missing key id")
    for force_refresh in (False, True):
        key = next((item for item in jwks(force_refresh)["keys"] if item.get("kid") == kid), None)
        if key is not None:
            return key
    raise JWTError("Unknown signing key")


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> CurrentUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise unauthorized("Anmeldung erforderlich")
    token = credentials.credentials
    try:
        header = jwt.get_unverified_header(token)
        key = signing_key(header)
        payload = jwt.decode(
            token,
            key,
            algorithms=[settings.keycloak_algorithm],
            issuer=settings.keycloak_issuer,
            audience=settings.keycloak_audience,
            options={"require_exp": True, "require_sub": True},
        )
        subject = payload["sub"]
        if not isinstance(subject, str) or not subject:
            raise JWTError("Missing subject")
    except (JWTError, KeyError, TypeError, requests.RequestException) as exc:
        raise unauthorized() from exc
    roles = frozenset(payload.get("realm_access", {}).get("roles", []))
    return CurrentUser(subject, payload.get("preferred_username", subject), roles)


def require_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not user.has("admin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Adminrechte erforderlich")
    return user
