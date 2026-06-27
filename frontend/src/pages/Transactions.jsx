import { useState, useMemo, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getTransactions, deleteTransaction, updateTransaction, bulkDeleteTransactions, bulkRecategorize, getCategories } from '../api'
import {
  ChevronLeft, ChevronRight, Search, Download,
  Trash2, X, Pencil, Check, ArrowUpDown, CheckSquare, Square,
} from 'lucide-react'

function currentMonthStr() {
  return new Date().toLocaleDateString('sv-SE').slice(0, 7)
}

function shiftMonth(m, delta) {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmtMonthLabel(m) {
  const [y, mo] = m.split('-')
  return new Date(parseInt(y), parseInt(mo) - 1).toLocaleString('default', {
    month: 'long', year: 'numeric',
  })
}

function fmtDateLabel(dateStr) {
  const today     = new Date().toLocaleDateString('sv-SE')
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE')
  if (dateStr === today)     return 'Today'
  if (dateStr === yesterday) return 'Yesterday'
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('default', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

function fmtRs(n) {
  return `Rs. ${Number(n).toLocaleString('en-IN')}`
}

function exportCSV(transactions, month) {
  const header = 'Date,Type,Category,Description,Amount'
  const rows = transactions.map(t => {
    const desc = (t.description || '').replace(/"/g, '""')
    return `${t.date},${t.type},${t.category},"${desc}",${t.amount}`
  })
  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `transactions-${month}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

const TABS = [
  { label: 'All',      value: '' },
  { label: 'Income',   value: 'income' },
  { label: 'Expenses', value: 'expense' },
]

const SORT_OPTIONS = [
  { label: 'Date (newest)', value: 'date-desc' },
  { label: 'Date (oldest)', value: 'date-asc' },
  { label: 'Amount (high)', value: 'amount-desc' },
  { label: 'Amount (low)',  value: 'amount-asc' },
]

// ─── Swipeable row ────────────────────────────────────────────────────────────

function SwipeRow({ children, onSwipeLeft }) {
  const ref = useRef(null)
  const startX = useRef(0)
  const currentX = useRef(0)
  const swiping = useRef(false)

  const handleTouchStart = useCallback((e) => {
    startX.current = e.touches[0].clientX
    swiping.current = false
  }, [])

  const handleTouchMove = useCallback((e) => {
    const diff = startX.current - e.touches[0].clientX
    currentX.current = diff
    if (diff > 10) {
      swiping.current = true
      const translate = Math.min(diff, 80)
      if (ref.current) ref.current.style.transform = `translateX(-${translate}px)`
    }
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (currentX.current > 60 && onSwipeLeft) {
      onSwipeLeft()
    }
    if (ref.current) ref.current.style.transform = ''
    currentX.current = 0
    swiping.current = false
  }, [onSwipeLeft])

  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-y-0 right-0 w-20 bg-terra flex items-center justify-center">
        <Trash2 size={16} className="text-white" />
      </div>
      <div
        ref={ref}
        className="relative bg-white transition-transform"
        style={{ transitionDuration: '0.15s' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </div>
    </div>
  )
}

// ─── Edit modal ───────────────────────────────────────────────────────────────

function EditModal({ tx, categories, onSave, onClose }) {
  const [amount, setAmount]       = useState(tx.amount.toString())
  const [type, setType]           = useState(tx.type)
  const [category, setCategory]   = useState(tx.category)
  const [description, setDesc]    = useState(tx.description || '')
  const [date, setDate]           = useState(tx.date)

  const filtered = useMemo(() =>
    categories.filter(c => !c.type || c.type === type)
  , [categories, type])

  const handleSubmit = (e) => {
    e.preventDefault()
    const val = parseFloat(amount)
    if (!val || !category) return
    onSave({ amount: val, type, category, description: description || null, date })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/30">
      <div className="bg-white border-t sm:border border-border rounded-t-[20px] sm:rounded-hero w-full sm:max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-white z-10">
          <h2 className="font-medium text-neutral-800">Edit Transaction</h2>
          <button onClick={onClose} className="text-warm-400 hover:text-terra p-1 rounded-item hover:bg-warm-100">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setType('expense')}
              className={`py-2.5 rounded-item text-sm font-medium border transition-all ${
                type === 'expense' ? 'bg-terra/10 border-terra/30 text-terra' : 'border-border text-warm-500 hover:bg-warm-100'
              }`}
            >Expense</button>
            <button
              type="button"
              onClick={() => setType('income')}
              className={`py-2.5 rounded-item text-sm font-medium border transition-all ${
                type === 'income' ? 'bg-sage/10 border-sage/30 text-sage' : 'border-border text-warm-500 hover:bg-warm-100'
              }`}
            >Income</button>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-warm-500 tracking-wide mb-2">AMOUNT (RS.)</label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="w-full px-4 py-3 bg-cream border border-border rounded-item text-xl font-medium text-neutral-800 focus:outline-none focus:border-terra/40" min="0" step="any" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-warm-500 tracking-wide mb-2">CATEGORY</label>
            <select value={category} onChange={e => setCategory(e.target.value)} className="w-full px-3 py-2.5 bg-cream border border-border rounded-item text-sm text-neutral-700 focus:outline-none focus:border-terra/40">
              {filtered.map(c => (<option key={c.id} value={c.name}>{c.icon} {c.name}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-warm-500 tracking-wide mb-2">NOTE</label>
            <input type="text" value={description} onChange={e => setDesc(e.target.value)} placeholder="Optional note" className="w-full px-4 py-3 bg-cream border border-border rounded-item text-sm text-neutral-800 placeholder-warm-400 focus:outline-none focus:border-terra/40" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-warm-500 tracking-wide mb-2">DATE</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full px-4 py-3 bg-cream border border-border rounded-item text-sm text-neutral-800 focus:outline-none focus:border-terra/40" />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-item text-sm text-warm-500 border border-border hover:bg-warm-100 transition-colors">Cancel</button>
            <button type="submit" className="flex-1 py-2.5 rounded-item text-sm font-medium bg-terra hover:bg-terra-dark text-white transition-colors">Save</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Transaction row ──────────────────────────────────────────────────────────

function TxRow({ tx, cat, onDelete, onEdit, isConfirming, onConfirm, onCancel, selectable, selected, onSelect }) {
  const row = (
    <div className="group flex items-center gap-3 px-5 py-3.5 hover:bg-warm-50/50 transition-colors border-b border-border/60 last:border-0">
      {selectable && (
        <button onClick={() => onSelect(tx.id)} className="shrink-0 text-warm-400 hover:text-terra">
          {selected ? <CheckSquare size={16} className="text-terra" /> : <Square size={16} />}
        </button>
      )}
      <div
        className="w-10 h-10 rounded-item flex items-center justify-center text-lg shrink-0 cursor-pointer"
        style={{ backgroundColor: (cat.color || '#525252') + '15' }}
        onClick={() => onEdit(tx)}
      >
        {cat.icon || '📦'}
      </div>
      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onEdit(tx)}>
        <p className="text-sm font-medium text-neutral-800 truncate">{tx.category}</p>
        {tx.description && <p className="text-[11px] text-warm-500 truncate mt-0.5">{tx.description}</p>}
        <p className="text-[10px] text-warm-400 mt-0.5">{fmtDateLabel(tx.date)} · {tx.date}</p>
      </div>
      <div className="text-right shrink-0">
        <span className={`text-sm font-medium tabular-nums ${tx.type === 'income' ? 'text-sage' : 'text-terra'}`}>
          {tx.type === 'income' ? '+' : '−'}{fmtRs(tx.amount)}
        </span>
      </div>
      <div className="w-14 flex justify-end shrink-0">
        {isConfirming ? (
          <div className="flex items-center gap-1.5">
            <button onClick={onConfirm} className="text-[11px] text-terra font-medium hover:underline">Yes</button>
            <button onClick={onCancel} className="text-warm-400 hover:text-warm-600"><X size={12} /></button>
          </div>
        ) : (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
            <button onClick={() => onEdit(tx)} className="p-1.5 rounded-item text-warm-400 hover:text-terra hover:bg-warm-200/60 transition-colors"><Pencil size={12} /></button>
            <button onClick={onDelete} className="p-1.5 rounded-item text-warm-400 hover:text-terra hover:bg-terra/10 transition-colors"><Trash2 size={12} /></button>
          </div>
        )}
      </div>
    </div>
  )

  return <SwipeRow onSwipeLeft={onDelete}>{row}</SwipeRow>
}

// ─── Date group ───────────────────────────────────────────────────────────────

function DateGroup({ date, txs, catMap, deleting, setDeleting, deleteMut, onEdit, selectable, selected, onSelect }) {
  const dayIncome  = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const dayExpense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  const dayNet     = dayIncome - dayExpense

  return (
    <div>
      <div className="flex items-center justify-between px-5 py-2.5 bg-cream border-b border-border/60">
        <span className="text-[11px] font-medium text-warm-500 tracking-wide">
          {fmtDateLabel(date).toUpperCase()}
          <span className="text-warm-400 font-normal ml-2 normal-case tracking-normal">{date}</span>
        </span>
        <span className={`text-[11px] font-medium tabular-nums ${dayNet >= 0 ? 'text-sage' : 'text-terra'}`}>
          {dayNet >= 0 ? '+' : '−'}{fmtRs(Math.abs(dayNet))}
        </span>
      </div>
      {txs.map(tx => {
        const cat = catMap[tx.category] || {}
        return (
          <TxRow
            key={tx.id}
            tx={tx}
            cat={cat}
            onDelete={() => setDeleting(tx.id)}
            onEdit={onEdit}
            isConfirming={deleting === tx.id}
            onConfirm={() => deleteMut.mutate(tx.id)}
            onCancel={() => setDeleting(null)}
            selectable={selectable}
            selected={selected.has(tx.id)}
            onSelect={onSelect}
          />
        )
      })}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Transactions() {
  const [month,    setMonth]    = useState(currentMonthStr)
  const [tab,      setTab]      = useState('')
  const [category, setCategory] = useState('')
  const [search,   setSearch]   = useState('')
  const [sort,     setSort]     = useState('date-desc')
  const [deleting, setDeleting] = useState(null)
  const [editing,  setEditing]  = useState(null)
  const [selectable, setSelectable] = useState(false)
  const [selected, setSelected] = useState(new Set())

  const qc = useQueryClient()

  const categoriesQ = useQuery({ queryKey: ['categories'], queryFn: getCategories })
  const txQuery = useQuery({
    queryKey: ['transactions', month, tab, category],
    queryFn:  () => getTransactions({ month, type: tab || undefined, category: category || undefined }),
  })

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['transactions'] })
    qc.invalidateQueries({ queryKey: ['summary'] })
    qc.invalidateQueries({ queryKey: ['daily'] })
    qc.invalidateQueries({ queryKey: ['budgets'] })
  }

  const deleteMut = useMutation({
    mutationFn: deleteTransaction,
    onSuccess: () => { invalidateAll(); setDeleting(null) },
  })

  const editMut = useMutation({
    mutationFn: ({ id, data }) => updateTransaction(id, data),
    onSuccess: () => { invalidateAll(); setEditing(null) },
  })

  const bulkDeleteMut = useMutation({
    mutationFn: bulkDeleteTransactions,
    onSuccess: () => { invalidateAll(); setSelected(new Set()); setSelectable(false) },
  })

  const bulkRecatMut = useMutation({
    mutationFn: ({ ids, category }) => bulkRecategorize(ids, category),
    onSuccess: () => { invalidateAll(); setSelected(new Set()); setSelectable(false) },
  })

  const catMap = useMemo(() =>
    Object.fromEntries((categoriesQ.data || []).map(c => [c.name, c]))
  , [categoriesQ.data])

  const categories = categoriesQ.data || []
  const all = txQuery.data || []

  const filtered = useMemo(() => {
    let result = all
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(t =>
        t.description?.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q)
      )
    }
    // Sort
    if (sort === 'amount-desc') result = [...result].sort((a, b) => b.amount - a.amount)
    else if (sort === 'amount-asc') result = [...result].sort((a, b) => a.amount - b.amount)
    else if (sort === 'date-asc') result = [...result].sort((a, b) => a.date.localeCompare(b.date) || a.created_at?.localeCompare(b.created_at))
    return result
  }, [all, search, sort])

  const totalIncome  = filtered.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const totalExpense = filtered.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  const net          = totalIncome - totalExpense

  const groups = useMemo(() => {
    const map = {}
    for (const tx of filtered) {
      if (!map[tx.date]) map[tx.date] = []
      map[tx.date].push(tx)
    }
    const sortDir = sort.startsWith('date-asc') ? 1 : -1
    return Object.entries(map).sort(([a], [b]) => sortDir * a.localeCompare(b))
  }, [filtered, sort])

  const isCurrentMonth = month === currentMonthStr()

  const filteredCatOptions = useMemo(() => {
    if (!tab) return categories
    return categories.filter(c => !c.type || c.type === tab)
  }, [categories, tab])

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length) setSelected(new Set())
    else setSelected(new Set(filtered.map(t => t.id)))
  }

  return (
    <div className="p-5 md:p-8 max-w-3xl mx-auto md:mx-0">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-xl font-medium text-neutral-800">Transaction History</h1>
          <p className="text-[11px] text-warm-500 tracking-wide mt-1">
            {filtered.length} ENTRIES · {fmtMonthLabel(month).toUpperCase()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setSelectable(s => !s); setSelected(new Set()) }}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-item text-[11px] font-medium border transition-colors tracking-wide ${
              selectable ? 'bg-terra/10 border-terra/30 text-terra' : 'text-warm-600 border-border hover:border-terra/30 hover:text-terra'
            }`}
          >
            <CheckSquare size={12} />
            SELECT
          </button>
          <button
            onClick={() => exportCSV(filtered, month)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-item text-[11px] font-medium text-warm-600 border border-border hover:border-terra/30 hover:text-terra transition-colors tracking-wide"
          >
            <Download size={12} />
            CSV
          </button>
        </div>
      </div>

      {/* Bulk actions bar */}
      {selectable && selected.size > 0 && (
        <div className="flex items-center gap-2 mb-4 p-3 bg-terra/5 border border-terra/20 rounded-item">
          <button onClick={toggleSelectAll} className="text-[11px] font-medium text-terra hover:underline">
            {selected.size === filtered.length ? 'Deselect all' : 'Select all'}
          </button>
          <span className="text-[11px] text-warm-500">{selected.size} selected</span>
          <div className="flex-1" />
          <select
            onChange={e => {
              if (e.target.value) {
                bulkRecatMut.mutate({ ids: [...selected], category: e.target.value })
                e.target.value = ''
              }
            }}
            className="px-2 py-1.5 bg-white border border-border rounded-item text-[11px] text-neutral-700 focus:outline-none"
          >
            <option value="">Recategorize…</option>
            {categories.map(c => (<option key={c.id} value={c.name}>{c.icon} {c.name}</option>))}
          </select>
          <button
            onClick={() => bulkDeleteMut.mutate([...selected])}
            className="px-3 py-1.5 rounded-item text-[11px] font-medium bg-terra text-white hover:bg-terra-dark transition-colors"
          >
            Delete ({selected.size})
          </button>
        </div>
      )}

      {/* Summary chips */}
      <div className="flex gap-3 mb-5">
        <div className="flex-1 bg-white rounded-card border border-border p-4">
          <p className="text-[11px] text-warm-500 tracking-wide mb-1">INCOME</p>
          <p className="text-lg font-medium text-sage">+{fmtRs(totalIncome)}</p>
        </div>
        <div className="flex-1 bg-white rounded-card border border-border p-4">
          <p className="text-[11px] text-warm-500 tracking-wide mb-1">EXPENSES</p>
          <p className="text-lg font-medium text-terra">{fmtRs(totalExpense)}</p>
        </div>
        <div className="flex-1 bg-white rounded-card border border-border p-4">
          <p className="text-[11px] text-warm-500 tracking-wide mb-1">NET</p>
          <p className={`text-lg font-medium ${net >= 0 ? 'text-sage' : 'text-terra'}`}>
            {net >= 0 ? '+' : '−'}{fmtRs(Math.abs(net))}
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="flex items-center gap-1 px-3 py-2 bg-white border border-border rounded-item">
          <button onClick={() => setMonth(m => shiftMonth(m, -1))} className="text-warm-500 hover:text-terra p-0.5"><ChevronLeft size={14} /></button>
          <span className="text-xs text-neutral-700 min-w-[110px] text-center font-medium">{fmtMonthLabel(month)}</span>
          <button onClick={() => setMonth(m => shiftMonth(m, 1))} disabled={isCurrentMonth} className="text-warm-500 hover:text-terra disabled:opacity-30 p-0.5"><ChevronRight size={14} /></button>
        </div>
        <div className="flex items-center bg-white border border-border rounded-item overflow-hidden">
          {TABS.map(t => (
            <button
              key={t.value}
              onClick={() => { setTab(t.value); setCategory('') }}
              className={`px-3 py-2 text-xs font-medium transition-colors ${
                tab === t.value ? 'bg-terra/10 text-terra' : 'text-warm-500 hover:text-terra hover:bg-warm-100'
              }`}
            >{t.label}</button>
          ))}
        </div>
        <select value={category} onChange={e => setCategory(e.target.value)} className="px-3 py-2 bg-white border border-border rounded-item text-xs text-neutral-700 focus:outline-none focus:border-terra/40">
          <option value="">All categories</option>
          {filteredCatOptions.map(c => (<option key={c.id} value={c.name}>{c.icon} {c.name}</option>))}
        </select>
        <div className="flex items-center gap-1 px-3 py-2 bg-white border border-border rounded-item">
          <ArrowUpDown size={11} className="text-warm-400" />
          <select value={sort} onChange={e => setSort(e.target.value)} className="bg-transparent text-xs text-neutral-700 focus:outline-none">
            {SORT_OPTIONS.map(o => (<option key={o.value} value={o.value}>{o.label}</option>))}
          </select>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 bg-white border border-border rounded-item flex-1 min-w-[140px]">
          <Search size={12} className="text-warm-400 shrink-0" />
          <input type="text" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} className="bg-transparent text-xs text-neutral-700 placeholder-warm-400 focus:outline-none w-full" />
          {search && <button onClick={() => setSearch('')} className="text-warm-400 hover:text-warm-600"><X size={11} /></button>}
        </div>
      </div>

      {/* Transaction list */}
      <div className="bg-white rounded-hero border border-border overflow-hidden">
        {txQuery.isLoading ? (
          <div className="flex items-center justify-center py-16 text-warm-500 text-sm">Loading…</div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <span className="text-4xl">📭</span>
            <p className="text-sm text-warm-500">No transactions for {fmtMonthLabel(month)}</p>
            {tab && (
              <p className="text-[11px] text-warm-400">
                No {tab === 'income' ? 'income' : 'expenses'} found.{' '}
                <button onClick={() => setTab('')} className="text-terra hover:underline">View all</button>
              </p>
            )}
          </div>
        ) : (
          groups.map(([date, txs]) => (
            <DateGroup
              key={date}
              date={date}
              txs={txs}
              catMap={catMap}
              deleting={deleting}
              setDeleting={setDeleting}
              deleteMut={deleteMut}
              onEdit={setEditing}
              selectable={selectable}
              selected={selected}
              onSelect={toggleSelect}
            />
          ))
        )}
      </div>

      {/* Footer */}
      {groups.length > 0 && (
        <div className="flex items-center justify-between mt-3 px-1 text-[11px] text-warm-500 tracking-wide">
          <span>{filtered.length} TRANSACTIONS</span>
          <div className="flex items-center gap-4">
            <span>In: <span className="text-sage font-medium">{fmtRs(totalIncome)}</span></span>
            <span>Out: <span className="text-terra font-medium">{fmtRs(totalExpense)}</span></span>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <EditModal
          tx={editing}
          categories={categories}
          onSave={data => editMut.mutate({ id: editing.id, data })}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
