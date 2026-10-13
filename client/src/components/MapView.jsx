import { useEffect } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import { useMapConfig } from '../lib/mapConfig.js';

function Fit({ points }) {
  const map = useMap();
  useEffect(() => {
    const valid = (points || []).filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (valid.length === 0) return;
    if (valid.length === 1) {
      map.setView(valid[0], 14);
      return;
    }
    map.fitBounds(valid, { padding: [40, 40] });
  }, [JSON.stringify(points), map]);
  return null;
}

export function MapView({
  markers = [],
  polyline = [],
  height = 320,
  center = [12.9716, 77.5946],
  zoom = 12,
  fit = true,
}) {
  const mapConfig = useMapConfig();
  const allPoints = [...markers.map((m) => [m.lat, m.lng]), ...polyline];
  return (
    <div className="overflow-hidden rounded-xl border border-navy-100" style={{ height }}>
      <MapContainer center={center} zoom={zoom} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        {mapConfig && (
          <TileLayer url={mapConfig.tileUrl} attribution={mapConfig.attribution} maxZoom={mapConfig.maxZoom || 19} />
        )}
        {fit && <Fit points={allPoints} />}
        {polyline.length > 1 && <Polyline positions={polyline} pathOptions={{ color: '#1E9E5A', weight: 5, opacity: 0.85 }} />}
        {markers.map((m, i) => (
          <Marker key={`${m.lat}-${m.lng}-${i}`} position={[m.lat, m.lng]} icon={m.icon}>
            {(m.title || m.label) && (
              <Popup>
                <strong>{m.title}</strong>
                {m.label ? <div className="text-xs">{m.label}</div> : null}
              </Popup>
            )}
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

export default MapView;
