/**
 * API client for 献立共有アプリ
 * Provides fetch wrappers for all backend endpoints.
 */

const API_BASE = window.location.origin;

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function apiFetch(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  };
  const mergedOptions = { ...defaultOptions, ...options, headers: { ...defaultOptions.headers, ...options.headers } };

  try {
    const response = await fetch(url, mergedOptions);
    if (response.status === 204) return null;

    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');

    if (!response.ok) {
      let errorMsg = `HTTP ${response.status}`;
      if (isJson) {
        const errBody = await response.json();
        errorMsg = errBody.detail || errBody.message || errorMsg;
      }
      throw new ApiError(errorMsg, response.status);
    }

    if (isJson) return response.json();
    return null;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(err.message || 'Network error', 0);
  }
}

// ─── Users ───────────────────────────────────────────────────────────────────

const UsersApi = {
  getAll() {
    return apiFetch('/api/users');
  },
  getById(id) {
    return apiFetch(`/api/users/${id}`);
  },
  update(id, data) {
    return apiFetch(`/api/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
};

// ─── Meal Plans ───────────────────────────────────────────────────────────────

const MealPlansApi = {
  getWeek(dateStr) {
    const query = dateStr ? `?date=${dateStr}` : '';
    return apiFetch(`/api/meal-plans/week${query}`);
  },
  getUnscheduled() {
    return apiFetch('/api/meal-plans/unscheduled');
  },
  getAll(year, month) {
    let query = '';
    if (year && month) query = `?year=${year}&month=${month}`;
    return apiFetch(`/api/meal-plans${query}`);
  },
  getById(id) {
    return apiFetch(`/api/meal-plans/${id}`);
  },
  create(data) {
    return apiFetch('/api/meal-plans', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  update(id, data) {
    return apiFetch(`/api/meal-plans/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
  delete(id) {
    return apiFetch(`/api/meal-plans/${id}`, { method: 'DELETE' });
  },
};

// ─── Ingredients ──────────────────────────────────────────────────────────────

const IngredientsApi = {
  getAll(filters = {}) {
    const params = new URLSearchParams();
    if (filters.meal_plan_id != null) params.set('meal_plan_id', filters.meal_plan_id);
    if (filters.shopping_date) params.set('shopping_date', filters.shopping_date);
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiFetch(`/api/ingredients${query}`);
  },
  create(data) {
    return apiFetch('/api/ingredients', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  update(id, data) {
    return apiFetch(`/api/ingredients/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
  delete(id) {
    return apiFetch(`/api/ingredients/${id}`, { method: 'DELETE' });
  },
};

// ─── Comments ─────────────────────────────────────────────────────────────────

const CommentsApi = {
  getByMealPlan(mealPlanId) {
    return apiFetch(`/api/comments/${mealPlanId}`);
  },
  create(mealPlanId, data) {
    return apiFetch(`/api/comments/${mealPlanId}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ─── Push Notifications ───────────────────────────────────────────────────────

const PushApi = {
  getVapidPublicKey() {
    return apiFetch('/api/push/vapid-public-key');
  },
  subscribe(data) {
    return apiFetch('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  unsubscribe(endpoint) {
    return apiFetch('/api/push/unsubscribe', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint }),
    });
  },
  testPush(userId) {
    return apiFetch(`/api/push/test?user_id=${userId}`, { method: 'POST' });
  },
};

// Export all
window.Api = {
  users: UsersApi,
  mealPlans: MealPlansApi,
  ingredients: IngredientsApi,
  comments: CommentsApi,
  push: PushApi,
  ApiError,
};
