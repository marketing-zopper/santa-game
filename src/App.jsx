// Application shell: the approved user journey as a small state machine, and the bridge to the imperative game.
//
//   QR → LOADING → INTRODUCTION → CHOOSE ENTRY MODE ─┬─ Google Sign-In ─┐
//                                                    └─ Play as Guest ──┴→ GAME HOME → START GAME (countdown + play)
//   → GAME OVER → RESULTS ─┬─ Play again
//                          └─ Leaderboard (signed-in players ONLY)
//
//   stage: 'loading' | 'intro' | 'entry' | 'home' | 'playing' | 'paused' | 'gameover' | 'results'
//
// Mode is derived, never stored: signed in (Supabase session) → 'google'; chose guest → 'guest'; otherwise none.
// A valid stored session skips Intro/Entry and lands on Game Home. Guests live in memory only — a refresh starts over.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import { ToastProvider, useToast } from './contexts/ToastContext.jsx';
import { GameController } from './game/GameController.js';
import { startSession, finishSession, queuePending, flushPending, pending } from './services/gameService.js';
import { requestLocation } from './services/location.js';
import { store } from './lib/storage.js';
import Hud from './components/Hud.jsx';
import LoadingScreen from './screens/LoadingScreen.jsx';
import IntroScreen from './screens/IntroScreen.jsx';
import EntryModeScreen from './screens/EntryModeScreen.jsx';
import HomeScreen from './screens/HomeScreen.jsx';
import HowToPlaySheet from './screens/HowToPlaySheet.jsx';
import LeaderboardSheet from './screens/LeaderboardSheet.jsx';
import PauseScreen from './screens/PauseScreen.jsx';
import ResultsScreen from './screens/ResultsScreen.jsx';

const PLAYER_STAGES = ['home', 'playing', 'paused', 'gameover', 'results'];
const HUD_STAGES = ['playing', 'paused', 'gameover'];

function GameApp() {
  const auth = useAuth();
  const toast = useToast();
  const signedIn = auth.status === 'signedIn';

  const [stage, setStage] = useState('loading');
  const [loaderGone, setLoaderGone] = useState(false);
  const [guest, setGuest] = useState(false);
  const [sheet, setSheet] = useState(null);              // null | 'how' | 'leader'
  const [hud, setHud] = useState({ score: 0, lives: 3 });
  const [popKey, setPopKey] = useState(0);
  const [banner, setBanner] = useState(null);
  const [count, setCount] = useState(null);
  const [muted, setMuted] = useState(false);
  const [memBest, setMemBest] = useState(0);             // best of this visit, in memory only (the only "best" a guest ever has)
  const [round, setRound] = useState(null);              // { summary, result, prevBest, best } shown on the Results screen
  const [busy, setBusy] = useState(false);

  const mode = signedIn ? 'google' : guest ? 'guest' : null;
  const bestNow = Math.max(signedIn ? (auth.profile && auth.profile.best) || 0 : 0, memBest);

  // latest values for callbacks that outlive a render (the game controller, async work)
  const live = useRef({});
  live.current = { signedIn, bestNow, stage, authError: auth.authError, user: auth.user, muted };
  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const roundRef = useRef(null);                         // { session, practice, prevBest } for the round in progress
  const startingRef = useRef(false);
  const geoRef = useRef(null);
  const geoAsked = useRef(false);
  const overTimer = useRef(null);
  const handlers = useRef({});

  /* ---------- the imperative game: created once, destroyed on unmount ---------- */
  useEffect(() => {
    const g = new GameController(canvasRef.current, {
      onHud: (h) => setHud(h),
      onBanner: (b) => setBanner({ ...b, key: Math.random() }),
      onCount: (n) => setCount(n ? { n, key: Math.random() } : null),
      onScorePop: () => setPopKey((k) => k + 1),
      onPause: () => setStage('paused'),
      onResume: () => setStage('playing'),
      onGameOver: (s) => handlers.current.gameOver(s),
    });
    g.setMuted(live.current.muted);
    gameRef.current = g;
    // Test-only hook: exists ONLY in builds made with --mode e2e (VITE_E2E=1). Constant-folded away in production.
    if (import.meta.env.VITE_E2E === '1') window.__ssc = { game: g };
    return () => { clearTimeout(overTimer.current); g.destroy(); gameRef.current = null; if (import.meta.env.VITE_E2E === '1') delete window.__ssc; };
  }, []);

  useEffect(() => { if (gameRef.current) gameRef.current.setMuted(muted); }, [muted]);
  // a signed-in player's sound preference is remembered on this device; a guest's is not (no guest data is persisted)
  useEffect(() => { if (signedIn) setMuted(store.get('ssc-muted') === '1'); }, [signedIn]);
  const toggleMute = () => {
    const next = !muted; setMuted(next);
    if (signedIn) store.set('ssc-muted', next ? '1' : '0');
    if (gameRef.current) gameRef.current.unlockAudio();
  };

  /* ---------- journey guards ---------- */
  // loader finished → Game Home for a valid session, otherwise the Introduction (or back to Entry if Google just failed)
  const reveal = useCallback(() => {
    const l = live.current;
    setStage(l.signedIn ? 'home' : l.authError ? 'entry' : 'intro');
  }, []);
  // arriving back from Google (or any sign-in) while on Intro / Entry → Game Home
  useEffect(() => { if (signedIn && (stage === 'intro' || stage === 'entry')) setStage('home'); }, [signedIn, stage]);
  // player-only screens need a signed-in player or a guest; otherwise start from the Introduction
  useEffect(() => { if (!signedIn && !guest && PLAYER_STAGES.includes(stage) && auth.status !== 'loading') setStage('intro'); }, [signedIn, guest, stage, auth.status]);
  // the leaderboard is for signed-in players only
  useEffect(() => { if (!signedIn && sheet === 'leader') setSheet(null); }, [signedIn, sheet]);
  // signing out clears the visit's in-memory best
  useEffect(() => { if (!signedIn) return; return () => setMemBest(0); }, [signedIn]);
  // behind the menus Santa plays by himself
  useEffect(() => {
    const g = gameRef.current;
    if (g && (stage === 'intro' || stage === 'entry' || stage === 'home') && g.state !== 'menu') g.goMenu();
  }, [stage]);
  useEffect(() => {
    if (!sheet) return undefined;
    const k = (e) => { if (e.key === 'Escape') setSheet(null); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [sheet]);

  /* ---------- signed-in extras on Game Home: retry unsent scores, ask for location once ---------- */
  useEffect(() => {
    if (stage !== 'home' || !signedIn || !auth.user) return;
    const uid = auth.user.id;
    if (pending(uid).length) flushPending(uid).then(() => auth.refreshProfile());
    if (!geoAsked.current) { geoAsked.current = true; requestLocation().then((g) => { geoRef.current = g; }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, signedIn, auth.user]);

  /* ---------- starting a round ---------- */
  const startRound = useCallback(async () => {
    if (startingRef.current || !gameRef.current) return;
    startingRef.current = true; setBusy(true);
    const g = gameRef.current;
    g.unlockAudio(); setSheet(null);
    let seed = null, session = null, practice = !live.current.signedIn;
    if (live.current.signedIn) {
      // signed-in: the SERVER issues the seed (and a session) so the finished game can be verified
      try { const r = await startSession(); session = r.sessionId; seed = r.seed; }
      catch (e) {
        if (e.status === 401) {
          startingRef.current = false; setBusy(false); await auth.signOut(); setStage('entry'); toast('Please sign in again.'); return;
        }
        practice = true;
        toast(e.offline ? "Can't reach the server. This is a practice round and won't be saved." : e.message);
      }
    }
    // guests (and practice rounds) use a local seed: no session, no network, nothing stored
    if (seed == null) seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
    roundRef.current = { session, practice, prevBest: live.current.bestNow };
    startingRef.current = false; setBusy(false);
    clearTimeout(overTimer.current);
    setHud({ score: 0, lives: 3 }); setPopKey(0); setBanner(null); setCount(null); setRound(null);
    setStage('playing');
    g.begin(seed);
  }, [auth, toast]);

  /* ---------- game over → results ---------- */
  handlers.current.gameOver = (summary) => {
    const r = roundRef.current || { session: null, practice: true, prevBest: 0 };
    const isSignedIn = live.current.signedIn;
    setStage('gameover');                                // step 7: GAME OVER (HUD stays, "Game over" banner)
    setBanner({ title: 'Game over', sub: 'You ran out of lives', key: Math.random() });
    setMemBest((b) => Math.max(b, summary.score));
    const kind = !isSignedIn ? 'guest' : r.practice || !r.session ? 'practice' : 'saving';
    setRound({ summary, prevBest: r.prevBest, best: Math.max(r.prevBest, summary.score), result: { kind } });
    clearTimeout(overTimer.current);
    overTimer.current = setTimeout(() => setStage((s) => (s === 'gameover' ? 'results' : s)), 900);   // → step 8: RESULTS

    if (kind !== 'saving') return;                       // guests / practice rounds: nothing is sent anywhere
    const uid = live.current.user.id, geo = geoRef.current;
    const payload = {
      sessionId: r.session, inputs: summary.inputs, endTick: summary.tick, clientScore: summary.score,
      ...(geo ? { lat: geo.lat, lng: geo.lng, accuracy: geo.accuracy, city: geo.city, region: geo.region, country: geo.country } : {}),
    };
    roundRef.current = { ...r, session: null };          // the session is consumed exactly once
    const update = (patch) => setRound((cur) => (cur && cur.summary === summary ? { ...cur, ...patch } : cur));
    finishSession(payload).then((res) => {
      setMemBest(res.best || 0);
      auth.updateStanding({ best: res.best, rank: res.rank, total: res.total });
      update({ result: { kind: 'saved', data: res }, best: res.best || 0 });
    }).catch((e) => {
      if (e.offline) queuePending(uid, payload);         // retried automatically next time Game Home opens
      update({ result: e.offline ? { kind: 'offline' } : { kind: 'error', message: e.message } });
    });
  };

  /* ---------- navigation actions ---------- */
  const goHome = () => { if (gameRef.current) gameRef.current.goMenu(); clearTimeout(overTimer.current); setRound(null); setSheet(null); setStage('home'); };
  const chooseGuest = () => { setGuest(true); setStage('home'); };
  const onChip = async () => {
    if (signedIn) { setGuest(false); await auth.signOut(); setStage('entry'); }   // sign out first, or the "signed in on Entry → Home" guard would bounce us
    else setStage('entry');                              // guest → offered the entry choice again (can sign in)
  };
  const closeSheet = (kind) => { if (kind === 'play') startRound(); else setSheet(null); };

  return (
    <>
      <canvas id="game" ref={canvasRef} aria-label="Game area: move Santa to catch falling phones in his sack" />

      {HUD_STAGES.includes(stage) ? (
        <Hud score={hud.score} lives={hud.lives} best={bestNow} popKey={popKey} muted={muted}
          onMute={toggleMute} onPause={() => gameRef.current && gameRef.current.pause()} />
      ) : null}
      {banner && HUD_STAGES.includes(stage) ? <div id="banner" className="show" key={banner.key}>{banner.title}<small>{banner.sub}</small></div> : null}
      {count && stage === 'playing' ? <div id="count" className="tick" key={count.key}>{count.n}</div> : null}

      {stage === 'intro' || stage === 'entry' ? <IntroScreen onContinue={() => { if (gameRef.current) gameRef.current.unlockAudio(); setStage('entry'); }} /> : null}
      {stage === 'entry' ? (
        <EntryModeScreen googleAvailable={auth.configured} error={auth.authError}
          onGoogle={auth.signInWithGoogle} onGuest={chooseGuest} onBack={() => { auth.clearAuthError(); setStage('intro'); }} />
      ) : null}

      {stage === 'home' && mode ? (
        <HomeScreen mode={mode} name={auth.displayName} best={bestNow} muted={muted} busy={busy}
          onPlay={startRound} onHow={() => setSheet('how')} onLeaderboard={() => signedIn && setSheet('leader')}
          onMute={toggleMute} onChip={onChip} />
      ) : null}

      {sheet === 'how' ? <HowToPlaySheet onClose={closeSheet} /> : null}
      {sheet === 'leader' && signedIn ? <LeaderboardSheet onClose={closeSheet} /> : null}

      {stage === 'paused' ? <PauseScreen onResume={() => gameRef.current && gameRef.current.resume()} onQuit={() => gameRef.current && gameRef.current.quit()} /> : null}
      {stage === 'results' && round && mode ? (
        <ResultsScreen mode={mode} round={round} onAgain={startRound} onHome={goHome} onLeaderboard={() => signedIn && setSheet('leader')} />
      ) : null}

      {!loaderGone ? <LoadingScreen authReady={auth.ready} onReveal={reveal} onGone={() => setLoaderGone(true)} /> : null}
      <div id="rotate"><p>Turn your phone upright to play</p></div>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <div id="app">
        <ToastProvider>
          <GameApp />
        </ToastProvider>
      </div>
    </AuthProvider>
  );
}
