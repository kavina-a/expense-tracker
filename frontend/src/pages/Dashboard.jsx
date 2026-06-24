import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSummary, getTrends, getDailyData, getCategories } from '../api'
import StatCard from '../components/StatCard'
import SpendingTrend from '../components/charts/SpendingTrend'
import CategoryDonut from '../components/charts/CategoryDonut'
import IncomeVsExpense from '../components/charts/IncomeVsExpense'
import CategoryBars from '../components/charts/CategoryBars'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'

// Use browser's local timezone (avoids UTC offset flip for Sri Lanka UTC+5:30)
function currentMonthStr() {
  return new Date().toLocaleDateString('sv-SE').slice(0, 7)
}

function formatMonthLabel(m) {
  const [y, mo] = m.split('-')
  return new Date(parseInt(y), parseInt(mo) - 1).toLocaleString('default', {
    month: 'long',
    year: 'numeric',
  })
}

function shiftMonth(m, delta) {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmtRs(n) {
  return `Rs. ${Number(n).toLocaleString('en-IN')}`
}

export default function Dashboard() {
  const [month, setMonth] = useState(currentMonthStr)
  const isCurrentMonth = month === currentMonthStr()

  const summaryQ   = useQuery({ queryKey: ['summary', month],   queryFn: () => getSummary(month) })
  const dailyQ     = useQuery({ queryKey: ['daily', month],     queryFn: () => getDailyData(month) })
  const trendsQ    = useQuery({ queryKey: ['trends'],           queryFn: () => getTrends(6) })
  const categoriesQ = useQuery({ queryKey: ['categories'],      queryFn: getCategories })

  const summary    = summaryQ.data  || { totalSpent: 0, totalEarned: 0, net: 0, expenses: [], incomes: [], expenseCount: 0, incomeCount: 0, txCount: 0 }
  const daily      = dailyQ.data    || []
  const trends     = trendsQ.data   || []
  const categories = categoriesQ.data || []

  // Enrich expense rows with category color
  const colorMap = Object.fromEntries(categories.map(c => [c.name, c.color]))
  const enrichedExpenses = summary.expenses.map(e => ({ ...e, color: colorMap[e.category] || '#6b7280' }))

  const isLoading = summaryQ.isLoading

  return (
    <div className="p-6 max-w-6xl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Dashboard</h1>
          <p className="text-xs text-slate-500 mt-0.5">Your financial overview</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMonth(m => shiftMonth(m, -1))}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-medium text-slate-200 min-w-[130px] text-center">
            {formatMonthLabel(month)}
          </span>
          <button
            onClick={() => setMonth(m => shiftMonth(m, 1))}
            disabled={isCurrentMonth}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors disabled:opacity-30"
          >
            <ChevronRight size={16} />
          </button>
          {!isCurrentMonth && (
            <button
              onClick={() => setMonth(currentMonthStr())}
              className="px-2.5 py-1 rounded-lg text-xs text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors"
            >
              Today
            </button>
          )}
          <button
            onClick={() => { summaryQ.refetch(); dailyQ.refetch(); trendsQ.refetch(); categoriesQ.refetch() }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Total Spent"
          value={fmtRs(summary.totalSpent)}
          sub={`${summary.expenseCount} transactions`}
          accent="red"
          icon="💸"
        />
        <StatCard
          label="Total Earned"
          value={fmtRs(summary.totalEarned)}
          sub={`${summary.incomeCount} entries`}
          accent="green"
          icon="💰"
        />
        <StatCard
          label="Net Balance"
          value={`${summary.net >= 0 ? '+' : ''}${fmtRs(summary.net)}`}
          sub={summary.net >= 0 ? 'Positive month' : 'Over budget'}
          accent={summary.net >= 0 ? 'green' : 'red'}
          icon={summary.net >= 0 ? '📈' : '📉'}
        />
        <StatCard
          label="Categories Active"
          value={summary.expenses?.length || 0}
          sub={`${summary.txCount} total entries`}
          accent="indigo"
          icon="📂"
        />
      </div>

      {/* Charts – row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="lg:col-span-2">
          <SpendingTrend data={daily} />
        </div>
        <div className="lg:col-span-1">
          <CategoryDonut expenses={enrichedExpenses} />
        </div>
      </div>

      {/* Charts – row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <IncomeVsExpense trends={trends} />
        <CategoryBars expenses={enrichedExpenses} categories={categories} />
      </div>
    </div>
  )
}
