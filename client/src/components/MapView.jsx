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
  polylines = [],
  height = 320,
  center = [12.9716, 77.5946],
  zoom = 12,
  fit = true,
  colors = ['#1E9E5A', '#0B2545', '#E0A800', '#2563EB', '#DB2777'],
}) {
  const mapConfig = useMapConfig();
  const routes = polylines.length ? polylines : polyline.length > 1 ? [polyline] : [];
  const validMarkers = markers.filter((marker) => Number.isFinite(marker?.lat) && Number.isFinite(marker?.lng));
  const validRoutes = routes
    .map((route) => route.filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])))
    .filter((route) => route.length > 1);
  const allPoints = [...validMarkers.map((marker) => [marker.lat, marker.lng]), ...validRoutes.flat()];
  return (
    <div className="overflow-hidden rounded-xl border border-navy-100" style={{ height }}>
      <MapContainer center={center} zoom={zoom} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        {mapConfig && (
          <TileLayer url={mapConfig.tileUrl} attribution={mapConfig.attribution} maxZoom={mapConfig.maxZoom || 19} />
        )}
        {fit && <Fit points={allPoints} />}
        {validRoutes.map((pts, i) => (
          <Polyline
            key={`route-${i}`}
            positions={pts}
            pathOptions={{ color: colors[i % colors.length], weight: 4, opacity: 0.8 }}
          />
        ))}
        {validMarkers.map((m, i) => (
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
