// DFAM engine: a per-sample port of the ZOIA "DFAM" patch (024_zoia_DFAM.bin).
// Signal flow follows the patch's modules and connections; see notes in the page.
class DFAMEngine {
  constructor(sr) {
    this.sr = sr;
    // Page 0 controls. Defaults are the values saved in the patch, except both Frequency
    // knobs: the patch's 0.5 is 27.5 Hz, which laptop and phone speakers can't reproduce.
    this.p = {
      osc1EgAmt: 0, osc1PitchMod: 1, osc1Freq: 0.65, osc1Square: 0, osc1Level: 1,
      vcoDecay: 0.5,
      osc2EgAmt: 0, osc2PitchMod: 1, osc2Freq: 0.65, osc2Square: 0, osc2Level: 0,
      fmAmt: 0, noiseLevel: 0, osc2Sync: 0,
      vcfEgAmt: 0, vcfHP: 0, vcfCutoff: 1, vcfRes: 0, noiseVcfMod: 0, vcfDecay: 0.65,
      volume: 1, slowAttack: 0, vcaDecay: 0.65,
      tempo: 0.3072,
    };
    // Page 1/10: sequencers.
    this.pitch = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    this.vel = [1, 0, 0, 0.6836, 0, 0, 0.7508, 0];
    this.breaks = new Array(16).fill(0); this.breaks[15] = 1;
    this.modifiers = [0, 0, 0, 0];           // Modifier 1..4 -> Breaks Seq steps 6, 10, 4, 13
    this.modSteps = [5, 9, 3, 12];
    this.running = 0;
    this.idx = -1; this.bIdx = -1; this.restartQueued = false;
    this.clockPh = 0;
    this.pitchHold = 0.5; this.velHold = 0;
    // envelopes: [vco1, vco2, vcf, vca]
    this.env = [0, 0, 0, 0]; this.envStage = [0, 0, 0, 0]; // 0 idle, 1 attack, 2 decay
    this.ph1 = 0; this.ph2 = 0;
    this.sq1 = 0; this.sq2 = 0; this.syncS = 0; this.hpS = 0; // smoothed switches ("fades: on")
    this.ic1 = 0; this.ic2 = 0; // SVF state
    this.events = [];           // messages for the UI
  }

  // ZOIA time knob: 1.33 ms .. 60 s, geometric per quarter of travel.
  static envTime(v) {
    const pts = [1.33, 18.7, 283, 4120, 60000];
    v = Math.min(1, Math.max(0, v)) * 4;
    const i = Math.min(3, Math.floor(v)), f = v - i;
    return pts[i] * Math.pow(pts[i + 1] / pts[i], f) / 1000;
  }
  // ZOIA VCA level: 0 = -inf, .25 = -12 dB, .5 = -6 dB, .75 = -2.5 dB, 1 = 0 dB.
  static vcaGain(v) {
    if (v <= 0) return 0;
    if (v >= 1) return 1;
    if (v < 0.25) return v * 4 * 0.2512;
    const db = [-12, -6, -2.5, 0];
    const x = (v - 0.25) * 4, i = Math.min(2, Math.floor(x)), f = x - i;
    return Math.pow(10, (db[i] + (db[i + 1] - db[i]) * f) / 20);
  }
  // ZOIA 1V/oct-style CV: 0 -> 27.5 Hz, each 0.1 is an octave.
  static cvToHz(cv) { return 27.5 * Math.pow(2, 10 * cv); }

  stepsPerSec() { return 40 * this.p.tempo; } // Clock Divider "Tempo", 0..40 Hz

  clock() {
    // Breaks Seq (16 steps) and the main 8-step seqs share the clock.
    this.bIdx = (this.bIdx + 1) % 16;
    if (this.restartQueued) { this.idx = 0; this.restartQueued = false; }
    else this.idx = (this.idx + 1) % 8;
    const b = this.bIdx;
    const mi = this.modSteps.indexOf(b);
    const high = mi >= 0 ? this.modifiers[mi] : this.breaks[b];
    if (high > 0.5) this.restartQueued = true; // queue_start: restart on next clock
    this.events.push({ type: 'step', idx: this.idx, bIdx: this.bIdx });
    // Gate Detect = (velocity > 0) x gate track, so only steps with velocity fire.
    if (this.vel[this.idx] > 0) this.trigger();
  }
  trigger() {
    const i = this.idx < 0 ? 0 : this.idx;
    this.pitchHold = this.pitch[i];   // OSC1/OSC2 Sustain (sample & hold)
    this.velHold = this.vel[i];       // Velocity Sust (sample & hold)
    for (let e = 0; e < 4; e++) this.envStage[e] = 1;
    this.events.push({ type: 'hit', idx: i });
  }
  restart() { this.idx = -1; this.bIdx = -1; this.restartQueued = false; this.events.push({ type: 'step', idx: -1, bIdx: -1 }); }
  advance() { this.clock(); }
  setRunning(r) { if (r && !this.running) this.clockPh = 1; this.running = r ? 1 : 0; }

  static polyblep(t, dt) {
    if (t < dt) { t /= dt; return t + t - t * t - 1; }
    if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
    return 0;
  }

  process(L, R, n) {
    const p = this.p, sr = this.sr, inv = 1 / sr;
    const nyq = sr * 0.45;
    // per-block coefficients
    const dVco = DFAMEngine.envTime(p.vcoDecay * 0.975);
    const dVcf = DFAMEngine.envTime(p.vcfDecay * 0.975);
    const dVca = DFAMEngine.envTime(p.vcaDecay * 0.975);
    const k40 = Math.log(100);
    const decMul = [Math.exp(-k40 / (dVco * sr)), Math.exp(-k40 / (dVco * sr)), Math.exp(-k40 / (dVcf * sr)), Math.exp(-k40 / (dVca * sr))];
    const fastA = 1 / (0.00133 * sr);
    const atkInc = [fastA, fastA, fastA, p.slowAttack ? 1 / (0.15 * sr) : fastA];
    const g1 = DFAMEngine.vcaGain(p.osc1Level * 0.969);
    const g2 = DFAMEngine.vcaGain(p.osc2Level * 0.969);
    const gN = DFAMEngine.vcaGain(p.noiseLevel * 0.896);
    const gFM = DFAMEngine.vcaGain(p.fmAmt);
    const gVol = DFAMEngine.vcaGain(p.volume);
    const Q = Math.pow(1000, p.vcfRes), kq = 1 / Q;
    const sm = 1 - Math.exp(-1 / (0.005 * sr));
    const clkInc = this.stepsPerSec() * inv;
    const env = this.env, st = this.envStage;

    for (let s = 0; s < n; s++) {
      if (this.running) {
        this.clockPh += clkInc;
        if (this.clockPh >= 1) { this.clockPh -= Math.floor(this.clockPh); this.clock(); }
      }
      for (let e = 0; e < 4; e++) {
        if (st[e] === 1) { env[e] += atkInc[e]; if (env[e] >= 1) { env[e] = 1; st[e] = 2; } }
        else if (st[e] === 2) { env[e] *= decMul[e]; if (env[e] < 1e-5) { env[e] = 0; st[e] = 0; } }
      }
      const vh = this.velHold;
      const seqOff = 0.969 * (2 * this.pitchHold - 1);

      // VCO 1
      const cv1 = 0.969 * (2 * p.osc1Freq - 1) + (p.osc1PitchMod ? seqOff : 0) + env[0] * vh * p.osc1EgAmt * 0.956;
      const f1 = Math.min(nyq, DFAMEngine.cvToHz(cv1));
      const dt1 = f1 * inv;
      this.ph1 += dt1; if (this.ph1 >= 1) this.ph1 -= 1;
      const tri1 = 1 - 4 * Math.abs(this.ph1 - 0.5);
      let sqr1 = this.ph1 < 0.5 ? 1 : -1;
      sqr1 += DFAMEngine.polyblep(this.ph1, dt1) - DFAMEngine.polyblep((this.ph1 + 0.5) % 1, dt1);
      this.sq1 += (p.osc1Square - this.sq1) * sm;
      const vco1 = tri1 + (sqr1 - tri1) * this.sq1;

      // VCO 2 with linear (through-zero) FM from VCO 1 via the "FM Amt" VCA
      const cv2 = 0.969 * (2 * p.osc2Freq - 1) + (p.osc2PitchMod ? seqOff : 0) + env[1] * vh * p.osc2EgAmt * 0.956;
      const f2b = Math.min(nyq, DFAMEngine.cvToHz(cv2));
      let f2 = f2b + vco1 * gFM * f2b * 4;
      if (f2 > nyq) f2 = nyq; else if (f2 < -nyq) f2 = -nyq;
      const dt2 = f2 * inv;
      this.ph2 += dt2; this.ph2 -= Math.floor(this.ph2);
      const tri2 = 1 - 4 * Math.abs(this.ph2 - 0.5);
      const adt2 = Math.abs(dt2);
      let sqr2 = this.ph2 < 0.5 ? 1 : -1;
      sqr2 += DFAMEngine.polyblep(this.ph2, adt2) - DFAMEngine.polyblep((this.ph2 + 0.5) % 1, adt2);
      this.sq2 += (p.osc2Square - this.sq2) * sm;
      const vco2 = tri2 + (sqr2 - tri2) * this.sq2;

      // "OSC2 Sync" = Bit Modulator (XOR of VCO2 and VCO1)
      const a = Math.round(Math.max(-1, Math.min(1, vco2 * 0.896)) * 32767);
      const b = Math.round(Math.max(-1, Math.min(1, vco1 * 0.898)) * 32767);
      const xr = (((a ^ b) << 16) >> 16) / 32768;
      this.syncS += (p.osc2Sync - this.syncS) * sm;
      const osc2 = vco2 + (xr - vco2) * this.syncS;

      const noise = Math.random() * 2 - 1;
      const mix = vco1 * g1 + osc2 * g2 + noise * gN;

      // VCF: cutoff + EG + noise CV ("CV Noise Gen" x Noise-VCF Mod)
      const mod = Math.random() * 0.897 * p.noiseVcfMod;
      const fcv = p.vcfCutoff + env[2] * vh * (p.vcfEgAmt + mod) + mod;
      const fc = Math.max(20, Math.min(Math.min(23999, sr * 0.49), DFAMEngine.cvToHz(fcv)));
      const g = Math.tan(Math.PI * fc * inv);
      const a1 = 1 / (1 + g * (g + kq)), a2 = g * a1, a3 = g * a2;
      const v3 = mix - this.ic2;
      const v1 = a1 * this.ic1 + a2 * v3;
      const v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
      this.ic1 = 2 * v1 - this.ic1; this.ic2 = 2 * v2 - this.ic2;
      const lp = v2, hp = mix - kq * v1 - v2;
      this.hpS += (p.vcfHP - this.hpS) * sm;
      const filt = lp + (hp - lp) * this.hpS;

      // VCA (Volume ENV x velocity) then Main Volume
      let out = filt * DFAMEngine.vcaGain(env[3] * vh) * gVol;
      if (out > 1) out = 1; else if (out < -1) out = -1;
      if (out !== out) { out = 0; this.ic1 = 0; this.ic2 = 0; }
      L[s] = out; R[s] = out;
    }
  }

  set(msg) {
    switch (msg.type) {
      case 'param': this.p[msg.key] = msg.value; break;
      case 'pitch': this.pitch[msg.i] = msg.value; break;
      case 'vel': this.vel[msg.i] = msg.value; break;
      case 'breaks': this.breaks[msg.i] = msg.value; break;
      case 'modifier': this.modifiers[msg.i] = msg.value; break;
      case 'run': this.setRunning(msg.value); break;
      case 'trigger': this.trigger(); break;
      case 'advance': this.advance(); break;
      case 'restart': this.restart(); break;
    }
  }
}
if (typeof module !== 'undefined') module.exports = DFAMEngine;
