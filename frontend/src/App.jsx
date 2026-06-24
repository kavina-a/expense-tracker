import { Routes, Route, NavLink, useLocation } from 'react-router-dom'
import { Home, Clock, PlusCircle, BarChart3, User, ChevronLeft, ChevronRight, Download, Tag, Target, Crosshair } from 'lucide-react'
import { useState } from 'react'
import Dashboard      from './pages/Dashboard'
import Transactions   from './pages/Transactions'
import Stats          from './pages/Stats'
import Categories     from './pages/Categories'
import Budgets        from './pages/Budgets'
import Yearly         from './pages/Yearly'
import AddTransaction from './pages/AddTransaction'
import SavingsGoals   from './pages/SavingsGoals'

const BOTTOM_TABS = [
  { to: '/',             label: 'Home',    icon: Home },
  { to: '/transactions', label: 'History', icon: Clock },
  { to: '/add',          label: 'Add',     icon: PlusCircle, center: true },
  { to: '/stats',        label: 'Stats',   icon: BarChart3 },
  { to: '/profile',      label: 'Profile', icon: User },
]

const SIDEBAR_NAV = [
  { to: '/',             label: 'Home',         icon: Home },
  { to: '/transactions', label: 'History',      icon: Clock },
  { to: '/stats',        label: 'Stats',        icon: BarChart3 },
  { to: '/yearly',       label: 'Yearly',       icon: BarChart3 },
  { to: '/categories',   label: 'Categories',   icon: Tag },
  { to: '/budgets',      label: 'Budgets',      icon: Target },
  { to: '/savings',      label: 'Savings Goals', icon: Crosshair },
]

function SidebarLink({ to, label, Icon, collapsed }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        [
          'flex items-center gap-3 px-3 py-2.5 rounded-item text-sm font-medium transition-all',
          isActive
            ? 'bg-terra/10 text-terra border border-terra/20'
            : 'text-warm-600 hover:text-terra hover:bg-warm-200/60',
          collapsed ? 'justify-center' : '',
        ].join(' ')
      }
    >
      <Icon size={18} strokeWidth={1.8} />
      {!collapsed && <span>{label}</span>}
    </NavLink>
  )
}

function BottomTab({ to, label, Icon, center }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        [
          'flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 transition-colors relative',
          isActive && !center ? 'text-terra' : !center ? 'text-warm-500' : '',
        ].join(' ')
      }
    >
      {({ isActive }) => center ? (
        <div className="flex flex-col items-center -mt-4">
          <div className="w-12 h-12 rounded-full bg-terra flex items-center justify-center shadow-sm">
            <Icon size={22} strokeWidth={2} className="text-white" />
          </div>
          <span className="text-[10px] font-medium tracking-wide text-terra mt-0.5">{label}</span>
        </div>
      ) : (
        <>
          <Icon size={20} strokeWidth={isActive ? 2 : 1.5} />
          <span className={`text-[10px] tracking-wide ${isActive ? 'font-medium' : 'font-normal'}`}>{label}</span>
        </>
      )}
    </NavLink>
  )
}

export default function App() {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="flex min-h-screen bg-cream">
      {/* Desktop sidebar */}
      <aside className={`hidden md:flex flex-col shrink-0 border-r border-border bg-white sticky top-0 h-screen transition-all duration-200 ${
        collapsed ? 'w-16' : 'w-56'
      }`}>
        <div className={`flex items-center border-b border-border ${collapsed ? 'px-3 py-4 justify-center' : 'px-5 py-5'}`}>
          {!collapsed && (
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-item bg-terra flex items-center justify-center">
                  <span className="text-white text-sm font-medium">₹</span>
                </div>
                <span className="font-medium text-sm text-neutral-800">Money Tracker</span>
              </div>
              <p className="text-[11px] text-warm-500 mt-1 tracking-wide">PERSONAL · TELEGRAM</p>
            </div>
          )}
          {collapsed && (
            <div className="w-8 h-8 rounded-item bg-terra flex items-center justify-center">
              <span className="text-white text-sm font-medium">₹</span>
            </div>
          )}
        </div>

        <nav className="flex flex-col gap-1 p-3 flex-1">
          {SIDEBAR_NAV.map(({ to, label, icon: Icon }) => (
            <SidebarLink key={to} to={to} label={label} Icon={Icon} collapsed={collapsed} />
          ))}
        </nav>

        <div className={`border-t border-border ${collapsed ? 'p-2' : 'px-4 py-4 space-y-3'}`}>
          {!collapsed && (
            <a href="/api/backup" download className="flex items-center gap-2 text-[11px] text-warm-500 hover:text-terra transition-colors tracking-wide">
              <Download size={12} /> Backup data
            </a>
          )}
          <button onClick={() => setCollapsed(c => !c)} className={`flex items-center justify-center text-warm-500 hover:text-terra transition-colors ${collapsed ? 'w-full py-2' : ''}`}>
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0">
        <Routes>
          <Route path="/"             element={<Dashboard />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/stats"        element={<Stats />} />
          <Route path="/categories"   element={<Categories />} />
          <Route path="/budgets"      element={<Budgets />} />
          <Route path="/yearly"       element={<Yearly />} />
          <Route path="/add"          element={<AddTransaction />} />
          <Route path="/savings"      element={<SavingsGoals />} />
          <Route path="/profile"      element={<ProfilePage />} />
        </Routes>
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-border flex items-end">
        <div className="flex w-full px-1 pb-1 pt-1">
          {BOTTOM_TABS.map((tab) => (
            <BottomTab key={tab.to} {...tab} />
          ))}
        </div>
      </nav>
    </div>
  )
}

function ProfilePage() {
  return (
    <div className="p-5 md:p-8 max-w-2xl mx-auto">
      <h1 className="text-xl font-medium text-neutral-800 mb-2">Profile</h1>
      <p className="text-[11px] text-warm-500 tracking-wide mb-8">YOUR ACCOUNT & APP SETTINGS</p>

      <div className="bg-white rounded-hero border border-border p-6 mb-4">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-14 h-14 rounded-full bg-terra/10 flex items-center justify-center">
            <span className="text-2xl">👤</span>
          </div>
          <div>
            <p className="font-medium text-neutral-800">Kavina</p>
            <p className="text-[11px] text-warm-500 tracking-wide mt-0.5">PERSONAL ACCOUNT</p>
          </div>
        </div>

        <div className="space-y-3">
          {[
            { to: '/savings',    icon: <Crosshair size={18} className="text-terra" />, title: 'Savings Goals', sub: 'Track progress toward targets' },
            { to: '/categories', icon: <Tag size={18} className="text-terra" />,        title: 'Manage Categories', sub: 'Edit income & expense categories' },
            { to: '/budgets',    icon: <Target size={18} className="text-terra" />,     title: 'Budget Limits', sub: 'Set monthly spending limits' },
            { to: '/yearly',     icon: <BarChart3 size={18} className="text-terra" />,  title: 'Yearly Overview', sub: 'Full-year financial report' },
          ].map(item => (
            <NavLink key={item.to} to={item.to} className="flex items-center gap-3 p-4 rounded-item border border-border hover:border-terra/30 transition-colors">
              {item.icon}
              <div>
                <p className="text-sm font-medium text-neutral-800">{item.title}</p>
                <p className="text-[11px] text-warm-500 mt-0.5">{item.sub}</p>
              </div>
            </NavLink>
          ))}

          <a href="/api/backup" download className="flex items-center gap-3 p-4 rounded-item border border-border hover:border-terra/30 transition-colors">
            <Download size={18} className="text-terra" />
            <div>
              <p className="text-sm font-medium text-neutral-800">Download Backup</p>
              <p className="text-[11px] text-warm-500 mt-0.5">Full JSON export of all data</p>
            </div>
          </a>
        </div>
      </div>

      <p className="text-center text-[11px] text-warm-500 tracking-wide mt-6">MONEY TRACKER · PERSONAL · v1.0</p>
    </div>
  )
}
