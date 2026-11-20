// Step 3 of the journey: INTRODUCTION. Original intro page (how it works, prizes, Know more, T&Cs).
// "Continue" now leads to the Entry Mode choice instead of the old sign-up form.
import { useEffect, useRef } from 'react';
import { CAMPAIGN } from '../lib/campaign.js';
import { ChevronIcon, CrownIcon } from '../components/icons.jsx';

export default function IntroScreen({ onContinue }) {
  const scroll = useRef(null);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 0; }, []);
  return (
    <div className="intro" id="introScreen">
      <div className="intro-scroll" ref={scroll}>
        <div className="intro-hero">
          <span className="tag dark">Zopper Christmas Challenge</span>
          <img src="/assets/logo.webp" alt="Santa's Safe Catch" />
          <p className="intro-sub">Catch falling phones, climb the leaderboard and win Christmas prizes.</p>
        </div>
        <section className="intro-card">
          <h2>How it <em>works</em></h2>
          <ol className="how-steps">
            <li><span className="n">1</span><div><b>Play</b><span>Swipe left and right to move Santa and catch the phones in his sack before they crack.</span></div><img src="/assets/santa.webp" alt="" /></li>
            <li><span className="n">2</span><div><b>Climb</b><span>Play as many times as you like. Your best score goes on the leaderboard.</span></div><img src="/assets/gauge.webp" alt="" /></li>
            <li><span className="n">3</span><div><b>Win</b><span>The top players when the challenge ends win prizes from Zopper.</span></div><img src="/assets/shield.webp" alt="" style={{ width: 40 }} /></li>
          </ol>
        </section>
        <section className="intro-card">
          <h2>Prizes</h2>
          <ul className="prize-list" id="introPrizes">
            {CAMPAIGN.prizes.map((p, i) => (
              <li key={p.title}><CrownIcon rank={Math.min(i + 1, 3)} /><span><b>{p.title}</b><small>{p.note}</small></span></li>
            ))}
          </ul>
          <p className="intro-dates" id="introDates">{CAMPAIGN.dates || ''}</p>
        </section>
        <p className="intro-fine"><a id="termsLink" target="_blank" rel="noopener" href={CAMPAIGN.termsUrl || undefined}>Contest terms &amp; conditions</a></p>
      </div>
      <div className="intro-actions">
        <a className="btn light" id="knowMore" target="_blank" rel="noopener" href={CAMPAIGN.knowMoreUrl || undefined}>Know more</a>
        <button className="btn" id="introContinue" onClick={onContinue}><span>Continue</span><ChevronIcon /></button>
      </div>
    </div>
  );
}
