import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

function formatMonthLabel(m) {
  const [y, mo] = m.split('-')
  return new Date(parseInt(y), parseInt(mo) - 1).toLocaleString('default', { month: 'short' })
}

function transformTrends(raw) {
  const map = {}
  for (const row of raw) {
    if (!map[row.month]) map[row.month] = { month: row.month, expense: 0, income: 0 }
    map[row.month][row.type] += row.total
  }
  return Object.values(map)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(r => ({ ...r, label: formatMonthLabel(r.month) }))
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-card border border-border rounded-lg p-3 text-xs shadow-xl">
      <p className="text-slate-400 mb-1.5">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name === 'expense' ? '💸 Spent' : '💰 Earned'}: Rs. {p.value.toLocaleString('en-IN')}
        </p>
      ))}
    </div>
  )
}

export default function IncomeVsExpense({ trends = [] }) {
  const data = transformTrends(trends)

  if (!data.length) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 flex flex-col items-center justify-center h-[260px] gap-2">
        <span className="text-3xl">📊</span>
        <p className="text-slate-500 text-sm">No data yet — log some transactions to see trends</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold text-slate-200 mb-1">Monthly Overview</h3>
      <p className="text-xs text-slate-500 mb-4">Income vs expenses — last 6 months</p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} barGap={4} margin={{ top: 5, right: 5, bottom: 0, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e2130" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickFormatter={v => `${(v / 1000).toFixed(0)}k`}
            tickLine={false}
            axisLine={false}
            width={32}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
          <Legend
            iconSize={8}
            wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
            formatter={v => v === 'expense' ? 'Spent' : 'Earned'}
          />
          <Bar dataKey="income"  fill="#22c55e" radius={[3, 3, 0, 0]} maxBarSize={28} />
          <Bar dataKey="expense" fill="#ef4444" radius={[3, 3, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
