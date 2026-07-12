import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSummary, getSummaryOverall, getSummaryByYear, getTrends, getTransactions, getCategories, getBudgets } from '../api'
import { ChevronLeft, ChevronRight, RefreshCw, AlertTriangle } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts'

function currentMonthStr() {
  return new Date().toLocaleDateString('sv-SE').slice(0, 7)
}

function currentYearStr() {
  return String(new Date().getFullYear())
}

function shiftYear(y, delta) {
  return String(parseInt(y, 10) + delta)
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
  return `LKR ${Number(n).toLocaleString('en-US')}`
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

const TREND_SERIES = [
  { key: 'income',        label: 'Income',   color: '#2FD675' },
  { key: 'expenseNeg',    label: 'Spent',    color: '#FF4D4D' },
  { key: 'investmentNeg', label: 'Invested', color: '#6C5CE7' },
]

function DivergingTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border-2 border-ink rounded-item p-2.5 text-xs shadow-brutal-xs">
      <p className="font-bold text-warm-600 mb-1">{label}</p>
      {TREND_SERIES.map(s => {
        const p = payload.find(p => p.dataKey === s.key)
        if (!p || !p.value) return null
        return (
          <p key={s.key} style={{ color: s.color }}>
            {s.label}: LKR {Math.abs(p.value).toLocaleString('en-US')}
          </p>
        )
      })}
    </div>
  )
}

function TrendLegend({ show }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      {TREND_SERIES.filter(s => s.key !== 'investmentNeg' || show).map(s => (
        <div key={s.key} className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
          <span className="text-[10px] font-bold text-warm-600 tracking-wide">{s.label}</span>
        </div>
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
    <div className="flex items-center gap-2 px-4 py-2.5 bg-white rounded-item border-2 border-ink shadow-brutal-xs">
      <span className={`w-2.5 h-2.5 rounded-full shrink-0 border border-ink ${isRecent ? 'bg-sage animate-pulse' : 'bg-amber'}`} />
      <span className="text-[11px] font-bold text-warm-600 tracking-wide">
        LAST TELEGRAM ENTRY — {timeLabel}
      </span>
    </div>
  )
}

export default function Dashboard() {
  const [month, setMonth] = useState(currentMonthStr)
  const [year, setYear] = useState(currentYearStr)
  const [balanceScope, setBalanceScope] = useState('overall')
  const isCurrentMonth = month === currentMonthStr()
  const isCurrentYear = year === currentYearStr()

  const summaryQ = useQuery({
    queryKey: ['summary', balanceScope, balanceScope === 'month' ? month : balanceScope === 'year' ? year : 'overall'],
    queryFn: () => {
      if (balanceScope === 'overall') return getSummaryOverall()
      if (balanceScope === 'year') return getSummaryByYear(year)
      return getSummary(month)
    },
  })
  const trendsQ     = useQuery({ queryKey: ['trends'],           queryFn: () => getTrends(6) })
  const categoriesQ = useQuery({ queryKey: ['categories'],       queryFn: getCategories })
  const recentTxQ   = useQuery({ queryKey: ['transactions', month], queryFn: () => getTransactions({ month, limit: 10 }) })
  const budgetsQ    = useQuery({ queryKey: ['budgets', currentMonthStr()], queryFn: () => getBudgets(currentMonthStr()) })

  const summary    = summaryQ.data  || { totalSpent: 0, totalEarned: 0, totalInvested: 0, net: 0, expenses: [], incomes: [], investments: [], expenseCount: 0, incomeCount: 0, investmentCount: 0, txCount: 0 }
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
      if (!map[row.month]) map[row.month] = { month: row.month, expense: 0, income: 0, investment: 0 }
      map[row.month][row.type] += row.total
    }
    return Object.values(map).sort((a, b) => a.month.localeCompare(b.month)).map(r => {
      const [, mo] = r.month.split('-')
      return {
        ...r,
        expenseNeg: -r.expense,
        investmentNeg: -r.investment,
        label: new Date(2024, parseInt(mo) - 1).toLocaleString('default', { month: 'short' }),
      }
    })
  }, [trends])

  const hasInvestmentTrend = barData.some(r => r.investment > 0)

  const trendCaption = useMemo(() => {
    if (barData.length < 2) return null
    const last = barData[barData.length - 1]
    const prev = barData[barData.length - 2]
    const lastNet = last.income - last.expense - last.investment
    const prevNet = prev.income - prev.expense - prev.investment
    if (!prevNet) return null
    const pct = Math.round(((lastNet - prevNet) / Math.abs(prevNet)) * 100)
    const dir = pct >= 0 ? '↑' : '↓'
    return `Net LKR ${Math.abs(lastNet).toLocaleString('en-US')} this month, ${dir}${Math.abs(pct)}% vs last`
  }, [barData])

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
          <h1 className="text-2xl font-bold text-ink tracking-tight">{getGreeting()}, Kavina</h1>
          <p className="text-[11px] font-bold text-warm-600 tracking-wide mt-1">{formatMonthLabel(month).toUpperCase()}</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setMonth(m => shiftMonth(m, -1))} className="p-2 rounded-item text-warm-500 hover:text-terra hover:bg-warm-200/60 transition-colors"><ChevronLeft size={16} /></button>
          {!isCurrentMonth && <button onClick={() => setMonth(currentMonthStr())} className="px-2.5 py-1 rounded-full text-[11px] font-bold text-white bg-terra border-2 border-ink shadow-brutal-xs">Today</button>}
          <button onClick={() => setMonth(m => shiftMonth(m, 1))} disabled={isCurrentMonth} className="p-2 rounded-item text-warm-500 hover:text-terra hover:bg-warm-200/60 transition-colors disabled:opacity-30"><ChevronRight size={16} /></button>
          <button onClick={() => { summaryQ.refetch(); trendsQ.refetch(); recentTxQ.refetch(); budgetsQ.refetch() }} className="p-2 rounded-item text-warm-500 hover:text-terra hover:bg-warm-200/60 transition-colors ml-1"><RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} /></button>
        </div>
      </div>

      {/* Hero balance card */}
      <div className="bg-terra rounded-hero border-2 border-ink shadow-brutal p-6 mb-4 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <p className="text-[11px] font-bold tracking-widest opacity-90">NET BALANCE</p>
          <div className="flex gap-1 p-0.5 rounded-full bg-ink/25 border border-ink/40">
            {[
              { id: 'overall', label: 'Overall' },
              { id: 'month', label: 'Month' },
              { id: 'year', label: 'Year' },
            ].map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setBalanceScope(id)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide transition-colors ${
                  balanceScope === id
                    ? 'bg-white text-terra border border-ink'
                    : 'text-white/80 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {balanceScope === 'overall' && (
          <p className="text-[10px] tracking-wide opacity-60 mb-1">Lifetime</p>
        )}
        {balanceScope === 'month' && (
          <div className="flex items-center gap-1 mb-1">
            <button
              type="button"
              onClick={() => setMonth(m => shiftMonth(m, -1))}
              className="p-1 rounded-item text-white/70 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Previous month"
            >
              <ChevronLeft size={14} />
            </button>
            <p className="text-[10px] tracking-wide opacity-60 min-w-[120px] text-center">{formatMonthLabel(month)}</p>
            <button
              type="button"
              onClick={() => setMonth(m => shiftMonth(m, 1))}
              disabled={isCurrentMonth}
              className="p-1 rounded-item text-white/70 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30"
              aria-label="Next month"
            >
              <ChevronRight size={14} />
            </button>
            {!isCurrentMonth && (
              <button
                type="button"
                onClick={() => setMonth(currentMonthStr())}
                className="ml-1 px-2 py-0.5 rounded-full text-[9px] font-bold border border-white/40 bg-white/15 hover:bg-white/25 transition-colors"
              >
                Today
              </button>
            )}
          </div>
        )}
        {balanceScope === 'year' && (
          <div className="flex items-center gap-1 mb-1">
            <button
              type="button"
              onClick={() => setYear(y => shiftYear(y, -1))}
              className="p-1 rounded-item text-white/70 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Previous year"
            >
              <ChevronLeft size={14} />
            </button>
            <p className="text-[10px] tracking-wide opacity-60 min-w-[48px] text-center">{year}</p>
            <button
              type="button"
              onClick={() => setYear(y => shiftYear(y, 1))}
              disabled={isCurrentYear}
              className="p-1 rounded-item text-white/70 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30"
              aria-label="Next year"
            >
              <ChevronRight size={14} />
            </button>
            {!isCurrentYear && (
              <button
                type="button"
                onClick={() => setYear(currentYearStr())}
                className="ml-1 px-2 py-0.5 rounded-full text-[9px] font-bold border border-white/40 bg-white/15 hover:bg-white/25 transition-colors"
              >
                This year
              </button>
            )}
          </div>
        )}
        <p className="text-[38px] font-bold leading-tight tracking-tight">
          {summary.net >= 0 ? '+' : '−'}LKR {Math.abs(summary.net).toLocaleString('en-US')}
        </p>
        <div className="flex gap-6 mt-4">
          <div>
            <p className="text-[11px] font-bold tracking-wide opacity-80">↑ INCOME</p>
            <p className="text-lg font-bold">LKR {summary.totalEarned.toLocaleString('en-US')}</p>
          </div>
          <div>
            <p className="text-[11px] font-bold tracking-wide opacity-80">↓ SPENT</p>
            <p className="text-lg font-bold">LKR {summary.totalSpent.toLocaleString('en-US')}</p>
          </div>
          {summary.totalInvested > 0 && (
            <div>
              <p className="text-[11px] font-bold tracking-wide opacity-80">↗ INVESTED</p>
              <p className="text-lg font-bold">LKR {summary.totalInvested.toLocaleString('en-US')}</p>
            </div>
          )}
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
        <div className="mb-4 p-3.5 rounded-card border-2 border-ink bg-amber shadow-brutal-sm flex items-start gap-2.5">
          <AlertTriangle size={15} className="text-ink shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-ink mb-1">Budget Alerts</p>
            {budgetWarnings.map(b => (
              <p key={b.id} className="text-[11px] font-bold text-ink/80">
                {categories.find(c => c.name === b.category)?.icon || '📦'} {b.category}:
                <span className={b.pct >= 100 ? ' text-terra font-bold' : ' text-ink font-bold'}> {b.pct}%</span>
                {' '} ({fmtRs(b.spent)} of {fmtRs(b.monthly_limit)})
              </p>
            ))}
          </div>
        </div>
      )}

      {/* This week summary */}
      <div className="flex gap-3 mb-5">
        <div className="flex-1 bg-sage rounded-card border-2 border-ink shadow-brutal-sm p-4">
          <p className="text-[11px] font-bold text-ink/70 tracking-wide mb-1">THIS WEEK INCOME</p>
          <p className="text-lg font-bold text-white">{weekIncome > 0 ? `+${fmtRs(weekIncome)}` : '—'}</p>
        </div>
        <div className="flex-1 bg-terra rounded-card border-2 border-ink shadow-brutal-sm p-4">
          <p className="text-[11px] font-bold text-white/80 tracking-wide mb-1">THIS WEEK SPENT</p>
          <p className="text-lg font-bold text-white">{weekExpense > 0 ? fmtRs(weekExpense) : '—'}</p>
        </div>
      </div>

      {/* Mini monthly bar chart */}
      {barData.length > 0 && (
        <div className="bg-white rounded-hero border-2 border-ink shadow-brutal p-5 mb-5">
          <h3 className="text-sm font-bold text-ink mb-0.5">Monthly Trend</h3>
          <p className="text-[11px] font-bold text-warm-600 tracking-wide mb-1">
            {trendCaption || 'LAST 6 MONTHS'}
          </p>
          <TrendLegend show={hasInvestmentTrend} />
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={barData} barGap={2} margin={{ top: 0, right: 0, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#0A0A0A" strokeOpacity={0.1} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#0A0A0A', fontWeight: 700 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 9, fill: '#6F6252' }} tickFormatter={v => v === 0 ? '0' : `${(Math.abs(v) / 1000).toFixed(0)}k`} tickLine={false} axisLine={false} width={32} />
              <ReferenceLine y={0} stroke="#0A0A0A" strokeWidth={2} />
              <Tooltip content={<DivergingTooltip />} cursor={{ fill: 'rgba(10,10,10,0.06)' }} />
              <Bar dataKey="income" stackId="in" fill="#2FD675" radius={[4, 4, 0, 0]} maxBarSize={20} stroke="#0A0A0A" strokeWidth={2} />
              <Bar dataKey="expenseNeg" stackId="out" fill="#FF4D4D" radius={[0, 0, 0, 0]} maxBarSize={20} stroke="#0A0A0A" strokeWidth={2} />
              <Bar dataKey="investmentNeg" stackId="out" fill="#6C5CE7" radius={[0, 0, 4, 4]} maxBarSize={20} stroke="#0A0A0A" strokeWidth={2} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recent transactions */}
      <div className="bg-white rounded-hero border-2 border-ink shadow-brutal overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b-2 border-ink">
          <h3 className="text-sm font-bold text-ink">Recent Transactions</h3>
          <NavLink to="/transactions" className="text-[11px] font-bold text-terra tracking-wide hover:underline">VIEW ALL</NavLink>
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
                <div key={tx.id} className="flex items-center gap-3 px-5 py-3.5 border-b-2 border-ink/10 last:border-0 hover:bg-warm-50/50 transition-colors">
                  <div className="w-10 h-10 rounded-item flex items-center justify-center text-lg shrink-0 border-2 border-ink" style={{ backgroundColor: cat.color || '#525252' }}>
                    {cat.icon || '📦'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-bold text-ink truncate">{tx.description || tx.category}</p>
                      {isRecurring && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber border border-ink text-ink font-bold shrink-0">RECURRING</span>}
                    </div>
                    <p className="text-[11px] text-warm-500 mt-0.5">{fmtDateLabel(tx.date)}</p>
                  </div>
                  <span className={`text-sm font-bold tabular-nums ${tx.type === 'income' ? 'text-sage-dark' : tx.type === 'investment' ? 'text-invest' : 'text-terra'}`}>
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
