import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, HeartHandshake, LogIn, Truck, UserPlus } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { api } from '../lib/api.js';
import MapPicker from '../components/MapPicker.jsx';
import { ErrorNote, Field } from '../components/ui.jsx';

const ROLE_ICON = { provider: Building2, recipient: HeartHandshake, volunteer: Truck, delivery_partner: Truck };

export default function Login() {
  const { login, register, user } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [demoAccounts, setDemoAccounts] = useState([]);
  const [form, setForm] = useState({ email: '', password: '' });
  const [reg, setReg] = useState({
    role: 'provider',
    name: '',
    email: '',
    password: 'password123',
    phone: '',
    org_name: '',
    veg_only: false,
    capacity_servings: 0,
    location: null,
  });

  useEffect(() => {
    api.get('/auth/demo-accounts').then((d) => setDemoAccounts(d.accounts || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (user) {
      const home = user.role === 'provider' ? '/provider' : user.role === 'recipient' ? '/inbox' : '/volunteer';
      navigate(home, { replace: true });
    }
  }, [user, navigate]);

  const submitLogin = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const u = await login(form.email, form.password);
      navigate(u.role === 'provider' ? '/provider' : u.role === 'recipient' ? '/inbox' : '/volunteer');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submitRegister = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const u = await register({
        role: reg.role,
        name: reg.name,
        email: reg.email,
        password: reg.password,
        phone: reg.phone,
        org_name: reg.org_name,
        veg_only: reg.veg_only,
        capacity_servings: reg.capacity_servings,
        lat: reg.location?.lat,
        lng: reg.location?.lng,
        address: reg.location?.address,
      });
      navigate(u.role === 'provider' ? '/provider' : u.role === 'recipient' ? '/inbox' : '/volunteer');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const quick = (email) => {
    setMode('login');
    setForm({ email, password: 'password123' });
  };

  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <div className="hidden flex-col justify-between bg-navy-800 p-10 text-white md:flex">
        <div className="flex items-center gap-2 text-xl font-bold">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand">🍃</span> Surplus
        </div>
        <div>
          <h1 className="text-3xl font-bold leading-tight">
            Redirect surplus food to the people who need it — safely, and before it spoils.
          </h1>
          <p className="mt-4 text-white/80">
            Rule-based validation flags unsafe listings. Deterministic matching scores eligible NGOs and
            community kitchens. Volunteers collect with OTP-verified pickup and live tracking.
          </p>
          <p className="mt-6 rounded-lg bg-white/10 p-3 text-xs text-white/80">
            Checks are rule-based on provider-entered details. This platform does not certify food safety.
          </p>
        </div>
        <p className="text-xs text-white/60">Hackathon demo · simulated OTP & notifications · no payments</p>
      </div>

      <div className="flex items-center justify-center bg-brand-50 p-6">
        <div className="w-full max-w-md">
          <div className="mb-6 flex gap-2">
            <button className={mode === 'login' ? 'btn-primary flex-1' : 'btn-ghost flex-1'} onClick={() => setMode('login')}>
              <LogIn className="h-4 w-4" /> Log in
            </button>
            <button className={mode === 'register' ? 'btn-primary flex-1' : 'btn-ghost flex-1'} onClick={() => setMode('register')}>
              <UserPlus className="h-4 w-4" /> Register
            </button>
          </div>

          <div className="card p-5">
            {mode === 'login' ? (
              <form className="space-y-4" onSubmit={submitLogin}>
                <h2 className="text-lg font-bold text-navy-800">Welcome back</h2>
                <Field label="Email">
                  <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
                </Field>
                <Field label="Password">
                  <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
                </Field>
                <ErrorNote>{error}</ErrorNote>
                <button className="btn-green w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
              </form>
            ) : (
              <form className="space-y-3" onSubmit={submitRegister}>
                <h2 className="text-lg font-bold text-navy-800">Create an account</h2>
                <Field label="I am a">
                  <div className="grid grid-cols-2 gap-2">
                    {['provider', 'recipient', 'volunteer', 'delivery_partner'].map((r) => {
                      const Icon = ROLE_ICON[r];
                      return (
                        <button
                          type="button"
                          key={r}
                          onClick={() => setReg({ ...reg, role: r })}
                          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm capitalize ${
                            reg.role === r ? 'border-brand bg-brand-50 font-semibold text-brand-700' : 'border-navy-100'
                          }`}
                        >
                          <Icon className="h-4 w-4" /> {r.replace('_', ' ')}
                        </button>
                      );
                    })}
                  </div>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Name"><input className="input" value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value })} required /></Field>
                  <Field label="Organisation"><input className="input" value={reg.org_name} onChange={(e) => setReg({ ...reg, org_name: e.target.value })} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Email"><input className="input" type="email" value={reg.email} onChange={(e) => setReg({ ...reg, email: e.target.value })} required /></Field>
                  <Field label="Phone"><input className="input" value={reg.phone} onChange={(e) => setReg({ ...reg, phone: e.target.value })} /></Field>
                </div>
                <Field label="Password"><input className="input" type="password" value={reg.password} onChange={(e) => setReg({ ...reg, password: e.target.value })} required /></Field>
                {reg.role === 'recipient' && (
                  <div className="grid grid-cols-2 items-end gap-3">
                    <Field label="Capacity (servings)"><input className="input" type="number" min="0" value={reg.capacity_servings} onChange={(e) => setReg({ ...reg, capacity_servings: Number(e.target.value) })} /></Field>
                    <label className="flex items-center gap-2 pb-2 text-sm">
                      <input type="checkbox" checked={reg.veg_only} onChange={(e) => setReg({ ...reg, veg_only: e.target.checked })} /> Vegetarian only
                    </label>
                  </div>
                )}
                <MapPicker label="Your location" value={reg.location} onChange={(location) => setReg({ ...reg, location })} height={220} />
                <ErrorNote>{error}</ErrorNote>
                <button className="btn-green w-full" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
              </form>
            )}
          </div>

          {demoAccounts.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy-600">Demo accounts (password: password123)</p>
              <div className="flex flex-wrap gap-2">
                {demoAccounts.map((a) => (
                  <button key={a.id} onClick={() => quick(a.email)} className="chip bg-white text-navy-700 ring-1 ring-navy-100 hover:bg-brand-50">
                    {a.name} · <span className="text-navy-500">{a.role.replace('_', ' ')}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
