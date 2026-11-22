(function () {
  "use strict";

  if (window.__ND_UI_MOUNTED__) return;
  window.__ND_UI_MOUNTED__ = true;

  // ==================== Storage Helpers ====================
  function storageGet(key, fallback) {
    return new Promise((resolve) => {
      try {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get([key], (res) => {
            resolve(res && res[key] !== undefined ? res[key] : fallback);
          });
          return;
        }
      } catch (_) {}
      try {
        const raw = localStorage.getItem(key);
        resolve(raw ? JSON.parse(raw) : fallback);
      } catch (_) {
        resolve(fallback);
      }
    });
  }

  function storageSet(key, val) {
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [key]: val });
        return;
      }
    } catch (_) {}
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (_) {}
  }

  // ==================== SmartSitcomGrader™ Dictionary ====================
  const ATOMIC_EXPANSIONS = {
    "i'm": ["i", "am"], "you're": ["you", "are"], "we're": ["we", "are"], "they're": ["they", "are"],
    "he's": ["he", "is"], "she's": ["she", "is"], "it's": ["it", "is"], "that's": ["that", "is"],
    "there's": ["there", "is"], "what's": ["what", "is"], "who's": ["who", "is"], "let's": ["let", "us"],
    "don't": ["do", "not"], "doesn't": ["does", "not"], "didn't": ["did", "not"], "can't": ["can", "not"],
    "cannot": ["can", "not"], "won't": ["will", "not"], "wouldn't": ["would", "not"], "shouldn't": ["should", "not"],
    "couldn't": ["could", "not"], "isn't": ["is", "not"], "aren't": ["are", "not"], "wasn't": ["was", "not"],
    "weren't": ["were", "not"], "haven't": ["have", "not"], "hasn't": ["has", "not"],
    "i've": ["i", "have"], "you've": ["you", "have"], "we've": ["we", "have"], "they've": ["they", "have"],
    "would've": ["would", "have"], "could've": ["could", "have"], "should've": ["should", "have"],
    "i'll": ["i", "will"], "you'll": ["you", "will"], "we'll": ["we", "will"], "they'll": ["they", "will"],
    "i'd": ["i", "would"], "you'd": ["you", "would"],
    "gonna": ["going", "to"], "wanna": ["want", "to"], "gotta": ["got", "to"],
    "kinda": ["kind", "of"], "sorta": ["sort", "of"], "outta": ["out", "of"], "c'mon": ["come", "on"],
    "alright": ["all", "right"], "anymore": ["any", "more"],
    "'cause": ["because"], "cause": ["because"], "cuz": ["because"], "cos": ["because"],
    "ok": ["okay"], "yeah": ["yes"], "yep": ["yes"],
    "1": ["one"], "2": ["two"], "3": ["three"], "4": ["four"], "5": ["five"],
    "6": ["six"], "7": ["seven"], "8": ["eight"], "9": ["nine"], "10": ["ten"]
  };

  function getDisplayWords(text) {
    return String(text || "").trim().split(/\s+/).filter(Boolean);
  }

  function cleanWord(raw) {
    return String(raw || "")
      .toLowerCase()
      .replace(/[’‘`]/g, "'")
      .replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, "");
  }

  function expandToAtomicTokens(text, withDisplayMap) {
    const rawWords = getDisplayWords(text);
    const atoms = [];
    rawWords.forEach((rw, displayIdx) => {
      rw.split(/[-—–]+/).filter(Boolean).forEach((part) => {
        const cleaned = cleanWord(part);
        if (!cleaned) return;
        const expanded = ATOMIC_EXPANSIONS[cleaned] || [cleaned];
        expanded.forEach((tok) => {
          atoms.push(withDisplayMap ? { tok, displayIdx } : tok);
        });
      });
    });
    return atoms;
  }

  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
    }
    return dp[m][n];
  }

  function isTokenCloseMatch(a, b) {
    if (a === b) return true;
    if (a.length >= 5 && b.length >= 5 && Math.abs(a.length - b.length) <= 1) {
      return levenshtein(a, b) <= 1;
    }
    return false;
  }

  function gradeDictation(targetText, userText) {
    const displayWords = getDisplayWords(targetText);
    const targetAtoms = expandToAtomicTokens(targetText, true);
    const userAtoms = expandToAtomicTokens(userText, false);
    const T = targetAtoms.length, U = userAtoms.length;

    const dp = Array.from({ length: T + 1 }, () => new Array(U + 1).fill(0));
    for (let i = T - 1; i >= 0; i--) {
      for (let j = U - 1; j >= 0; j--) {
        if (isTokenCloseMatch(targetAtoms[i].tok, userAtoms[j])) {
          dp[i][j] = 1 + dp[i + 1][j + 1];
        } else {
          dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
    }

    const matchedAtoms = new Set();
    let i = 0, j = 0;
    while (i < T && j < U) {
      if (isTokenCloseMatch(targetAtoms[i].tok, userAtoms[j])) {
        matchedAtoms.add(i);
        i++; j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        i++;
      } else {
        j++;
      }
    }

    const atomsByDisplay = new Map();
    targetAtoms.forEach((item, aIdx) => {
      if (!atomsByDisplay.has(item.displayIdx)) atomsByDisplay.set(item.displayIdx, []);
      atomsByDisplay.get(item.displayIdx).push(aIdx);
    });

    const matchedDisplayIndices = new Set();
    displayWords.forEach((_, dIdx) => {
      const list = atomsByDisplay.get(dIdx) || [];
      if (list.length === 0 || list.every((aIdx) => matchedAtoms.has(aIdx))) {
        matchedDisplayIndices.add(dIdx);
      }
    });

    const accuracy = T === 0 ? 100 : Math.round((matchedAtoms.size / T) * 100);
    const passed =
      matchedAtoms.size === T ||
      (T >= 11 && T - matchedAtoms.size <= 1 && U <= T + 2);

    return {
      passed,
      accuracy,
      matchedDisplayIndices,
      totalWords: displayWords.length,
      matchedWordsCount: matchedDisplayIndices.size
    };
  }

  // ==================== Extension State ====================
  let dictationEnabled = true;
  let dockMode = "right"; // 'right' | 'bottom'
  let playbackRate = 1.0;
  let startTrimMs = 0;
  let endPadMs = 40;
  let skipLongSilences = true;

  let enCues = [];
  let koCues = [];
  let activeCueIndex = 0;
  let passedCueIndices = new Set();
  let autoPausedForCue = new Set();
  let segmentReplayArmed = false;

  // Hint state per cue
  let showFirstLetterHint = false;
  let revealedWordSet = new Set();
  let lastMatchedDisplaySet = new Set();
  let hasAttemptedCurrent = false;

  let savedVocab = [];
  let notionConfig = {
    token: "",
    targetUrl: "",
    databaseId: "",
    dbTitle: "",
    autoSync: true
  };
  let episodeProgressMap = {};
  let geminiApiKey = "";
  let aiCache = new Map();
  let lastKnownTimeMs = 0;
  let currentPathKey = "";
  let resumeTargetIndex = -1;
  let resumeSeekGuardUntil = 0;

  function getWatchEpisodeId() {
    if (window.__ND_MOCK_MODE__) return "mock-suits-s01e01";
    const m = location.pathname.match(/\/watch\/(\d+)/);
    return m ? m[1] : location.pathname;
  }

  function detectEpisodeTitle() {
    const titleEl =
      document.querySelector('[data-uia="video-title"]') ||
      document.querySelector(".ellipsize-text");
    if (titleEl && titleEl.textContent.trim()) {
      return titleEl.textContent.replace(/\s+/g, " ").trim();
    }
    return (document.title || "Netflix Episode").replace(/\s*-\s*Netflix.*$/i, "").trim();
  }

  // ==================== Bridge Commands ====================
  function sendPlayerCmd(type, payload) {
    window.postMessage(Object.assign({ source: "ND_UI", type }, payload || {}), "*");
  }

  function findMatchingKorean(startMs, endMs) {
    if (!koCues.length) return "";
    const mid = (startMs + endMs) / 2;
    let best = null;
    let bestDist = Infinity;

    for (const kc of koCues) {
      // Direct overlap check
      const overlap = Math.min(endMs, kc.endMs) - Math.max(startMs, kc.startMs);
      if (overlap > 150) {
        return kc.text;
      }
      const kMid = (kc.startMs + kc.endMs) / 2;
      const dist = Math.abs(mid - kMid);
      if (dist < bestDist && dist <= 2200) {
        bestDist = dist;
        best = kc.text;
      }
    }
    return best || "";
  }

  function formatMs(ms) {
    const sec = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ==================== Build Shadow DOM UI ====================
  const hostEl = document.createElement("div");
  hostEl.id = "nd-studio-host";
  (document.body || document.documentElement).appendChild(hostEl);
  const shadow = hostEl.attachShadow({ mode: "open" });

  // Prevent pointer/mouse/focus events inside our studio from bubbling up to Netflix's document FocusTrap!
  ["mousedown", "mouseup", "pointerdown", "pointerup", "click", "focusin", "focusout"].forEach((evt) => {
    hostEl.addEventListener(evt, (e) => {
      e.stopPropagation();
    });
  });

  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', sans-serif;
        color: #f1f5f9;
      }
      * { box-sizing: border-box; }
      .nd-shell {
        position: fixed;
        z-index: 2147483640;
        background: #0f1629;
        border-left: 1px solid #263354;
        box-shadow: -8px 0 28px rgba(0,0,0,0.55);
        display: none;
        flex-direction: column;
        color: #f1f5f9;
      }
      .nd-shell.visible { display: flex; }
      .nd-shell.dock-right {
        top: 0; right: 0; bottom: 0;
        width: min(420px, 46vw);
      }
      .nd-shell.dock-bottom {
        left: 50%; bottom: 22px;
        transform: translateX(-50%);
        width: min(760px, 94vw);
        max-height: 58vh;
        border: 1px solid #334675;
        border-radius: 16px;
        background: rgba(13, 19, 36, 0.94);
        backdrop-filter: blur(12px);
      }
      .nd-minimized-pill {
        position: fixed;
        top: 18px; right: 22px;
        z-index: 2147483641;
        background: linear-gradient(135deg, #e50914, #b20710);
        color: #fff;
        border: none;
        border-radius: 999px;
        padding: 8px 15px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 4px 16px rgba(0,0,0,0.5);
        display: none;
      }
      .nd-minimized-pill.visible { display: inline-flex; align-items: center; gap: 6px; }

      .nd-header {
        padding: 12px 15px;
        background: #151e36;
        border-bottom: 1px solid #263354;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
      }
      .nd-title {
        font-size: 14px;
        font-weight: 800;
        display: flex;
        align-items: center;
        gap: 7px;
      }
      .nd-badge-n {
        background: #e50914;
        color: #fff;
        font-weight: 900;
        font-size: 12px;
        padding: 2px 6px;
        border-radius: 4px;
      }
      .nd-body {
        padding: 14px 15px;
        overflow-y: auto;
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .nd-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        flex-wrap: wrap;
      }
      .btn {
        background: #1d2947;
        border: 1px solid #30416b;
        color: #e2e8f0;
        border-radius: 7px;
        padding: 6px 10px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        font-family: inherit;
        transition: all 0.14s ease;
      }
      .btn:hover { background: #26365c; border-color: #4f6ef7; }
      .btn-red { background: #e50914; border-color: #e50914; color: #fff; font-weight: 700; }
      .btn-red:hover { background: #f6121d; border-color: #f6121d; }
      .btn-green { background: #10b981; border-color: #10b981; color: #052e16; font-weight: 800; }
      .nd-header .btn {
        white-space: nowrap;
        padding: 4px 7px;
        font-size: 11px;
      }
      .btn-active { background: rgba(99,102,241,0.24); border-color: #6366f1; color: #c7d2fe; }

      .status-strip {
        font-size: 11.5px;
        color: #94a3b8;
        background: #0a0f1e;
        border: 1px solid #1e2946;
        border-radius: 8px;
        padding: 8px 10px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 6px;
      }
      .slots-box {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 11px;
        background: #0a0f1e;
        border: 1px dashed #2d3d66;
        border-radius: 10px;
      }
      .chip {
        padding: 4px 8px;
        border-radius: 6px;
        font-family: Consolas, monospace;
        font-size: 13px;
        font-weight: 700;
        background: #18223c;
        border: 1px solid #2a3961;
        color: #94a3b8;
      }
      .chip.ok { background: rgba(16,185,129,0.18); border-color: #10b981; color: #6ee7b7; }
      .chip.err { background: rgba(239,68,68,0.16); border-color: #ef4444; color: #fca5a5; }
      .chip.hint { background: rgba(245,158,11,0.18); border-color: #f59e0b; color: #fcd34d; }

      textarea.nd-input {
        width: 100%;
        min-height: 72px;
        background: #090d1a;
        color: #ffffff;
        border: 2px solid #2b3a63;
        border-radius: 10px;
        padding: 11px 13px;
        font-size: 15px;
        font-family: inherit;
        resize: vertical;
        outline: none;
      }
      textarea.nd-input:focus { border-color: #6366f1; }
      textarea.nd-input.passed { border-color: #10b981; background: rgba(16,185,129,0.07); }

      .banner {
        padding: 10px 12px;
        border-radius: 9px;
        font-size: 12.5px;
        font-weight: 600;
        display: none;
      }
      .banner.show { display: block; }
      .banner.ok { background: rgba(16,185,129,0.16); border: 1px solid #10b981; color: #a7f3d0; }
      .banner.retry { background: rgba(245,158,11,0.16); border: 1px solid #f59e0b; color: #fde68a; }

      .study-area {
        display: none;
        flex-direction: column;
        gap: 10px;
      }
      .study-area.open { display: flex; }
      .card {
        background: #151f38;
        border: 1px solid #283861;
        border-radius: 10px;
        padding: 12px 13px;
      }
      .en-line { font-size: 15.5px; font-weight: 800; color: #fff; margin-bottom: 4px; }
      .ko-line { font-size: 13.5px; color: #93c5fd; font-weight: 600; }
      .pron-box {
        margin-top: 8px;
        padding: 8px 10px;
        background: rgba(99,102,241,0.13);
        border-left: 3px solid #6366f1;
        border-radius: 5px;
        font-size: 12px;
        color: #c7d2fe;
        line-height: 1.5;
      }
      .sec-label { font-size: 12px; font-weight: 800; color: #cbd5e1; margin-bottom: 7px; }
      .vocab-entry {
        background: #0c1224;
        border: 1px solid #233154;
        border-radius: 8px;
        padding: 9px 11px;
        margin-bottom: 7px;
      }
      .vocab-term { font-size: 13.5px; font-weight: 800; color: #f472b6; }
      .vocab-meaning { font-size: 12.5px; font-weight: 700; color: #e2e8f0; margin-top: 2px; }
      .vocab-nuance { font-size: 12px; color: #94a3b8; margin-top: 2px; }
      .grammar-title { font-size: 13px; font-weight: 800; color: #fcd34d; margin-bottom: 4px; }
      .grammar-desc { font-size: 12.5px; color: #cbd5e1; line-height: 1.55; }
      .shortcut-bar { font-size: 11px; color: #64748b; display: flex; gap: 10px; flex-wrap: wrap; }
      .api-drawer {
        display: none;
        background: #0b1020;
        border: 1px solid #334675;
        border-radius: 9px;
        padding: 10px;
        gap: 7px;
        flex-direction: column;
      }
      .api-drawer.open { display: flex; }
      .vocab-drawer {
        display: none;
        background: #0b1020;
        border: 1px solid #f59e0b;
        border-radius: 10px;
        padding: 12px;
        gap: 9px;
        flex-direction: column;
      }
      .vocab-drawer.open { display: flex; }
      .vocab-drawer-list {
        max-height: 280px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 7px;
      }
      .btn-gold {
        background: rgba(245, 158, 11, 0.2);
        border-color: #f59e0b;
        color: #fde68a;
        font-weight: 700;
      }
      .btn-gold:hover {
        background: rgba(245, 158, 11, 0.32);
        border-color: #fbbf24;
      }
      .resume-bar {
        display: none;
        background: linear-gradient(135deg, rgba(14, 165, 233, 0.2), rgba(37, 99, 235, 0.18));
        border: 1px solid #38bdf8;
        border-radius: 9px;
        padding: 10px 11px;
        gap: 7px;
        flex-direction: column;
      }
      .resume-bar.open { display: flex; }
      input.api-input {
        width: 100%;
        padding: 7px 9px;
        border-radius: 6px;
        border: 1px solid #30416b;
        background: #141d36;
        color: #fff;
        font-size: 12px;
      }
    </style>

    <button id="ndMiniPill" class="nd-minimized-pill">
      <span class="nd-badge-n">N</span> 받아쓰기 스튜디오 열기
    </button>

    <aside id="ndShell" class="nd-shell dock-right">
      <div class="nd-header">
        <div class="nd-title">
          <span class="nd-badge-n">N</span>
          <span>Dictation</span>
        </div>
        <div style="display:flex; gap:4px; align-items:center;">
          <button id="btnVocabOpen" class="btn btn-gold" title="저장한 단어·숙어·문법 학습장 열기 및 내보내기">★ 학습장(0)</button>
          <button id="btnDockToggle" class="btn" title="우측 사이드바 / 하단 플로팅 전환">◨ 위치</button>
          <button id="btnApiSetup" class="btn" title="선택형 AI 심층 해설용 API 키 설정">✨ AI키</button>
          <button id="btnPauseMode" class="btn btn-active" title="받아쓰기 자동 멈춤 ON/OFF">자동멈춤</button>
          <button id="btnMinimize" class="btn" title="패널 접기">—</button>
        </div>
      </div>

      <div class="nd-body">
        <div id="vocabDrawer" class="vocab-drawer">
          <div class="nd-row">
            <span style="font-size:13px; font-weight:800; color:#fde68a;">★ 내 학습장 (<span id="vocabDrawerCount">0</span>개)</span>
            <div style="display:flex; gap:4px; align-items:center;">
              <button id="btnNotionToggleSetup" class="btn" style="padding:3px 8px; font-size:11px; border-color:#818cf8; color:#c7d2fe;">📓 노션 연동 설정</button>
              <button id="btnNotionBulkSync" class="btn" style="padding:3px 8px; font-size:11px; display:none; border-color:#34d399; color:#6ee7b7;" title="아직 노션에 안 올라간 저장 항목을 한 번에 전송합니다">🔄 미전송분 일괄 동기화</button>
              <button id="btnVocabClose" class="btn" style="padding:3px 8px; font-size:11px;">닫기 ✕</button>
            </div>
          </div>

          <div id="notionSetupBox" style="display:none; background:#11182d; border:1px solid #4f46e5; border-radius:8px; padding:10px; flex-direction:column; gap:7px;">
            <div style="font-size:11.5px; color:#e0e7ff; font-weight:700; display:flex; justify-content:space-between; align-items:center;">
              <span>📓 노션(Notion) 실시간 자동 저장 설정</span>
              <span id="notionStatePill" style="font-size:10.5px; color:#94a3b8;">미연결</span>
            </div>
            <div style="font-size:11px; color:#94a3b8; line-height:1.45;">
              1) <a href="https://www.notion.so/my-integrations" target="_blank" style="color:#93c5fd;">notion.so/my-integrations</a>에서 무료 통합 생성 후 토큰(<code>ntn_...</code>) 복사<br/>
              2) 연결할 노션 페이지 우측 상단 <strong>[•••] → [연결]</strong>에서 만든 통합 추가 후 <strong>[공유 → 링크 복사]</strong>
            </div>
            <div style="display:flex; gap:5px;">
              <input id="notionTokenInput" class="api-input" type="password" placeholder="1. 노션 API 토큰 (ntn_... 또는 secret_...)" style="flex:1;" />
              <button id="btnPasteNotionToken" class="btn" type="button" style="padding:4px 8px; font-size:11px; white-space:nowrap;">붙여넣기</button>
            </div>
            <div style="display:flex; gap:5px;">
              <input id="notionUrlInput" class="api-input" type="text" placeholder="2. 노션 페이지 또는 데이터베이스 링크(URL) 붙여넣기" style="flex:1;" />
              <button id="btnPasteNotionUrl" class="btn" type="button" style="padding:4px 8px; font-size:11px; white-space:nowrap;">붙여넣기</button>
            </div>
            <div class="nd-row" style="justify-content:space-between;">
              <label style="font-size:11px; color:#cbd5e1; display:flex; align-items:center; gap:5px; cursor:pointer;">
                <input id="notionAutoCheck" type="checkbox" checked /> 저장 버튼 클릭 시 실시간 자동 전송
              </label>
              <div style="display:flex; gap:5px;">
                <button id="btnNotionDisconnect" class="btn" style="padding:4px 8px; font-size:11px;">연결 해제</button>
                <button id="btnNotionConnect" class="btn" style="padding:4px 10px; font-size:11px; background:#4f46e5; border-color:#6366f1; color:#fff; font-weight:700;">🔌 연결 &amp; 표 자동생성</button>
              </div>
            </div>
            <div id="notionStatusMsg" style="font-size:11px; color:#a7f3d0; line-height:1.4;"></div>
          </div>

          <div class="nd-row" style="justify-content:space-between; gap:6px;">
            <div style="display:flex; gap:4px;">
              <button class="btn vocab-filter-btn btn-active" data-vfilter="all" style="padding:4px 8px; font-size:11px;">전체</button>
              <button class="btn vocab-filter-btn" data-vfilter="vocab" style="padding:4px 8px; font-size:11px;">📚 단어·숙어</button>
              <button class="btn vocab-filter-btn" data-vfilter="grammar" style="padding:4px 8px; font-size:11px;">🧩 문법</button>
            </div>
            <div style="display:flex; gap:4px;">
              <button id="btnExportCsv" class="btn btn-green" style="padding:4px 8px; font-size:11px;">📊 엑셀(.csv)</button>
              <button id="btnExportTxt" class="btn" style="padding:4px 8px; font-size:11px; border-color:#38bdf8; color:#bae6fd;">📝 메모장(.txt)</button>
            </div>
          </div>
          <div id="vocabDrawerList" class="vocab-drawer-list"></div>
        </div>

        <div id="apiDrawer" class="api-drawer">
          <div style="font-size:11.5px; color:#cbd5e1;">
            <strong>선택 설정:</strong> Google Gemini API 키를 저장하면 모든 넷플릭스 대사에 대해 실시간 AI 맞춤 숙어·문법 해설을 볼 수 있습니다 (미입력 시에도 내장 사전·문법 분석기가 무료 작동합니다).
          </div>
          <div style="display:flex; gap:6px;">
            <input id="apiKeyInput" class="api-input" type="password" placeholder="AIzaSy... (선택 사항)" />
            <button id="btnSaveApiKey" class="btn btn-red">저장</button>
          </div>
        </div>

        <div class="status-strip">
          <span id="subStatusText">영어 자막 감지 대기 중... (영어 CC 자막을 켜주세요)</span>
          <button id="btnSyncDual" class="btn" style="padding:3px 8px; font-size:11px;">한·영 자막 동기화</button>
        </div>

        <div id="resumeBar" class="resume-bar">
          <div id="resumeInfoText" style="font-size:12px; color:#e0f2fe; font-weight:700; line-height:1.45;"></div>
          <div class="nd-row" style="justify-content:flex-end; gap:6px;">
            <button id="btnJumpResume" class="btn" style="background:#0284c7; border-color:#38bdf8; color:#fff; font-weight:700;">▶ 이어서 시작</button>
            <button id="btnResetEpProgress" class="btn" style="font-size:11px;">기록 초기화</button>
            <button id="btnDismissResume" class="btn" style="font-size:11px;">✕</button>
          </div>
        </div>

        <!-- Playback & Cue Stepper -->
        <div class="nd-row">
          <div style="display:flex; gap:5px; align-items:center;">
            <button id="btnPrevCue" class="btn">◀ 이전</button>
            <span id="cueCounter" style="font-size:12px; font-weight:700; padding:0 4px;">대사 0 / 0</span>
            <button id="btnNextCueManual" class="btn">다음 ▶</button>
          </div>
          <span id="cueTimeRange" style="font-family:Consolas,monospace; font-size:12px; color:#94a3b8;">00:00 ~ 00:00</span>
        </div>

        <div class="nd-row">
          <button id="btnReplaySeg" class="btn btn-red">▶ 구간 다시 듣기 (Ctrl+Space)</button>
          <div style="display:flex; gap:4px;">
            <button class="btn rate-btn" data-rate="0.75">0.75x</button>
            <button class="btn rate-btn" data-rate="0.85">0.85x</button>
            <button class="btn rate-btn btn-active" data-rate="1">1.0x</button>
          </div>
        </div>

        <div class="nd-row" style="background:#0a0f1e; border:1px solid #1e2946; border-radius:8px; padding:6px 9px; font-size:11px; color:#94a3b8;">
          <div style="display:flex; align-items:center; gap:4px;">
            <span>🎯 시작점:</span>
            <button id="btnStartTrimMinus" class="btn" style="padding:2px 6px; font-size:10.5px;" title="대사 앞부분이 잘리면 클릭">-0.2s</button>
            <span id="startTrimLabel" style="font-family:Consolas,monospace; color:#cbd5e1; min-width:34px; text-align:center;">0.0s</span>
            <button id="btnStartTrimPlus" class="btn" style="padding:2px 6px; font-size:10.5px;" title="앞 대사가 살짝 섞이면 클릭">+0.2s</button>
          </div>
          <div style="display:flex; align-items:center; gap:4px;">
            <span>끝점:</span>
            <button id="btnEndPadMinus" class="btn" style="padding:2px 6px; font-size:10.5px;">-0.2s</button>
            <span id="endPadLabel" style="font-family:Consolas,monospace; color:#cbd5e1; min-width:34px; text-align:center;">+0.0s</span>
            <button id="btnEndPadPlus" class="btn" style="padding:2px 6px; font-size:10.5px;">+0.2s</button>
          </div>
          <span id="preRollBadge" style="display:none; color:#38bdf8; font-weight:700;">🔇 앞 대사 무음 통과 중...</span>
        </div>

        <!-- Word Slots -->
        <div>
          <div class="nd-row" style="margin-bottom:5px;">
            <span style="font-size:12px; font-weight:700; color:#94a3b8;">단어 슬롯 <span id="wordCountSpan"></span></span>
            <span style="font-size:11px; color:#64748b;">축약형(I'm↔I am) 자동 호환</span>
          </div>
          <div id="slotsBox" class="slots-box"></div>
        </div>

        <!-- Input & Buttons -->
        <textarea
          id="dictInput"
          class="nd-input"
          placeholder="방금 들린 넷플릭스 영어 대사를 입력하고 Enter를 누르세요..."
          spellcheck="false"
        ></textarea>

        <div class="nd-row">
          <div style="display:flex; gap:5px; flex-wrap:wrap;">
            <button id="btnHintFirst" class="btn">💡 첫 글자</button>
            <button id="btnHintWord" class="btn">🔍 1단어 열기</button>
            <button id="btnReveal" class="btn">🏳️ 정답 보기</button>
          </div>
          <div style="display:flex; gap:6px;">
            <button id="btnGrade" class="btn btn-red">✓ 채점 (Enter)</button>
            <button id="btnAdvanceNext" class="btn btn-green" style="display:none;">다음 대사 재생 (Enter) →</button>
          </div>
        </div>

        <div class="shortcut-bar">
          <span>Ctrl+Space: 구간 반복</span>
          <span>Enter: 채점 / 다음 대사</span>
          <span>Alt+H: 첫 글자 힌트</span>
        </div>

        <div id="feedbackBanner" class="banner"></div>

        <!-- Study Area -->
        <div id="studyArea" class="study-area">
          <div class="card">
            <div class="en-line" id="ansEn"></div>
            <div class="ko-line" id="ansKo"></div>
            <div class="pron-box" id="ansPron"></div>
          </div>

          <div class="card">
            <div class="nd-row" style="margin-bottom:6px;">
              <div class="sec-label" style="margin:0;">📚 핵심 단어 · 구동사 · 관용어 해설</div>
              <button id="btnAskAi" class="btn" style="padding:3px 8px; font-size:11px;">✨ AI 심층 해설</button>
            </div>
            <div id="vocabContainer"></div>
          </div>

          <div class="card">
            <div class="nd-row" style="margin-bottom:6px;">
              <div class="sec-label" style="margin:0;">🧩 대사별 핵심 문법 포인트</div>
              <button id="btnSaveGrammar" class="btn" style="padding:2px 8px; font-size:11px;">☆ 문법 저장</button>
            </div>
            <div id="grammarTitle" class="grammar-title"></div>
            <div id="grammarDesc" class="grammar-desc"></div>
          </div>
        </div>
      </div>
    </aside>
  `;

  // ==================== Shadow DOM References ====================
  const elShell = shadow.getElementById("ndShell");
  const elMiniPill = shadow.getElementById("ndMiniPill");
  const elSubStatus = shadow.getElementById("subStatusText");
  const elCueCounter = shadow.getElementById("cueCounter");
  const elCueTimeRange = shadow.getElementById("cueTimeRange");
  const elWordCountSpan = shadow.getElementById("wordCountSpan");
  const elSlotsBox = shadow.getElementById("slotsBox");
  const elDictInput = shadow.getElementById("dictInput");
  const elBanner = shadow.getElementById("feedbackBanner");
  const elStudyArea = shadow.getElementById("studyArea");
  const elAnsEn = shadow.getElementById("ansEn");
  const elAnsKo = shadow.getElementById("ansKo");
  const elAnsPron = shadow.getElementById("ansPron");
  const elVocabContainer = shadow.getElementById("vocabContainer");
  const elGrammarTitle = shadow.getElementById("grammarTitle");
  const elGrammarDesc = shadow.getElementById("grammarDesc");
  const elBtnGrade = shadow.getElementById("btnGrade");
  const elBtnAdvanceNext = shadow.getElementById("btnAdvanceNext");
  const elApiDrawer = shadow.getElementById("apiDrawer");
  const elApiKeyInput = shadow.getElementById("apiKeyInput");

  let panelMinimized = false;
  let uiFocusLocked = false;
  let lastShortcutExecMs = 0;
  let otherInputGuardUntil = 0;

  function isOtherStudioInputActive() {
    if (Date.now() < otherInputGuardUntil) return true;
    const act = shadow.activeElement;
    if (!act || act === elDictInput) return false;
    return act.tagName === "INPUT" || act.tagName === "TEXTAREA" || act.isContentEditable;
  }

  function focusDictInputSafely() {
    if (isOtherStudioInputActive()) return;
    uiFocusLocked = true;
    sendPlayerCmd("SET_FOCUS_LOCK", { locked: true });
    elDictInput.focus({ preventScroll: true });
    // Re-assert focus after async Netflix play/pause state transitions
    setTimeout(() => {
      if (uiFocusLocked && !isOtherStudioInputActive()) {
        elDictInput.focus({ preventScroll: true });
      }
    }, 45);
    setTimeout(() => {
      if (uiFocusLocked && !isOtherStudioInputActive()) {
        elDictInput.focus({ preventScroll: true });
      }
    }, 150);
  }

  // Track clicks inside vs outside #nd-studio-host, and protect secondary <input> fields from #dictInput focus recovery!
  ["pointerdown", "mousedown"].forEach((evtType) => {
    window.addEventListener(
      evtType,
      (e) => {
        const path = typeof e.composedPath === "function" ? e.composedPath() : [];
        const inside = path.some((n) => n && n.id === "nd-studio-host");
        uiFocusLocked = inside;
        sendPlayerCmd("SET_FOCUS_LOCK", { locked: inside });
        if (inside) {
          const clickedInput = path.find(
            (n) => n && n !== elDictInput && (n.tagName === "INPUT" || n.tagName === "TEXTAREA")
          );
          if (clickedInput) {
            otherInputGuardUntil = Date.now() + 400;
          }
        }
      },
      true
    );
  });

  elDictInput.addEventListener("focus", () => {
    uiFocusLocked = true;
    sendPlayerCmd("SET_FOCUS_LOCK", { locked: true });
  });

  // Guardian: if Netflix ever tries to blur #dictInput without an outside click, restore focus immediately
  // (unless the user clicked into another studio <input> such as Notion Token, Notion URL, or AI API Key!)
  elDictInput.addEventListener("blur", () => {
    if (!uiFocusLocked || panelMinimized || isOtherStudioInputActive()) return;
    const selStart = elDictInput.selectionStart;
    const selEnd = elDictInput.selectionEnd;
    queueMicrotask(() => {
      if (!uiFocusLocked || panelMinimized || isOtherStudioInputActive()) return;
      elDictInput.focus({ preventScroll: true });
      try {
        if (typeof selStart === "number" && typeof selEnd === "number") {
          elDictInput.setSelectionRange(selStart, selEnd);
        }
      } catch (_) {}
    });
  });

  function execStudioShortcutOnce(command) {
    const now = Date.now();
    if (now - lastShortcutExecMs < 80) return;
    lastShortcutExecMs = now;
    if (command === "REPLAY") {
      replayCurrentCue();
    } else if (command === "HINT_FIRST") {
      showFirstLetterHint = true;
      renderCueUI(false);
      focusDictInputSafely();
    } else if (command === "ENTER") {
      handleGradeOrNext();
    }
  }

  document.addEventListener("nd-studio-shortcut", (e) => {
    if (e && e.detail && e.detail.command) {
      execStudioShortcutOnce(e.detail.command);
    }
  });

  // Prevent Netflix player hotkeys (Space, F, M, Arrow keys) from firing when typing in our UI!
  ["keydown", "keyup", "keypress"].forEach((evtName) => {
    elDictInput.addEventListener(evtName, (e) => {
      if (evtName === "keydown" && e.key === "Escape") {
        uiFocusLocked = false;
        sendPlayerCmd("SET_FOCUS_LOCK", { locked: false });
        elDictInput.blur();
        e.stopPropagation();
        return;
      }
      if (evtName === "keydown" && e.ctrlKey && e.code === "Space") {
        e.preventDefault();
        e.stopPropagation();
        execStudioShortcutOnce("REPLAY");
        return;
      }
      if (evtName === "keydown" && e.altKey && e.code === "KeyH") {
        e.preventDefault();
        e.stopPropagation();
        execStudioShortcutOnce("HINT_FIRST");
        return;
      }
      if (evtName === "keydown" && e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        execStudioShortcutOnce("ENTER");
        return;
      }
      e.stopPropagation();
    });

    elApiKeyInput.addEventListener(evtName, (e) => e.stopPropagation());
  });

  function syncBodyClasses() {
    const onWatch = location.pathname.startsWith("/watch") || Boolean(window.__ND_MOCK_MODE__);
    if (!onWatch) {
      elShell.classList.remove("visible");
      elMiniPill.classList.remove("visible");
      document.body.classList.remove("nd-active", "nd-hide-subs", "nd-dock-right");
      return;
    }

    if (panelMinimized) {
      elShell.classList.remove("visible");
      elMiniPill.classList.add("visible");
      document.body.classList.remove("nd-active", "nd-dock-right");
    } else {
      elMiniPill.classList.remove("visible");
      elShell.classList.add("visible");
      document.body.classList.add("nd-active");
      document.body.classList.toggle("nd-dock-right", dockMode === "right");
    }

    document.body.classList.toggle("nd-hide-subs", dictationEnabled && !panelMinimized);
  }

  function getActiveCue() {
    return enCues[activeCueIndex] || null;
  }

  function resetCueHintState() {
    showFirstLetterHint = false;
    revealedWordSet = new Set();
    lastMatchedDisplaySet = new Set();
    hasAttemptedCurrent = false;
  }

  function renderSubtitleStatus() {
    if (enCues.length > 0 && koCues.length > 0) {
      elSubStatus.textContent = `✓ 영어(${enCues.length}) · 한국어(${koCues.length}) 자막 연동 완료`;
    } else if (enCues.length > 0) {
      elSubStatus.textContent = `✓ 영어 대사 ${enCues.length}문장 준비됨 (한국어 번역은 우측 동기화 클릭)`;
    } else {
      elSubStatus.textContent = "넷플릭스 자막 메뉴에서 [영어(CC)]를 선택해 주세요";
    }
  }

  function renderCueUI(clearInputIfUnpassed) {
    renderSubtitleStatus();
    const cue = getActiveCue();
    if (!cue) {
      elCueCounter.textContent = "대사 대기 중";
      elSlotsBox.innerHTML = `<span style="font-size:12px; color:#64748b;">영상이 재생되고 영어 자막이 로드되면 자동으로 대사 슬롯이 표시됩니다.</span>`;
      elStudyArea.classList.remove("open");
      return;
    }

    const isPassed = passedCueIndices.has(activeCueIndex);
    elCueCounter.textContent = `대사 ${activeCueIndex + 1} / ${enCues.length}`;
    elCueTimeRange.textContent = `${formatMs(cue.startMs)} ~ ${formatMs(cue.endMs)}`;

    const words = getDisplayWords(cue.text);
    elWordCountSpan.textContent = `(${words.length}단어)`;
    elSlotsBox.innerHTML = "";

    words.forEach((w, idx) => {
      const span = document.createElement("span");
      if (isPassed || lastMatchedDisplaySet.has(idx)) {
        span.className = "chip ok";
        span.textContent = w;
      } else if (revealedWordSet.has(idx)) {
        span.className = "chip hint";
        span.textContent = w;
      } else if (showFirstLetterHint) {
        const cl = cleanWord(w);
        span.className = "chip" + (hasAttemptedCurrent ? " err" : "");
        span.textContent = (w[0] || "") + "_".repeat(Math.max(1, cl.length - 1));
      } else {
        const cl = cleanWord(w);
        span.className = "chip" + (hasAttemptedCurrent ? " err" : "");
        span.textContent = "_".repeat(Math.max(2, cl.length));
      }
      elSlotsBox.appendChild(span);
    });

    if (isPassed) {
      elDictInput.value = cue.text;
      elDictInput.classList.add("passed");
      elBtnAdvanceNext.style.display =
        activeCueIndex < enCues.length - 1 ? "inline-block" : "none";
      renderUnlockedStudy(cue);
    } else {
      if (clearInputIfUnpassed) {
        elDictInput.value = "";
        elBanner.className = "banner";
      }
      elDictInput.classList.remove("passed");
      elBtnAdvanceNext.style.display = "none";
      elStudyArea.classList.remove("open");
    }

    // Pre-fetch AI deep analysis silently while the user is listening & typing -> 0.0s wait on pass!
    triggerBackgroundPrefetch(activeCueIndex);
  }

  function renderUnlockedStudy(cue) {
    elStudyArea.classList.add("open");
    elAnsEn.textContent = cue.text;
    const koMatched = findMatchingKorean(cue.startMs, cue.endMs);
    elAnsKo.textContent = koMatched || "(한국어 자막 트랙 미연동 — 상단 [한·영 자막 동기화] 또는 [✨ AI 심층 해설]을 눌러보세요)";

    const cachedAi = aiCache.get(cue.text);
    const btnAi = shadow.getElementById("btnAskAi");
    if (btnAi) {
      if (cachedAi) {
        btnAi.textContent = "✨ AI 심층 적용됨";
        btnAi.disabled = false;
      } else if (inFlightAiMap.has(cue.text)) {
        btnAi.textContent = "⚡ AI 고속 분석 중...";
        btnAi.disabled = true;
      } else {
        btnAi.textContent = "✨ AI 심층 해설";
        btnAi.disabled = false;
      }
    }
    const analysis =
      cachedAi ||
      (window.ND_ANALYZER
        ? window.ND_ANALYZER.analyzeSentence(cue.text)
        : { pronunciation: "", vocab: [], grammar: { title: "", desc: "" } });

    if (cachedAi && cachedAi.ko && !koMatched) {
      elAnsKo.textContent = cachedAi.ko;
    }

    elAnsPron.innerHTML = `<strong>🗣️ 발음·연음 포인트:</strong> ${escapeHtml(analysis.pronunciation)}`;

    elVocabContainer.innerHTML = "";
    if (!analysis.vocab || analysis.vocab.length === 0) {
      elVocabContainer.innerHTML = `<div style="font-size:12px; color:#94a3b8;">일상 기본 어휘로 이루어진 문장입니다. 더 세밀한 어휘·뉘앙스 풀이가 필요하면 우측 [✨ AI 심층 해설]을 눌러보세요!</div>`;
    } else {
      analysis.vocab.forEach((v) => {
        const alreadySaved = savedVocab.some((s) => s.term === v.term);
        const box = document.createElement("div");
        box.className = "vocab-entry";
        box.innerHTML = `
          <div class="nd-row">
            <span class="vocab-term">${escapeHtml(v.term)} <span style="font-size:11px; color:#38bdf8;">[${escapeHtml(v.typeLabel || "표현")}]</span></span>
            <button class="btn btn-save-v" style="padding:2px 7px; font-size:11px;">${alreadySaved ? "★ 저장됨" : "☆ 단어장 저장"}</button>
          </div>
          <div class="vocab-meaning">${escapeHtml(v.meaning)}</div>
          <div class="vocab-nuance">${escapeHtml(v.nuance || "")}</div>
        `;
        box.querySelector(".btn-save-v").addEventListener("click", () => {
          toggleSaveWord(v, cue.text);
          renderUnlockedStudy(cue);
        });
        elVocabContainer.appendChild(box);
      });
    }

    const gTitle = (analysis.grammar && analysis.grammar.title) || "핵심 문법 포인트";
    const gDesc = (analysis.grammar && analysis.grammar.desc) || "";
    elGrammarTitle.textContent = gTitle;
    elGrammarDesc.textContent = gDesc;

    const btnSaveGrammar = shadow.getElementById("btnSaveGrammar");
    if (btnSaveGrammar) {
      const gSaved = isGrammarSaved(gTitle, cue.text);
      btnSaveGrammar.textContent = gSaved ? "★ 문법 저장됨" : "☆ 문법 저장";
      btnSaveGrammar.classList.toggle("btn-active", gSaved);
      btnSaveGrammar.onclick = () => {
        toggleSaveGrammar(
          { title: gTitle, desc: gDesc },
          cue.text,
          elAnsKo.textContent.startsWith("(") ? "" : elAnsKo.textContent
        );
        renderUnlockedStudy(cue);
      };
    }
  }

  function showBanner(kind, msg) {
    elBanner.className = `banner show ${kind}`;
    elBanner.textContent = msg;
  }

  // ==================== Episode Progress Persistence & Precision Resume ====================
  function saveEpisodeProgress() {
    if (!enCues.length) return;
    const epId = getWatchEpisodeId();
    if (!epId) return;

    // Determine next unpassed cue to resume from next session
    let nextTargetIdx = activeCueIndex;
    if (passedCueIndices.has(activeCueIndex) && activeCueIndex < enCues.length - 1) {
      nextTargetIdx = activeCueIndex + 1;
    }

    const passedStartMsList = Array.from(passedCueIndices)
      .map((i) => enCues[i] && enCues[i].startMs)
      .filter((v) => typeof v === "number");

    const targetCue = enCues[nextTargetIdx] || enCues[activeCueIndex];
    const record = {
      episodeId: epId,
      watchUrl: location.origin + location.pathname,
      title: detectEpisodeTitle(),
      passedStartMsList,
      passedCount: passedCueIndices.size,
      totalCues: enCues.length,
      resumeCueIndex: nextTargetIdx,
      resumeStartMs: targetCue ? targetCue.startMs : 0,
      resumePreview: targetCue ? targetCue.text.slice(0, 60) : "",
      updatedAt: new Date().toISOString()
    };

    episodeProgressMap[epId] = record;
    // Keep at most 40 recent episodes so storage stays tiny
    const keys = Object.keys(episodeProgressMap);
    if (keys.length > 40) {
      delete episodeProgressMap[keys[0]];
    }

    storageSet("nd_episode_progress_v1", episodeProgressMap);
    storageSet("nd_last_session_v1", record);
  }

  async function restoreEpisodeProgressAndOfferResume() {
    const elResumeBar = shadow.getElementById("resumeBar");
    const elResumeInfo = shadow.getElementById("resumeInfoText");
    if (elResumeBar) elResumeBar.classList.remove("open");

    if (!enCues.length) return;
    const epId = getWatchEpisodeId();
    episodeProgressMap = await storageGet("nd_episode_progress_v1", episodeProgressMap || {});
    const saved = episodeProgressMap[epId];
    if (!saved) return;

    // Restore passedCueIndices by matching saved startMs within ±600ms
    passedCueIndices.clear();
    const savedMsArr = saved.passedStartMsList || [];
    if (savedMsArr.length > 0) {
      enCues.forEach((c, idx) => {
        if (savedMsArr.some((ms) => Math.abs(c.startMs - ms) <= 600)) {
          passedCueIndices.add(idx);
        }
      });
    }

    // Resolve exact resume cue index
    let targetIdx = -1;
    if (typeof saved.resumeStartMs === "number") {
      targetIdx = enCues.findIndex((c) => Math.abs(c.startMs - saved.resumeStartMs) <= 600);
    }
    if (targetIdx < 0 && typeof saved.resumeCueIndex === "number") {
      targetIdx = Math.min(enCues.length - 1, Math.max(0, saved.resumeCueIndex));
    }

    if (targetIdx < 0 || (passedCueIndices.size === 0 && targetIdx === 0)) {
      return;
    }

    resumeTargetIndex = targetIdx;

    // Check if user clicked "[▶ 마지막 학습 바로 이어하기]" from the toolbar popup!
    const autoJumpEpId = await storageGet("nd_auto_jump_episode_v1", "");
    if (autoJumpEpId && autoJumpEpId === epId) {
      storageSet("nd_auto_jump_episode_v1", "");
      jumpToSavedResumePoint();
      return;
    }

    // Otherwise show one-click Precision Resume banner if we aren't already at that cue
    const targetCue = enCues[targetIdx];
    if (elResumeBar && elResumeInfo && targetCue) {
      elResumeInfo.textContent = `📌 이전 학습 기록 (${passedCueIndices.size}/${enCues.length} 통과) — ${targetIdx + 1}번 대사(${formatMs(targetCue.startMs)})부터 이어할까요?`;
      elResumeBar.classList.add("open");
    }
    renderCueUI(true);
  }

  function jumpToSavedResumePoint() {
    if (resumeTargetIndex < 0 || resumeTargetIndex >= enCues.length) return;
    const elResumeBar = shadow.getElementById("resumeBar");
    if (elResumeBar) elResumeBar.classList.remove("open");

    activeCueIndex = resumeTargetIndex;
    resumeSeekGuardUntil = Date.now() + 2800;
    resetCueHintState();
    renderCueUI(true);
    replayCurrentCue();
    showBanner("ok", `▶ 이전 학습 지점인 ${activeCueIndex + 1}번 대사(${formatMs(enCues[activeCueIndex].startMs)})로 이동했습니다!`);
  }

  // ==================== Playback & Progression ====================
  function getTargetCueBounds(cue) {
    const start = Math.max(0, cue.startMs + startTrimMs - 25);
    const end = Math.max(start + 350, cue.endMs + endPadMs);
    return { start, end };
  }

  function updateTrimLabels() {
    const elStart = shadow.getElementById("startTrimLabel");
    const elEnd = shadow.getElementById("endPadLabel");
    if (elStart) {
      const sSec = startTrimMs / 1000;
      elStart.textContent = `${sSec > 0 ? "+" : ""}${sSec.toFixed(1)}s`;
    }
    if (elEnd) {
      const eSec = (endPadMs - 40) / 1000;
      elEnd.textContent = `${eSec >= 0 ? "+" : ""}${eSec.toFixed(1)}s`;
    }
  }

  function replayCurrentCue() {
    const cue = getActiveCue();
    if (!cue) return;
    autoPausedForCue.delete(activeCueIndex);
    segmentReplayArmed = true;
    resumeSeekGuardUntil = Date.now() + 2600;
    const bounds = getTargetCueBounds(cue);
    sendPlayerCmd("SEEK_EXACT_PLAY", {
      timeMs: bounds.start,
      stopAtMs: bounds.end,
      rate: playbackRate
    });
    focusDictInputSafely();
  }

  function handleGradeOrNext() {
    const cue = getActiveCue();
    if (!cue) return;

    if (passedCueIndices.has(activeCueIndex)) {
      advanceToNextCue();
      return;
    }

    const typed = elDictInput.value.trim();
    if (!typed) {
      replayCurrentCue();
      showBanner("retry", "🎧 먼저 대사 구간을 듣고 들리는 영어 단어를 입력해 보세요!");
      return;
    }

    hasAttemptedCurrent = true;
    const res = gradeDictation(cue.text, typed);
    lastMatchedDisplaySet = res.matchedDisplayIndices;

    if (res.passed) {
      passedCueIndices.add(activeCueIndex);
      saveEpisodeProgress();
      sendPlayerCmd("PAUSE");
      showBanner(
        "ok",
        `🎉 통과 완료! (정확도 ${res.accuracy}%) — 아래 표현·문법 해설 확인 후 Enter를 누르면 다음 대사가 재생됩니다.`
      );
      renderCueUI(false);
    } else {
      renderCueUI(false);
      showBanner(
        "retry",
        `아직 안 들린 단어가 있어요 (${res.matchedWordsCount}/${res.totalWords} 일치 · ${res.accuracy}%). 초록색 단어를 참고해 다시 들어보세요!`
      );
      replayCurrentCue();
    }
  }

  function advanceToNextCue() {
    if (activeCueIndex >= enCues.length - 1) return;
    activeCueIndex++;
    const nextCue = enCues[activeCueIndex];

    resetCueHintState();
    autoPausedForCue.delete(activeCueIndex);
    segmentReplayArmed = true;
    saveEpisodeProgress();
    renderCueUI(true);

    const bounds = getTargetCueBounds(nextCue);
    resumeSeekGuardUntil = Date.now() + 2600;

    // Jump cleanly to nextCue.startMs unless playhead is already right at [-140ms, +90ms] of bounds.start
    if (lastKnownTimeMs < bounds.start - 140 || lastKnownTimeMs > bounds.start + 90) {
      sendPlayerCmd("SEEK_EXACT_PLAY", {
        timeMs: bounds.start,
        stopAtMs: bounds.end,
        rate: playbackRate
      });
    } else {
      sendPlayerCmd("SET_STOP_AT", { stopAtMs: bounds.end, rate: playbackRate });
      sendPlayerCmd("PLAY");
    }
    focusDictInputSafely();
  }

  let vocabDrawerFilter = "all"; // 'all' | 'vocab' | 'grammar'

  function isGrammarSaved(grammarTitle, sentenceContext) {
    return savedVocab.some(
      (item) =>
        item.kind === "grammar" &&
        item.term === grammarTitle &&
        item.sentence === sentenceContext
    );
  }

  // ==================== Notion Auto-Sync Bridge ====================
  function isNotionConfigured() {
    return Boolean(notionConfig && notionConfig.token && notionConfig.targetUrl);
  }

  function callNotionBg(type, payload) {
    return new Promise((resolve) => {
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        try {
          chrome.runtime.sendMessage(Object.assign({ type }, payload || {}), (resp) => {
            if (chrome.runtime.lastError) {
              resolve({ ok: false, error: chrome.runtime.lastError.message });
              return;
            }
            resolve(resp || { ok: false, error: "백그라운드 응답 없음" });
          });
          return;
        } catch (e) {
          resolve({ ok: false, error: String(e) });
          return;
        }
      }
      // Local preview fallback (/api/notion on localhost:8765)
      fetch("/api/notion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ action: type }, payload || {}))
      })
        .then((r) => r.json())
        .then((d) => resolve(d))
        .catch((err) => resolve({ ok: false, error: err ? err.message : "연결 실패" }));
    });
  }

  function refreshNotionUiBadges() {
    const statePill = shadow.getElementById("notionStatePill");
    const btnSetup = shadow.getElementById("btnNotionToggleSetup");
    const btnBulk = shadow.getElementById("btnNotionBulkSync");
    const tokenIn = shadow.getElementById("notionTokenInput");
    const urlIn = shadow.getElementById("notionUrlInput");
    const autoChk = shadow.getElementById("notionAutoCheck");

    if (tokenIn && shadow.activeElement !== tokenIn && !tokenIn.value) {
      tokenIn.value = notionConfig.token || "";
    }
    if (urlIn && shadow.activeElement !== urlIn && !urlIn.value) {
      urlIn.value = notionConfig.targetUrl || "";
    }
    if (autoChk) autoChk.checked = notionConfig.autoSync !== false;

    const connected = isNotionConfigured();
    if (statePill) {
      statePill.textContent = connected
        ? `🟢 연결됨 (${notionConfig.dbTitle || "자동저장 ON"})`
        : "⚪ 미연결";
      statePill.style.color = connected ? "#6ee7b7" : "#94a3b8";
    }
    if (btnSetup) {
      btnSetup.textContent = connected ? "📓 노션 ON" : "📓 노션 설정";
      btnSetup.style.borderColor = connected ? "#10b981" : "#818cf8";
      btnSetup.style.color = connected ? "#6ee7b7" : "#c7d2fe";
    }
    if (btnBulk) {
      const unsyncedCount = savedVocab.filter((x) => !x.notionPageId).length;
      btnBulk.style.display = connected && unsyncedCount > 0 ? "inline-block" : "none";
      if (unsyncedCount > 0) {
        btnBulk.textContent = `🔄 노션 일괄전송(${unsyncedCount})`;
      }
    }
    updateVocabCountBadge();
  }

  async function autoPushItemToNotion(itemObj) {
    if (!isNotionConfigured() || notionConfig.autoSync === false) return;
    const res = await callNotionBg("ND_NOTION_PUSH_ITEM", {
      token: notionConfig.token,
      targetUrl: notionConfig.targetUrl,
      cachedDbId: notionConfig.databaseId || "",
      defaultTitle: "📚 넷플릭스 영어 단어 · 문법장",
      item: itemObj
    });

    if (res && res.ok) {
      itemObj.notionPageId = res.notionPageId;
      if (res.databaseId && res.databaseId !== notionConfig.databaseId) {
        notionConfig.databaseId = res.databaseId;
        notionConfig.dbTitle = res.dbTitle || notionConfig.dbTitle;
        storageSet("nd_notion_config_v1", notionConfig);
      }
      storageSet("nd_saved_vocab_v1", savedVocab);
      renderVocabDrawer();
      showBanner("ok", `📓 '${itemObj.term}' 항목이 노션 단어장에 실시간 자동 저장되었습니다!`);
    } else if (res && res.error) {
      showBanner("retry", `⚠️ 노션 자동저장 실패: ${res.error}`);
    }
  }

  async function archiveItemFromNotion(notionPageId) {
    if (!notionPageId || !notionConfig.token) return;
    await callNotionBg("ND_NOTION_ARCHIVE_PAGE", {
      token: notionConfig.token,
      notionPageId
    });
  }

  function toggleSaveGrammar(grammarObj, sentenceContext, koTranslation) {
    const idx = savedVocab.findIndex(
      (item) =>
        item.kind === "grammar" &&
        item.term === grammarObj.title &&
        item.sentence === sentenceContext
    );
    if (idx >= 0) {
      const removed = savedVocab.splice(idx, 1)[0];
      if (removed && removed.notionPageId) archiveItemFromNotion(removed.notionPageId);
    } else {
      const newItem = {
        kind: "grammar",
        term: grammarObj.title,
        typeLabel: "문법 포인트",
        meaning: grammarObj.desc,
        nuance: koTranslation ? `해석: ${koTranslation}` : "",
        sentence: sentenceContext,
        show: detectEpisodeTitle(),
        savedAt: new Date().toISOString()
      };
      savedVocab.unshift(newItem);
      autoPushItemToNotion(newItem);
    }
    storageSet("nd_saved_vocab_v1", savedVocab);
    renderVocabDrawer();
  }

  function getFilteredSavedItems() {
    if (vocabDrawerFilter === "grammar") {
      return savedVocab.filter((item) => item.kind === "grammar");
    }
    if (vocabDrawerFilter === "vocab") {
      return savedVocab.filter((item) => item.kind !== "grammar");
    }
    return savedVocab;
  }

  function updateVocabCountBadge() {
    const btn = shadow.getElementById("btnVocabOpen");
    const countSpan = shadow.getElementById("vocabDrawerCount");
    const notionSuffix = isNotionConfigured() && notionConfig.autoSync !== false ? "·📓" : "";
    if (btn) btn.textContent = `★ 학습장(${savedVocab.length}${notionSuffix})`;
    if (countSpan) countSpan.textContent = String(savedVocab.length);
  }

  function renderVocabDrawer() {
    updateVocabCountBadge();
    const listEl = shadow.getElementById("vocabDrawerList");
    if (!listEl) return;

    const filtered = getFilteredSavedItems();
    if (!filtered.length) {
      const emptyMsg =
        vocabDrawerFilter === "grammar"
          ? "저장된 문법 포인트가 없습니다. 해설 카드에서 <strong>[☆ 문법 저장]</strong>을 눌러보세요!"
          : vocabDrawerFilter === "vocab"
          ? "저장된 단어·숙어가 없습니다. 해설 카드에서 <strong>[☆ 단어장 저장]</strong>을 눌러보세요!"
          : "아직 저장된 단어·숙어나 문법 포인트가 없습니다. 대사를 통과한 뒤 <strong>[☆ 단어장 저장]</strong> 또는 <strong>[☆ 문법 저장]</strong>을 눌러보세요!";
      listEl.innerHTML = `<div style="font-size:12px; color:#94a3b8; padding:8px 2px;">${emptyMsg}</div>`;
      return;
    }

    listEl.innerHTML = "";
    filtered.forEach((item) => {
      const isGrammar = item.kind === "grammar";
      const termColor = isGrammar ? "#fcd34d" : "#f472b6";
      const badgeColor = isGrammar ? "#fbbf24" : "#38bdf8";

      const card = document.createElement("div");
      card.className = "vocab-entry";
      card.style.marginBottom = "0";
      if (isGrammar) {
        card.style.borderLeft = "3px solid #f59e0b";
      }
      card.innerHTML = `
        <div class="nd-row">
          <span class="vocab-term" style="color:${termColor};">${isGrammar ? "🧩 " : ""}${escapeHtml(item.term)} <span style="font-size:11px; color:${badgeColor};">[${escapeHtml(item.typeLabel || "표현")}]</span>${item.notionPageId ? ` <span style="font-size:10px; color:#6ee7b7;">📓노션됨</span>` : ""}</span>
          <button class="btn btn-del-saved" style="padding:2px 7px; font-size:11px;">삭제</button>
        </div>
        <div class="vocab-meaning" style="font-weight:${isGrammar ? "500" : "700"}; line-height:1.5;">${escapeHtml(item.meaning || "")}</div>
        ${item.nuance ? `<div class="vocab-nuance">${escapeHtml(item.nuance)}</div>` : ""}
        ${item.sentence ? `<div style="font-size:11.5px; color:#93c5fd; margin-top:4px; font-style:italic;">"${escapeHtml(item.sentence)}"</div>` : ""}
      `;
      card.querySelector(".btn-del-saved").addEventListener("click", () => {
        const realIdx = savedVocab.indexOf(item);
        if (realIdx >= 0) {
          const removed = savedVocab.splice(realIdx, 1)[0];
          if (removed && removed.notionPageId) archiveItemFromNotion(removed.notionPageId);
        }
        storageSet("nd_saved_vocab_v1", savedVocab);
        renderVocabDrawer();
        refreshNotionUiBadges();
        const cue = getActiveCue();
        if (cue && passedCueIndices.has(activeCueIndex)) {
          renderUnlockedStudy(cue);
        }
      });
      listEl.appendChild(card);
    });
    refreshNotionUiBadges();
  }

  function downloadBlobFile(content, filename, mimeType) {
    // Prepend UTF-8 BOM (\uFEFF) so Korean characters open cleanly in Windows Excel & Notepad!
    const blob = new Blob(["\uFEFF" + content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
  }

  function getTodayStamp() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function exportVocabToCsv() {
    const items = getFilteredSavedItems();
    if (!items.length) {
      showBanner("retry", "💡 내보낼 항목이 없습니다. 먼저 표현이나 문법 포인트를 저장해 주세요!");
      return;
    }
    const esc = (v) => `"${String(v || "").replace(/\r?\n/g, " ").trim().replace(/"/g, '""')}"`;
    const rows = [
      ["번호", "구분", "표현 / 핵심 문법명", "뜻 / 문법 상세 해설", "뉘앙스 / 대사 해석", "출전 영어 대사", "저장 일시"].map(esc).join(",")
    ];
    items.forEach((item, i) => {
      rows.push(
        [
          i + 1,
          item.typeLabel || (item.kind === "grammar" ? "문법 포인트" : "표현"),
          item.term || "",
          item.meaning || "",
          item.nuance || "",
          item.sentence || "",
          item.savedAt ? item.savedAt.slice(0, 10) : ""
        ]
          .map(esc)
          .join(",")
      );
    });
    const suffix = vocabDrawerFilter === "grammar" ? "문법노트" : vocabDrawerFilter === "vocab" ? "단어장" : "단어문법장";
    const fileName = `넷플릭스_미드_${suffix}_${getTodayStamp()}.csv`;
    downloadBlobFile(rows.join("\r\n"), fileName, "text/csv;charset=utf-8;");
    showBanner("ok", `📊 '${fileName}' 엑셀 파일 다운로드가 시작되었습니다!`);
  }

  function exportVocabToTxt() {
    const items = getFilteredSavedItems();
    if (!items.length) {
      showBanner("retry", "💡 내보낼 항목이 없습니다. 먼저 표현이나 문법 포인트를 저장해 주세요!");
      return;
    }
    const suffix = vocabDrawerFilter === "grammar" ? "문법 노트" : vocabDrawerFilter === "vocab" ? "단어·숙어장" : "단어 & 문법 학습장";
    const lines = [
      "============================================================",
      `  Netflix Sitcom Dictation Studio — 나만의 미드 ${suffix}`,
      `  내보낸 날짜: ${getTodayStamp()} (총 ${items.length}개 항목)`,
      "============================================================",
      ""
    ];
    items.forEach((item, i) => {
      const isGrammar = item.kind === "grammar";
      lines.push(`[${i + 1}] ${isGrammar ? "🧩 [문법] " : "📚 [표현] "}${item.term || ""} (${item.typeLabel || "표현"})`);
      lines.push(` • ${isGrammar ? "문법 해설" : "뜻"}: ${item.meaning || ""}`);
      if (item.nuance) lines.push(` • ${isGrammar ? "참고" : "뉘앙스"}: ${item.nuance}`);
      if (item.sentence) lines.push(` • 원문 대사: "${item.sentence}"`);
      lines.push("");
    });
    const fileTag = vocabDrawerFilter === "grammar" ? "문법노트" : vocabDrawerFilter === "vocab" ? "단어장" : "단어문법장";
    const fileName = `넷플릭스_미드_${fileTag}_${getTodayStamp()}.txt`;
    downloadBlobFile(lines.join("\r\n"), fileName, "text/plain;charset=utf-8;");
    showBanner("ok", `📝 '${fileName}' 메모장 파일 다운로드가 시작되었습니다!`);
  }

  function toggleSaveWord(v, sentenceContext) {
    const idx = savedVocab.findIndex((item) => item.kind !== "grammar" && item.term === v.term);
    if (idx >= 0) {
      const removed = savedVocab.splice(idx, 1)[0];
      if (removed && removed.notionPageId) archiveItemFromNotion(removed.notionPageId);
    } else {
      const newItem = {
        kind: "vocab",
        term: v.term,
        typeLabel: v.typeLabel,
        meaning: v.meaning,
        nuance: v.nuance,
        sentence: sentenceContext,
        show: detectEpisodeTitle(),
        savedAt: new Date().toISOString()
      };
      savedVocab.unshift(newItem);
      autoPushItemToNotion(newItem);
    }
    storageSet("nd_saved_vocab_v1", savedVocab);
    renderVocabDrawer();
  }

  // ==================== Optional Gemini / OpenAI Deep Tutor ====================
  function sanitizeApiKey(raw) {
    return String(raw || "")
      .trim()
      .replace(/^["']+|["']+$/g, "")
      .replace(/\s+/g, "");
  }

  function parseCleanAiJson(rawText) {
    let s = String(rawText || "").trim();
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const first = s.indexOf("{");
    const last = s.lastIndexOf("}");
    if (first !== -1 && last > first) {
      s = s.slice(first, last + 1);
    }
    return JSON.parse(s);
  }

  let directModelCache = "";
  let directModelList = [];
  let directKeyPrefix = "";
  const inFlightAiMap = new Map();

  function buildFastAiPrompt(sentence) {
    return `미드 영어 대사를 한국인 중급 학습자용으로 간결히 분석해 JSON만 출력하세요.
대사: "${sentence}"
{"ko":"자연스러운 구어 번역","pronunciation":"연음·강세 핵심 1문장","vocab":[{"term":"숙어/구동사/핵심어","typeLabel":"구동사|관용어|슬랭|어휘","meaning":"한국어 뜻","nuance":"미드 뉘앙스 1문장"}],"grammar":{"title":"핵심 문법명","desc":"구조·활용 핵심 1~2문장"}}`;
  }

  function persistAiCache() {
    try {
      const entries = Array.from(aiCache.entries()).slice(-150);
      storageSet("nd_ai_cache_v1", entries);
    } catch (_) {}
  }

  async function callAiDirectFallback(cleanKey, prompt) {
    if (cleanKey.startsWith("sk-")) {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cleanKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          max_tokens: 550,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: "American TV drama English tutor for Korean learners. Concise JSON only."
            },
            { role: "user", content: prompt }
          ]
        })
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        throw new Error(data?.error?.message || `HTTP ${resp.status}`);
      }
      return {
        data: parseCleanAiJson(data?.choices?.[0]?.message?.content || ""),
        modelUsed: "gpt-4o-mini"
      };
    }

    const prefix = cleanKey.slice(0, 10);
    // Skip /v1beta/models round-trip once cached! Saves ~700ms per call!
    if (!directModelCache || directKeyPrefix !== prefix) {
      const listResp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cleanKey)}`
      );
      const listData = await listResp.json();
      if (!listResp.ok || listData.error) {
        throw new Error(listData?.error?.message || `HTTP ${listResp.status}`);
      }

      const models = (listData.models || []).filter(
        (m) =>
          Array.isArray(m.supportedGenerationMethods) &&
          m.supportedGenerationMethods.includes("generateContent") &&
          /^models\/gemini/i.test(m.name || "") &&
          !/tts|image|vision|embedding|veo|imagen|audio|live|robotics|computer-use|thinking|aqa/i.test(
            m.name || ""
          )
      );
      const flashModels = models.filter((m) => /flash/i.test(m.name));
      const pool = flashModels.length > 0 ? flashModels : models;
      // Prioritize flash-lite first (~0.7s minimal thinking latency!)
      pool.sort((a, b) => {
        const liteA = /flash-lite/i.test(a.name) ? 1 : 0;
        const liteB = /flash-lite/i.test(b.name) ? 1 : 0;
        if (liteB !== liteA) return liteB - liteA;
        const expA = /exp|preview/i.test(a.name) ? 1 : 0;
        const expB = /exp|preview/i.test(b.name) ? 1 : 0;
        if (expA !== expB) return expA - expB;
        const verA = parseFloat((a.name.match(/gemini-(\d+(?:\.\d+)?)/i) || [0, "0"])[1]);
        const verB = parseFloat((b.name.match(/gemini-(\d+(?:\.\d+)?)/i) || [0, "0"])[1]);
        return verB - verA;
      });
      directModelList = pool.map((m) => m.name);
      directKeyPrefix = prefix;
    }

    const candidates = directModelCache
      ? [directModelCache, ...directModelList.filter((n) => n !== directModelCache)]
      : directModelList;

    let lastErr = "사용 가능한 Gemini 모델이 없습니다.";
    for (const modelName of candidates.slice(0, 4)) {
      try {
        const ver = parseFloat((modelName.match(/gemini-(\d+(?:\.\d+)?)/i) || [0, "0"])[1]);
        const genCfg = { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 600 };
        if (!/flash-lite/i.test(modelName)) {
          if (ver >= 3) genCfg.thinkingConfig = { thinkingLevel: "minimal" };
          else if (ver >= 2.5) genCfg.thinkingConfig = { thinkingBudget: 0 };
        }

        let resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${encodeURIComponent(cleanKey)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: genCfg
            })
          }
        );
        let data = await resp.json();
        if (resp.status === 400 && genCfg.thinkingConfig) {
          delete genCfg.thinkingConfig;
          resp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${encodeURIComponent(cleanKey)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: genCfg
              })
            }
          );
          data = await resp.json();
        }
        if (!resp.ok || data.error) {
          lastErr = data?.error?.message || `HTTP ${resp.status}`;
          continue;
        }
        const parts = data?.candidates?.[0]?.content?.parts || [];
        const ansPart =
          parts.find((p) => !p.thought && typeof p.text === "string" && p.text.includes("{")) ||
          parts.find((p) => !p.thought && typeof p.text === "string") ||
          parts[parts.length - 1];
        if (!ansPart || !ansPart.text) continue;
        const parsed = parseCleanAiJson(ansPart.text);
        directModelCache = modelName;
        return { data: parsed, modelUsed: modelName.replace(/^models\//, "") };
      } catch (e) {
        lastErr = e && e.message ? e.message : String(e);
      }
    }
    directModelCache = "";
    throw new Error(lastErr);
  }

  async function runAiRequest(cleanKey, prompt) {
    if (
      typeof chrome !== "undefined" &&
      chrome.runtime &&
      chrome.runtime.id &&
      typeof chrome.runtime.sendMessage === "function"
    ) {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: "ND_AI_ANALYZE", apiKey: cleanKey, prompt },
          (res) => {
            if (chrome.runtime.lastError) {
              callAiDirectFallback(cleanKey, prompt).then(resolve).catch(reject);
              return;
            }
            if (res && res.ok) {
              resolve({ data: res.data, modelUsed: res.modelUsed });
            } else {
              reject(new Error((res && res.error) || "AI 응답 오류"));
            }
          }
        );
      });
    }
    return callAiDirectFallback(cleanKey, prompt);
  }

  function fetchCueAiShared(cueText, cleanKey) {
    if (aiCache.has(cueText)) {
      return Promise.resolve({ data: aiCache.get(cueText), modelUsed: "cached" });
    }
    if (inFlightAiMap.has(cueText)) {
      return inFlightAiMap.get(cueText);
    }
    const p = runAiRequest(cleanKey, buildFastAiPrompt(cueText))
      .then((res) => {
        if (res && res.data) {
          aiCache.set(cueText, res.data);
          persistAiCache();
        }
        return res;
      })
      .finally(() => {
        inFlightAiMap.delete(cueText);
      });
    inFlightAiMap.set(cueText, p);
    return p;
  }

  function triggerBackgroundPrefetch(cueIdx) {
    const cleanKey = sanitizeApiKey(geminiApiKey);
    if (!cleanKey || !enCues.length) return;
    const targetCue = enCues[cueIdx];
    if (!targetCue) return;

    fetchCueAiShared(targetCue.text, cleanKey)
      .then(() => {
        const activeNow = getActiveCue();
        if (activeNow && activeNow.text === targetCue.text && passedCueIndices.has(activeCueIndex)) {
          renderUnlockedStudy(activeNow);
        }
        // Also pre-fetch the NEXT line (cueIdx + 1) so the user never waits!
        const nextCue = enCues[cueIdx + 1];
        if (nextCue && !aiCache.has(nextCue.text) && !inFlightAiMap.has(nextCue.text)) {
          fetchCueAiShared(nextCue.text, cleanKey).catch(() => {});
        }
      })
      .catch(() => {
        const activeNow = getActiveCue();
        if (activeNow && activeNow.text === targetCue.text && passedCueIndices.has(activeCueIndex)) {
          renderUnlockedStudy(activeNow);
        }
      });
  }

  async function requestGeminiAnalysis() {
    const cue = getActiveCue();
    if (!cue) return;
    const cleanKey = sanitizeApiKey(geminiApiKey);
    if (!cleanKey) {
      elApiDrawer.classList.add("open");
      elApiKeyInput.focus();
      showBanner("retry", "💡 상단 입력창에 Gemini API 키(AIza...) 또는 OpenAI 키(sk-...)를 저장해 주세요.");
      return;
    }

    const btn = shadow.getElementById("btnAskAi");
    btn.textContent = "⚡ AI 고속 분석 중...";
    btn.disabled = true;

    try {
      const result = await fetchCueAiShared(cue.text, cleanKey);
      if (result && result.data) {
        renderUnlockedStudy(cue);
        showBanner(
          "ok",
          `✨ AI 심층 해설 적용 완료! (${result.modelUsed === "cached" ? "사전 분석 캐시 · 0.0초" : result.modelUsed || "AI"})`
        );
      }
    } catch (err) {
      const detail = err && err.message ? err.message : "알 수 없는 오류";
      showBanner("retry", `⚠️ AI 호출 오류: ${detail}`);
      btn.textContent = "✨ AI 심층 해설";
      btn.disabled = false;
    }
  }

  // ==================== Button Listeners ====================
  shadow.getElementById("btnMinimize").addEventListener("click", () => {
    panelMinimized = true;
    syncBodyClasses();
  });

  elMiniPill.addEventListener("click", () => {
    panelMinimized = false;
    syncBodyClasses();
  });

  shadow.getElementById("btnDockToggle").addEventListener("click", () => {
    dockMode = dockMode === "right" ? "bottom" : "right";
    elShell.classList.toggle("dock-right", dockMode === "right");
    elShell.classList.toggle("dock-bottom", dockMode === "bottom");
    syncBodyClasses();
  });

  const btnPauseMode = shadow.getElementById("btnPauseMode");
  btnPauseMode.addEventListener("click", () => {
    dictationEnabled = !dictationEnabled;
    btnPauseMode.textContent = dictationEnabled ? "자동멈춤" : "일반시청";
    btnPauseMode.classList.toggle("btn-active", dictationEnabled);
    syncBodyClasses();
  });

  const elVocabDrawer = shadow.getElementById("vocabDrawer");
  shadow.getElementById("btnVocabOpen").addEventListener("click", () => {
    renderVocabDrawer();
    elVocabDrawer.classList.toggle("open");
  });

  shadow.getElementById("btnVocabClose").addEventListener("click", () => {
    elVocabDrawer.classList.remove("open");
  });

  shadow.querySelectorAll(".vocab-filter-btn").forEach((b) => {
    b.addEventListener("click", () => {
      vocabDrawerFilter = b.dataset.vfilter || "all";
      shadow.querySelectorAll(".vocab-filter-btn").forEach((x) => x.classList.remove("btn-active"));
      b.classList.add("btn-active");
      renderVocabDrawer();
    });
  });

  shadow.getElementById("btnExportCsv").addEventListener("click", exportVocabToCsv);
  shadow.getElementById("btnExportTxt").addEventListener("click", exportVocabToTxt);

  const elNotionSetupBox = shadow.getElementById("notionSetupBox");
  const elNotionStatusMsg = shadow.getElementById("notionStatusMsg");

  shadow.getElementById("btnNotionToggleSetup").addEventListener("click", () => {
    const opening = elNotionSetupBox.style.display !== "flex";
    if (opening) {
      shadow.getElementById("notionTokenInput").value = notionConfig.token || "";
      shadow.getElementById("notionUrlInput").value = notionConfig.targetUrl || "";
      refreshNotionUiBadges();
      elNotionSetupBox.style.display = "flex";
      otherInputGuardUntil = Date.now() + 500;
      setTimeout(() => shadow.getElementById("notionTokenInput").focus(), 20);
    } else {
      elNotionSetupBox.style.display = "none";
    }
  });

  shadow.getElementById("btnPasteNotionToken").addEventListener("click", async () => {
    otherInputGuardUntil = Date.now() + 500;
    const inp = shadow.getElementById("notionTokenInput");
    inp.focus();
    try {
      const txt = await navigator.clipboard.readText();
      if (txt) inp.value = txt.trim();
    } catch (_) {
      elNotionStatusMsg.style.color = "#fcd34d";
      elNotionStatusMsg.textContent = "입력칸을 클릭한 뒤 Ctrl + V를 눌러 붙여넣어 주세요.";
    }
  });

  shadow.getElementById("btnPasteNotionUrl").addEventListener("click", async () => {
    otherInputGuardUntil = Date.now() + 500;
    const inp = shadow.getElementById("notionUrlInput");
    inp.focus();
    try {
      const txt = await navigator.clipboard.readText();
      if (txt) inp.value = txt.trim();
    } catch (_) {
      elNotionStatusMsg.style.color = "#fcd34d";
      elNotionStatusMsg.textContent = "입력칸을 클릭한 뒤 Ctrl + V를 눌러 붙여넣어 주세요.";
    }
  });

  shadow.getElementById("notionAutoCheck").addEventListener("change", (e) => {
    notionConfig.autoSync = Boolean(e.target.checked);
    storageSet("nd_notion_config_v1", notionConfig);
    refreshNotionUiBadges();
  });

  shadow.getElementById("btnNotionDisconnect").addEventListener("click", () => {
    notionConfig = { token: "", targetUrl: "", databaseId: "", dbTitle: "", autoSync: true };
    shadow.getElementById("notionTokenInput").value = "";
    shadow.getElementById("notionUrlInput").value = "";
    storageSet("nd_notion_config_v1", notionConfig);
    refreshNotionUiBadges();
    elNotionStatusMsg.style.color = "#fcd34d";
    elNotionStatusMsg.textContent = "노션 연동이 해제되었습니다.";
  });

  shadow.getElementById("btnNotionConnect").addEventListener("click", async () => {
    const tokenVal = sanitizeApiKey(shadow.getElementById("notionTokenInput").value);
    const urlVal = String(shadow.getElementById("notionUrlInput").value || "").trim();
    const autoVal = Boolean(shadow.getElementById("notionAutoCheck").checked);

    if (!tokenVal || !urlVal) {
      elNotionStatusMsg.style.color = "#fca5a5";
      elNotionStatusMsg.textContent = "⚠️ 1번 노션 API 토큰과 2번 노션 페이지 링크를 모두 입력해 주세요.";
      return;
    }

    const btn = shadow.getElementById("btnNotionConnect");
    btn.disabled = true;
    btn.textContent = "연결 확인 중...";
    elNotionStatusMsg.style.color = "#93c5fd";
    elNotionStatusMsg.textContent = "노션 페이지 권한 확인 및 단어·문법장 표를 준비하고 있습니다...";

    const prevChanged = urlVal !== notionConfig.targetUrl;
    const res = await callNotionBg("ND_NOTION_CONNECT", {
      token: tokenVal,
      targetUrl: urlVal,
      cachedDbId: prevChanged ? "" : (notionConfig.databaseId || ""),
      defaultTitle: "📚 넷플릭스 영어 단어 · 문법장"
    });

    btn.disabled = false;
    btn.textContent = "🔌 연결 & 표 자동생성";

    if (res && res.ok) {
      notionConfig = {
        token: tokenVal,
        targetUrl: urlVal,
        databaseId: res.databaseId || "",
        dbTitle: res.dbTitle || "📚 넷플릭스 영어 단어 · 문법장",
        autoSync: autoVal
      };
      storageSet("nd_notion_config_v1", notionConfig);
      refreshNotionUiBadges();
      elNotionStatusMsg.style.color = "#6ee7b7";
      elNotionStatusMsg.textContent = `✓ 연결 성공! 노션 '${notionConfig.dbTitle}'에 이제부터 실시간 자동 저장됩니다.`;
      showBanner("ok", `📓 노션 실시간 자동 저장이 활성화되었습니다! ('${notionConfig.dbTitle}')`);
    } else {
      elNotionStatusMsg.style.color = "#fca5a5";
      elNotionStatusMsg.textContent = `⚠️ ${res && res.error ? res.error : "노션 연결에 실패했습니다."}`;
    }
  });

  shadow.getElementById("btnNotionBulkSync").addEventListener("click", async () => {
    if (!isNotionConfigured()) {
      elNotionSetupBox.style.display = "flex";
      return;
    }
    const pendingEntries = [];
    savedVocab.forEach((item, index) => {
      if (!item.notionPageId) pendingEntries.push({ index, item });
    });
    if (!pendingEntries.length) {
      showBanner("ok", "✓ 모든 학습장 항목이 이미 노션에 동기화되어 있습니다!");
      return;
    }

    const btnBulk = shadow.getElementById("btnNotionBulkSync");
    btnBulk.disabled = true;
    btnBulk.textContent = `⏳ 전송 중(${pendingEntries.length})...`;

    const res = await callNotionBg("ND_NOTION_SYNC_BATCH", {
      token: notionConfig.token,
      targetUrl: notionConfig.targetUrl,
      cachedDbId: notionConfig.databaseId || "",
      defaultTitle: "📚 넷플릭스 영어 단어 · 문법장",
      items: pendingEntries
    });

    btnBulk.disabled = false;
    if (res && res.ok && Array.isArray(res.synced)) {
      res.synced.forEach((s) => {
        if (savedVocab[s.index]) savedVocab[s.index].notionPageId = s.notionPageId;
      });
      if (res.databaseId) {
        notionConfig.databaseId = res.databaseId;
        notionConfig.dbTitle = res.dbTitle || notionConfig.dbTitle;
        storageSet("nd_notion_config_v1", notionConfig);
      }
      storageSet("nd_saved_vocab_v1", savedVocab);
      renderVocabDrawer();
      showBanner("ok", `📓 총 ${res.synced.length}개 항목을 노션 단어장으로 일괄 전송 완료했습니다!`);
    } else {
      refreshNotionUiBadges();
      showBanner("retry", `⚠️ 노션 일괄 전송 오류: ${(res && res.error) || "알 수 없는 오류"}`);
    }
  });

  shadow.getElementById("btnJumpResume").addEventListener("click", jumpToSavedResumePoint);
  shadow.getElementById("btnDismissResume").addEventListener("click", () => {
    const rb = shadow.getElementById("resumeBar");
    if (rb) rb.classList.remove("open");
  });
  shadow.getElementById("btnResetEpProgress").addEventListener("click", () => {
    const epId = getWatchEpisodeId();
    passedCueIndices.clear();
    resumeTargetIndex = -1;
    if (epId && episodeProgressMap[epId]) {
      delete episodeProgressMap[epId];
      storageSet("nd_episode_progress_v1", episodeProgressMap);
    }
    const rb = shadow.getElementById("resumeBar");
    if (rb) rb.classList.remove("open");
    activeCueIndex = 0;
    resetCueHintState();
    renderCueUI(true);
    showBanner("ok", "이 에피소드의 받아쓰기 진행 기록을 초기화했습니다.");
  });

  shadow.getElementById("btnApiSetup").addEventListener("click", () => {
    elApiDrawer.classList.toggle("open");
  });

  shadow.getElementById("btnSaveApiKey").addEventListener("click", () => {
    geminiApiKey = sanitizeApiKey(elApiKeyInput.value);
    elApiKeyInput.value = geminiApiKey;
    directModelCache = "";
    storageSet("nd_gemini_api_key_v1", geminiApiKey);
    elApiDrawer.classList.remove("open");
    showBanner("ok", geminiApiKey ? "✓ API 키가 저장되었습니다! [✨ AI 심층 해설]을 눌러보세요." : "API 키가 삭제되었습니다.");
    if (geminiApiKey && passedCueIndices.has(activeCueIndex)) {
      requestGeminiAnalysis();
    }
  });

  shadow.getElementById("btnSyncDual").addEventListener("click", () => {
    sendPlayerCmd("SYNC_DUAL_SUBS");
  });

  shadow.getElementById("btnPrevCue").addEventListener("click", () => {
    if (activeCueIndex > 0) {
      activeCueIndex--;
      resetCueHintState();
      saveEpisodeProgress();
      renderCueUI(true);
      replayCurrentCue();
    }
  });

  shadow.getElementById("btnNextCueManual").addEventListener("click", () => {
    if (activeCueIndex < enCues.length - 1) {
      activeCueIndex++;
      resetCueHintState();
      saveEpisodeProgress();
      renderCueUI(true);
      replayCurrentCue();
    }
  });

  shadow.getElementById("btnReplaySeg").addEventListener("click", replayCurrentCue);

  shadow.getElementById("btnStartTrimMinus").addEventListener("click", () => {
    startTrimMs = Math.max(-1000, startTrimMs - 200);
    updateTrimLabels();
    replayCurrentCue();
  });

  shadow.getElementById("btnStartTrimPlus").addEventListener("click", () => {
    startTrimMs = Math.min(1200, startTrimMs + 200);
    updateTrimLabels();
    replayCurrentCue();
  });

  shadow.getElementById("btnEndPadMinus").addEventListener("click", () => {
    endPadMs = Math.max(-600, endPadMs - 200);
    updateTrimLabels();
    replayCurrentCue();
  });

  shadow.getElementById("btnEndPadPlus").addEventListener("click", () => {
    endPadMs = Math.min(2000, endPadMs + 200);
    updateTrimLabels();
    replayCurrentCue();
  });

  shadow.querySelectorAll(".rate-btn").forEach((b) => {
    b.addEventListener("click", () => {
      playbackRate = parseFloat(b.dataset.rate);
      shadow.querySelectorAll(".rate-btn").forEach((x) => x.classList.remove("btn-active"));
      b.classList.add("btn-active");
      sendPlayerCmd("SET_RATE", { rate: playbackRate });
      replayCurrentCue();
    });
  });

  shadow.getElementById("btnHintFirst").addEventListener("click", () => {
    showFirstLetterHint = true;
    renderCueUI(false);
    elDictInput.focus();
  });

  shadow.getElementById("btnHintWord").addEventListener("click", () => {
    const cue = getActiveCue();
    if (!cue) return;
    const words = getDisplayWords(cue.text);
    for (let k = 0; k < words.length; k++) {
      if (!lastMatchedDisplaySet.has(k) && !revealedWordSet.has(k)) {
        revealedWordSet.add(k);
        break;
      }
    }
    renderCueUI(false);
    elDictInput.focus();
  });

  shadow.getElementById("btnReveal").addEventListener("click", () => {
    const cue = getActiveCue();
    if (!cue) return;
    passedCueIndices.add(activeCueIndex);
    saveEpisodeProgress();
    sendPlayerCmd("PAUSE");
    showBanner("ok", "📖 정답과 해설을 열었습니다! 구간을 다시 들어보며 연음과 표현을 익힌 뒤 Enter로 넘어가세요.");
    renderCueUI(false);
    elDictInput.focus();
  });

  elBtnGrade.addEventListener("click", handleGradeOrNext);
  elBtnAdvanceNext.addEventListener("click", advanceToNextCue);
  shadow.getElementById("btnAskAi").addEventListener("click", requestGeminiAnalysis);

  window.addEventListener("keydown", (e) => {
    if (!dictationEnabled || panelMinimized) return;
    if (e.ctrlKey && e.code === "Space") {
      e.preventDefault();
      replayCurrentCue();
    }
  });

  function mergeCueStream(existingCues, incomingCues, isForced) {
    if (!Array.isArray(incomingCues) || incomingCues.length === 0) return existingCues;
    if (isForced && existingCues.length >= 25) return existingCues;
    if (incomingCues.length >= 40 && existingCues.length < incomingCues.length * 0.6) {
      return incomingCues;
    }
    if (existingCues.length === 0) return incomingCues;

    const combined = existingCues.slice();
    incomingCues.forEach((nc) => {
      const dupIdx = combined.findIndex(
        (ec) => Math.abs(ec.startMs - nc.startMs) <= 90 && (ec.text === nc.text || ec.text.includes(nc.text))
      );
      if (dupIdx === -1) {
        combined.push(nc);
      } else if (nc.text.length > combined[dupIdx].text.length) {
        combined[dupIdx] = nc;
      }
    });
    combined.sort((a, b) => a.startMs - b.startMs);
    return combined;
  }

  // ==================== Listen to MAIN World Messages ====================
  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.source !== "ND_MAIN") {
      return;
    }
    const msg = event.data;

    if (msg.type === "SUBTITLE_TRACK") {
      if (msg.lang === "en") {
        const hadFull = enCues.length >= 25;
        const currCueStart = enCues[activeCueIndex] ? enCues[activeCueIndex].startMs : -1;
        enCues = mergeCueStream(enCues, msg.cues, Boolean(msg.isForced));

        if (hadFull && currCueStart >= 0) {
          const keepIdx = enCues.findIndex((c) => Math.abs(c.startMs - currCueStart) <= 120);
          if (keepIdx >= 0) activeCueIndex = keepIdx;
          renderCueUI(false);
        } else {
          const idx = enCues.findIndex((c) => c.endMs >= lastKnownTimeMs);
          activeCueIndex = idx >= 0 ? idx : 0;
          resetCueHintState();
          renderCueUI(true);
          restoreEpisodeProgressAndOfferResume();
        }
      } else if (msg.lang === "ko") {
        koCues = mergeCueStream(koCues, msg.cues, Boolean(msg.isForced));
        renderSubtitleStatus();
        const cue = getActiveCue();
        if (cue && passedCueIndices.has(activeCueIndex)) {
          renderUnlockedStudy(cue);
        }
      }
    } else if (msg.type === "LIVE_DOM_CUE") {
      // Fallback if TTML wasn't intercepted yet
      if (msg.lang === "en" && enCues.length < 25) {
        const prevLen = enCues.length;
        enCues = mergeCueStream(enCues, [msg.cue], false);
        if (prevLen === 0) {
          activeCueIndex = 0;
          resetCueHintState();
        }
        renderCueUI(prevLen === 0);
      }
    } else if (msg.type === "PRE_ROLL_STATE") {
      const badge = shadow.getElementById("preRollBadge");
      if (badge) {
        if (msg.waitingReady) {
          badge.textContent = "⏳ 플레이어 준비 후 이동 중...";
          badge.style.color = "#38bdf8";
          badge.style.display = msg.active ? "inline" : "none";
        } else if (msg.phase === "approaching") {
          badge.textContent = "⏭️ 곧 받아쓰기 대사 시작...";
          badge.style.color = "#fbbf24";
          badge.style.display = "inline";
        } else if (msg.phase === "speaking") {
          badge.textContent = "🔊 지금 이 대사 받아쓰기!";
          badge.style.color = "#34d399";
          badge.style.display = "inline";
        } else {
          badge.style.display = "none";
        }
      }
    } else if (msg.type === "EXACT_STOP_REACHED") {
      const badge = shadow.getElementById("preRollBadge");
      if (badge) badge.style.display = "none";
      autoPausedForCue.add(activeCueIndex);
      segmentReplayArmed = false;
      focusDictInputSafely();
    } else if (msg.type === "DUAL_SYNC_STATUS") {
      showBanner("ok", msg.message);
    } else if (msg.type === "STUDIO_SHORTCUT") {
      execStudioShortcutOnce(msg.command);
    } else if (msg.type === "TICK") {
      if (msg.pathname !== currentPathKey) {
        currentPathKey = msg.pathname;
        enCues = [];
        koCues = [];
        passedCueIndices.clear();
        autoPausedForCue.clear();
        syncBodyClasses();
        renderCueUI(true);
      }

      lastKnownTimeMs = msg.timeMs;
      if (!dictationEnabled || panelMinimized || enCues.length === 0) return;

      const cue = getActiveCue();
      if (!cue) return;

      const bounds = getTargetCueBounds(cue);

      // Arm 20ms exact stop inside MAIN world while approaching current cue end
      if (
        !msg.paused &&
        msg.timeMs >= bounds.start - 500 &&
        msg.timeMs < bounds.end &&
        (!passedCueIndices.has(activeCueIndex) || segmentReplayArmed) &&
        (!autoPausedForCue.has(activeCueIndex) || segmentReplayArmed)
      ) {
        sendPlayerCmd("SET_STOP_AT", { stopAtMs: bounds.end });
      }

      // Backup auto-pause right when current English dialogue cue finishes!
      if (
        !msg.paused &&
        msg.timeMs >= bounds.end &&
        msg.timeMs <= bounds.end + 2200
      ) {
        if (!passedCueIndices.has(activeCueIndex) || segmentReplayArmed) {
          if (!autoPausedForCue.has(activeCueIndex) || segmentReplayArmed) {
            autoPausedForCue.add(activeCueIndex);
            segmentReplayArmed = false;
            sendPlayerCmd("PAUSE");
            focusDictInputSafely();
          }
        }
      }

      // Sync active cue index if user manually scrubbed far away in Netflix timeline
      if (
        !segmentReplayArmed &&
        Date.now() > resumeSeekGuardUntil &&
        (msg.timeMs < cue.startMs - 4500 || msg.timeMs > cue.endMs + 4500)
      ) {
        const jumpedIdx = enCues.findIndex(
          (c) => msg.timeMs >= c.startMs - 1000 && msg.timeMs <= c.endMs + 800
        );
        if (jumpedIdx >= 0 && jumpedIdx !== activeCueIndex) {
          activeCueIndex = jumpedIdx;
          resetCueHintState();
          renderCueUI(true);
        }
      }
    }
  });

  // ==================== Initialize ====================
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.nd_gemini_api_key_v1) {
        geminiApiKey = sanitizeApiKey(changes.nd_gemini_api_key_v1.newValue || "");
        elApiKeyInput.value = geminiApiKey;
        directModelCache = "";
      }
      if (area === "local" && changes.nd_saved_vocab_v1) {
        savedVocab = changes.nd_saved_vocab_v1.newValue || [];
        renderVocabDrawer();
      }
      if (area === "local" && changes.nd_notion_config_v1) {
        notionConfig = changes.nd_notion_config_v1.newValue || notionConfig;
        refreshNotionUiBadges();
      }
    });
  }

  (async function init() {
    savedVocab = await storageGet("nd_saved_vocab_v1", []);
    notionConfig = await storageGet("nd_notion_config_v1", notionConfig);
    episodeProgressMap = await storageGet("nd_episode_progress_v1", {});
    refreshNotionUiBadges();
    geminiApiKey = await storageGet("nd_gemini_api_key_v1", "");
    const persistedAi = await storageGet("nd_ai_cache_v1", []);
    if (Array.isArray(persistedAi)) {
      persistedAi.forEach(([k, v]) => {
        if (k && v) aiCache.set(k, v);
      });
    }
    if (geminiApiKey) elApiKeyInput.value = geminiApiKey;
    syncBodyClasses();
    renderCueUI(true);
    setInterval(syncBodyClasses, 1000);
  })();
})();
