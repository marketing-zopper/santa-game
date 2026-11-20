// Image assets used by the canvas game and the loading screen. Created once at module load, exactly like the
// original script did, so the loader can wait on them. Files are served from /public/assets (original artwork).
const IMG = (n) => { const i = new Image(); i.src = '/assets/' + n + '.webp'; return i; };

export const BG = IMG('bg');
export const PH = [IMG('phone-blue'), IMG('phone-orange')];
export const PH_GOLD = IMG('phone-gold');
export const SHIELD = IMG('shield');

/* Santa with his big red sack (user-supplied art, background removed). The sack's open mouth is the
   catch zone, centred on x. Santa always faces the same way. */
export const SPR = { img: new Image(), w: 900, h: 745, s: 0.21, anchor: 288, bottom: 739 }; // s was 0.1878 in the original; +12% so the sack reads bigger (catch zone is unchanged). anchor = centre of the sack opening, source px
SPR.img.src = '/assets/santa.webp';

export const ok = (i) => i.complete && i.naturalWidth;

/** Resolves when every game image has loaded (or failed — a missing image must not block the game forever). */
export const gameImagesReady = () => Promise.all([SPR.img, BG, PH[0], PH[1], PH_GOLD, SHIELD].map(
  (i) => new Promise((r) => (i.complete && i.naturalWidth ? r() : (i.addEventListener('load', r), i.addEventListener('error', r))))));
