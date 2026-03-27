"""
Shared database connection helper for Qolify ingestion scripts.
Reads DATABASE_URL from .env.local (project root) or environment.
"""
import os
import psycopg2
import psycopg2.extras
from pathlib import Path


def _load_env():
    """Load .env.local from project root if present."""
    env_path = Path(__file__).parents[2] / ".env.local"
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, value = line.partition("=")
                    os.environ.setdefault(key.strip(), value.strip())


_load_env()


def get_conn():
    """
    Return a psycopg2 connection with TCP keepalives enabled.
    Tries pooler URL first (more reliable for long-running scripts), then direct.
    Keepalives prevent the connection from being dropped during long Overpass fetches.
    """
    url = os.environ.get("DATABASE_URL_POOLER") or os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError(
            "DATABASE_URL or DATABASE_URL_POOLER not set. "
            "Add it to .env.local or export it before running."
        )
    return psycopg2.connect(
        url,
        keepalives=1,
        keepalives_idle=30,       # send keepalive after 30s idle
        keepalives_interval=10,   # retry keepalive every 10s
        keepalives_count=5,       # drop connection after 5 failed keepalives
    )


def execute_batch(conn, sql: str, records: list, page_size: int = 500):
    """
    Execute a batch upsert. Reconnects automatically if the connection was dropped
    (e.g. after a long idle period during an Overpass fetch).
    """
    try:
        conn.isolation_level  # lightweight check — raises if connection is closed
    except Exception:
        pass  # connection object itself is still valid; let the cursor raise

    try:
        with conn.cursor() as cur:
            psycopg2.extras.execute_batch(cur, sql, records, page_size=page_size)
        conn.commit()
    except psycopg2.OperationalError:
        # Connection was dropped — reconnect and retry once
        conn = get_conn()
        with conn.cursor() as cur:
            psycopg2.extras.execute_batch(cur, sql, records, page_size=page_size)
        conn.commit()
    return conn  # caller should update their conn reference if needed
