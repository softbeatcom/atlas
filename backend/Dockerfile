FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY pyproject.toml constraints.txt alembic.ini ./
COPY app ./app
COPY migrations ./migrations
RUN pip install --no-cache-dir -c constraints.txt .

RUN addgroup --gid 1000 atlas \
    && adduser --uid 1000 --gid 1000 --disabled-password --gecos "" atlas

USER atlas
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD python -c "from urllib.request import urlopen; urlopen('http://127.0.0.1:8000/health', timeout=2)" || exit 1
CMD ["sh", "-c", "python -m app.migrate && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers"]
