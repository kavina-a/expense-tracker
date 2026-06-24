// Production (Vercel): always use same-origin /api — vercel.json proxies to Railway.
// Dev: set VITE_API_URL in frontend/.env.local to hit Railway, else Vite proxies to localhost.
function apiBase() {
  if (!import.meta.env.DEV) return '/api'
  const remote = import.meta.env.VITE_API_URL
  return remote ? `${remote}/api` : '/api'
}

const BASE = apiBase()

async function req(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'Request failed')
  }
  return res.status === 204 ? null : res.json()
}

// Transactions
export const getTransactions = (params = {}) => {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
  ).toString()
  return req(`/transactions${qs ? `?${qs}` : ''}`)
}
export const deleteTransaction = (id) =>
  req(`/transactions/${id}`, { method: 'DELETE' })

// Summary & charts
export const getSummary    = (month)   => req(`/summary${month ? `?month=${month}` : ''}`)
export const getTrends     = (months)  => req(`/trends?months=${months || 6}`)
export const getDailyData  = (month)   => req(`/daily${month ? `?month=${month}` : ''}`)

// Categories
export const getCategories    = ()         => req('/categories')
export const createCategory   = (body)     => req('/categories', { method: 'POST', body: JSON.stringify(body) })
export const updateCategory   = (id, body) => req(`/categories/${id}`, { method: 'PUT', body: JSON.stringify(body) })
export const deleteCategory   = (id)       => req(`/categories/${id}`, { method: 'DELETE' })

// Budgets
export const getBudgets    = (month)     => req(`/budgets${month ? `?month=${month}` : ''}`)
export const createBudget  = (body)      => req('/budgets', { method: 'POST', body: JSON.stringify(body) })
export const updateBudget  = (id, body)  => req(`/budgets/${id}`, { method: 'PUT', body: JSON.stringify(body) })
export const deleteBudget  = (id)        => req(`/budgets/${id}`, { method: 'DELETE' })
