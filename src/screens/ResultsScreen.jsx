// Step 8 of the journey: RESULTS — current-round performance.
//
//   signed-in → rank / personal best from the server in a gold prize card, Play again + Leaderboard
//   guest     → gold prize card (CAMPAIGN.prize.headline) with "Sign in to win" (NO leaderboard until they authenticate)
//
// Layout: festive header (reaction line that depends on the score, the score counting up, relaxed Santa, twinkling
// sparkles) → stat chips → prize card → Play again → slim Zopper line → "Main menu" text link.
import { useEffect, useState } from 'react';
import { CrownIcon, PlayIcon } from '../components/icons.jsx';
import { CAMPAIGN } from '../lib/campaign.js';

// a short, playful reaction to the round (sentence case, brand voice)
function reaction(score, isBest) {
  if (isBest && score > 0) return 'New personal best!';
  if (score === 0) return 'Butterfingers!';
  if (score < 150) return 'Good start!';
  if (score < 400) return 'Nice catch!';
  if (score < 800) return 'Sleigh-tastic!';
  return 'Santa’s MVP!';
}

// the score rolls up from 0 (skipped for people who prefer reduced motion)
function useCountUp(target, ms = 900) {
  const reduce = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [v, setV] = useState(reduce ? target : 0);
  useEffect(() => {
    if (reduce || !target) { setV(target); return undefined; }
    let raf, t0;
    const step = (t) => { t0 = t0 || t; const k = Math.min(1, (t - t0) / ms); setV(Math.round(target * (1 - Math.pow(1 - k, 3)))); if (k < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, reduce]);
  return v;
}

const ClockIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="#3FB5E8" /><path d="M12 7v5.2l3.4 2" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

// the gold card: prize pitch for guests, standing for signed-in players, plain status for the edge cases
function PrizeCard({ result, prevBest, onSignIn }) {
  const plain = (title, sub) => (
    <div className="res-card plain" id="result"><b>{title}</b>{sub ? <span>{sub}</span> : null}</div>
  );
  if (result.kind === 'guest') {
    return (
      <div className="res-card gold" id="result">
        <div className="res-card-top"><CrownIcon rank={1} /><b>{CAMPAIGN.prize.headline}</b></div>
        <span>For Zopper customers. This round wasn&rsquo;t saved, so sign in with your Zopper plan number and your next score counts</span>
        <span className="res-elig"><b>{CAMPAIGN.becomeEligible.title}</b> {CAMPAIGN.becomeEligible.text}</span>
        {/* the finished round stays a guest round — signing in only applies to NEW games */}
        {onSignIn ? <button className="btn" id="resultSignInBtn" onClick={onSignIn}>Sign in to win</button> : null}
      </div>
    );
  }
  if (result.kind === 'practice') return plain('Practice round', 'We couldn’t reach the server, so this score wasn’t saved');
  if (result.kind === 'saving') return plain('Saving your score…');
  if (result.kind === 'offline') return plain('Score saved on this phone', 'The network dropped. We’ll send it to the leaderboard next time you open the game');
  if (result.kind === 'error') return plain('Couldn’t save this score', result.message);
  const r = result.data;
  if (r.flagged) return plain('Round not counted', `We couldn’t verify this round, so it doesn’t count towards your best. Your best is still ${r.best}`);
  const top = r.rank && r.rank <= CAMPAIGN.winners;
  return (
    <div className={'res-card gold' + (top ? ' top' : '')} id="result">
      <div className="res-card-top"><CrownIcon rank={1} />
        {r.rank ? <b className="res-rank">#{r.rank}<small>of {r.total} players</small></b> : <b>Your leaderboard rank</b>}
      </div>
      <span>{top ? `You’re in the top ${CAMPAIGN.winners} for ${CAMPAIGN.prize.goal}. Hold on to it!`
        : `Break into the top ${CAMPAIGN.winners} to win ${CAMPAIGN.prize.goal}`}</span>
    </div>
  );
}

export default function ResultsScreen({ mode, round, onAgain, onHome, onLeaderboard, onSignIn }) {
  const signedIn = mode === 'player';
  const { summary, result, prevBest, best } = round;
  const isBest = summary.score > 0 && summary.score > prevBest && (prevBest > 0 || signedIn);
  const shown = useCountUp(summary.score);
  return (
    <div className="screen" id="overScreen">
      <div className="panel headed res-panel" role="dialog" aria-labelledby="overTitle">
        <div className="p-head res-head">
          <i className="spark s1" /><i className="spark s2" /><i className="spark s3" /><i className="spark s4" />
          <span className="tag" id="overTitle">Round results</span>
          <h2 className="res-react">{reaction(summary.score, isBest)}</h2>
          <div className="res-score" id="finalScore" aria-label={`Your score: ${summary.score}`}>{shown}</div>
          <p className="res-pts">points</p>
          <img className="res-santa" src="/assets/santa-relax.webp" alt="" />
        </div>
        <div className="p-body">
          <div className="res-stats">
            <span><img src="/assets/phone-blue.webp" alt="" /><b id="stCaught">{summary.caught}</b><small>phones saved</small></span>
            <span><ClockIcon /><b id="stTime">{Math.floor(summary.t)}s</b><small>time</small></span>
            <span><CrownIcon rank={1} /><b id="stBest">{best}</b><small>your best</small></span>
          </div>
          <PrizeCard result={result} prevBest={prevBest} onSignIn={onSignIn} />
          <div className="btn-stack">
            <button className="btn" id="againBtn" onClick={onAgain}><PlayIcon />Play again</button>
            {signedIn ? <button className="btn light" id="resultLeaderBtn" onClick={onLeaderboard}>Leaderboard</button> : null}
          </div>
          <p className="res-promo"><img src="/assets/shield.webp" alt="" /><span>Real phones crack too. Protect yours with <b>Zopper</b></span></p>
          <button className="res-link" id="homeBtn" onClick={onHome}>Main menu</button>
        </div>
      </div>
    </div>
  );
}
