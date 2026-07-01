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
export const createTransaction = (body) =>
  req('/transactions', { method: 'POST', body: JSON.stringify(body) })
export const updateTransaction = (id, body) =>
  req(`/transactions/${id}`, { method: 'PUT', body: JSON.stringify(body) })
export const deleteTransaction = (id) =>
  req(`/transactions/${id}`, { method: 'DELETE' })
export const bulkDeleteTransactions = (ids) =>
  req('/transactions/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) })
export const bulkRecategorize = (ids, category) =>
  req('/transactions/bulk-recategorize', { method: 'POST', body: JSON.stringify({ ids, category }) })

// Summary & charts
export const getSummary       = (month)    => req(`/summary${month ? `?month=${month}` : ''}`)
export const getSummaryOverall = ()        => req('/summary?scope=overall')
export const getTrends        = (months)   => req(`/trends?months=${months || 6}`)
export const getDailyData     = (month)    => req(`/daily${month ? `?month=${month}` : ''}`)
export const getYearly        = (year)     => req(`/yearly${year ? `?year=${year}` : ''}`)
export const getCategoryTrends = (category, months) =>
  req(`/category-trends?category=${encodeURIComponent(category)}&months=${months || 6}`)

// Categories
export const getCategories    = ()         => req('/categories')
export const createCategory   = (body)     => req('/categories', { method: 'POST', body: JSON.stringify(body) })
export const updateCategory   = (id, body) => req(`/categories/${id}`, { method: 'PUT', body: JSON.stringify(body) })
export const getCategoryUsage = (id)       => req(`/categories/${id}/usage`)
export const deleteCategory   = (id)       => req(`/categories/${id}`, { method: 'DELETE' })

// Budgets
export const getBudgets   = (month)     => req(`/budgets${month ? `?month=${month}` : ''}`)
export const createBudget = (body)      => req('/budgets', { method: 'POST', body: JSON.stringify(body) })
export const updateBudget = (id, body)  => req(`/budgets/${id}`, { method: 'PUT', body: JSON.stringify(body) })
export const deleteBudget = (id)        => req(`/budgets/${id}`, { method: 'DELETE' })

// Savings goals
export const getSavingsGoals  = ()         => req('/savings-goals')
export const createSavingsGoal = (body)    => req('/savings-goals', { method: 'POST', body: JSON.stringify(body) })
export const updateSavingsGoal = (id, body) => req(`/savings-goals/${id}`, { method: 'PUT', body: JSON.stringify(body) })
export const deleteSavingsGoal = (id)      => req(`/savings-goals/${id}`, { method: 'DELETE' })
