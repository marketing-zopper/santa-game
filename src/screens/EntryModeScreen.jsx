// Step 4 of the journey: CHOOSE ENTRY MODE — Google Sign-In or Play as Guest.
//
// Visual language is the original sign-up sheet (night-sky header with Santa peeking, cream body, the same buttons and
// cards); only the content is new. This replaces the retired name / email / mobile + email-OTP onboarding.
import { useState } from 'react';
import Sheet from '../components/Sheet.jsx';
import { BackIcon, GoogleBadge, GuestIcon, PinIcon } from '../components/icons.jsx';
import { CAMPAIGN } from '../lib/campaign.js';

export default function EntryModeScreen({ googleAvailable, error, onGoogle, onGuest, onBack }) {
  const [busy, setBusy] = useState(false);

  const google = async () => {
    setBusy(true);
    const r = await onGoogle();          // on success the browser leaves for Google; only a failure returns here
    if (r && r.error) setBusy(false);
  };

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
          <section className="entry-card recommended" aria-label="Google Sign-In">
            <div className="entry-head">
              <span className="entry-ico google"><GoogleBadge /></span>
              <span><b>Google Sign-In</b><small>Scores saved · Leaderboard &amp; prizes</small></span>
            </div>
            <button className="btn" id="googleBtn" type="button" onClick={google} disabled={busy || !googleAvailable}>
              <GoogleBadge /><span>{busy ? 'Opening Google…' : 'Sign in with Google'}</span>
            </button>
          </section>

          <section className="entry-card" aria-label="Play as Guest">
            <div className="entry-head">
              <span className="entry-ico guest"><GuestIcon /></span>
              <span><b>Play as Guest</b><small>No score saving · No leaderboard</small></span>
            </div>
            <button className="btn light" id="guestBtn" type="button" onClick={onGuest}>Play as Guest</button>
          </section>

          {error ? <p className="form-err" id="entryErr" role="alert">{error}</p> : null}
          {!googleAvailable && !error ? <p className="form-err" role="alert">Google sign-in isn&rsquo;t available right now. You can still play as a guest.</p> : null}

          <p className="reg-note"><PinIcon />
            <span>Signing in lets Zopper store your name, email, scores and (if you allow it) city to run the contest and contact winners.
              {CAMPAIGN.termsUrl ? <> <a href={CAMPAIGN.termsUrl} target="_blank" rel="noopener">Terms</a>.</> : null} Guests aren&rsquo;t tracked and nothing is saved.</span>
          </p>
        </div>
      </div>
    </Sheet>
  );
}
