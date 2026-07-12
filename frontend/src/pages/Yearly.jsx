import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getYearly, getCategories } from '../api'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts'
import { ChevronLeft, ChevronRight, Download, TrendingUp, TrendingDown, Wallet, Percent } from 'lucide-react'

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTHS_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December']

function fmtRs(n, compact = false) {
  if (n === 0) return '—'
  if (compact) {
    if (Math.abs(n) >= 100000) return `${(n / 100000).toFixed(1)}L`
    if (Math.abs(n) >= 1000)   return `${(n / 1000).toFixed(0)}k`
  }
  return `LKR ${Math.abs(n).toLocaleString('en-US')}`
}

function exportCSV(data) {
  const header = ['Month', 'Income', 'Expenses', 'Net', 'Savings Rate %']
  const rows = data.months.map((m, i) => [
    MONTHS_FULL[i],
    m.income.toFixed(2),
    m.expense.toFixed(2),
    m.net.toFixed(2),
    m.income > 0 ? ((m.net / m.income) * 100).toFixed(1) : '0',
  ])
  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = `yearly-${data.year}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border-2 border-ink rounded-item p-3 text-xs shadow-brutal-xs">
      <p className="text-warm-600 font-bold mb-1.5">{label}</p>
      {payload.map(p => (
        <p key={p.name} className="font-bold" style={{ color: p.color || p.fill }}>
          {p.name}: LKR {Math.abs(p.value).toLocaleString('en-US')}
        </p>
      ))}
    </div>
  )
}

function KpiCard({ label, value, sub, icon: Icon, color }) {
  const palette = {
    sage:   'bg-sage',
    terra:  'bg-terra',
    indigo: 'bg-invest',
    amber:  'bg-amber',
  }
  const textColor = {
    sage: 'text-white', terra: 'text-white', indigo: 'text-white', amber: 'text-ink',
  }
  return (
    <div className={`flex-1 min-w-[140px] rounded-card border-2 border-ink shadow-brutal-sm p-4 ${palette[color]}`}>
      <div className={`flex items-center gap-2 mb-2 ${textColor[color]}`}>
        <Icon size={14} />
        <span className="text-[11px] font-bold tracking-wide opacity-80">{label.toUpperCase()}</span>
      </div>
      <p className={`text-xl font-bold ${textColor[color]}`}>{value}</p>
      {sub && <p className={`text-[11px] font-bold mt-1 opacity-70 ${textColor[color]}`}>{sub}</p>}
    </div>
  )
}

function MonthlyTable({ months }) {
  const today = new Date()
  const currentMonthIdx = today.getMonth()
  const totalIncome  = months.reduce((s, m) => s + m.income,  0)
  const totalExpense = months.reduce((s, m) => s + m.expense, 0)
  const totalNet     = totalIncome - totalExpense

  const rows = [
    { label: 'Income',   key: 'income',  color: 'text-sage-dark', total: totalIncome },
    { label: 'Expenses', key: 'expense', color: 'text-terra',     total: totalExpense },
    { label: 'Net',      key: 'net',     color: null,             total: totalNet },
  ]

  return (
    <div className="overflow-x-auto rounded-hero border-2 border-ink shadow-brutal bg-white">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b-2 border-ink">
            <th className="sticky left-0 bg-white z-10 px-4 py-3 text-left text-[11px] font-bold text-warm-500 tracking-wide w-24">
              MONTH
            </th>
            {MONTHS_SHORT.map((m, i) => (
              <th
                key={m}
                className={`px-3 py-3 text-center font-bold whitespace-nowrap ${i === currentMonthIdx ? 'text-terra' : 'text-warm-500'}`}
              >
                {m}
              </th>
            ))}
            <th className="px-4 py-3 text-right text-warm-600 font-bold whitespace-nowrap">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/10">
          {rows.map(row => (
            <tr key={row.key} className="hover:bg-warm-50/50 transition-colors">
              <td className="sticky left-0 bg-white z-10 px-4 py-3 text-[11px] font-bold text-warm-600 tracking-wide">
                {row.label.toUpperCase()}
              </td>
              {months.map((m, i) => {
                const val = row.key === 'net' ? m.income - m.expense : m[row.key]
                const isNet = row.key === 'net'
                const netColor = val >= 0 ? 'text-sage-dark' : 'text-terra'
                const isFuture = i > currentMonthIdx
                return (
                  <td key={i} className={`px-3 py-3 text-right tabular-nums font-bold whitespace-nowrap ${isFuture ? 'text-warm-300' : isNet ? netColor : row.color}`}>
                    {val === 0 ? '—' : fmtRs(val, true)}
                  </td>
                )
              })}
              <td className={`px-4 py-3 text-right font-bold tabular-nums whitespace-nowrap ${row.key === 'net' ? (totalNet >= 0 ? 'text-sage-dark' : 'text-terra') : row.color}`}>
                {fmtRs(row.total, true)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CategoryTable({ rows, catMap, title, color }) {
  if (!rows.length) return null
  const today = new Date()
  const currentMonthIdx = today.getMonth()

  return (
    <div className="overflow-x-auto rounded-hero border-2 border-ink shadow-brutal bg-white">
      <div className="px-5 py-3.5 border-b-2 border-ink">
        <h3 className="text-sm font-bold text-ink">{title}</h3>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b-2 border-ink/20">
            <th className="sticky left-0 bg-white z-10 px-4 py-2.5 text-left text-[11px] font-bold text-warm-500 tracking-wide w-36">
              CATEGORY
            </th>
            {MONTHS_SHORT.map((m, i) => (
              <th key={m} className={`px-3 py-2.5 text-center font-bold ${i === currentMonthIdx ? 'text-terra' : 'text-warm-400'}`}>
                {m}
              </th>
            ))}
            <th className="px-4 py-2.5 text-right text-warm-500 font-bold">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/10">
          {rows.map(row => {
            const cat = catMap[row.category] || {}
            return (
              <tr key={row.category} className="hover:bg-warm-50/50 transition-colors">
                <td className="sticky left-0 bg-white z-10 px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-5 h-5 rounded-md flex items-center justify-center text-xs shrink-0 border border-ink"
                      style={{ backgroundColor: cat.color || '#525252' }}
                    >
                      {cat.icon || '📦'}
                    </span>
                    <span className="font-bold text-ink truncate max-w-[90px]">{row.category}</span>
                  </div>
                </td>
                {row.months.map((v, i) => (
                  <td key={i} className={`px-3 py-2.5 text-right tabular-nums font-bold ${v === 0 ? 'text-warm-300' : color}`}>
                    {v === 0 ? '—' : fmtRs(v, true)}
                  </td>
                ))}
                <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${color}`}>
                  {fmtRs(row.total, true)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function Yearly() {
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)

  const yearlyQ     = useQuery({ queryKey: ['yearly', year], queryFn: () => getYearly(year) })
  const categoriesQ = useQuery({ queryKey: ['categories'],   queryFn: getCategories })

  const data   = yearlyQ.data
  const catMap = useMemo(() =>
    Object.fromEntries((categoriesQ.data || []).map(c => [c.name, c]))
  , [categoriesQ.data])

  const barData = useMemo(() => {
    if (!data) return []
    return data.months.map((m, i) => ({
      label: MONTHS_SHORT[i],
      income:  m.income,
      expense: m.expense,
      net:     m.net,
    }))
  }, [data])

  const bestMonth = useMemo(() => {
    if (!data) return null
    return [...data.months].sort((a, b) => b.net - a.net)[0]
  }, [data])

  const worstMonth = useMemo(() => {
    if (!data) return null
    return [...data.months].filter(m => m.expense > 0).sort((a, b) => a.net - b.net)[0]
  }, [data])

  return (
    <div className="p-5 md:p-8 max-w-6xl mx-auto md:mx-0">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink uppercase tracking-tight">Yearly Overview</h1>
          <p className="text-[11px] font-bold text-warm-600 tracking-wide mt-1">FULL-YEAR INCOME, EXPENSES & CASH FLOW</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 px-3 py-2 bg-white border-2 border-ink rounded-item">
            <button onClick={() => setYear(y => y - 1)} className="text-warm-500 hover:text-terra p-0.5">
              <ChevronLeft size={14} />
            </button>
            <span className="text-sm font-bold text-ink min-w-[40px] text-center">{year}</span>
            <button
              onClick={() => setYear(y => y + 1)}
              disabled={year >= thisYear}
              className="text-warm-500 hover:text-terra disabled:opacity-30 p-0.5"
            >
              <ChevronRight size={14} />
            </button>
          </div>
          {data && (
            <button
              onClick={() => exportCSV(data)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-item text-[11px] font-bold text-warm-600 border-2 border-ink hover:border-terra hover:text-terra transition-colors tracking-wide"
            >
              <Download size={13} /> EXPORT CSV
            </button>
          )}
        </div>
      </div>

      {yearlyQ.isLoading ? (
        <div className="flex items-center justify-center py-32 text-warm-500 text-sm">Loading…</div>
      ) : !data ? null : (
        <>
          <div className="flex flex-wrap gap-3 mb-6">
            <KpiCard label="Total Income" value={fmtRs(data.totalIncome)} sub={`${data.months.filter(m => m.income > 0).length} active months`} icon={TrendingUp} color="sage" />
            <KpiCard label="Total Expenses" value={fmtRs(data.totalExpense)} sub={`Across ${data.expenseByCategory.length} categories`} icon={TrendingDown} color="terra" />
            <KpiCard label="Net Savings" value={(data.net >= 0 ? '+' : '−') + fmtRs(data.net)} sub={data.net >= 0 ? 'Saved this year' : 'Overspent this year'} icon={Wallet} color={data.net >= 0 ? 'indigo' : 'terra'} />
            <KpiCard label="Savings Rate" value={data.totalIncome > 0 ? `${data.savingsRate.toFixed(1)}%` : '—'} sub={data.savingsRate >= 20 ? 'Healthy (>20%)' : data.savingsRate > 0 ? 'Aim for 20%+' : 'No income yet'} icon={Percent} color="amber" />
          </div>

          {(bestMonth || worstMonth) && (
            <div className="flex flex-wrap gap-3 mb-6">
              {bestMonth && bestMonth.net > 0 && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-card border-2 border-ink shadow-brutal-sm bg-sage text-sm">
                  <span className="text-xl">🏆</span>
                  <div>
                    <p className="text-[11px] font-bold text-white/70 tracking-wide">BEST MONTH</p>
                    <p className="font-bold text-white">
                      {MONTHS_FULL[parseInt(bestMonth.month.split('-')[1]) - 1]}
                      <span className="text-[11px] font-bold text-white/80 ml-2">+{fmtRs(bestMonth.net)}</span>
                    </p>
                  </div>
                </div>
              )}
              {worstMonth && worstMonth.net < 0 && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-card border-2 border-ink shadow-brutal-sm bg-terra text-sm">
                  <span className="text-xl">📉</span>
                  <div>
                    <p className="text-[11px] font-bold text-white/70 tracking-wide">TOUGHEST MONTH</p>
                    <p className="font-bold text-white">
                      {MONTHS_FULL[parseInt(worstMonth.month.split('-')[1]) - 1]}
                      <span className="text-[11px] font-bold text-white/80 ml-2">{fmtRs(worstMonth.net)}</span>
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="bg-white rounded-hero border-2 border-ink shadow-brutal p-5 mb-5">
            <h3 className="text-sm font-bold text-ink mb-0.5">Income vs Expenses</h3>
            <p className="text-[11px] font-bold text-warm-600 tracking-wide mb-4">MONTHLY COMPARISON — {year}</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={barData} barGap={4} margin={{ top: 5, right: 10, bottom: 0, left: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#0A0A0A" strokeOpacity={0.1} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#0A0A0A', fontWeight: 700 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#6F6252' }} tickFormatter={v => v === 0 ? '0' : `${(v / 1000).toFixed(0)}k`} tickLine={false} axisLine={false} width={36} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(10,10,10,0.06)' }} />
                <Bar dataKey="income"  name="Income"   fill="#2FD675" radius={[4,4,0,0]} maxBarSize={24} stroke="#0A0A0A" strokeWidth={2} />
                <Bar dataKey="expense" name="Expenses" fill="#FF4D4D" radius={[4,4,0,0]} maxBarSize={24} stroke="#0A0A0A" strokeWidth={2} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white rounded-hero border-2 border-ink shadow-brutal p-5 mb-6">
            <h3 className="text-sm font-bold text-ink mb-0.5">Cash Flow</h3>
            <p className="text-[11px] font-bold text-warm-600 tracking-wide mb-4">NET MONTHLY — {year}</p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={barData} margin={{ top: 5, right: 10, bottom: 0, left: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#0A0A0A" strokeOpacity={0.1} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#0A0A0A', fontWeight: 700 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#6F6252' }} tickFormatter={v => v === 0 ? '0' : `${(v / 1000).toFixed(0)}k`} tickLine={false} axisLine={false} width={36} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(10,10,10,0.06)' }} />
                <ReferenceLine y={0} stroke="#0A0A0A" strokeWidth={2} />
                <Bar dataKey="net" name="Net" radius={[4,4,0,0]} maxBarSize={24} stroke="#0A0A0A" strokeWidth={2}>
                  {barData.map((entry, index) => (
                    <Cell key={index} fill={entry.net >= 0 ? '#2FD675' : '#FF4D4D'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mb-6">
            <h2 className="text-[11px] font-bold text-warm-600 tracking-wide mb-3">MONTHLY BREAKDOWN</h2>
            <MonthlyTable months={data.months} />
          </div>

          {data.incomeByCategory.length > 0 && (
            <div className="mb-6">
              <h2 className="text-[11px] font-bold text-warm-600 tracking-wide mb-3">INCOME BY SOURCE</h2>
              <CategoryTable rows={data.incomeByCategory} catMap={catMap} title={`Where your money came from in ${year}`} color="text-sage-dark" />
            </div>
          )}

          {data.expenseByCategory.length > 0 && (
            <div className="mb-6">
              <h2 className="text-[11px] font-bold text-warm-600 tracking-wide mb-3">EXPENSES BY CATEGORY</h2>
              <CategoryTable rows={data.expenseByCategory} catMap={catMap} title={`Where your money went in ${year}`} color="text-terra" />
            </div>
          )}

          {data.expenseByCategory.length > 0 && (
            <div className="bg-white rounded-hero border-2 border-ink shadow-brutal p-5 mb-6">
              <h3 className="text-sm font-bold text-ink mb-0.5">Top Spending Categories</h3>
              <p className="text-[11px] font-bold text-warm-600 tracking-wide mb-4">BIGGEST EXPENSE CATEGORIES — {year}</p>
              <div className="space-y-3">
                {data.expenseByCategory.slice(0, 8).map((row, i) => {
                  const cat = catMap[row.category] || {}
                  const pct = data.totalExpense > 0 ? (row.total / data.totalExpense) * 100 : 0
                  return (
                    <div key={row.category}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{cat.icon || '📦'}</span>
                          <span className="text-xs font-bold text-ink">{row.category}</span>
                          <span className="text-[10px] font-bold text-warm-400">#{i + 1}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-xs font-bold text-terra">{fmtRs(row.total)}</span>
                          <span className="text-[10px] font-bold text-warm-400 ml-2">{pct.toFixed(1)}%</span>
                        </div>
                      </div>
                      <div className="h-2 bg-white border-2 border-ink rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all border-r-2 border-ink"
                          style={{ width: `${pct}%`, backgroundColor: cat.color || '#FF4D4D' }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {data.totalIncome === 0 && data.totalExpense === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-warm-500 text-sm gap-3">
            <span className="text-5xl">📅</span>
            <p className="font-bold text-ink">No transactions in {year}</p>
            <p className="text-[11px] font-bold text-warm-400">Start logging expenses via Telegram to see your year here.</p>
          </div>
          )}
        </>
      )}
    </div>
  )
}
