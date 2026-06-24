import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getCategories, createCategory, updateCategory, getCategoryUsage, deleteCategory } from '../api'
import { Plus, Pencil, Trash2, X, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react'

const PRESET_COLORS = [
  '#f97316', '#ef4444', '#a855f7', '#3b82f6', '#06b6d4',
  '#22c55e', '#10b981', '#eab308', '#84cc16', '#14b8a6',
  '#6366f1', '#ec4899', '#6b7280',
]

const PRESET_ICONS = [
  '🍜','⛽','🛒','💡','🎬','💊','📚','💰','📦','🏠',
  '✈️','🎵','💻','☕','🍕','🎯','🏋️','🛍️','🎁','💈',
  '🚗','🏥','📱','💎','🌿','🍺','🎮','💼','🎓','📖',
  '📈','📊','🤖','🎂','💑','🤲','🛵','🚌','🍟','🫖',
]

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="bg-card border border-border rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-semibold text-slate-200">{title}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 p-1 rounded-lg hover:bg-white/5">
            <X size={16} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

function CategoryForm({ initial, onSave, onCancel }) {
  const [name,  setName]  = useState(initial?.name  || '')
  const [icon,  setIcon]  = useState(initial?.icon  || '📦')
  const [color, setColor] = useState(initial?.color || '#6b7280')
  const [type,  setType]  = useState(initial?.type  || 'expense')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!name.trim()) return
    onSave({ name: name.trim(), icon, color, type })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Type toggle */}
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1.5">Category Type</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setType('income')}
            className={`flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium border transition-all
              ${type === 'income'
                ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-400'
                : 'border-border text-slate-500 hover:bg-white/5'}`}
          >
            <TrendingUp size={14} /> Income
          </button>
          <button
            type="button"
            onClick={() => setType('expense')}
            className={`flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium border transition-all
              ${type === 'expense'
                ? 'bg-rose-600/20 border-rose-500/50 text-rose-400'
                : 'border-border text-slate-500 hover:bg-white/5'}`}
          >
            <TrendingDown size={14} /> Expense
          </button>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1.5">Category Name</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Side Hustle"
          className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50"
          autoFocus
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1.5">Icon</label>
        <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-1">
          {PRESET_ICONS.map(em => (
            <button
              key={em}
              type="button"
              onClick={() => setIcon(em)}
              className={`w-8 h-8 text-base rounded-lg flex items-center justify-center transition-all
                ${icon === em ? 'bg-indigo-600/30 ring-1 ring-indigo-500/60' : 'hover:bg-white/5'}`}
            >
              {em}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1.5">Color</label>
        <div className="flex flex-wrap gap-2">
          {PRESET_COLORS.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={`w-7 h-7 rounded-full transition-all ${color === c ? 'ring-2 ring-white/60 ring-offset-1 ring-offset-card scale-110' : 'hover:scale-105'}`}
              style={{ backgroundColor: c }}
            />
          ))}
          <input
            type="color"
            value={color}
            onChange={e => setColor(e.target.value)}
            className="w-7 h-7 rounded-full cursor-pointer border border-border bg-transparent"
            title="Custom color"
          />
        </div>
      </div>

      {/* Preview */}
      <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-surface">
        <span className="text-lg">{icon}</span>
        <span className="text-sm font-medium" style={{ color }}>{name || 'Category name'}</span>
        <span className={`text-xs ml-auto px-2 py-0.5 rounded-full ${type === 'income' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
          {type}
        </span>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-2 rounded-lg text-sm text-slate-400 border border-border hover:bg-white/5 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="flex-1 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
        >
          {initial ? 'Save changes' : 'Add category'}
        </button>
      </div>
    </form>
  )
}

function fmtRs(n) {
  return `Rs. ${Number(n).toLocaleString('en-IN')}`
}

function CategoryGrid({ title, icon: Icon, iconClass, categories, onEdit, onDelete }) {
  if (!categories.length) return null
  return (
    <div className="mb-8">
      <div className={`flex items-center gap-2 mb-3`}>
        <Icon size={15} className={iconClass} />
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">{title}</h2>
        <span className="text-xs text-slate-600 bg-white/5 px-2 py-0.5 rounded-full">{categories.length}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {categories.map(cat => (
          <div
            key={cat.id}
            className="group flex items-center gap-3 p-4 rounded-xl border border-border bg-card hover:border-slate-600 transition-all"
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
              style={{ backgroundColor: cat.color + '22', border: `1px solid ${cat.color}44` }}
            >
              {cat.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-200 truncate">{cat.name}</p>
              <p className="text-xs mt-0.5" style={{ color: cat.color }}>{cat.color}</p>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => onEdit(cat)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
              >
                <Pencil size={13} />
              </button>
              <button
                onClick={() => onDelete(cat)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Categories() {
  const [showAdd,    setShowAdd]    = useState(false)
  const [editing,    setEditing]    = useState(null)
  const [deleteInfo, setDeleteInfo] = useState(null) // { cat, usageData | null, loading }

  const qc = useQueryClient()
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['categories'] })
    qc.invalidateQueries({ queryKey: ['transactions'] })
    qc.invalidateQueries({ queryKey: ['summary'] })
    qc.invalidateQueries({ queryKey: ['budgets'] })
  }

  const categoriesQ = useQuery({ queryKey: ['categories'], queryFn: getCategories })

  const createMut = useMutation({ mutationFn: createCategory, onSuccess: () => { invalidate(); setShowAdd(false) } })
  const updateMut = useMutation({
    mutationFn: ({ id, data }) => updateCategory(id, data),
    onSuccess: () => { invalidate(); setEditing(null) },
  })
  const deleteMut = useMutation({
    mutationFn: deleteCategory,
    onSuccess: () => { invalidate(); setDeleteInfo(null) },
  })

  const categories = categoriesQ.data || []
  const incomeCategories  = categories.filter(c => c.type === 'income')
  const expenseCategories = categories.filter(c => c.type === 'expense' || !c.type)

  async function handleDeleteClick(cat) {
    setDeleteInfo({ cat, usageData: null, loading: true })
    try {
      const usage = await getCategoryUsage(cat.id)
      setDeleteInfo({ cat, usageData: usage, loading: false })
    } catch {
      setDeleteInfo({ cat, usageData: { txCount: 0, budgetCount: 0, recentTx: [] }, loading: false })
    }
  }

  const isBlocked = deleteInfo?.usageData && (deleteInfo.usageData.txCount > 0 || deleteInfo.usageData.budgetCount > 0)

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Categories</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {incomeCategories.length} income · {expenseCategories.length} expense · used live by the AI parser
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
        >
          <Plus size={14} />
          Add category
        </button>
      </div>

      {categoriesQ.isLoading ? (
        <div className="text-center py-16 text-slate-500 text-sm">Loading...</div>
      ) : (
        <>
          <CategoryGrid
            title="Income"
            icon={TrendingUp}
            iconClass="text-emerald-400"
            categories={incomeCategories}
            onEdit={setEditing}
            onDelete={handleDeleteClick}
          />
          <CategoryGrid
            title="Expenses"
            icon={TrendingDown}
            iconClass="text-rose-400"
            categories={expenseCategories}
            onEdit={setEditing}
            onDelete={handleDeleteClick}
          />
        </>
      )}

      {/* Add modal */}
      {showAdd && (
        <Modal title="New Category" onClose={() => setShowAdd(false)}>
          <CategoryForm
            onSave={data => createMut.mutate(data)}
            onCancel={() => setShowAdd(false)}
          />
        </Modal>
      )}

      {/* Edit modal */}
      {editing && (
        <Modal title="Edit Category" onClose={() => setEditing(null)}>
          <CategoryForm
            initial={editing}
            onSave={data => updateMut.mutate({ id: editing.id, data })}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}

      {/* Delete modal */}
      {deleteInfo && (
        <Modal
          title={isBlocked ? 'Cannot Delete Category' : 'Delete Category'}
          onClose={() => setDeleteInfo(null)}
        >
          {deleteInfo.loading ? (
            <p className="text-sm text-slate-400 text-center py-4">Checking usage…</p>
          ) : isBlocked ? (
            <div className="space-y-4">
              {/* Blocked state */}
              <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-400/5 border border-amber-400/20">
                <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
                <p className="text-sm text-amber-300">
                  <strong className="text-amber-200">{deleteInfo.cat.icon} {deleteInfo.cat.name}</strong> is still in use and cannot be deleted.
                </p>
              </div>

              <div className="space-y-2 text-sm text-slate-400">
                {deleteInfo.usageData.txCount > 0 && (
                  <p>• Used in <strong className="text-slate-200">{deleteInfo.usageData.txCount} transaction{deleteInfo.usageData.txCount !== 1 ? 's' : ''}</strong></p>
                )}
                {deleteInfo.usageData.budgetCount > 0 && (
                  <p>• Has <strong className="text-slate-200">{deleteInfo.usageData.budgetCount} budget{deleteInfo.usageData.budgetCount !== 1 ? 's' : ''}</strong> set</p>
                )}
              </div>

              {deleteInfo.usageData.recentTx?.length > 0 && (
                <div>
                  <p className="text-xs text-slate-500 mb-2">Recent transactions in this category:</p>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {deleteInfo.usageData.recentTx.map((tx, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface text-xs">
                        <span className="text-slate-400">{tx.date}</span>
                        <span className="text-slate-300 truncate mx-2">{tx.description || '—'}</span>
                        <span className={tx.type === 'income' ? 'text-emerald-400' : 'text-rose-400'}>
                          {tx.type === 'income' ? '+' : '-'}{fmtRs(tx.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-xs text-slate-500">
                To delete this category, first reassign or remove its transactions from the Transactions page, then delete any budgets for it.
              </p>

              <button
                onClick={() => setDeleteInfo(null)}
                className="w-full py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
              >
                Got it
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Safe to delete */}
              <p className="text-sm text-slate-300">
                Delete <strong className="text-slate-100">{deleteInfo.cat.icon} {deleteInfo.cat.name}</strong>?
              </p>
              <p className="text-xs text-slate-500 bg-white/5 rounded-lg p-3">
                This category has no transactions or budgets. It can be safely removed.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setDeleteInfo(null)}
                  className="flex-1 py-2 rounded-lg text-sm text-slate-400 border border-border hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteMut.mutate(deleteInfo.cat.id)}
                  disabled={deleteMut.isPending}
                  className="flex-1 py-2 rounded-lg text-sm font-medium bg-rose-600 hover:bg-rose-500 text-white transition-colors disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
