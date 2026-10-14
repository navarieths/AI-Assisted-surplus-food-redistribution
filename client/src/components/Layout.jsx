import { NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  Bell,
  HeartHandshake,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  PlusCircle,
  Truck,
  BarChart3,
  X,
} from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { api } from '../lib/api.js';
import { getRoleHome } from '../lib/roles.js';

const NAV = {
  provider: [
    { to: '/provider', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/listings/new', label: 'New listing', icon: PlusCircle },
    { to: '/volunteers', label: 'Carriers', icon: Truck },
  ],
  recipient: [
    { to: '/inbox', label: 'Offers', icon: Bell },
    { to: '/recipient', label: 'My deliveries', icon: HeartHandshake },
  ],
  volunteer: [
    { to: '/volunteer', label: 'Available', icon: ListChecks },
    { to: '/my-tasks', label: 'My tasks', icon: Truck },
  ],
  delivery_partner: [
    { to: '/volunteer', label: 'Available', icon: ListChecks },
    { to: '/my-tasks', label: 'My tasks', icon: Truck },
  ],
};

function NotificationBell() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    api
      .get('/notifications')
      .then((d) => alive && setCount((d.notifications || []).filter((n) => !n.read).length))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return (
    <NavLink to="/notifications" className="relative rounded-lg p-2 hover:bg-white/10" title="Notifications">
      <Bell className="h-5 w-5" />
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">
          {count}
        </span>
      )}
    </NavLink>
  );
}

export default function Layout({ children }) {
  const { user, logout, switchRole } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [roleError, setRoleError] = useState('');
  const links = NAV[user?.role] || [];

  const doLogout = () => {
    logout();
    navigate('/login');
  };

  const changeRole = async (event) => {
    setRoleError('');
    try {
      const nextUser = await switchRole(event.target.value);
      navigate(getRoleHome(nextUser.role));
    } catch (error) {
      setRoleError(error.message || 'Could not switch role');
    }
  };

  const roleLabel = { provider: 'Provider', recipient: 'Recipient', volunteer: 'Volunteer', delivery_partner: 'Delivery partner' }[user?.role];

  return (
    <div className="min-h-full bg-brand-50">
      <header className="sticky top-0 z-[900] bg-navy-800 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <NavLink to="/" className="flex items-center gap-2 font-bold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand">🍃</span>
            <span className="hidden sm:inline">Surplus</span>
          </NavLink>

          <nav className="hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  `inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ${
                    isActive ? 'bg-white/15' : 'hover:bg-white/10'
                  }`
                }
              >
                <l.icon className="h-4 w-4" /> {l.label}
              </NavLink>
            ))}
            <NavLink
              to="/impact"
              className={({ isActive }) =>
                `inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-white/15' : 'hover:bg-white/10'}`
              }
            >
              <BarChart3 className="h-4 w-4" /> Impact
            </NavLink>
          </nav>

          <div className="flex items-center gap-2">
            <NotificationBell />
            <div className="hidden text-right text-xs leading-tight sm:block">
              <div className="font-semibold">{user?.name}</div>
              <div className="text-white/70">{roleLabel}</div>
            </div>
            <select
              aria-label="Switch active role"
              className="max-w-36 rounded-md border border-white/20 bg-navy-700 px-2 py-1.5 text-xs text-white"
              value={user?.role || ''}
              onChange={changeRole}
            >
              {['provider', 'recipient', 'volunteer', 'delivery_partner'].map((role) => (
                <option key={role} value={role} className="text-navy-800">
                  {role.replace('_', ' ')}
                </option>
              ))}
            </select>
            <button onClick={doLogout} className="hidden rounded-lg p-2 hover:bg-white/10 sm:inline-flex" title="Log out">
              <LogOut className="h-5 w-5" />
            </button>
            <button className="rounded-lg p-2 hover:bg-white/10 md:hidden" onClick={() => setOpen((o) => !o)}>
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {open && (
          <div className="border-t border-white/10 px-4 pb-3 md:hidden">
            <div className="flex flex-col gap-1 pt-2">
              {links.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-white/15' : 'hover:bg-white/10'}`
                  }
                >
                  <l.icon className="h-4 w-4" /> {l.label}
                </NavLink>
              ))}
              <NavLink to="/impact" onClick={() => setOpen(false)} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium hover:bg-white/10">
                <BarChart3 className="h-4 w-4" /> Impact
              </NavLink>
              <button onClick={doLogout} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium hover:bg-white/10">
                <LogOut className="h-4 w-4" /> Log out
              </button>
            </div>
          </div>
        )}
      </header>

      {roleError && <div role="alert" className="bg-red-50 px-4 py-2 text-center text-sm text-red-700">{roleError}</div>}

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>

      <footer className="mx-auto max-w-6xl px-4 pb-10 pt-4 text-center text-xs text-navy-600">
        Hackathon demo · OTP and notifications are simulated · No payments
      </footer>
    </div>
  );
}
