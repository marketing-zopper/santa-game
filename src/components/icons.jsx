// Inline SVG icons — copied verbatim from the original index.html markup.

export const PlayIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.8v16.4a1.2 1.2 0 0 0 1.8 1l13.4-8.2a1.2 1.2 0 0 0 0-2L7.8 2.8A1.2 1.2 0 0 0 6 3.8z" fill="currentColor" /></svg>
);

export const CloseIcon = () => (
  <svg viewBox="0 0 16 16"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
);

export const BackIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

export const ChevronIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 4.5l8 7.5-8 7.5" stroke="currentColor" strokeWidth="3.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

export const PauseIcon = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="3" width="4.2" height="14" rx="1.4" fill="currentColor" /><rect x="11.8" y="3" width="4.2" height="14" rx="1.4" fill="currentColor" /></svg>
);

export const MuteIcon = ({ muted }) => (muted
  ? <svg width="20" height="18" viewBox="0 0 20 18"><path d="M2 6h4l5-4v14l-5-4H2z" fill="currentColor" /><path d="M14 6l5 6M19 6l-5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
  : <svg width="20" height="18" viewBox="0 0 20 18"><path d="M2 6h4l5-4v14l-5-4H2z" fill="currentColor" /><path d="M14 5c2 2 2 6 0 8M16.5 2.5c3.5 3.5 3.5 9.5 0 13" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>);

export const TrophyIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v3h3v2a5 5 0 0 1-5 5h-.3A5 5 0 0 1 13 15.6V18h3v3H8v-3h3v-2.4A5 5 0 0 1 9.3 13H9a5 5 0 0 1-5-5V6h3zm-1 5a3 3 0 0 0 2 2.8V8zm12 0h-1v2.8A3 3 0 0 0 18 8z" fill="#fff" /></svg>
);

export const HelpIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#1EB1E7" /><path d="M9 9.2a3 3 0 0 1 5.9.8c0 2-3 2.3-3 4.3" stroke="#fff" strokeWidth="2.3" fill="none" strokeLinecap="round" /><circle cx="11.9" cy="17.8" r="1.35" fill="#fff" /></svg>
);

export const LeaderboardIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="13" width="5.6" height="9" rx="1.2" fill="#F37230" /><rect x="9.2" y="10" width="5.6" height="12" rx="1.2" fill="#F37230" /><rect x="15.9" y="15" width="5.6" height="7" rx="1.2" fill="#F37230" /><path d="M12 1.5l1.3 2.7 3 .4-2.2 2.1.5 2.9L12 8.2l-2.6 1.4.5-2.9-2.2-2.1 3-.4z" fill="#1EB1E7" /></svg>
);

export const StarIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.9 6.2 6.8.8-5 4.7 1.3 6.7L12 17l-6 3.4 1.3-6.7-5-4.7 6.8-.8z" fill="#FDBA12" /></svg>
);

export const CoalIcon = () => (
  <svg viewBox="0 0 40 36" aria-hidden="true"><path d="M5 17l5-11 13-3 12 8 2 12-9 10-14 1-9-8z" fill="#2B2C40" stroke="#151627" strokeWidth="2" /><circle cx="25" cy="22" r="2.6" fill="#E8414E" /><circle cx="13" cy="21" r="2" fill="#E8414E" /><circle cx="20" cy="12" r="1.6" fill="#E8414E" /><circle cx="12" cy="11" r="2.4" fill="#fff" opacity=".25" /></svg>
);

const CROWN = { 1: '#FDBA12', 2: '#B9BDD6', 3: '#D79A63' };
export const CrownIcon = ({ rank }) => (
  <svg viewBox="0 0 30 24" aria-hidden="true"><path d="M3 7l6.5 5.5L15 3l5.5 9.5L27 7l-2.5 14h-19z" fill={CROWN[rank]} /></svg>
);

/** Google "G" on a white badge, so it keeps its brand colours on any button background. */
export const GoogleBadge = () => (
  <span className="g-badge" aria-hidden="true">
    <svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" /><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z" /><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" /><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" /></svg>
  </span>
);

export const GuestIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="currentColor" /><path d="M4 21a8 8 0 0 1 16 0z" fill="currentColor" /></svg>
);

export const PinIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" fill="currentColor" /></svg>
);
