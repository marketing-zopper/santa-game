// Authentication state for the whole app (Supabase Auth — WhatsApp OTP via Phone Auth).
//
//   status:   'loading'      session lookup / profile fetch in progress
//             'signedOut'    no session
//             'needsProfile' phone verified by OTP, registration (name + Croma region) not finished yet
//             'signedIn'     verified player with a profile — scores are saved, leaderboard available
//   ready:    true once the stored session has been resolved and, for a signed-in player, the profile fetched
//   profile:  { name, region, best, rank, total, … } from the database (touch_profile), null for guests / signed-out
//
// Guests are NOT represented here at all: they never authenticate and never get a profile.
// (Historical Google players who still hold a valid session keep working as "signedIn" legacy players; there is no
//  player-facing Google sign-in any more.)
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { touchProfile } from '../services/gameService.js';
import { completeRegistration as completeRegistrationRpc } from '../services/otpAuth.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [resolved, setResolved] = useState(!supabase);       // session lookup finished
  const [profile, setProfile] = useState(null);
  const [profileDone, setProfileDone] = useState(!supabase); // profile fetch attempted for the current user
  const version = useRef(0);                                 // newest profile write wins (a slow touch_profile must not undo a registration)
  const uid = session && session.user && session.user.id;

  // 1) restore the stored session, then follow auth changes
  useEffect(() => {
    if (!supabase) return undefined;
    let alive = true;
    const guard = setTimeout(() => alive && setResolved(true), 6000);   // never hang the loading screen
    supabase.auth.getSession().then(({ data }) => { if (alive) { setSession(data.session || null); setResolved(true); } })
      .catch(() => alive && setResolved(true));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!alive) return;                                    // keep this callback synchronous: supabase-js must not be awaited from inside it
      setSession(s || null); setResolved(true);
    });
    return () => { alive = false; clearTimeout(guard); sub.subscription.unsubscribe(); };
  }, []);

  // 2) when someone is signed in, load their profile / standing
  useEffect(() => {
    if (!supabase || !resolved) return undefined;
    if (!uid) { version.current++; setProfile(null); setProfileDone(true); return undefined; }
    setProfileDone(false);                                   // (token refreshes keep the same uid, so this does not re-run)
    const mine = ++version.current;
    let alive = true;
    touchProfile().then((p) => { if (alive && mine === version.current) setProfile(p); }).catch(() => {})
      .finally(() => { if (alive && mine === version.current) setProfileDone(true); });
    return () => { alive = false; };
  }, [uid, resolved]);

  const signOut = useCallback(async () => {
    if (supabase) { try { await supabase.auth.signOut(); } catch (e) { /* ignore */ } }
    version.current++;
    setSession(null); setProfile(null);
  }, []);

  /** Finish registration (new player) or restore the existing profile (returning player). Returns the profile row. */
  const completeRegistration = useCallback(async (name, region) => {
    const p = await completeRegistrationRpc(name, region);
    version.current++;                                       // supersede any touch_profile still in flight
    setProfile(p); setProfileDone(true);
    return p;
  }, []);

  /** Merge fresh standing numbers (after a saved game) into the cached profile. */
  const updateStanding = useCallback((s) => setProfile((p) => ({ ...(p || {}), ...s })), []);
  const refreshProfile = useCallback(() => touchProfile().then((p) => { version.current++; setProfile(p); }).catch(() => {}), []);

  const value = useMemo(() => {
    const user = session ? session.user : null;
    const meta = (user && user.user_metadata) || {};
    let status;
    if (!resolved) status = 'loading';
    else if (!session) status = 'signedOut';
    else if (!profileDone) status = 'loading';
    else if (profile && profile.registered === false) status = 'needsProfile';
    else status = 'signedIn';                                // (also when the profile fetch failed offline: a valid session still counts)
    return {
      status, session, user, profile,
      ready: resolved && profileDone,
      displayName: (profile && profile.name) || meta.full_name || meta.name || 'Player',
      region: (profile && profile.region) || null,
      configured: !!supabase,
      signOut, completeRegistration, updateStanding, refreshProfile,
    };
  }, [resolved, session, profile, profileDone, signOut, completeRegistration, updateStanding, refreshProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
