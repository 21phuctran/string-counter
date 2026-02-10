const STORAGE_KEY = "stringArtTrackerStateV1";
const RECENT_TRANSITIONS_WINDOW = 10;
const BLEND_CURRENT_WEIGHT = 0.7;

const state = {
  fileName: "",
  steps: [],
  currentStepIndex: 0,
  highContrast: false,
  largeFont: false,
  activeSession: null,
  sessionHistory: [],
};

const dom = {
  fileInput: document.getElementById("fileInput"),
  fileMeta: document.getElementById("fileMeta"),
  errorMessage: document.getElementById("errorMessage"),
  slotPrev2: document.getElementById("slotPrev2"),
  slotPrev1: document.getElementById("slotPrev1"),
  slotCurrent: document.getElementById("slotCurrent"),
  slotNext1: document.getElementById("slotNext1"),
  slotNext2: document.getElementById("slotNext2"),
  stepText: document.getElementById("stepText"),
  percentText: document.getElementById("percentText"),
  progressBar: document.getElementById("progressBar"),
  remainingText: document.getElementById("remainingText"),
  etaText: document.getElementById("etaText"),
  elapsedText: document.getElementById("elapsedText"),
  currentPaceText: document.getElementById("currentPaceText"),
  averagePaceText: document.getElementById("averagePaceText"),
  trendText: document.getElementById("trendText"),
  backBtn: document.getElementById("backBtn"),
  nextBtn: document.getElementById("nextBtn"),
  nextBottomBtn: document.getElementById("nextBottomBtn"),
  startPauseBtn: document.getElementById("startPauseBtn"),
  endSessionBtn: document.getElementById("endSessionBtn"),
  resetBtn: document.getElementById("resetBtn"),
  jumpInput: document.getElementById("jumpInput"),
  jumpBtn: document.getElementById("jumpBtn"),
  sessionHistory: document.getElementById("sessionHistory"),
  exportTransitionsBtn: document.getElementById("exportTransitionsBtn"),
  exportHistoryBtn: document.getElementById("exportHistoryBtn"),
  contrastToggleBtn: document.getElementById("contrastToggleBtn"),
  fontToggleBtn: document.getElementById("fontToggleBtn"),
  notesInput: document.getElementById("notesInput"),
  clearStorageBtn: document.getElementById("clearStorageBtn"),
};

let elapsedInterval = null;

function getNowIso() {
  return new Date().toISOString();
}

function parseInstructions(text) {
  const lines = text.split(/\r?\n/);
  return lines
    .map((line) => line.replace(/[\t ]+$/g, ""))
    .filter((line) => line.trim().length > 0);
}

function simpleHash(steps) {
  let hash = 0;
  for (const step of steps) {
    for (let i = 0; i < step.length; i += 1) {
      hash = (hash * 31 + step.charCodeAt(i)) >>> 0;
    }
  }
  return hash.toString(16);
}

function hasSteps() {
  return state.steps.length > 0;
}

function getCurrentStepNumber() {
  return hasSteps() ? state.currentStepIndex + 1 : 0;
}

function ensureIndexBounds() {
  if (!hasSteps()) {
    state.currentStepIndex = 0;
    return;
  }
  if (state.currentStepIndex < 0) state.currentStepIndex = 0;
  if (state.currentStepIndex > state.steps.length - 1) state.currentStepIndex = state.steps.length - 1;
}

function getElapsedActiveSeconds() {
  if (!state.activeSession) return 0;
  const base = state.activeSession.accumulatedActiveSeconds || 0;
  if (state.activeSession.running && state.activeSession.lastResumeTime) {
    const delta = Math.max(0, (Date.now() - new Date(state.activeSession.lastResumeTime).getTime()) / 1000);
    return base + delta;
  }
  return base;
}

function formatDuration(seconds) {
  const clamped = Math.max(0, Math.floor(seconds));
  const hh = Math.floor(clamped / 3600);
  const mm = Math.floor((clamped % 3600) / 60);
  const ss = clamped % 60;
  if (hh > 0) {
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function setPlaceholder(el) {
  el.textContent = "—";
  el.classList.add("placeholder");
}

function setStepContent(el, text) {
  el.textContent = text;
  el.classList.remove("placeholder");
}

function renderNavigator() {
  const idx = state.currentStepIndex;
  const slots = [
    { el: dom.slotPrev2, target: idx - 2 },
    { el: dom.slotPrev1, target: idx - 1 },
    { el: dom.slotCurrent, target: idx },
    { el: dom.slotNext1, target: idx + 1 },
    { el: dom.slotNext2, target: idx + 2 },
  ];

  for (const slot of slots) {
    if (!hasSteps() || slot.target < 0 || slot.target >= state.steps.length) {
      setPlaceholder(slot.el);
    } else {
      setStepContent(slot.el, state.steps[slot.target]);
    }
  }
}

function getTransitionStats() {
  if (!state.activeSession) {
    return {
      currentSpm: null,
      avgSpm: null,
      trendText: "Trend: —",
      eta: null,
    };
  }

  const transitions = state.activeSession.transitions || [];
  const nextTransitions = transitions.filter((t) => t.direction === "next");
  const currentWindow = transitions.slice(-RECENT_TRANSITIONS_WINDOW);
  const currentMinutes = (() => {
    if (currentWindow.length < 2) return 0;
    const first = new Date(currentWindow[0].timestamp).getTime();
    const last = new Date(currentWindow[currentWindow.length - 1].timestamp).getTime();
    return Math.max(0, (last - first) / 60000);
  })();
  const currentSpm = currentMinutes > 0 ? (currentWindow.length - 1) / currentMinutes : null;

  const elapsedMinutes = getElapsedActiveSeconds() / 60;
  const avgSpm = elapsedMinutes > 0 ? nextTransitions.length / elapsedMinutes : null;

  let trendText = "Trend: —";
  if (currentSpm && avgSpm && avgSpm > 0) {
    const diffPct = ((currentSpm - avgSpm) / avgSpm) * 100;
    const label = diffPct >= 0 ? "Faster" : "Slower";
    trendText = `Trend: ${label} (${Math.abs(diffPct).toFixed(0)}%)`;
  }

  let eta = null;
  const remainingSteps = hasSteps() ? Math.max(0, state.steps.length - getCurrentStepNumber()) : 0;
  if (remainingSteps > 0 && transitions.length >= 3) {
    const blended = (() => {
      if (currentSpm && avgSpm) return BLEND_CURRENT_WEIGHT * currentSpm + (1 - BLEND_CURRENT_WEIGHT) * avgSpm;
      return currentSpm || avgSpm || null;
    })();
    if (blended && blended > 0) {
      eta = (remainingSteps / blended) * 60;
    }
  }

  return { currentSpm, avgSpm, trendText, eta };
}

function renderMetrics() {
  const total = state.steps.length;
  const current = getCurrentStepNumber();
  const percent = total > 0 ? (current / total) * 100 : 0;
  const remaining = total > 0 ? Math.max(0, total - current) : 0;

  dom.stepText.textContent = `Step ${current} of ${total}`;
  dom.percentText.textContent = `${percent.toFixed(1)}% complete`;
  dom.progressBar.style.width = `${percent}%`;
  dom.remainingText.textContent = `Remaining steps: ${remaining}`;

  dom.elapsedText.textContent = `Elapsed: ${formatDuration(getElapsedActiveSeconds())}`;
  const stats = getTransitionStats();
  dom.currentPaceText.textContent = `Current pace: ${stats.currentSpm ? stats.currentSpm.toFixed(2) : "—"} spm`;
  dom.averagePaceText.textContent = `Average pace: ${stats.avgSpm ? stats.avgSpm.toFixed(2) : "—"} spm`;
  dom.trendText.textContent = stats.trendText;
  dom.etaText.textContent = `ETA: ${stats.eta ? formatDuration(stats.eta) : "—"}`;
}

function renderFileMeta() {
  if (!hasSteps()) {
    dom.fileMeta.textContent = "No file loaded.";
    return;
  }
  dom.fileMeta.textContent = `Loaded: ${state.fileName} • ${state.steps.length} steps • hash ${simpleHash(state.steps)}`;
}

function updateControls() {
  const loaded = hasSteps();
  const atStart = !loaded || state.currentStepIndex <= 0;
  const atEnd = !loaded || state.currentStepIndex >= state.steps.length - 1;

  dom.backBtn.disabled = atStart;
  dom.nextBtn.disabled = atEnd;
  dom.nextBottomBtn.disabled = atEnd;
  dom.jumpBtn.disabled = !loaded;
  dom.startPauseBtn.disabled = !loaded;
  dom.endSessionBtn.disabled = !state.activeSession;
  dom.resetBtn.disabled = !loaded;
  dom.exportTransitionsBtn.disabled = !state.activeSession || !(state.activeSession.transitions || []).length;
  dom.exportHistoryBtn.disabled = state.sessionHistory.length === 0;

  if (!state.activeSession) {
    dom.startPauseBtn.textContent = "Start";
    dom.notesInput.value = "";
    dom.notesInput.disabled = true;
  } else {
    dom.startPauseBtn.textContent = state.activeSession.running ? "Pause" : "Start";
    dom.notesInput.disabled = false;
    if (dom.notesInput !== document.activeElement) {
      dom.notesInput.value = state.activeSession.notes || "";
    }
  }
}

function renderHistory() {
  dom.sessionHistory.innerHTML = "";
  if (!state.sessionHistory.length) {
    dom.sessionHistory.textContent = "No sessions yet.";
    return;
  }

  for (const session of state.sessionHistory) {
    const item = document.createElement("article");
    item.className = "history-item";

    const head = document.createElement("button");
    head.className = "history-head";
    head.type = "button";
    head.setAttribute("aria-expanded", "false");

    const left = document.createElement("span");
    left.textContent = new Date(session.startTime).toLocaleString();
    const right = document.createElement("span");
    right.textContent = `${formatDuration(session.durationSeconds)} • ${session.stepsCompleted} steps • ${session.averageStepsPerMin.toFixed(2)} spm`;

    head.append(left, right);

    const details = document.createElement("div");
    details.className = "history-details";
    details.hidden = true;
    details.innerHTML = `
      <div>Start step: ${session.startStepIndex + 1}</div>
      <div>End step: ${session.endStepIndex + 1}</div>
      <div>Session ID: ${session.sessionId}</div>
      <div>End time: ${new Date(session.endTime).toLocaleString()}</div>
      <div>Notes: ${session.notes ? escapeHtml(session.notes) : "(none)"}</div>
    `;

    head.addEventListener("click", () => {
      const isOpen = !details.hidden;
      details.hidden = isOpen;
      head.setAttribute("aria-expanded", String(!isOpen));
    });

    item.append(head, details);
    dom.sessionHistory.appendChild(item);
  }
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderAll() {
  ensureIndexBounds();
  renderFileMeta();
  renderNavigator();
  renderMetrics();
  renderHistory();
  updateControls();
  applyTheme();
  persistState();
}

function persistState() {
  const payload = {
    ...state,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function restoreState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    state.fileName = parsed.fileName || "";
    state.steps = Array.isArray(parsed.steps) ? parsed.steps : [];
    state.currentStepIndex = Number.isInteger(parsed.currentStepIndex) ? parsed.currentStepIndex : 0;
    state.highContrast = Boolean(parsed.highContrast);
    state.largeFont = Boolean(parsed.largeFont);
    state.activeSession = parsed.activeSession || null;
    state.sessionHistory = Array.isArray(parsed.sessionHistory) ? parsed.sessionHistory : [];
  } catch (_err) {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function applyTheme() {
  document.body.classList.toggle("high-contrast", state.highContrast);
  document.body.classList.toggle("large-font", state.largeFont);
}

function startElapsedTicker() {
  stopElapsedTicker();
  elapsedInterval = setInterval(() => {
    dom.elapsedText.textContent = `Elapsed: ${formatDuration(getElapsedActiveSeconds())}`;
    const stats = getTransitionStats();
    dom.currentPaceText.textContent = `Current pace: ${stats.currentSpm ? stats.currentSpm.toFixed(2) : "—"} spm`;
    dom.averagePaceText.textContent = `Average pace: ${stats.avgSpm ? stats.avgSpm.toFixed(2) : "—"} spm`;
    dom.trendText.textContent = stats.trendText;
    dom.etaText.textContent = `ETA: ${stats.eta ? formatDuration(stats.eta) : "—"}`;
  }, 1000);
}

function stopElapsedTicker() {
  if (elapsedInterval) {
    clearInterval(elapsedInterval);
    elapsedInterval = null;
  }
}

function beginOrResumeSession() {
  if (!hasSteps()) return;
  if (!state.activeSession) {
    state.activeSession = {
      sessionId: String(Date.now()),
      startTime: getNowIso(),
      endTime: null,
      accumulatedActiveSeconds: 0,
      lastResumeTime: getNowIso(),
      running: true,
      startStepIndex: state.currentStepIndex,
      endStepIndex: state.currentStepIndex,
      stepsCompleted: 0,
      transitions: [],
      notes: "",
    };
  } else if (!state.activeSession.running) {
    state.activeSession.running = true;
    state.activeSession.lastResumeTime = getNowIso();
  }
  startElapsedTicker();
  renderAll();
}

function pauseSession() {
  if (!state.activeSession || !state.activeSession.running) return;
  const delta = Math.max(0, (Date.now() - new Date(state.activeSession.lastResumeTime).getTime()) / 1000);
  state.activeSession.accumulatedActiveSeconds += delta;
  state.activeSession.lastResumeTime = null;
  state.activeSession.running = false;
  stopElapsedTicker();
  renderAll();
}

function endSession(triggeredByReset = false) {
  if (!state.activeSession) return;
  if (state.activeSession.running && state.activeSession.lastResumeTime) {
    const delta = Math.max(0, (Date.now() - new Date(state.activeSession.lastResumeTime).getTime()) / 1000);
    state.activeSession.accumulatedActiveSeconds += delta;
  }

  state.activeSession.endTime = getNowIso();
  state.activeSession.endStepIndex = state.currentStepIndex;

  const duration = Math.max(0, Math.floor(state.activeSession.accumulatedActiveSeconds));
  const avgSpm = duration > 0 ? state.activeSession.stepsCompleted / (duration / 60) : 0;

  const summary = {
    sessionId: state.activeSession.sessionId,
    startTime: state.activeSession.startTime,
    endTime: state.activeSession.endTime,
    durationSeconds: duration,
    startStepIndex: state.activeSession.startStepIndex,
    endStepIndex: state.activeSession.endStepIndex,
    stepsCompleted: state.activeSession.stepsCompleted,
    averageStepsPerMin: avgSpm,
    notes: state.activeSession.notes || "",
  };

  state.sessionHistory.unshift(summary);
  state.activeSession = null;
  stopElapsedTicker();

  if (!triggeredByReset) {
    alert("Session ended and saved to history.");
  }

  renderAll();
}

function moveToStep(nextIndex, direction) {
  if (!hasSteps()) return;
  const bounded = Math.min(Math.max(nextIndex, 0), state.steps.length - 1);
  if (bounded === state.currentStepIndex) return;

  const from = state.currentStepIndex;
  state.currentStepIndex = bounded;

  if (state.activeSession) {
    state.activeSession.endStepIndex = bounded;
    if (state.activeSession.running) {
      state.activeSession.transitions.push({
        stepIndexFrom: from,
        stepIndexTo: bounded,
        direction,
        timestamp: getNowIso(),
      });
      if (direction === "next") {
        state.activeSession.stepsCompleted += 1;
      }
    }
  }

  renderAll();
}

function resetProgress() {
  if (!hasSteps()) return;
  if (!confirm("Reset progress and end active session?")) return;
  if (state.activeSession) {
    endSession(true);
  }
  state.currentStepIndex = 0;
  renderAll();
}

function handleFileUpload(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const text = typeof reader.result === "string" ? reader.result : "";
    const parsedSteps = parseInstructions(text);

    if (!parsedSteps.length) {
      dom.errorMessage.textContent = "The uploaded file has no valid non-empty instruction steps.";
      return;
    }

    const replacingLoaded = hasSteps();
    if (replacingLoaded && !confirm("Replacing steps will overwrite current progress. Continue?")) {
      dom.fileInput.value = "";
      return;
    }

    if (state.activeSession) {
      endSession(true);
    }

    state.fileName = file.name;
    state.steps = parsedSteps;
    state.currentStepIndex = 0;
    dom.errorMessage.textContent = "";
    renderAll();
  };
  reader.onerror = () => {
    dom.errorMessage.textContent = "Unable to read file. Please try another text file.";
  };
  reader.readAsText(file);
}

function jumpToInputStep() {
  if (!hasSteps()) return;
  const input = Number.parseInt(dom.jumpInput.value, 10);
  if (Number.isNaN(input)) {
    dom.errorMessage.textContent = "Enter a valid step number.";
    return;
  }
  if (input < 1 || input > state.steps.length) {
    dom.errorMessage.textContent = `Step must be between 1 and ${state.steps.length}.`;
    return;
  }
  dom.errorMessage.textContent = "";
  const target = input - 1;
  const direction = target >= state.currentStepIndex ? "next" : "back";
  moveToStep(target, direction);
}

function toCsv(rows) {
  return rows
    .map((row) =>
      row
        .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
        .join(",")
    )
    .join("\n");
}

function downloadCsv(filename, csvText) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportTransitionsCsv() {
  if (!state.activeSession || !state.activeSession.transitions.length) {
    alert("No current-session transitions to export.");
    return;
  }

  const rows = [["stepIndexFrom", "stepIndexTo", "timestamp"]];
  for (const t of state.activeSession.transitions) {
    rows.push([t.stepIndexFrom, t.stepIndexTo, t.timestamp]);
  }
  downloadCsv(`session-${state.activeSession.sessionId}-transitions.csv`, toCsv(rows));
}

function exportHistoryCsv() {
  if (!state.sessionHistory.length) {
    alert("No session history to export.");
    return;
  }
  const rows = [["sessionId", "startTime", "endTime", "durationSeconds", "startStepIndex", "endStepIndex", "stepsCompleted", "averageStepsPerMin", "notes"]];
  for (const s of state.sessionHistory) {
    rows.push([
      s.sessionId,
      s.startTime,
      s.endTime,
      s.durationSeconds,
      s.startStepIndex,
      s.endStepIndex,
      s.stepsCompleted,
      s.averageStepsPerMin,
      s.notes || "",
    ]);
  }
  downloadCsv("session-history.csv", toCsv(rows));
}

function clearStorage() {
  if (!confirm("Clear all saved local storage data for this app?")) return;
  localStorage.removeItem(STORAGE_KEY);
  state.fileName = "";
  state.steps = [];
  state.currentStepIndex = 0;
  state.activeSession = null;
  state.sessionHistory = [];
  stopElapsedTicker();
  renderAll();
}

function handleKeyDown(event) {
  const tag = (event.target && event.target.tagName) || "";
  const inEditable = ["INPUT", "TEXTAREA", "SELECT"].includes(tag);
  if (inEditable) return;

  if (event.key === "ArrowRight" || event.key === " ") {
    event.preventDefault();
    moveToStep(state.currentStepIndex + 1, "next");
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    moveToStep(state.currentStepIndex - 1, "back");
  }
}

function initEvents() {
  dom.fileInput.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    handleFileUpload(file);
  });

  dom.nextBtn.addEventListener("click", () => moveToStep(state.currentStepIndex + 1, "next"));
  dom.nextBottomBtn.addEventListener("click", () => moveToStep(state.currentStepIndex + 1, "next"));
  dom.backBtn.addEventListener("click", () => moveToStep(state.currentStepIndex - 1, "back"));
  dom.jumpBtn.addEventListener("click", jumpToInputStep);
  dom.jumpInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") jumpToInputStep();
  });

  dom.startPauseBtn.addEventListener("click", () => {
    if (!state.activeSession || !state.activeSession.running) {
      beginOrResumeSession();
    } else {
      pauseSession();
    }
  });

  dom.endSessionBtn.addEventListener("click", () => {
    if (!state.activeSession) return;
    if (confirm("End current session?")) {
      endSession();
    }
  });

  dom.resetBtn.addEventListener("click", resetProgress);
  dom.exportTransitionsBtn.addEventListener("click", exportTransitionsCsv);
  dom.exportHistoryBtn.addEventListener("click", exportHistoryCsv);

  dom.contrastToggleBtn.addEventListener("click", () => {
    state.highContrast = !state.highContrast;
    renderAll();
  });

  dom.fontToggleBtn.addEventListener("click", () => {
    state.largeFont = !state.largeFont;
    renderAll();
  });

  dom.notesInput.addEventListener("input", () => {
    if (state.activeSession) {
      state.activeSession.notes = dom.notesInput.value;
      persistState();
    }
  });

  dom.clearStorageBtn.addEventListener("click", clearStorage);

  document.addEventListener("keydown", handleKeyDown);
}

function boot() {
  restoreState();
  initEvents();

  if (state.activeSession && state.activeSession.running) {
    startElapsedTicker();
  }

  renderAll();
}

boot();
