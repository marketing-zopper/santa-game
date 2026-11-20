// Optional location for SIGNED-IN players only (shown to organisers as a city on the admin dashboard).
// Asked once, after sign-in, from the Game Home screen. Declining is fine: the game works the same.
// Guests are never asked and nothing about them leaves the device.
export function getLocation() {
  return new Promise((res) => {
    try {
      if (!navigator.geolocation) return res(null);
      navigator.geolocation.getCurrentPosition(
        (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
        () => res(null), { enableHighAccuracy: false, timeout: 9000, maximumAge: 600000 });
    } catch (e) { res(null); }
  });
}

async function cityFor(g) {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${g.lat}&longitude=${g.lng}&localityLanguage=en`, { signal: ctl.signal });
    clearTimeout(t);
    const j = await r.json();
    return { city: j.city || j.locality || null, region: j.principalSubdivision || null, country: j.countryName || null };
  } catch (e) { return {}; }
}

/** { lat, lng, accuracy, city, region, country } or null. */
export async function requestLocation() {
  const g = await getLocation();
  return g ? Object.assign(g, await cityFor(g)) : null;
}
