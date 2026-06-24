import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getYearly, getCategories } from '../api'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts'
import { ChevronLeft, ChevronRight, Download, TrendingUp, TrendingDown, Wallet, Percent } from 'lucide-react'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTHS_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December']

function fmtRs(n, compact = false) {
  if (n === 0) return '—'
  if (compact) {
    if (Math.abs(n) >= 100000) return `${(n / 100000).toFixed(1)}L`
    if (Math.abs(n) >= 1000)   return `${(n / 1000).toFixed(0)}k`
  }
  return `Rs. ${Math.abs(n).toLocaleString('en-IN')}`
}

function fmtSign(n) {
  if (n === 0) return '—'
  return (n > 0 ? '+' : '−') + fmtRs(n, true)
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

// ─── Custom tooltip ───────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-card border border-border rounded-lg p-3 text-xs shadow-xl">
      <p className="text-slate-300 font-medium mb-2">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color }} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
          {p.name}: Rs. {Math.abs(p.value).toLocaleString('en-IN')}
        </p>
      ))}
    </div>
  )
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, icon: Icon, color }) {
  const palette = {
    green:  'border-emerald-500/20 bg-emerald-500/5',
    red:    'border-rose-500/20 bg-rose-500/5',
    indigo: 'border-indigo-500/20 bg-indigo-500/5',
    amber:  'border-amber-500/20 bg-amber-500/5',
  }
  return (
    <div className={`flex-1 min-w-[140px] rounded-xl border p-4 ${palette[color]}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} className={`text-${color === 'green' ? 'emerald' : color === 'red' ? 'rose' : color}-400`} />
        <span className="text-xs text-slate-500 uppercase tracking-wider font-medium">{label}</span>
      </div>
      <p className={`text-xl font-bold ${color === 'green' ? 'text-emerald-400' : color === 'red' ? 'text-rose-400' : color === 'amber' ? 'text-amber-400' : 'text-indigo-400'}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-slate-600 mt-1">{sub}</p>}
    </div>
  )
}

// ─── Monthly breakdown table ──────────────────────────────────────────────────

function MonthlyTable({ months }) {
  const today = new Date()
  const currentMonthIdx = today.getMonth()

  const totalIncome  = months.reduce((s, m) => s + m.income,  0)
  const totalExpense = months.reduce((s, m) => s + m.expense, 0)
  const totalNet     = totalIncome - totalExpense

  const rows = [
    { label: 'Income',   key: 'income',  color: 'text-emerald-400', total: totalIncome },
    { label: 'Expenses', key: 'expense', color: 'text-rose-400',    total: totalExpense },
    { label: 'Net',      key: 'net',     color: null,               total: totalNet },
  ]

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border">
            <th className="sticky left-0 bg-card z-10 px-4 py-3 text-left text-slate-500 font-semibold uppercase tracking-wider w-24">
              Month
            </th>
            {MONTHS_SHORT.map((m, i) => (
              <th
                key={m}
                className={`px-3 py-3 text-center font-medium whitespace-nowrap ${i === currentMonthIdx ? 'text-indigo-400' : 'text-slate-500'}`}
              >
                {m}
              </th>
            ))}
            <th className="px-4 py-3 text-right text-slate-400 font-semibold whitespace-nowrap">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {rows.map(row => (
            <tr key={row.key} className="hover:bg-white/[0.02] transition-colors">
              <td className="sticky left-0 bg-card z-10 px-4 py-3 font-semibold text-slate-400 uppercase tracking-wide">
                {row.label}
              </td>
              {months.map((m, i) => {
                const val = row.key === 'net' ? m.income - m.expense : m[row.key]
                const isNet = row.key === 'net'
                const netColor = val >= 0 ? 'text-emerald-400' : 'text-rose-400'
                const isFuture = i > currentMonthIdx
                return (
                  <td key={i} className={`px-3 py-3 text-right tabular-nums whitespace-nowrap ${isFuture ? 'text-slate-700' : isNet ? netColor : row.color}`}>
                    {val === 0 ? (isFuture ? '—' : '—') : fmtRs(val, true)}
                  </td>
                )
              })}
              <td className={`px-4 py-3 text-right font-bold tabular-nums whitespace-nowrap ${row.key === 'net' ? (totalNet >= 0 ? 'text-emerald-400' : 'text-rose-400') : row.color}`}>
                {fmtRs(row.total, true)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Category breakdown table ─────────────────────────────────────────────────

function CategoryTable({ rows, catMap, title, color }) {
  if (!rows.length) return null
  const today = new Date()
  const currentMonthIdx = today.getMonth()

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/60">
            <th className="sticky left-0 bg-card z-10 px-4 py-2.5 text-left text-slate-500 font-semibold uppercase tracking-wider w-36">
              Category
            </th>
            {MONTHS_SHORT.map((m, i) => (
              <th key={m} className={`px-3 py-2.5 text-center font-medium ${i === currentMonthIdx ? 'text-indigo-400' : 'text-slate-600'}`}>
                {m}
              </th>
            ))}
            <th className="px-4 py-2.5 text-right text-slate-500 font-semibold">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/30">
          {rows.map(row => {
            const cat = catMap[row.category] || {}
            return (
              <tr key={row.category} className="hover:bg-white/[0.02] transition-colors">
                <td className="sticky left-0 bg-card z-10 px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-5 h-5 rounded-md flex items-center justify-center text-xs shrink-0"
                      style={{ backgroundColor: (cat.color || '#6b7280') + '22' }}
                    >
                      {cat.icon || '📦'}
                    </span>
                    <span className="text-slate-300 truncate max-w-[90px]">{row.category}</span>
                  </div>
                </td>
                {row.months.map((v, i) => (
                  <td key={i} className={`px-3 py-2.5 text-right tabular-nums ${v === 0 ? 'text-slate-700' : color}`}>
                    {v === 0 ? '—' : fmtRs(v, true)}
                  </td>
                ))}
                <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${color}`}>
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

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Yearly() {
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)

  const yearlyQ    = useQuery({ queryKey: ['yearly', year],   queryFn: () => getYearly(year) })
  const categoriesQ = useQuery({ queryKey: ['categories'],    queryFn: getCategories })

  const data   = yearlyQ.data
  const catMap = useMemo(() =>
    Object.fromEntries((categoriesQ.data || []).map(c => [c.name, c]))
  , [categoriesQ.data])

  // Build bar chart data
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
    <div className="p-6 max-w-6xl">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Yearly Overview</h1>
          <p className="text-xs text-slate-500 mt-0.5">Full-year income, expenses & cash flow</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Year nav */}
          <div className="flex items-center gap-1 px-3 py-1.5 bg-card border border-border rounded-lg">
            <button onClick={() => setYear(y => y - 1)} className="text-slate-400 hover:text-slate-200 p-0.5">
              <ChevronLeft size={14} />
            </button>
            <span className="text-sm font-semibold text-slate-200 min-w-[40px] text-center">{year}</span>
            <button
              onClick={() => setYear(y => y + 1)}
              disabled={year >= thisYear}
              className="text-slate-400 hover:text-slate-200 disabled:opacity-30 p-0.5"
            >
              <ChevronRight size={14} />
            </button>
          </div>
          {data && (
            <button
              onClick={() => exportCSV(data)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 border border-border hover:bg-white/5 hover:text-white transition-colors"
            >
              <Download size={13} /> Export CSV
            </button>
          )}
        </div>
      </div>

      {yearlyQ.isLoading ? (
        <div className="flex items-center justify-center py-32 text-slate-500 text-sm">Loading…</div>
      ) : !data ? null : (
        <>
          {/* ── KPI cards ── */}
          <div className="flex flex-wrap gap-3 mb-6">
            <KpiCard
              label="Total Income"
              value={fmtRs(data.totalIncome)}
              sub={`${data.months.filter(m => m.income > 0).length} active months`}
              icon={TrendingUp}
              color="green"
            />
            <KpiCard
              label="Total Expenses"
              value={fmtRs(data.totalExpense)}
              sub={`Across ${data.expenseByCategory.length} categories`}
              icon={TrendingDown}
              color="red"
            />
            <KpiCard
              label="Net Savings"
              value={(data.net >= 0 ? '+' : '−') + fmtRs(data.net)}
              sub={data.net >= 0 ? 'Saved this year' : 'Overspent this year'}
              icon={Wallet}
              color={data.net >= 0 ? 'indigo' : 'red'}
            />
            <KpiCard
              label="Savings Rate"
              value={data.totalIncome > 0 ? `${data.savingsRate.toFixed(1)}%` : '—'}
              sub={data.savingsRate >= 20 ? '✓ Healthy (>20%)' : data.savingsRate > 0 ? 'Aim for 20%+' : 'No income yet'}
              icon={Percent}
              color="amber"
            />
          </div>

          {/* ── Best / worst month callouts ── */}
          {(bestMonth || worstMonth) && (
            <div className="flex flex-wrap gap-3 mb-6">
              {bestMonth && bestMonth.net > 0 && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-sm">
                  <span className="text-xl">🏆</span>
                  <div>
                    <p className="text-xs text-slate-500">Best month</p>
                    <p className="font-semibold text-emerald-400">
                      {MONTHS_FULL[parseInt(bestMonth.month.split('-')[1]) - 1]}
                      <span className="text-xs font-normal text-slate-400 ml-2">+{fmtRs(bestMonth.net)}</span>
                    </p>
                  </div>
                </div>
              )}
              {worstMonth && worstMonth.net < 0 && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-rose-500/20 bg-rose-500/5 text-sm">
                  <span className="text-xl">📉</span>
                  <div>
                    <p className="text-xs text-slate-500">Toughest month</p>
                    <p className="font-semibold text-rose-400">
                      {MONTHS_FULL[parseInt(worstMonth.month.split('-')[1]) - 1]}
                      <span className="text-xs font-normal text-slate-400 ml-2">{fmtRs(worstMonth.net)}</span>
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Income vs Expense bar chart ── */}
          <div className="rounded-xl border border-border bg-card p-5 mb-5">
            <h3 className="text-sm font-semibold text-slate-200 mb-0.5">Income vs Expenses</h3>
            <p className="text-xs text-slate-500 mb-4">Monthly comparison — {year}</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={barData} barGap={4} margin={{ top: 5, right: 10, bottom: 0, left: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2130" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  tickFormatter={v => v === 0 ? '0' : `${(v / 1000).toFixed(0)}k`}
                  tickLine={false} axisLine={false} width={36}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="income"  name="Income"   fill="#22c55e" radius={[3,3,0,0]} maxBarSize={26} />
                <Bar dataKey="expense" name="Expenses" fill="#ef4444" radius={[3,3,0,0]} maxBarSize={26} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* ── Cash flow chart ── */}
          <div className="rounded-xl border border-border bg-card p-5 mb-6">
            <h3 className="text-sm font-semibold text-slate-200 mb-0.5">Cash Flow</h3>
            <p className="text-xs text-slate-500 mb-4">Net income − expenses per month — {year}</p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={barData} margin={{ top: 5, right: 10, bottom: 0, left: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2130" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  tickFormatter={v => v === 0 ? '0' : `${(v / 1000).toFixed(0)}k`}
                  tickLine={false} axisLine={false} width={36}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <ReferenceLine y={0} stroke="#334155" strokeWidth={1} />
                <Bar dataKey="net" name="Net" radius={[3,3,0,0]} maxBarSize={26}>
                  {barData.map((entry, index) => (
                    <Cell key={index} fill={entry.net >= 0 ? '#22c55e' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* ── Monthly breakdown table ── */}
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">Monthly Breakdown</h2>
            <MonthlyTable months={data.months} />
          </div>

          {/* ── Income by source table ── */}
          {data.incomeByCategory.length > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">Income by Source</h2>
              <CategoryTable
                rows={data.incomeByCategory}
                catMap={catMap}
                title={`Where your money came from in ${year}`}
                color="text-emerald-400"
              />
            </div>
          )}

          {/* ── Expenses by category table ── */}
          {data.expenseByCategory.length > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">Expenses by Category</h2>
              <CategoryTable
                rows={data.expenseByCategory}
                catMap={catMap}
                title={`Where your money went in ${year}`}
                color="text-rose-400"
              />
            </div>
          )}

          {/* ── Top 5 expense categories visual ── */}
          {data.expenseByCategory.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-5 mb-6">
              <h3 className="text-sm font-semibold text-slate-200 mb-0.5">Top Spending Categories</h3>
              <p className="text-xs text-slate-500 mb-4">Your biggest expense categories in {year}</p>
              <div className="space-y-3">
                {data.expenseByCategory.slice(0, 8).map((row, i) => {
                  const cat = catMap[row.category] || {}
                  const pct = data.totalExpense > 0 ? (row.total / data.totalExpense) * 100 : 0
                  return (
                    <div key={row.category}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{cat.icon || '📦'}</span>
                          <span className="text-xs text-slate-300">{row.category}</span>
                          <span className="text-xs text-slate-600">#{i + 1}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-xs font-semibold text-rose-400">{fmtRs(row.total)}</span>
                          <span className="text-xs text-slate-600 ml-2">{pct.toFixed(1)}%</span>
                        </div>
                      </div>
                      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: cat.color || '#ef4444',
                          }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Empty state */}
          {data.totalIncome === 0 && data.totalExpense === 0 && (
            <div className="flex flex-col items-center justify-center py-24 text-slate-500 text-sm gap-3">
              <span className="text-5xl">📅</span>
              <p>No transactions in {year}</p>
              <p className="text-xs text-slate-600">Start logging expenses via Telegram to see your year here.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
