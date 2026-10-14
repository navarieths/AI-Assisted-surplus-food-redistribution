import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { getRoleHome } from '../lib/roles.js';
import { api } from '../lib/api.js';
import { ErrorNote, Field } from '../components/ui.jsx';

export default function Login() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [demoAccounts, setDemoAccounts] = useState([]);
  const [form, setForm] = useState({ email: '', password: '', role: '' });

  useEffect(() => {
    api.get('/auth/demo-accounts').then((d) => setDemoAccounts(d.accounts || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (user) {
      navigate(getRoleHome(user.role), { replace: true });
    }
  }, [user, navigate]);

  const submitLogin = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const u = await login(form.email, form.password, form.role);
      navigate(getRoleHome(u.role));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const quick = (account) => {
    setForm((current) => ({
      email: account.email,
      password: 'password123',
      role: current.role || account.role,
    }));
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
          <div className="card p-5">
            <form className="space-y-4" onSubmit={submitLogin}>
              <h2 className="text-lg font-bold text-navy-800">Sign in</h2>
              <Field label="Email">
                <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              </Field>
              <Field label="Password">
                <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
              </Field>
              <Field label="Role for this session">
                <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} required>
                  <option value="">Select a role</option>
                  {['provider', 'recipient', 'volunteer', 'delivery_partner'].map((role) => (
                    <option key={role} value={role}>{role.replace('_', ' ')}</option>
                  ))}
                </select>
              </Field>
              <ErrorNote>{error}</ErrorNote>
              <button className="btn-green w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
            </form>
          </div>

          {demoAccounts.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy-600">Demo accounts (password: password123)</p>
              <div className="flex flex-wrap gap-2">
                {demoAccounts.map((a) => (
                  <button key={a.id} onClick={() => quick(a)} className="chip bg-white text-navy-700 ring-1 ring-navy-100 hover:bg-brand-50">
                    {a.name}
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
