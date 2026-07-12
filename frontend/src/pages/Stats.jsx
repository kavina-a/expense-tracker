import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSummary, getTrends, getCategories, getCategoryTrends } from '../api'
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
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
  return `LKR ${Math.abs(n).toLocaleString('en-US')}`
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
    <div className="bg-white border-2 border-ink rounded-item p-3 text-xs shadow-brutal-xs">
      <p className="text-warm-600 font-bold mb-1.5">{label}</p>
      {payload.map(p => (
        <p key={p.name} className="font-bold" style={{ color: p.color || p.stroke || p.fill }}>
          {p.name === 'income' ? 'Income' : p.name === 'expense' ? 'Expenses' : p.name}: LKR {Math.abs(p.value).toLocaleString('en-US')}
        </p>
      ))}
    </div>
  )
}

const FLOW_SERIES = [
  { key: 'income',        label: 'Income',   color: '#2FD675' },
  { key: 'expenseNeg',    label: 'Spent',    color: '#FF4D4D' },
  { key: 'investmentNeg', label: 'Invested', color: '#6C5CE7' },
]

function FlowTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border-2 border-ink rounded-item p-3 text-xs shadow-brutal-xs">
      <p className="text-warm-600 font-bold mb-1.5">{label}</p>
      {FLOW_SERIES.map(s => {
        const p = payload.find(p => p.dataKey === s.key)
        if (!p || !p.value) return null
        return (
          <p key={s.key} className="font-bold" style={{ color: s.color }}>
            {s.label}: LKR {Math.abs(p.value).toLocaleString('en-US')}
          </p>
        )
      })}
    </div>
  )
}

function FlowLegend({ show }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      {FLOW_SERIES.filter(s => s.key !== 'investmentNeg' || show).map(s => (
        <div key={s.key} className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
          <span className="text-[10px] font-bold text-warm-600 tracking-wide">{s.label}</span>
        </div>
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
          <span className="text-xs font-bold text-ink">{label}</span>
          {delta !== null && delta !== undefined && (
            <span className={`text-[10px] font-bold ${delta > 0 ? 'text-terra' : delta < 0 ? 'text-sage-dark' : 'text-warm-400'}`}>
              {delta > 0 ? '↑' : delta < 0 ? '↓' : '='}{Math.abs(delta).toFixed(0)}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-ink tabular-nums">LKR {amount.toLocaleString('en-US')}</span>
          <span className="text-[10px] font-bold text-warm-400 tabular-nums w-10 text-right">{pct.toFixed(0)}%</span>
        </div>
      </div>
      <div className="h-2.5 bg-white border-2 border-ink rounded-full overflow-hidden">
        <div className="h-full border-r-2 border-ink transition-all duration-500" style={{ width: `${Math.max(pct, 1)}%`, backgroundColor: color }} />
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

  const summary     = summaryQ.data     || { totalSpent: 0, totalEarned: 0, totalInvested: 0, net: 0, expenses: [], incomes: [], investments: [] }
  const prevSummary = prevSummaryQ.data  || { totalSpent: 0, totalEarned: 0, totalInvested: 0, net: 0, expenses: [], incomes: [], investments: [] }
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
      if (!map[row.month]) map[row.month] = { month: row.month, expense: 0, income: 0, investment: 0 }
      map[row.month][row.type] += row.total
    }
    return Object.values(map)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(r => ({
        ...r,
        net: r.income - r.expense - r.investment,
        expenseNeg: -r.expense,
        investmentNeg: -r.investment,
        label: shortMonth(r.month),
      }))
  }, [trends])

  const hasInvestmentTrend = barData.some(r => r.investment > 0)

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
          <h1 className="text-2xl font-bold text-ink uppercase tracking-tight">Stats</h1>
          <p className="text-[11px] font-bold text-warm-600 tracking-wide mt-1">{formatMonthLabel(month).toUpperCase()}</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setMonth(m => shiftMonth(m, -1))} className="p-2 rounded-item text-warm-500 hover:text-terra hover:bg-warm-200/60 transition-colors"><ChevronLeft size={16} /></button>
          {!isCurrentMonth && <button onClick={() => setMonth(currentMonthStr())} className="px-2.5 py-1 rounded-full text-[11px] font-bold text-white bg-terra border-2 border-ink shadow-brutal-xs transition-colors">Today</button>}
          <button onClick={() => setMonth(m => shiftMonth(m, 1))} disabled={isCurrentMonth} className="p-2 rounded-item text-warm-500 hover:text-terra hover:bg-warm-200/60 transition-colors disabled:opacity-30"><ChevronRight size={16} /></button>
        </div>
      </div>

      {/* Time range toggle */}
      <div className="flex gap-1.5 mb-5 overflow-x-auto pb-1">
        {TIME_RANGES.map(r => (
          <button
            key={r.months}
            onClick={() => setRange(r.months)}
            className={`px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap transition-colors ${
              range === r.months ? 'bg-terra text-white border-2 border-ink shadow-brutal-xs' : 'bg-white border-2 border-ink text-warm-600 hover:text-terra'
            }`}
          >{r.label}</button>
        ))}
      </div>

      {/* MoM KPIs */}
      <div className={`grid gap-3 mb-3 ${summary.totalInvested > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <div className="bg-white rounded-card border-2 border-ink shadow-brutal-sm p-4">
          <p className="text-[11px] font-bold text-warm-600 tracking-wide mb-1">SPENDING</p>
          <p className="text-xl font-bold text-terra">{fmtRs(summary.totalSpent)}</p>
          {expenseChange !== null && (
            <p className={`text-[11px] font-bold mt-1.5 flex items-center gap-1 ${expenseChange <= 0 ? 'text-sage-dark' : 'text-terra'}`}>
              {expenseChange <= 0 ? <TrendingDown size={11} /> : <TrendingUp size={11} />}
              {Math.abs(expenseChange).toFixed(0)}% vs last month
            </p>
          )}
        </div>
        <div className="bg-white rounded-card border-2 border-ink shadow-brutal-sm p-4">
          <p className="text-[11px] font-bold text-warm-600 tracking-wide mb-1">INCOME</p>
          <p className="text-xl font-bold text-sage-dark">{fmtRs(summary.totalEarned)}</p>
          {incomeChange !== null && (
            <p className={`text-[11px] font-bold mt-1.5 flex items-center gap-1 ${incomeChange >= 0 ? 'text-sage-dark' : 'text-terra'}`}>
              {incomeChange >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
              {Math.abs(incomeChange).toFixed(0)}% vs last month
            </p>
          )}
        </div>
        {summary.totalInvested > 0 && (
          <div className="bg-white rounded-card border-2 border-ink shadow-brutal-sm p-4">
            <p className="text-[11px] font-bold text-warm-600 tracking-wide mb-1">INVESTED</p>
            <p className="text-xl font-bold text-invest">{fmtRs(summary.totalInvested)}</p>
          </div>
        )}
      </div>

      {/* Plain-language takeaway */}
      {summary.totalEarned > 0 && (
        <p className="text-[11px] font-bold text-warm-600 tracking-wide mb-5 px-1">
          You kept <span className="font-bold text-ink">{Math.max(Math.round((summary.net / summary.totalEarned) * 100), 0)}%</span> of what came in
          {summary.totalInvested > 0 && (
            <> and invested <span className="font-bold text-invest">{Math.round((summary.totalInvested / summary.totalEarned) * 100)}%</span></>
          )} this month.
        </p>
      )}

      {/* Combined cash flow chart */}
      {barData.length > 0 && (
        <div className="bg-white rounded-hero border-2 border-ink shadow-brutal p-5 mb-5">
          <h3 className="text-sm font-bold text-ink mb-0.5">Cash Flow</h3>
          <p className="text-[11px] font-bold text-warm-600 tracking-wide mb-3">INCOME ABOVE THE LINE, OUTFLOWS BELOW</p>
          <FlowLegend show={hasInvestmentTrend} />
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={barData} barGap={2} margin={{ top: 5, right: 0, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#0A0A0A" strokeOpacity={0.1} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#0A0A0A', fontWeight: 700 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 9, fill: '#6F6252' }} tickFormatter={v => v === 0 ? '0' : `${(Math.abs(v) / 1000).toFixed(0)}k`} tickLine={false} axisLine={false} width={32} />
              <ReferenceLine y={0} stroke="#0A0A0A" strokeWidth={2} />
              <Tooltip content={<FlowTooltip />} cursor={{ fill: 'rgba(10,10,10,0.06)' }} />
              <Bar dataKey="income" stackId="in" fill="#2FD675" radius={[4, 4, 0, 0]} maxBarSize={24} stroke="#0A0A0A" strokeWidth={2} />
              <Bar dataKey="expenseNeg" stackId="out" fill="#FF4D4D" radius={[0, 0, 0, 0]} maxBarSize={24} stroke="#0A0A0A" strokeWidth={2} />
              <Bar dataKey="investmentNeg" stackId="out" fill="#6C5CE7" radius={[0, 0, 4, 4]} maxBarSize={24} stroke="#0A0A0A" strokeWidth={2} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Expense breakdown */}
      {summary.expenses.length > 0 && (
        <div className="bg-white rounded-hero border-2 border-ink shadow-brutal p-5 mb-5">
          <h3 className="text-sm font-bold text-ink mb-0.5">Where Your Money Went</h3>
          <p className="text-[11px] font-bold text-warm-600 tracking-wide mb-4">EXPENSE BREAKDOWN</p>
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
                    color={cat.color || '#FF4D4D'}
                    delta={delta}
                  />
                </div>
              )
            })}
        </div>
      )}

      {/* Investment breakdown */}
      {summary.investments.length > 0 && (
        <div className="bg-white rounded-hero border-2 border-ink shadow-brutal p-5 mb-5">
          <h3 className="text-sm font-bold text-ink mb-0.5">Where Your Money Grew</h3>
          <p className="text-[11px] font-bold text-warm-600 tracking-wide mb-4">INVESTMENT BREAKDOWN</p>
          {summary.investments
            .sort((a, b) => b.total - a.total)
            .map(e => {
              const cat = catMap[e.category] || {}
              return (
                <div key={e.category} className="cursor-pointer" onClick={() => setSelectedCat(selectedCat === e.category ? null : e.category)}>
                  <CategoryPillBar
                    label={e.category}
                    icon={cat.icon || '📈'}
                    amount={e.total}
                    total={summary.totalInvested}
                    color={cat.color || '#6C5CE7'}
                  />
                </div>
              )
            })}
        </div>
      )}

      {/* Category trend line chart */}
      {selectedCat && catLineData.length > 0 && (
        <div className="bg-white rounded-hero border-2 border-ink shadow-brutal p-5 mb-5">
          <div className="flex items-center justify-between mb-0.5">
            <h3 className="text-sm font-bold text-ink">
              {catMap[selectedCat]?.icon} {selectedCat} Trend
            </h3>
            <button onClick={() => setSelectedCat(null)} className="text-[11px] font-bold text-warm-400 hover:text-terra">Clear</button>
          </div>
          <p className="text-[11px] font-bold text-warm-600 tracking-wide mb-4">SPENDING OVER {range} MONTHS</p>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={catLineData} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#0A0A0A" strokeOpacity={0.1} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#0A0A0A', fontWeight: 700 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 9, fill: '#6F6252' }} tickFormatter={v => v === 0 ? '0' : `${(v / 1000).toFixed(0)}k`} tickLine={false} axisLine={false} width={32} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="total" name={selectedCat} stroke={catMap[selectedCat]?.color || '#FF4D4D'} strokeWidth={3} dot={{ r: 5, fill: catMap[selectedCat]?.color || '#FF4D4D', stroke: '#0A0A0A', strokeWidth: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Month-over-month comparison table */}
      {momRows.length > 0 && (
        <div className="bg-white rounded-hero border-2 border-ink shadow-brutal overflow-hidden mb-5">
          <div className="px-5 py-4 border-b-2 border-ink">
            <h3 className="text-sm font-bold text-ink">Month-over-Month</h3>
            <p className="text-[11px] font-bold text-warm-600 tracking-wide mt-0.5">EXPENSE COMPARISON VS LAST MONTH</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b-2 border-ink">
                  <th className="px-5 py-2.5 text-left text-[11px] font-bold text-warm-600 tracking-wide">CATEGORY</th>
                  <th className="px-3 py-2.5 text-right text-[11px] font-bold text-warm-600 tracking-wide">LAST MONTH</th>
                  <th className="px-3 py-2.5 text-right text-[11px] font-bold text-warm-600 tracking-wide">THIS MONTH</th>
                  <th className="px-5 py-2.5 text-right text-[11px] font-bold text-warm-600 tracking-wide">CHANGE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/10">
                {momRows.map(row => {
                  const cat = catMap[row.category] || {}
                  return (
                    <tr key={row.category} className="hover:bg-warm-50/50 transition-colors">
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{cat.icon || '📦'}</span>
                          <span className="font-bold text-ink">{row.category}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-bold text-warm-500">{row.previous > 0 ? fmtRs(row.previous, true) : '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink font-bold">{row.current > 0 ? fmtRs(row.current, true) : '—'}</td>
                      <td className={`px-5 py-2.5 text-right tabular-nums font-bold ${
                        row.change > 5 ? 'text-terra' : row.change < -5 ? 'text-sage-dark' : 'text-warm-400'
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
        <div className="bg-white rounded-hero border-2 border-ink shadow-brutal p-5">
          <h3 className="text-sm font-bold text-ink mb-0.5">Income Sources</h3>
          <p className="text-[11px] font-bold text-warm-600 tracking-wide mb-4">WHERE YOUR MONEY CAME FROM</p>
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
                  color={cat.color || '#2FD675'}
                />
              )
            })}
        </div>
      )}
    </div>
  )
}
