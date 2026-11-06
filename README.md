# ZOIA DFAM in JavaScript

A browser port of the Empress ZOIA patch **024 DFAM**, a drum-synth patch modelled on a semi-modular percussion synth. It runs in Web Audio with no dependencies: open `index.html` and press **Start audio**, then **Run**.

## What's in it

- Two VCOs with triangle/square switches, pitch envelopes, and sequencer pitch
- Linear FM from VCO 1 into VCO 2, and the patch's bit-XOR "sync"
- White noise, a state-variable LP/HP filter with envelope and noise modulation, and a VCA with decay and slow attack
- The 8-step pitch and velocity sequencer, plus the 16-step "Breaks" restart sequencer with Modifiers 1–4

Knobs start at the values saved in the patch. The DSP runs per sample in an AudioWorklet, with a ScriptProcessor fallback.

Keys: `space` run/stop, `T` trigger, `A` advance, `R` restart, `1`–`4` modifiers.

## Layout

| Path | What it is |
| --- | --- |
| `src/dfam-engine.js` | The DSP engine (`DFAMEngine` class), usable on its own or in Node |
| `src/page.tpl.html` | The panel UI; the engine is inlined at build time |
| `tools/build.py` | Builds `index.html` from the two files above |
| `tools/decode_patch.py` | Decodes the ZOIA `.bin` into modules and connections |
| `patch/` | The original patch and its decoded JSON |

Run `python3 tools/build.py` after editing anything in `src/`. GitHub Pages rebuilds and deploys on every push to `main`.

## Assumptions

The patch file doesn't pin these down, so they are best guesses:

- A cable into a parameter replaces the knob value, and "-1 to 1" Value modules map 0..1 to -1..1.
- Pitch CV follows ZOIA's scale: 0 is 27.5 Hz and each 0.1 is one octave, so a centred Frequency knob sits at 27.5 Hz.
- Tempo is 40 Hz × knob, so the saved setting is about 12 steps a second.
- Slow Attack is fixed at 150 ms. Reading the patch literally gives about 20 s.

Not ported: MIDI clock and note input, the external CV jack detection, and the display pixels.

Patch decoding uses the module index from [zoia_lib](https://github.com/meanmedianmoge/zoia_lib).
