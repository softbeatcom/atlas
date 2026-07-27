from datetime import UTC, datetime, timedelta

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from jose import JWTError, jwt

from app import auth
from app.config import settings


@pytest.fixture(scope="module")
def signing_keys():
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    public_pem = private.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return private_pem, public_pem


def access_token(private_key: bytes, **overrides) -> str:
    payload = {
        "sub": "00000000-0000-4000-8000-000000000002",
        "preferred_username": "alice",
        "iss": settings.keycloak_issuer,
        "aud": settings.keycloak_audience,
        "exp": datetime.now(UTC) + timedelta(minutes=5),
        "realm_access": {"roles": ["user"]},
    }
    payload.update(overrides)
    return jwt.encode(
        payload,
        private_key,
        algorithm=settings.keycloak_algorithm,
        headers={"kid": "test"},
    )


def credentials(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def test_valid_token_uses_subject_as_canonical_identity(monkeypatch, signing_keys):
    private, public = signing_keys
    monkeypatch.setattr(auth, "signing_key", lambda _: public)

    user = auth.get_current_user(credentials(access_token(private)))

    assert user.subject == "00000000-0000-4000-8000-000000000002"
    assert user.username == "alice"
    assert user.roles == frozenset({"user"})


def test_wrong_audience_is_rejected(monkeypatch, signing_keys):
    private, public = signing_keys
    monkeypatch.setattr(auth, "signing_key", lambda _: public)

    with pytest.raises(HTTPException) as error:
        auth.get_current_user(credentials(access_token(private, aud="another-api")))

    assert error.value.status_code == 401
    assert error.value.headers == {"WWW-Authenticate": "Bearer"}


def test_missing_credentials_are_rejected():
    with pytest.raises(HTTPException) as error:
        auth.get_current_user(None)
    assert error.value.status_code == 401


def test_unexpected_algorithm_is_rejected_before_key_lookup():
    with pytest.raises(JWTError):
        auth.signing_key({"alg": "HS256", "kid": "test"})
