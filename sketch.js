
let SEED;
let pg;
const RENDER_SCALE = 0.5;

function setup() {
  pixelDensity(1);
  createCanvas(windowWidth, windowHeight);
  noSmooth();
  SEED = floor(random(1e9));
  regenerate();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  regenerate();
}

function keyPressed() {
  if (key === ' ') {
    SEED = floor(random(1e9));
    regenerate();
    return false;
  }
}

function regenerate() {
  let w = max(200, floor(width * RENDER_SCALE));
  let h = max(200, floor(height * RENDER_SCALE));
  pg = createGraphics(w, h);
  pg.pixelDensity(1);
  pg.noSmooth();
  renderField(pg);
}

function draw() {
  image(pg, 0, 0, width, height);
}

function fbm(x, y, oct) {
  let v = 0, a = 1, f = 1, tot = 0;
  for (let i = 0; i < oct; i++) {
    v += noise(x * f, y * f) * a;
    tot += a;
    a *= 0.5;
    f *= 2.0;
  }
  return v / tot;
}

function scurve(t, k) {
  t = constrain(t, 0, 1);
  if (t < 0.5) {
    return 0.5 * pow(2.0 * t, k);
  } else {
    return 1.0 - 0.5 * pow(2.0 * (1.0 - t), k);
  }
}

function renderField(g) {
  let W = g.width;
  let H = g.height;
  let diag = sqrt(W * W + H * H);

  randomSeed(SEED);
  noiseSeed(SEED);

  let o = [];
  for (let i = 0; i < 60; i++) o.push(random(10, 900));

  // ── Domain warp — equal x/y movement for rounder forms ──
  let warpAmp1   = random(0.35, 0.7) * diag;
  let warpScale1 = random(0.2, 0.55);
  let warpAmp2   = random(0.12, 0.3) * diag;
  let warpScale2 = random(0.5, 1.3);
  let warpAmp3   = random(0.02, 0.08) * diag;
  let warpScale3 = random(1.5, 3.5);

  // ── Flow — RELAXED, varied angle, weaker ──
  let flowAngle = random(TWO_PI);  // any direction, not just horizontal
  let flowStr   = random(0.15, 0.4) * diag;  // weaker
  let flowFreq  = random(0.2, 0.6);

  // ── Strata — WEAKER, so forms aren't squished ──
  let strataStr  = random(0.1, 0.35);  // was 0.25-0.6
  let strataFreq = random(3.0, 8.0);

  // ── Band density ──
  let bandMin = random(3, 7);
  let bandMax = random(80, 140);

  // ── Density map — VERY low frequency + steep S-curve for big open/dense zones ──
  let densScale1 = random(0.15, 0.45);  // even lower freq = bigger regions
  let densScale2 = random(0.6, 1.4);
  let densMix    = random(0.2, 0.5);
  let densityCurve = random(2.5, 4.0);  // steeper = more extreme open/dense

  // ── Vortex sinks ──
  let vortices = [];
  let numVortex = floor(random(1, 5));
  for (let v = 0; v < numVortex; v++) {
    vortices.push({
      cx: random(W * 0.1, W * 0.9),
      cy: random(H * 0.1, H * 0.9),
      radius: random(50, min(W, H) * 0.45),
      strength: random(0.3, 1.0) * (random() < 0.5 ? 1 : -1),
      tightness: random(0.4, 1.8)
    });
  }

  // ── Pixelation ──
  let pixPatches = [];
  let numPix = floor(random(4, 10));
  for (let p = 0; p < numPix; p++) {
    pixPatches.push({
      cx: random(W), cy: random(H),
      rx: random(20, W * 0.25), ry: random(15, H * 0.2),
      block: floor(random(3, 10)),
      angle: random(TWO_PI)
    });
  }

  // ── Scan-line stretch ──
  let scanBands = [];
  let numScans = floor(random(4, 11));  // slightly fewer
  for (let b = 0; b < numScans; b++) {
    scanBands.push({
      yCenter: random(H),
      halfH: random(6, 40),
      stretch: floor(random(3, 20)),
      curveAmp: random(5, 45),
      curveFreq: random(0.3, 2.5),
      curvePhase: random(TWO_PI)
    });
  }

  // ── Density map ──
  let densityMap = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let u = x / W, v = y / H;
      let d1 = fbm(u * densScale1 + o[16], v * densScale1 + o[17], 2);
      let d2 = fbm(u * densScale2 + o[18], v * densScale2 + o[19], 2);
      let blend = lerp(d1, d2, densMix);
      blend = scurve(blend, densityCurve);
      densityMap[x + y * W] = blend;
    }
  }

  // ── Scan stretch ──
  let scanStretch = new Float32Array(W * H);
  for (let band of scanBands) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let curvedCenter = band.yCenter +
          sin(x / W * PI * band.curveFreq + band.curvePhase) * band.curveAmp;
        let dist = abs(y - curvedCenter);
        if (dist < band.halfH) {
          let taper = cos((dist / band.halfH) * HALF_PI);
          taper *= taper;
          let amt = band.stretch * taper;
          let idx = x + y * W;
          if (amt > scanStretch[idx]) scanStretch[idx] = amt;
        }
      }
    }
  }

  // ── Block size ──
  let blockSize = new Int16Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let maxBlock = 1;
      for (let p of pixPatches) {
        let dx = (x - p.cx) / p.rx;
        let dy = (y - p.cy) / p.ry;
        let cs = cos(p.angle), sn = sin(p.angle);
        let rx = dx * cs + dy * sn;
        let ry = -dx * sn + dy * cs;
        let d = rx * rx + ry * ry;
        if (d < 1.0) {
          let falloff = 1.0 - sqrt(d);
          let b = floor(p.block * falloff * falloff);
          if (b > maxBlock) maxBlock = b;
        }
      }
      blockSize[x + y * W] = maxBlock;
    }
  }

  // ═══ MAIN RENDER ═══
  g.loadPixels();

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let i = x + y * W;
      let sx = x, sy = y;

      let blk = blockSize[i];
      if (blk > 1) {
        sx = floor(x / blk) * blk + floor(blk * 0.5);
        sy = floor(y / blk) * blk + floor(blk * 0.5);
      }

      let stretch = scanStretch[i];
      if (stretch > 1) {
        let s = floor(stretch);
        sx = floor(sx / s) * s;
      }

      let su = sx / W;
      let sv = sy / H;

      // Warp 1
      let w1x = fbm(su * warpScale1 + o[0], sv * warpScale1 + o[1], 2);
      let w1y = fbm(su * warpScale1 + o[2], sv * warpScale1 + o[3], 2);
      let dx1 = (w1x - 0.5) * warpAmp1;
      let dy1 = (w1y - 0.5) * warpAmp1;

      // Warp 2 chained
      let su2 = (sx + dx1) / W;
      let sv2 = (sy + dy1) / H;
      let w2x = fbm(su2 * warpScale2 + o[4], sv2 * warpScale2 + o[5], 2);
      let w2y = fbm(su2 * warpScale2 + o[6], sv2 * warpScale2 + o[7], 2);
      let dx2 = (w2x - 0.5) * warpAmp2;
      let dy2 = (w2y - 0.5) * warpAmp2;

      // Warp 3 chained
      let su3 = (sx + dx1 + dx2) / W;
      let sv3 = (sy + dy1 + dy2) / H;
      let w3x = fbm(su3 * warpScale3 + o[40], sv3 * warpScale3 + o[41], 2);
      let w3y = fbm(su3 * warpScale3 + o[42], sv3 * warpScale3 + o[43], 2);
      let dx3 = (w3x - 0.5) * warpAmp3;
      let dy3 = (w3y - 0.5) * warpAmp3;

      // Flow — equal x/y contribution now
      let fn  = fbm(su * flowFreq + o[8], sv * flowFreq + o[9], 2);
      let dxf = cos(flowAngle) * fn * flowStr;
      let dyf = sin(flowAngle) * fn * flowStr * 0.6;  // was 0.2, now 0.6

      // Vortex
      let dxv = 0, dyv = 0;
      let px = sx + dx1 + dx2 + dx3 + dxf;
      let py = sy + dy1 + dy2 + dy3 + dyf;
      for (let vort of vortices) {
        let vdx = px - vort.cx;
        let vdy = py - vort.cy;
        let vdist = sqrt(vdx * vdx + vdy * vdy);
        if (vdist < vort.radius && vdist > 1) {
          let falloff = 1.0 - (vdist / vort.radius);
          falloff = falloff * falloff;
          let angle = atan2(vdy, vdx);
          let rotAngle = angle + HALF_PI * vort.strength;
          let pull = falloff * vort.tightness * vort.radius * 0.3;
          dxv += cos(rotAngle) * pull * falloff;
          dyv += sin(rotAngle) * pull * falloff;
        }
      }

      let wx = px + dxv;
      let wy = py + dyv;
      let wu = wx / W;
      let wv = wy / H;

      // Base field
      let base = fbm(wu * 1.0 + o[10], wv * 1.0 + o[11], 3);

      // Strata — weaker
      let strata = fbm(wu * 0.35, wv * strataFreq, 2);
      base = lerp(base, strata, strataStr);

      let su4 = wu * 0.94 + wv * 0.34;
      let strata2 = fbm(su4 * 3.5 + o[44], su4 * 0.5 + o[45], 2);
      base = lerp(base, strata2, 0.06);

      let val = constrain(base, 0, 1);

      // Band density
      let density = densityMap[i];
      let bands = lerp(bandMin, bandMax, density);

      let phase = val * bands;
      let bandIndex = floor(phase);
      let frac = phase - bandIndex;
      let isWhite = (bandIndex % 2 === 0);

      // Greyscale at edges
      let edgeW = 0.07;
      let shade;

      if (frac < edgeW) {
        let t = frac / edgeW;
        shade = isWhite ? lerp(50, 255, t * t) : lerp(205, 0, t * t);
      } else if (frac > (1.0 - edgeW)) {
        let t = (1.0 - frac) / edgeW;
        shade = isWhite ? lerp(50, 255, t * t) : lerp(205, 0, t * t);
      } else {
        shade = isWhite ? 255 : 0;
      }

      // Thin whites in dense zones
      if (density > 0.55 && isWhite) {
        let thinning = map(density, 0.55, 1.0, 0, 0.4);
        let distFromCenter = abs(frac - 0.5);
        if (distFromCenter > (0.5 - thinning)) {
          let darkAmt = map(distFromCenter, 0.5 - thinning, 0.5, 0, 1);
          darkAmt = constrain(darkAmt, 0, 1);
          shade = lerp(shade, 20, darkAmt * 0.75);
        }
      }

      // Widen in sparse zones
      if (density < 0.25 && !isWhite) {
        let widening = map(density, 0.25, 0, 0, 0.15);
        let distFromCenter = abs(frac - 0.5);
        if (distFromCenter > (0.5 - widening)) {
          let lightAmt = map(distFromCenter, 0.5 - widening, 0.5, 0, 1);
          lightAmt = constrain(lightAmt, 0, 1);
          shade = lerp(shade, 235, lightAmt * 0.5);
        }
      }

      // Stipple at density transitions
      if (x > 0 && x < W - 1 && y > 0 && y < H - 1) {
        let dL = densityMap[i - 1];
        let dR = densityMap[i + 1];
        let dU = densityMap[i - W];
        let dD = densityMap[i + W];
        let densGrad = abs(dR - dL) + abs(dD - dU);
        if (densGrad > 0.004) {
          let sn = noise(x * 0.35 + o[20], y * 0.35 + o[21]);
          let str = constrain(densGrad * 60, 0, 1) * 0.4;
          if (sn < str * 0.45) {
            shade = (shade > 127) ? max(0, shade - 170) : min(255, shade + 170);
          }
        }
      }

      shade = constrain(floor(shade), 0, 255);

      let p = i * 4;
      g.pixels[p]     = shade;
      g.pixels[p + 1] = shade;
      g.pixels[p + 2] = shade;
      g.pixels[p + 3] = 255;
    }
  }

  // Post: thicken in dense zones
  let tmp = new Uint8Array(W * H);
  for (let j = 0; j < W * H; j++) tmp[j] = g.pixels[j * 4];

  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      let i = x + y * W;
      let c = tmp[i];
      if (c > 200) {
        let density = densityMap[i];
        if (density > 0.55) {
          let minN = min(tmp[i-1], tmp[i+1], tmp[i-W], tmp[i+W]);
          if (minN < 40) {
            let spread = (density - 0.55) * 0.45;
            let darkened = floor(lerp(c, minN, spread));
            let p = i * 4;
            g.pixels[p] = darkened;
            g.pixels[p+1] = darkened;
            g.pixels[p+2] = darkened;
          }
        }
      }
    }
  }

  // Remove isolated pixels
  for (let j = 0; j < W * H; j++) tmp[j] = g.pixels[j * 4];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      let i = x + y * W;
      let c = tmp[i];
      let n = tmp[i-1] + tmp[i+1] + tmp[i-W] + tmp[i+W];
      if (c > 200 && n < 100) {
        let p = i * 4;
        g.pixels[p] = 0; g.pixels[p+1] = 0; g.pixels[p+2] = 0;
      }
      if (c < 55 && n > 920) {
        let p = i * 4;
        g.pixels[p] = 255; g.pixels[p+1] = 255; g.pixels[p+2] = 255;
      }
    }
  }

  g.updatePixels();
}
