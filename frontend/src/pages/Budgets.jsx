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
  const track = pct >= 100 ? '#C4603A' : pct >= 80 ? '#D4933A' : (color || '#6B8F71')
  return (
    <div className="h-2 bg-warm-200/60 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${capped}%`, backgroundColor: track }}
      />
    </div>
  )
}

function StatusDot({ pct }) {
  if (pct >= 100) return <span className="w-2 h-2 rounded-full bg-terra shrink-0 animate-pulse" />
  if (pct >= 80) return <span className="w-2 h-2 rounded-full bg-amber shrink-0" />
  return <span className="w-2 h-2 rounded-full bg-sage shrink-0" />
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
      <div className="bg-white border border-border rounded-hero w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-medium text-neutral-800">{initial ? 'Edit Budget' : 'Set Budget'}</h2>
          <button onClick={onClose} className="text-warm-400 hover:text-terra p-1 rounded-item hover:bg-warm-100">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-[11px] font-medium text-warm-500 tracking-wide mb-2">CATEGORY</label>
            {initial ? (
              <div className="px-3 py-2.5 bg-cream border border-border rounded-item text-sm text-neutral-700">
                {initial.category}
              </div>
            ) : (
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full px-3 py-2.5 bg-cream border border-border rounded-item text-sm text-neutral-700 focus:outline-none focus:border-terra/40"
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
            <label className="block text-[11px] font-medium text-warm-500 tracking-wide mb-2">MONTHLY LIMIT (RS.)</label>
            <input
              type="number"
              value={limit}
              onChange={e => setLimit(e.target.value)}
              placeholder="e.g. 5000"
              min="1"
              className="w-full px-3 py-2.5 bg-cream border border-border rounded-item text-sm text-neutral-800 placeholder-warm-400 focus:outline-none focus:border-terra/40"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-item text-sm text-warm-500 border border-border hover:bg-warm-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 rounded-item text-sm font-medium bg-terra hover:bg-terra-dark text-white transition-colors"
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
  const [showAdd,    setShowAdd]    = useState(false)
  const [editing,    setEditing]    = useState(null)
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
  const overBudget = budgets.filter(b => (b.spent / b.monthly_limit) >= 0.8)

  return (
    <div className="p-5 md:p-8 max-w-3xl mx-auto md:mx-0">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-medium text-neutral-800">Budgets</h1>
          <p className="text-[11px] text-warm-500 tracking-wide mt-1">
            {budgets.length} ACTIVE · {new Date().toLocaleString('default', { month: 'long', year: 'numeric' }).toUpperCase()}
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-item text-sm font-medium bg-terra hover:bg-terra-dark text-white transition-colors"
        >
          <Plus size={14} />
          Set budget
        </button>
      </div>

      {overBudget.length > 0 && (
        <div className="mb-4 p-3.5 rounded-card border border-terra/20 bg-terra/5 flex items-start gap-2.5">
          <AlertTriangle size={15} className="text-terra shrink-0 mt-0.5" />
          <p className="text-xs text-terra">
            <strong>{overBudget.length} {overBudget.length === 1 ? 'category' : 'categories'}</strong> near or over budget: {overBudget.map(b => b.category).join(', ')}
          </p>
        </div>
      )}

      {budgetsQ.isLoading ? (
        <div className="text-center py-16 text-warm-500 text-sm">Loading...</div>
      ) : budgets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <span className="text-4xl">🎯</span>
          <p className="text-sm text-warm-600">No budgets set yet</p>
          <p className="text-[11px] text-warm-400">Add limits to get Telegram alerts when you approach them</p>
          <button
            onClick={() => setShowAdd(true)}
            className="mt-2 px-4 py-2.5 rounded-item text-sm font-medium bg-terra/10 text-terra border border-terra/20 hover:bg-terra/20 transition-colors"
          >
            Set your first budget
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {budgets.map(b => {
            const pct     = b.monthly_limit ? Math.round((b.spent / b.monthly_limit) * 100) : 0
            const color   = colorMap[b.category] || '#8F8274'
            const catIcon = categories.find(c => c.name === b.category)?.icon || '📦'

            return (
              <div
                key={b.id}
                className="group p-4 rounded-card border border-border bg-white hover:border-terra/30 transition-all"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <StatusDot pct={pct} />
                    <span className="text-base">{catIcon}</span>
                    <div>
                      <p className="text-sm font-medium text-neutral-800">{b.category}</p>
                      <p className="text-[11px] text-warm-500 mt-0.5">
                        {fmtRs(b.spent)} of {fmtRs(b.monthly_limit)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium tabular-nums ${
                      pct >= 100 ? 'text-terra' : pct >= 80 ? 'text-amber' : 'text-sage'
                    }`}>
                      {pct}%
                    </span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => setEditing(b)}
                        className="p-1.5 rounded-item text-warm-400 hover:text-terra hover:bg-warm-200/60 transition-colors"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => setConfirming(b)}
                        className="p-1.5 rounded-item text-warm-400 hover:text-terra hover:bg-terra/10 transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
                <ProgressBar pct={pct} color={color} />
                <div className="flex justify-between mt-1.5">
                  <span className="text-[10px] text-warm-400">{fmtRs(Math.max(0, b.monthly_limit - b.spent))} remaining</span>
                  {pct >= 80 && pct < 100 && (
                    <span className="text-[10px] text-amber font-medium">Approaching limit</span>
                  )}
                  {pct >= 100 && (
                    <span className="text-[10px] text-terra font-medium">Over budget!</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
          <div className="bg-white border border-border rounded-hero w-full max-w-sm p-5 space-y-4">
            <h2 className="font-medium text-neutral-800">Remove Budget</h2>
            <p className="text-sm text-warm-600">
              Remove the budget limit for <strong className="text-neutral-800">{confirming.category}</strong>?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirming(null)}
                className="flex-1 py-2.5 rounded-item text-sm text-warm-500 border border-border hover:bg-warm-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMut.mutate(confirming.id)}
                className="flex-1 py-2.5 rounded-item text-sm font-medium bg-terra hover:bg-terra-dark text-white transition-colors"
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
