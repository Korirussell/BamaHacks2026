"""Gemma 4 vision through the local Ollama server, with output constrained to the API's JSON schema."""

from __future__ import annotations

import base64
import json
import time

import httpx


class Gemma:
    def __init__(self, model: str, host: str = "http://localhost:11434"):
        self.model = model
        self.host = host.rstrip("/")
        self.http = httpx.Client(timeout=120)

    def check(self) -> None:
        tags = self.http.get(f"{self.host}/api/tags").json().get("models", [])
        names = {m["name"] for m in tags} | {m["name"].removesuffix(":latest") for m in tags}
        if self.model not in names:
            raise RuntimeError(f"Ollama doesn't have {self.model}. Run: ollama pull {self.model}")

    def _image(self, url: str) -> str:
        r = self.http.get(url, follow_redirects=True)
        r.raise_for_status()
        return base64.b64encode(r.content).decode()

    def vision(self, image_urls: list[str], prompt: str, schema: dict) -> dict:
        t0 = time.time()
        images = [self._image(u) for u in image_urls[:4]]
        r = self.http.post(f"{self.host}/api/chat", json={
            "model": self.model,
            "messages": [{"role": "user", "content": prompt, **({"images": images} if images else {})}],
            "format": schema,
            "stream": False,
            "options": {"temperature": 0.1},
        })
        r.raise_for_status()
        content = r.json()["message"]["content"]
        return {"json": json.loads(content), "model": self.model, "ms": round((time.time() - t0) * 1000)}
