// Campaign content shown on the intro screen (ported from the CAMPAIGN block in the original index.html).
// The original marked the prizes / dates as TODO placeholders; they are unchanged here. Override per deployment with
// the VITE_* variables in .env (see .env.example) — no code change needed.
const env = import.meta.env;

export const CAMPAIGN = {
  knowMoreUrl: env.VITE_KNOW_MORE_URL || 'https://www.zopper.com',   // TODO: replace with the campaign page
  termsUrl: env.VITE_TERMS_URL || '',                                // TODO: contest T&Cs page (link hidden until set)
  dates: env.VITE_CAMPAIGN_DATES || 'Challenge runs till 31 December 2026. Winners announced in January.',   // TODO: confirm dates
  prizes: [                                                          // TODO: real prizes
    { title: 'Grand prize', note: 'For the #1 player on the leaderboard' },
    { title: 'Second prize', note: 'For the #2 player' },
    { title: 'Third prize', note: 'For the #3 player' },
  ],
};
