const API = "/api";
const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 min

let currentTier = "all";
let currentQuery = "";
let refreshTimer = null;

const feed = document.getElementById("news-feed");
const refreshBtn = document.getElementById("refresh-btn");
const lastUpdatedEl = document.getElementById("last-updated");
const searchInput = document.getElementById("search-input");
const statsBar = document.getElementById("stats-bar");

// Format relative time in Japanese
function relativeTime(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "たった今";
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  return `${Math.floor(diff / 86400)}日前`;
}

function colorClass(color) {
  return `badge-${color}`;
}

function tierClass(tier) {
  return `tier-${tier}`;
}

function renderCard(article) {
  const el = document.createElement("div");
  el.className = `news-card ${tierClass(article.tier)}`;
  el.innerHTML = `
    <div class="card-meta">
      <span class="badge ${colorClass(article.credibility_color)}">${article.credibility_label}</span>
      <span class="card-source">${escapeHtml(article.source)}</span>
      <span class="card-time">${relativeTime(article.published)}</span>
    </div>
    <div class="card-title">
      ${article.url
        ? `<a href="${escapeHtml(article.url)}" target="_blank" rel="noopener">${escapeHtml(article.title)}</a>`
        : escapeHtml(article.title)}
    </div>
    ${article.summary ? `<div class="card-summary">${escapeHtml(article.summary)}</div>` : ""}
  `;
  return el;
}

function escapeHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showLoading() {
  feed.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <p>ニュースを読み込んでいます...</p>
    </div>
  `;
}

function showEmpty() {
  feed.innerHTML = `
    <div class="empty-state">
      <div class="icon">🔍</div>
      <p>該当するニュースが見つかりませんでした</p>
    </div>
  `;
}

function showError(msg) {
  feed.innerHTML = `<div class="error-state">⚠️ ${escapeHtml(msg)}</div>`;
}

async function loadNews(showSpinner = true) {
  if (showSpinner) showLoading();

  const params = new URLSearchParams();
  if (currentTier !== "all") params.set("tier", currentTier);
  if (currentQuery) params.set("q", currentQuery);

  try {
    const res = await fetch(`${API}/news?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    feed.innerHTML = "";
    if (data.articles.length === 0) {
      showEmpty();
    } else {
      data.articles.forEach((a) => feed.appendChild(renderCard(a)));
    }

    lastUpdatedEl.textContent = `更新: ${new Date().toLocaleTimeString("ja-JP")}`;
  } catch (e) {
    showError("ニュースの取得に失敗しました。しばらく後に再試行してください。");
  }
}

async function loadStats() {
  try {
    const res = await fetch(`${API}/stats`);
    if (!res.ok) return;
    const data = await res.json();
    document.getElementById("stat-total").textContent = `合計 ${data.total} 件`;
    document.getElementById("stat-1").textContent = data.by_tier[1] || 0;
    document.getElementById("stat-2").textContent = data.by_tier[2] || 0;
    document.getElementById("stat-3").textContent = data.by_tier[3] || 0;
    document.getElementById("stat-4").textContent = data.by_tier[4] || 0;
    statsBar.style.display = "flex";
  } catch (_) {}
}

async function doRefresh() {
  refreshBtn.classList.add("spinning");
  try {
    await fetch(`${API}/refresh`, { method: "POST" });
    await Promise.all([loadNews(false), loadStats()]);
  } finally {
    refreshBtn.classList.remove("spinning");
  }
}

// Filter buttons
document.querySelectorAll(".filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentTier = btn.dataset.tier;
    loadNews();
  });
});

// Search
let searchTimeout;
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    currentQuery = searchInput.value.trim();
    loadNews();
  }, 400);
});

// Refresh button
refreshBtn.addEventListener("click", doRefresh);

// Auto-refresh
function scheduleRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => loadNews(false), REFRESH_INTERVAL);
}

// Init
(async () => {
  await Promise.all([loadNews(), loadStats()]);
  scheduleRefresh();
})();
