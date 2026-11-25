// Leaderboard — original sheet. Rendered ONLY for signed-in players (the caller guards it, and the database RPC behind
// it refuses anyone who isn't signed in, so guests can't reach this data either way).
import { useEffect, useState } from 'react';
import Sheet from '../components/Sheet.jsx';
import { CloseIcon, CrownIcon, PlayIcon, StarIcon } from '../components/icons.jsx';
import { fetchLeaderboard } from '../services/gameService.js';
import { CAMPAIGN } from '../lib/campaign.js';

export default function LeaderboardSheet({ onClose }) {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let alive = true;
    fetchLeaderboard().then((r) => alive && setState({ data: r }))
      .catch((e) => alive && setState({ error: e.offline ? "Can't load the leaderboard right now." : e.message }));
    return () => { alive = false; };
  }, []);

  const d = state.data, me = d && d.me;
  return (
    <Sheet onClose={onClose}>
      <div className="panel headed sheet-panel" role="dialog" aria-labelledby="lbTitle">
        <button className="close-x on-dark sheet-x" data-close aria-label="Close"><CloseIcon /></button>
        <div className="p-head">
          <h2 className="ttl" id="lbTitle">Leader<em>board</em></h2>
          <p>{CAMPAIGN.prize.heroLine}</p>
        </div>
        <div className="p-body">
          {me ? (
            <div className={'lb-mine' + (me.rank <= CAMPAIGN.winners ? ' running' : '')} id="lbMine">
              <div className="lb-mine-row">
                <span className="badge">#{me.rank}</span>
                <span className="who"><small>You</small><b>{me.name}</b></span>
                <span className="pts"><StarIcon />{me.best}</span>
              </div>
              <p className="lb-status" id="lbStatus">
                {me.rank <= CAMPAIGN.winners
                  ? <><b>You&rsquo;re in the running!</b> Stay in the top {CAMPAIGN.winners} till 31 January to win</>
                  : <><b>{me.rank - CAMPAIGN.winners} places to the prize zone.</b> Climb into the top {CAMPAIGN.winners} to win</>}
              </p>
            </div>
          ) : null}
          <div className="lb-cols" aria-hidden="true"><span>Rank</span><span style={{ paddingLeft: 16 }}>Player</span><span>Score</span></div>
          <ol className="lb-list" id="lbList">
            {state.loading ? <li className="lb-empty">Loading the top players…</li> : null}
            {state.error ? <li className="lb-empty">{state.error}</li> : null}
            {d && !d.top.length ? <li className="lb-empty">No scores yet. Be the first on the board!</li> : null}
            {d && d.top.map((p) => (
              <li key={p.rank} className={[p.rank <= 3 ? 'r' + p.rank : '', me && me.rank === p.rank ? 'me' : ''].join(' ').trim() || undefined}>
                <span className="rk">{p.rank <= 3 ? <CrownIcon rank={p.rank} /> : null}{p.rank}</span>
                <span className="nm">{p.name}</span><span className="sc">{p.score}</span>
              </li>
            ))}
          </ol>
          {d && d.total > d.top.length ? <p className="lb-more">{d.total} players in the challenge · prize zone is the top {CAMPAIGN.winners}</p> : null}
          <p className="note">Your best score counts. Prizes are only for Zopper customers. {CAMPAIGN.dates}</p>
          <button className="btn" data-close data-play><PlayIcon />Play now</button>
        </div>
      </div>
    </Sheet>
  );
}
