import { Routes, Route, NavLink } from 'react-router-dom'
import { LayoutDashboard, List, Tag, Target, CalendarDays, Menu, X } from 'lucide-react'
import { useState } from 'react'
import Dashboard    from './pages/Dashboard'
import Transactions from './pages/Transactions'
import Categories   from './pages/Categories'
import Budgets      from './pages/Budgets'
import Yearly       from './pages/Yearly'

const NAV = [
  { to: '/',             label: 'Dashboard',    icon: LayoutDashboard },
  { to: '/transactions', label: 'Transactions', icon: List },
  { to: '/yearly',       label: 'Yearly',       icon: CalendarDays },
  { to: '/categories',   label: 'Categories',   icon: Tag },
  { to: '/budgets',      label: 'Budgets',      icon: Target },
]

function NavItem({ to, label, Icon, mobile, onClick }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={onClick}
      className={({ isActive }) =>
        [
          'flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all',
          isActive
            ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-600/30'
            : 'text-slate-400 hover:text-slate-200 hover:bg-white/5',
          mobile ? 'w-full' : '',
        ].join(' ')
      }
    >
      <Icon size={16} />
      {label}
    </NavLink>
  )
}

export default function App() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="flex min-h-screen bg-surface text-slate-200">
      {/* Sidebar – desktop */}
      <aside className="hidden md:flex flex-col w-56 shrink-0 border-r border-border bg-card sticky top-0 h-screen">
        <div className="px-5 py-5 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-lg">💸</span>
            <span className="font-semibold text-sm text-slate-100">Money Tracker</span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">Telegram · Dashboard</p>
        </div>
        <nav className="flex flex-col gap-1 p-3 flex-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavItem key={to} to={to} label={label} Icon={Icon} />
          ))}
        </nav>
        <div className="px-4 py-4 border-t border-border">
          <p className="text-xs text-slate-600">Personal · Single user</p>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3 bg-card border-b border-border">
        <div className="flex items-center gap-2">
          <span>💸</span>
          <span className="font-semibold text-sm">Money Tracker</span>
        </div>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/5"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile nav overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/60" onClick={() => setMobileOpen(false)}>
          <div className="bg-card border-r border-border w-64 min-h-full pt-16 p-3" onClick={e => e.stopPropagation()}>
            <nav className="flex flex-col gap-1">
              {NAV.map(({ to, label, icon: Icon }) => (
                <NavItem key={to} to={to} label={label} Icon={Icon} mobile onClick={() => setMobileOpen(false)} />
              ))}
            </nav>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 min-w-0 md:pt-0 pt-14">
        <Routes>
          <Route path="/"             element={<Dashboard />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/categories"   element={<Categories />} />
          <Route path="/budgets"      element={<Budgets />} />
          <Route path="/yearly"       element={<Yearly />} />
        </Routes>
      </main>
    </div>
  )
}
