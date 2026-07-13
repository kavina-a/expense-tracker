import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPortfolio, getCategories } from '../api'
import { TrendingDown, TrendingUp, ArrowUpRight, ArrowDownRight, Info } from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Cell,
} from 'recharts'

function fmtRs(n) {
  return `LKR ${Math.abs(Number(n)).toLocaleString('en-US')}`
}

function fmtMonthLabel(m) {
  const [y, mo] = m.split('-')
  return new Date(parseInt(y), parseInt(mo) - 1).toLocaleString('default', { month: 'short', year: '2-digit' })
}

function fmtDateLabel(dateStr) {
  const today     = new Date().toLocaleDateString('sv-SE')
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE')
  if (dateStr === today)     return 'Today'
  if (dateStr === yesterday) return 'Yesterday'
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('default', { weekday: 'short', month: 'short', day: 'numeric' })
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border-2 border-ink rounded-item p-3 text-xs shadow-brutal-xs">
      <p className="font-bold text-warm-600 mb-1.5">{label}</p>
      {payload.map(p => (
        <p key={p.name} className="font-bold" style={{ color: p.color || p.fill }}>
          {p.name}: {fmtRs(Math.abs(p.value))}
        </p>
      ))}
    </div>
  )
}

function KpiCard({ label, value, sub, positive, neutral, icon: Icon }) {
  const bg     = neutral ? 'bg-white' : positive ? 'bg-sage' : 'bg-terra'
  const text   = neutral ? 'text-ink'  : 'text-white'
  const subClr = neutral ? 'text-warm-500' : 'text-white/70'
  return (
    <div className={`flex-1 min-w-[140px] rounded-card border-2 border-ink shadow-brutal-sm p-4 ${bg}`}>
      <div className={`flex items-center gap-1.5 mb-2 ${neutral ? 'text-warm-500' : 'text-white/70'}`}>
        {Icon && <Icon size={13} />}
        <span className="text-[11px] font-bold tracking-wide">{label}</span>
      </div>
      <p className={`text-xl font-bold ${text}`}>{value}</p>
      {sub && <p className={`text-[11px] font-bold mt-1 ${subClr}`}>{sub}</p>}
    </div>
  )
}

export default function Investments() {
  const [tab, setTab] = useState('overview') // 'overview' | 'log'

  const portfolioQ   = useQuery({ queryKey: ['portfolio'], queryFn: getPortfolio })
  const categoriesQ  = useQuery({ queryKey: ['categories'], queryFn: getCategories })

  const catMap = useMemo(() =>
    Object.fromEntries((categoriesQ.data || []).map(c => [c.name, c]))
  , [categoriesQ.data])

  const data = portfolioQ.data

  const isPositive = data ? data.netGain >= 0 : null

  return (
    <div className="p-5 md:p-8 max-w-3xl mx-auto md:mx-0">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink uppercase tracking-tight">Portfolio</h1>
        <p className="text-[11px] font-bold text-warm-600 tracking-wide mt-1">ALL-TIME INVESTMENT TRACKER</p>
      </div>

      {portfolioQ.isLoading ? (
        <div className="flex items-center justify-center py-32 text-warm-500 text-sm">Loading…</div>
      ) : !data ? null : (
        <>
          {/* KPI summary */}
          <div className="flex flex-wrap gap-3 mb-6">
            <KpiCard
              label="TOTAL IN"
              value={fmtRs(data.totalInvested)}
              sub={`${data.investRows.length} position${data.investRows.length !== 1 ? 's' : ''}`}
              neutral
              icon={TrendingDown}
            />
            <KpiCard
              label="TOTAL BACK"
              value={fmtRs(data.totalReturns)}
              sub={`${data.returnRows.length} return source${data.returnRows.length !== 1 ? 's' : ''}`}
              neutral
              icon={TrendingUp}
            />
            <KpiCard
              label="NET GAIN"
              value={`${isPositive ? '+' : '−'}${fmtRs(data.netGain)}`}
              sub={data.totalInvested > 0 ? `${Math.abs(data.roiPct).toFixed(1)}% ROI` : 'No data yet'}
              positive={isPositive}
              icon={isPositive ? ArrowUpRight : ArrowDownRight}
            />
          </div>

          {/* Info callout */}
          <div className="flex items-start gap-2.5 px-4 py-3 bg-amber border-2 border-ink rounded-item shadow-brutal-xs mb-6">
            <Info size={14} className="text-ink shrink-0 mt-0.5" />
            <p className="text-[11px] font-bold text-ink/80 leading-relaxed">
              <span className="text-ink">How returns work:</span> Log investment outflows as <span className="text-invest">Investment</span> type. Log dividends, interest, or stock sales as <span className="text-sage-dark">Income</span> using a category marked as an Investment Return (e.g. Stock Exchange - DIV). The net gain shows your real profit.
            </p>
          </div>

          {/* Tab bar */}
          <div className="flex bg-white border-2 border-ink rounded-item overflow-hidden mb-5">
            {[{ id: 'overview', label: 'Overview' }, { id: 'log', label: 'Transaction Log' }].map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 py-2.5 text-xs font-bold transition-colors ${
                  tab === t.id ? 'bg-terra text-white' : 'text-warm-500 hover:text-terra hover:bg-warm-100'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <>
              {/* Monthly chart */}
              {data.monthlyRows.length > 0 && (
                <div className="bg-white rounded-hero border-2 border-ink shadow-brutal p-5 mb-5">
                  <h3 className="text-sm font-bold text-ink mb-0.5">Monthly Activity</h3>
                  <p className="text-[11px] font-bold text-warm-600 tracking-wide mb-4">INVESTED VS RETURNED — LAST 24 MONTHS</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={data.monthlyRows.map(r => ({ ...r, label: fmtMonthLabel(r.month) }))} barGap={3} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#0A0A0A" strokeOpacity={0.08} vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#0A0A0A', fontWeight: 700 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#6F6252' }} tickFormatter={v => v === 0 ? '0' : `${(v / 1000).toFixed(0)}k`} tickLine={false} axisLine={false} width={34} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(10,10,10,0.05)' }} />
                      <ReferenceLine y={0} stroke="#0A0A0A" strokeWidth={2} />
                      <Bar dataKey="invested" name="Invested" fill="#6C5CE7" radius={[4,4,0,0]} maxBarSize={22} stroke="#0A0A0A" strokeWidth={2} />
                      <Bar dataKey="returned" name="Returned" fill="#2FD675" radius={[4,4,0,0]} maxBarSize={22} stroke="#0A0A0A" strokeWidth={2} />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="flex items-center gap-4 mt-3">
                    <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-invest border border-ink inline-block" /><span className="text-[11px] font-bold text-warm-600">Invested</span></div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-sage border border-ink inline-block" /><span className="text-[11px] font-bold text-warm-600">Returned</span></div>
                  </div>
                </div>
              )}

              {/* Two-column breakdown */}
              <div className="grid md:grid-cols-2 gap-4 mb-5">
                {/* Money In */}
                <div className="bg-white rounded-hero border-2 border-ink shadow-brutal p-5">
                  <h3 className="text-sm font-bold text-ink mb-0.5">Money In</h3>
                  <p className="text-[11px] font-bold text-warm-600 tracking-wide mb-4">INVESTED BY CATEGORY</p>
                  {data.investRows.length === 0 ? (
                    <p className="text-xs font-bold text-warm-400 py-4 text-center">No investments logged yet</p>
                  ) : (
                    <div className="space-y-3">
                      {data.investRows.map(row => {
                        const cat = catMap[row.category] || {}
                        const pct = data.totalInvested > 0 ? (row.total / data.totalInvested) * 100 : 0
                        return (
                          <div key={row.category}>
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <span className="w-7 h-7 rounded-item flex items-center justify-center text-sm border-2 border-ink shrink-0" style={{ backgroundColor: cat.color || '#6C5CE7' }}>{cat.icon || '📊'}</span>
                                <span className="text-xs font-bold text-ink">{row.category}</span>
                                <span className="text-[10px] font-bold text-warm-400">{row.cnt}×</span>
                              </div>
                              <span className="text-xs font-bold text-invest">{fmtRs(row.total)}</span>
                            </div>
                            <div className="h-2 bg-white border-2 border-ink rounded-full overflow-hidden">
                              <div className="h-full border-r-2 border-ink" style={{ width: `${pct}%`, backgroundColor: '#6C5CE7' }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Returns */}
                <div className="bg-white rounded-hero border-2 border-ink shadow-brutal p-5">
                  <h3 className="text-sm font-bold text-ink mb-0.5">Returns</h3>
                  <p className="text-[11px] font-bold text-warm-600 tracking-wide mb-4">INCOME FROM INVESTMENTS</p>
                  {data.returnRows.length === 0 ? (
                    <div className="py-4 text-center">
                      <p className="text-xs font-bold text-warm-400 mb-1">No returns logged yet</p>
                      <p className="text-[11px] text-warm-300">Log dividends or sales as income using a return category</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {data.returnRows.map(row => {
                        const cat = catMap[row.category] || {}
                        const pct = data.totalReturns > 0 ? (row.total / data.totalReturns) * 100 : 0
                        return (
                          <div key={row.category}>
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <span className="w-7 h-7 rounded-item flex items-center justify-center text-sm border-2 border-ink shrink-0" style={{ backgroundColor: cat.color || '#2FD675' }}>{cat.icon || '📈'}</span>
                                <span className="text-xs font-bold text-ink">{row.category}</span>
                                <span className="text-[10px] font-bold text-warm-400">{row.cnt}×</span>
                              </div>
                              <span className="text-xs font-bold text-sage-dark">{fmtRs(row.total)}</span>
                            </div>
                            <div className="h-2 bg-white border-2 border-ink rounded-full overflow-hidden">
                              <div className="h-full border-r-2 border-ink" style={{ width: `${pct}%`, backgroundColor: '#2FD675' }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Net position card */}
              {data.totalInvested > 0 && (
                <div className={`rounded-hero border-2 border-ink shadow-brutal p-5 mb-5 ${isPositive ? 'bg-sage' : 'bg-terra'}`}>
                  <p className="text-[11px] font-bold tracking-wide text-white/70 mb-1">NET POSITION</p>
                  <p className="text-3xl font-bold text-white">
                    {isPositive ? '+' : '−'}{fmtRs(data.netGain)}
                  </p>
                  <p className="text-sm font-bold text-white/80 mt-1">
                    {data.roiPct >= 0 ? '↑' : '↓'} {Math.abs(data.roiPct).toFixed(2)}% return on {fmtRs(data.totalInvested)} invested
                  </p>
                </div>
              )}
            </>
          )}

          {tab === 'log' && (
            <div className="bg-white rounded-hero border-2 border-ink shadow-brutal overflow-hidden">
              {data.recentTx.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <span className="text-4xl">📊</span>
                  <p className="text-sm font-bold text-warm-500">No investment transactions yet</p>
                  <p className="text-[11px] font-bold text-warm-400">Log an investment or dividend to get started</p>
                </div>
              ) : (
                data.recentTx.map(tx => {
                  const cat = catMap[tx.category] || {}
                  const isReturn = tx.is_return === 1
                  return (
                    <div key={tx.id} className="flex items-center gap-3 px-5 py-3.5 border-b border-ink/10 last:border-0 hover:bg-warm-50/50 transition-colors">
                      <div
                        className="w-10 h-10 rounded-item flex items-center justify-center text-lg shrink-0 border-2 border-ink"
                        style={{ backgroundColor: cat.color || '#525252' }}
                      >
                        {cat.icon || '📦'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold text-ink truncate">{tx.category}</p>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full border border-ink font-bold shrink-0 ${
                            isReturn ? 'bg-sage text-white' : 'bg-invest text-white'
                          }`}>
                            {isReturn ? 'RETURN' : 'INVEST'}
                          </span>
                        </div>
                        {tx.description && <p className="text-[11px] text-warm-500 truncate mt-0.5">{tx.description}</p>}
                        <p className="text-[10px] text-warm-400 mt-0.5">{fmtDateLabel(tx.date)} · {tx.date}</p>
                      </div>
                      <span className={`text-sm font-bold tabular-nums shrink-0 ${isReturn ? 'text-sage-dark' : 'text-invest'}`}>
                        {isReturn ? '+' : '−'}{fmtRs(tx.amount)}
                      </span>
                    </div>
                  )
                })
              )}
            </div>
          )}

          {/* Empty state when no investments at all */}
          {data.totalInvested === 0 && data.totalReturns === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <span className="text-5xl">📊</span>
              <p className="text-sm font-bold text-ink">No investments tracked yet</p>
              <p className="text-[11px] font-bold text-warm-400 max-w-xs">
                Log your first investment via Telegram (e.g. "invested 5000 in stocks") and it will appear here.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
