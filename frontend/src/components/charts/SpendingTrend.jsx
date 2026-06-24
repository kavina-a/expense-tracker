import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

function transformDailyData(raw) {
  const map = {}
  for (const row of raw) {
    if (!map[row.date]) map[row.date] = { date: row.date, expense: 0, income: 0 }
    map[row.date][row.type] += row.total
  }
  return Object.values(map).sort((a, b) => a.date.localeCompare(b.date))
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

export default function SpendingTrend({ data = [] }) {
  const chartData = transformDailyData(data)

  if (!chartData.length) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 flex flex-col items-center justify-center h-[260px] gap-2">
        <span className="text-3xl">📭</span>
        <p className="text-slate-500 text-sm">No activity yet this month</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold text-slate-200 mb-1">Daily Activity</h3>
      <p className="text-xs text-slate-500 mb-4">Expenses & income per day this month</p>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: 5 }}>
          <defs>
            <linearGradient id="gradExpense" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gradIncome" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e2130" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickFormatter={d => d.slice(8)}
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
          <Tooltip content={<CustomTooltip />} />
          <Legend
            iconSize={8}
            wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
            formatter={v => v === 'expense' ? 'Spent' : 'Earned'}
          />
          <Area
            type="monotone"
            dataKey="expense"
            stroke="#ef4444"
            strokeWidth={2}
            fill="url(#gradExpense)"
            dot={false}
            activeDot={{ r: 4, fill: '#ef4444' }}
          />
          <Area
            type="monotone"
            dataKey="income"
            stroke="#22c55e"
            strokeWidth={2}
            fill="url(#gradIncome)"
            dot={false}
            activeDot={{ r: 4, fill: '#22c55e' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
