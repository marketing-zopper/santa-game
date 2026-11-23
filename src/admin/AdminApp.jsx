// Admin dashboard (React port of the original admin.html — same panels, tabs, filters, CSV export and disqualify action).
//
// Authorisation is no longer a shared password: you sign in with Google (Supabase Auth) and the `admin` Edge Function
// only answers accounts whose verified email is listed in public.admin_users. Everything is re-checked on the server.
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, SUPABASE_URL, SUPABASE_KEY } from '../lib/supabase.js';
import { REGIONS } from '../lib/regions.js';
import { formatIndianMobile } from '../lib/phone.js';

const nf = new Intl.NumberFormat('en-IN');
const dt = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const LIMIT = 50;

class AdminError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

async function adminFetch(qs, opts = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session && data.session.access_token;
  if (!token) throw new AdminError('Please sign in again', 401);
  const r = await fetch(`${SUPABASE_URL}/functions/v1/admin?${qs}`, {
    ...opts, headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new AdminError(j.error || 'Request failed', r.status);
  }
  return r;
}
const adminJson = async (qs, opts) => (await adminFetch(qs, opts)).json();

const GoogleDot = () => (
  <span className="g-dot" aria-hidden="true">
    <svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" /><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z" /><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" /><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" /></svg>
  </span>
);

/* ---------- login / access screens ---------- */
function LoginCard({ error }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(error);
  const go = async () => {
    setBusy(true); setErr(null);
    const { error: e } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + '/admin', queryParams: { prompt: 'select_account' } } });
    if (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <section id="login">
      <div className="login-card">
        <h1>Santa's Safe Catch<br />Admin</h1>
        <p>Sign in with the Google account that has been given admin access.</p>
        {err ? <p className="err">{err}</p> : null}
        <button className="btn" onClick={go} disabled={busy}><GoogleDot />{busy ? 'Opening Google…' : 'Sign in with Google'}</button>
      </div>
    </section>
  );
}

function NoAccess({ email, message, onSignOut }) {
  return (
    <section id="login">
      <div className="login-card">
        <h1>No admin access</h1>
        <p className="who">{email}</p>
        <p>{message}</p>
        <p>Ask an existing admin to add this email to <b>admin_users</b>, or sign in with a different account.</p>
        <button className="btn" onClick={onSignOut}>Sign out</button>
      </div>
    </section>
  );
}

/* ---------- charts ---------- */
function BarChart({ rows, field, label }) {
  const [hover, setHover] = useState(null);
  const W = 360, H = 150, padL = 28, padB = 18, n = rows.length || 1;
  const max = Math.max(1, ...rows.map((r) => r[field]));
  const nice = max <= 5 ? 5 : Math.ceil(max / 5) * 5;
  const bw = (W - padL) / n, gap = 2;
  const y = (v) => (H - padB) - (v / nice) * (H - padB - 8);
  const lab = (i) => new Date(rows[i].day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const hr = hover != null ? rows[hover] : null;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} per day`}>
        {[0, nice / 2, nice].map((t) => (
          <g key={t}><line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--line)" /><text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--muted)">{nf.format(t)}</text></g>
        ))}
        {rows.map((r, i) => {
          const v = r[field], x = padL + i * bw + gap / 2, h = (H - padB) - y(v), w = Math.max(1, bw - gap);
          const yy = y(v), rad = Math.min(4, w / 2, h);
          const path = h > 0 ? `M${x},${H - padB} V${yy + rad} Q${x},${yy} ${x + rad},${yy} H${x + w - rad} Q${x + w},${yy} ${x + w},${yy + rad} V${H - padB} Z` : '';
          return (
            <g className="b" key={r.day} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
              <rect x={padL + i * bw} y="0" width={bw} height={H - padB} fill="transparent" />
              {path ? <path d={path} fill={hover === i ? 'var(--bar-hover)' : 'var(--bar)'} /> : null}
            </g>
          );
        })}
        {rows.length ? <>
          <text x={padL} y={H - 3} fontSize="10" fill="var(--muted)">{lab(0)}</text>
          <text x={W} y={H - 3} textAnchor="end" fontSize="10" fill="var(--muted)">{lab(rows.length - 1)}</text>
        </> : null}
      </svg>
      {hr ? <div className="tip" style={{ left: ((padL + (hover + 0.5) * bw) / W * 100) + '%', top: (y(hr[field]) / H * 100) + '%' }}>{`${lab(hover)} · ${nf.format(hr[field])} ${label.toLowerCase()}`}</div> : null}
    </div>
  );
}

const Kpi = ({ lbl, val, sub, warn }) => (
  <div className={'kpi' + (warn ? ' warn' : '')}><span className="lbl">{lbl}</span><span className="val">{val}</span><span className="sub">{sub || ' '}</span></div>
);

/* ---------- table definitions ---------- */
const Loc = ({ r }) => {
  const city = r.city || r.ip_city || '';
  const src = r.location_source === 'gps' ? <span className="pill gps">GPS</span> : <span className="pill net">Network</span>;
  return <>{city} {city || r.lat != null ? src : null}{r.lat != null ? <> <a href={`https://www.google.com/maps?q=${r.lat},${r.lng}`} target="_blank" rel="noopener">Map</a></> : null}</>;
};
const EmailCell = ({ r }) => <>{r.email || '–'} {r.verified ? <span className="pill gps" title="Verified (WhatsApp OTP or Google)">Verified</span> : <span className="pill net">Not verified</span>}</>;
const PhoneCell = ({ r }) => (r.phone ? formatIndianMobile(r.phone) : '–');
// Historical Google players have no Croma region: shown as "Legacy", never given a made-up one
const RegionCell = ({ r }) => (r.region ? r.region : <span className="pill net" title="Signed in with Google before regions existed">Legacy</span>);

const COLS = {
  leaderboard: [
    ['#', (r) => <span className="rank">{r.rank}</span>, 'num'],
    ['Prize rank', (r) => (r.official_rank ? <span className="prize-rank">#{r.official_rank}</span> : <span className="pill net">–</span>), 'num'],
    ['Name', (r) => r.display_name], ['Phone', (r) => <PhoneCell r={r} />], ['Region', (r) => <RegionCell r={r} />], ['Email', (r) => <EmailCell r={r} />],
    ['Best', (r) => nf.format(r.best_score), 'num'], ['Reached', (r) => dt(r.best_at)], ['Games', (r) => r.games_played, 'num'],
    ['Location', (r) => <Loc r={r} />], ['', null, 'act'],
  ],
  players: [
    ['Joined', (r) => dt(r.created_at)], ['Name', (r) => r.display_name], ['Phone', (r) => <PhoneCell r={r} />], ['Region', (r) => <RegionCell r={r} />], ['Email', (r) => <EmailCell r={r} />],
    ['Thank-you email', (r) => (r.thanks_sent_at ? 'Sent ' + dt(r.thanks_sent_at) : '–')],
    ['Best', (r) => nf.format(r.best_score), 'num'], ['Rank', (r) => r.rank || '–', 'num'], ['Games', (r) => r.games_played, 'num'],
    ['Last played', (r) => dt(r.last_seen_at)], ['Location', (r) => <Loc r={r} />], ['', null, 'act'],
  ],
  games: [
    ['When', (r) => dt(r.created_at)], ['Player', (r) => <>{r.display_name}{r.verified ? '' : <> <span className="pill net">Not verified</span></>}</>],
    ['Phone', (r) => <PhoneCell r={r} />], ['Region', (r) => <RegionCell r={r} />], ['Score', (r) => nf.format(r.score), 'num'],
    ['Length', (r) => (r.duration_s != null ? Math.round(r.duration_s) + 's' : ''), 'num'], ['Phones caught', (r) => r.phones_caught, 'num'],
    ['Check', (r) => (r.flagged ? <span className="pill flag" title={r.flag_reason}>Flagged</span> : r.flag_reason ? <span className="pill net" title={r.flag_reason}>Note</span> : 'OK')],
    ['Location', (r) => <>{r.city || r.ip_city || ''}{r.lat != null ? <> <a href={`https://www.google.com/maps?q=${r.lat},${r.lng}`} target="_blank" rel="noopener">Map</a></> : null}</>],
  ],
};

/* ---------- dashboard ---------- */
function Dashboard({ email, onSignOut, onAuthLost }) {
  const [stats, setStats] = useState(null);
  const [updated, setUpdated] = useState('');
  const [tab, setTab] = useState('leaderboard');
  const [verified, setVerified] = useState('all');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [flagOnly, setFlagOnly] = useState(false);
  const [region, setRegion] = useState('all');          // 'all' | 'legacy' | one of the four Croma regions
  const [player, setPlayer] = useState(null);            // { id, name } — Games tab filtered to one player
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState({ rows: [], total: 0, kind: null });   // `kind` = which tab these rows belong to
  const [confirmId, setConfirmId] = useState(null);
  const [error, setError] = useState('');
  const confirmTimer = useRef(null);

  const handle = useCallback((e) => { if (e.status === 401 || e.status === 403) onAuthLost(e.message); else setError(e.message); }, [onAuthLost]);

  const loadStats = useCallback(() => adminJson('action=stats').then((s) => { setStats(s); setUpdated('Updated ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })); }).catch(handle), [handle]);

  useEffect(() => { loadStats(); const t = setInterval(() => { if (!document.hidden) loadStats(); }, 60000); return () => clearInterval(t); }, [loadStats]);
  useEffect(() => { const t = setTimeout(() => { setQ(search.trim()); setOffset(0); }, 300); return () => clearTimeout(t); }, [search]);

  const qs = useCallback((extra) => {
    const p = new URLSearchParams({ action: tab, limit: LIMIT, offset, q, verified, region });
    if (tab === 'games' && flagOnly) p.set('flagged', '1');
    if (tab === 'games' && player) p.set('player', player.id);
    for (const k in extra || {}) p.set(k, extra[k]);
    return p.toString();
  }, [tab, offset, q, verified, region, flagOnly, player]);

  const seq = useRef(0);   // only the most recent table request may update the screen (responses can arrive out of order)
  const loadTable = useCallback(() => {
    const mine = ++seq.current;
    return adminJson(qs()).then((d) => { if (mine === seq.current) { setData({ ...d, kind: tab }); setError(''); } }).catch((e) => { if (mine === seq.current) handle(e); });
  }, [qs, tab, handle]);
  useEffect(() => { loadTable(); }, [loadTable]);

  const selectTab = (t) => { setTab(t); setOffset(0); if (t !== 'games') setPlayer(null); };
  const refresh = () => { loadStats(); loadTable(); };

  const disqualify = async (id, value) => {
    if (value && confirmId !== id) { setConfirmId(id); clearTimeout(confirmTimer.current); confirmTimer.current = setTimeout(() => setConfirmId(null), 3000); return; }
    setConfirmId(null);
    try { await adminJson('action=disqualify', { method: 'POST', body: JSON.stringify({ id, value }) }); loadTable(); loadStats(); } catch (e) { handle(e); }
  };
  useEffect(() => () => clearTimeout(confirmTimer.current), []);

  const exportCsv = async () => {
    try {
      const blob = await (await adminFetch(qs({ action: 'export', type: tab }))).blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `santa-safe-catch-${tab}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    } catch (e) { handle(e); }
  };

  const exportRegions = async () => {
    try {
      const blob = await (await adminFetch('action=export&type=regions')).blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `santa-safe-catch-regions-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    } catch (e) { handle(e); }
  };

  // Never render another tab's rows under this tab's columns/actions (a stale games row has a game id, not a player id).
  const fresh = data.kind === tab, rows = fresh ? data.rows : [];
  const s = stats, cols = COLS[tab], total = fresh ? data.total : 0;
  const gpsPct = s && s.players ? Math.round(s.located_gps / s.players * 100) : 0;
  const maxCity = s ? Math.max(1, ...s.by_city.map((c) => c.players)) : 1;
  const actions = (r) => (
    <>
      <button className="linkbtn" onClick={() => { setPlayer({ id: r.id, name: r.display_name }); setTab('games'); setOffset(0); setSearch(''); }}>Games</button> ·{' '}
      {r.disqualified
        ? <button className="linkbtn" onClick={() => disqualify(r.id, false)}>Reinstate</button>
        : <button className="linkbtn danger" onClick={() => disqualify(r.id, true)}>{confirmId === r.id ? 'Tap again to confirm' : 'Disqualify'}</button>}
    </>
  );

  return (
    <div id="appView">
      <header><div className="wrap hbar">
        <h1>Santa's Safe Catch<small>Admin</small></h1>
        <span className="updated">{updated}</span>
        <button className="btn ghost" onClick={refresh}>Refresh</button>
        <button className="btn ghost" onClick={onSignOut} title={email}>Sign out</button>
      </div></header>

      <main className="wrap">
        <section className="kpis" aria-label="Summary">
          {s ? <>
            <Kpi lbl="Players" val={nf.format(s.players)} sub={`+${nf.format(s.players_today)} today · ${nf.format(s.verified || 0)} verified`} />
            <Kpi lbl="Games played" val={nf.format(s.games)} sub={`+${nf.format(s.games_today)} today`} />
            <Kpi lbl="Top score" val={nf.format(s.top_score)} sub="Current #1" />
            <Kpi lbl="Average score" val={nf.format(s.avg_score)} sub="Per game" />
            <Kpi lbl="GPS location shared" val={gpsPct + '%'} sub={`${nf.format(s.located_gps)} of ${nf.format(s.players)} players`} />
            <Kpi lbl="Emails sent" val={nf.format(s.emails_sent || 0)} sub={s.emails_failed ? `${nf.format(s.emails_failed)} failed` : `${nf.format(s.thanks_sent || 0)} thank-you emails`} warn={s.emails_failed > 0} />
            <Kpi lbl="Flagged games" val={nf.format(s.flagged_games)} sub={s.flagged_games ? 'Review in the Games tab' : 'Nothing suspicious'} warn={s.flagged_games > 0} />
          </> : null}
        </section>

        <section className="grid3">
          <div className="panel"><h2>New players</h2><p className="hint">Per day, last 30 days</p>{s ? <BarChart rows={s.by_day} field="players" label="Players" /> : <div className="chart" />}</div>
          <div className="panel"><h2>Games played</h2><p className="hint">Per day, last 30 days</p>{s ? <BarChart rows={s.by_day} field="games" label="Games" /> : <div className="chart" />}</div>
          <div className="panel"><h2>Players by city</h2><p className="hint">GPS city, or network city when location was denied</p>
            <ul className="cities">
              {s && s.by_city.length ? s.by_city.map((c) => (
                <li key={c.city}><span className="nm" title={c.city}>{c.city}</span><span className="bar" style={{ width: (c.players / maxCity) * 100 + '%' }} /><span className="n">{nf.format(c.players)}</span></li>
              )) : <li className="empty">No players yet</li>}
            </ul>
          </div>
        </section>

        <section className="panel" id="regionReport">
          <div className="hbar" style={{ padding: 0, marginBottom: 8 }}>
            <div style={{ marginRight: 'auto' }}><h2 style={{ margin: 0 }}>Region-wise performance</h2><p className="hint" style={{ margin: 0 }}>Games are counted in the region the player was registered in <b>when they played</b>. Valid = not flagged.</p></div>
            <button className="btn ghost" id="exportRegions" onClick={exportRegions}>Export region report</button>
          </div>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Region</th><th className="num">Registered players</th><th className="num">Total games</th><th className="num">Valid games</th><th className="num">Average score</th><th className="num">Highest score</th></tr></thead>
              <tbody>
                {s ? s.by_region.map((r) => (
                  <tr key={r.region}><td>{r.region}</td><td className="num">{nf.format(r.players)}</td><td className="num">{nf.format(r.games)}</td><td className="num">{nf.format(r.valid_games)}</td><td className="num">{nf.format(r.avg_score)}</td><td className="num">{nf.format(r.top_score)}</td></tr>
                )) : <tr><td className="empty" colSpan={6}>Loading…</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel" id="dataPanel">
          <div className="tabs" role="tablist">
            {[['leaderboard', 'Leaderboard'], ['players', 'All players'], ['games', 'Games']].map(([k, label]) => (
              <button key={k} className="tab" role="tab" aria-selected={tab === k} onClick={() => selectTab(k)}>{label}</button>
            ))}
          </div>
          <div className="toolbar">
            <div className="seg" role="group" aria-label="Show players">
              {[['all', 'All', s && s.players], ['yes', 'Verified', s && s.verified], ['no', 'Not verified', s && s.players - s.verified]].map(([v, label, n]) => (
                <button type="button" key={v} aria-pressed={verified === v} onClick={() => { setVerified(v); setOffset(0); }}>{label} <span>{s ? nf.format(n || 0) : ''}</span></button>
              ))}
            </div>
            <label>Region <select id="regionFilter" aria-label="Region" value={region} onChange={(e) => { setRegion(e.target.value); setOffset(0); }}>
              <option value="all">All regions</option>
              {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              <option value="legacy">Legacy / unknown</option>
            </select></label>
            <input type="search" placeholder="Search name, phone, email or city" aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
            {tab === 'games' ? <label><input type="checkbox" checked={flagOnly} onChange={(e) => { setFlagOnly(e.target.checked); setOffset(0); }} /> Flagged only</label> : null}
            {tab === 'games' && player ? <span>Showing games for <b>{player.name}</b> <button className="linkbtn" onClick={() => { setPlayer(null); setOffset(0); }}>Show all</button></span> : null}
            <button className="btn" onClick={exportCsv}>Export CSV</button>
          </div>
          {tab === 'leaderboard' && verified !== 'yes' ? <p className="tbl-note">Only verified players count for prizes. The prize rank is shown next to each verified player; unverified players are listed for reference only.</p> : null}
          {error ? <p className="err">{error}</p> : null}
          <div className="tablewrap">
            <table>
              <thead><tr>{cols.map((c, i) => <th key={i} className={c[2] || ''}>{c[0]}</th>)}</tr></thead>
              <tbody>
                {rows.length ? rows.map((r) => (
                  <tr key={r.id} className={r.disqualified ? 'dq' : ''}>
                    {cols.map((c, i) => <td key={i} className={c[2] || ''}>{c[1] ? c[1](r) : actions(r)}</td>)}
                  </tr>
                )) : <tr><td className="empty" colSpan={cols.length}>{!fresh ? 'Loading…' : q ? 'No matches.' : 'Nothing here yet.'}</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <span>{total ? `${offset + 1}–${Math.min(offset + LIMIT, total)} of ${nf.format(total)}` : ''}</span>
            <button className="btn ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>Previous</button>
            <button className="btn ghost" disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)}>Next</button>
          </div>
        </section>
      </main>
    </div>
  );
}

/* ---------- shell: sign-in → access check → dashboard ---------- */
export default function AdminApp() {
  const [session, setSession] = useState(undefined);     // undefined = still checking
  const [access, setAccess] = useState({ state: 'checking' });

  useEffect(() => {
    if (!supabase) { setSession(null); return undefined; }
    let alive = true;
    supabase.auth.getSession().then(({ data }) => alive && setSession(data.session || null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { if (alive) setSession(s || null); });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  const uid = session && session.user.id;
  useEffect(() => {
    if (!uid) { setAccess({ state: 'checking' }); return undefined; }
    let alive = true;
    adminJson('action=whoami').then((j) => alive && setAccess({ state: 'ok', email: j.email }))
      .catch((e) => alive && setAccess({ state: e.status === 403 ? 'denied' : 'error', message: e.message }));
    return () => { alive = false; };
  }, [uid]);

  const signOut = () => supabase.auth.signOut();

  if (!supabase) return <LoginCard error="This build has no Supabase configuration (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY)." />;
  if (session === undefined) return <section id="login"><div className="login-card"><p>Loading…</p></div></section>;
  if (!session) return <LoginCard />;
  if (access.state === 'checking') return <section id="login"><div className="login-card"><p>Checking access…</p></div></section>;
  if (access.state === 'denied') return <NoAccess email={session.user.email} message={access.message} onSignOut={signOut} />;
  if (access.state === 'error') return <NoAccess email={session.user.email} message={`Couldn't reach the server: ${access.message}`} onSignOut={signOut} />;
  return <Dashboard email={access.email} onSignOut={signOut} onAuthLost={(m) => setAccess({ state: 'denied', message: m })} />;
}
