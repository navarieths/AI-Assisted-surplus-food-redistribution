import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Save } from 'lucide-react';
import { api } from '../lib/api.js';
import MapPicker from '../components/MapPicker.jsx';
import { ErrorNote, Field, SafetyDisclaimer, Spinner } from '../components/ui.jsx';

function toLocalInput(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function iso(v) {
  return v ? new Date(v).toISOString() : null;
}

const defaults = () => ({
  title: '',
  description: '',
  food_type: 'veg',
  quantity_kg: 5,
  servings: 20,
  prepared_at: toLocalInput(Date.now() - 30 * 60000),
  ready_at: toLocalInput(Date.now() + 30 * 60000),
  pickup_deadline: toLocalInput(Date.now() + 4 * 3600000),
  storage_condition: 'hot',
  allergens: '',
  packaging: '',
  handling_notes: '',
  contact_name: '',
  contact_phone: '',
  location: null,
});

export default function ListingForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const [form, setForm] = useState(defaults);
  const [loading, setLoading] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!editing) return;
    api
      .get(`/listings/${id}`)
      .then(({ listing }) => {
        setForm({
          title: listing.title,
          description: listing.description || '',
          food_type: listing.food_type,
          quantity_kg: listing.quantity_kg,
          servings: listing.servings,
          prepared_at: listing.prepared_at ? toLocalInput(listing.prepared_at) : '',
          ready_at: listing.ready_at ? toLocalInput(listing.ready_at) : '',
          pickup_deadline: listing.pickup_deadline ? toLocalInput(listing.pickup_deadline) : '',
          storage_condition: listing.storage_condition,
          allergens: listing.allergens || '',
          packaging: listing.packaging || '',
          handling_notes: listing.handling_notes || '',
          contact_name: listing.provider?.contact_name || '',
          contact_phone: listing.provider?.phone || '',
          location: { lat: listing.lat, lng: listing.lng, address: listing.address },
        });
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [editing, id]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.location?.lat) {
      setError('Please drop a pin for the pickup location.');
      return;
    }
    setBusy(true);
    const payload = {
      title: form.title,
      description: form.description,
      food_type: form.food_type,
      quantity_kg: Number(form.quantity_kg),
      servings: Number(form.servings),
      prepared_at: iso(form.prepared_at),
      ready_at: iso(form.ready_at),
      pickup_deadline: iso(form.pickup_deadline),
      storage_condition: form.storage_condition,
      allergens: form.allergens,
      packaging: form.packaging,
      handling_notes: form.handling_notes,
      contact_name: form.contact_name,
      contact_phone: form.contact_phone,
      lat: form.location.lat,
      lng: form.location.lng,
      address: form.location.address,
    };
    try {
      const res = editing ? await api.patch(`/listings/${id}`, payload) : await api.post('/listings', payload);
      navigate(`/listings/${res.listing.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <form className="mx-auto max-w-2xl space-y-5" onSubmit={submit}>
      <div>
        <h1 className="text-2xl font-bold text-navy-800">{editing ? 'Edit listing' : 'List surplus food'}</h1>
        <p className="text-sm text-navy-600">Validation runs automatically on save.</p>
      </div>
      <SafetyDisclaimer />

      <div className="card space-y-4 p-5">
        <Field label="Title">
          <input className="input" value={form.title} onChange={(e) => set({ title: e.target.value })} required placeholder="e.g. Veg biryani trays" />
        </Field>
        <Field label="Description">
          <textarea className="input" rows={3} value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="What, how it was prepared and stored, packaging…" />
        </Field>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Food type">
            <select className="input" value={form.food_type} onChange={(e) => set({ food_type: e.target.value })}>
              <option value="veg">Vegetarian</option>
              <option value="nonveg">Non-vegetarian</option>
            </select>
          </Field>
          <Field label="Quantity (kg)">
            <input className="input" type="number" min="0" step="0.5" value={form.quantity_kg} onChange={(e) => set({ quantity_kg: e.target.value })} />
          </Field>
          <Field label="Servings">
            <input className="input" type="number" min="0" value={form.servings} onChange={(e) => set({ servings: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Storage">
            <select className="input" value={form.storage_condition} onChange={(e) => set({ storage_condition: e.target.value })}>
              <option value="hot">Hot</option>
              <option value="chilled">Chilled</option>
              <option value="frozen">Frozen</option>
              <option value="ambient">Ambient</option>
            </select>
          </Field>
          <Field label="Prepared at">
            <input className="input" type="datetime-local" value={form.prepared_at} onChange={(e) => set({ prepared_at: e.target.value })} />
          </Field>
          <Field label="Ready at">
            <input className="input" type="datetime-local" value={form.ready_at} onChange={(e) => set({ ready_at: e.target.value })} />
          </Field>
        </div>
        <Field label="Pickup deadline">
          <input className="input" type="datetime-local" value={form.pickup_deadline} onChange={(e) => set({ pickup_deadline: e.target.value })} required />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Allergens">
            <input className="input" value={form.allergens} onChange={(e) => set({ allergens: e.target.value })} placeholder="e.g. Contains wheat, milk" />
          </Field>
          <Field label="Packaging">
            <input className="input" value={form.packaging} onChange={(e) => set({ packaging: e.target.value })} placeholder="e.g. Sealed trays" />
          </Field>
        </div>
        <Field
          label="Handling & storage instructions"
          hint="How should this food be kept before pickup?"
        >
          <textarea
            className="input"
            rows={2}
            value={form.handling_notes}
            onChange={(e) => set({ handling_notes: e.target.value })}
            placeholder="e.g. Keep above 60°C in insulated containers; do not reheat."
          />
        </Field>
      </div>

      <div className="card space-y-4 p-5">
        <div>
          <h2 className="font-semibold text-navy-800">Pickup contact</h2>
          <p className="text-xs text-navy-600">
            Shared only with authorized participants of an accepted donation.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Contact name">
            <input className="input" value={form.contact_name} onChange={(e) => set({ contact_name: e.target.value })} placeholder="Who should volunteers ask for?" />
          </Field>
          <Field label="Contact phone">
            <input className="input" value={form.contact_phone} onChange={(e) => set({ contact_phone: e.target.value })} placeholder="+91 …" />
          </Field>
        </div>
      </div>

      <div className="card p-5">
        <MapPicker label="Pickup location" value={form.location} onChange={(location) => set({ location })} height={300} />
      </div>

      <ErrorNote>{error}</ErrorNote>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={() => navigate(-1)}>Cancel</button>
        <button className="btn-green" disabled={busy}>
          <Save className="h-4 w-4" /> {busy ? 'Saving…' : editing ? 'Save & re-validate' : 'Create listing'}
        </button>
      </div>
    </form>
  );
}
