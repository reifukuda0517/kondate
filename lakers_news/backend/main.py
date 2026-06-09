from fastapi import FastAPI, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from contextlib import asynccontextmanager
import asyncio
import time
import os

from news_fetcher import fetch_all_news

CACHE_TTL = 300  # 5 minutes

_cache: dict = {"articles": [], "fetched_at": 0}
_lock = asyncio.Lock()


async def _refresh_cache():
    articles = await fetch_all_news()
    async with _lock:
        _cache["articles"] = articles
        _cache["fetched_at"] = time.time()


async def _background_refresh():
    while True:
        await asyncio.sleep(CACHE_TTL)
        await _refresh_cache()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await _refresh_cache()
    task = asyncio.create_task(_background_refresh())
    yield
    task.cancel()


app = FastAPI(title="Lakers News API", lifespan=lifespan)

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")


@app.get("/api/news")
async def get_news(
    tier: int | None = Query(None, ge=1, le=4),
    q: str | None = Query(None),
):
    now = time.time()
    if now - _cache["fetched_at"] > CACHE_TTL:
        await _refresh_cache()

    async with _lock:
        articles = list(_cache["articles"])

    if tier is not None:
        articles = [a for a in articles if a["tier"] == tier]

    if q:
        q_lower = q.lower()
        articles = [
            a for a in articles
            if q_lower in a["title"].lower() or q_lower in a["summary"].lower()
        ]

    return JSONResponse({"articles": articles, "total": len(articles)})


@app.post("/api/refresh")
async def refresh_news():
    await _refresh_cache()
    return {"status": "ok", "count": len(_cache["articles"])}


@app.get("/api/stats")
async def get_stats():
    async with _lock:
        articles = _cache["articles"]
    tiers = {1: 0, 2: 0, 3: 0, 4: 0}
    for a in articles:
        tiers[a["tier"]] = tiers.get(a["tier"], 0) + 1
    return {
        "total": len(articles),
        "by_tier": tiers,
        "last_updated": _cache["fetched_at"],
    }


# Serve frontend
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
