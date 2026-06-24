import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getTransactions, deleteTransaction, getCategories } from '../api'
import { Trash2, Download, ChevronLeft, ChevronRight, Search } from 'lucide-react'

function currentMonthStr() {
  return new Date().toLocaleDateString('sv-SE').slice(0, 7)
}

function shiftMonth(m, delta) {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmtMonth(m) {
  const [y, mo] = m.split('-')
  return new Date(parseInt(y), parseInt(mo) - 1).toLocaleString('default', {
    month: 'long',
    year: 'numeric',
  })
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
  a.download = `expenses-${month}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

const TYPE_COLORS = {
  expense: 'bg-rose-500/10 text-rose-400 border border-rose-500/20',
  income:  'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
}

export default function Transactions() {
  const [month,    setMonth]    = useState(currentMonthStr)
  const [category, setCategory] = useState('')
  const [type,     setType]     = useState('')
  const [search,   setSearch]   = useState('')
  const [deleting, setDeleting] = useState(null)

  const qc = useQueryClient()

  const categoriesQ = useQuery({ queryKey: ['categories'], queryFn: getCategories })
  const txQuery = useQuery({
    queryKey: ['transactions', month, category, type],
    queryFn:  () => getTransactions({ month, category: category || undefined, type: type || undefined }),
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

  const categories = categoriesQ.data || []
  const all = txQuery.data || []
  const filtered = search
    ? all.filter(t =>
        t.description?.toLowerCase().includes(search.toLowerCase()) ||
        t.category.toLowerCase().includes(search.toLowerCase())
      )
    : all

  const totalExpense = filtered.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  const totalIncome  = filtered.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)

  return (
    <div className="p-6 max-w-5xl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Transactions</h1>
          <p className="text-xs text-slate-500 mt-0.5">{filtered.length} entries</p>
        </div>
        <button
          onClick={() => exportCSV(filtered, month)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 border border-border hover:bg-white/5 hover:text-white transition-colors"
        >
          <Download size={13} />
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-5">
        {/* Month picker */}
        <div className="flex items-center gap-1 px-3 py-1.5 bg-card border border-border rounded-lg">
          <button onClick={() => setMonth(m => shiftMonth(m, -1))} className="text-slate-400 hover:text-slate-200">
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs text-slate-200 min-w-[110px] text-center">{fmtMonth(month)}</span>
          <button
            onClick={() => setMonth(m => shiftMonth(m, 1))}
            disabled={month >= currentMonthStr()}
            className="text-slate-400 hover:text-slate-200 disabled:opacity-30"
          >
            <ChevronRight size={14} />
          </button>
        </div>

        {/* Category filter */}
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="px-3 py-1.5 bg-card border border-border rounded-lg text-xs text-slate-300 focus:outline-none focus:border-indigo-500/50"
        >
          <option value="">All categories</option>
          {categories.map(c => (
            <option key={c.id} value={c.name}>{c.icon} {c.name}</option>
          ))}
        </select>

        {/* Type filter */}
        <select
          value={type}
          onChange={e => setType(e.target.value)}
          className="px-3 py-1.5 bg-card border border-border rounded-lg text-xs text-slate-300 focus:outline-none focus:border-indigo-500/50"
        >
          <option value="">All types</option>
          <option value="expense">Expenses</option>
          <option value="income">Income</option>
        </select>

        {/* Search */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-card border border-border rounded-lg flex-1 min-w-[160px]">
          <Search size={12} className="text-slate-500 shrink-0" />
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-transparent text-xs text-slate-300 placeholder-slate-600 focus:outline-none w-full"
          />
        </div>
      </div>

      {/* Summary row */}
      <div className="flex gap-4 mb-4">
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <span className="w-2 h-2 rounded-full bg-rose-500" />
          Spent: <span className="text-rose-400 font-medium">Rs. {totalExpense.toLocaleString('en-IN')}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          Earned: <span className="text-emerald-400 font-medium">Rs. {totalIncome.toLocaleString('en-IN')}</span>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden bg-card">
        {txQuery.isLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-500 text-sm">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500 text-sm gap-2">
            <span className="text-3xl">📭</span>
            No transactions found
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Description</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Category</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Amount</th>
                <th className="px-4 py-3 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(t => (
                <tr key={t.id} className="hover:bg-white/[0.02] transition-colors group">
                  <td className="px-4 py-3 text-xs text-slate-400">{t.date}</td>
                  <td className="px-4 py-3 text-sm text-slate-200">{t.description || '—'}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-slate-300 bg-slate-800 border border-border px-2 py-0.5 rounded-md">
                      {t.category}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${TYPE_COLORS[t.type]}`}>
                      {t.type}
                    </span>
                  </td>
                  <td className={`px-4 py-3 text-right text-sm font-medium ${t.type === 'income' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {t.type === 'income' ? '+' : '-'}Rs. {t.amount.toLocaleString('en-IN')}
                  </td>
                  <td className="px-4 py-3">
                    {deleting === t.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => deleteMut.mutate(t.id)}
                          className="text-xs text-rose-400 hover:text-rose-300 font-medium"
                        >
                          Confirm
                        </button>
                        <span className="text-slate-600">·</span>
                        <button
                          onClick={() => setDeleting(null)}
                          className="text-xs text-slate-500 hover:text-slate-300"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleting(t.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 transition-all"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
