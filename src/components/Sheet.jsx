// Modal sheet wrapper (How to play, Leaderboard, Entry mode). Same behaviour as the original .sheet handlers:
// clicking the dimmed backdrop or any [data-close] element closes it, unless the sheet is `locked`.
import { useEffect, useRef } from 'react';

// Keyboard users get focus moved into the dialog; touch / mouse users do not (matches the original `usingKeys` logic).
let usingKeys = false;
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', () => { usingKeys = true; }, true);
  window.addEventListener('pointerdown', () => { usingKeys = false; }, true);
}

export default function Sheet({ onClose, locked = false, children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (usingKeys && ref.current) { const b = ref.current.querySelector('.sheet-x, .reg-back'); if (b) b.focus(); }
  }, []);
  const click = (e) => {
    if (e.target === ref.current && locked) return;
    if (e.target === ref.current || e.target.closest('[data-close]')) onClose && onClose(e.target.closest('[data-play]') ? 'play' : 'close');
  };
  return <div className="sheet" ref={ref} onClick={click}>{children}</div>;
}
