/**
 * Ingredient management for 献立共有アプリ
 */

const Ingredients = (() => {
  let _ingredients = [];
  let _mealPlans = [];      // for linking select
  let _filterDate = null;
  let _editingId = null;

  // ─── Load & Render ─────────────────────────────────────────────────────────

  async function loadIngredients() {
    const list = document.getElementById('ingredient-list');
    list.innerHTML = '<div class="loading"><div class="spinner"></div>読み込み中...</div>';

    const filters = {};
    if (_filterDate) filters.shopping_date = _filterDate;

    try {
      _ingredients = await Api.ingredients.getAll(filters);
      renderList();
    } catch (e) {
      list.innerHTML = `<p style="color:var(--danger);padding:16px;">読み込みエラー: ${e.message}</p>`;
    }
  }

  function renderList() {
    const list = document.getElementById('ingredient-list');
    list.innerHTML = '';

    if (!_ingredients || _ingredients.length === 0) {
      list.innerHTML = `
        <div class="ingredient-empty">
          <div style="font-size:2.5rem;margin-bottom:8px;">🛒</div>
          <p>食材が登録されていません</p>
          <p style="font-size:0.8rem;margin-top:4px;">「＋ 追加」から食材を登録しましょう</p>
        </div>
      `;
      return;
    }

    _ingredients.forEach((ing) => {
      const item = document.createElement('div');
      item.className = 'ingredient-item' + (ing.is_purchased ? ' purchased' : '');
      item.dataset.id = ing.id;

      const check = document.createElement('div');
      check.className = 'ingredient-check' + (ing.is_purchased ? ' checked' : '');
      check.innerHTML = ing.is_purchased ? '✓' : '';
      check.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePurchased(ing);
      });

      const info = document.createElement('div');
      info.className = 'ingredient-info';

      const name = document.createElement('div');
      name.className = 'ingredient-name';
      name.textContent = ing.name;

      const meta = document.createElement('div');
      meta.className = 'ingredient-meta';
      const parts = [];
      if (ing.quantity || ing.unit) {
        parts.push(`${ing.quantity || ''}${ing.unit || ''}`);
      }
      if (ing.shopping_date) {
        const d = new Date(ing.shopping_date + 'T00:00:00');
        parts.push(`買い物: ${d.getMonth() + 1}/${d.getDate()}`);
      }
      const linked = _mealPlans.find((p) => p.id === ing.meal_plan_id);
      if (linked) parts.push(`献立: ${linked.meal_name}`);
      meta.textContent = parts.join(' · ');

      info.appendChild(name);
      if (parts.length > 0) info.appendChild(meta);

      const editBtn = document.createElement('button');
      editBtn.className = 'ingredient-edit-btn';
      editBtn.textContent = '✏️';
      editBtn.title = '編集';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openIngredientModal(ing);
      });

      item.appendChild(check);
      item.appendChild(info);
      item.appendChild(editBtn);
      item.addEventListener('click', () => openIngredientModal(ing));

      list.appendChild(item);
    });
  }

  async function togglePurchased(ing) {
    try {
      const updated = await Api.ingredients.update(ing.id, {
        is_purchased: !ing.is_purchased,
      });
      // Update in local array
      const idx = _ingredients.findIndex((i) => i.id === ing.id);
      if (idx !== -1) _ingredients[idx] = updated;
      renderList();
    } catch (e) {
      showToast('更新エラー: ' + e.message, 'error');
    }
  }

  // ─── Ingredient Modal ──────────────────────────────────────────────────────

  async function openIngredientModal(ing = null) {
    _editingId = ing ? ing.id : null;

    const modal = document.getElementById('ingredient-modal');
    const titleEl = document.getElementById('ingredient-modal-title');
    const idInput = document.getElementById('ingredient-id');
    const nameInput = document.getElementById('ingredient-name-input');
    const qtyInput = document.getElementById('ingredient-qty-input');
    const unitInput = document.getElementById('ingredient-unit-input');
    const dateInput = document.getElementById('ingredient-date-input');
    const mealSelect = document.getElementById('ingredient-meal-input');
    const deleteBtn = document.getElementById('ingredient-delete-btn');

    titleEl.textContent = ing ? '食材を編集' : '食材を追加';
    idInput.value = ing ? ing.id : '';
    nameInput.value = ing ? ing.name : '';
    qtyInput.value = ing ? (ing.quantity || '') : '';
    unitInput.value = ing ? (ing.unit || '') : '';
    dateInput.value = ing ? (ing.shopping_date || '') : '';

    // Load meal plans for select
    await loadMealPlansForSelect(mealSelect, ing ? ing.meal_plan_id : null);

    deleteBtn.style.display = ing ? 'block' : 'none';
    modal.style.display = 'flex';
    nameInput.focus();
  }

  async function loadMealPlansForSelect(select, selectedId) {
    select.innerHTML = '<option value="">紐付けなし</option>';
    try {
      if (_mealPlans.length === 0) {
        _mealPlans = await Api.mealPlans.getAll();
      }
      _mealPlans.forEach((plan) => {
        const opt = document.createElement('option');
        opt.value = plan.id;
        const d = new Date(plan.date + 'T00:00:00');
        opt.textContent = `${d.getMonth() + 1}/${d.getDate()} ${plan.meal_name}`;
        if (plan.id === selectedId) opt.selected = true;
        select.appendChild(opt);
      });
    } catch (e) {
      console.warn('Failed to load meal plans for select:', e);
    }
  }

  function closeIngredientModal() {
    document.getElementById('ingredient-modal').style.display = 'none';
    _editingId = null;
  }

  // ─── Form Submission ────────────────────────────────────────────────────────

  async function handleIngredientFormSubmit(e) {
    e.preventDefault();

    const nameInput = document.getElementById('ingredient-name-input');
    const qtyInput = document.getElementById('ingredient-qty-input');
    const unitInput = document.getElementById('ingredient-unit-input');
    const dateInput = document.getElementById('ingredient-date-input');
    const mealSelect = document.getElementById('ingredient-meal-input');
    const submitBtn = e.target.querySelector('.submit-btn');

    const payload = {
      name: nameInput.value.trim(),
      quantity: qtyInput.value.trim() || null,
      unit: unitInput.value.trim() || null,
      shopping_date: dateInput.value || null,
      meal_plan_id: mealSelect.value ? parseInt(mealSelect.value) : null,
    };

    if (!payload.name) {
      showToast('食材名を入力してください', 'error');
      return;
    }

    submitBtn.textContent = '保存中...';
    submitBtn.disabled = true;

    try {
      if (_editingId) {
        const updated = await Api.ingredients.update(_editingId, payload);
        const idx = _ingredients.findIndex((i) => i.id === _editingId);
        if (idx !== -1) _ingredients[idx] = updated;
        showToast('食材を更新しました', 'success');
      } else {
        const created = await Api.ingredients.create(payload);
        _ingredients.unshift(created);
        showToast('食材を追加しました', 'success');
      }
      // Reset meal plan cache so it reloads
      _mealPlans = [];
      renderList();
      closeIngredientModal();
    } catch (err) {
      showToast('エラー: ' + err.message, 'error');
    } finally {
      submitBtn.textContent = '保存';
      submitBtn.disabled = false;
    }
  }

  async function handleIngredientDelete() {
    if (!_editingId) return;
    if (!confirm('この食材を削除しますか？')) return;

    try {
      await Api.ingredients.delete(_editingId);
      _ingredients = _ingredients.filter((i) => i.id !== _editingId);
      renderList();
      closeIngredientModal();
      showToast('食材を削除しました', 'info');
    } catch (err) {
      showToast('削除エラー: ' + err.message, 'error');
    }
  }

  // ─── WebSocket handlers ────────────────────────────────────────────────────

  function handleWsUpdate(msg) {
    const { type, data } = msg;

    if (type === 'ingredient_created') {
      if (!_filterDate || data.shopping_date === _filterDate) {
        _ingredients.unshift(data);
        renderList();
      }
    } else if (type === 'ingredient_updated') {
      const idx = _ingredients.findIndex((i) => i.id === data.id);
      if (idx !== -1) {
        _ingredients[idx] = { ..._ingredients[idx], ...data };
        renderList();
      }
    } else if (type === 'ingredient_deleted') {
      _ingredients = _ingredients.filter((i) => i.id !== data.id);
      renderList();
    }
  }

  // ─── Filter ────────────────────────────────────────────────────────────────

  function applyFilter(dateStr) {
    _filterDate = dateStr || null;
    loadIngredients();
  }

  // ─── Init ──────────────────────────────────────────────────────────────────

  function init() {
    document.getElementById('add-ingredient-btn').addEventListener('click', () => {
      openIngredientModal(null);
    });

    document.getElementById('ingredient-modal-close').addEventListener('click', closeIngredientModal);
    document.getElementById('ingredient-modal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeIngredientModal();
    });

    document.getElementById('ingredient-form').addEventListener('submit', handleIngredientFormSubmit);
    document.getElementById('ingredient-delete-btn').addEventListener('click', handleIngredientDelete);

    document.getElementById('ingredient-date-filter').addEventListener('change', (e) => {
      applyFilter(e.target.value);
    });

    document.getElementById('clear-filter-btn').addEventListener('click', () => {
      document.getElementById('ingredient-date-filter').value = '';
      applyFilter(null);
    });
  }

  function load() {
    loadIngredients();
  }

  return {
    init,
    load,
    handleWsUpdate,
  };
})();

window.Ingredients = Ingredients;
