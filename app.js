const STORAGE_KEY = "stringArtTrackerStateV2";
const RECENT_NEXT_WINDOW = 10;
const BLEND_CURRENT_WEIGHT = 0.7;

const state = {
  fileName: "",
  rawFileText: "",
  rawLineCount: 0,
  steps: [], // [{ value, text, rawLineNumber }]
  threadMarkers: [], // [{ rawLineNumber, r, g, b }]
  threadStatusRawLine: null,
  stepIndex: 0,
  highContrast: false,
  largeFont: false,
  activeSession: null,
  sessionHistory: [],
};

const dom = {
  fileInput: document.getElementById("fileInput"),
  fileMeta: document.getElementById("fileMeta"),
  errorMessage: document.getElementById("errorMessage"),
  hintMessage: document.getElementById("hintMessage"),
  threadSwatch: document.getElementById("threadSwatch"),
  threadValue: document.getElementById("threadValue"),
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
  jumpInput: document.getElementById("jumpInput"),
  jumpBtn: document.getElementById("jumpBtn"),
  startPauseBtn: document.getElementById("startPauseBtn"),
  endSessionBtn: document.getElementById("endSessionBtn"),
  resetBtn: document.getElementById("resetBtn"),
  sessionHistory: document.getElementById("sessionHistory"),
  exportTransitionsBtn: document.getElementById("exportTransitionsBtn"),
  exportHistoryBtn: document.getElementById("exportHistoryBtn"),
  contrastToggleBtn: document.getElementById("contrastToggleBtn"),
  fontToggleBtn: document.getElementById("fontToggleBtn"),
  notesInput: document.getElementById("notesInput"),
  clearStorageBtn: document.getElementById("clearStorageBtn"),
};

let elapsedInterval = null;
let threadToastTimeout = null;

function getNowIso() {
  return new Date().toISOString();
}

// EXACT parsing required by user instructions.
function parseStepFile(fileText) {
  const rawLines = fileText.split(/\r?\n/); // 1)
  const steps = []; // 2)
  const threadMarkers = [];
  const threadRegex = /^Thread:\s*\[\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\]\s*$/;
  const numericRegex = /^[0-9]+$/;

  for (let i = 0; i < rawLines.length; i += 1) {
    const t = rawLines[i].trim(); // 3)

    const threadMatch = t.match(threadRegex);
    if (threadMatch) {
      threadMarkers.push({
        rawLineNumber: i + 1,
        r: Number(threadMatch[1]),
        g: Number(threadMatch[2]),
        b: Number(threadMatch[3]),
      });
      continue;
    }

    if (numericRegex.test(t)) {
      steps.push({
        value: Number(t),
        text: t,
        rawLineNumber: i + 1,
      });
      continue;
    }
  }

  // Dev sanity check: ensure an immediate numeric line after a thread marker is not skipped.
  const stepLineSet = new Set(steps.map((step) => step.rawLineNumber));
  for (let i = 0; i < rawLines.length - 1; i += 1) {
    const current = rawLines[i].trim();
    const next = rawLines[i + 1].trim();
    if (threadRegex.test(current) && numericRegex.test(next) && !stepLineSet.has(i + 2)) {
      console.warn(`[parser-check] Missing numeric step immediately after thread marker at line ${i + 1}.`);
    }
  }

  return { rawLines, steps, threadMarkers };
}


function getThreadForRawLine(rawLineNumber) {
  if (!rawLineNumber) return null;
  let current = null;
  for (const marker of state.threadMarkers) {
    if (marker.rawLineNumber <= rawLineNumber) current = marker;
    else break;
  }
  return current;
}

function findStepIndexByRawLine(rawLineNumber) {
  return state.steps.findIndex((s) => s.rawLineNumber === rawLineNumber);
}

function findNextStepIndexAfterRawLine(rawLineNumber) {
  return state.steps.findIndex((s) => s.rawLineNumber > rawLineNumber);
}


function formatRGB(marker) {
  return `[${marker.r}, ${marker.g}, ${marker.b}]`;
}

function getThreadMarkerBetweenSteps(leftStepIndex, rightStepIndex) {
  if (leftStepIndex < 0 || rightStepIndex < 0) return null;
  const leftRaw = state.steps[leftStepIndex]?.rawLineNumber;
  const rightRaw = state.steps[rightStepIndex]?.rawLineNumber;
  if (!leftRaw || !rightRaw) return null;
  return state.threadMarkers.find((m) => m.rawLineNumber > leftRaw && m.rawLineNumber <= rightRaw) || null;
}

function buildNavigatorItems() {
  if (!hasSteps()) {
    return { prev2: null, prev1: null, current: null, next1: null, next2: null };
  }

  const currentIndex = state.stepIndex;
  const leftItems = [];
  for (let li = currentIndex - 1; li >= 0 && leftItems.length < 2; li -= 1) {
    const marker = getThreadMarkerBetweenSteps(li, li + 1);
    if (marker && leftItems.length < 2) {
      leftItems.push({ type: "thread", marker });
    }
    if (leftItems.length < 2) {
      leftItems.push({ type: "step", step: state.steps[li] });
    }
  }

  const rightItems = [];
  for (let ri = currentIndex + 1; ri < state.steps.length && rightItems.length < 2; ri += 1) {
    const marker = getThreadMarkerBetweenSteps(ri - 1, ri);
    if (marker && rightItems.length < 2) {
      rightItems.push({ type: "thread", marker });
    }
    if (rightItems.length < 2) {
      rightItems.push({ type: "step", step: state.steps[ri] });
    }
  }

  return {
    prev2: leftItems[1] || null,
    prev1: leftItems[0] || null,
    current: { type: "step", step: state.steps[currentIndex] },
    next1: rightItems[0] || null,
    next2: rightItems[1] || null,
  };
}

function ensureThreadToast() {
  let el = document.getElementById("threadToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "threadToast";
    el.className = "thread-toast";
    document.body.appendChild(el);
  }
  return el;
}

function showThreadChangeToast(marker) {
  if (!marker) return;
  const toast = ensureThreadToast();
  toast.innerHTML = `<span class="thread-swatch" style="background-color: rgb(${marker.r}, ${marker.g}, ${marker.b})" aria-hidden="true"></span><span>Thread changed to ${formatRGB(marker)}</span>`;
  toast.classList.add("show");
  if (threadToastTimeout) clearTimeout(threadToastTimeout);
  threadToastTimeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 2000);
}

function renderThreadStatus() {
  const rawLine = state.threadStatusRawLine ?? (hasSteps() ? state.steps[state.stepIndex]?.rawLineNumber : null);
  const thread = getThreadForRawLine(rawLine || null);
  if (thread) {
    dom.threadSwatch.style.backgroundColor = `rgb(${thread.r}, ${thread.g}, ${thread.b})`;
    dom.threadSwatch.classList.remove("thread-swatch-default");
    dom.threadValue.textContent = formatRGB(thread);
  } else {
    dom.threadSwatch.style.backgroundColor = "";
    dom.threadSwatch.classList.add("thread-swatch-default");
    dom.threadValue.textContent = "—";
  }
}

function hasSteps() {
  return state.steps.length > 0;
}

function clampStepIndex() {
  if (!hasSteps()) {
    state.stepIndex = 0;
    return;
  }
  if (state.stepIndex < 0) state.stepIndex = 0;
  if (state.stepIndex >= state.steps.length) state.stepIndex = state.steps.length - 1;
}

function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return hh > 0
    ? `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
    : `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function setSlot(el, item, isCurrent = false) {
  if (!item) {
    el.textContent = "—";
    el.classList.add("placeholder");
    return;
  }

  if (item.type === "thread") {
    const marker = item.marker;
    el.innerHTML = `
      <div class="threadChangeTitle">Thread change</div>
      <div class="threadChangeMeta"><span class="thread-swatch" style="background-color: rgb(${marker.r}, ${marker.g}, ${marker.b})" aria-hidden="true"></span><span>${formatRGB(marker)}</span></div>
    `;
    el.classList.remove("placeholder");
    return;
  }

  const stepObj = item.step;
  el.innerHTML = `
    <div class="cardLine">Line ${stepObj.rawLineNumber}</div>
    <div class="cardValue">${stepObj.value}</div>
  `;
  el.classList.remove("placeholder");
}

function renderNavigator() {
  const items = buildNavigatorItems();
  setSlot(dom.slotPrev2, items.prev2, false);
  setSlot(dom.slotPrev1, items.prev1, false);
  setSlot(dom.slotCurrent, items.current, true);
  setSlot(dom.slotNext1, items.next1, false);
  setSlot(dom.slotNext2, items.next2, false);
}

function getElapsedActiveSeconds() {
  if (!state.activeSession) return 0;
  const base = state.activeSession.accumulatedActiveSeconds || 0;
  if (state.activeSession.running && state.activeSession.lastResumeTime) {
    return base + Math.max(0, (Date.now() - new Date(state.activeSession.lastResumeTime).getTime()) / 1000);
  }
  return base;
}

function getTimingStats() {
  if (!state.activeSession) return { currentSpm: null, avgSpm: null, trend: "Trend: —", etaSeconds: null };

  const transitions = state.activeSession.transitions || [];
  const nextTransitions = transitions.filter((t) => t.direction === "next");
  const recentNext = nextTransitions.slice(-RECENT_NEXT_WINDOW);

  let currentSpm = null;
  if (recentNext.length >= 2) {
    const first = new Date(recentNext[0].timestamp).getTime();
    const last = new Date(recentNext[recentNext.length - 1].timestamp).getTime();
    const minutes = Math.max(0, (last - first) / 60000);
    if (minutes > 0) currentSpm = (recentNext.length - 1) / minutes;
  }

  const elapsedMinutes = getElapsedActiveSeconds() / 60;
  const avgSpm = elapsedMinutes > 0 ? nextTransitions.length / elapsedMinutes : null;

  let trend = "Trend: —";
  if (currentSpm && avgSpm && avgSpm > 0) {
    const delta = ((currentSpm - avgSpm) / avgSpm) * 100;
    trend = `Trend: ${delta >= 0 ? "Faster" : "Slower"} (${Math.abs(delta).toFixed(0)}%)`;
  }

  let etaSeconds = null;
  const remainingSteps = hasSteps() ? Math.max(0, state.steps.length - (state.stepIndex + 1)) : 0;
  if (remainingSteps > 0 && nextTransitions.length >= 3) {
    const blended = currentSpm && avgSpm
      ? BLEND_CURRENT_WEIGHT * currentSpm + (1 - BLEND_CURRENT_WEIGHT) * avgSpm
      : currentSpm || avgSpm || null;
    if (blended && blended > 0) etaSeconds = (remainingSteps / blended) * 60;
  }

  return { currentSpm, avgSpm, trend, etaSeconds };
}

function renderMetrics() {
  const totalSteps = state.steps.length;
  const currentStep = hasSteps() ? state.stepIndex + 1 : 0;
  const percent = totalSteps > 0 ? (currentStep / totalSteps) * 100 : 0;
  const remaining = totalSteps > 0 ? Math.max(0, totalSteps - currentStep) : 0;

  dom.stepText.textContent = `Step ${currentStep} of ${totalSteps}`;
  dom.percentText.textContent = `${percent.toFixed(1)}% complete`;
  dom.progressBar.style.width = `${percent}%`;
  dom.remainingText.textContent = `Remaining: ${remaining}`;

  dom.elapsedText.textContent = `Elapsed: ${formatDuration(getElapsedActiveSeconds())}`;
  const stats = getTimingStats();
  dom.currentPaceText.textContent = `Current pace: ${stats.currentSpm ? stats.currentSpm.toFixed(2) : "—"} spm`;
  dom.averagePaceText.textContent = `Average pace: ${stats.avgSpm ? stats.avgSpm.toFixed(2) : "—"} spm`;
  dom.trendText.textContent = stats.trend;
  dom.etaText.textContent = `ETA: ${stats.etaSeconds ? formatDuration(stats.etaSeconds) : "—"}`;
}

function renderFileMeta() {
  if (!hasSteps()) {
    dom.fileMeta.textContent = "No file loaded.";
    return;
  }
  dom.fileMeta.textContent = `Loaded: ${state.fileName} • total steps: ${state.steps.length} • raw lines: ${state.rawLineCount}`;
}

function updateControls() {
  const loaded = hasSteps();
  dom.backBtn.disabled = !loaded || state.stepIndex <= 0;
  dom.nextBtn.disabled = !loaded || state.stepIndex >= state.steps.length - 1;
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
    if (document.activeElement !== dom.notesInput) {
      dom.notesInput.value = state.activeSession.notes || "";
    }
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

function renderHistory() {
  dom.sessionHistory.innerHTML = "";
  if (!state.sessionHistory.length) {
    dom.sessionHistory.textContent = "No sessions yet.";
    return;
  }

  for (const s of state.sessionHistory) {
    const item = document.createElement("article");
    item.className = "history-item";

    const head = document.createElement("button");
    head.className = "history-head";
    head.type = "button";
    head.setAttribute("aria-expanded", "false");

    const left = document.createElement("span");
    left.textContent = new Date(s.startTime).toLocaleString();
    const right = document.createElement("span");
    right.textContent = `${formatDuration(s.durationSeconds)} • ${s.stepsCompleted} steps • ${s.averageStepsPerMin.toFixed(2)} spm`;
    head.append(left, right);

    const details = document.createElement("div");
    details.hidden = true;
    details.className = "history-details";
    details.innerHTML = `
      <div>Start index: ${s.startStepIndex + 1}</div>
      <div>End index: ${s.endStepIndex + 1}</div>
      <div>Start raw line: ${s.startRawLineNumber ?? "—"}</div>
      <div>End raw line: ${s.endRawLineNumber ?? "—"}</div>
      <div>Session ID: ${s.sessionId}</div>
      <div>Notes: ${s.notes ? escapeHtml(s.notes) : "(none)"}</div>
    `;

    head.addEventListener("click", () => {
      const open = !details.hidden;
      details.hidden = open;
      head.setAttribute("aria-expanded", String(!open));
    });

    item.append(head, details);
    dom.sessionHistory.appendChild(item);
  }
}

function applyTheme() {
  document.body.classList.toggle("high-contrast", state.highContrast);
  document.body.classList.toggle("large-font", state.largeFont);
}

function persistState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      fileName: state.fileName,
      rawFileText: state.rawFileText,
      rawLineCount: state.rawLineCount,
      steps: state.steps,
      threadMarkers: state.threadMarkers,
      threadStatusRawLine: state.threadStatusRawLine,
      stepIndex: state.stepIndex,
      highContrast: state.highContrast,
      largeFont: state.largeFont,
      activeSession: state.activeSession,
      sessionHistory: state.sessionHistory,
    })
  );
}

function restoreState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    state.fileName = parsed.fileName || "";
    state.rawFileText = parsed.rawFileText || "";
    state.rawLineCount = Number.isInteger(parsed.rawLineCount) ? parsed.rawLineCount : 0;
    state.stepIndex = Number.isInteger(parsed.stepIndex) ? parsed.stepIndex : 0;
    state.threadStatusRawLine = Number.isInteger(parsed.threadStatusRawLine) ? parsed.threadStatusRawLine : null;
    state.highContrast = Boolean(parsed.highContrast);
    state.largeFont = Boolean(parsed.largeFont);
    state.activeSession = parsed.activeSession || null;
    state.sessionHistory = Array.isArray(parsed.sessionHistory) ? parsed.sessionHistory : [];

    if (state.rawFileText) {
      const parsedFile = parseStepFile(state.rawFileText);
      state.steps = parsedFile.steps;
      state.threadMarkers = parsedFile.threadMarkers;
      state.rawLineCount = parsedFile.rawLines.length;
    } else {
      state.steps = Array.isArray(parsed.steps) ? parsed.steps : [];
      state.threadMarkers = Array.isArray(parsed.threadMarkers) ? parsed.threadMarkers : [];
    }
  } catch (_err) {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function renderAll() {
  clampStepIndex();
  renderFileMeta();
  renderNavigator();
  renderThreadStatus();
  renderMetrics();
  renderHistory();
  updateControls();
  applyTheme();
  persistState();
}

function startTicker() {
  stopTicker();
  elapsedInterval = setInterval(() => {
    renderMetrics();
    persistState();
  }, 1000);
}

function stopTicker() {
  if (elapsedInterval) {
    clearInterval(elapsedInterval);
    elapsedInterval = null;
  }
}

function beginOrResumeSession() {
  if (!hasSteps()) return;
  if (!state.activeSession) {
    const currentRaw = state.steps[state.stepIndex]?.rawLineNumber ?? null;
    state.activeSession = {
      sessionId: String(Date.now()),
      startTime: getNowIso(),
      endTime: null,
      accumulatedActiveSeconds: 0,
      lastResumeTime: getNowIso(),
      running: true,
      startStepIndex: state.stepIndex,
      endStepIndex: state.stepIndex,
      startRawLineNumber: currentRaw,
      endRawLineNumber: currentRaw,
      stepsCompleted: 0,
      transitions: [],
      notes: "",
    };
  } else if (!state.activeSession.running) {
    state.activeSession.running = true;
    state.activeSession.lastResumeTime = getNowIso();
  }

  startTicker();
  renderAll();
}

function pauseSession() {
  if (!state.activeSession || !state.activeSession.running) return;
  const delta = Math.max(0, (Date.now() - new Date(state.activeSession.lastResumeTime).getTime()) / 1000);
  state.activeSession.accumulatedActiveSeconds += delta;
  state.activeSession.lastResumeTime = null;
  state.activeSession.running = false;
  stopTicker();
  renderAll();
}

function endSession(triggeredByReset = false) {
  if (!state.activeSession) return;

  if (state.activeSession.running && state.activeSession.lastResumeTime) {
    const delta = Math.max(0, (Date.now() - new Date(state.activeSession.lastResumeTime).getTime()) / 1000);
    state.activeSession.accumulatedActiveSeconds += delta;
  }

  const currentRaw = state.steps[state.stepIndex]?.rawLineNumber ?? null;
  state.activeSession.endTime = getNowIso();
  state.activeSession.endStepIndex = state.stepIndex;
  state.activeSession.endRawLineNumber = currentRaw;

  const durationSeconds = Math.max(0, Math.floor(state.activeSession.accumulatedActiveSeconds));
  const averageStepsPerMin = durationSeconds > 0 ? state.activeSession.stepsCompleted / (durationSeconds / 60) : 0;

  state.sessionHistory.unshift({
    sessionId: state.activeSession.sessionId,
    startTime: state.activeSession.startTime,
    endTime: state.activeSession.endTime,
    durationSeconds,
    startStepIndex: state.activeSession.startStepIndex,
    endStepIndex: state.activeSession.endStepIndex,
    startRawLineNumber: state.activeSession.startRawLineNumber,
    endRawLineNumber: state.activeSession.endRawLineNumber,
    stepsCompleted: state.activeSession.stepsCompleted,
    averageStepsPerMin,
    notes: state.activeSession.notes || "",
  });

  state.activeSession = null;
  stopTicker();

  if (!triggeredByReset) alert("Session ended and saved.");
  renderAll();
}

function moveStep(newIndex, direction) {
  if (!hasSteps()) return;
  const bounded = Math.min(Math.max(newIndex, 0), state.steps.length - 1);
  if (bounded === state.stepIndex) return;

  const from = state.stepIndex;
  const fromRawLine = state.steps[from]?.rawLineNumber ?? null;
  const toRawLine = state.steps[bounded]?.rawLineNumber ?? null;
  state.stepIndex = bounded;
  state.threadStatusRawLine = null;

  if (direction === "next" && fromRawLine && toRawLine) {
    const crossedMarker = state.threadMarkers.find((m) => m.rawLineNumber > fromRawLine && m.rawLineNumber <= toRawLine);
    if (crossedMarker) {
      showThreadChangeToast(crossedMarker);
    }
  }

  // Step position always updates; timestamps only while session running.
  if (state.activeSession) {
    state.activeSession.endStepIndex = state.stepIndex;
    state.activeSession.endRawLineNumber = state.steps[state.stepIndex]?.rawLineNumber ?? null;

    if (state.activeSession.running) {
      state.activeSession.transitions.push({
        stepIndexFrom: from,
        stepIndexTo: state.stepIndex,
        rawLineFrom: state.steps[from]?.rawLineNumber ?? null,
        rawLineTo: state.steps[state.stepIndex]?.rawLineNumber ?? null,
        direction,
        timestamp: getNowIso(),
      });
      if (direction === "next") state.activeSession.stepsCompleted += 1;
    }
  }

  renderAll();
}

function handleJumpToRawLine() {
  if (!hasSteps()) return;
  const rawLine = Number.parseInt(dom.jumpInput.value, 10);
  if (Number.isNaN(rawLine) || rawLine < 1 || rawLine > state.rawLineCount) {
    dom.errorMessage.textContent = `Enter a raw line between 1 and ${state.rawLineCount}.`;
    dom.hintMessage.textContent = "";
    return;
  }

  dom.errorMessage.textContent = "";
  dom.hintMessage.textContent = "";

  const exactIndex = findStepIndexByRawLine(rawLine);
  if (exactIndex >= 0) {
    moveStep(exactIndex, exactIndex >= state.stepIndex ? "next" : "back");
    return;
  }

  const nextIndex = findNextStepIndexAfterRawLine(rawLine);
  if (nextIndex < 0) {
    dom.errorMessage.textContent = "No step found after that line.";
    return;
  }

  const threadMarker = state.threadMarkers.find((m) => m.rawLineNumber === rawLine);
  if (threadMarker) {
    dom.hintMessage.textContent = `Thread change at line ${rawLine}. Jumped to step at line ${state.steps[nextIndex].rawLineNumber}.`;
  } else {
    dom.hintMessage.textContent = `No step on line ${rawLine}. Jumped to line ${state.steps[nextIndex].rawLineNumber}.`;
  }

  moveStep(nextIndex, nextIndex >= state.stepIndex ? "next" : "back");
  state.threadStatusRawLine = rawLine;
  renderAll();
}

function handleFileUpload(file) {
  if (!file) return;
  const reader = new FileReader();

  reader.onload = () => {
    const fileText = typeof reader.result === "string" ? reader.result : "";
    const { rawLines, steps, threadMarkers } = parseStepFile(fileText);

    if (steps.length === 0) {
      dom.errorMessage.textContent = "No valid numeric steps found (lines with only an integer).";
      return;
    }

    if (hasSteps() && !confirm("Replacing file will overwrite current mapping/progress. Continue?")) {
      dom.fileInput.value = "";
      return;
    }

    if (state.activeSession) endSession(true);

    state.fileName = file.name;
    state.rawFileText = fileText;
    state.rawLineCount = rawLines.length;
    state.steps = steps;
    state.threadMarkers = threadMarkers;
    state.threadStatusRawLine = null;
    state.stepIndex = 0;
    dom.errorMessage.textContent = "";
    dom.hintMessage.textContent = "";
    renderAll();
  };

  reader.onerror = () => {
    dom.errorMessage.textContent = "Could not read file.";
  };

  reader.readAsText(file);
}

function resetProgress() {
  if (!hasSteps()) return;
  if (!confirm("Reset progress and end active session?")) return;
  if (state.activeSession) endSession(true);
  state.stepIndex = 0;
  state.threadStatusRawLine = null;
  dom.errorMessage.textContent = "";
  dom.hintMessage.textContent = "";
  renderAll();
}

function toCsv(rows) {
  return rows
    .map((r) => r.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n");
}

function downloadCsv(filename, csvText) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportTransitionsCsv() {
  if (!state.activeSession || !state.activeSession.transitions.length) {
    alert("No current-session transitions to export.");
    return;
  }
  const rows = [["stepIndexFrom", "stepIndexTo", "rawLineFrom", "rawLineTo", "timestamp"]];
  for (const t of state.activeSession.transitions) {
    rows.push([t.stepIndexFrom, t.stepIndexTo, t.rawLineFrom, t.rawLineTo, t.timestamp]);
  }
  downloadCsv(`session-${state.activeSession.sessionId}-transitions.csv`, toCsv(rows));
}

function exportHistoryCsv() {
  if (!state.sessionHistory.length) {
    alert("No session history to export.");
    return;
  }
  const rows = [[
    "sessionId",
    "startTime",
    "endTime",
    "durationSeconds",
    "startStepIndex",
    "endStepIndex",
    "startRawLineNumber",
    "endRawLineNumber",
    "stepsCompleted",
    "averageStepsPerMin",
    "notes",
  ]];

  for (const s of state.sessionHistory) {
    rows.push([
      s.sessionId,
      s.startTime,
      s.endTime,
      s.durationSeconds,
      s.startStepIndex,
      s.endStepIndex,
      s.startRawLineNumber,
      s.endRawLineNumber,
      s.stepsCompleted,
      s.averageStepsPerMin,
      s.notes || "",
    ]);
  }

  downloadCsv("session-history.csv", toCsv(rows));
}

function clearStorage() {
  if (!confirm("Clear all saved local data?")) return;
  localStorage.removeItem(STORAGE_KEY);
  state.fileName = "";
  state.rawFileText = "";
  state.rawLineCount = 0;
  state.steps = [];
  state.threadMarkers = [];
  state.threadStatusRawLine = null;
  state.stepIndex = 0;
  state.activeSession = null;
  state.sessionHistory = [];
  stopTicker();
  renderAll();
}

function handleKeyDown(event) {
  const tag = event.target?.tagName || "";
  if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
  if (event.key === "ArrowRight" || event.key === " ") {
    event.preventDefault();
    moveStep(state.stepIndex + 1, "next");
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    moveStep(state.stepIndex - 1, "back");
  }
}

function initEvents() {
  dom.fileInput.addEventListener("change", (e) => handleFileUpload(e.target.files?.[0]));
  dom.nextBtn.addEventListener("click", () => moveStep(state.stepIndex + 1, "next"));
  dom.backBtn.addEventListener("click", () => moveStep(state.stepIndex - 1, "back"));
  dom.jumpBtn.addEventListener("click", handleJumpToRawLine);
  dom.jumpInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleJumpToRawLine();
  });

  dom.startPauseBtn.addEventListener("click", () => {
    if (!state.activeSession || !state.activeSession.running) beginOrResumeSession();
    else pauseSession();
  });

  dom.endSessionBtn.addEventListener("click", () => {
    if (state.activeSession && confirm("End current session?")) endSession();
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
  if (state.activeSession?.running) startTicker();
  renderAll();
}

boot();
