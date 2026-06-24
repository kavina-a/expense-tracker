import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const d = payload[0]
  return (
    <div className="bg-card border border-border rounded-lg p-3 text-xs shadow-xl">
      <p style={{ color: d.payload.color }} className="font-medium">{d.name}</p>
      <p className="text-slate-300 mt-0.5">Rs. {d.value.toLocaleString('en-IN')}</p>
      <p className="text-slate-500">{d.payload.pct}% of total</p>
    </div>
  )
}

// Recharts passes `percent` as a 0–1 float; `pct` lives on our data entry
const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
  const pct = Math.round(percent * 100)
  if (pct < 5) return null
  const RADIAN = Math.PI / 180
  const r = innerRadius + (outerRadius - innerRadius) * 0.5
  const x = cx + r * Math.cos(-midAngle * RADIAN)
  const y = cy + r * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={500}>
      {pct}%
    </text>
  )
}

export default function CategoryDonut({ expenses = [] }) {
  const total = expenses.reduce((s, e) => s + e.total, 0)
  const data = expenses.map(e => ({
    name:  e.category,
    value: e.total,
    color: e.color || '#6b7280',
    pct:   total ? Math.round((e.total / total) * 100) : 0,
  }))

  if (!data.length) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 flex items-center justify-center h-[280px]">
        <p className="text-slate-500 text-sm">No expenses this month</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold text-slate-200 mb-1">Category Breakdown</h3>
      <p className="text-xs text-slate-500 mb-4">Where your money is going</p>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="45%"
            innerRadius={55}
            outerRadius={80}
            paddingAngle={2}
            dataKey="value"
            labelLine={false}
            label={renderCustomLabel}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} stroke="transparent" />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend
            iconType="circle"
            iconSize={7}
            wrapperStyle={{ fontSize: '11px', paddingTop: '4px' }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
