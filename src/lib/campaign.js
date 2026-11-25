// Campaign content shown on the intro, entry, leaderboard and results screens. Override per deployment with the
// VITE_* variables in .env (see .env.example) — no code change needed.
//
// Campaign: a Zopper branding / POS engagement game in partner stores. Anyone can play; prizes go to the top players on the
// leaderboard who already own a Zopper plan. The game has no access to plan records, so eligibility is checked when
// winners are picked, by matching the WhatsApp number a player signed in with to a Zopper plan purchase.
//
// Two prize options (for the leadership decision), switchable without a code change:
//   doctor   (default)  top 100 win a free Device Doctor plan
//   gadgets             top 3 win an iPad / Samsung Galaxy Tab / JBL speaker
// Pick one with ?prize=gadgets (or ?prize=doctor) in the URL, or lock it per deployment with VITE_PRIZE_OPTION.
// Once leadership decides, set VITE_PRIZE_OPTION and the URL switch can be removed.
const env = import.meta.env;

const PRIZE_OPTIONS = {
  doctor: {
    winners: 100,
    style: 'doctor',
    heroLine: 'The top 100 Zopper customers win a free Device Doctor plan',
    winStep: 'Zopper customers in the top 100 get a free Device Doctor plan',
    headline: 'Top 100 win a free Device Doctor plan',
    goal: 'a free Device Doctor plan',
    kicker: 'The top 100 win a',
    title: 'Free Device Doctor plan',
    sub: 'A full year of care for up to 5 out-of-warranty devices and appliances at home',
    // benefits as listed on zopper.com/sonovision-plans/device-doctor-plan
    perks: [
      'Unlimited free technician visits',
      'Up to 20% off spare parts',
      '90-day warranty on repaired parts',
      'Brand-authorised service centres',
    ],
  },
  gadgets: {
    winners: 3,
    style: 'gadgets',
    heroLine: 'The top 3 Zopper customers win an iPad, a Samsung Galaxy Tab or a JBL speaker',
    winStep: 'Finish in the top 3 to win prizes worth up to ₹50,000',
    headline: 'Top 3 win prizes worth up to ₹50,000',
    goal: 'a prize worth up to ₹50,000',
    kicker: 'Prizes worth ₹90,000',
    title: 'Win big this Christmas',
    sub: 'The top 3 Zopper customers on the leaderboard take home these prizes',
    // product photos: Wikimedia Commons, screens recoloured + backgrounds removed (licences require this credit)
    credit: 'Product photos via Wikimedia Commons: iPad by Zach Vega (CC BY-SA 3.0), Galaxy Tab by AnVuong1222004 (CC BY-SA 4.0), JBL speaker by Trougnouf (CC BY 4.0); edited',
    places: [
      { place: '1st', name: 'iPad', worth: '₹50,000', img: '/assets/prizes/ipad.webp' },
      { place: '2nd', name: 'Samsung Galaxy Tab', worth: '₹30,000', img: '/assets/prizes/galaxy-tab.webp' },
      { place: '3rd', name: 'JBL speaker', worth: '₹10,000', img: '/assets/prizes/jbl-speaker.webp' },
    ],
  },
};

const fromUrl = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('prize') : null;
const option = PRIZE_OPTIONS[fromUrl] ? fromUrl : PRIZE_OPTIONS[env.VITE_PRIZE_OPTION] ? env.VITE_PRIZE_OPTION : 'doctor';
const prize = PRIZE_OPTIONS[option];

export const CAMPAIGN = {
  knowMoreUrl: env.VITE_KNOW_MORE_URL || 'https://www.zopper.com/sonovision-plans/device-doctor-plan',
  termsUrl: env.VITE_TERMS_URL || '',                                // TODO: contest T&Cs page (link hidden until set)
  dates: env.VITE_CAMPAIGN_DATES || 'Challenge runs till 31 January 2027. Winners announced on 1 February 2027',
  prizeOption: option,
  // the on-page preview toggle (for the leadership decision) shows until an option is locked with VITE_PRIZE_OPTION
  prizeLocked: !!PRIZE_OPTIONS[env.VITE_PRIZE_OPTION],
  prizeOptions: [['doctor', 'Device Doctor plan'], ['gadgets', 'iPad · Tab · Speaker']],
  winners: prize.winners,
  prize,
  onlyFor: 'Only for Zopper customers',
  eligibility: 'Anyone can play, but prizes are only for Zopper customers. To win, sign in with the mobile number on your Zopper plan',
  // shown wherever the prize is pitched: how a non-customer becomes eligible
  becomeEligible: {
    title: 'Not a Zopper customer yet?',
    text: 'Ask your store manager about Zopper Care to protect your device and become eligible to win',
  },
};
