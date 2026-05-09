/**
 * Main app initialization for 献立共有アプリ
 * Handles: user selection, navigation, WebSocket, service worker registration.
 */

// ─── Global toast helper ──────────────────────────────────────────────────────
let _toastTimer = null;
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.style.display = 'block';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    toast.style.display = 'none';
  }, 3000);
}
window.showToast = showToast;

// ─── App State ────────────────────────────────────────────────────────────────
const App = (() => {
  let _currentUserId = null;
  let _currentUserName = null;
  let _ws = null;
  let _wsReconnectTimer = null;
  let _wsReconnectDelay = 2000;
  let _activeView = 'calendar';

  // ─── User Management ────────────────────────────────────────────────────────

  function getCurrentUserId() {
    return _currentUserId;
  }

  function getCurrentUserName() {
    return _currentUserName;
  }

  function loadUserFromStorage() {
    const stored = localStorage.getItem('kondate_user');
    if (stored) {
      try {
        const user = JSON.parse(stored);
        if (user.id && user.name) {
          setCurrentUser(user.id, user.name, user.role, false);
          return true;
        }
      } catch (e) {
        localStorage.removeItem('kondate_user');
      }
    }
    return false;
  }

  function setCurrentUser(id, name, role, saveToStorage = true) {
    _currentUserId = id;
    _currentUserName = name;

    const badge = document.getElementById('current-user-badge');
    if (badge) {
      badge.textContent = name;
    }

    if (saveToStorage) {
      localStorage.setItem('kondate_user', JSON.stringify({ id, name, role }));
    }

    // Connect WebSocket with new user ID
    connectWebSocket(id);

    // Update push notification UI
    if (window.PushManager) {
      PushManager.updateUI(id);
    }
  }

  function showUserModal() {
    document.getElementById('user-modal').style.display = 'flex';
  }

  function hideUserModal() {
    document.getElementById('user-modal').style.display = 'none';
  }

  function initUserSelection() {
    const stored = loadUserFromStorage();
    if (!stored) {
      showUserModal();
    }

    // User select buttons
    document.querySelectorAll('.user-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const userId = parseInt(btn.dataset.id);
        const role = btn.dataset.role;

        try {
          const user = await Api.users.getById(userId);
          setCurrentUser(user.id, user.name, user.role);
          hideUserModal();
          showToast(`${user.name}としてログインしました`, 'success');
        } catch (e) {
          // Fallback if server not up yet
          const name = role === 'husband' ? '夫' : '妻';
          setCurrentUser(userId, name, role);
          hideUserModal();
          showToast(`${name}として続けます`, 'info');
        }
      });
    });

    // Change user button
    document.getElementById('change-user-btn').addEventListener('click', showUserModal);

    // Close user modal on overlay click
    document.getElementById('user-modal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget && _currentUserId) {
        hideUserModal();
      }
    });
  }

  // ─── Navigation ─────────────────────────────────────────────────────────────

  function switchView(viewName) {
    _activeView = viewName;

    // Update views
    document.querySelectorAll('.view').forEach((v) => {
      v.classList.toggle('active', v.id === `view-${viewName}`);
    });

    // Update nav
    document.querySelectorAll('.nav-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.view === viewName);
    });

    // Lazy load views
    if (viewName === 'ingredients') {
      Ingredients.load();
    } else if (viewName === 'notifications' && _currentUserId) {
      PushManager.updateUI(_currentUserId);
    }
  }

  function initNavigation() {
    document.querySelectorAll('.nav-item').forEach((item) => {
      item.addEventListener('click', () => {
        switchView(item.dataset.view);
      });
    });
  }

  // ─── WebSocket ───────────────────────────────────────────────────────────────

  function connectWebSocket(userId) {
    if (_ws) {
      _ws.onclose = null; // prevent reconnect trigger
      _ws.close();
      _ws = null;
    }

    clearTimeout(_wsReconnectTimer);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${userId}`;

    try {
      _ws = new WebSocket(wsUrl);
    } catch (e) {
      console.warn('WebSocket creation failed:', e);
      scheduleWsReconnect(userId);
      return;
    }

    _ws.onopen = () => {
      console.log('[WS] Connected');
      _wsReconnectDelay = 2000;
      // Send periodic heartbeat
      const heartbeat = setInterval(() => {
        if (_ws && _ws.readyState === WebSocket.OPEN) {
          _ws.send(JSON.stringify({ type: 'ping' }));
        } else {
          clearInterval(heartbeat);
        }
      }, 30000);
    };

    _ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleWsMessage(msg);
      } catch (e) {
        console.warn('[WS] Failed to parse message:', e);
      }
    };

    _ws.onclose = () => {
      console.log('[WS] Disconnected, reconnecting in', _wsReconnectDelay, 'ms');
      scheduleWsReconnect(userId);
    };

    _ws.onerror = (e) => {
      console.warn('[WS] Error:', e);
    };
  }

  function scheduleWsReconnect(userId) {
    clearTimeout(_wsReconnectTimer);
    _wsReconnectTimer = setTimeout(() => {
      _wsReconnectDelay = Math.min(_wsReconnectDelay * 1.5, 30000);
      connectWebSocket(userId);
    }, _wsReconnectDelay);
  }

  function handleWsMessage(msg) {
    const { type } = msg;

    // Route to relevant module
    if (type.startsWith('meal_plan_') || type === 'comment_created') {
      Calendar.handleWsUpdate(msg);
    }
    if (type.startsWith('ingredient_')) {
      Ingredients.handleWsUpdate(msg);
    }

    // Show notification for updates from other users
    if (_currentUserId && msg.data && msg.data.created_by && msg.data.created_by !== _currentUserId) {
      if (type === 'meal_plan_created') {
        showToast(`新しい献立が追加されました: ${msg.data.meal_name}`, 'info');
      } else if (type === 'meal_plan_updated') {
        showToast(`献立が更新されました: ${msg.data.meal_name}`, 'info');
      }
    }
  }

  // ─── Service Worker ──────────────────────────────────────────────────────────

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      console.log('Service Worker not supported');
      return;
    }

    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
      });
      console.log('[SW] Registered:', registration.scope);

      // Listen for SW messages
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'sync_ready') {
          // Reload current view data
          if (_activeView === 'calendar') {
            Calendar.loadWeek(Calendar.getMonday(new Date()));
          } else if (_activeView === 'ingredients') {
            Ingredients.load();
          }
        }
      });

      // Check for updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showToast('アプリが更新されました。再読み込みで反映されます。', 'info');
          }
        });
      });
    } catch (e) {
      console.warn('[SW] Registration failed:', e);
    }
  }

  // ─── Init ────────────────────────────────────────────────────────────────────

  async function init() {
    // Init sub-modules
    Calendar.init();
    Ingredients.init();

    // User selection
    initUserSelection();

    // Navigation
    initNavigation();

    // Register service worker
    registerServiceWorker();

    // Start with calendar view
    switchView('calendar');
  }

  return {
    init,
    getCurrentUserId,
    getCurrentUserName,
    switchView,
  };
})();

window.App = App;

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  App.init().catch((err) => {
    console.error('App init error:', err);
  });
});
