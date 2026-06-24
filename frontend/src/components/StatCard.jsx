export default function StatCard({ label, value, sub, accent, icon }) {
  const accentMap = {
    red:    'text-rose-400   border-rose-500/20   bg-rose-500/5',
    green:  'text-emerald-400 border-emerald-500/20 bg-emerald-500/5',
    indigo: 'text-indigo-400  border-indigo-500/20  bg-indigo-500/5',
    slate:  'text-slate-300   border-slate-600/30   bg-slate-500/5',
  }
  const cls = accentMap[accent] || accentMap.slate

  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-2 ${cls}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider opacity-60">{label}</span>
        {icon && <span className="text-lg">{icon}</span>}
      </div>
      <p className="text-2xl font-semibold tracking-tight">{value}</p>
      {sub && <p className="text-xs opacity-50">{sub}</p>}
    </div>
  )
}
