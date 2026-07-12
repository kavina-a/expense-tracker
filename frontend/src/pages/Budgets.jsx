import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getBudgets, createBudget, updateBudget, deleteBudget, getCategories } from '../api'
import { Plus, Pencil, Trash2, X, AlertTriangle } from 'lucide-react'

function currentMonthStr() {
  return new Date().toLocaleDateString('sv-SE').slice(0, 7)
}

function fmtRs(n) {
  return `LKR ${Number(n).toLocaleString('en-US')}`
}

function ProgressBar({ pct, color }) {
  const capped = Math.min(pct, 100)
  const track = pct >= 100 ? '#FF4D4D' : pct >= 80 ? '#FFB800' : (color || '#2FD675')
  return (
    <div className="h-2.5 bg-white border-2 border-ink rounded-full overflow-hidden">
      <div
        className="h-full transition-all duration-500 border-r-2 border-ink"
        style={{ width: `${capped}%`, backgroundColor: track }}
      />
    </div>
  )
}

function StatusDot({ pct }) {
  if (pct >= 100) return <span className="w-2.5 h-2.5 rounded-full bg-terra border border-ink shrink-0 animate-pulse" />
  if (pct >= 80) return <span className="w-2.5 h-2.5 rounded-full bg-amber border border-ink shrink-0" />
  return <span className="w-2.5 h-2.5 rounded-full bg-sage border border-ink shrink-0" />
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
      <div className="bg-white border-2 border-ink shadow-brutal-lg rounded-hero w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b-2 border-ink">
          <h2 className="font-bold text-ink">{initial ? 'Edit Budget' : 'Set Budget'}</h2>
          <button onClick={onClose} className="text-warm-400 hover:text-terra p-1 rounded-item hover:bg-warm-100">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-[11px] font-bold text-warm-600 tracking-wide mb-2">CATEGORY</label>
            {initial ? (
              <div className="px-3 py-2.5 bg-cream border-2 border-ink rounded-item text-sm font-bold text-ink">
                {initial.category}
              </div>
            ) : (
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full px-3 py-2.5 bg-cream border-2 border-ink rounded-item text-sm font-bold text-ink focus:outline-none"
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
            <label className="block text-[11px] font-bold text-warm-600 tracking-wide mb-2">MONTHLY LIMIT (LKR)</label>
            <input
              type="number"
              value={limit}
              onChange={e => setLimit(e.target.value)}
              placeholder="e.g. 5000"
              min="1"
              className="w-full px-3 py-2.5 bg-cream border-2 border-ink rounded-item text-sm font-bold text-ink placeholder-warm-400 focus:outline-none"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-item text-sm font-bold text-warm-600 border-2 border-ink hover:bg-warm-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 rounded-item text-sm font-bold uppercase tracking-wide bg-terra hover:bg-terra-dark text-white transition-all border-2 border-ink shadow-brutal-sm hover:shadow-none hover:translate-x-[3px] hover:translate-y-[3px]"
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
          <h1 className="text-2xl font-bold text-ink uppercase tracking-tight">Budgets</h1>
          <p className="text-[11px] font-bold text-warm-600 tracking-wide mt-1">
            {budgets.length} ACTIVE · {new Date().toLocaleString('default', { month: 'long', year: 'numeric' }).toUpperCase()}
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-item text-sm font-bold uppercase tracking-wide bg-terra hover:bg-terra-dark text-white transition-all border-2 border-ink shadow-brutal-sm hover:shadow-none hover:translate-x-[3px] hover:translate-y-[3px]"
        >
          <Plus size={14} />
          Set budget
        </button>
      </div>

      {overBudget.length > 0 && (
        <div className="mb-4 p-3.5 rounded-card border-2 border-ink bg-amber shadow-brutal-sm flex items-start gap-2.5">
          <AlertTriangle size={15} className="text-ink shrink-0 mt-0.5" />
          <p className="text-xs font-bold text-ink">
            <strong>{overBudget.length} {overBudget.length === 1 ? 'category' : 'categories'}</strong> near or over budget: {overBudget.map(b => b.category).join(', ')}
          </p>
        </div>
      )}

      {budgetsQ.isLoading ? (
        <div className="text-center py-16 text-warm-500 text-sm">Loading...</div>
      ) : budgets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <span className="text-4xl">🎯</span>
          <p className="text-sm font-bold text-warm-600">No budgets set yet</p>
          <p className="text-[11px] text-warm-400">Add limits to get Telegram alerts when you approach them</p>
          <button
            onClick={() => setShowAdd(true)}
            className="mt-2 px-4 py-2.5 rounded-item text-sm font-bold uppercase tracking-wide bg-terra text-white border-2 border-ink shadow-brutal-sm hover:shadow-none hover:translate-x-[3px] hover:translate-y-[3px] transition-all"
          >
            Set your first budget
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {budgets.map(b => {
            const pct     = b.monthly_limit ? Math.round((b.spent / b.monthly_limit) * 100) : 0
            const color   = colorMap[b.category] || '#525252'
            const catIcon = categories.find(c => c.name === b.category)?.icon || '📦'

            return (
              <div
                key={b.id}
                className="group p-4 rounded-card border-2 border-ink shadow-brutal-sm bg-white hover:shadow-brutal hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <StatusDot pct={pct} />
                    <span className="text-base">{catIcon}</span>
                    <div>
                      <p className="text-sm font-bold text-ink">{b.category}</p>
                      <p className="text-[11px] text-warm-500 mt-0.5">
                        {fmtRs(b.spent)} of {fmtRs(b.monthly_limit)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold tabular-nums ${
                      pct >= 100 ? 'text-terra' : pct >= 80 ? 'text-amber-dark' : 'text-sage-dark'
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
                  <span className="text-[10px] font-bold text-warm-400">{fmtRs(Math.max(0, b.monthly_limit - b.spent))} remaining</span>
                  {pct >= 80 && pct < 100 && (
                    <span className="text-[10px] text-amber-dark font-bold">Approaching limit</span>
                  )}
                  {pct >= 100 && (
                    <span className="text-[10px] text-terra font-bold">Over budget!</span>
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
          <div className="bg-white border-2 border-ink shadow-brutal-lg rounded-hero w-full max-w-sm p-5 space-y-4">
            <h2 className="font-bold text-ink">Remove Budget</h2>
            <p className="text-sm text-warm-600">
              Remove the budget limit for <strong className="text-ink">{confirming.category}</strong>?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirming(null)}
                className="flex-1 py-2.5 rounded-item text-sm font-bold text-warm-600 border-2 border-ink hover:bg-warm-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMut.mutate(confirming.id)}
                className="flex-1 py-2.5 rounded-item text-sm font-bold uppercase tracking-wide bg-terra hover:bg-terra-dark text-white transition-all border-2 border-ink shadow-brutal-sm hover:shadow-none hover:translate-x-[3px] hover:translate-y-[3px]"
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
