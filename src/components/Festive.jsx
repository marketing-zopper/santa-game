// Christmas dressing for the prize cards: snow cap, holly, falling snow, fairy lights and the bauble garland.
// All decorative (aria-hidden), drawn in SVG/CSS so they stay sharp and cost no image downloads.

// snow piled along the card's top edge, with a few drips
export const SnowCap = () => (
  <svg className="fx-snow" viewBox="0 0 400 34" preserveAspectRatio="none" aria-hidden="true">
    <path d="M0 0H400V14C388 20 380 14 368 18C356 22 352 30 344 30C336 30 336 20 326 18C312 15 300 24 284 20C270 16 262 12 248 16C236 19 234 27 226 27C218 27 218 18 208 16C192 13 180 22 164 19C150 16 140 12 126 16C116 19 114 31 105 31C96 31 98 20 88 17C74 13 62 22 48 18C34 14 26 13 16 17C8 20 4 18 0 16Z" fill="#fff" />
    <path d="M0 16C4 18 8 20 16 17C26 13 34 14 48 18C62 22 74 13 88 17" fill="none" stroke="#D6E6F5" strokeWidth="2" />
  </svg>
);

const Leaf = ({ r }) => (
  <g transform={`rotate(${r})`}>
    <path d="M0 0Q5-8 10-5Q13-11 20-7Q25-12 30-6Q35-8 40 0Q35 8 30 6Q25 12 20 7Q13 11 10 5Q5 8 0 0Z" fill="#1F8A4C" />
    <path d="M2 0H37" stroke="#0F5A2E" strokeWidth="1.4" />
  </g>
);
// a holly sprig for the card corners
export const Holly = ({ side = 'l' }) => (
  <svg className={'fx-holly ' + side} viewBox="-44 -30 88 60" aria-hidden="true">
    <Leaf r={200} /><Leaf r={-20} /><Leaf r={-80} />
    <circle cx="-5" cy="-3" r="6" fill="#D7142C" /><circle cx="5" cy="-5" r="6" fill="#E8283F" /><circle cx="0" cy="5" r="6" fill="#C10F25" />
    <circle cx="-7" cy="-5" r="1.8" fill="#fff" opacity=".7" /><circle cx="3" cy="-7" r="1.8" fill="#fff" opacity=".7" />
  </svg>
);

// soft snowflakes drifting down behind the content
export const Snowfall = () => (
  <span className="fx-fall" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} />)}</span>
);

// a sagging wire between two points (quadratic curve), sampled for bulbs / baubles
const sag = (t, w, y0, dip) => [t * w, y0 + 4 * dip * t * (1 - t)];
const BULBS = ['#FF3B4E', '#FFD25A', '#3FD07A', '#4FB8FF', '#FF8A3D'];

// a string of blinking fairy lights (two swags)
export const FairyLights = () => {
  const w = 360, pts = [];
  for (let s = 0; s < 2; s++) for (let i = 1; i <= 6; i++) {
    const [x, y] = sag(i / 7, w / 2, 6, 18);
    pts.push([x + (s * w) / 2, y]);
  }
  return (
    <svg className="fx-lights" viewBox="0 0 360 40" aria-hidden="true">
      <path d="M0 6Q90 42 180 6Q270 42 360 6" fill="none" stroke="#173A22" strokeWidth="2" />
      {pts.map(([x, y], i) => (
        <g key={i} transform={`translate(${x} ${y}) rotate(${i % 2 ? 14 : -14})`}>
          <rect x="-3" y="0" width="6" height="5" rx="1" fill="#2B4A33" />
          <ellipse className="bulb" style={{ animationDelay: `${(i % 4) * 0.35}s` }} cx="0" cy="11" rx="5" ry="7" fill={BULBS[i % BULBS.length]} />
        </g>
      ))}
    </svg>
  );
};

// white line-icons of the five kinds of device a Device Doctor plan covers
const DEVICE_ICONS = {
  Phone: <><rect x="-7" y="-11" width="14" height="22" rx="3" /><path d="M-2 7.5H2" /></>,
  Laptop: <><rect x="-10" y="-9" width="20" height="13" rx="1.6" /><path d="M-13.5 7.5H13.5" /></>,
  TV: <><rect x="-12" y="-9" width="24" height="15" rx="2" /><path d="M-5 10.5H5" /></>,
  Fridge: <><rect x="-7.5" y="-12" width="15" height="24" rx="2.2" /><path d="M-7.5-3H7.5M-4-8.5V-6M-4 1V4" /></>,
  Washer: <><rect x="-10" y="-11" width="20" height="22" rx="2.4" /><circle cx="0" cy="2" r="5.5" /><path d="M-6-7H-2" /></>,
};
const BAUBLES = [
  ['Phone', '#E8283F', '#9E0E21'], ['Laptop', '#FFC93C', '#C98A0B'], ['TV', '#2FB26A', '#14713E'],
  ['Fridge', '#3B9BEA', '#1B5FA6'], ['Washer', '#B56CF0', '#6C2FAA'],
];

// the Device Doctor plan art: a garland of five baubles, one per device it covers
export const DeviceGarland = () => {
  const w = 340, xs = [34, 102, 170, 238, 306];
  return (
    <svg className="fx-garland" viewBox="0 0 340 150" aria-hidden="true">
      <defs>
        {BAUBLES.map(([k, c1, c2]) => (
          <radialGradient key={k} id={'bb' + k} cx="35%" cy="30%" r="75%"><stop offset="0" stopColor="#fff" stopOpacity=".55" /><stop offset=".25" stopColor={c1} /><stop offset="1" stopColor={c2} /></radialGradient>
        ))}
      </defs>
      <path d="M-4 8Q170 64 344 8" fill="none" stroke="#1F6B3A" strokeWidth="7" strokeLinecap="round" />
      <path d="M-4 8Q170 64 344 8" fill="none" stroke="#2FA35A" strokeWidth="3" strokeDasharray="2 5" strokeLinecap="round" />
      {BAUBLES.map(([k], i) => {
        const x = xs[i], [, top] = sag(x / w, w, 8, 28);
        const len = [16, 30, 40, 30, 16][i];
        const cy = top + len + 22;
        return (
          <g key={k} className="bauble" style={{ animationDelay: `${i * 0.4}s`, transformOrigin: `${x}px ${top}px` }}>
            <path d={`M${x} ${top}V${cy - 22}`} stroke="#F6D77A" strokeWidth="1.3" />
            <rect x={x - 5} y={cy - 25} width="10" height="6" rx="1.5" fill="#E9C25A" />
            <circle cx={x} cy={cy} r="21" fill={`url(#bb${k})`} />
            <g transform={`translate(${x} ${cy})`} fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">{DEVICE_ICONS[k]}</g>
            <text x={x} y={cy + 36} textAnchor="middle" className="bb-lbl">{k}</text>
          </g>
        );
      })}
    </svg>
  );
};

// a little twinkle star
export const Twinkle = ({ className = '' }) => (
  <svg className={'fx-twinkle ' + className} viewBox="-10 -10 20 20" aria-hidden="true"><path d="M0-10Q1.2-1.2 10 0Q1.2 1.2 0 10Q-1.2 1.2-10 0Q-1.2-1.2 0-10Z" fill="#FFE58A" /></svg>
);
