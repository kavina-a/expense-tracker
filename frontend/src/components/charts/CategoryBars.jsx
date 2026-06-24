import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts'

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  return (
    <div className="bg-card border border-border rounded-lg p-3 text-xs shadow-xl">
      <p className="text-slate-200 font-medium">{entry.payload.full}</p>
      <p className="text-slate-300 mt-0.5">Rs. {entry.value.toLocaleString('en-IN')}</p>
    </div>
  )
}

export default function CategoryBars({ expenses = [], categories = [] }) {
  const colorMap = Object.fromEntries(categories.map(c => [c.name, c.color]))

  const data = [...expenses]
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)
    .map(e => ({
      name:  e.category.length > 12 ? e.category.slice(0, 11) + '…' : e.category,
      full:  e.category,
      value: e.total,
      color: colorMap[e.category] || '#6b7280',
    }))

  if (!data.length) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 flex items-center justify-center h-[260px]">
        <p className="text-slate-500 text-sm">No data yet</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold text-slate-200 mb-1">Top Categories</h3>
      <p className="text-xs text-slate-500 mb-4">Where you should cut down</p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 16, bottom: 0, left: 4 }}
          barSize={12}
        >
          <XAxis
            type="number"
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickFormatter={v => `${(v / 1000).toFixed(0)}k`}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            tickLine={false}
            axisLine={false}
            width={80}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
