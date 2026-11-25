// Step 3 of the journey: INTRODUCTION — campaign info (how it works, the Device Doctor prize, who is eligible) and,
// once someone has played, their player card (who they are, best score, rank / leaderboard). It doubles as the
// "Main menu": with a player already chosen, the bottom button is Play instead of Continue.
import { useEffect, useRef } from 'react';
import { CAMPAIGN } from '../lib/campaign.js';
import { ChevronIcon, FunIcon, LeaderboardIcon, PlayIcon } from '../components/icons.jsx';

const StoreIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5 5.6 4h12.8L20 9.5a2.6 2.6 0 0 1-4.8 1.3 2.6 2.6 0 0 1-4.4 0 2.6 2.6 0 0 1-4.4 0A2.6 2.6 0 0 1 4 9.5z" fill="#FFD25A" /><path d="M5.5 12.6V20h13v-7.4" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" /><rect x="10" y="15" width="4" height="5" rx=".6" fill="#fff" /></svg>
);

// Preview toggle for the leadership decision: switches the prize option (reloads with ?prize=…). Hidden once locked.
function PrizeToggle() {
  if (CAMPAIGN.prizeLocked) return null;
  const pick = (key) => {
    if (key === CAMPAIGN.prizeOption) return;
    const u = new URL(window.location.href); u.searchParams.set('prize', key); window.location.replace(u.toString());
  };
  return (
    <div className="prize-toggle" role="group" aria-label="Prize option preview">
      <small>Prize option</small>
      {CAMPAIGN.prizeOptions.map(([key, label], i) => (
        <button key={key} type="button" className={key === CAMPAIGN.prizeOption ? 'on' : ''} aria-pressed={key === CAMPAIGN.prizeOption} onClick={() => pick(key)}>
          <b>{String.fromCharCode(65 + i)}</b>{label}
        </button>
      ))}
    </div>
  );
}

// Option A: top 100 win a free Device Doctor plan
function DoctorCard() {
  const p = CAMPAIGN.prize;
  return (
    <section className="ph-card" id="introPrizes" aria-label="Prize">
      <i className="ph-rays" aria-hidden="true" />
      <span className="only-badge">{CAMPAIGN.onlyFor}</span>
      <div className="ph-art" aria-hidden="true">
        <img className="ph-phone p1" src="/assets/phone-orange.webp" alt="" />
        <img className="ph-phone p2" src="/assets/phone-gold.webp" alt="" />
        <img className="ph-phone p3" src="/assets/phone-blue.webp" alt="" />
        <span className="ph-shield"><img src="/assets/shield.webp" alt="" /><i className="ph-plus">+</i></span>
        <span className="ph-sticker">Free<small>1 year</small></span>
      </div>
      <p className="ph-kicker">{p.kicker}</p>
      <h2 className="ph-title">{p.title}</h2>
      <p className="ph-sub">{p.sub}</p>
      <ul className="ph-perks">{p.perks.map((perk) => <li key={perk}>{perk}</li>)}</ul>
    </section>
  );
}

// Option B: top 3 win an iPad / Samsung Galaxy Tab / JBL speaker, shown as a podium (2nd · 1st · 3rd)
function GadgetsCard() {
  const p = CAMPAIGN.prize;
  const order = [p.places[1], p.places[0], p.places[2]];
  return (
    <section className="ph-card gadgets" id="introPrizes" aria-label="Prizes">
      <i className="ph-rays" aria-hidden="true" />
      <span className="only-badge">{CAMPAIGN.onlyFor}</span>
      <p className="ph-kicker gk">{p.kicker}</p>
      <h2 className="ph-title">{p.title}</h2>
      <p className="ph-sub">{p.sub}</p>
      <ol className="podium">
        {order.map((pl) => (
          <li key={pl.place} className={'pod p' + pl.place[0]}>
            <span className="pod-art"><img src={pl.img} alt={pl.name} /></span>
            <span className="pod-name">{pl.name}</span>
            <span className="pod-worth">worth {pl.worth}</span>
            <span className="pod-block"><b>{pl.place}</b></span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PlayerCard({ mode, name, best, rank, total, onLeaderboard, onSignIn, onSignOut }) {
  if (mode === 'player') {
    const inTop = rank && rank <= CAMPAIGN.winners;
    return (
      <section className="player-card signed" aria-label="Your standing">
        <div className="pc-who"><span className="pc-ava">{(name || 'P').slice(0, 1).toUpperCase()}</span>
          <span><b>Hi {String(name || 'there').split(' ')[0]}</b><small>{inTop ? `You’re in the running for ${CAMPAIGN.prize.goal}` : `Break into the top ${CAMPAIGN.winners} to win`}</small></span></div>
        <div className="pc-stats">
          <span><small>Your best</small><b>{best}</b></span>
          <span className={inTop ? 'top' : ''}><small>Rank</small><b>{rank ? `#${rank}` : '–'}{rank && total ? <i>of {total}</i> : null}</b></span>
          <button className="pc-lb" type="button" onClick={onLeaderboard}><LeaderboardIcon />Leaderboard</button>
        </div>
        <button className="pc-link" type="button" onClick={onSignOut}>Not you? Sign out</button>
      </section>
    );
  }
  return (
    <section className="player-card" aria-label="Playing as guest">
      <div className="pc-who"><span className="pc-ava fun"><FunIcon /></span>
        <span><b>Playing as guest</b><small>Your best this visit: <strong>{best}</strong>. Guest scores aren&rsquo;t saved</small></span></div>
      {onSignIn ? <button className="btn pc-signin" type="button" onClick={onSignIn}>Sign in to save &amp; win</button> : null}
    </section>
  );
}

export default function IntroScreen({ mode, name, best, rank, total, onContinue, onPlay, onLeaderboard, onSignIn, onSignOut, busy }) {
  const scroll = useRef(null);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 0; }, []);
  return (
    <div className="intro" id="introScreen">
      <div className="intro-scroll" ref={scroll}>
        <PrizeToggle />
        <div className="intro-hero">
          <span className="tag dark powered">Powered by <img src="/assets/zopper.webp" alt="Zopper" /></span>
          <div className="hero-logo"><img src="/assets/logo.webp" alt="Ho Ho Ho Merry Catch-mas" /></div>
          <p className="intro-sub">Save every phone this Christmas</p>
        </div>
        {CAMPAIGN.prize.style === 'gadgets' ? <GadgetsCard /> : <DoctorCard />}
        {mode ? <PlayerCard mode={mode} name={name} best={best} rank={rank} total={total} onLeaderboard={onLeaderboard} onSignIn={onSignIn} onSignOut={onSignOut} /> : null}
        <section className="intro-card">
          <h2>How it <em>works</em></h2>
          <ol className="how-steps">
            <li><span className="n">1</span><div><b>Play</b><span>Swipe to move Santa and catch every phone before it cracks</span></div><img src="/assets/santa.webp" alt="" /></li>
            <li><span className="n">2</span><div><b>Climb</b><span>Play as often as you like. Your best score counts</span></div><img src="/assets/gauge.webp" alt="" /></li>
            <li><span className="n">3</span><div><b>Win</b><span>{CAMPAIGN.prize.winStep}</span></div><img src="/assets/shield.webp" alt="" style={{ width: 40 }} /></li>
          </ol>
        </section>
        <section className="intro-card elig-card">
          <h2>Who can <em>win</em></h2>
          <p className="prize-elig">{CAMPAIGN.eligibility}</p>
          <div className="eligible-callout" id="becomeEligible">
            <StoreIcon />
            <p><b>{CAMPAIGN.becomeEligible.title}</b>{CAMPAIGN.becomeEligible.text}</p>
          </div>
          <p className="intro-dates" id="introDates">{CAMPAIGN.dates || ''}</p>
          {CAMPAIGN.prize.credit ? <p className="intro-credit">{CAMPAIGN.prize.credit}</p> : null}
        </section>
        <p className="intro-fine"><a id="termsLink" target="_blank" rel="noopener" href={CAMPAIGN.termsUrl || undefined}>Contest terms &amp; conditions</a></p>
      </div>
      <div className="intro-actions">
        {mode
          ? <button className="btn" id="introPlay" onClick={onPlay} disabled={busy}><PlayIcon /><span>Play</span></button>
          : <button className="btn" id="introContinue" onClick={onContinue}><span>Continue</span><ChevronIcon /></button>}
      </div>
    </div>
  );
}
