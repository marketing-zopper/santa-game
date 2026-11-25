// Step 5 of the journey: GAME HOME. The original menu (live attract-mode scene underneath, PLAY, How to play).
//
// Mode-specific options:
//   signed-in  → Leaderboard button + "Playing as <name> · Sign out"
//   guest      → NO leaderboard button anywhere; "Playing as Guest · Sign in" instead
import { HelpIcon, LeaderboardIcon, MuteIcon, PlayIcon, TrophyIcon } from '../components/icons.jsx';

export default function HomeScreen({ mode, name, best, muted, busy, onPlay, onHow, onLeaderboard, onMute, onChip }) {
  const signedIn = mode === 'player';
  return (
    <div className="menu" id="startScreen">
      <div className="menu-bar">
        <div className="best-chip glass"><TrophyIcon /><span>Best <b id="menuBest">{best}</b></span></div>
        <button className="round-btn glass" id="menuMute" aria-label="Music and sound on/off" onClick={onMute}><MuteIcon muted={muted} /></button>
      </div>
      <div className="logo">
        <span className="tag dark powered">Powered by <img src="/assets/zopper.webp" alt="Zopper" /></span>
        <img src="/assets/logo.webp" alt="Ho Ho Ho Merry Catch-mas" />
        <div className="logo-sub">Keep every phone safe this Christmas</div>
      </div>
      <div className="menu-actions">
        <button className="btn play" id="playBtn" onClick={onPlay} disabled={busy}><PlayIcon />PLAY</button>
        <div className="menu-row">
          <button className="pill-btn" id="howBtn" onClick={onHow}><HelpIcon />How to play</button>
          {signedIn ? <button className="pill-btn" id="leaderBtn" onClick={onLeaderboard}><LeaderboardIcon />Leaderboard</button> : null}
        </div>
        <button className="player-chip glass" id="playerChip" onClick={onChip}>
          Playing as <b id="playerName">{signedIn ? name : 'Guest'}</b><span>{signedIn ? 'Sign out' : 'Sign in'}</span>
        </button>
      </div>
    </div>
  );
}
