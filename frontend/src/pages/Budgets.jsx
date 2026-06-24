import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getBudgets, createBudget, updateBudget, deleteBudget, getCategories } from '../api'
import { Plus, Pencil, Trash2, X, AlertTriangle } from 'lucide-react'

function currentMonthStr() {
  return new Date().toLocaleDateString('sv-SE').slice(0, 7)
}

function fmtRs(n) {
  return `Rs. ${Number(n).toLocaleString('en-IN')}`
}

function ProgressBar({ pct, color }) {
  const capped = Math.min(pct, 100)
  const track = pct >= 90 ? '#ef4444' : pct >= 70 ? '#eab308' : (color || '#22c55e')
  return (
    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${capped}%`, backgroundColor: track }}
      />
    </div>
  )
}

function StatusDot({ pct }) {
  if (pct >= 90) return <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0 animate-pulse" />
  if (pct >= 70) return <span className="w-2 h-2 rounded-full bg-yellow-500 shrink-0" />
  return <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
}

function BudgetFormModal({ initial, categories, existingBudgetCats, onSave, onClose }) {
  const [category, setCategory] = useState(initial?.category || '')
  const [limit,    setLimit]    = useState(initial?.monthly_limit?.toString() || '')

  const available = categories.filter(c =>
    !existingBudgetCats.includes(c.name) || c.name === initial?.category
  )

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!category || !limit || isNaN(parseFloat(limit))) return
    onSave({ category, monthly_limit: parseFloat(limit) })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="bg-card border border-border rounded-xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-semibold text-slate-200">{initial ? 'Edit Budget' : 'Set Budget'}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 p-1 rounded-lg hover:bg-white/5">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Category</label>
            {initial ? (
              <div className="px-3 py-2 bg-surface border border-border rounded-lg text-sm text-slate-300">
                {initial.category}
              </div>
            ) : (
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-slate-300 focus:outline-none focus:border-indigo-500/50"
                autoFocus
              >
                <option value="">Select category...</option>
                {available.map(c => (
                  <option key={c.id} value={c.name}>{c.icon} {c.name}</option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Monthly Limit (Rs.)</label>
            <input
              type="number"
              value={limit}
              onChange={e => setLimit(e.target.value)}
              placeholder="e.g. 5000"
              min="1"
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-lg text-sm text-slate-400 border border-border hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
            >
              {initial ? 'Save' : 'Set budget'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Budgets() {
  const [showAdd,   setShowAdd]   = useState(false)
  const [editing,   setEditing]   = useState(null)
  const [confirming, setConfirming] = useState(null)

  const month = currentMonthStr()
  const qc    = useQueryClient()
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['budgets'] })
    qc.invalidateQueries({ queryKey: ['summary'] })
  }

  const budgetsQ    = useQuery({ queryKey: ['budgets', month], queryFn: () => getBudgets(month) })
  const categoriesQ = useQuery({ queryKey: ['categories'],     queryFn: getCategories })

  const createMut = useMutation({ mutationFn: createBudget, onSuccess: () => { invalidate(); setShowAdd(false) } })
  const updateMut = useMutation({ mutationFn: ({ id, data }) => updateBudget(id, data), onSuccess: () => { invalidate(); setEditing(null) } })
  const deleteMut = useMutation({ mutationFn: deleteBudget, onSuccess: () => { invalidate(); setConfirming(null) } })

  const budgets    = budgetsQ.data    || []
  const categories = categoriesQ.data || []

  const colorMap = Object.fromEntries(categories.map(c => [c.name, c.color]))
  const existingBudgetCats = budgets.map(b => b.category)

  const overBudget = budgets.filter(b => (b.spent / b.monthly_limit) >= 0.9)

  return (
    <div className="p-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Budgets</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {budgets.length} active budgets · {new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
        >
          <Plus size={14} />
          Set budget
        </button>
      </div>

      {/* Over-budget alert banner */}
      {overBudget.length > 0 && (
        <div className="mb-4 p-3 rounded-xl border border-rose-500/30 bg-rose-500/5 flex items-start gap-2.5">
          <AlertTriangle size={15} className="text-rose-400 shrink-0 mt-0.5" />
          <p className="text-xs text-rose-300">
            <strong>{overBudget.length} {overBudget.length === 1 ? 'category' : 'categories'}</strong> near or over budget this month:{' '}
            {overBudget.map(b => b.category).join(', ')}
          </p>
        </div>
      )}

      {/* Budget cards */}
      {budgetsQ.isLoading ? (
        <div className="text-center py-16 text-slate-500 text-sm">Loading...</div>
      ) : budgets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500 gap-3">
          <span className="text-4xl">🎯</span>
          <p className="text-sm">No budgets set yet</p>
          <p className="text-xs text-slate-600">Add limits to get WhatsApp alerts when you approach them</p>
          <button
            onClick={() => setShowAdd(true)}
            className="mt-2 px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-600/30 transition-colors"
          >
            Set your first budget
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {budgets.map(b => {
            const pct   = b.monthly_limit ? Math.round((b.spent / b.monthly_limit) * 100) : 0
            const color = colorMap[b.category] || '#6b7280'
            const catIcon = categories.find(c => c.name === b.category)?.icon || '📦'

            return (
              <div
                key={b.id}
                className="group p-4 rounded-xl border border-border bg-card hover:border-slate-600 transition-all"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <StatusDot pct={pct} />
                    <span className="text-base">{catIcon}</span>
                    <div>
                      <p className="text-sm font-medium text-slate-200">{b.category}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {fmtRs(b.spent)} spent of {fmtRs(b.monthly_limit)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold tabular-nums ${
                      pct >= 90 ? 'text-rose-400' : pct >= 70 ? 'text-yellow-400' : 'text-emerald-400'
                    }`}>
                      {pct}%
                    </span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => setEditing(b)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => setConfirming(b)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
                <ProgressBar pct={pct} color={color} />
                <div className="flex justify-between mt-1.5">
                  <span className="text-[10px] text-slate-600">{fmtRs(b.monthly_limit - b.spent)} remaining</span>
                  {pct >= 90 && (
                    <span className="text-[10px] text-rose-400">⚠️ Alert fires on next expense</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modals */}
      {showAdd && (
        <BudgetFormModal
          categories={categories}
          existingBudgetCats={existingBudgetCats}
          onSave={data => createMut.mutate(data)}
          onClose={() => setShowAdd(false)}
        />
      )}
      {editing && (
        <BudgetFormModal
          initial={editing}
          categories={categories}
          existingBudgetCats={existingBudgetCats}
          onSave={data => updateMut.mutate({ id: editing.id, data })}
          onClose={() => setEditing(null)}
        />
      )}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
          <div className="bg-card border border-border rounded-xl w-full max-w-sm shadow-2xl p-5 space-y-4">
            <h2 className="font-semibold text-slate-200">Remove Budget</h2>
            <p className="text-sm text-slate-400">
              Remove the budget limit for <strong className="text-slate-200">{confirming.category}</strong>?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirming(null)}
                className="flex-1 py-2 rounded-lg text-sm text-slate-400 border border-border hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMut.mutate(confirming.id)}
                className="flex-1 py-2 rounded-lg text-sm font-medium bg-rose-600 hover:bg-rose-500 text-white transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
