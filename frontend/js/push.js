/**
 * Push notification management for 献立共有アプリ
 */

const PushManager = (() => {
  let _vapidPublicKey = null;
  let _currentSubscription = null;
  let _currentUserId = null;

  // Convert VAPID public key from base64 to Uint8Array
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  async function loadVapidKey() {
    if (_vapidPublicKey) return _vapidPublicKey;
    try {
      const data = await Api.push.getVapidPublicKey();
      _vapidPublicKey = data.public_key;
      return _vapidPublicKey;
    } catch (e) {
      console.error('Failed to load VAPID public key:', e);
      return null;
    }
  }

  function getPermissionStatus() {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission; // 'default' | 'granted' | 'denied'
  }

  async function getSubscription() {
    if (!('serviceWorker' in navigator)) return null;
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      _currentSubscription = sub;
      return sub;
    } catch (e) {
      console.error('Failed to get subscription:', e);
      return null;
    }
  }

  async function subscribe(userId) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      throw new Error('このブラウザはプッシュ通知に対応していません');
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      throw new Error('通知の許可が得られませんでした');
    }

    const publicKey = await loadVapidKey();
    if (!publicKey) {
      throw new Error('VAPID公開鍵の取得に失敗しました。サーバーが起動しているか確認してください。');
    }

    const registration = await navigator.serviceWorker.ready;
    const applicationServerKey = urlBase64ToUint8Array(publicKey);

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });

    _currentSubscription = subscription;
    const subJson = subscription.toJSON();

    await Api.push.subscribe({
      user_id: userId,
      endpoint: subJson.endpoint,
      p256dh: subJson.keys.p256dh,
      auth: subJson.keys.auth,
    });

    return subscription;
  }

  async function unsubscribe() {
    const sub = await getSubscription();
    if (!sub) return;

    await Api.push.unsubscribe(sub.endpoint);
    await sub.unsubscribe();
    _currentSubscription = null;
  }

  async function sendTestNotification(userId) {
    return Api.push.testPush(userId);
  }

  async function updateUI(userId) {
    _currentUserId = userId;

    const statusText = document.getElementById('push-status-text');
    const toggleBtn = document.getElementById('push-toggle-btn');
    const testBtn = document.getElementById('push-test-btn');

    if (!statusText || !toggleBtn) return;

    const permission = getPermissionStatus();

    if (permission === 'unsupported') {
      statusText.textContent = '非対応ブラウザ';
      statusText.className = 'denied';
      toggleBtn.textContent = '通知は非対応です';
      toggleBtn.classList.add('disabled-btn');
      toggleBtn.disabled = true;
      return;
    }

    if (permission === 'denied') {
      statusText.textContent = '通知がブロックされています';
      statusText.className = 'denied';
      toggleBtn.textContent = 'ブラウザの設定から許可してください';
      toggleBtn.classList.add('disabled-btn');
      toggleBtn.disabled = true;
      if (testBtn) testBtn.style.display = 'none';
      return;
    }

    const sub = await getSubscription();

    if (sub) {
      statusText.textContent = '通知が有効です';
      statusText.className = 'enabled';
      toggleBtn.textContent = '通知を無効にする';
      toggleBtn.onclick = async () => {
        try {
          await unsubscribe();
          showToast('通知を無効にしました', 'info');
          updateUI(userId);
        } catch (e) {
          showToast('エラー: ' + e.message, 'error');
        }
      };
      if (testBtn) {
        testBtn.style.display = 'block';
        testBtn.onclick = async () => {
          try {
            await sendTestNotification(userId);
            showToast('テスト通知を送信しました', 'success');
          } catch (e) {
            showToast('送信失敗: ' + e.message, 'error');
          }
        };
      }
    } else {
      statusText.textContent = '通知が無効です';
      statusText.className = '';
      toggleBtn.textContent = '通知を有効にする';
      toggleBtn.classList.remove('disabled-btn');
      toggleBtn.disabled = false;
      toggleBtn.onclick = async () => {
        try {
          await subscribe(userId);
          showToast('通知を有効にしました！', 'success');
          updateUI(userId);
        } catch (e) {
          showToast('エラー: ' + e.message, 'error');
        }
      };
      if (testBtn) testBtn.style.display = 'none';
    }
  }

  return {
    subscribe,
    unsubscribe,
    getSubscription,
    getPermissionStatus,
    updateUI,
    sendTestNotification,
  };
})();

window.PushManager = PushManager;
