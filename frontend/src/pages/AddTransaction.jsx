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
          <h1 className="text-2xl font-bold text-ink uppercase tracking-tight">Add Entry</h1>
          <p className="text-[11px] font-bold text-warm-600 tracking-wide mt-0.5">LOG A NEW TRANSACTION</p>
        </div>
      </div>

      {success ? (
        <div className="bg-sage rounded-hero border-2 border-ink shadow-brutal p-12 flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-white border-2 border-ink flex items-center justify-center">
            <Check size={32} className="text-sage-dark" strokeWidth={3} />
          </div>
          <p className="text-lg font-bold text-white">Added!</p>
          <p className="text-sm font-bold text-white/80">Your transaction has been saved.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="bg-white rounded-hero border-2 border-ink shadow-brutal p-6 space-y-5">
          {/* Type toggle */}
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => { setType('expense'); setCategory('') }}
              className={`py-3 rounded-item text-sm font-bold border-2 transition-all ${
                type === 'expense'
                  ? 'bg-terra border-ink text-white shadow-brutal-xs'
                  : 'border-ink text-warm-500 hover:bg-warm-100'
              }`}
            >
              Expense
            </button>
            <button
              type="button"
              onClick={() => { setType('income'); setCategory('') }}
              className={`py-3 rounded-item text-sm font-bold border-2 transition-all ${
                type === 'income'
                  ? 'bg-sage border-ink text-white shadow-brutal-xs'
                  : 'border-ink text-warm-500 hover:bg-warm-100'
              }`}
            >
              Income
            </button>
            <button
              type="button"
              onClick={() => { setType('investment'); setCategory('') }}
              className={`py-3 rounded-item text-sm font-bold border-2 transition-all ${
                type === 'investment'
                  ? 'bg-invest border-ink text-white shadow-brutal-xs'
                  : 'border-ink text-warm-500 hover:bg-warm-100'
              }`}
            >
              Invest
            </button>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-[11px] font-bold text-warm-600 tracking-wide mb-2">AMOUNT (LKR)</label>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0"
              className="w-full px-4 py-3 bg-cream border-2 border-ink rounded-item text-2xl font-bold text-ink tracking-tight placeholder-warm-400 focus:outline-none focus:border-terra"
              autoFocus
              min="0"
              step="any"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-[11px] font-bold text-warm-600 tracking-wide mb-2">CATEGORY</label>
            <div className="flex flex-wrap gap-2">
              {filtered.map(c => {
                const activeClass = type === 'income' ? 'bg-sage border-ink text-white shadow-brutal-xs'
                  : type === 'investment' ? 'bg-invest border-ink text-white shadow-brutal-xs'
                  : 'bg-terra border-ink text-white shadow-brutal-xs'
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCategory(c.name)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold border-2 transition-all ${
                      category === c.name ? activeClass : 'border-ink text-warm-600 hover:bg-warm-100'
                    }`}
                  >
                    <span>{c.icon}</span>
                    {c.name}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-[11px] font-bold text-warm-600 tracking-wide mb-2">NOTE (OPTIONAL)</label>
            <input
              type="text"
              value={description}
              onChange={e => setDesc(e.target.value)}
              placeholder="What was this for?"
              className="w-full px-4 py-3 bg-cream border-2 border-ink rounded-item text-sm font-bold text-ink placeholder-warm-400 focus:outline-none focus:border-terra"
            />
          </div>

          {/* Date */}
          <div>
            <label className="block text-[11px] font-bold text-warm-600 tracking-wide mb-2">DATE</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full px-4 py-3 bg-cream border-2 border-ink rounded-item text-sm font-bold text-ink focus:outline-none focus:border-terra"
            />
          </div>

          <button
            type="submit"
            disabled={!amount || !category || addMut.isPending}
            className="w-full py-3.5 rounded-item text-sm font-bold uppercase tracking-wide bg-terra hover:bg-terra-dark text-white transition-all border-2 border-ink shadow-brutal-sm hover:shadow-none hover:translate-x-[3px] hover:translate-y-[3px] disabled:opacity-40"
          >
            {addMut.isPending ? 'Saving…' : 'Add Transaction'}
          </button>
        </form>
      )}
    </div>
  )
}
