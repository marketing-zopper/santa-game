// Step 2 of the journey: LOADING. Same progress bar, tips and timing as the original runLoader()
// (min 1.3 s, 4 s asset timeout), and it also waits for the stored sign-in session to be resolved.
import { useEffect, useRef, useState } from 'react';
import { gameImagesReady } from '../game/sprites.js';

const TIPS = ['Warming up the sleigh…', 'Wrapping the phones…', 'Polishing the sack…'];

export default function LoadingScreen({ authReady, onReveal, onGone }) {
  const [pct, setPct] = useState(0);
  const [tip, setTip] = useState(0);
  const [out, setOut] = useState(false);
  const [assetsDone, setAssetsDone] = useState(false);
  const revealed = useRef(false);

  useEffect(() => {
    let alive = true;
    const t0 = performance.now(), timers = [];
    const bump = (to) => alive && setPct((p) => Math.max(p, to));
    const tipT = setInterval(() => setTip((t) => (t + 1) % TIPS.length), 900);
    bump(15);
    const imgReady = gameImagesReady().then(() => bump(60));
    const fontsReady = (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => bump(85));
    const timeout = new Promise((r) => timers.push(setTimeout(r, 4000)));
    Promise.race([Promise.all([imgReady, fontsReady]), timeout]).then(() => {
      const wait = Math.max(0, 1300 - (performance.now() - t0));
      timers.push(setTimeout(() => alive && setAssetsDone(true), wait));
    });
    return () => { alive = false; clearInterval(tipT); timers.forEach(clearTimeout); };
  }, []);

  useEffect(() => {
    if (!assetsDone || !authReady || revealed.current) return undefined;
    revealed.current = true;
    setPct(100);
    onReveal();                                   // route to Intro (new visitor) or Game Home (valid session) underneath
    const t1 = setTimeout(() => setOut(true), 250);
    const t2 = setTimeout(() => onGone(), 750);
    return () => { clearTimeout(t1); clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetsDone, authReady]);

  return (
    <div className={'loader' + (out ? ' out' : '')} id="loader">
      <img className="loader-logo" src="/assets/logo.webp" alt="Ho Ho Ho Merry Catch-mas" />
      <div className="loader-bar" role="progressbar" aria-label="Loading" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i id="loaderFill" style={{ width: pct + '%' }} /></div>
      <p className="loader-tip" id="loaderTip">{TIPS[tip]}</p>
    </div>
  );
}
