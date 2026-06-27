import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSavingsGoals, createSavingsGoal, updateSavingsGoal, deleteSavingsGoal } from '../api'
import { Plus, X, Trash2, Pencil, ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

function fmtRs(n) {
  return `Rs. ${Number(n).toLocaleString('en-IN')}`
}

function GoalFormModal({ initial, onSave, onClose }) {
  const [name, setName]         = useState(initial?.name || '')
  const [target, setTarget]     = useState(initial?.target?.toString() || '')
  const [saved, setSaved]       = useState(initial?.saved?.toString() || '0')
  const [deadline, setDeadline] = useState(initial?.deadline || '')
  const [icon, setIcon]         = useState(initial?.icon || '🎯')
  const [color, setColor]       = useState(initial?.color || '#525252')

  const ICONS = ['🎯','🏠','✈️','🎓','💻','🚗','💍','🎵','📱','💎','🏖️','💊','🎮','👶','📚','🌴']
  const COLORS = ['#0A0A0A','#262626','#404040','#525252','#737373','#8A8A8A','#A3A3A3','#BDBDBD']

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!name.trim() || !target) return
    onSave({
      name: name.trim(),
      target: parseFloat(target),
      saved: parseFloat(saved) || 0,
      deadline: deadline || null,
      icon, color,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/30">
      <div className="bg-white border-t sm:border border-border rounded-t-[20px] sm:rounded-hero w-full sm:max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-white z-10">
          <h2 className="font-medium text-neutral-800">{initial ? 'Edit Goal' : 'New Savings Goal'}</h2>
          <button onClick={onClose} className="text-warm-400 hover:text-terra p-1 rounded-item hover:bg-warm-100"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-[11px] font-medium text-warm-500 tracking-wide mb-2">GOAL NAME</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. New Laptop" className="w-full px-4 py-3 bg-cream border border-border rounded-item text-sm text-neutral-800 placeholder-warm-400 focus:outline-none focus:border-terra/40" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-warm-500 tracking-wide mb-2">TARGET (RS.)</label>
              <input type="number" value={target} onChange={e => setTarget(e.target.value)} placeholder="50000" min="1" className="w-full px-4 py-3 bg-cream border border-border rounded-item text-sm text-neutral-800 placeholder-warm-400 focus:outline-none focus:border-terra/40" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-warm-500 tracking-wide mb-2">SAVED SO FAR</label>
              <input type="number" value={saved} onChange={e => setSaved(e.target.value)} placeholder="0" min="0" className="w-full px-4 py-3 bg-cream border border-border rounded-item text-sm text-neutral-800 placeholder-warm-400 focus:outline-none focus:border-terra/40" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-warm-500 tracking-wide mb-2">DEADLINE (OPTIONAL)</label>
            <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className="w-full px-4 py-3 bg-cream border border-border rounded-item text-sm text-neutral-800 focus:outline-none focus:border-terra/40" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-warm-500 tracking-wide mb-2">ICON</label>
            <div className="flex flex-wrap gap-1.5">
              {ICONS.map(em => (
                <button key={em} type="button" onClick={() => setIcon(em)} className={`w-9 h-9 text-lg rounded-item flex items-center justify-center transition-all ${icon === em ? 'bg-terra/15 ring-1 ring-terra/40' : 'hover:bg-warm-200/60'}`}>{em}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-warm-500 tracking-wide mb-2">COLOR</label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map(c => (
                <button key={c} type="button" onClick={() => setColor(c)} className={`w-7 h-7 rounded-full transition-all ${color === c ? 'ring-2 ring-neutral-800/40 ring-offset-1 ring-offset-white scale-110' : 'hover:scale-105'}`} style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-item text-sm text-warm-500 border border-border hover:bg-warm-100 transition-colors">Cancel</button>
            <button type="submit" className="flex-1 py-2.5 rounded-item text-sm font-medium bg-terra hover:bg-terra-dark text-white transition-colors">{initial ? 'Save' : 'Create Goal'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function SavingsGoals() {
  const [showAdd, setShowAdd]   = useState(false)
  const [editing, setEditing]   = useState(null)
  const [deleting, setDeleting] = useState(null)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const goalsQ = useQuery({ queryKey: ['savings-goals'], queryFn: getSavingsGoals })
  const goals = goalsQ.data || []

  const createMut = useMutation({ mutationFn: createSavingsGoal, onSuccess: () => { qc.invalidateQueries({ queryKey: ['savings-goals'] }); setShowAdd(false) } })
  const updateMut = useMutation({ mutationFn: ({ id, data }) => updateSavingsGoal(id, data), onSuccess: () => { qc.invalidateQueries({ queryKey: ['savings-goals'] }); setEditing(null) } })
  const deleteMut = useMutation({ mutationFn: deleteSavingsGoal, onSuccess: () => { qc.invalidateQueries({ queryKey: ['savings-goals'] }); setDeleting(null) } })

  return (
    <div className="p-5 md:p-8 max-w-3xl mx-auto md:mx-0">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="p-2 rounded-item text-warm-600 hover:text-terra hover:bg-warm-200/60 transition-colors md:hidden"><ArrowLeft size={20} /></button>
        <div className="flex-1">
          <h1 className="text-xl font-medium text-neutral-800">Savings Goals</h1>
          <p className="text-[11px] text-warm-500 tracking-wide mt-1">{goals.length} GOALS</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-3.5 py-2 rounded-item text-sm font-medium bg-terra hover:bg-terra-dark text-white transition-colors"><Plus size={14} /> New Goal</button>
      </div>

      {goals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <span className="text-5xl">🎯</span>
          <p className="text-sm text-warm-600">No savings goals yet</p>
          <p className="text-[11px] text-warm-400">Set a target and track your progress</p>
          <button onClick={() => setShowAdd(true)} className="mt-2 px-4 py-2.5 rounded-item text-sm font-medium bg-terra/10 text-terra border border-terra/20 hover:bg-terra/20 transition-colors">Create your first goal</button>
        </div>
      ) : (
        <div className="space-y-4">
          {goals.map(goal => {
            const pct = goal.target > 0 ? Math.min(Math.round((goal.saved / goal.target) * 100), 100) : 0
            const remaining = Math.max(0, goal.target - goal.saved)
            const daysLeft = goal.deadline ? Math.max(0, Math.ceil((new Date(goal.deadline) - Date.now()) / 86400000)) : null

            return (
              <div key={goal.id} className="group bg-white rounded-hero border border-border p-5 hover:border-terra/20 transition-all">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-card flex items-center justify-center text-2xl" style={{ backgroundColor: goal.color + '15' }}>
                      {goal.icon}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-neutral-800">{goal.name}</p>
                      <p className="text-[11px] text-warm-500 mt-0.5">
                        {fmtRs(goal.saved)} of {fmtRs(goal.target)}
                        {daysLeft !== null && <span className="ml-2 text-amber">{daysLeft}d left</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setEditing(goal)} className="p-1.5 rounded-item text-warm-400 hover:text-terra hover:bg-warm-200/60 transition-colors"><Pencil size={13} /></button>
                    <button onClick={() => setDeleting(goal)} className="p-1.5 rounded-item text-warm-400 hover:text-terra hover:bg-terra/10 transition-colors"><Trash2 size={13} /></button>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-3 bg-warm-200/60 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: goal.color }} />
                  </div>
                  <span className="text-xs font-medium tabular-nums" style={{ color: goal.color }}>{pct}%</span>
                </div>
                {remaining > 0 && (
                  <p className="text-[11px] text-warm-400 mt-2">{fmtRs(remaining)} to go</p>
                )}
                {pct >= 100 && (
                  <p className="text-[11px] text-sage font-medium mt-2">Goal reached! 🎉</p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showAdd && <GoalFormModal onSave={data => createMut.mutate(data)} onClose={() => setShowAdd(false)} />}
      {editing && <GoalFormModal initial={editing} onSave={data => updateMut.mutate({ id: editing.id, data })} onClose={() => setEditing(null)} />}
      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
          <div className="bg-white border border-border rounded-hero w-full max-w-sm p-5 space-y-4">
            <h2 className="font-medium text-neutral-800">Delete Goal</h2>
            <p className="text-sm text-warm-600">Remove <strong className="text-neutral-800">{deleting.icon} {deleting.name}</strong>?</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleting(null)} className="flex-1 py-2.5 rounded-item text-sm text-warm-500 border border-border hover:bg-warm-100 transition-colors">Cancel</button>
              <button onClick={() => deleteMut.mutate(deleting.id)} className="flex-1 py-2.5 rounded-item text-sm font-medium bg-terra hover:bg-terra-dark text-white transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
