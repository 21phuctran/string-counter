# String Art Progress Tracker

A lightweight static web app for tracking progress through a plain-text string art instruction list.

## Features

- Upload local `.txt` instruction files (no backend required)
- Parses one non-empty line per step, trims trailing whitespace, preserves interior text
- 5-item navigator (previous 2, current, next 2)
- Progress status: step number, percent, progress bar, remaining, ETA
- Session timing and pace metrics
  - Current pace from recent transitions (window size configurable in `app.js`)
  - Overall average pace during active session time
  - Trend indicator (faster/slower)
- Session lifecycle
  - Start / Pause / End Session
  - Resets can auto-end the active session
- Session history panel with expandable details and notes
- CSV export
  - Current session transitions
  - Session summary history
- Keyboard shortcuts
  - `Right Arrow` / `Space`: Next
  - `Left Arrow`: Back
- Mobile-friendly controls with large tap targets and bottom Next button
- Accessibility-minded semantic layout, focus states, and keyboard support
- Local persistence via `localStorage`

## GitHub Pages setup

Because the app is fully static, it works directly on GitHub Pages.

1. Push this repository to GitHub.
2. In repository settings, open **Pages**.
3. Set source to your main branch (root folder).
4. Save and open the published URL.

## Local development

You can run locally with any static file server.

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Usage

1. Upload a text file where each non-empty line is a step.
2. Use **Start** to begin a session timer.
3. Use **Next**/**Back** (or keyboard shortcuts) to navigate steps.
4. Add optional notes for the active session.
5. End session to save it in history.
6. Use export buttons to download CSV files.
7. Toggle high contrast and large fonts in Settings.
8. Use **Clear Storage** to erase local saved state.

## Key implementation notes

- All logic lives in `app.js` (vanilla JavaScript, no external frameworks)
- UI structure is in `index.html`
- Styling and responsive behavior are in `styles.css`
- Persistence key: `stringArtTrackerStateV1`

