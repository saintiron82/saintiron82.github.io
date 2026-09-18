// Play a whole board headlessly, so a broken pipeline cannot reach a phone.
//
// A silent str.replace once left picture() calling draw() without its width and
// height, so every generator drew with `undefined` and the page started to
// nothing. Syntax checks pass that happily. This runs it.
//
//     node selftest.js
const fs = require('fs');
const path = require('path');

// ---- just enough canvas for what the game actually asks of it ----
function makeCanvas() {
  const cv = { width: 0, height: 0, _px: null, _ops: [] };
  cv.getContext = () => ctx;
  const ctx = {
    canvas: cv,
    set fillStyle(v) { cv._ops.push('fillStyle'); this._fill = v; },
    get fillStyle() { return this._fill; },
    set strokeStyle(v) { this._stroke = v; }, get strokeStyle() { return this._stroke; },
    set lineWidth(v) { this._lw = v; }, get lineWidth() { return this._lw; },
    set globalAlpha(v) { this._ga = v; }, get globalAlpha() { return this._ga; },
    set imageSmoothingEnabled(v) {},
    _ensure() {
      if (!cv._px || cv._px.length !== cv.width * cv.height * 4)
        cv._px = new Uint8ClampedArray(cv.width * cv.height * 4);
      return cv._px;
    },
    _colour() {
      const c = this._fill || '#808080';
      if (typeof c === 'object') return [128, 128, 160];
      const m = /hsl\((\d+)/.exec(c);
      if (m) { const h = +m[1] % 360; return [(h * 7) % 256, (h * 13) % 256, (h * 29) % 256]; }
      const x = /#([0-9a-f]{6})/i.exec(c);
      if (x) return [parseInt(x[1].slice(0, 2), 16), parseInt(x[1].slice(2, 4), 16),
                     parseInt(x[1].slice(4, 6), 16)];
      return [120, 120, 120];
    },
    fillRect(x, y, w, h) {
      if (!isFinite(w) || !isFinite(h)) throw Error('fillRect got ' + w + ' x ' + h);
      const p = this._ensure(), [r, g, b] = this._colour();
      for (let yy = Math.max(0, y | 0); yy < Math.min(cv.height, (y + h) | 0); yy++)
        for (let xx = Math.max(0, x | 0); xx < Math.min(cv.width, (x + w) | 0); xx++) {
          const o = 4 * (yy * cv.width + xx);
          p[o] = r; p[o + 1] = g; p[o + 2] = b; p[o + 3] = 255;
        }
      cv._ops.push('fillRect');
    },
    // Paths are tracked only well enough to leave different pixels in different
    // places, which is all the fly needs to tell two boards apart.
    beginPath() { this._path = []; },
    closePath() {},
    moveTo(x, y) { (this._path = this._path || []).push([x, y]); },
    lineTo(x, y) { (this._path = this._path || []).push([x, y]); },
    arc(x, y, r) { (this._path = this._path || []).push([x - r, y - r], [x + r, y + r]); },
    rect(x, y, w, h) { (this._path = this._path || []).push([x, y], [x + w, y + h]); },
    fill() {
      const P = this._path || []; if (!P.length) return;
      const xs = P.map(p => p[0]), ys = P.map(p => p[1]);
      const x0 = Math.min(...xs), y0 = Math.min(...ys);
      this.fillRect(x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0);
      cv._ops.push('fill');
    },
    stroke() {
      const P = this._path || []; if (P.length < 2) return;
      const keep = this._fill; this._fill = this._stroke;
      const w = Math.max(1, this._lw || 1);
      for (let k = 1; k < P.length; k++) {
        const [ax, ay] = P[k - 1], [bx, by] = P[k];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
        for (let t = 0; t <= n; t++)
          this.fillRect(ax + (bx - ax) * t / n - w / 2, ay + (by - ay) * t / n - w / 2, w, w);
      }
      this._fill = keep;
      cv._ops.push('stroke');
    },
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    createImageData(w, h) {
      if (!isFinite(w) || !isFinite(h)) throw Error('createImageData got ' + w + ' x ' + h);
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    },
    putImageData(img) {
      const p = this._ensure();
      p.set(img.data.subarray(0, Math.min(p.length, img.data.length)));
      cv._ops.push('putImageData');
    },
    getImageData(x, y, w, h) {
      const src = this._ensure(), out = new Uint8ClampedArray(w * h * 4);
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        const s = 4 * ((y + yy) * cv.width + (x + xx)), d = 4 * (yy * w + xx);
        out[d] = src[s]; out[d + 1] = src[s + 1]; out[d + 2] = src[s + 2]; out[d + 3] = 255;
      }
      return { width: w, height: h, data: out };
    },
    drawImage(img, ...a) {
      const sp = img._px;
      if (!sp) return;
      let sx = 0, sy = 0, sw = img.width, sh = img.height, dx = 0, dy = 0, dw, dh;
      if (a.length === 4) [dx, dy, dw, dh] = a;
      else if (a.length === 8) [sx, sy, sw, sh, dx, dy, dw, dh] = a;
      else { dw = img.width; dh = img.height; }
      const p = this._ensure();
      for (let yy = 0; yy < dh; yy++) for (let xx = 0; xx < dw; xx++) {
        const px = Math.min(img.width - 1, (sx + xx * sw / dw) | 0);
        const py = Math.min(img.height - 1, (sy + yy * sh / dh) | 0);
        const tx = (dx + xx) | 0, ty = (dy + yy) | 0;
        if (tx < 0 || ty < 0 || tx >= cv.width || ty >= cv.height) continue;
        const s = 4 * (py * img.width + px), d = 4 * (ty * cv.width + tx);
        p[d] = sp[s]; p[d + 1] = sp[s + 1]; p[d + 2] = sp[s + 2]; p[d + 3] = 255;
      }
      cv._ops.push('drawImage');
    },
  };
  return cv;
}
global.document = { createElement: () => makeCanvas() };

require(path.join(__dirname, 'fly.js'));
require(path.join(__dirname, 'puzzle.js'));

const buf = fs.readFileSync(path.join(__dirname, 'brain.bin'));
const g = FlyBrain.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const fly = new FlyBrain.Fly(g);
let bad = 0;
const ok = (cond, what) => { console.log((cond ? '  ok   ' : '  FAIL ') + what); if (!cond) bad++; };

/** How much the picture actually varies. A flat wash makes every piece the
    same face and no arrangement beats another, so this has to be well above 0. */
function spreadOf(cv) {
  const p = cv._px; if (!p) return 0;
  let n = 0, sum = 0, sq = 0;
  for (let i = 0; i < p.length; i += 4) {
    const v = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
    sum += v; sq += v * v; n++;
  }
  return Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2));
}

console.log('brain: ' + g.N + ' neurons, ' + g.E + ' edges, ' + g.PR + ' photoreceptors');

// 1. every picture, both orientations, actually paints something at the right size
for (const [key, p] of Object.entries(Puzzle.PICTURES)) {
  for (const [name, F] of [['가로', Puzzle.LAND], ['세로', Puzzle.PORT]]) {
    const cv = Puzzle.picture(key, 11, F);
    const sd = spreadOf(cv);
    ok(cv.width === F.pw && cv.height === F.ph && sd > 8,
       p.name + ' ' + name + '  ' + cv.width + 'x' + cv.height + ', 밝기 표준편차 ' + sd.toFixed(1));
  }
}

// 2. the fly tells boards apart, and solves one
for (const [name, F, sizes] of [['가로', Puzzle.LAND, [3, 4]], ['세로', Puzzle.PORT, [4, 3]]]) {
  const img = Puzzle.picture('shapes', 5, F);
  const P = new Puzzle.Pieces(img, sizes[0], sizes[1], F);
  const n = P.n, solved = Array.from({ length: n }, (_, i) => i);
  const target = Float64Array.from(fly.look(P.render(solved)));
  const spread = (() => {
    const a = fly.gap(fly.look(P.render(solved)), target);
    const shuf = Puzzle.shuffled(n, Puzzle.mulberry(3));
    const b = fly.gap(fly.look(P.render(shuf)), target);
    return { a, b };
  })();
  ok(spread.a < 1e-9 && spread.b > 1e-6,
     name + ' 완성본과의 거리: 완성 ' + spread.a.toExponential(1) + ', 섞임 ' + spread.b.toExponential(2));

  let board = Puzzle.shuffled(n, Puzzle.mulberry(9));
  const optimal = Puzzle.owed(board);
  let moves = 0;
  while (moves < n * 4 && board.some((p, s) => p !== s)) {
    let best = null, bestGap = Infinity;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const b = board.slice(); [b[i], b[j]] = [b[j], b[i]];
      const gp = fly.gap(fly.look(P.render(b)), target);
      if (gp < bestGap) { bestGap = gp; best = [i, j]; }
    }
    [board[best[0]], board[best[1]]] = [board[best[1]], board[best[0]]];
    moves++;
  }
  ok(board.every((p, s) => p === s),
     name + ' ' + n + '조각 ' + sizes[0] + 'x' + sizes[1] + ' 완성: ' + moves + '수 (최단 ' + optimal + ')');
}

console.log(bad ? '\n' + bad + ' FAILED' : '\nall good');
process.exit(bad ? 1 : 0);
