// Gera os ícones PNG do PWA (original, desenhado por código): prédio + ondas de sinal.
const zlib = require('zlib'); const fs = require('fs'); const path = require('path');
const OUT = path.join(__dirname, '..', 'public', 'icons');
const TEAL = [15, 118, 110], DARK = [8, 74, 70], WHITE = [255, 255, 255];

function crc32(buf) { let c, crc = ~0; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(t, d) { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4); d.copy(b, 8); b.writeUInt32BE(crc32(b.slice(4, 8 + d.length)), 8 + d.length); return b; }
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const inRect = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
function inRound(x, y, r) { // quadrado arredondado em [0,1]
  const cx = Math.min(Math.max(x, r), 1 - r), cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
// glifo em coordenadas centradas (-0.5..0.5); retorna cor ou null
function glifo(x, y) {
  // prédio principal
  if (inRect(x, y, -0.24, -0.22, 0.08, 0.30)) {
    // janelas 2x3
    for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) {
      const wx = -0.19 + i * 0.14, wy = -0.16 + j * 0.15;
      if (inRect(x, y, wx, wy, wx + 0.09, wy + 0.09)) return DARK;
    }
    return WHITE;
  }
  // prédio menor
  if (inRect(x, y, 0.10, 0.02, 0.28, 0.30)) {
    for (let j = 0; j < 2; j++) { const wy = 0.07 + j * 0.12; if (inRect(x, y, 0.15, wy, 0.23, wy + 0.07)) return DARK; }
    return WHITE;
  }
  // ondas de sinal (voz)
  const dx = x - 0.12, dy = y + 0.20, d = Math.hypot(dx, dy), ang = Math.atan2(dy, dx) * 180 / Math.PI;
  if (ang > -80 && ang < -10 && ((d > 0.145 && d < 0.185) || (d > 0.245 && d < 0.285))) return WHITE;
  return null;
}
function render(size, { maskable, escala }) {
  const SS = 3, buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const u = (px + (sx + 0.5) / SS) / size, v = (py + (sy + 0.5) / SS) / size;
      if (!maskable && !inRound(u, v, 0.22)) continue;
      // fundo com leve degradê vertical
      const t = v; let c = [0, 1, 2].map(i => TEAL[i] + (DARK[i] - TEAL[i]) * t * 0.55);
      const gc = glifo((u - 0.5) / escala + 0.02, (v - 0.5) / escala - 0.09);
      if (gc) c = gc;
      r += c[0]; g += c[1]; b += c[2]; a += 255;
    }
    const n = SS * SS, o = (py * size + px) * 4;
    buf[o] = a ? r / (a / 255) : 0; buf[o + 1] = a ? g / (a / 255) : 0; buf[o + 2] = a ? b / (a / 255) : 0; buf[o + 3] = a / n;
  }
  return png(size, size, buf);
}
fs.mkdirSync(OUT, { recursive: true });
const jobs = [
  ['icon-192.png', 192, { maskable: false, escala: 0.9 }],
  ['icon-512.png', 512, { maskable: false, escala: 0.9 }],
  ['icon-maskable-512.png', 512, { maskable: true, escala: 0.85 }], // glifo na zona segura (80% central)
  ['apple-touch-icon.png', 180, { maskable: true, escala: 0.9 }]
];
for (const [n, s, o] of jobs) { fs.writeFileSync(path.join(OUT, n), render(s, o)); console.log('gerado', n); }
