"""JEV-9B decision mode (System 1) on a 16 GB laptop GPU.

Follows the model card's transformers + PEFT recipe: backbone + the `adapter/` LoRA, then the 24-slot
decision head on the last token's hidden state, divided by the per-kind temperature. The backbone is
loaded in 4-bit (bitsandbytes NF4) by default so it fits next to Gemma; set JEV_QUANT=8bit or bf16 if
you have room. The adapter stays unmerged (merging into a 4-bit base isn't supported).
"""

from __future__ import annotations

import json
import os
import threading
import time

import torch
from huggingface_hub import hf_hub_download
from peft import PeftModel
from safetensors.torch import load_file
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

LETTERS = "ABCDEFGHIJKLMNOP"
NOUL = ["false", "true"]
SCORE = ["0", "1", "2", "3", "4", "5"]


class Jev:
    def __init__(self, repo: str = "autotrust/JEV-9B", quant: str = "4bit"):
        self.repo = repo
        self.quant = quant
        self.lock = threading.Lock()
        t0 = time.time()
        self.tok = AutoTokenizer.from_pretrained(repo)
        kwargs: dict = {"device_map": "cuda"}
        if quant == "4bit":
            kwargs["quantization_config"] = BitsAndBytesConfig(
                load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_use_double_quant=True,
            )
        elif quant == "8bit":
            kwargs["quantization_config"] = BitsAndBytesConfig(load_in_8bit=True)
        else:
            kwargs["dtype"] = torch.bfloat16
        base = AutoModelForCausalLM.from_pretrained(repo, **kwargs)
        self.model = PeftModel.from_pretrained(base, repo, subfolder="adapter")
        self.model.eval()
        head = load_file(hf_hub_download(repo, "head.safetensors"))
        self.W = head["proj.weight"].float().cuda()
        self.b = head["proj.bias"].float().cuda()
        with open(hf_hub_download(repo, "judge_config.json")) as f:
            self.ranges = json.load(f)["slots"]["ranges"]
        with open(hf_hub_download(repo, "calibration.json")) as f:
            self.temp = json.load(f)["per_kind"]
        print(f"JEV loaded ({quant}) in {time.time() - t0:.0f}s, {torch.cuda.memory_allocated() / 2**30:.1f} GB on GPU", flush=True)

    def _backbone(self):
        # PeftModel → LoraModel → CausalLM → .model is the decoder stack (no lm_head), like the card's model.model.
        return self.model.base_model.model.model

    @torch.no_grad()
    def decide_one(self, kind: str, state: str, question: str, options: list[str]) -> list[float]:
        if kind == "noul":
            options = NOUL
        elif kind == "score":
            options = SCORE
        elif not 2 <= len(options) <= 16:
            raise ValueError("choice takes 2-16 options")
        lines = options if kind != "choice" else [f"{LETTERS[i]}) {o}" for i, o in enumerate(options)]
        text = f"[kind] {kind}\n[state] {state}\n[question] {question}\n[options]\n" + "\n".join(lines) + "\n[decision]:"
        ids = self.tok(text, return_tensors="pt", add_special_tokens=False).to("cuda")
        with self.lock, torch.autocast("cuda", dtype=torch.bfloat16):
            h = self._backbone()(**ids).last_hidden_state[0, -1].float()
        z = (self.W @ h + self.b) / self.temp[kind]
        s, _ = self.ranges[kind]
        return torch.softmax(z[s : s + len(options)], 0).tolist()

    def decide(self, state: str, questions: list[dict]) -> dict[str, list[float]]:
        return {q["key"]: self.decide_one(q["kind"], state, q["question"], q.get("options") or []) for q in questions}


if __name__ == "__main__":
    jev = Jev(quant=os.environ.get("JEV_QUANT", "4bit"))
    state = 'Campus marketplace chat about "TI-84 Plus", listed at $60.00.\nNew message from the buyer: "would u do 40 if i grab it today? i can zelle you"'
    for q in [
        {"key": "intent", "kind": "choice", "question": "What is the buyer's new message mainly doing?", "options": ["makes or changes a price offer", "asks about the item", "spam"]},
        {"key": "off_platform", "kind": "noul", "question": "Does the message ask to pay outside the app (Zelle, Cash App, Venmo)?"},
        {"key": "serious", "kind": "score", "question": "How serious is this buyer about buying (0-5)?"},
    ]:
        t0 = time.time()
        p = jev.decide(state, [q])[q["key"]]
        print(q["key"], [round(x, 3) for x in p], f"{(time.time() - t0) * 1000:.0f} ms")
