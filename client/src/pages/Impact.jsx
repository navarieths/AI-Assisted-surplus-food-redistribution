import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet';
import { Leaf, Package, Recycle, Users } from 'lucide-react';
import { api } from '../lib/api.js';
import { Spinner, SafetyDisclaimer } from '../components/ui.jsx';
import { useMapConfig } from '../lib/mapConfig.js';
import { fmtDateTime, num, statusMeta } from '../lib/format.js';

const COLORS = ['#1E9E5A', '#0B2545', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6'];

function Stat({ icon: Icon, label, value, sub }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <div className="text-xl font-bold text-navy-800">{value}</div>
        <div className="text-xs text-navy-600">{label}</div>
        {sub && <div className="text-[11px] text-navy-500">{sub}</div>}
      </div>
    </div>
  );
}

function HeatCluster({ deliveries }) {
  const mapConfig = useMapConfig();
  const points = deliveries || [];
  if (points.length === 0) {
    return <div className="flex h-72 items-center justify-center rounded-xl border border-dashed border-navy-100 text-sm text-navy-600">No completed deliveries yet.</div>;
  }
  const center = [points[0].lat, points[0].lng];
  const maxKg = Math.max(...points.map((p) => p.quantity_kg || 1), 1);
  return (
    <div className="overflow-hidden rounded-xl border border-navy-100" style={{ height: 320 }}>
      <MapContainer center={center} zoom={12} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        {mapConfig && <TileLayer url={mapConfig.tileUrl} attribution={mapConfig.attribution} maxZoom={mapConfig.maxZoom || 19} />}
        {points.map((p) => {
          const intensity = Math.max(0.25, (p.quantity_kg || 1) / maxKg);
          return (
            <CircleMarker
              key={p.id}
              center={[p.lat, p.lng]}
              radius={10 + intensity * 22}
              pathOptions={{ color: '#1E9E5A', fillColor: '#1E9E5A', fillOpacity: 0.25 + intensity * 0.4, weight: 1 }}
            >
              <Popup>
                <strong>{p.title}</strong>
                <div className="text-xs">{p.recipient_name || p.org_name}</div>
                <div className="text-xs">{num(p.quantity_kg)} kg · {p.servings} servings</div>
                <div className="text-xs">{fmtDateTime(p.delivered_at)}</div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}

export default function Impact() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/impact').then(setData).catch((e) => setError(e.message));
  }, []);

  const pie = useMemo(
    () => (data?.breakdown || []).map((b) => ({ name: statusMeta(b.status).label, value: b.count })),
    [data]
  );

  if (error) return <div className="card p-4 text-red-700">{error}</div>;
  if (!data) return <Spinner />;

  const t = data.totals;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-800">Impact</h1>
        <p className="text-sm text-navy-600">Food rescued through the platform.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat icon={Package} label="Food rescued" value={`${num(t.kg_rescued)} kg`} sub={`${t.servings_rescued} servings`} />
        <Stat icon={Recycle} label="Deliveries" value={t.delivered} sub={`${t.active} active listings`} />
        <Stat icon={Leaf} label="CO₂e avoided" value={`${t.co2_saved_kg} kg`} sub="estimated" />
        <Stat icon={Users} label="People served" value={t.recipients_served} sub={`${t.volunteers_active} volunteers`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card p-4">
          <h2 className="mb-3 font-semibold text-navy-800">Deliveries over time</h2>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.byDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="#D3E0EF" />
                <XAxis dataKey="day" fontSize={11} />
                <YAxis allowDecimals={false} fontSize={11} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="deliveries" stroke="#1E9E5A" strokeWidth={2} />
                <Line type="monotone" dataKey="kg" stroke="#0B2545" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-4">
          <h2 className="mb-3 font-semibold text-navy-800">Listings by status</h2>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={pie}>
                <CartesianGrid strokeDasharray="3 3" stroke="#D3E0EF" />
                <XAxis dataKey="name" fontSize={10} interval={0} angle={-15} textAnchor="end" height={50} />
                <YAxis allowDecimals={false} fontSize={11} />
                <Tooltip />
                <Bar dataKey="value" fill="#0B2545" radius={[4, 4, 0, 0]}>
                  {pie.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card p-4">
        <h2 className="mb-3 font-semibold text-navy-800">Completed deliveries heat map</h2>
        <HeatCluster deliveries={data.deliveries} />
        <p className="mt-2 text-xs text-navy-500">Bubble size scales with quantity rescued at each drop-off point.</p>
      </div>

      <div className="card p-4">
        <h2 className="mb-3 font-semibold text-navy-800">Recent deliveries</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-navy-100 text-xs uppercase text-navy-600">
                <th className="py-2">Donation</th>
                <th className="py-2">Recipient</th>
                <th className="py-2">Kg</th>
                <th className="py-2">CO₂e</th>
                <th className="py-2">Delivered</th>
              </tr>
            </thead>
            <tbody>
              {data.deliveries.map((d) => (
                <tr key={d.id} className="border-b border-navy-50">
                  <td className="py-2 font-medium text-navy-800">{d.title}</td>
                  <td className="py-2">{d.org_name || d.recipient_name}</td>
                  <td className="py-2">{num(d.quantity_kg)}</td>
                  <td className="py-2">{d.co2_saved_kg}</td>
                  <td className="py-2 text-navy-600">{fmtDateTime(d.delivered_at)}</td>
                </tr>
              ))}
              {data.deliveries.length === 0 && (
                <tr><td colSpan={5} className="py-4 text-center text-navy-600">No completed deliveries yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <SafetyDisclaimer />
    </div>
  );
}
