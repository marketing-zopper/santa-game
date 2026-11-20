// Paused overlay — original markup.
import { CloseIcon } from '../components/icons.jsx';

export default function PauseScreen({ onResume, onQuit }) {
  return (
    <div className="screen" id="pauseScreen">
      <div className="panel mid" role="dialog" aria-labelledby="pauseTitle">
        <button className="close-x" id="pauseX" aria-label="Resume" onClick={onResume}><CloseIcon /></button>
        <img className="relax" src="/assets/santa-relax.webp" alt="" />
        <h2 className="ttl" id="pauseTitle">Game <em>Paused</em></h2>
        <p className="sub">Jump back in when you're ready</p>
        <div className="btn-stack" style={{ marginTop: 8 }}>
          <button className="btn" id="resumeBtn" onClick={onResume}>Resume</button>
          <button className="btn light" id="quitBtn" onClick={onQuit}>End Game</button>
        </div>
      </div>
    </div>
  );
}
