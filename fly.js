// The fly, in the browser. Photoreceptors and L1 from MaleCNS v1.0:
// 7,858 neurons, 7,107 edges, 170 KB on the wire, no server.
//
// The dynamics are the same three lines the Python runs:
//     x = W h + bias + u ;  x = min(relu(x), 10) ;  h <- (1-a) h + a x
// with a = 0.1, bias = 0.1 everywhere, and W the signed synapse counts. The
// bias is not a knob: photoreceptors are histaminergic, every edge here is
// negative, and at bias 0 the first hop is relu(negative) and the whole thing
// sits at exactly 0.0 forever.
(function (root) {
  'use strict';

  const STEPS = 12, GAIN = 0.2, ALPHA = 0.1, BIAS = 0.1, HMAX = 10.0, SETTLE = 64;

  function parse(buffer) {
    const v = new DataView(buffer);
    const magic = String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3));
    if (magic !== 'FLYP' || v.getUint32(4, true) !== 1) throw Error('brain file not recognised');
    const N = v.getUint32(8, true), E = v.getUint32(12, true),
          PR = v.getUint32(16, true), READ = v.getUint32(20, true);
    let o = 24;
    const row = new Uint32Array(buffer, o, N + 1); o += 4 * (N + 1);
    const col = new Uint32Array(buffer, o, E); o += 4 * E;
    const w = new Float32Array(buffer, o, E); o += 4 * E;
    const grid = new Float32Array(buffer, o, PR * 2); o += 4 * PR * 2;
    const rIdx = new Uint32Array(buffer, o, PR); o += 4 * PR;
    const read = new Uint32Array(buffer, o, READ); o += 4 * READ;
    const eyeBin = new Uint32Array(buffer, o, READ); o += 4 * READ;
    const prBin = new Uint32Array(buffer, o, PR); o += 4 * PR;
    if (o !== buffer.byteLength) throw Error('brain file is the wrong size');
    if (row[0] !== 0 || row[N] !== E) throw Error('connection index is wrong');
    return { N, E, PR, READ, row, col, w, grid, rIdx, read, eyeBin, prBin };
  }

  function Fly(g) {
    this.g = g;
    this.h = new Float64Array(g.N);
    this.x = new Float64Array(g.N);
    this.u = new Float64Array(g.N);
    this.rest = new Float64Array(g.N);
    this.out = new Float64Array(g.READ);
    // Where it sits with nothing in front of it. Starting a look from zero
    // spends the first steps climbing rather than responding.
    this.h.fill(0); this.u.fill(0);
    for (let s = 0; s < SETTLE; s++) this._step(false);
    this.rest.set(this.h);
    this.restRead = new Float64Array(g.READ);
    for (let k = 0; k < g.READ; k++) this.restRead[k] = this.h[g.read[k]];
  }

  Fly.prototype._step = function (withInput) {
    const { N, row, col, w } = this.g, h = this.h, x = this.x, u = this.u;
    for (let i = 0; i < N; i++) {
      let sum = BIAS;
      for (let e = row[i], end = row[i + 1]; e < end; e++) sum += w[e] * h[col[e]];
      if (withInput) sum += u[i];
      x[i] = sum > 0 ? (sum < HMAX ? sum : HMAX) : 0;   // relu then clamp
    }
    for (let i = 0; i < N; i++) h[i] = (1 - ALPHA) * h[i] + ALPHA * x[i];
  };

  // frame: {data: Float32Array(H*W) in [0,1], w, h}. Bilinear, align_corners.
  Fly.prototype._drive = function (frame) {
    const { PR, grid, rIdx } = this.g, W = frame.w, H = frame.h, d = frame.data;
    this.u.fill(0);
    for (let k = 0; k < PR; k++) {
      const px = (grid[2 * k] + 1) * 0.5 * (W - 1);
      const py = (grid[2 * k + 1] + 1) * 0.5 * (H - 1);
      let x0 = Math.floor(px), y0 = Math.floor(py);
      const fx = px - x0, fy = py - y0;
      let x1 = x0 + 1, y1 = y0 + 1;
      if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0;
      if (x1 > W - 1) x1 = W - 1; if (y1 > H - 1) y1 = H - 1;
      if (x0 > W - 1) x0 = W - 1; if (y0 > H - 1) y0 = H - 1;
      const v = d[y0 * W + x0] * (1 - fx) * (1 - fy) + d[y0 * W + x1] * fx * (1 - fy)
              + d[y1 * W + x0] * (1 - fx) * fy + d[y1 * W + x1] * fx * fy;
      this.u[rIdx[k]] = (v - 0.5) * 2 * GAIN;           // contrast, then gain
    }
  };

  /** One picture in, READ numbers out. */
  Fly.prototype.look = function (frame) {
    this.h.set(this.rest);
    this._drive(frame);
    for (let s = 0; s < STEPS; s++) this._step(true);
    const { READ, read } = this.g;
    for (let k = 0; k < READ; k++) this.out[k] = this.h[read[k]];
    return this.out;
  };

  /** How far two looks are apart. This is the whole of the fly's contribution. */
  Fly.prototype.gap = function (a, b) {
    let s = 0;
    for (let k = 0; k < a.length; k++) s += Math.abs(a[k] - b[k]);
    return s / a.length;
  };

  /** Departure from rest, binned, for the activity maps. Empty bins stay null. */
  Fly.prototype.map = function (which, nBins) {
    const g = this.g;
    const tot = new Float64Array(nBins), cnt = new Float64Array(nBins);
    if (which === 'l1') {
      for (let k = 0; k < g.READ; k++) {
        const b = g.eyeBin[k];
        tot[b] += Math.abs(this.h[g.read[k]] - this.restRead[k]); cnt[b]++;
      }
    } else {
      for (let k = 0; k < g.PR; k++) {
        const b = g.prBin[k], i = g.rIdx[k];
        tot[b] += Math.abs(this.h[i] - this.rest[i]); cnt[b]++;
      }
    }
    let top = 0;
    for (let b = 0; b < nBins; b++) if (cnt[b]) { tot[b] /= cnt[b]; if (tot[b] > top) top = tot[b]; }
    const out = new Array(nBins);
    for (let b = 0; b < nBins; b++) out[b] = cnt[b] ? tot[b] / (top || 1) : null;
    return out;
  };

  root.FlyBrain = { parse, Fly, STEPS, GAIN, ALPHA, BIAS };
})(typeof window === 'undefined' ? globalThis : window);
