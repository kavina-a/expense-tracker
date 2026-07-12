import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSavingsGoals, createSavingsGoal, updateSavingsGoal, deleteSavingsGoal } from '../api'
import { Plus, X, Trash2, Pencil, ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

function fmtRs(n) {
  return `LKR ${Number(n).toLocaleString('en-US')}`
}

function GoalFormModal({ initial, onSave, onClose }) {
  const [name, setName]         = useState(initial?.name || '')
  const [target, setTarget]     = useState(initial?.target?.toString() || '')
  const [saved, setSaved]       = useState(initial?.saved?.toString() || '0')
  const [deadline, setDeadline] = useState(initial?.deadline || '')
  const [icon, setIcon]         = useState(initial?.icon || '🎯')
  const [color, setColor]       = useState(initial?.color || '#525252')

  const ICONS = ['🎯','🏠','✈️','🎓','💻','🚗','💍','🎵','📱','💎','🏖️','💊','🎮','👶','📚','🌴']
  const COLORS = ['#FF4D4D','#2FD675','#6C5CE7','#FFB800','#00C2D1','#FF9F1C','#9C90F5','#0A0A0A']

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
      <div className="bg-white border-t-2 sm:border-2 border-ink sm:shadow-brutal-lg rounded-t-[20px] sm:rounded-hero w-full sm:max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b-2 border-ink sticky top-0 bg-white z-10">
          <h2 className="font-bold text-ink">{initial ? 'Edit Goal' : 'New Savings Goal'}</h2>
          <button onClick={onClose} className="text-warm-400 hover:text-terra p-1 rounded-item hover:bg-warm-100"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-[11px] font-bold text-warm-600 tracking-wide mb-2">GOAL NAME</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. New Laptop" className="w-full px-4 py-3 bg-cream border-2 border-ink rounded-item text-sm font-bold text-ink placeholder-warm-400 focus:outline-none focus:border-terra" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-warm-600 tracking-wide mb-2">TARGET (LKR)</label>
              <input type="number" value={target} onChange={e => setTarget(e.target.value)} placeholder="50000" min="1" className="w-full px-4 py-3 bg-cream border-2 border-ink rounded-item text-sm font-bold text-ink placeholder-warm-400 focus:outline-none focus:border-terra" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-warm-600 tracking-wide mb-2">SAVED SO FAR</label>
              <input type="number" value={saved} onChange={e => setSaved(e.target.value)} placeholder="0" min="0" className="w-full px-4 py-3 bg-cream border-2 border-ink rounded-item text-sm font-bold text-ink placeholder-warm-400 focus:outline-none focus:border-terra" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-warm-600 tracking-wide mb-2">DEADLINE (OPTIONAL)</label>
            <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className="w-full px-4 py-3 bg-cream border-2 border-ink rounded-item text-sm font-bold text-ink focus:outline-none focus:border-terra" />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-warm-600 tracking-wide mb-2">ICON</label>
            <div className="flex flex-wrap gap-1.5">
              {ICONS.map(em => (
                <button key={em} type="button" onClick={() => setIcon(em)} className={`w-9 h-9 text-lg rounded-item flex items-center justify-center border-2 transition-all ${icon === em ? 'bg-amber border-ink shadow-brutal-xs' : 'border-transparent hover:bg-warm-200/60'}`}>{em}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-warm-600 tracking-wide mb-2">COLOR</label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map(c => (
                <button key={c} type="button" onClick={() => setColor(c)} className={`w-7 h-7 rounded-full border-2 border-ink transition-all ${color === c ? 'shadow-brutal-xs scale-110' : 'hover:scale-105'}`} style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-item text-sm font-bold text-warm-600 border-2 border-ink hover:bg-warm-100 transition-colors">Cancel</button>
            <button type="submit" className="flex-1 py-2.5 rounded-item text-sm font-bold uppercase tracking-wide bg-terra hover:bg-terra-dark text-white transition-all border-2 border-ink shadow-brutal-sm hover:shadow-none hover:translate-x-[3px] hover:translate-y-[3px]">{initial ? 'Save' : 'Create Goal'}</button>
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
          <h1 className="text-2xl font-bold text-ink uppercase tracking-tight">Savings Goals</h1>
          <p className="text-[11px] font-bold text-warm-600 tracking-wide mt-1">{goals.length} GOALS</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-3.5 py-2 rounded-item text-sm font-bold uppercase tracking-wide bg-terra hover:bg-terra-dark text-white transition-all border-2 border-ink shadow-brutal-sm hover:shadow-none hover:translate-x-[3px] hover:translate-y-[3px]"><Plus size={14} /> New Goal</button>
      </div>

      {goals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <span className="text-5xl">🎯</span>
          <p className="text-sm font-bold text-warm-600">No savings goals yet</p>
          <p className="text-[11px] text-warm-400">Set a target and track your progress</p>
          <button onClick={() => setShowAdd(true)} className="mt-2 px-4 py-2.5 rounded-item text-sm font-bold uppercase tracking-wide bg-terra text-white border-2 border-ink shadow-brutal-sm hover:shadow-none hover:translate-x-[3px] hover:translate-y-[3px] transition-all">Create your first goal</button>
        </div>
      ) : (
        <div className="space-y-4">
          {goals.map(goal => {
            const pct = goal.target > 0 ? Math.min(Math.round((goal.saved / goal.target) * 100), 100) : 0
            const remaining = Math.max(0, goal.target - goal.saved)
            const daysLeft = goal.deadline ? Math.max(0, Math.ceil((new Date(goal.deadline) - Date.now()) / 86400000)) : null

            return (
              <div key={goal.id} className="group bg-white rounded-hero border-2 border-ink shadow-brutal p-5 hover:shadow-brutal-lg hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-card flex items-center justify-center text-2xl border-2 border-ink" style={{ backgroundColor: goal.color }}>
                      {goal.icon}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-ink">{goal.name}</p>
                      <p className="text-[11px] font-bold text-warm-500 mt-0.5">
                        {fmtRs(goal.saved)} of {fmtRs(goal.target)}
                        {daysLeft !== null && <span className="ml-2 text-amber-dark">{daysLeft}d left</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setEditing(goal)} className="p-1.5 rounded-item text-warm-400 hover:text-terra hover:bg-warm-200/60 transition-colors"><Pencil size={13} /></button>
                    <button onClick={() => setDeleting(goal)} className="p-1.5 rounded-item text-warm-400 hover:text-terra hover:bg-terra/10 transition-colors"><Trash2 size={13} /></button>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-3.5 bg-white border-2 border-ink rounded-full overflow-hidden">
                    <div className="h-full border-r-2 border-ink transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: goal.color }} />
                  </div>
                  <span className="text-xs font-bold tabular-nums text-ink">{pct}%</span>
                </div>
                {remaining > 0 && (
                  <p className="text-[11px] font-bold text-warm-400 mt-2">{fmtRs(remaining)} to go</p>
                )}
                {pct >= 100 && (
                  <p className="text-[11px] text-sage-dark font-bold mt-2">Goal reached! 🎉</p>
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
          <div className="bg-white border-2 border-ink shadow-brutal-lg rounded-hero w-full max-w-sm p-5 space-y-4">
            <h2 className="font-bold text-ink">Delete Goal</h2>
            <p className="text-sm text-warm-600">Remove <strong className="text-ink">{deleting.icon} {deleting.name}</strong>?</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleting(null)} className="flex-1 py-2.5 rounded-item text-sm font-bold text-warm-600 border-2 border-ink hover:bg-warm-100 transition-colors">Cancel</button>
              <button onClick={() => deleteMut.mutate(deleting.id)} className="flex-1 py-2.5 rounded-item text-sm font-bold uppercase tracking-wide bg-terra hover:bg-terra-dark text-white transition-all border-2 border-ink shadow-brutal-sm hover:shadow-none hover:translate-x-[3px] hover:translate-y-[3px]">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
