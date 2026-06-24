import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getCategories, createTransaction } from '../api'
import { Check, ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

function fmtToday() {
  return new Date().toLocaleDateString('sv-SE')
}

export default function AddTransaction() {
  const [type, setType]           = useState('expense')
  const [amount, setAmount]       = useState('')
  const [category, setCategory]   = useState('')
  const [description, setDesc]    = useState('')
  const [date, setDate]           = useState(fmtToday)
  const [success, setSuccess]     = useState(false)

  const navigate = useNavigate()
  const qc = useQueryClient()

  const categoriesQ = useQuery({ queryKey: ['categories'], queryFn: getCategories })
  const categories = categoriesQ.data || []

  const filtered = useMemo(() =>
    categories.filter(c => !c.type || c.type === type)
  , [categories, type])

  const addMut = useMutation({
    mutationFn: createTransaction,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['summary'] })
      qc.invalidateQueries({ queryKey: ['daily'] })
      qc.invalidateQueries({ queryKey: ['budgets'] })
      setSuccess(true)
      setTimeout(() => {
        setSuccess(false)
        setAmount('')
        setCategory('')
        setDesc('')
        setDate(fmtToday())
      }, 1500)
    },
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    const val = parseFloat(amount)
    if (!val || !category) return
    addMut.mutate({ amount: val, type, category, description: description || null, date })
  }

  return (
    <div className="p-6 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="p-2 rounded-item text-warm-600 hover:text-terra hover:bg-warm-200/60 transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-xl font-medium text-neutral-800">Add Entry</h1>
          <p className="text-[11px] text-warm-500 tracking-wide mt-0.5">LOG A NEW TRANSACTION</p>
        </div>
      </div>

      {success ? (
        <div className="bg-white rounded-hero border border-sage/30 p-12 flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-sage/10 flex items-center justify-center">
            <Check size={32} className="text-sage" />
          </div>
          <p className="text-lg font-medium text-neutral-800">Added!</p>
          <p className="text-sm text-warm-500">Your transaction has been saved.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="bg-white rounded-hero border border-border p-6 space-y-5">
          {/* Type toggle */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => { setType('expense'); setCategory('') }}
              className={`py-3 rounded-item text-sm font-medium border transition-all ${
                type === 'expense'
                  ? 'bg-terra/10 border-terra/30 text-terra'
                  : 'border-border text-warm-500 hover:bg-warm-100'
              }`}
            >
              Expense
            </button>
            <button
              type="button"
              onClick={() => { setType('income'); setCategory('') }}
              className={`py-3 rounded-item text-sm font-medium border transition-all ${
                type === 'income'
                  ? 'bg-sage/10 border-sage/30 text-sage'
                  : 'border-border text-warm-500 hover:bg-warm-100'
              }`}
            >
              Income
            </button>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-[11px] font-medium text-warm-500 tracking-wide mb-2">AMOUNT (RS.)</label>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0"
              className="w-full px-4 py-3 bg-cream border border-border rounded-item text-2xl font-medium text-neutral-800 placeholder-warm-400 focus:outline-none focus:border-terra/40"
              autoFocus
              min="0"
              step="any"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-[11px] font-medium text-warm-500 tracking-wide mb-2">CATEGORY</label>
            <div className="flex flex-wrap gap-2">
              {filtered.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategory(c.name)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium border transition-all ${
                    category === c.name
                      ? 'bg-terra/10 border-terra/30 text-terra'
                      : 'border-border text-warm-600 hover:border-warm-400'
                  }`}
                >
                  <span>{c.icon}</span>
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-[11px] font-medium text-warm-500 tracking-wide mb-2">NOTE (OPTIONAL)</label>
            <input
              type="text"
              value={description}
              onChange={e => setDesc(e.target.value)}
              placeholder="What was this for?"
              className="w-full px-4 py-3 bg-cream border border-border rounded-item text-sm text-neutral-800 placeholder-warm-400 focus:outline-none focus:border-terra/40"
            />
          </div>

          {/* Date */}
          <div>
            <label className="block text-[11px] font-medium text-warm-500 tracking-wide mb-2">DATE</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full px-4 py-3 bg-cream border border-border rounded-item text-sm text-neutral-800 focus:outline-none focus:border-terra/40"
            />
          </div>

          <button
            type="submit"
            disabled={!amount || !category || addMut.isPending}
            className="w-full py-3.5 rounded-item text-sm font-medium bg-terra hover:bg-terra-dark text-white transition-colors disabled:opacity-40"
          >
            {addMut.isPending ? 'Saving…' : 'Add Transaction'}
          </button>
        </form>
      )}
    </div>
  )
}
