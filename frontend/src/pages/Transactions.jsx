import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getTransactions, deleteTransaction, getCategories } from '../api'
import {
  ChevronLeft, ChevronRight, Search, Download,
  Trash2, TrendingUp, TrendingDown, Minus, X,
} from 'lucide-react'

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({ label, amount, type }) {
  const styles = {
    income:  { bar: 'bg-emerald-500', text: 'text-emerald-400', bg: 'bg-emerald-500/5 border-emerald-500/15', icon: TrendingUp },
    expense: { bar: 'bg-rose-500',    text: 'text-rose-400',    bg: 'bg-rose-500/5 border-rose-500/15',       icon: TrendingDown },
    net:     { bar: 'bg-indigo-500',  text: amount >= 0 ? 'text-emerald-400' : 'text-rose-400', bg: 'bg-indigo-500/5 border-indigo-500/15', icon: Minus },
  }
  const s = styles[type]
  const Icon = s.icon
  return (
    <div className={`flex-1 rounded-xl border p-4 ${s.bg} min-w-[140px]`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} className={s.text} />
        <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">{label}</span>
      </div>
      <p className={`text-lg font-semibold ${s.text}`}>
        {type === 'net' && amount > 0 ? '+' : ''}{fmtRs(Math.abs(amount))}
      </p>
    </div>
  )
}

// ─── Transaction row ──────────────────────────────────────────────────────────

function TxRow({ tx, catMap, onDelete, isConfirming, onConfirm, onCancel }) {
  const cat = catMap[tx.category] || {}
  return (
    <div className="group flex items-center gap-3 px-4 py-3 hover:bg-white/[0.025] transition-colors border-b border-border/40 last:border-0">
      {/* Category icon */}
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center text-base shrink-0"
        style={{ backgroundColor: (cat.color || '#6b7280') + '22', border: `1px solid ${(cat.color || '#6b7280')}33` }}
      >
        {cat.icon || '📦'}
      </div>

      {/* Category + note */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-200 truncate">{tx.category}</p>
        {tx.description && (
          <p className="text-xs text-slate-500 truncate mt-0.5">{tx.description}</p>
        )}
      </div>

      {/* Amount */}
      <div className="text-right shrink-0">
        <span className={`text-sm font-semibold tabular-nums ${tx.type === 'income' ? 'text-emerald-400' : 'text-rose-400'}`}>
          {tx.type === 'income' ? '+' : '−'}{fmtRs(tx.amount)}
        </span>
      </div>

      {/* Delete action */}
      <div className="w-20 flex justify-end shrink-0">
        {isConfirming ? (
          <div className="flex items-center gap-2">
            <button onClick={onConfirm} className="text-xs text-rose-400 hover:text-rose-300 font-medium">Delete</button>
            <button onClick={onCancel}  className="text-xs text-slate-500 hover:text-slate-300">
              <X size={12} />
            </button>
          </div>
        ) : (
          <button
            onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 transition-all"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Date group ───────────────────────────────────────────────────────────────

function DateGroup({ date, txs, catMap, deleting, setDeleting, deleteMut }) {
  const dayIncome  = txs.filter(t => t.type === 'income').reduce((s, t)  => s + t.amount, 0)
  const dayExpense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  const dayNet     = dayIncome - dayExpense

  return (
    <div className="mb-4">
      {/* Date header */}
      <div className="flex items-center justify-between px-4 py-2 bg-surface/50 border-b border-border/60">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          {fmtDateLabel(date)}
          <span className="text-slate-600 font-normal ml-2 normal-case">{date}</span>
        </span>
        <span className={`text-xs font-semibold tabular-nums ${dayNet >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
          {dayNet >= 0 ? '+' : '−'}{fmtRs(Math.abs(dayNet))}
        </span>
      </div>

      {/* Rows */}
      {txs.map(tx => (
        <TxRow
          key={tx.id}
          tx={tx}
          catMap={catMap}
          onDelete={() => setDeleting(tx.id)}
          isConfirming={deleting === tx.id}
          onConfirm={() => deleteMut.mutate(tx.id)}
          onCancel={() => setDeleting(null)}
        />
      ))}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

const TABS = [
  { label: 'All',      value: '' },
  { label: 'Income',   value: 'income' },
  { label: 'Expenses', value: 'expense' },
]

export default function Transactions() {
  const [month,    setMonth]    = useState(currentMonthStr)
  const [tab,      setTab]      = useState('')         // '' | 'income' | 'expense'
  const [category, setCategory] = useState('')
  const [search,   setSearch]   = useState('')
  const [deleting, setDeleting] = useState(null)

  const qc = useQueryClient()

  const categoriesQ = useQuery({ queryKey: ['categories'], queryFn: getCategories })
  const txQuery = useQuery({
    queryKey: ['transactions', month, tab, category],
    queryFn:  () => getTransactions({ month, type: tab || undefined, category: category || undefined }),
  })

  const deleteMut = useMutation({
    mutationFn: deleteTransaction,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['summary'] })
      qc.invalidateQueries({ queryKey: ['daily'] })
      qc.invalidateQueries({ queryKey: ['budgets'] })
      setDeleting(null)
    },
  })

  // Build category lookup map
  const catMap = useMemo(() => {
    return Object.fromEntries((categoriesQ.data || []).map(c => [c.name, c]))
  }, [categoriesQ.data])

  const categories = categoriesQ.data || []
  const all = txQuery.data || []

  // Client-side search filter
  const filtered = useMemo(() => {
    if (!search.trim()) return all
    const q = search.toLowerCase()
    return all.filter(t =>
      t.description?.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q)
    )
  }, [all, search])

  // Totals (on filtered)
  const totalIncome  = filtered.filter(t => t.type === 'income').reduce((s, t)  => s + t.amount, 0)
  const totalExpense = filtered.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  const net          = totalIncome - totalExpense

  // Group by date
  const groups = useMemo(() => {
    const map = {}
    for (const tx of filtered) {
      if (!map[tx.date]) map[tx.date] = []
      map[tx.date].push(tx)
    }
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a))
  }, [filtered])

  const isCurrentMonth = month === currentMonthStr()

  // Category options filtered by active tab
  const filteredCatOptions = useMemo(() => {
    if (!tab) return categories
    return categories.filter(c => !c.type || c.type === tab)
  }, [categories, tab])

  return (
    <div className="p-6 max-w-5xl">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Transactions</h1>
          <p className="text-xs text-slate-500 mt-0.5">{filtered.length} entries · {fmtMonthLabel(month)}</p>
        </div>
        <button
          onClick={() => exportCSV(filtered, month)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 border border-border hover:bg-white/5 hover:text-white transition-colors"
        >
          <Download size={13} />
          Export CSV
        </button>
      </div>

      {/* ── Summary cards ── */}
      <div className="flex gap-3 mb-5 flex-wrap">
        <SummaryCard label="Income"   amount={totalIncome}  type="income"  />
        <SummaryCard label="Expenses" amount={totalExpense} type="expense" />
        <SummaryCard label="Net"      amount={net}          type="net"     />
      </div>

      {/* ── Filter row ── */}
      <div className="flex flex-wrap gap-2 mb-2">
        {/* Month */}
        <div className="flex items-center gap-1 px-3 py-1.5 bg-card border border-border rounded-lg">
          <button onClick={() => setMonth(m => shiftMonth(m, -1))} className="text-slate-400 hover:text-slate-200 p-0.5">
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs text-slate-200 min-w-[110px] text-center">{fmtMonthLabel(month)}</span>
          <button
            onClick={() => setMonth(m => shiftMonth(m, 1))}
            disabled={isCurrentMonth}
            className="text-slate-400 hover:text-slate-200 disabled:opacity-30 p-0.5"
          >
            <ChevronRight size={14} />
          </button>
        </div>

        {/* Type tabs */}
        <div className="flex items-center bg-card border border-border rounded-lg overflow-hidden">
          {TABS.map(t => (
            <button
              key={t.value}
              onClick={() => { setTab(t.value); setCategory('') }}
              className={`px-3 py-1.5 text-xs font-medium transition-colors
                ${tab === t.value
                  ? 'bg-indigo-600/30 text-indigo-300 border-x border-indigo-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Category filter */}
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="px-3 py-1.5 bg-card border border-border rounded-lg text-xs text-slate-300 focus:outline-none focus:border-indigo-500/50"
        >
          <option value="">All categories</option>
          {filteredCatOptions.map(c => (
            <option key={c.id} value={c.name}>{c.icon} {c.name}</option>
          ))}
        </select>

        {/* Search */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-card border border-border rounded-lg flex-1 min-w-[160px]">
          <Search size={12} className="text-slate-500 shrink-0" />
          <input
            type="text"
            placeholder="Search category or note…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-transparent text-xs text-slate-300 placeholder-slate-600 focus:outline-none w-full"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-slate-600 hover:text-slate-400">
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {/* ── Column labels ── */}
      <div className="flex items-center px-4 py-1.5 text-xs font-medium text-slate-600 uppercase tracking-wider border-b border-border mt-4">
        <div className="w-9 mr-3 shrink-0" />
        <div className="flex-1">Category · Note</div>
        <div className="text-right shrink-0 mr-20">Amount</div>
      </div>

      {/* ── Transaction list ── */}
      <div className="rounded-xl border border-border overflow-hidden bg-card mt-1">
        {txQuery.isLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-500 text-sm">
            Loading…
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500 text-sm gap-3">
            <span className="text-4xl">📭</span>
            <p>No transactions for {fmtMonthLabel(month)}</p>
            {tab && (
              <p className="text-xs text-slate-600">
                No {tab === 'income' ? 'income' : 'expenses'} found.{' '}
                <button onClick={() => setTab('')} className="text-indigo-400 hover:underline">View all</button>
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
            />
          ))
        )}
      </div>

      {/* ── Footer totals ── */}
      {groups.length > 0 && (
        <div className="flex items-center justify-between mt-3 px-1 text-xs text-slate-500">
          <span>{filtered.length} transaction{filtered.length !== 1 ? 's' : ''}</span>
          <div className="flex items-center gap-4">
            <span>In: <span className="text-emerald-400 font-medium">{fmtRs(totalIncome)}</span></span>
            <span>Out: <span className="text-rose-400 font-medium">{fmtRs(totalExpense)}</span></span>
            <span>Net: <span className={`font-medium ${net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{net >= 0 ? '+' : '−'}{fmtRs(Math.abs(net))}</span></span>
          </div>
        </div>
      )}
    </div>
  )
}
