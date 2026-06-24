import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSummary, getTrends, getTransactions, getCategories, getBudgets } from '../api'
import { ChevronLeft, ChevronRight, RefreshCw, AlertTriangle } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts'

function currentMonthStr() {
  return new Date().toLocaleDateString('sv-SE').slice(0, 7)
}

function formatMonthLabel(m) {
  const [y, mo] = m.split('-')
  return new Date(parseInt(y), parseInt(mo) - 1).toLocaleString('default', { month: 'long', year: 'numeric' })
}

function shiftMonth(m, delta) {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmtRs(n) {
  return `Rs. ${Number(n).toLocaleString('en-IN')}`
}

function fmtDateLabel(dateStr) {
  const today     = new Date().toLocaleDateString('sv-SE')
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE')
  if (dateStr === today)     return 'Today'
  if (dateStr === yesterday) return 'Yesterday'
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('default', { weekday: 'short', month: 'short', day: 'numeric' })
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function getWeekRange() {
  const now = new Date()
  const dayOfWeek = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return { start: monday.toLocaleDateString('sv-SE'), end: sunday.toLocaleDateString('sv-SE') }
}

function MiniBarTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-border rounded-item p-2.5 text-xs">
      <p className="text-warm-600 mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.name === 'income' ? '#6B8F71' : '#C4603A' }}>
          {p.name === 'income' ? 'Income' : 'Spent'}: Rs. {p.value.toLocaleString('en-IN')}
        </p>
      ))}
    </div>
  )
}

function SyncBadge({ lastSync }) {
  if (!lastSync) return null
  const minsAgo = Math.floor((Date.now() - new Date(lastSync).getTime()) / 60000)
  const isRecent = minsAgo < 60
  const timeLabel = minsAgo < 1 ? 'Just now' : minsAgo < 60 ? `${minsAgo}m ago` : minsAgo < 1440 ? `${Math.floor(minsAgo / 60)}h ago` : `${Math.floor(minsAgo / 1440)}d ago`

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 bg-white rounded-item border border-border">
      <span className={`w-2 h-2 rounded-full shrink-0 ${isRecent ? 'bg-sage animate-pulse' : 'bg-amber'}`} />
      <span className="text-[11px] text-warm-500 tracking-wide">
        LAST TELEGRAM ENTRY — {timeLabel}
      </span>
    </div>
  )
}

export default function Dashboard() {
  const [month, setMonth] = useState(currentMonthStr)
  const isCurrentMonth = month === currentMonthStr()

  const summaryQ    = useQuery({ queryKey: ['summary', month],   queryFn: () => getSummary(month) })
  const trendsQ     = useQuery({ queryKey: ['trends'],           queryFn: () => getTrends(6) })
  const categoriesQ = useQuery({ queryKey: ['categories'],       queryFn: getCategories })
  const recentTxQ   = useQuery({ queryKey: ['transactions', month], queryFn: () => getTransactions({ month, limit: 10 }) })
  const budgetsQ    = useQuery({ queryKey: ['budgets', currentMonthStr()], queryFn: () => getBudgets(currentMonthStr()) })

  const summary    = summaryQ.data  || { totalSpent: 0, totalEarned: 0, net: 0, expenses: [], incomes: [], expenseCount: 0, incomeCount: 0, txCount: 0 }
  const trends     = trendsQ.data   || []
  const categories = categoriesQ.data || []
  const recentTxs  = (recentTxQ.data || []).slice(0, 6)
  const budgets    = budgetsQ.data  || []

  const catMap = useMemo(() => Object.fromEntries(categories.map(c => [c.name, c])), [categories])

  const isLoading = summaryQ.isLoading

  const weekRange = getWeekRange()
  const weekTxs = useMemo(() => (recentTxQ.data || []).filter(t => t.date >= weekRange.start && t.date <= weekRange.end), [recentTxQ.data, weekRange.start, weekRange.end])
  const weekIncome  = weekTxs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const weekExpense = weekTxs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)

  const barData = useMemo(() => {
    const map = {}
    for (const row of trends) {
      if (!map[row.month]) map[row.month] = { month: row.month, expense: 0, income: 0 }
      map[row.month][row.type] += row.total
    }
    return Object.values(map).sort((a, b) => a.month.localeCompare(b.month)).map(r => {
      const [, mo] = r.month.split('-')
      return { ...r, label: new Date(2024, parseInt(mo) - 1).toLocaleString('default', { month: 'short' }) }
    })
  }, [trends])

  const lastTelegramSync = useMemo(() => {
    const tx = (recentTxQ.data || []).find(t => t.raw_message && !t.raw_message.startsWith('__'))
    return tx ? tx.created_at : null
  }, [recentTxQ.data])

  // Budget warnings (80% and 100%)
  const budgetWarnings = useMemo(() => {
    return budgets.filter(b => b.monthly_limit && (b.spent / b.monthly_limit) >= 0.8)
      .map(b => ({ ...b, pct: Math.round((b.spent / b.monthly_limit) * 100) }))
      .sort((a, b) => b.pct - a.pct)
  }, [budgets])

  // Detect recurring (categories with entries in 3+ consecutive months from trends)
  const recurringCats = useMemo(() => {
    const catMonths = {}
    for (const tx of (recentTxQ.data || [])) {
      const m = tx.date.slice(0, 7)
      if (!catMonths[tx.category]) catMonths[tx.category] = new Set()
      catMonths[tx.category].add(m)
    }
    return Object.entries(catMonths).filter(([, months]) => months.size >= 2).map(([cat]) => cat)
  }, [recentTxQ.data])

  return (
    <div className="p-5 md:p-8 max-w-3xl mx-auto md:mx-0">
      {/* Greeting */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-medium text-neutral-800">{getGreeting()}, Kavina</h1>
          <p className="text-[11px] text-warm-500 tracking-wide mt-1">{formatMonthLabel(month).toUpperCase()}</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setMonth(m => shiftMonth(m, -1))} className="p-2 rounded-item text-warm-500 hover:text-terra hover:bg-warm-200/60 transition-colors"><ChevronLeft size={16} /></button>
          {!isCurrentMonth && <button onClick={() => setMonth(currentMonthStr())} className="px-2.5 py-1 rounded-full text-[11px] font-medium text-terra bg-terra/10 hover:bg-terra/20">Today</button>}
          <button onClick={() => setMonth(m => shiftMonth(m, 1))} disabled={isCurrentMonth} className="p-2 rounded-item text-warm-500 hover:text-terra hover:bg-warm-200/60 transition-colors disabled:opacity-30"><ChevronRight size={16} /></button>
          <button onClick={() => { summaryQ.refetch(); trendsQ.refetch(); recentTxQ.refetch(); budgetsQ.refetch() }} className="p-2 rounded-item text-warm-500 hover:text-terra hover:bg-warm-200/60 transition-colors ml-1"><RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} /></button>
        </div>
      </div>

      {/* Hero balance card */}
      <div className="bg-terra rounded-hero p-6 mb-4 text-white">
        <p className="text-[11px] font-medium tracking-widest opacity-80 mb-1">NET BALANCE</p>
        <p className="text-[38px] font-medium leading-tight tracking-tight">
          {summary.net >= 0 ? '+' : '−'}Rs. {Math.abs(summary.net).toLocaleString('en-IN')}
        </p>
        <div className="flex gap-6 mt-4">
          <div>
            <p className="text-[11px] tracking-wide opacity-70">↑ INCOME</p>
            <p className="text-lg font-medium">Rs. {summary.totalEarned.toLocaleString('en-IN')}</p>
          </div>
          <div>
            <p className="text-[11px] tracking-wide opacity-70">↓ SPENT</p>
            <p className="text-lg font-medium">Rs. {summary.totalSpent.toLocaleString('en-IN')}</p>
          </div>
        </div>
        {lastTelegramSync && (
          <p className="text-[10px] tracking-wide opacity-50 mt-3">
            Last entry via Telegram — {(() => {
              const m = Math.floor((Date.now() - new Date(lastTelegramSync).getTime()) / 60000)
              return m < 1 ? 'just now' : m < 60 ? `${m} mins ago` : m < 1440 ? `${Math.floor(m/60)}h ago` : `${Math.floor(m/1440)}d ago`
            })()}
          </p>
        )}
      </div>

      {/* Sync badge */}
      <div className="mb-4">
        <SyncBadge lastSync={lastTelegramSync} />
      </div>

      {/* Budget alerts */}
      {budgetWarnings.length > 0 && (
        <div className="mb-4 p-3.5 rounded-card border border-amber/30 bg-amber/5 flex items-start gap-2.5">
          <AlertTriangle size={15} className="text-amber shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-medium text-neutral-800 mb-1">Budget Alerts</p>
            {budgetWarnings.map(b => (
              <p key={b.id} className="text-[11px] text-warm-600">
                {categories.find(c => c.name === b.category)?.icon || '📦'} {b.category}:
                <span className={b.pct >= 100 ? ' text-terra font-medium' : ' text-amber font-medium'}> {b.pct}%</span>
                {' '} ({fmtRs(b.spent)} of {fmtRs(b.monthly_limit)})
              </p>
            ))}
          </div>
        </div>
      )}

      {/* This week summary */}
      <div className="flex gap-3 mb-5">
        <div className="flex-1 bg-white rounded-card border border-border p-4">
          <p className="text-[11px] text-warm-500 tracking-wide mb-1">THIS WEEK INCOME</p>
          <p className="text-lg font-medium text-sage">{weekIncome > 0 ? `+${fmtRs(weekIncome)}` : '—'}</p>
        </div>
        <div className="flex-1 bg-white rounded-card border border-border p-4">
          <p className="text-[11px] text-warm-500 tracking-wide mb-1">THIS WEEK SPENT</p>
          <p className="text-lg font-medium text-terra">{weekExpense > 0 ? fmtRs(weekExpense) : '—'}</p>
        </div>
      </div>

      {/* Mini monthly bar chart */}
      {barData.length > 0 && (
        <div className="bg-white rounded-hero border border-border p-5 mb-5">
          <h3 className="text-sm font-medium text-neutral-800 mb-0.5">Monthly Trend</h3>
          <p className="text-[11px] text-warm-500 tracking-wide mb-4">LAST 6 MONTHS</p>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={barData} barGap={3} margin={{ top: 0, right: 0, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8DFD2" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#8F8274' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 9, fill: '#B5A898' }} tickFormatter={v => v === 0 ? '0' : `${(v / 1000).toFixed(0)}k`} tickLine={false} axisLine={false} width={32} />
              <Tooltip content={<MiniBarTooltip />} cursor={{ fill: 'rgba(196,96,58,0.05)' }} />
              <Bar dataKey="income" fill="#6B8F71" radius={[4, 4, 0, 0]} maxBarSize={18} />
              <Bar dataKey="expense" fill="#C4603A" radius={[4, 4, 0, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recent transactions */}
      <div className="bg-white rounded-hero border border-border overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-sm font-medium text-neutral-800">Recent Transactions</h3>
          <NavLink to="/transactions" className="text-[11px] font-medium text-terra tracking-wide hover:underline">VIEW ALL</NavLink>
        </div>
        {recentTxs.length === 0 ? (
          <div className="flex flex-col items-center py-12 gap-2">
            <span className="text-3xl">📭</span>
            <p className="text-sm text-warm-500">No transactions yet</p>
          </div>
        ) : (
          <div>
            {recentTxs.map(tx => {
              const cat = catMap[tx.category] || {}
              const isRecurring = recurringCats.includes(tx.category)
              return (
                <div key={tx.id} className="flex items-center gap-3 px-5 py-3.5 border-b border-border/60 last:border-0 hover:bg-warm-50/50 transition-colors">
                  <div className="w-10 h-10 rounded-item flex items-center justify-center text-lg shrink-0" style={{ backgroundColor: (cat.color || '#8F8274') + '15' }}>
                    {cat.icon || '📦'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium text-neutral-800 truncate">{tx.description || tx.category}</p>
                      {isRecurring && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber/10 text-amber font-medium shrink-0">RECURRING</span>}
                    </div>
                    <p className="text-[11px] text-warm-500 mt-0.5">{fmtDateLabel(tx.date)}</p>
                  </div>
                  <span className={`text-sm font-medium tabular-nums ${tx.type === 'income' ? 'text-sage' : 'text-terra'}`}>
                    {tx.type === 'income' ? '+' : '−'}{fmtRs(tx.amount)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
