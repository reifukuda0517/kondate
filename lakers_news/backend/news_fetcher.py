import httpx
import asyncio
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from dateutil import parser as dateparser
from bs4 import BeautifulSoup
import hashlib
import re

# Source credibility config
# tier: 1=official, 2=high, 3=medium, 4=rumor
SOURCES = [
    {
        "name": "NBA.com",
        "url": "https://www.nba.com/news/rss.xml",
        "tier": 1,
        "keywords": ["lakers", "los angeles"],
    },
    {
        "name": "ESPN NBA",
        "url": "https://www.espn.com/espn/rss/nba/news",
        "tier": 2,
        "keywords": ["lakers", "los angeles"],
    },
    {
        "name": "CBS Sports NBA",
        "url": "https://www.cbssports.com/rss/headlines/nba/",
        "tier": 2,
        "keywords": ["lakers", "los angeles"],
    },
    {
        "name": "Bleacher Report",
        "url": "https://bleacherreport.com/los-angeles-lakers.rss",
        "tier": 3,
        "keywords": ["lakers", "los angeles"],
    },
    {
        "name": "Yahoo Sports NBA",
        "url": "https://sports.yahoo.com/nba/rss.xml",
        "tier": 3,
        "keywords": ["lakers", "los angeles"],
    },
    {
        "name": "Lakers Nation",
        "url": "https://lakersnation.com/feed/",
        "tier": 3,
        "keywords": [],  # already Lakers-specific
    },
    {
        "name": "Silver Screen & Roll",
        "url": "https://www.silverscreenandroll.com/rss/current",
        "tier": 3,
        "keywords": [],  # already Lakers-specific
    },
    {
        "name": "ClutchPoints Lakers",
        "url": "https://clutchpoints.com/lakers/feed",
        "tier": 4,
        "keywords": [],  # already Lakers-specific
    },
]

RUMOR_KEYWORDS = [
    "rumor", "reportedly", "per sources", "according to sources",
    "could", "might", "expected to", "likely to", "interest in",
    "trade talks", "targeting", "eyeing", "exploring",
]

TIER_LABELS = {1: "公式", 2: "信頼性高", 3: "信頼性中", 4: "噂"}
TIER_COLORS = {1: "blue", 2: "green", 3: "yellow", 4: "orange"}

NS = {
    "dc": "http://purl.org/dc/elements/1.1/",
    "content": "http://purl.org/rss/1.0/modules/content/",
    "media": "http://search.yahoo.com/mrss/",
    "atom": "http://www.w3.org/2005/Atom",
}


def _id(url: str) -> str:
    return hashlib.md5(url.encode()).hexdigest()[:12]


def _clean(text: str, max_len: int = 400) -> str:
    if not text:
        return ""
    soup = BeautifulSoup(text, "lxml")
    return soup.get_text(separator=" ", strip=True)[:max_len]


def _parse_date(text: str | None) -> str:
    if not text:
        return datetime.now(timezone.utc).isoformat()
    try:
        return dateparser.parse(text).astimezone(timezone.utc).isoformat()
    except Exception:
        return datetime.now(timezone.utc).isoformat()


def _bump_tier(tier: int, title: str, summary: str) -> int:
    combined = (title + " " + summary).lower()
    for kw in RUMOR_KEYWORDS:
        if kw in combined:
            return max(tier, 4)
    return tier


def _is_lakers(title: str, summary: str, keywords: list) -> bool:
    if not keywords:
        return True
    combined = (title + " " + summary).lower()
    return any(kw in combined for kw in keywords)


def _text(el, tag: str) -> str:
    child = el.find(tag)
    return (child.text or "").strip() if child is not None else ""


def _parse_rss(xml_text: str) -> list[dict]:
    items = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return items

    # Support RSS 2.0 and Atom
    channel = root.find("channel")
    if channel is not None:
        entries = channel.findall("item")
    else:
        # Atom
        entries = root.findall("{http://www.w3.org/2005/Atom}entry")

    for entry in entries:
        title = (
            _text(entry, "title")
            or _text(entry, "{http://www.w3.org/2005/Atom}title")
        )
        link = (
            _text(entry, "link")
            or (entry.find("{http://www.w3.org/2005/Atom}link") or {}).get("href", "")
            or ""
        )
        summary = (
            _text(entry, "description")
            or _text(entry, "summary")
            or _text(entry, "{http://www.w3.org/2005/Atom}summary")
            or _text(entry, "{http://www.w3.org/2005/Atom}content")
        )
        pub_date = (
            _text(entry, "pubDate")
            or _text(entry, "published")
            or _text(entry, "{http://purl.org/dc/elements/1.1/}date")
            or _text(entry, "{http://www.w3.org/2005/Atom}published")
            or _text(entry, "{http://www.w3.org/2005/Atom}updated")
        )
        items.append({"title": title, "link": link, "summary": summary, "pub_date": pub_date})

    return items


async def fetch_source(source: dict) -> list[dict]:
    articles = []
    headers = {"User-Agent": "Mozilla/5.0 (compatible; LakersNewsBot/1.0)"}
    try:
        async with httpx.AsyncClient(timeout=12, follow_redirects=True, headers=headers) as client:
            resp = await client.get(source["url"])
            resp.raise_for_status()
            raw_items = _parse_rss(resp.text)
    except Exception:
        return articles

    for item in raw_items[:25]:
        title = item["title"]
        summary = _clean(item["summary"])
        link = item["link"]

        if not title:
            continue
        if not _is_lakers(title, summary, source["keywords"]):
            continue

        effective_tier = _bump_tier(source["tier"], title, summary)

        articles.append({
            "id": _id(link or title),
            "title": title,
            "summary": summary,
            "url": link,
            "source": source["name"],
            "published": _parse_date(item["pub_date"]),
            "tier": effective_tier,
            "credibility_label": TIER_LABELS[effective_tier],
            "credibility_color": TIER_COLORS[effective_tier],
        })

    return articles


async def fetch_all_news() -> list[dict]:
    tasks = [fetch_source(s) for s in SOURCES]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    all_articles: list[dict] = []
    seen: set[str] = set()

    for result in results:
        if isinstance(result, list):
            for a in result:
                if a["id"] not in seen:
                    seen.add(a["id"])
                    all_articles.append(a)

    # Fallback to mock data when no live feeds are reachable (dev/demo mode)
    if not all_articles:
        from mock_data import MOCK_ARTICLES
        return list(MOCK_ARTICLES)

    all_articles.sort(key=lambda x: x["published"], reverse=True)
    return all_articles
