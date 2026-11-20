// How to play — original sheet, verbatim content.
import Sheet from '../components/Sheet.jsx';
import { CloseIcon, CoalIcon, PlayIcon } from '../components/icons.jsx';

export default function HowToPlaySheet({ onClose }) {
  return (
    <Sheet onClose={onClose}>
      <div className="panel sheet-panel" role="dialog" aria-labelledby="howTitle">
        <button className="close-x sheet-x" data-close aria-label="Close"><CloseIcon /></button>
        <div className="how-head">
          <span className="tag light">Santa's Safe Catch</span>
          <h2 className="ttl" id="howTitle">How to <em>Play</em></h2>
          <p className="sub">Catch the phones, keep them safe, and survive as long as you can!</p>
        </div>
        <ol className="how-steps">
          <li><span className="n">1</span><div><b>Move Santa</b><span>Swipe left and right anywhere on the screen to move Santa.</span></div><img src="/assets/santa.webp" alt="" /></li>
          <li><span className="n">2</span><div><b>Catch the phones</b><span>Catch the falling phones in Santa's sack before they hit the ground and crack.</span></div><img src="/assets/phone-tilt.webp" alt="" style={{ width: 40 }} /></li>
          <li><span className="n">3</span><div><b>Survive &amp; score</b><span>It gets faster every few seconds, and each phone is worth more. Keep going!</span></div><img src="/assets/gauge.webp" alt="" /></li>
        </ol>
        <div className="divider">Items</div>
        <div className="items">
          <div className="ph"><img src="/assets/phone-orange.webp" alt="" /><span><b>Phone</b><small>Points</small></span></div>
          <div className="gd"><img src="/assets/phone-gold.webp" alt="" /><span><b>Gold Phone</b><small>4× points</small></span></div>
          <div className="co"><CoalIcon /><span><b>Coal</b><small>Lose a life</small></span></div>
          <div className="sh"><img src="/assets/shield.webp" alt="" /><span><b>Zopper Shield</b><small>Extra life</small></span></div>
        </div>
        <p className="note">You have 3 lives. Dropping a phone or catching coal costs one.</p>
        <button className="btn" data-close data-play><PlayIcon />Let's Go</button>
      </div>
    </Sheet>
  );
}
