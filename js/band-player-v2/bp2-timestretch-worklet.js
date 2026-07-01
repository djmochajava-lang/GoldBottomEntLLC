/* ============================================
   bp2-timestretch-worklet.js — Pitch-preserving time-stretch AudioWorklet
   Band Player v2.0 — Issue E2

   A WSOLA (Waveform Similarity Overlap-Add) processor. It changes TEMPO while
   preserving PITCH: the upstream AudioBufferSourceNode plays at rate 1.0 (so no
   pitch shift), and this node resamples the time axis to `tempo`x by
   overlap-adding similar waveform segments. tempo>1 = faster, tempo<1 = slower;
   pitch unchanged either way.

   Loaded via audioWorklet.addModule('js/band-player-v2/bp2-timestretch-worklet.js').
   One node per stem; `tempo` is an AudioParam (k-rate) set from BP2Transport.
   Passthrough (bit-identical) when tempo === 1.0 so 1.0x has zero artifacts/cost.

   Mono-per-channel WSOLA (each channel processed independently with the same
   analysis offsets is avoided — we compute the search on channel 0 and apply the
   same shift to all channels to keep stereo image coherent).
   ============================================ */
'use strict';

class TimeStretchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'tempo', defaultValue: 1.0, minValue: 0.25, maxValue: 4.0, automationRate: 'k-rate' }];
  }

  constructor(options) {
    super();
    const sr = sampleRate; // global in AudioWorkletGlobalScope
    // WSOLA params (44.1k-tuned; scale with sample rate).
    this.WIN = Math.round(0.030 * sr);        // ~30 ms analysis window
    this.HOP_S = Math.round(0.0075 * sr);     // ~7.5 ms synthesis hop (output)
    this.SEEK = Math.round(0.005 * sr);       // ±5 ms similarity search
    this.OVERLAP = this.WIN - this.HOP_S;     // overlap length for cross-fade
    this.channels = 0;
    this.inBuf = null;      // per-channel ring of pending input
    this.inLen = 0;
    this.readPos = 0;       // fractional input read position (in samples)
    this.prevTail = null;   // per-channel tail of the last synthesis frame (for overlap-add)
    this._hann = this._hannWindow(this.OVERLAP);
    this._done = false;
    this.port.onmessage = (e) => { if (e.data === 'flush') this._reset(); };
  }

  _hannWindow(n) {
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    return w;
  }

  _reset() {
    this.inBuf = null; this.inLen = 0; this.readPos = 0; this.prevTail = null;
  }

  _ensure(channels) {
    if (this.channels === channels && this.inBuf) return;
    this.channels = channels;
    this.inBuf = [];
    this.prevTail = [];
    for (let c = 0; c < channels; c++) {
      this.inBuf.push(new Float32Array(0));
      this.prevTail.push(new Float32Array(this.OVERLAP));
    }
    this.inLen = 0; this.readPos = 0;
  }

  _appendInput(input) {
    const ch = input.length;
    for (let c = 0; c < ch; c++) {
      const old = this.inBuf[c];
      const add = input[c];
      const merged = new Float32Array(old.length + add.length);
      merged.set(old, 0); merged.set(add, old.length);
      this.inBuf[c] = merged;
    }
    this.inLen = this.inBuf[0].length;
  }

  // Best cross-correlation offset (on channel 0) within ±SEEK of `center`,
  // matching `prevTail` (the OVERLAP-length tail we want to continue smoothly).
  _bestOffset(center) {
    const ch0 = this.inBuf[0];
    const tail = this.prevTail[0];
    const L = this.OVERLAP;
    let best = 0, bestScore = -Infinity;
    for (let d = -this.SEEK; d <= this.SEEK; d++) {
      const start = center + d;
      if (start < 0 || start + L > ch0.length) continue;
      let dot = 0, e = 1e-9;
      for (let i = 0; i < L; i += 4) { // stride 4 for speed; good enough for search
        const a = tail[i], b = ch0[start + i];
        dot += a * b; e += b * b;
      }
      const score = dot / Math.sqrt(e);
      if (score > bestScore) { bestScore = score; best = d; }
    }
    return best;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const channels = output.length;
    const frames = output[0].length;

    const tempo = parameters.tempo.length ? parameters.tempo[0] : 1.0;

    // Passthrough at tempo 1.0 — bit-identical, no WSOLA cost.
    if (Math.abs(tempo - 1.0) < 1e-3) {
      if (input && input.length) {
        for (let c = 0; c < channels; c++) output[c].set(input[Math.min(c, input.length - 1)] || new Float32Array(frames));
      }
      // keep our buffers empty so re-engaging WSOLA starts clean
      if (this.inBuf) this._reset();
      return true;
    }

    this._ensure(channels);
    if (input && input.length) this._appendInput(input);

    const HOP_IN = this.HOP_S * tempo; // advance the input read pointer by tempo*hop each synthesis frame
    let outPos = 0;
    const need = this.WIN + this.SEEK + HOP_IN + 8;

    while (outPos < frames) {
      // Not enough buffered input to synthesize another frame — emit silence for
      // the remainder of this quantum; more input arrives next call.
      if (this.readPos + need > this.inLen) {
        for (let c = 0; c < channels; c++) {
          for (let i = outPos; i < frames; i++) output[c][i] = 0;
        }
        // Drop already-consumed input to bound memory.
        this._trim();
        return true;
      }

      const center = Math.round(this.readPos);
      const off = this._bestOffset(center);
      const src = center + off;

      for (let c = 0; c < channels; c++) {
        const inp = this.inBuf[c];
        const tail = this.prevTail[c];
        // Overlap-add: cross-fade prevTail (fade-out) with the new segment head (fade-in).
        for (let i = 0; i < this.OVERLAP && outPos + i < frames; i++) {
          const fadeIn = this._hann[i];
          const fadeOut = 1 - fadeIn;
          output[c][outPos + i] = tail[i] * fadeOut + inp[src + i] * fadeIn;
        }
        // Copy the non-overlap body straight through.
        for (let i = this.OVERLAP; i < this.HOP_S && outPos + i < frames; i++) {
          output[c][outPos + i] = inp[src + i];
        }
        // Save the new tail for the next overlap-add.
        const newTail = new Float32Array(this.OVERLAP);
        for (let i = 0; i < this.OVERLAP; i++) {
          const idx = src + this.HOP_S + i;
          newTail[i] = idx < inp.length ? inp[idx] : 0;
        }
        this.prevTail[c] = newTail;
      }

      outPos += this.HOP_S;
      this.readPos += HOP_IN;
    }

    this._trim();
    return true;
  }

  // Discard input samples we've already advanced past (keep a safety margin).
  _trim() {
    const margin = this.WIN + this.SEEK + 4;
    const drop = Math.floor(this.readPos) - margin;
    if (drop > 4096) {
      for (let c = 0; c < this.channels; c++) this.inBuf[c] = this.inBuf[c].subarray(drop);
      this.readPos -= drop;
      this.inLen = this.inBuf[0].length;
    }
  }
}

registerProcessor('bp2-timestretch', TimeStretchProcessor);
