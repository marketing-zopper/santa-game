// The four Croma regions — exactly these, in this order. Mirrors public.regions in the database
// (a foreign key there guarantees nothing else can ever be stored). Used by the registration form and the admin filters.
export const REGIONS = ['Croma East Region', 'Croma South Region', 'Croma North Region', 'Croma West Region'];

export const isRegion = (v) => REGIONS.includes(v);

/** Label for records that have no Croma region (historical Google players — never assigned a made-up region). */
export const LEGACY_REGION_LABEL = 'Legacy / unknown';
