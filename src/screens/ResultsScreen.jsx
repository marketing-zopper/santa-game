// Step 8 of the journey: RESULTS — current-round performance.
//
//   signed-in → "Score synced" result (rank / personal best from the server), Play again + Leaderboard
//   guest     → "not saved" note, Play again + "Sign In with OTP" (NO leaderboard button until they authenticate)
// The panel is the original game-over panel (score, result card, stats, Zopper promo).
import { PlayIcon } from '../components/icons.jsx';

function ResultBox({ result, score, prevBest }) {
  if (result.kind === 'guest') {
    return (
      <div className="result" id="result">
        <div className="r-title">Guest round</div>
        <div className="r-sub">This round isn't saved. Want to save your future scores and climb the leaderboard? Sign in to compete!</div>
      </div>
    );
  }
  if (result.kind === 'practice') {
    return (
      <div className="result" id="result">
        <div className="r-title">Practice round</div>
        <div className="r-sub">We couldn't reach the server, so this score wasn't saved.</div>
      </div>
    );
  }
  if (result.kind === 'saving') return <div className="result" id="result"><div className="r-title">Saving your score…</div></div>;
  if (result.kind === 'offline') {
    return (
      <div className="result" id="result">
        <div className="r-title">Score saved on this phone</div>
        <div className="r-sub">The network dropped. We'll send it to the leaderboard automatically next time you open the game.</div>
      </div>
    );
  }
  if (result.kind === 'error') {
    return <div className="result" id="result"><div className="r-title">Couldn't save this score</div><div className="r-sub">{result.message}</div></div>;
  }
  // saved
  const r = result.data;
  if (r.flagged) {
    return (
      <div className="result" id="result">
        <div className="r-title">Round not counted</div>
        <div className="r-sub">We couldn't verify this round, so it doesn't count towards your best. Your best is still {r.best}.</div>
      </div>
    );
  }
  const pb = r.score > 0 && r.score >= r.best && r.score > prevBest;
  return (
    <div className={'result' + (pb ? ' pb' : '')} id="result">
      <div className="r-title">{pb ? 'New personal best!' : 'Your leaderboard rank'}</div>
      {r.rank ? <div className="r-rank">#{r.rank}<small>of {r.total}</small></div> : null}
      <div className="r-sub">Your best: {r.best}. Top players when the campaign ends win prizes.</div>
    </div>
  );
}

export default function ResultsScreen({ mode, round, onAgain, onHome, onLeaderboard, onSignIn }) {
  const signedIn = mode === 'player';
  const { summary, result, prevBest, best } = round;
  return (
    <div className="screen" id="overScreen">
      <div className="panel mid" role="dialog" aria-labelledby="overTitle">
        <span className="tag light" id="overTitle">Round results</span>
        <p className="final-lbl">Your score</p>
        <div className="final" id="finalScore">{summary.score}</div>
        <ResultBox result={result} score={summary.score} prevBest={prevBest} />
        <div className="stats">
          <span>Phones saved<b id="stCaught">{summary.caught}</b></span>
          <span>Time<b id="stTime">{Math.floor(summary.t)}s</b></span>
          <span>Best<b id="stBest">{best}</b></span>
        </div>
        <p className="promo"><img src="/assets/shield.webp" alt="" /><span>Real phones crack too. Ask the store team about <em>Zopper</em> phone protection plans.</span></p>
        <div className="btn-stack">
          <button className="btn" id="againBtn" onClick={onAgain}><PlayIcon />Play again</button>
          {signedIn ? (
            <div className="btn-row">
              <button className="btn light" id="resultLeaderBtn" onClick={onLeaderboard}>Leaderboard</button>
              <button className="btn light" id="homeBtn" onClick={onHome}>Main menu</button>
            </div>
          ) : (
            <>
              {/* guest: the finished round stays a guest round — signing in only applies to NEW games */}
              <button className="btn light" id="resultSignInBtn" onClick={onSignIn}>Sign In with OTP</button>
              <button className="btn light" id="homeBtn" onClick={onHome}>Main menu</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
