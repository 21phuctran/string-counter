# String Art Line Tracker

Static web app (GitHub Pages compatible) for string-art workflows where valid steps are numeric-only lines in a text file.

## Supported file format (fixed)

The parser assumes:
- file may include header/metadata lines
- valid steps are lines containing only a single integer (e.g. `74`)
- non-numeric lines are ignored for steps, but still count as raw lines

Parsing logic in `app.js` is implemented exactly as:
1. `rawLines = fileText.split(/\r?\n/)`
2. iterate raw lines
3. `t = rawLines[i].trim()`
4. when `t` matches `/^[0-9]+$/`, push:
   - `{ value: parseInt(t, 10), text: t, rawLineNumber: i + 1 }`

## Main behavior

- 5-slot navigator: prev2, prev1, CURRENT, next1, next2
- Current step emphasizes:
  - `RAW <lineNumber>`
  - `Nail <value>`
- Next/Back move through parsed `steps[]` using `stepIndex`
- Jump input uses **raw line number**
  - exact step line: jumps directly
  - non-step line: shows “No step on that raw line”, then jumps to nearest next step line when available

## Timing/session behavior

- Step position tracking always works (session running or not)
- Timestamps/transitions are recorded only while session is running
- Current pace uses last `K=10` **Next** presses
- Session history stores timing summary + start/end indices + start/end raw line numbers

## Persistence

Saved in `localStorage`:
- `stepIndex`
- raw file text (then re-parse on restore to preserve raw line mapping)
- parsed `steps[]`
- session state/history
- display settings

## Export

- Current session transitions CSV
- Session history summary CSV

## Run locally

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

