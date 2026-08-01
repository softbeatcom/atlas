import hashlib
from io import BytesIO
from pathlib import Path

import pytest
from fastapi import HTTPException, UploadFile

from app.storage import LocalDirectoryStorage, detect_media_type


def test_preview_media_types_are_derived_from_safe_content():
    assert detect_media_type("report.pdf", b"%PDF-1.7\n") == "application/pdf"
    assert detect_media_type("notes.txt", b"Hallo") == "text/plain"


def test_active_or_binary_text_is_not_previewable():
    assert detect_media_type("attack.html", b"<script>alert(1)</script>") == (
        "application/octet-stream"
    )
    assert detect_media_type("attack.svg", b"<svg onload='alert(1)'/>") == (
        "application/octet-stream"
    )
    assert detect_media_type("fake.txt", b"text\x00binary") == "application/octet-stream"


def test_empty_upload_is_rejected_and_removed(tmp_path):
    local = LocalDirectoryStorage(tmp_path)
    upload = UploadFile(filename="empty.txt", file=BytesIO())

    with pytest.raises(HTTPException) as error:
        local._store_sync("resource/content", upload)

    assert error.value.status_code == 422
    assert not (tmp_path / "resource/content").exists()


def test_nested_version_upload_is_stored_with_checksum(tmp_path):
    local = LocalDirectoryStorage(tmp_path)
    upload = UploadFile(filename="report.txt", file=BytesIO(b"second version"))

    size, checksum, media_type = local._store_sync(
        "resource/version/content",
        upload,
    )

    assert size == 14
    assert checksum == hashlib.sha256(b"second version").hexdigest()
    assert media_type == "text/plain"
    assert (tmp_path / "resource/version/content").read_bytes() == b"second version"


def test_permission_error_returns_service_unavailable(tmp_path, monkeypatch):
    local = LocalDirectoryStorage(tmp_path)
    upload = UploadFile(filename="report.txt", file=BytesIO(b"content"))
    original_mkdir = Path.mkdir

    def deny_resource_directory(path, *args, **kwargs):
        if path != tmp_path:
            raise PermissionError("permission denied")
        return original_mkdir(path, *args, **kwargs)

    monkeypatch.setattr(Path, "mkdir", deny_resource_directory)

    with pytest.raises(HTTPException) as error:
        local._store_sync("resource/version/content", upload)

    assert error.value.status_code == 503
    assert error.value.detail == "Storage ist nicht schreibbar"
