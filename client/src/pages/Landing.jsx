import { Link, Navigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Leaf, MapPin, Route, ShieldCheck } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { getRoleHome } from '../lib/roles.js';
import { SafetyDisclaimer } from '../components/ui.jsx';

const STEPS = [
  {
    icon: Leaf,
    title: 'Providers list surplus',
    body: 'Restaurants, hotels and bakeries post surplus food with quantities, timings and a mapped pickup point.',
  },
  {
    icon: ShieldCheck,
    title: 'Rule-based checks',
    body: 'Deterministic validation flags cold-chain and timing risks before anything is offered. No black boxes.',
  },
  {
    icon: Route,
    title: 'Deterministic matching',
    body: 'Eligible recipients are scored on proximity, capacity, timing feasibility, food preference and reliability.',
  },
  {
    icon: MapPin,
    title: 'OTP pickup + live tracking',
    body: 'Volunteers collect with an OTP-verified pickup; recipients follow the route live on the map.',
  },
];

export default function Landing() {
  const { user, loading } = useAuth();

  if (user) {
    return <Navigate to={getRoleHome(user.role)} replace />;
  }
  if (loading) return null;

  return (
    <div className="min-h-screen bg-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2 text-lg font-bold text-navy-800">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand">🍃</span> Surplus
        </div>
        <div className="flex items-center gap-2">
          <Link to="/login" className="btn-green">
            Sign in <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <section className="bg-navy-800 text-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-16 md:grid-cols-2 md:items-center">
          <div>
            <span className="chip bg-white/10 text-white/90">Hackathon demo · no payments</span>
            <h1 className="mt-4 text-4xl font-bold leading-tight md:text-5xl">
              Redirect surplus food to the people who need it.
            </h1>
            <p className="mt-4 text-white/80">
              A working end-to-end platform connecting food providers, community recipients and volunteer
              carriers — with rule-based checks, deterministic matching and live delivery tracking.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/login" className="btn-green">
                Sign in <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/login" className="rounded-lg border border-white/30 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10">
                Try a demo account
              </Link>
            </div>
            <p className="mt-6 rounded-lg bg-white/10 p-3 text-xs text-white/80">
              Checks are rule-based on provider-entered details. This platform does not certify food safety.
            </p>
          </div>
          <div className="grid gap-3">
            {STEPS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-xl bg-white/5 p-4 ring-1 ring-white/10">
                <div className="flex items-center gap-2 font-semibold">
                  <Icon className="h-4 w-4 text-brand" /> {title}
                </div>
                <p className="mt-1 text-sm text-white/75">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-14">
        <h2 className="text-2xl font-bold text-navy-800">How it works</h2>
        <div className="mt-6 grid gap-6 md:grid-cols-4">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <div key={title} className="card p-5">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-3 font-semibold text-navy-800">
                {i + 1}. {title}
              </h3>
              <p className="mt-1 text-sm text-navy-600">{body}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {[
            'Rule-based validation with a clear, non-certifying disclaimer.',
            'Deterministic scoring that works with no AI key; an LLM may only rewrite the explanation.',
            'Simulated OTP and notifications — contact details stay visible only to a donation’s participants.',
          ].map((t) => (
            <div key={t} className="flex items-start gap-2 text-sm text-navy-700">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand" /> {t}
            </div>
          ))}
        </div>

        <div className="mt-10">
          <SafetyDisclaimer />
        </div>
      </section>

      <footer className="border-t border-navy-100 py-6 text-center text-xs text-navy-500">
        Surplus food redistribution · hackathon demo · simulated OTP &amp; notifications
      </footer>
    </div>
  );
}
