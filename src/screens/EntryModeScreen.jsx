// Step 4 of the journey: CHOOSE ENTRY MODE — Sign In (WhatsApp OTP) or Play as Guest.
//
// Visual language is the original sign-up sheet (night-sky header with Santa peeking, cream body, the same buttons and
// cards). "Sign In" opens the shared registration + OTP flow (AuthSheet); "Play as guest" starts a round straight away.
import Sheet from '../components/Sheet.jsx';
import { BackIcon, ChatIcon, FunIcon, PinIcon } from '../components/icons.jsx';
import { CAMPAIGN } from '../lib/campaign.js';

export default function EntryModeScreen({ signInAvailable, onSignIn, onGuest, onBack }) {
  return (
    <Sheet locked>
      <div className="panel headed sheet-panel has-back" role="dialog" aria-labelledby="entryTitle" id="entrySheet">
        <button className="reg-back" id="entryBack" type="button" aria-label="Back" onClick={onBack}><BackIcon /></button>
        <div className="p-head reg-head">
          <img className="reg-santa" src="/assets/santa.webp" alt="" />
          <span className="tag powered">Powered by <img src="/assets/zopper.webp" alt="Zopper" /></span>
          <h2 className="reg-title" id="entryTitle"><i>Choose how</i><span>to play</span></h2>
        </div>
        <div className="p-body">
          <section className="entry-card recommended" aria-label="Play to win">
            <div className="entry-head">
              <span className="entry-ico signin"><ChatIcon /></span>
              <span><b>Play to win</b><small>For Zopper customers · use the number on your Zopper plan</small></span>
            </div>
            <button className="btn" id="signInBtn" type="button" onClick={onSignIn} disabled={!signInAvailable}><span>Sign in with WhatsApp</span></button>
          </section>

          <section className="entry-card" aria-label="Just for fun">
            <div className="entry-head">
              <span className="entry-ico fun"><FunIcon /></span>
              <span><b>Just for fun</b><small>Scores aren&rsquo;t saved</small></span>
            </div>
            <button className="btn light" id="guestBtn" type="button" onClick={onGuest}>Play as guest</button>
          </section>

          {!signInAvailable ? <p className="form-err" role="alert">Sign-in isn&rsquo;t available right now. You can still play as a guest.</p> : null}

          <p className="reg-note"><PinIcon />
            <span>We save your name, number, store region and scores (and city, if you allow it) only to run the contest. Guests aren&rsquo;t tracked.
              {CAMPAIGN.termsUrl ? <> <a href={CAMPAIGN.termsUrl} target="_blank" rel="noopener">Terms</a></> : null}</span>
          </p>
        </div>
      </div>
    </Sheet>
  );
}
