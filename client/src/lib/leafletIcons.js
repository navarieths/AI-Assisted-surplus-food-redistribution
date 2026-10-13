import L from 'leaflet';

/** Fix Leaflet's default icon paths under Vite bundling. */
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });

function pin(color, { size = 28, ring = false } = {}) {
  return L.divIcon({
    className: '',
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
      background:${color};border:2px solid white;box-shadow:0 2px 6px rgba(11,37,69,.45);
      display:flex;align-items:center;justify-content:center">
      ${ring ? `<div style="width:8px;height:8px;border-radius:50%;background:white"></div>` : ''}
    </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  });
}

export const pickupIcon = pin('#1E9E5A', { ring: true });
export const dropIcon = pin('#0B2545', { ring: true });
export const volunteerIcon = L.divIcon({
  className: '',
  html: `<div style="font-size:20px;line-height:20px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))">🚚</div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});
export const pinIcon = pin('#0B2545');
export const searchIcon = pin('#1E9E5A');

export default L;
