/**
 * Weekly calendar view for 献立共有アプリ
 * Shows Mon–Sun, handles meal plan CRUD and comments.
 */

const Calendar = (() => {
  const DAY_NAMES = ['月', '火', '水', '木', '金', '土', '日'];
  let _currentWeekStart = null; // Monday of displayed week
  let _weekData = {};           // { 'YYYY-MM-DD': mealPlan | null }
  let _poolData = [];           // undated meal plans
  let _editingPlanId = null;
  let _editingDate = null;
  let _assigningPlan = null;    // plan being assigned to a date

  // ─── Date helpers ──────────────────────────────────────────────────────────

  function getMonday(d) {
    const date = new Date(d);
    const day = date.getDay(); // 0=Sun, 1=Mon...
    const diff = (day === 0 ? -6 : 1 - day);
    date.setDate(date.getDate() + diff);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function dateToString(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function formatWeekLabel(monday) {
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    const fmt = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
    return `${monday.getFullYear()}年 ${fmt(monday)} – ${fmt(sunday)}`;
  }

  function isToday(dateStr) {
    return dateStr === dateToString(new Date());
  }

  // ─── Data Loading ──────────────────────────────────────────────────────────

  async function loadPool() {
    try {
      _poolData = await Api.mealPlans.getUnscheduled();
    } catch (e) {
      _poolData = [];
    }
    renderPool();
  }

  function renderPool() {
    const container = document.getElementById('pool-list');
    container.innerHTML = '';
    if (_poolData.length === 0) {
      container.innerHTML = '<p class="pool-empty">未定の献立はありません<br><small>「＋ 追加」で登録できます</small></p>';
      return;
    }
    _poolData.forEach((plan) => {
      const item = document.createElement('div');
      item.className = 'pool-item' + (_assigningPlan && _assigningPlan.id === plan.id ? ' assigning' : '');

      const nameSpan = document.createElement('span');
      nameSpan.className = 'pool-item-name';
      nameSpan.textContent = plan.meal_name;
      if (plan.memo) {
        const memo = document.createElement('span');
        memo.className = 'pool-item-memo';
        memo.textContent = plan.memo;
        nameSpan.appendChild(memo);
      }

      const assignBtn = document.createElement('button');
      assignBtn.className = 'pool-assign-btn';
      assignBtn.textContent = '📅 日付を設定';
      assignBtn.addEventListener('click', (e) => { e.stopPropagation(); startAssigning(plan); });

      const editBtn = document.createElement('button');
      editBtn.className = 'pool-edit-btn';
      editBtn.textContent = '✏️';
      editBtn.addEventListener('click', (e) => { e.stopPropagation(); openMealModal(null, plan); });

      item.appendChild(nameSpan);
      item.appendChild(assignBtn);
      item.appendChild(editBtn);
      container.appendChild(item);
    });
  }

  function startAssigning(plan) {
    _assigningPlan = plan;
    renderPool();
    document.getElementById('calendar-grid').classList.add('assigning-mode');
    const banner = document.getElementById('assign-banner');
    document.getElementById('assign-banner-text').textContent = `「${plan.meal_name}」を配置する日をタップ`;
    banner.style.display = 'flex';
  }

  function cancelAssigning() {
    _assigningPlan = null;
    renderPool();
    document.getElementById('calendar-grid').classList.remove('assigning-mode');
    document.getElementById('assign-banner').style.display = 'none';
  }

  async function assignPlanToDate(plan, dateStr) {
    if (_weekData[dateStr]) {
      showToast('この日には既に献立が登録されています', 'error');
      return;
    }
    try {
      const updated = await Api.mealPlans.update(plan.id, { date: dateStr });
      _weekData[dateStr] = updated;
      _poolData = _poolData.filter((p) => p.id !== plan.id);
      cancelAssigning();
      renderGrid();
      renderPool();
      showToast(`${plan.meal_name} を設定しました`, 'success');
    } catch (err) {
      showToast('エラー: ' + err.message, 'error');
    }
  }

  async function loadWeek(mondayDate) {
    _currentWeekStart = mondayDate;
    const dateStr = dateToString(mondayDate);
    document.getElementById('week-label').textContent = formatWeekLabel(mondayDate);

    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '<div class="loading"><div class="spinner"></div>読み込み中...</div>';

    try {
      const data = await Api.mealPlans.getWeek(dateStr);
      _weekData = data.plans || {};
      renderGrid();
    } catch (e) {
      grid.innerHTML = `<p style="color:var(--danger);padding:16px;">読み込みエラー: ${e.message}</p>`;
    }
  }

  // ─── Grid Rendering ────────────────────────────────────────────────────────

  function renderGrid() {
    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';

    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(_currentWeekStart);
      dayDate.setDate(dayDate.getDate() + i);
      const dateStr = dateToString(dayDate);
      const plan = _weekData[dateStr] || null;

      const cell = document.createElement('div');
      cell.className = 'day-cell';
      cell.dataset.date = dateStr;

      if (isToday(dateStr)) cell.classList.add('today');
      if (i === 5) cell.classList.add('saturday');
      if (i === 6) cell.classList.add('sunday');

      const dayName = document.createElement('div');
      dayName.className = 'day-name';
      dayName.textContent = DAY_NAMES[i];

      const dayNum = document.createElement('div');
      dayNum.className = 'day-num';
      dayNum.textContent = dayDate.getDate();

      cell.appendChild(dayName);
      cell.appendChild(dayNum);

      if (plan) {
        const chip = document.createElement('div');
        chip.className = 'meal-chip' + (plan.is_confirmed ? '' : ' unconfirmed');
        chip.textContent = plan.meal_name;
        cell.appendChild(chip);
      } else {
        const hint = document.createElement('div');
        hint.className = 'add-day-hint';
        hint.textContent = '＋ 追加';
        cell.appendChild(hint);
      }

      cell.addEventListener('click', () => {
        if (_assigningPlan) {
          assignPlanToDate(_assigningPlan, dateStr);
        } else {
          openMealModal(dateStr, plan);
        }
      });
      grid.appendChild(cell);
    }
  }

  // ─── Meal Modal ────────────────────────────────────────────────────────────

  function openMealModal(dateStr, plan) {
    _editingDate = dateStr;
    _editingPlanId = plan ? plan.id : null;

    const modal = document.getElementById('meal-modal');
    const title = document.getElementById('meal-modal-title');
    const planIdInput = document.getElementById('meal-plan-id');
    const dateInput = document.getElementById('meal-date');
    const nameInput = document.getElementById('meal-name-input');
    const memoInput = document.getElementById('meal-memo-input');
    const confirmedInput = document.getElementById('meal-confirmed-input');
    const deleteBtn = document.getElementById('meal-delete-btn');
    const commentsSection = document.getElementById('comments-section');

    let titleText;
    if (dateStr) {
      const [y, m, d] = dateStr.split('-');
      const label = `${parseInt(m)}月${parseInt(d)}日の献立`;
      titleText = plan ? label + 'を編集' : label + 'を登録';
    } else {
      titleText = plan ? '未定の献立を編集' : '未定の献立を登録';
    }
    title.textContent = titleText;
    planIdInput.value = plan ? plan.id : '';
    dateInput.value = dateStr;
    nameInput.value = plan ? plan.meal_name : '';
    memoInput.value = plan ? (plan.memo || '') : '';
    confirmedInput.checked = plan ? plan.is_confirmed : false;

    if (plan) {
      deleteBtn.style.display = 'block';
      commentsSection.style.display = 'block';
      loadComments(plan.id);
    } else {
      deleteBtn.style.display = 'none';
      commentsSection.style.display = 'none';
    }

    modal.style.display = 'flex';
    nameInput.focus();
  }

  function closeMealModal() {
    document.getElementById('meal-modal').style.display = 'none';
    _editingDate = null;
    _editingPlanId = null;
  }

  // ─── Comments ──────────────────────────────────────────────────────────────

  async function loadComments(planId) {
    const list = document.getElementById('comments-list');
    list.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    try {
      const comments = await Api.comments.getByMealPlan(planId);
      renderComments(comments);
    } catch (e) {
      list.innerHTML = '<p style="font-size:0.8rem;color:var(--text-muted);">コメントを読み込めませんでした</p>';
    }
  }

  function renderComments(comments) {
    const list = document.getElementById('comments-list');
    list.innerHTML = '';
    if (!comments || comments.length === 0) {
      list.innerHTML = '<p style="font-size:0.82rem;color:var(--text-muted);">コメントはまだありません</p>';
      return;
    }
    comments.forEach((c) => {
      const bubble = document.createElement('div');
      bubble.className = 'comment-bubble';
      const time = new Date(c.created_at).toLocaleString('ja-JP', {
        month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
      bubble.innerHTML = `
        <div class="comment-meta">
          <span class="comment-author">${escapeHtml(c.user_name || '?')}</span>
          <span>${time}</span>
        </div>
        <div class="comment-text">${escapeHtml(c.content)}</div>
      `;
      list.appendChild(bubble);
    });
    list.scrollTop = list.scrollHeight;
  }

  function appendComment(comment) {
    const list = document.getElementById('comments-list');
    // Remove empty state message if present
    const empty = list.querySelector('p');
    if (empty) empty.remove();

    const bubble = document.createElement('div');
    bubble.className = 'comment-bubble';
    const time = new Date(comment.created_at).toLocaleString('ja-JP', {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    bubble.innerHTML = `
      <div class="comment-meta">
        <span class="comment-author">${escapeHtml(comment.user_name || '?')}</span>
        <span>${time}</span>
      </div>
      <div class="comment-text">${escapeHtml(comment.content)}</div>
    `;
    list.appendChild(bubble);
    list.scrollTop = list.scrollHeight;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ─── Form Submission ────────────────────────────────────────────────────────

  async function handleMealFormSubmit(e) {
    e.preventDefault();
    const userId = App.getCurrentUserId();
    if (!userId) {
      showToast('ユーザーを選択してください', 'error');
      return;
    }

    const nameInput = document.getElementById('meal-name-input');
    const memoInput = document.getElementById('meal-memo-input');
    const confirmedInput = document.getElementById('meal-confirmed-input');
    const submitBtn = e.target.querySelector('.submit-btn');

    const payload = {
      meal_name: nameInput.value.trim(),
      memo: memoInput.value.trim() || null,
      is_confirmed: confirmedInput.checked,
    };

    if (!payload.meal_name) {
      showToast('料理名を入力してください', 'error');
      return;
    }

    submitBtn.textContent = '保存中...';
    submitBtn.disabled = true;

    try {
      if (_editingPlanId) {
        const updated = await Api.mealPlans.update(_editingPlanId, payload);
        if (_editingDate) {
          _weekData[_editingDate] = updated;
        } else {
          const idx = _poolData.findIndex((p) => p.id === _editingPlanId);
          if (idx !== -1) _poolData[idx] = updated;
        }
        showToast('献立を更新しました', 'success');
      } else {
        const created = await Api.mealPlans.create({
          ...payload,
          date: _editingDate || null,
          created_by: userId,
        });
        if (_editingDate) {
          _weekData[_editingDate] = created;
        } else {
          _poolData.unshift(created);
        }
        showToast('献立を登録しました', 'success');
      }
      renderGrid();
      renderPool();
      closeMealModal();
    } catch (err) {
      showToast('エラー: ' + err.message, 'error');
    } finally {
      submitBtn.textContent = '保存';
      submitBtn.disabled = false;
    }
  }

  async function handleMealDelete() {
    if (!_editingPlanId) return;
    if (!confirm('この献立を削除しますか？')) return;

    try {
      await Api.mealPlans.delete(_editingPlanId);
      if (_editingDate) {
        delete _weekData[_editingDate];
      } else {
        _poolData = _poolData.filter((p) => p.id !== _editingPlanId);
      }
      renderGrid();
      renderPool();
      closeMealModal();
      showToast('献立を削除しました', 'info');
    } catch (err) {
      showToast('削除エラー: ' + err.message, 'error');
    }
  }

  async function handleCommentSubmit() {
    const userId = App.getCurrentUserId();
    if (!userId) return;
    if (!_editingPlanId) return;

    const textarea = document.getElementById('comment-input');
    const content = textarea.value.trim();
    if (!content) return;

    const btn = document.getElementById('comment-submit-btn');
    btn.disabled = true;
    btn.textContent = '送信中...';

    try {
      const comment = await Api.comments.create(_editingPlanId, {
        user_id: userId,
        content,
      });
      textarea.value = '';
      appendComment(comment);
      showToast('コメントを送信しました', 'success');
    } catch (e) {
      showToast('送信エラー: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '送信';
    }
  }

  // ─── WebSocket update handlers ─────────────────────────────────────────────

  function handleWsUpdate(msg) {
    const { type, data } = msg;
    if (!_currentWeekStart) return;

    if (type === 'meal_plan_created' || type === 'meal_plan_updated') {
      const dateStr = data.date;
      // Only update if it falls in the current displayed week
      const start = dateToString(_currentWeekStart);
      const endDate = new Date(_currentWeekStart);
      endDate.setDate(endDate.getDate() + 6);
      const end = dateToString(endDate);
      if (dateStr >= start && dateStr <= end) {
        _weekData[dateStr] = data;
        renderGrid();
      }
    } else if (type === 'meal_plan_deleted') {
      const planId = data.id;
      for (const [dateStr, plan] of Object.entries(_weekData)) {
        if (plan && plan.id === planId) {
          delete _weekData[dateStr];
          renderGrid();
          break;
        }
      }
    } else if (type === 'comment_created' && data.meal_plan_id === _editingPlanId) {
      appendComment(data);
    }
  }

  // ─── Init ──────────────────────────────────────────────────────────────────

  function init() {
    const today = new Date();
    const monday = getMonday(today);
    loadWeek(monday);
    loadPool();

    document.getElementById('week-label').textContent = formatWeekLabel(monday);

    document.getElementById('prev-week-btn').addEventListener('click', () => {
      const prev = new Date(_currentWeekStart);
      prev.setDate(prev.getDate() - 7);
      loadWeek(prev);
    });

    document.getElementById('next-week-btn').addEventListener('click', () => {
      const next = new Date(_currentWeekStart);
      next.setDate(next.getDate() + 7);
      loadWeek(next);
    });

    document.getElementById('today-btn').addEventListener('click', () => {
      loadWeek(getMonday(new Date()));
    });

    document.getElementById('add-pool-btn').addEventListener('click', () => openMealModal(null, null));
    document.getElementById('assign-cancel-btn').addEventListener('click', cancelAssigning);

    document.getElementById('meal-modal-close').addEventListener('click', closeMealModal);
    document.getElementById('meal-modal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeMealModal();
    });

    document.getElementById('meal-form').addEventListener('submit', handleMealFormSubmit);
    document.getElementById('meal-delete-btn').addEventListener('click', handleMealDelete);
    document.getElementById('comment-submit-btn').addEventListener('click', handleCommentSubmit);

    document.getElementById('comment-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleCommentSubmit();
      }
    });
  }

  return {
    init,
    loadWeek,
    handleWsUpdate,
    getMonday,
    dateToString,
  };
})();

window.Calendar = Calendar;
