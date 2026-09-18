// The board, and the fly playing it. No server: the brain is 174 KB of
// synapse counts and the whole thing runs in this tab.
(function (root) {
  'use strict';

  const FW = 320, FH = 200;          // what the fly is shown, greyscale

  function shuffled(n, rng) {
    const b = Array.from({ length: n }, (_, i) => i);
    // Keep shuffling until nothing is already home, so every board starts
    // from the same kind of mess whatever its size.
    for (let tries = 0; tries < 200; tries++) {
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [b[i], b[j]] = [b[j], b[i]];
      }
      if (b.every((p, s) => p !== s)) return b;
    }
    return b;
  }

  function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** How many swaps are still owed: n minus the number of cycles. */
  function owed(board) {
    const n = board.length, seen = new Array(n).fill(false);
    let cycles = 0;
    for (let i = 0; i < n; i++) {
      if (seen[i]) continue;
      cycles++;
      for (let j = i; !seen[j]; j = board[j]) seen[j] = true;
    }
    return n - cycles;
  }

  /**
   * Cut a picture into rows x cols and keep each piece twice: once as a canvas
   * for the screen, once as greyscale for the fly.
   */
  function Pieces(img, rows, cols) {
    this.rows = rows; this.cols = cols; this.n = rows * cols;
    this.tw = Math.floor(FW / cols); this.th = Math.floor(FH / rows);
    this.fw = this.tw * cols; this.fh = this.th * rows;

    const big = document.createElement('canvas');
    big.width = this.fw; big.height = this.fh;
    const bx = big.getContext('2d', { willReadFrequently: true });
    bx.drawImage(img, 0, 0, this.fw, this.fh);
    const px = bx.getImageData(0, 0, this.fw, this.fh).data;

    this.grey = [];                                  // per piece, tw*th in [0,1]
    this.tiles = [];                                 // per piece, a canvas
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const g = new Float32Array(this.tw * this.th);
      for (let y = 0; y < this.th; y++) for (let x = 0; x < this.tw; x++) {
        const o = 4 * ((r * this.th + y) * this.fw + c * this.tw + x);
        // Rec. 601 luma, the same greyscale the Python pipeline uses.
        g[y * this.tw + x] = (0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2]) / 255;
      }
      this.grey.push(g);
      const cv = document.createElement('canvas');
      cv.width = this.tw; cv.height = this.th;
      cv.getContext('2d').drawImage(img, c * this.tw * img.width / this.fw,
        r * this.th * img.height / this.fh,
        this.tw * img.width / this.fw, this.th * img.height / this.fh,
        0, 0, this.tw, this.th);
      this.tiles.push(cv);
    }
    this.frame = { data: new Float32Array(this.fw * this.fh), w: this.fw, h: this.fh };
  }

  /** Paint one piece into one slot of the greyscale frame. */
  Pieces.prototype.place = function (data, slot, piece) {
    const { tw, th, cols, fw } = this;
    const sx = (slot % cols) * tw, sy = Math.floor(slot / cols) * th, g = this.grey[piece];
    for (let y = 0; y < th; y++) {
      data.set(g.subarray(y * tw, y * tw + tw), (sy + y) * fw + sx);
    }
  };

  Pieces.prototype.render = function (board) {
    for (let s = 0; s < board.length; s++) this.place(this.frame.data, s, board[s]);
    return this.frame;
  };

  /**
   * The fly's turn, one candidate board per tick.
   *
   * The tick IS the handicap. A real fly has one brain and sees one scene at a
   * time, and photoreceptor to lamina takes 12-22 ms, so it gets one candidate
   * per 18 ms. That also keeps the tab responsive without a worker, and makes
   * the "seen 43 of 66" counter literally true rather than a progress bar.
   */
  function Turn(fly, pieces, board, target, lookMs, onTick, onDone) {
    this.fly = fly; this.pieces = pieces; this.board = board; this.target = target;
    this.pairs = [];
    for (let i = 0; i < board.length; i++)
      for (let j = i + 1; j < board.length; j++) this.pairs.push([i, j]);
    this.best = -1; this.bestGap = Infinity; this.k = 0;
    this.base = new Float32Array(pieces.frame.data.length);
    pieces.render(board);
    this.base.set(pieces.frame.data);
    this.work = { data: new Float32Array(this.base.length), w: pieces.fw, h: pieces.fh };
    this.onTick = onTick; this.onDone = onDone;
    this.timer = setInterval(this.tick.bind(this), lookMs);
  }

  Turn.prototype.tick = function () {
    const [i, j] = this.pairs[this.k];
    this.work.data.set(this.base);
    this.pieces.place(this.work.data, i, this.board[j]);   // only the two slots move
    this.pieces.place(this.work.data, j, this.board[i]);
    const g = this.fly.gap(this.fly.look(this.work), this.target);
    if (g < this.bestGap) { this.bestGap = g; this.best = this.k; }
    this.k++;
    if (this.onTick) this.onTick(this.k, this.pairs.length);
    if (this.k >= this.pairs.length) {
      clearInterval(this.timer);
      this.onDone(this.pairs[this.best], this.bestGap);
    }
  };

  Turn.prototype.stop = function () { clearInterval(this.timer); };

  /**
   * Pictures with nothing to download. A jigsaw needs local structure -- an
   * even wash gives every piece the same face and no arrangement is better
   * than another -- so each of these puts something different in every region.
   */
  const PICTURES = {
    shapes: { name: "도형", draw: function (x, rng) {
      const sky = x.createLinearGradient(0, 0, 640, 400);
      sky.addColorStop(0, "#13203a"); sky.addColorStop(1, "#3b1d3a");
      x.fillStyle = sky; x.fillRect(0, 0, 640, 400);
      const hues = [12, 45, 95, 150, 200, 280, 330];
      for (let k = 0; k < 26; k++) {
        x.fillStyle = "hsl(" + hues[(rng() * hues.length) | 0] + " 72% " + (40 + rng() * 34) + "%)";
        const cx = rng() * 640, cy = rng() * 400, r = 24 + rng() * 72;
        x.beginPath();
        const kind = (rng() * 3) | 0;
        if (kind === 0) x.arc(cx, cy, r / 2, 0, 6.2832);
        else if (kind === 1) x.rect(cx - r / 2, cy - r / 2, r, r);
        else { x.moveTo(cx, cy - r / 2); x.lineTo(cx + r / 2, cy + r / 2); x.lineTo(cx - r / 2, cy + r / 2); }
        x.closePath(); x.fill();
      }
    }},
    tartan: { name: "체크", draw: function (x, rng) {
      const base = (rng() * 360) | 0;
      x.fillStyle = "hsl(" + base + " 40% 22%)"; x.fillRect(0, 0, 640, 400);
      for (let pass = 0; pass < 2; pass++) {
        let at = 0;
        while (at < (pass ? 400 : 640)) {
          const w = 8 + rng() * 44;
          x.globalAlpha = 0.28 + rng() * 0.5;
          x.fillStyle = "hsl(" + ((base + [0, 40, 180, 300][(rng() * 4) | 0]) % 360) +
            " " + (45 + rng() * 40) + "% " + (30 + rng() * 45) + "%)";
          if (pass) x.fillRect(0, at, 640, w); else x.fillRect(at, 0, w, 400);
          at += w + rng() * 26;
        }
      }
      x.globalAlpha = 1;
    }},
    waves: { name: "물결", draw: function (x, rng) {
      const h0 = (rng() * 360) | 0;
      x.fillStyle = "hsl(" + h0 + " 55% 12%)"; x.fillRect(0, 0, 640, 400);
      for (let k = 0; k < 40; k++) {
        const amp = 12 + rng() * 60, per = 60 + rng() * 220, off = rng() * 400;
        x.strokeStyle = "hsl(" + ((h0 + k * 7) % 360) + " " + (55 + rng() * 40) + "% " +
          (32 + rng() * 48) + "%)";
        x.lineWidth = 2 + rng() * 9;
        x.beginPath();
        for (let px = 0; px <= 640; px += 6)
          x[px ? "lineTo" : "moveTo"](px, off + amp * Math.sin(px / per * 6.2832 + k));
        x.stroke();
      }
    }},
    night: { name: "밤하늘", draw: function (x, rng) {
      const g = x.createRadialGradient(320, 380, 20, 320, 200, 520);
      g.addColorStop(0, "#2b1a44"); g.addColorStop(1, "#05060f");
      x.fillStyle = g; x.fillRect(0, 0, 640, 400);
      for (let k = 0; k < 8; k++) {              // nebulae, so no region is empty
        const cx = rng() * 640, cy = rng() * 400, r = 60 + rng() * 150;
        const n = x.createRadialGradient(cx, cy, 0, cx, cy, r);
        n.addColorStop(0, "hsla(" + ((rng() * 360) | 0) + " 80% 62% / .5)");
        n.addColorStop(1, "hsla(0 0% 0% / 0)");
        x.fillStyle = n; x.fillRect(cx - r, cy - r, 2 * r, 2 * r);
      }
      for (let k = 0; k < 900; k++) {
        const s = rng() * rng() * 3.4;
        x.fillStyle = "hsla(" + (40 + rng() * 200) + " 40% " + (72 + rng() * 28) + "% / " +
          (0.4 + rng() * 0.6) + ")";
        x.beginPath(); x.arc(rng() * 640, rng() * 400, 0.4 + s, 0, 6.2832); x.fill();
      }
    }},
    glass: { name: "스테인드글라스", draw: function (x, rng) {
      const pts = [];
      for (let k = 0; k < 34; k++) pts.push([rng() * 640, rng() * 400,
        "hsl(" + ((rng() * 360) | 0) + " 78% " + (34 + rng() * 42) + "%)"]);
      const img = x.createImageData(640, 400), d = img.data;
      for (let y = 0; y < 400; y += 1) for (let px = 0; px < 640; px += 1) {
        let best = 0, bd = 1e9, second = 1e9;
        for (let k = 0; k < pts.length; k++) {
          const dx = px - pts[k][0], dy = y - pts[k][1], dd = dx * dx + dy * dy;
          if (dd < bd) { second = bd; bd = dd; best = k; } else if (dd < second) second = dd;
        }
        const lead = (Math.sqrt(second) - Math.sqrt(bd)) < 2.2;   // the leading between panes
        const c = lead ? "#0a0a0c" : pts[best][2];
        const o = 4 * (y * 640 + px);
        if (lead) { d[o] = 10; d[o + 1] = 10; d[o + 2] = 12; }
        else {
          const m = /hsl\((\d+) (\d+)% ([\d.]+)%\)/.exec(c);
          const rgb = hsl(+m[1], +m[2] / 100, +m[3] / 100);
          d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2];
        }
        d[o + 3] = 255;
      }
      x.putImageData(img, 0, 0);
    }},
  };

  function hsl(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s, hp = h / 60, xx = c * (1 - Math.abs(hp % 2 - 1));
    let r = 0, g = 0, b = 0;
    if (hp < 1) [r, g, b] = [c, xx, 0]; else if (hp < 2) [r, g, b] = [xx, c, 0];
    else if (hp < 3) [r, g, b] = [0, c, xx]; else if (hp < 4) [r, g, b] = [0, xx, c];
    else if (hp < 5) [r, g, b] = [xx, 0, c]; else [r, g, b] = [c, 0, xx];
    const m = l - c / 2;
    return [Math.round(255 * (r + m)), Math.round(255 * (g + m)), Math.round(255 * (b + m))];
  }

  function picture(which, seed) {
    const cv = document.createElement("canvas");
    cv.width = 640; cv.height = 400;
    const x = cv.getContext("2d");
    (PICTURES[which] || PICTURES.shapes).draw(x, mulberry(seed));
    return cv;
  }

  root.Puzzle = { Pieces, Turn, shuffled, owed, mulberry, picture, PICTURES, FW, FH };
})(typeof window === 'undefined' ? globalThis : window);
