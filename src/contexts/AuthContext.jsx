// Authentication state for the whole app (Supabase Auth, Google OAuth).
//
//   status:   'loading' | 'signedOut' | 'signedIn'
//   ready:    true once the stored session (or the OAuth redirect result) has been resolved and, for a signed-in
//             player, their profile has been fetched — the loading screen waits for this
//   profile:  { name, best, rank, total, ... } from the database (touch_profile), null for guests / signed-out
//
// Guests are NOT represented here at all: they never authenticate and never get a profile.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { touchProfile } from '../services/gameService.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

/** Reads an OAuth failure Supabase puts in the URL (?error_description=... or #error_description=...) and cleans it up. */
function takeOAuthError() {
  try {
    const q = new URLSearchParams(window.location.search), h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const msg = q.get('error_description') || h.get('error_description') || q.get('error') || h.get('error');
    if (msg) { window.history.replaceState({}, document.title, window.location.pathname); return msg.replace(/\+/g, ' '); }
  } catch (e) { /* ignore */ }
  return null;
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [resolved, setResolved] = useState(!supabase);       // session lookup finished
  const [profile, setProfile] = useState(null);
  const [profileDone, setProfileDone] = useState(!supabase); // profile fetch attempted for the current user
  const [authError, setAuthError] = useState(() => takeOAuthError());
  const uid = session && session.user && session.user.id;

  // 1) restore the stored session / finish the OAuth redirect, then follow auth changes
  useEffect(() => {
    if (!supabase) return undefined;
    let alive = true;
    const guard = setTimeout(() => alive && setResolved(true), 6000);   // never hang the loading screen
    supabase.auth.getSession().then(({ data }) => { if (alive) { setSession(data.session || null); setResolved(true); } })
      .catch(() => alive && setResolved(true));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      // keep this callback synchronous: supabase-js must not be awaited from inside it
      if (!alive) return;
      setSession(s || null); setResolved(true);
      if (s && window.location.search.includes('code=')) window.history.replaceState({}, document.title, window.location.pathname);
    });
    return () => { alive = false; clearTimeout(guard); sub.subscription.unsubscribe(); };
  }, []);

  // 2) when a player is signed in, create / refresh their profile row and load their standing
  useEffect(() => {
    if (!supabase || !resolved) return undefined;
    if (!uid) { setProfile(null); setProfileDone(true); return undefined; }
    setProfileDone(false);                              // (token refreshes keep the same uid, so this does not re-run)
    let alive = true;
    touchProfile().then((p) => alive && setProfile(p)).catch(() => {}).finally(() => alive && setProfileDone(true));
    return () => { alive = false; };
  }, [uid, resolved]);

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) return { error: 'Google sign-in is not configured for this build.' };
    setAuthError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/', queryParams: { prompt: 'select_account' } },
    });
    return { error: error ? error.message : null };
  }, []);

  const signOut = useCallback(async () => {
    if (supabase) { try { await supabase.auth.signOut(); } catch (e) { /* ignore */ } }
    setSession(null); setProfile(null);
  }, []);

  /** Merge fresh standing numbers (after a saved game) into the cached profile. */
  const updateStanding = useCallback((s) => setProfile((p) => ({ ...(p || {}), ...s })), []);
  const refreshProfile = useCallback(() => touchProfile().then(setProfile).catch(() => {}), []);

  const value = useMemo(() => {
    const status = !resolved ? 'loading' : session ? 'signedIn' : 'signedOut';
    const user = session ? session.user : null;
    const meta = (user && user.user_metadata) || {};
    return {
      status, session, user, profile,
      ready: resolved && profileDone,
      displayName: (profile && profile.name) || meta.full_name || meta.name || (user && user.email && user.email.split('@')[0]) || 'Player',
      configured: !!supabase,
      authError, clearAuthError: () => setAuthError(null),
      signInWithGoogle, signOut, updateStanding, refreshProfile,
    };
  }, [resolved, session, profile, profileDone, authError, signInWithGoogle, signOut, updateStanding, refreshProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
