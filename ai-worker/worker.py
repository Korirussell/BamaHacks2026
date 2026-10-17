"""Laptop AI worker: claims ai_tasks rows from Supabase, runs them on local models, writes results back.

  gemma_vision → Gemma 4 via Ollama   (photo / story screenshot → item JSON)
  jev_decide   → JEV-9B via PEFT      (state + typed questions → calibrated probabilities)

Outbound HTTPS only (Supabase REST), so it works behind any wifi. A heartbeat row in ai_workers tells
the API it's online; when it stops, the API falls back on its own.

    python worker.py              # run both models
    python worker.py --only jev   # just one
"""

from __future__ import annotations

import argparse
import os
import socket
import threading
import time
import traceback
from datetime import datetime, timezone

import httpx
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
WORKER_ID = os.environ.get("WORKER_ID") or f"laptop-{socket.gethostname().lower()}"
GEMMA_MODEL = os.environ.get("GEMMA_MODEL", "gemma4:e4b")
OLLAMA_HOST = os.environ.get("OLLAMA_HOST_URL", "http://localhost:11434")
JEV_REPO = os.environ.get("JEV_REPO", "autotrust/JEV-9B")
JEV_QUANT = os.environ.get("JEV_QUANT", "4bit")
POLL_SECONDS = float(os.environ.get("POLL_SECONDS", "0.4"))

rest = httpx.Client(
    base_url=f"{SUPABASE_URL}/rest/v1",
    headers={"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
    timeout=20,
)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def heartbeat(kinds: list[str], models: dict) -> None:
    while True:
        try:
            rest.post("/ai_workers", json={"id": WORKER_ID, "kinds": kinds, "models": models, "last_seen_at": now()},
                      headers={"Prefer": "resolution=merge-duplicates,return=minimal"}).raise_for_status()
        except Exception as e:  # keep beating through blips
            print("heartbeat failed:", e, flush=True)
        time.sleep(5)


def claim(kind: str) -> dict | None:
    r = rest.post("/rpc/claim_ai_task", json={"p_worker": WORKER_ID, "p_kinds": [kind]})
    r.raise_for_status()
    rows = r.json()
    return rows[0] if rows else None


def finish(task_id: str, result: dict | None = None, error: str | None = None) -> None:
    body = {"status": "succeeded", "result": result} if error is None else {"status": "failed", "error": error[:1000]}
    # Only if it's still ours and running: the API may have given up and marked it failed.
    rest.patch(f"/ai_tasks?id=eq.{task_id}&status=eq.running", json=body, headers={"Prefer": "return=minimal"}).raise_for_status()


def serve(kind: str, handle) -> None:
    print(f"[{kind}] waiting for tasks", flush=True)
    while True:
        try:
            task = claim(kind)
        except Exception as e:
            print(f"[{kind}] claim failed: {e}", flush=True)
            time.sleep(3)
            continue
        if not task:
            time.sleep(POLL_SECONDS)
            continue
        t0 = time.time()
        try:
            result = handle(task["payload"])
            finish(task["id"], result=result)
            print(f"[{kind}] {task['id'][:8]} done in {(time.time() - t0) * 1000:.0f} ms", flush=True)
        except Exception as e:
            traceback.print_exc()
            try:
                finish(task["id"], error=f"{type(e).__name__}: {e}")
            except Exception:
                pass


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["gemma", "jev"])
    args = ap.parse_args()

    kinds: list[str] = []
    models: dict = {}
    loops: list[threading.Thread] = []

    if args.only in (None, "gemma"):
        from gemma import Gemma

        gemma = Gemma(GEMMA_MODEL, OLLAMA_HOST)
        gemma.check()
        kinds.append("gemma_vision")
        models["vision"] = GEMMA_MODEL
        loops.append(threading.Thread(target=serve, args=("gemma_vision", lambda p: gemma.vision(p.get("image_urls", []), p["prompt"], p["schema"])), daemon=True))

    if args.only in (None, "jev"):
        from jev import Jev

        jev = Jev(JEV_REPO, JEV_QUANT)
        kinds.append("jev_decide")
        models["decisions"] = f"{JEV_REPO} ({JEV_QUANT})"
        loops.append(threading.Thread(target=serve, args=("jev_decide", lambda p: {"answers": jev.decide(p["state"], p["questions"])}), daemon=True))

    threading.Thread(target=heartbeat, args=(kinds, models), daemon=True).start()
    for t in loops:
        t.start()
    print(f"Worker {WORKER_ID} online: {', '.join(kinds)}", flush=True)
    while True:
        time.sleep(3600)


if __name__ == "__main__":
    main()
