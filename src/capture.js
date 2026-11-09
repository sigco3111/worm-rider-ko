// Frame-locked capture: steps the game at exactly 60 fps, composites the HUD, posts JPEG frames and an
// offline-rendered soundtrack to the local server (POST /capture/...). Run from the console:
//   import('./src/capture.js').then(m => m.run(60))
export async function run(seconds = 60) {
  const g = window.__game, N = Math.round(seconds * 60), $ = (id) => document.getElementById(id), pad = (n) => String(n).padStart(5, '0');
  window.__hold = true; $('loading').style.display = 'none'; $('title').style.display = 'none';
  const realNow = performance.now.bind(performance); let frame = 0; performance.now = () => frame * 1000 / 60;
  const octx = new OfflineAudioContext(2, 48000 * (seconds + 1), 48000); g.sound.clock = 0; g.sound.start(octx);
  for (let i = 0; i < 40 && Object.keys(g.sound.samples).length < 3; i++) await new Promise((r) => setTimeout(r, 150));
  const src = g.renderer.domElement, W = 1920, H = 1080, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  const font = (px, w = 600) => `${w} ${px}px Bahnschrift, "DIN Alternate", "Segoe UI", sans-serif`, ink = '#efe6d8', dim = 'rgba(239,230,216,.62)', amber = '#ffb35c';
  const text = (s, px, X, Y, col, sp, w, align = 'left') => { x.font = font(px, w); x.fillStyle = col; x.textAlign = align; x.letterSpacing = sp + 'px'; x.fillText(s, X, Y); };
  const keys = [[0, 0, 0, 1], [5, 0, 0, 1], [9, 2.6, -0.16, 0.72], [12, 2.9, -0.1, 0.8], [14.5, 0, 0, 1], [18, 0.75, 0.08, 0.34], [20.5, 0.4, 0.05, 0.36], [22, 0, 0, 1]];
  const log = [], pending = []; let toastA = 0;
  for (frame = 0; frame < N; frame++) {
    const t = frame / 60, tm = t % 22; g.sound.clock = t;
    let k = 0; while (k < keys.length - 2 && keys[k + 1][0] <= tm) k++;
    const a = keys[k], b = keys[k + 1], u = Math.min(1, Math.max(0, (tm - a[0]) / (b[0] - a[0]))), e = u * u * (3 - 2 * u);
    g.orbit.yaw = a[1] + (b[1] - a[1]) * e; g.orbit.pitch = a[2] + (b[2] - a[2]) * e; g.orbit.zoom = a[3] + (b[3] - a[3]) * e;
    g.step(1 / 60);
    x.drawImage(src, 0, 0, W, H);
    const bar = g.cam.cineW * g.cam.cineW * (3 - 2 * g.cam.cineW) * 0.09 * H; x.fillStyle = '#000'; x.fillRect(0, 0, W, bar); x.fillRect(0, H - bar, W, bar);
    x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = 10; x.textBaseline = 'alphabetic';
    text('WORM RIDER', 26, 62, 82, ink, 9, 700); x.fillStyle = 'rgba(239,230,216,.35)'; x.fillRect(62, 96, 238, 1); text('RING ROAD · SECTOR 04', 12, 62, 118, dim, 2.6, 500);
    text('DEVOURED', 12, W - 196, 70, dim, 2.6, 500, 'right'); text($('eaten').textContent, 46, W - 196, 118, amber, 4, 300, 'right');
    text('ESCAPED', 12, W - 62, 70, dim, 2.6, 500, 'right'); text($('escaped').textContent, 46, W - 62, 118, ink, 4, 300, 'right');
    text($('state').textContent, 17, 62, H - 84, ink, 3.6, 600); text('A  D  STEER      SPACE  DIVE · BREACH      DRAG  LOOK      WHEEL  ZOOM', 12, 62, H - 58, dim, 2.6, 500);
    toastA += (($('toast').classList.contains('on') ? 1 : 0) - toastA) * 0.2;
    if (toastA > 0.02) { x.globalAlpha = toastA; const s = $('toast').textContent; x.font = font(24, 600); x.letterSpacing = '7px'; const tw = x.measureText(s).width; x.fillStyle = amber; x.fillRect(W / 2 - tw / 2 - 26, H * 0.83 - 34, tw + 52, 1.5); x.fillRect(W / 2 - tw / 2 - 26, H * 0.83 + 16, tw + 52, 1.5); text(s, 24, W / 2, H * 0.83, ink, 7, 600, 'center'); x.globalAlpha = 1; }
    x.shadowBlur = 0;
    // synchronous encode: toBlob is scheduled on idle time and crawls when the tab is not being painted
    const bin = atob(c.toDataURL('image/jpeg', 0.94).slice(23)), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const send = fetch('/capture/frames/f' + pad(frame) + '.jpg', { method: 'POST', body: bytes }); pending.push(send); if (pending.length >= 6) { await Promise.all(pending); pending.length = 0; }
    log.push([frame, g.cam.mode || '-', +g.cam.cineW.toFixed(2), g.convoy.eaten, g.sim.state, +g.orbit.zoom.toFixed(2), +g.orbit.yaw.toFixed(2)]);
    window.__cap = { frame, N };
  }
  await Promise.all(pending);
  // soundtrack
  const buf = await octx.startRendering(), n = Math.min(buf.length, Math.round(seconds * 48000)), L = buf.getChannelData(0), R = buf.getChannelData(1), wav = new DataView(new ArrayBuffer(44 + n * 4));
  const wr = (o, s) => { for (let i = 0; i < s.length; i++) wav.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, 'RIFF'); wav.setUint32(4, 36 + n * 4, true); wr(8, 'WAVEfmt '); wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 2, true); wav.setUint32(24, 48000, true); wav.setUint32(28, 192000, true); wav.setUint16(32, 4, true); wav.setUint16(34, 16, true); wr(36, 'data'); wav.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) { wav.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true); wav.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true); }
  await fetch('/capture/audio.wav', { method: 'POST', body: wav.buffer });
  await fetch('/capture/log.json', { method: 'POST', body: JSON.stringify(log) });
  performance.now = realNow; window.__cap = { frame: N, N, done: true };
}
