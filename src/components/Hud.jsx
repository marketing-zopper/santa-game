// In-game HUD: score, best, lives, sound and pause. Updated only when the score / lives actually change
// (the GameController reports changes; nothing here runs per animation frame).
import { MuteIcon, PauseIcon } from './icons.jsx';

export default function Hud({ score, lives, best, popKey, muted, onMute, onPause }) {
  return (
    <div id="hud">
      <div className="score-box">
        {/* the key restarts the CSS "pop" animation on every catch */}
        <div className={'score' + (popKey ? ' pop' : '')} key={popKey} id="score">{score}</div>
        <div className="next glass">Your best <b id="hudBest">{Math.max(best, score)}</b></div>
      </div>
      <div className="right">
        <div className="lives" id="lives" aria-label="Lives">
          {[0, 1, 2].map((i) => <img key={i} src="/assets/shield.webp" alt="" className={i < lives ? '' : 'lost'} />)}
        </div>
        <div className="hud-btns">
          <button className="icon-btn glass" id="muteBtn" aria-label="Sound on/off" onClick={onMute}><MuteIcon muted={muted} /></button>
          <button className="icon-btn glass" id="pauseBtn" aria-label="Pause" onClick={onPause}><PauseIcon /></button>
        </div>
      </div>
    </div>
  );
}
