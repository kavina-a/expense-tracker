import { useState, lazy, Suspense } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getCategories, createCategory, updateCategory, getCategoryUsage, deleteCategory } from '../api'
import { Plus, Pencil, Trash2, X, AlertTriangle, TrendingUp, TrendingDown, SmilePlus } from 'lucide-react'
import data from '@emoji-mart/data'
import Picker from '@emoji-mart/react'

const PRESET_COLORS = [
  '#C4603A', '#6B8F71', '#D4933A', '#6366f1', '#3b82f6',
  '#22c55e', '#ef4444', '#a855f7', '#06b6d4', '#ec4899',
  '#14b8a6', '#eab308', '#6b7280',
]

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
      <div className="bg-white border border-border rounded-hero w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-medium text-neutral-800">{title}</h2>
          <button onClick={onClose} className="text-warm-400 hover:text-terra p-1 rounded-item hover:bg-warm-100">
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
  const [showPicker, setShowPicker] = useState(false)

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!name.trim()) return
    onSave({ name: name.trim(), icon, color, type })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-[11px] font-medium text-warm-500 tracking-wide mb-2">TYPE</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setType('income')}
            className={`flex items-center justify-center gap-2 py-2.5 rounded-item text-sm font-medium border transition-all
              ${type === 'income'
                ? 'bg-sage/10 border-sage/30 text-sage'
                : 'border-border text-warm-500 hover:bg-warm-100'}`}
          >
            <TrendingUp size={14} /> Income
          </button>
          <button
            type="button"
            onClick={() => setType('expense')}
            className={`flex items-center justify-center gap-2 py-2.5 rounded-item text-sm font-medium border transition-all
              ${type === 'expense'
                ? 'bg-terra/10 border-terra/30 text-terra'
                : 'border-border text-warm-500 hover:bg-warm-100'}`}
          >
            <TrendingDown size={14} /> Expense
          </button>
        </div>
      </div>

      <div>
        <label className="block text-[11px] font-medium text-warm-500 tracking-wide mb-2">NAME</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Side Hustle"
          className="w-full px-3 py-2.5 bg-cream border border-border rounded-item text-sm text-neutral-800 placeholder-warm-400 focus:outline-none focus:border-terra/40"
          autoFocus
        />
      </div>

      <div>
        <label className="block text-[11px] font-medium text-warm-500 tracking-wide mb-2">ICON</label>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-item flex items-center justify-center text-2xl bg-warm-100 border border-border">
            {icon}
          </div>
          <button
            type="button"
            onClick={() => setShowPicker(p => !p)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-item text-xs font-medium border border-border text-warm-600 hover:text-terra hover:border-terra/30 transition-colors"
          >
            <SmilePlus size={14} />
            {showPicker ? 'Close' : 'Choose emoji'}
          </button>
        </div>
        {showPicker && (
          <div className="rounded-item overflow-hidden border border-border">
            <Picker
              data={data}
              onEmojiSelect={(emoji) => { setIcon(emoji.native); setShowPicker(false) }}
              theme="light"
              previewPosition="none"
              skinTonePosition="none"
              maxFrequentRows={1}
              perLine={8}
            />
          </div>
        )}
      </div>

      <div>
        <label className="block text-[11px] font-medium text-warm-500 tracking-wide mb-2">COLOR</label>
        <div className="flex flex-wrap gap-2">
          {PRESET_COLORS.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={`w-7 h-7 rounded-full transition-all ${color === c ? 'ring-2 ring-neutral-800/40 ring-offset-1 ring-offset-white scale-110' : 'hover:scale-105'}`}
              style={{ backgroundColor: c }}
            />
          ))}
          <input
            type="color"
            value={color}
            onChange={e => setColor(e.target.value)}
            className="w-7 h-7 rounded-full cursor-pointer border border-border bg-transparent"
          />
        </div>
      </div>

      {/* Preview */}
      <div className="flex items-center gap-3 p-3 rounded-item border border-border bg-cream">
        <span className="text-lg">{icon}</span>
        <span className="text-sm font-medium" style={{ color }}>{name || 'Category name'}</span>
        <span className={`text-[11px] ml-auto px-2 py-0.5 rounded-full ${type === 'income' ? 'bg-sage/10 text-sage' : 'bg-terra/10 text-terra'}`}>
          {type}
        </span>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-2.5 rounded-item text-sm text-warm-500 border border-border hover:bg-warm-100 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="flex-1 py-2.5 rounded-item text-sm font-medium bg-terra hover:bg-terra-dark text-white transition-colors"
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
      <div className="flex items-center gap-2 mb-3">
        <Icon size={15} className={iconClass} />
        <h2 className="text-[11px] font-medium text-warm-500 tracking-wide">{title.toUpperCase()}</h2>
        <span className="text-[11px] text-warm-400 bg-warm-200/60 px-2 py-0.5 rounded-full">{categories.length}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {categories.map(cat => (
          <div
            key={cat.id}
            className="group flex items-center gap-3 p-4 rounded-card border border-border bg-white hover:border-terra/30 transition-all"
          >
            <div
              className="w-10 h-10 rounded-item flex items-center justify-center text-xl shrink-0"
              style={{ backgroundColor: cat.color + '15' }}
            >
              {cat.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-neutral-800 truncate">{cat.name}</p>
              <div className="flex items-center gap-1 mt-0.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
                <p className="text-[11px] text-warm-400">{cat.color}</p>
              </div>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => onEdit(cat)}
                className="p-1.5 rounded-item text-warm-400 hover:text-terra hover:bg-warm-200/60 transition-colors"
              >
                <Pencil size={13} />
              </button>
              <button
                onClick={() => onDelete(cat)}
                className="p-1.5 rounded-item text-warm-400 hover:text-terra hover:bg-terra/10 transition-colors"
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
  const [deleteInfo, setDeleteInfo] = useState(null)

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
    <div className="p-5 md:p-8 max-w-4xl mx-auto md:mx-0">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-medium text-neutral-800">Categories</h1>
          <p className="text-[11px] text-warm-500 tracking-wide mt-1">
            {incomeCategories.length} INCOME · {expenseCategories.length} EXPENSE
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-item text-sm font-medium bg-terra hover:bg-terra-dark text-white transition-colors"
        >
          <Plus size={14} />
          Add category
        </button>
      </div>

      {categoriesQ.isLoading ? (
        <div className="text-center py-16 text-warm-500 text-sm">Loading...</div>
      ) : (
        <>
          <CategoryGrid
            title="Income"
            icon={TrendingUp}
            iconClass="text-sage"
            categories={incomeCategories}
            onEdit={setEditing}
            onDelete={handleDeleteClick}
          />
          <CategoryGrid
            title="Expenses"
            icon={TrendingDown}
            iconClass="text-terra"
            categories={expenseCategories}
            onEdit={setEditing}
            onDelete={handleDeleteClick}
          />
        </>
      )}

      {showAdd && (
        <Modal title="New Category" onClose={() => setShowAdd(false)}>
          <CategoryForm
            onSave={data => createMut.mutate(data)}
            onCancel={() => setShowAdd(false)}
          />
        </Modal>
      )}

      {editing && (
        <Modal title="Edit Category" onClose={() => setEditing(null)}>
          <CategoryForm
            initial={editing}
            onSave={data => updateMut.mutate({ id: editing.id, data })}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}

      {deleteInfo && (
        <Modal
          title={isBlocked ? 'Cannot Delete Category' : 'Delete Category'}
          onClose={() => setDeleteInfo(null)}
        >
          {deleteInfo.loading ? (
            <p className="text-sm text-warm-500 text-center py-4">Checking usage…</p>
          ) : isBlocked ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-3 rounded-item bg-amber/5 border border-amber/20">
                <AlertTriangle size={16} className="text-amber mt-0.5 shrink-0" />
                <p className="text-sm text-neutral-700">
                  <strong className="text-neutral-800">{deleteInfo.cat.icon} {deleteInfo.cat.name}</strong> is still in use.
                </p>
              </div>

              <div className="space-y-2 text-sm text-warm-600">
                {deleteInfo.usageData.txCount > 0 && (
                  <p>• Used in <strong className="text-neutral-800">{deleteInfo.usageData.txCount} transaction{deleteInfo.usageData.txCount !== 1 ? 's' : ''}</strong></p>
                )}
                {deleteInfo.usageData.budgetCount > 0 && (
                  <p>• Has <strong className="text-neutral-800">{deleteInfo.usageData.budgetCount} budget{deleteInfo.usageData.budgetCount !== 1 ? 's' : ''}</strong> set</p>
                )}
              </div>

              {deleteInfo.usageData.recentTx?.length > 0 && (
                <div>
                  <p className="text-[11px] text-warm-500 tracking-wide mb-2">RECENT TRANSACTIONS</p>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {deleteInfo.usageData.recentTx.map((tx, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-2 rounded-item bg-cream text-xs">
                        <span className="text-warm-500">{tx.date}</span>
                        <span className="text-neutral-700 truncate mx-2">{tx.description || '—'}</span>
                        <span className={tx.type === 'income' ? 'text-sage' : 'text-terra'}>
                          {tx.type === 'income' ? '+' : '-'}{fmtRs(tx.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={() => setDeleteInfo(null)}
                className="w-full py-2.5 rounded-item text-sm font-medium bg-terra hover:bg-terra-dark text-white transition-colors"
              >
                Got it
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-neutral-700">
                Delete <strong className="text-neutral-800">{deleteInfo.cat.icon} {deleteInfo.cat.name}</strong>?
              </p>
              <p className="text-xs text-warm-500 bg-cream rounded-item p-3">
                This category has no transactions or budgets and can be safely removed.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setDeleteInfo(null)}
                  className="flex-1 py-2.5 rounded-item text-sm text-warm-500 border border-border hover:bg-warm-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteMut.mutate(deleteInfo.cat.id)}
                  disabled={deleteMut.isPending}
                  className="flex-1 py-2.5 rounded-item text-sm font-medium bg-terra hover:bg-terra-dark text-white transition-colors disabled:opacity-50"
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
