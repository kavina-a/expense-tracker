import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getCategories, createCategory, updateCategory, getCategoryUsage, deleteCategory, getTransactions } from '../api'
import { Plus, Pencil, Trash2, X, AlertTriangle, TrendingUp, TrendingDown, LineChart, SmilePlus, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import data from '@emoji-mart/data'
import Picker from '@emoji-mart/react'

function currentMonthStr() {
  return new Date().toLocaleDateString('sv-SE').slice(0, 7)
}

function formatMonthLabel(m) {
  if (!m) return ''
  const [y, mo] = m.split('-')
  return new Date(parseInt(y), parseInt(mo) - 1).toLocaleString('default', { month: 'short', year: 'numeric' })
}

function fmtDateLabel(dateStr) {
  const today     = new Date().toLocaleDateString('sv-SE')
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE')
  if (dateStr === today)     return 'Today'
  if (dateStr === yesterday) return 'Yesterday'
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' })
}

const RANGE_OPTIONS = [
  { label: 'This month',    months: 1 },
  { label: 'Last 3 months', months: 3 },
  { label: 'Last 6 months', months: 6 },
  { label: 'All time',      months: null },
]

const PRESET_COLORS = [
  '#FF4D4D', '#FF8A8A', '#2FD675', '#7CEBA6', '#6C5CE7',
  '#9C90F5', '#FFB800', '#FFD666', '#FF9F1C', '#00C2D1',
  '#0A0A0A', '#4A4038', '#FFFFFF',
]

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
      <div className="bg-white border-2 border-ink shadow-brutal-lg rounded-hero w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b-2 border-ink">
          <h2 className="font-bold text-ink">{title}</h2>
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
  const [color, setColor] = useState(initial?.color || '#525252')
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
        <label className="block text-[11px] font-bold text-warm-600 tracking-wide mb-2">TYPE</label>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setType('income')}
            className={`flex items-center justify-center gap-1.5 py-2.5 rounded-item text-sm font-bold border-2 transition-all
              ${type === 'income'
                ? 'bg-sage border-ink text-white shadow-brutal-xs'
                : 'border-ink text-warm-500 hover:bg-warm-100'}`}
          >
            <TrendingUp size={14} /> Income
          </button>
          <button
            type="button"
            onClick={() => setType('expense')}
            className={`flex items-center justify-center gap-1.5 py-2.5 rounded-item text-sm font-bold border-2 transition-all
              ${type === 'expense'
                ? 'bg-terra border-ink text-white shadow-brutal-xs'
                : 'border-ink text-warm-500 hover:bg-warm-100'}`}
          >
            <TrendingDown size={14} /> Expense
          </button>
          <button
            type="button"
            onClick={() => setType('investment')}
            className={`flex items-center justify-center gap-1.5 py-2.5 rounded-item text-sm font-bold border-2 transition-all
              ${type === 'investment'
                ? 'bg-invest border-ink text-white shadow-brutal-xs'
                : 'border-ink text-warm-500 hover:bg-warm-100'}`}
          >
            <LineChart size={14} /> Invest
          </button>
        </div>
      </div>

      <div>
        <label className="block text-[11px] font-bold text-warm-600 tracking-wide mb-2">NAME</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Side Hustle"
          className="w-full px-3 py-2.5 bg-cream border-2 border-ink rounded-item text-sm font-bold text-ink placeholder-warm-400 focus:outline-none focus:border-terra"
          autoFocus
        />
      </div>

      <div>
        <label className="block text-[11px] font-bold text-warm-600 tracking-wide mb-2">ICON</label>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-item flex items-center justify-center text-2xl bg-warm-100 border-2 border-ink">
            {icon}
          </div>
          <button
            type="button"
            onClick={() => setShowPicker(p => !p)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-item text-xs font-bold border-2 border-ink text-warm-600 hover:text-terra transition-colors"
          >
            <SmilePlus size={14} />
            {showPicker ? 'Close' : 'Choose emoji'}
          </button>
        </div>
        {showPicker && (
          <div className="rounded-item overflow-hidden border-2 border-ink">
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
        <label className="block text-[11px] font-bold text-warm-600 tracking-wide mb-2">COLOR</label>
        <div className="flex flex-wrap gap-2">
          {PRESET_COLORS.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={`w-7 h-7 rounded-full border-2 border-ink transition-all ${color === c ? 'shadow-brutal-xs scale-110' : 'hover:scale-105'}`}
              style={{ backgroundColor: c }}
            />
          ))}
          <input
            type="color"
            value={color}
            onChange={e => setColor(e.target.value)}
            className="w-7 h-7 rounded-full cursor-pointer border-2 border-ink bg-transparent"
          />
        </div>
      </div>

      {/* Preview */}
      <div className="flex items-center gap-3 p-3 rounded-item border-2 border-ink bg-cream">
        <span className="text-lg">{icon}</span>
        <span className="text-sm font-bold" style={{ color }}>{name || 'Category name'}</span>
        <span className={`text-[11px] font-bold ml-auto px-2 py-0.5 rounded-full border border-ink ${
          type === 'income' ? 'bg-sage text-white' : type === 'investment' ? 'bg-invest text-white' : 'bg-terra text-white'
        }`}>
          {type}
        </span>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-2.5 rounded-item text-sm font-bold text-warm-600 border-2 border-ink hover:bg-warm-100 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="flex-1 py-2.5 rounded-item text-sm font-bold uppercase tracking-wide bg-terra hover:bg-terra-dark text-white transition-all border-2 border-ink shadow-brutal-sm hover:shadow-none hover:translate-x-[3px] hover:translate-y-[3px]"
        >
          {initial ? 'Save changes' : 'Add category'}
        </button>
      </div>
    </form>
  )
}

function fmtRs(n) {
  return `LKR ${Number(n).toLocaleString('en-US')}`
}

function CategoryDetail({ category }) {
  const [rangeMonths, setRangeMonths] = useState(1)
  const [monthOffset, setMonthOffset] = useState(0)

  const month = useMemo(() => {
    if (rangeMonths !== 1) return undefined // multi-month/all-time ranges aren't scoped to a single month
    const [y, mo] = currentMonthStr().split('-').map(Number)
    const d = new Date(y, mo - 1 + monthOffset, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }, [rangeMonths, monthOffset])

  const txQ = useQuery({
    queryKey: ['category-transactions', category.name, rangeMonths, month],
    queryFn: () => getTransactions({ category: category.name, month, limit: 100 }),
  })

  // Client-side window for multi-month ranges (API only filters by exact month or none)
  const rows = useMemo(() => {
    const all = txQ.data || []
    if (rangeMonths === 1 || rangeMonths == null) return all
    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - rangeMonths)
    const cutoffStr = cutoff.toLocaleDateString('sv-SE')
    return all.filter(t => t.date >= cutoffStr)
  }, [txQ.data, rangeMonths])

  const total = rows.reduce((s, t) => s + t.amount, 0)
  const signColor = category.type === 'income' ? 'text-sage-dark' : category.type === 'investment' ? 'text-invest' : 'text-terra'

  return (
    <div className="mt-3 pt-3 border-t-2 border-ink/15" onClick={e => e.stopPropagation()}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex flex-wrap gap-1.5">
          {RANGE_OPTIONS.map(r => (
            <button
              key={r.label}
              onClick={() => { setRangeMonths(r.months); setMonthOffset(0) }}
              className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-colors ${
                rangeMonths === r.months ? 'bg-terra text-white border-2 border-ink' : 'bg-warm-100 text-warm-500 hover:text-terra'
              }`}
            >{r.label}</button>
          ))}
        </div>
        {rangeMonths === 1 && (
          <div className="flex items-center gap-1">
            <button onClick={() => setMonthOffset(o => o - 1)} className="p-1 rounded-item text-warm-400 hover:text-terra"><ChevronLeft size={13} /></button>
            <span className="text-[10px] font-bold text-warm-500 min-w-[80px] text-center">{formatMonthLabel(month)}</span>
            <button onClick={() => setMonthOffset(o => Math.min(o + 1, 0))} disabled={monthOffset === 0} className="p-1 rounded-item text-warm-400 hover:text-terra disabled:opacity-30"><ChevronRight size={13} /></button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-[11px] font-bold text-warm-500">{rows.length} transaction{rows.length !== 1 ? 's' : ''}</span>
        <span className={`text-sm font-bold tabular-nums ${signColor}`}>LKR {total.toLocaleString('en-US')}</span>
      </div>

      <div className="max-h-64 overflow-y-auto rounded-item border-2 border-ink/15">
        {txQ.isLoading ? (
          <p className="text-xs text-warm-500 text-center py-6">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-warm-500 text-center py-6">No transactions in this range.</p>
        ) : (
          rows.map(tx => (
            <div key={tx.id} className="flex items-center justify-between px-3 py-2 bg-cream/50 border-b border-ink/10 last:border-0 text-xs">
              <div className="min-w-0">
                <p className="text-ink font-bold truncate">{tx.description || tx.category}</p>
                <p className="text-[10px] text-warm-400 mt-0.5">{fmtDateLabel(tx.date)}</p>
              </div>
              <span className={`font-bold tabular-nums shrink-0 ml-2 ${signColor}`}>LKR {tx.amount.toLocaleString('en-US')}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function CategoryGrid({ title, icon: Icon, iconClass, categories, onEdit, onDelete, expandedId, onToggleExpand }) {
  if (!categories.length) return null
  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-3">
        <Icon size={15} className={iconClass} />
        <h2 className="text-[11px] font-bold text-warm-600 tracking-wide">{title.toUpperCase()}</h2>
        <span className="text-[11px] font-bold text-warm-500 bg-white border-2 border-ink px-2 py-0.5 rounded-full">{categories.length}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-start">
        {categories.map(cat => {
          const isOpen = expandedId === cat.id
          return (
            <div
              key={cat.id}
              onClick={() => onToggleExpand(cat.id)}
              className={`group p-4 rounded-card border-2 border-ink bg-white transition-all cursor-pointer ${isOpen ? 'shadow-brutal-sm' : 'shadow-brutal-xs hover:shadow-brutal-sm hover:-translate-x-0.5 hover:-translate-y-0.5'}`}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-item flex items-center justify-center text-xl shrink-0 border-2 border-ink"
                  style={{ backgroundColor: cat.color }}
                >
                  {cat.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-ink truncate">{cat.name}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
                    <p className="text-[11px] text-warm-400">{cat.color}</p>
                  </div>
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
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
                <ChevronDown size={14} className={`text-warm-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </div>
              {isOpen && <CategoryDetail category={cat} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function Categories() {
  const [showAdd,    setShowAdd]    = useState(false)
  const [editing,    setEditing]    = useState(null)
  const [deleteInfo, setDeleteInfo] = useState(null)
  const [expandedId, setExpandedId] = useState(null)

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
  const incomeCategories     = categories.filter(c => c.type === 'income')
  const expenseCategories    = categories.filter(c => c.type === 'expense' || !c.type)
  const investmentCategories = categories.filter(c => c.type === 'investment')

  function toggleExpand(id) {
    setExpandedId(prev => (prev === id ? null : id))
  }

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
          <h1 className="text-2xl font-bold text-ink uppercase tracking-tight">Categories</h1>
          <p className="text-[11px] font-bold text-warm-600 tracking-wide mt-1">
            {incomeCategories.length} INCOME · {expenseCategories.length} EXPENSE · {investmentCategories.length} INVESTMENT
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-item text-sm font-bold uppercase tracking-wide bg-terra hover:bg-terra-dark text-white transition-all border-2 border-ink shadow-brutal-sm hover:shadow-none hover:translate-x-[3px] hover:translate-y-[3px]"
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
            expandedId={expandedId}
            onToggleExpand={toggleExpand}
          />
          <CategoryGrid
            title="Expenses"
            icon={TrendingDown}
            iconClass="text-terra"
            categories={expenseCategories}
            onEdit={setEditing}
            onDelete={handleDeleteClick}
            expandedId={expandedId}
            onToggleExpand={toggleExpand}
          />
          <CategoryGrid
            title="Investments"
            icon={LineChart}
            iconClass="text-invest"
            categories={investmentCategories}
            onEdit={setEditing}
            onDelete={handleDeleteClick}
            expandedId={expandedId}
            onToggleExpand={toggleExpand}
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
              <div className="flex items-start gap-3 p-3 rounded-item bg-amber border-2 border-ink">
                <AlertTriangle size={16} className="text-ink mt-0.5 shrink-0" />
                <p className="text-sm font-bold text-ink">
                  <strong className="text-ink">{deleteInfo.cat.icon} {deleteInfo.cat.name}</strong> is still in use.
                </p>
              </div>

              <div className="space-y-2 text-sm text-warm-600">
                {deleteInfo.usageData.txCount > 0 && (
                  <p>• Used in <strong className="text-ink">{deleteInfo.usageData.txCount} transaction{deleteInfo.usageData.txCount !== 1 ? 's' : ''}</strong></p>
                )}
                {deleteInfo.usageData.budgetCount > 0 && (
                  <p>• Has <strong className="text-ink">{deleteInfo.usageData.budgetCount} budget{deleteInfo.usageData.budgetCount !== 1 ? 's' : ''}</strong> set</p>
                )}
              </div>

              {deleteInfo.usageData.recentTx?.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-warm-600 tracking-wide mb-2">RECENT TRANSACTIONS</p>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {deleteInfo.usageData.recentTx.map((tx, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-2 rounded-item bg-cream text-xs">
                        <span className="text-warm-500">{tx.date}</span>
                        <span className="text-ink font-bold truncate mx-2">{tx.description || '—'}</span>
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
                className="w-full py-2.5 rounded-item text-sm font-bold uppercase tracking-wide bg-terra hover:bg-terra-dark text-white transition-all border-2 border-ink shadow-brutal-sm hover:shadow-none hover:translate-x-[3px] hover:translate-y-[3px]"
              >
                Got it
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm font-bold text-ink">
                Delete <strong className="text-ink">{deleteInfo.cat.icon} {deleteInfo.cat.name}</strong>?
              </p>
              <p className="text-xs text-warm-500 bg-cream rounded-item p-3">
                This category has no transactions or budgets and can be safely removed.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setDeleteInfo(null)}
                  className="flex-1 py-2.5 rounded-item text-sm font-bold text-warm-600 border-2 border-ink hover:bg-warm-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteMut.mutate(deleteInfo.cat.id)}
                  disabled={deleteMut.isPending}
                  className="flex-1 py-2.5 rounded-item text-sm font-bold uppercase tracking-wide bg-terra hover:bg-terra-dark text-white transition-all border-2 border-ink shadow-brutal-sm hover:shadow-none hover:translate-x-[3px] hover:translate-y-[3px] disabled:opacity-50"
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
