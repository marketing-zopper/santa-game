// Step 4 of the journey: CHOOSE ENTRY MODE — Sign In (WhatsApp OTP) or Play as Guest.
//
// Visual language is the original sign-up sheet (night-sky header with Santa peeking, cream body, the same buttons and
// cards). "Sign In" opens the shared registration + OTP flow (AuthSheet); "Play as Guest" goes straight to Game Home.
import Sheet from '../components/Sheet.jsx';
import { BackIcon, ChatIcon, GuestIcon, PinIcon } from '../components/icons.jsx';
import { CAMPAIGN } from '../lib/campaign.js';

export default function EntryModeScreen({ signInAvailable, onSignIn, onGuest, onBack }) {
  return (
    <Sheet locked>
      <div className="panel headed sheet-panel has-back" role="dialog" aria-labelledby="entryTitle" id="entrySheet">
        <button className="reg-back" id="entryBack" type="button" aria-label="Back" onClick={onBack}><BackIcon /></button>
        <div className="p-head reg-head">
          <img className="reg-santa" src="/assets/santa.webp" alt="" />
          <span className="tag">Zopper Christmas Challenge</span>
          <h2 className="reg-title" id="entryTitle"><i>Choose how</i><span>to play</span></h2>
        </div>
        <div className="p-body">
          <section className="entry-card recommended" aria-label="Sign In">
            <div className="entry-head">
              <span className="entry-ico signin"><ChatIcon /></span>
              <span><b>Sign In</b><small>WhatsApp OTP · Scores saved · Leaderboard &amp; prizes</small></span>
            </div>
            <button className="btn" id="signInBtn" type="button" onClick={onSignIn} disabled={!signInAvailable}><span>Sign In with OTP</span></button>
          </section>

          <section className="entry-card" aria-label="Play as Guest">
            <div className="entry-head">
              <span className="entry-ico guest"><GuestIcon /></span>
              <span><b>Play as Guest</b><small>No score saving · No leaderboard</small></span>
            </div>
            <button className="btn light" id="guestBtn" type="button" onClick={onGuest}>Play as Guest</button>
          </section>

          {!signInAvailable ? <p className="form-err" role="alert">Sign-in isn&rsquo;t available right now. You can still play as a guest.</p> : null}

          <p className="reg-note"><PinIcon />
            <span>Signing in lets Zopper store your name, WhatsApp number, store region and scores (and your city, if you allow it) to run the contest and contact winners.
              {CAMPAIGN.termsUrl ? <> <a href={CAMPAIGN.termsUrl} target="_blank" rel="noopener">Terms</a>.</> : null} Guests aren&rsquo;t tracked and nothing is saved.</span>
          </p>
        </div>
      </div>
    </Sheet>
  );
}
