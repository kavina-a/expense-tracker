import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSummary, getTrends, getCategories, getCategoryTrends } from '../api'
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell, ReferenceLine,
  LineChart, Line,
} from 'recharts'

function currentMonthStr() {
  return new Date().toLocaleDateString('sv-SE').slice(0, 7)
}

function formatMonthLabel(m) {
  const [y, mo] = m.split('-')
  return new Date(parseInt(y), parseInt(mo) - 1).toLocaleString('default', { month: 'long', year: 'numeric' })
}

function shortMonth(m) {
  const [, mo] = m.split('-')
  return new Date(2024, parseInt(mo) - 1).toLocaleString('default', { month: 'short' })
}

function shiftMonth(m, delta) {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmtRs(n, compact = false) {
  if (n === 0) return '—'
  if (compact && Math.abs(n) >= 100000) return `${(n / 100000).toFixed(1)}L`
  if (compact && Math.abs(n) >= 1000) return `${(n / 1000).toFixed(0)}k`
  return `Rs. ${Math.abs(n).toLocaleString('en-IN')}`
}

const TIME_RANGES = [
  { label: 'This month',    months: 1 },
  { label: 'Last 3 months', months: 3 },
  { label: 'Last 6 months', months: 6 },
  { label: 'Last 12 months', months: 12 },
]

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-border rounded-item p-3 text-xs">
      <p className="text-warm-600 font-medium mb-1.5">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color || p.stroke || p.fill }}>
          {p.name === 'income' ? 'Income' : p.name === 'expense' ? 'Expenses' : p.name}: Rs. {Math.abs(p.value).toLocaleString('en-IN')}
        </p>
      ))}
    </div>
  )
}

function CategoryPillBar({ label, icon, amount, total, color, delta }) {
  const pct = total > 0 ? (amount / total) * 100 : 0
  return (
    <div className="mb-3.5">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-sm">{icon}</span>
          <span className="text-xs font-medium text-neutral-700">{label}</span>
          {delta !== null && delta !== undefined && (
            <span className={`text-[10px] font-medium ${delta > 0 ? 'text-terra' : delta < 0 ? 'text-sage' : 'text-warm-400'}`}>
              {delta > 0 ? '↑' : delta < 0 ? '↓' : '='}{Math.abs(delta).toFixed(0)}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-neutral-800 tabular-nums">Rs. {amount.toLocaleString('en-IN')}</span>
          <span className="text-[10px] text-warm-400 tabular-nums w-10 text-right">{pct.toFixed(0)}%</span>
        </div>
      </div>
      <div className="h-2.5 bg-warm-200/60 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(pct, 1)}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

export default function Stats() {
  const [month, setMonth] = useState(currentMonthStr)
  const [range, setRange] = useState(6)
  const [selectedCat, setSelectedCat] = useState(null)
  const isCurrentMonth = month === currentMonthStr()

  const summaryQ    = useQuery({ queryKey: ['summary', month],            queryFn: () => getSummary(month) })
  const prevSummaryQ = useQuery({ queryKey: ['summary', shiftMonth(month, -1)], queryFn: () => getSummary(shiftMonth(month, -1)) })
  const trendsQ     = useQuery({ queryKey: ['trends', range],             queryFn: () => getTrends(range) })
  const categoriesQ = useQuery({ queryKey: ['categories'],                queryFn: getCategories })
  const catTrendQ   = useQuery({
    queryKey: ['category-trends', selectedCat, range],
    queryFn: () => getCategoryTrends(selectedCat, range),
    enabled: !!selectedCat,
  })

  const summary     = summaryQ.data     || { totalSpent: 0, totalEarned: 0, net: 0, expenses: [], incomes: [] }
  const prevSummary = prevSummaryQ.data  || { totalSpent: 0, totalEarned: 0, net: 0, expenses: [], incomes: [] }
  const trends      = trendsQ.data       || []
  const categories  = categoriesQ.data   || []

  const catMap = useMemo(() => Object.fromEntries(categories.map(c => [c.name, c])), [categories])

  // Build previous month category lookup for deltas
  const prevExpenseMap = useMemo(() => {
    const m = {}
    for (const e of prevSummary.expenses || []) m[e.category] = e.total
    return m
  }, [prevSummary])

  const barData = useMemo(() => {
    const map = {}
    for (const row of trends) {
      if (!map[row.month]) map[row.month] = { month: row.month, expense: 0, income: 0 }
      map[row.month][row.type] += row.total
    }
    return Object.values(map)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(r => ({ ...r, net: r.income - r.expense, label: shortMonth(r.month) }))
  }, [trends])

  // Category trend line data
  const catLineData = useMemo(() => {
    if (!catTrendQ.data) return []
    return catTrendQ.data.map(r => ({ month: r.month, label: shortMonth(r.month), total: r.total }))
  }, [catTrendQ.data])

  const totalExpenseAmt = summary.expenses.reduce((s, e) => s + e.total, 0)
  const totalIncomeAmt  = summary.incomes.reduce((s, e) => s + e.total, 0)

  const expenseChange = prevSummary.totalSpent > 0 ? ((summary.totalSpent - prevSummary.totalSpent) / prevSummary.totalSpent) * 100 : null
  const incomeChange = prevSummary.totalEarned > 0 ? ((summary.totalEarned - prevSummary.totalEarned) / prevSummary.totalEarned) * 100 : null

  // MoM comparison table data
  const momRows = useMemo(() => {
    const allCats = new Set([
      ...summary.expenses.map(e => e.category),
      ...(prevSummary.expenses || []).map(e => e.category),
    ])
    return [...allCats].map(cat => {
      const curr = summary.expenses.find(e => e.category === cat)?.total || 0
      const prev = prevExpenseMap[cat] || 0
      const change = prev > 0 ? ((curr - prev) / prev) * 100 : curr > 0 ? 100 : 0
      return { category: cat, current: curr, previous: prev, change }
    }).sort((a, b) => b.current - a.current)
  }, [summary, prevExpenseMap])

  return (
    <div className="p-5 md:p-8 max-w-3xl mx-auto md:mx-0">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-medium text-neutral-800">Stats</h1>
          <p className="text-[11px] text-warm-500 tracking-wide mt-1">{formatMonthLabel(month).toUpperCase()}</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setMonth(m => shiftMonth(m, -1))} className="p-2 rounded-item text-warm-500 hover:text-terra hover:bg-warm-200/60 transition-colors"><ChevronLeft size={16} /></button>
          {!isCurrentMonth && <button onClick={() => setMonth(currentMonthStr())} className="px-2.5 py-1 rounded-full text-[11px] font-medium text-terra bg-terra/10 hover:bg-terra/20 transition-colors">Today</button>}
          <button onClick={() => setMonth(m => shiftMonth(m, 1))} disabled={isCurrentMonth} className="p-2 rounded-item text-warm-500 hover:text-terra hover:bg-warm-200/60 transition-colors disabled:opacity-30"><ChevronRight size={16} /></button>
        </div>
      </div>

      {/* Time range toggle */}
      <div className="flex gap-1.5 mb-5 overflow-x-auto pb-1">
        {TIME_RANGES.map(r => (
          <button
            key={r.months}
            onClick={() => setRange(r.months)}
            className={`px-3 py-1.5 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors ${
              range === r.months ? 'bg-terra text-white' : 'bg-white border border-border text-warm-600 hover:text-terra'
            }`}
          >{r.label}</button>
        ))}
      </div>

      {/* MoM KPIs */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="bg-white rounded-card border border-border p-4">
          <p className="text-[11px] text-warm-500 tracking-wide mb-1">SPENDING</p>
          <p className="text-xl font-medium text-terra">{fmtRs(summary.totalSpent)}</p>
          {expenseChange !== null && (
            <p className={`text-[11px] mt-1.5 flex items-center gap-1 ${expenseChange <= 0 ? 'text-sage' : 'text-terra'}`}>
              {expenseChange <= 0 ? <TrendingDown size={11} /> : <TrendingUp size={11} />}
              {Math.abs(expenseChange).toFixed(0)}% vs last month
            </p>
          )}
        </div>
        <div className="bg-white rounded-card border border-border p-4">
          <p className="text-[11px] text-warm-500 tracking-wide mb-1">INCOME</p>
          <p className="text-xl font-medium text-sage">{fmtRs(summary.totalEarned)}</p>
          {incomeChange !== null && (
            <p className={`text-[11px] mt-1.5 flex items-center gap-1 ${incomeChange >= 0 ? 'text-sage' : 'text-terra'}`}>
              {incomeChange >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
              {Math.abs(incomeChange).toFixed(0)}% vs last month
            </p>
          )}
        </div>
      </div>

      {/* Cash flow chart */}
      {barData.length > 0 && (
        <div className="bg-white rounded-hero border border-border p-5 mb-5">
          <h3 className="text-sm font-medium text-neutral-800 mb-0.5">Cash Flow</h3>
          <p className="text-[11px] text-warm-500 tracking-wide mb-4">INCOME VS EXPENSES</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={barData} barGap={3} margin={{ top: 5, right: 0, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8DFD2" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#8F8274' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 9, fill: '#B5A898' }} tickFormatter={v => v === 0 ? '0' : `${(v / 1000).toFixed(0)}k`} tickLine={false} axisLine={false} width={32} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(196,96,58,0.05)' }} />
              <Bar dataKey="income" fill="#6B8F71" radius={[4, 4, 0, 0]} maxBarSize={20} />
              <Bar dataKey="expense" fill="#C4603A" radius={[4, 4, 0, 0]} maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Net flow chart */}
      {barData.length > 0 && (
        <div className="bg-white rounded-hero border border-border p-5 mb-5">
          <h3 className="text-sm font-medium text-neutral-800 mb-0.5">Net Flow</h3>
          <p className="text-[11px] text-warm-500 tracking-wide mb-4">MONTHLY NET BALANCE</p>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={barData} margin={{ top: 5, right: 0, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8DFD2" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#8F8274' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 9, fill: '#B5A898' }} tickFormatter={v => v === 0 ? '0' : `${(v / 1000).toFixed(0)}k`} tickLine={false} axisLine={false} width={32} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(196,96,58,0.05)' }} />
              <ReferenceLine y={0} stroke="#D4C8B8" strokeWidth={1} />
              <Bar dataKey="net" name="Net" radius={[4, 4, 0, 0]} maxBarSize={20}>
                {barData.map((entry, i) => (<Cell key={i} fill={entry.net >= 0 ? '#6B8F71' : '#C4603A'} />))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Expense breakdown */}
      {summary.expenses.length > 0 && (
        <div className="bg-white rounded-hero border border-border p-5 mb-5">
          <h3 className="text-sm font-medium text-neutral-800 mb-0.5">Where Your Money Went</h3>
          <p className="text-[11px] text-warm-500 tracking-wide mb-4">EXPENSE BREAKDOWN</p>
          {summary.expenses
            .sort((a, b) => b.total - a.total)
            .map(e => {
              const cat = catMap[e.category] || {}
              const prev = prevExpenseMap[e.category] || 0
              const delta = prev > 0 ? ((e.total - prev) / prev) * 100 : null
              return (
                <div key={e.category} className="cursor-pointer" onClick={() => setSelectedCat(selectedCat === e.category ? null : e.category)}>
                  <CategoryPillBar
                    label={e.category}
                    icon={cat.icon || '📦'}
                    amount={e.total}
                    total={totalExpenseAmt}
                    color={cat.color || '#C4603A'}
                    delta={delta}
                  />
                </div>
              )
            })}
        </div>
      )}

      {/* Category trend line chart */}
      {selectedCat && catLineData.length > 0 && (
        <div className="bg-white rounded-hero border border-border p-5 mb-5">
          <div className="flex items-center justify-between mb-0.5">
            <h3 className="text-sm font-medium text-neutral-800">
              {catMap[selectedCat]?.icon} {selectedCat} Trend
            </h3>
            <button onClick={() => setSelectedCat(null)} className="text-[11px] text-warm-400 hover:text-terra">Clear</button>
          </div>
          <p className="text-[11px] text-warm-500 tracking-wide mb-4">SPENDING OVER {range} MONTHS</p>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={catLineData} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8DFD2" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#8F8274' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 9, fill: '#B5A898' }} tickFormatter={v => v === 0 ? '0' : `${(v / 1000).toFixed(0)}k`} tickLine={false} axisLine={false} width={32} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="total" name={selectedCat} stroke={catMap[selectedCat]?.color || '#C4603A'} strokeWidth={2.5} dot={{ r: 4, fill: catMap[selectedCat]?.color || '#C4603A' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Month-over-month comparison table */}
      {momRows.length > 0 && (
        <div className="bg-white rounded-hero border border-border overflow-hidden mb-5">
          <div className="px-5 py-4 border-b border-border">
            <h3 className="text-sm font-medium text-neutral-800">Month-over-Month</h3>
            <p className="text-[11px] text-warm-500 tracking-wide mt-0.5">EXPENSE COMPARISON VS LAST MONTH</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60">
                  <th className="px-5 py-2.5 text-left text-[11px] font-medium text-warm-500 tracking-wide">CATEGORY</th>
                  <th className="px-3 py-2.5 text-right text-[11px] font-medium text-warm-500 tracking-wide">LAST MONTH</th>
                  <th className="px-3 py-2.5 text-right text-[11px] font-medium text-warm-500 tracking-wide">THIS MONTH</th>
                  <th className="px-5 py-2.5 text-right text-[11px] font-medium text-warm-500 tracking-wide">CHANGE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {momRows.map(row => {
                  const cat = catMap[row.category] || {}
                  return (
                    <tr key={row.category} className="hover:bg-warm-50/50 transition-colors">
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{cat.icon || '📦'}</span>
                          <span className="text-neutral-700">{row.category}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-warm-500">{row.previous > 0 ? fmtRs(row.previous, true) : '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-neutral-800 font-medium">{row.current > 0 ? fmtRs(row.current, true) : '—'}</td>
                      <td className={`px-5 py-2.5 text-right tabular-nums font-medium ${
                        row.change > 5 ? 'text-terra' : row.change < -5 ? 'text-sage' : 'text-warm-400'
                      }`}>
                        {row.previous === 0 && row.current === 0 ? '—'
                          : row.previous === 0 ? 'New'
                          : `${row.change > 0 ? '+' : ''}${row.change.toFixed(0)}%`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Income breakdown */}
      {summary.incomes.length > 0 && (
        <div className="bg-white rounded-hero border border-border p-5">
          <h3 className="text-sm font-medium text-neutral-800 mb-0.5">Income Sources</h3>
          <p className="text-[11px] text-warm-500 tracking-wide mb-4">WHERE YOUR MONEY CAME FROM</p>
          {summary.incomes
            .sort((a, b) => b.total - a.total)
            .map(e => {
              const cat = catMap[e.category] || {}
              return (
                <CategoryPillBar
                  key={e.category}
                  label={e.category}
                  icon={cat.icon || '💰'}
                  amount={e.total}
                  total={totalIncomeAmt}
                  color={cat.color || '#6B8F71'}
                />
              )
            })}
        </div>
      )}
    </div>
  )
}
