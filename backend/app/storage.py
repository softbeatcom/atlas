import hashlib
import mimetypes
from codecs import getincrementaldecoder
from pathlib import Path

from anyio import to_thread
from fastapi import HTTPException, UploadFile, status

from .config import settings


class LocalDirectoryStorage:
    def __init__(self, root: Path = settings.storage_root):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    async def store(self, key: str, upload: UploadFile) -> tuple[int, str, str]:
        return await to_thread.run_sync(self._store_sync, key, upload)

    def _store_sync(self, key: str, upload: UploadFile) -> tuple[int, str, str]:
        destination = self.root / key
        digest = hashlib.sha256()
        size = 0
        sample = bytearray()
        try:
            destination.parent.mkdir(parents=True, exist_ok=True)
            with destination.open("wb") as target:
                while chunk := upload.file.read(1024 * 1024):
                    size += len(chunk)
                    if size > settings.max_upload_bytes:
                        raise HTTPException(
                            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            "Datei ist größer als 100 MiB",
                        )
                    if len(sample) < 16 * 1024:
                        sample.extend(chunk[: 16 * 1024 - len(sample)])
                    digest.update(chunk)
                    target.write(chunk)
                if size == 0:
                    raise HTTPException(
                        status.HTTP_422_UNPROCESSABLE_CONTENT,
                        "Datei darf nicht leer sein",
                    )
        except OSError as exc:
            self._discard(destination)
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "Storage ist nicht schreibbar",
            ) from exc
        except Exception:
            self._discard(destination)
            raise
        return size, digest.hexdigest(), detect_media_type(upload.filename or "", bytes(sample))

    @staticmethod
    def _discard(path: Path) -> None:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass

    def path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if self.root.resolve() not in path.parents:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ungültiger Storage-Schlüssel")
        return path

    def remove(self, key: str) -> None:
        self._discard(self.path(key))


storage = LocalDirectoryStorage()


def detect_media_type(filename: str, sample: bytes) -> str:
    if sample.startswith(b"%PDF-"):
        return "application/pdf"

    guessed, _ = mimetypes.guess_type(Path(filename).name)
    if guessed in {"text/html", "application/xhtml+xml", "image/svg+xml"}:
        return "application/octet-stream"
    if guessed and guessed.startswith("text/"):
        if b"\x00" in sample:
            return "application/octet-stream"
        try:
            getincrementaldecoder("utf-8")(errors="strict").decode(sample, final=False)
        except UnicodeDecodeError:
            return "application/octet-stream"
        return "text/plain" if guessed in {"text/plain", "text/markdown"} else guessed
    return guessed or "application/octet-stream"
