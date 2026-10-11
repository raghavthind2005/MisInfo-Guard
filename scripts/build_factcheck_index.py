"""Builds the fact-check memory: a compact semantic index of human fact-checks.

Sources:
  1. The public ClaimReview data feed published by Data Commons (CC BY).
  2. Optionally, recent fact-checks listed by the Google Fact Check Tools API
     for a set of publishers, when GOOGLE_FACTCHECK_API_KEY is set. The feed
     lags and misses some publishers, so this keeps the index fresh.

Output (in --out):
  manifest.json   build date, claim count, vector dimension and scale
  claims.json     one [text, rating, category, publisher, url, date] row per claim
  vectors.bin     int8 embeddings, one row per claim, in the same order

The embeddings come from the same quantized ONNX model the extension runs in
the browser, so index vectors and query vectors are directly comparable.
Run `node extension/scripts/fetch-models.mjs` first to download that model.
"""
import argparse
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = ROOT / "extension" / "public" / "models" / "all-MiniLM-L6-v2"
FEED_URL = "https://storage.googleapis.com/datacommons-feeds/factcheck/latest/data.json"
API_URL = "https://factchecktools.googleapis.com/v1alpha1/claims:search"

# Publishers whose recent fact-checks are pulled from the API on top of the feed.
TOP_UP_PUBLISHERS = [
    "snopes.com", "factcheck.afp.com", "fullfact.org", "factcheck.org",
    "leadstories.com", "factly.in", "boomlive.in",
]
TOP_UP_MAX_AGE_DAYS = 180
TOP_UP_MAX_PAGES = 10

MIN_LENGTH, MAX_LENGTH = 25, 300
MAX_TOKENS = 128
BATCH_SIZE = 64

# Claims about a specific image or video cannot match a sentence in an article.
MEDIA_CLAIM = re.compile(r"\b(videos?|photos?|images?|pictures?|screenshots?|clips?|footage|visuals?)\b", re.I)

FALSE_WORDS = ("false", "falso", "fake", "pants on fire", "incorrect", "wrong", "hoax", "debunk",
               "not true", "untrue", "baseless", "fabricat", "no evidence", "scam", "made-up", "inaccurate")
MISLEADING_WORDS = ("mislead", "missing context", "lacks context", "partly", "partially", "half", "mixture",
                    "mixed", "exaggerat", "distort", "unproven", "unsupported", "spin", "out of context",
                    "needs context", "satire", "altered", "cherry")
TRUE_WORDS = ("true", "correct", "accurate", "legit", "real", "verdadeiro")


def categorize(rating: str) -> str:
    """Maps a publisher's free-text rating onto false / misleading / true / other."""
    text = rating.lower()
    if any(word in text for word in FALSE_WORDS):
        return "false"
    if any(word in text for word in MISLEADING_WORDS):
        return "misleading"
    if any(word in text for word in TRUE_WORDS):
        return "true"
    return "other"


def usable(text: str) -> bool:
    if not MIN_LENGTH <= len(text) <= MAX_LENGTH:
        return False
    if sum(ch.isascii() for ch in text) / len(text) < 0.97:  # English-only index for now
        return False
    return not MEDIA_CLAIM.search(text)


def load_feed(cache: Path | None) -> list:
    if cache and cache.exists():
        print(f"Reading cached feed {cache}")
        return json.loads(cache.read_text())["dataFeedElement"]
    print("Downloading ClaimReview feed (about 200 MB)...")
    with urllib.request.urlopen(FEED_URL, timeout=600) as response:
        raw = response.read()
    if cache:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_bytes(raw)
    return json.loads(raw)["dataFeedElement"]


def feed_rows(elements: list):
    for element in elements:
        for item in element.get("item") or []:
            if not isinstance(item, dict):
                continue
            author = item.get("author") if isinstance(item.get("author"), dict) else {}
            rating = (item.get("reviewRating") or {}).get("alternateName") or ""
            yield (
                (item.get("claimReviewed") or "").strip(),
                str(rating).strip(),
                author.get("name") or "",
                item.get("url") or "",
                (item.get("datePublished") or "")[:10],
            )


def top_up_rows(api_key: str):
    for site in TOP_UP_PUBLISHERS:
        token, pages, count = None, 0, 0
        while pages < TOP_UP_MAX_PAGES:
            params = {"reviewPublisherSiteFilter": site, "maxAgeDays": TOP_UP_MAX_AGE_DAYS,
                      "pageSize": 100, "languageCode": "en", "key": api_key}
            if token:
                params["pageToken"] = token
            try:
                with urllib.request.urlopen(f"{API_URL}?{urllib.parse.urlencode(params)}", timeout=60) as response:
                    data = json.load(response)
            except urllib.error.URLError as err:
                print(f"  {site}: request failed ({err}), skipping the rest")
                break
            for claim in data.get("claims", []):
                review = (claim.get("claimReview") or [{}])[0]
                count += 1
                yield (
                    (claim.get("text") or "").strip(),
                    (review.get("textualRating") or "").strip(),
                    (review.get("publisher") or {}).get("name") or site,
                    review.get("url") or "",
                    (review.get("reviewDate") or claim.get("claimDate") or "")[:10],
                )
            token = data.get("nextPageToken")
            pages += 1
            if not token:
                break
            time.sleep(0.2)
        print(f"  {site}: {count} recent fact-checks")


def collect(elements: list, api_key: str | None, limit: int | None) -> list:
    sources = [feed_rows(elements)]
    if api_key:
        print("Topping up from the Fact Check Tools API...")
        sources.insert(0, top_up_rows(api_key))  # API rows first, so fresh entries win the de-duplication
    else:
        print("GOOGLE_FACTCHECK_API_KEY not set: building from the feed only")

    claims, seen = [], set()
    for source in sources:
        for text, rating, publisher, url, date in source:
            text = re.sub(r"\s+", " ", text)
            key = text.lower()
            if key in seen or not usable(text) or not url.startswith("http"):
                continue
            category = categorize(rating)
            if category == "true":  # the memory only exists to surface disputed claims
                continue
            seen.add(key)
            claims.append([text, rating[:60], category, publisher[:60], url, date])
    return claims[:limit] if limit else claims


class Embedder:
    def __init__(self, model_dir: Path):
        if not (model_dir / "onnx" / "model_quantized.onnx").exists():
            raise SystemExit(f"Model not found in {model_dir}. Run: node extension/scripts/fetch-models.mjs")
        self.tokenizer = Tokenizer.from_file(str(model_dir / "tokenizer.json"))
        self.tokenizer.enable_truncation(MAX_TOKENS)
        self.tokenizer.enable_padding()
        self.session = ort.InferenceSession(str(model_dir / "onnx" / "model_quantized.onnx"),
                                            providers=["CPUExecutionProvider"])
        self.inputs = {i.name for i in self.session.get_inputs()}

    def embed(self, texts: list) -> np.ndarray:
        """Mean-pooled, L2-normalized sentence embeddings (matches the extension's pipeline)."""
        encoded = self.tokenizer.encode_batch(texts)
        ids = np.array([e.ids for e in encoded], dtype=np.int64)
        mask = np.array([e.attention_mask for e in encoded], dtype=np.int64)
        feed = {"input_ids": ids, "attention_mask": mask, "token_type_ids": np.zeros_like(ids)}
        hidden = self.session.run(None, {k: v for k, v in feed.items() if k in self.inputs})[0]
        weights = mask[..., None].astype(np.float32)
        pooled = (hidden * weights).sum(axis=1) / weights.sum(axis=1)
        return pooled / np.linalg.norm(pooled, axis=1, keepdims=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--out", type=Path, default=ROOT / "factcheck-index")
    parser.add_argument("--feed-cache", type=Path, help="reuse a downloaded copy of the feed at this path")
    parser.add_argument("--limit", type=int, help="index only the first N claims (for quick test builds)")
    args = parser.parse_args()

    claims = collect(load_feed(args.feed_cache), os.environ.get("GOOGLE_FACTCHECK_API_KEY"), args.limit)
    print(f"Indexing {len(claims)} fact-checked claims")

    embedder = Embedder(MODEL_DIR)
    # Sort by length so each batch pads to a similar size, then restore the original order.
    order = sorted(range(len(claims)), key=lambda i: len(claims[i][0]))
    vectors = np.zeros((len(claims), 384), dtype=np.float32)
    started = time.time()
    for start in range(0, len(order), BATCH_SIZE):
        batch = order[start:start + BATCH_SIZE]
        vectors[batch] = embedder.embed([claims[i][0] for i in batch])
        if start % (BATCH_SIZE * 50) == 0:
            print(f"  embedded {start}/{len(claims)} ({time.time() - started:.0f}s)", flush=True)

    scale = 127.0 / float(np.abs(vectors).max())
    quantized = np.clip(np.round(vectors * scale), -127, 127).astype(np.int8)

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "vectors.bin").write_bytes(quantized.tobytes())
    (args.out / "claims.json").write_text(json.dumps(claims, ensure_ascii=False, separators=(",", ":")))
    (args.out / "manifest.json").write_text(json.dumps({
        "builtAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count": len(claims),
        "dimensions": int(vectors.shape[1]),
        "scale": scale,
        "model": "all-MiniLM-L6-v2 (quantized)",
        "license": "Claim data: CC BY, Data Commons ClaimReview feed and Google Fact Check Tools API",
    }, indent=2))
    sizes = {p.name: f"{p.stat().st_size / 1e6:.1f} MB" for p in sorted(args.out.iterdir())}
    print(f"Done in {time.time() - started:.0f}s: {sizes}")


if __name__ == "__main__":
    main()
