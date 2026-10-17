# AI worker (runs on the laptop)

Both models run locally on the laptop's RTX 5000 Ada (16 GB). The deployed API never runs a model.

```
iOS app ──► deployed API ──► Supabase ai_tasks (queued) ◄── worker.py on the laptop
                 ▲                                              │  Gemma 4 E4B (Ollama)
                 └──────── polls the row ◄── result written ◄───┘  JEV-9B 4-bit (PEFT)
```

- **Gemma 4** sees: photo or story screenshot → item, category, condition, asking price, resale estimate.
- **JEV-9B** decides: typed `noul` / `choice` / `score` questions → calibrated probabilities. Used for haggle
  triage, the scam gate, the listing gate and semantic wishlist matching.
- **Plain code** acts: the price rule in `backend/src/services/haggle.ts` never crosses the seller's floor.

The worker only makes outbound HTTPS calls, so venue wifi doesn't matter. It sends a heartbeat to
`ai_workers` every 5 s. When it goes quiet, the API falls back by itself: vision goes to Claude (or the
caption parser) and decisions go to keyword rules. `GET /api/v1/ai/status` shows whether it's online.

## Setup (once)

1. Apply the migration `supabase/migrations/0020_ai_tasks.sql` (`supabase db push`, or paste it into the SQL editor).
2. Install [Ollama](https://ollama.com/download), then `ollama pull gemma4:e4b`.
3. JEV-9B is already in the Hugging Face cache (`~/.cache/huggingface/hub/models--autotrust--JEV-9B`).
4. `cp .env.example .env`, then fill in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (the same values as in `backend/.env`).
5. `uv sync` installs torch (CUDA 12.8), transformers, peft and bitsandbytes into `.venv`.

## Run

```bash
uv run python worker.py           # both models
uv run python worker.py --only jev
uv run python jev.py              # JEV smoke test + latency, no Supabase needed
```

The deployed API needs `AI=laptop` (the default) and the same Supabase project.

## VRAM budget

| Model | Mode | VRAM |
|---|---|---|
| Gemma 4 E4B | Ollama 4-bit | ~5–6 GB |
| JEV-9B | NF4 4-bit (`JEV_QUANT=4bit`) | ~6 GB |

If the GPU has room left, `JEV_QUANT=8bit` gives JEV slightly more faithful probabilities.
