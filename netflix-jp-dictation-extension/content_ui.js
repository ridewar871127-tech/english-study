(function () {
  "use strict";

  if (window.__NJD_UI_MOUNTED__) return;
  window.__NJD_UI_MOUNTED__ = true;

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

  // ==================== State ====================
  let dictationEnabled = true;
  let dockMode = "right";
  let segMode = "bunsetsu"; // 'bunsetsu' (① 어절 묶음) | 'split' (② 조사 분리)
  let playbackRate = 1.0;
  let startTrimMs = 0;
  let endPadMs = 40;
  let skipLongSilences = true;

  let jaCues = [];
  let koCues = [];
  let activeCueIndex = 0;
  let passedCueIndices = new Set();
  let autoPausedForCue = new Set();
  let segmentReplayArmed = false;

  // Current Puzzle State
  let puzzleCueKey = "";
  let targetTokens = [];
  let poolCards = []; // [{ id, word }]
  let placedIds = []; // [id, ...]
  let checkedAttempt = false;

  // Saved Vocab/Grammar & Episode Resume State
  let savedVocab = [];
  let notionConfig = {
    token: "",
    targetUrl: "",
    databaseId: "",
    dbTitle: "",
    autoSync: true
  };
  let vocabDrawerFilter = "all";
  let episodeProgressMap = {};
  let geminiApiKey = "";
  let aiCache = new Map();
  const inFlightAiMap = new Map();
  let lastKnownTimeMs = 0;
  let currentPathKey = location.pathname;
  let resumeTargetIndex = -1;
  let resumeSeekGuardUntil = 0;
  let panelMinimized = false;
  let lastShortcutExecMs = 0;

  function sendPlayerCmd(type, payload) {
    window.postMessage(Object.assign({ source: "NJD_UI", type }, payload || {}), "*");
  }

  function getWatchEpisodeId() {
    if (window.__NJD_MOCK_MODE__) return "mock-jp-drama-s01e01";
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
    return (document.title || "Netflix 日本語 エピソード").replace(/\s*-\s*Netflix.*$/i, "").trim();
  }

  function findMatchingKorean(startMs, endMs) {
    if (!koCues.length) return "";
    const mid = (startMs + endMs) / 2;
    let best = "";
    let bestDist = Infinity;
    for (const kc of koCues) {
      const overlap = Math.min(endMs, kc.endMs) - Math.max(startMs, kc.startMs);
      if (overlap > 150) return kc.text;
      const dist = Math.abs(mid - (kc.startMs + kc.endMs) / 2);
      if (dist < bestDist && dist <= 2200) {
        bestDist = dist;
        best = kc.text;
      }
    }
    return best;
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

  // ==================== Shadow DOM UI ====================
  const hostEl = document.createElement("div");
  hostEl.id = "njd-studio-host";
  hostEl.tabIndex = -1;
  (document.body || document.documentElement).appendChild(hostEl);
  const shadow = hostEl.attachShadow({ mode: "open" });

  ["mousedown", "mouseup", "pointerdown", "pointerup", "click", "focusin", "focusout"].forEach((evt) => {
    hostEl.addEventListener(evt, (e) => e.stopPropagation());
  });

  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        font-family: 'Pretendard', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', 'Meiryo', 'Malgun Gothic', sans-serif;
        color: #f1f5f9;
      }
      * { box-sizing: border-box; }
      .njd-shell {
        position: fixed;
        z-index: 2147483640;
        background: #0f1629;
        border-left: 1px solid #263354;
        box-shadow: -8px 0 28px rgba(0,0,0,0.55);
        display: none;
        flex-direction: column;
        color: #f1f5f9;
      }
      .njd-shell.visible { display: flex; }
      .njd-shell.dock-right {
        top: 0; right: 0; bottom: 0;
        width: min(430px, 46vw);
      }
      .njd-shell.dock-bottom {
        left: 50%; bottom: 20px;
        transform: translateX(-50%);
        width: min(780px, 95vw);
        max-height: 62vh;
        border: 1px solid #334675;
        border-radius: 16px;
        background: rgba(13, 19, 36, 0.95);
        backdrop-filter: blur(12px);
      }
      .njd-mini-pill {
        position: fixed;
        top: 18px; right: 22px;
        z-index: 2147483641;
        background: linear-gradient(135deg, #db2777, #9d174d);
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
      .njd-mini-pill.visible { display: inline-flex; align-items: center; gap: 6px; }

      .njd-header {
        padding: 11px 13px;
        background: #151e36;
        border-bottom: 1px solid #263354;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 6px;
      }
      .njd-title {
        font-size: 13.5px;
        font-weight: 800;
        display: flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
      }
      .jp-badge {
        background: linear-gradient(135deg, #ec4899, #e11d48);
        color: #fff;
        font-weight: 900;
        font-size: 11px;
        padding: 2px 6px;
        border-radius: 4px;
      }
      .njd-body {
        padding: 13px 14px;
        overflow-y: auto;
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 11px;
      }
      .njd-row {
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
      .btn:hover { background: #26365c; border-color: #6366f1; }
      .njd-header .btn { white-space: nowrap; padding: 4px 7px; font-size: 11px; }
      .btn-pink { background: #e11d48; border-color: #f43f5e; color: #fff; font-weight: 700; }
      .btn-pink:hover { background: #f43f5e; }
      .btn-green { background: #10b981; border-color: #10b981; color: #052e16; font-weight: 800; }
      .btn-gold { background: rgba(245,158,11,0.2); border-color: #f59e0b; color: #fde68a; font-weight: 700; }
      .btn-active { background: rgba(236,72,153,0.24); border-color: #ec4899; color: #fbcfe8; }

      .status-strip {
        font-size: 11.5px;
        color: #94a3b8;
        background: #0a0f1e;
        border: 1px solid #1e2946;
        border-radius: 8px;
        padding: 7px 10px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 6px;
      }
      .drawer {
        display: none;
        background: #0b1020;
        border: 1px solid #334675;
        border-radius: 10px;
        padding: 11px;
        gap: 8px;
        flex-direction: column;
      }
      .drawer.open { display: flex; }
      .drawer.gold-border { border-color: #f59e0b; }
      .drawer-list { max-height: 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 7px; }
      .resume-bar {
        display: none;
        background: linear-gradient(135deg, rgba(14,165,233,0.2), rgba(37,99,235,0.18));
        border: 1px solid #38bdf8;
        border-radius: 9px;
        padding: 9px 11px;
        gap: 7px;
        flex-direction: column;
      }
      .resume-bar.open { display: flex; }

      /* Answer Tray (Selected Word Blocks) */
      .answer-tray {
        min-height: 68px;
        padding: 11px;
        background: #080d1a;
        border: 2px solid #2b3a63;
        border-radius: 11px;
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
        align-items: center;
        transition: border-color 0.16s ease;
      }
      .answer-tray.passed {
        border-color: #10b981;
        background: rgba(16, 185, 129, 0.08);
      }
      .tray-placeholder {
        font-size: 12.5px;
        color: #64748b;
      }

      /* Scrambled Word Pool */
      .pool-tray {
        min-height: 64px;
        padding: 11px;
        background: #121a30;
        border: 1px dashed #334675;
        border-radius: 11px;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }

      .word-block {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 7px 12px;
        border-radius: 8px;
        background: #1e2b4d;
        border: 1px solid #3b4f82;
        color: #f8fafc;
        font-size: 15.5px;
        font-weight: 700;
        cursor: pointer;
        user-select: none;
        transition: transform 0.1s ease, background 0.12s ease, border-color 0.12s ease;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      }
      .word-block:hover {
        background: #293b69;
        border-color: #ec4899;
        transform: translateY(-1px);
      }
      .word-block.placed {
        background: #25355e;
        border-color: #6366f1;
      }
      .word-block.ok {
        background: rgba(16, 185, 129, 0.22);
        border-color: #10b981;
        color: #a7f3d0;
      }
      .word-block.err {
        background: rgba(239, 68, 68, 0.22);
        border-color: #ef4444;
        color: #fecaca;
      }
      @keyframes njdShake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-5px); }
        50% { transform: translateX(5px); }
        75% { transform: translateX(-4px); }
      }
      .word-block.wrong-shake {
        background: rgba(239, 68, 68, 0.28) !important;
        border-color: #ef4444 !important;
        color: #fecaca !important;
        animation: njdShake 0.32s ease;
      }
      .structure-desc {
        font-size: 12.5px;
        color: #e0f2fe;
        line-height: 1.65;
        background: #0b1326;
        border: 1px solid #263c66;
        border-left: 3px solid #38bdf8;
        border-radius: 7px;
        padding: 10px 11px;
      }
      .key-num {
        font-size: 10.5px;
        font-family: Consolas, monospace;
        color: #94a3b8;
        background: rgba(9, 13, 26, 0.65);
        padding: 1px 5px;
        border-radius: 4px;
      }

      .seg-switch {
        display: inline-flex;
        background: #0a0f1e;
        border: 1px solid #283861;
        border-radius: 7px;
        overflow: hidden;
      }
      .seg-opt {
        border: none;
        background: transparent;
        color: #94a3b8;
        padding: 4px 9px;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
        font-family: inherit;
      }
      .seg-opt.active {
        background: #e11d48;
        color: #fff;
      }

      .banner {
        padding: 9px 12px;
        border-radius: 9px;
        font-size: 12.5px;
        font-weight: 600;
        display: none;
      }
      .banner.show { display: block; }
      .banner.ok { background: rgba(16,185,129,0.16); border: 1px solid #10b981; color: #a7f3d0; }
      .banner.retry { background: rgba(245,158,11,0.16); border: 1px solid #f59e0b; color: #fde68a; }

      .study-area { display: none; flex-direction: column; gap: 10px; }
      .study-area.open { display: flex; }
      .card {
        background: #151f38;
        border: 1px solid #283861;
        border-radius: 10px;
        padding: 12px 13px;
      }
      .jp-line { font-size: 17px; font-weight: 800; color: #fff; margin-bottom: 3px; }
      .reading-line { font-size: 12.5px; color: #fbcfe8; margin-bottom: 5px; font-weight: 600; }
      .ko-line { font-size: 13.5px; color: #93c5fd; font-weight: 600; }
      .pron-box {
        margin-top: 8px;
        padding: 8px 10px;
        background: rgba(236,72,153,0.12);
        border-left: 3px solid #ec4899;
        border-radius: 5px;
        font-size: 12px;
        color: #fbcfe8;
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

    <button id="njdMiniPill" class="njd-mini-pill">
      <span class="jp-badge">JP</span> 일본어 받아쓰기 열기
    </button>

    <aside id="njdShell" class="njd-shell dock-right" tabindex="-1">
      <div class="njd-header">
        <div class="njd-title">
          <span class="jp-badge">JP</span>
          <span>일본어 어순</span>
        </div>
        <div style="display:flex; gap:4px; align-items:center;">
          <button id="btnVocabOpen" class="btn btn-gold">★ 학습장(0)</button>
          <button id="btnDockToggle" class="btn" title="우측 사이드바 / 하단 플로팅 전환">◨ 위치</button>
          <button id="btnApiSetup" class="btn" title="AI 심층 해설용 API 키 설정">✨ AI키</button>
          <button id="btnPauseMode" class="btn btn-active">자동멈춤</button>
          <button id="btnMinimize" class="btn">—</button>
        </div>
      </div>

      <div class="njd-body">
        <!-- Study Notebook Drawer -->
        <div id="vocabDrawer" class="drawer gold-border">
          <div class="njd-row">
            <span style="font-size:13px; font-weight:800; color:#fde68a;">★ 일본어 학습장 (<span id="vocabDrawerCount">0</span>개)</span>
            <div style="display:flex; gap:4px; align-items:center;">
              <button id="btnNotionToggleSetup" class="btn" style="padding:3px 8px; font-size:11px; border-color:#818cf8; color:#c7d2fe;">📓 노션 연동 설정</button>
              <button id="btnNotionBulkSync" class="btn" style="padding:3px 8px; font-size:11px; display:none; border-color:#34d399; color:#6ee7b7;">🔄 일괄 동기화</button>
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
              2) 노션 페이지 우측 상단 <strong>[•••] → [연결]</strong>에서 만든 통합 추가 후 <strong>[공유 → 링크 복사]</strong>
            </div>
            <div style="display:flex; gap:5px;">
              <input id="notionTokenInput" class="api-input" type="password" placeholder="1. 노션 API 토큰 (ntn_... 또는 secret_...)" style="flex:1;" />
              <button id="btnPasteNotionToken" class="btn" type="button" style="padding:4px 8px; font-size:11px; white-space:nowrap;">붙여넣기</button>
            </div>
            <div style="display:flex; gap:5px;">
              <input id="notionUrlInput" class="api-input" type="text" placeholder="2. 노션 페이지 또는 데이터베이스 링크(URL) 붙여넣기" style="flex:1;" />
              <button id="btnPasteNotionUrl" class="btn" type="button" style="padding:4px 8px; font-size:11px; white-space:nowrap;">붙여넣기</button>
            </div>
            <div class="njd-row" style="justify-content:space-between;">
              <label style="font-size:11px; color:#cbd5e1; display:flex; align-items:center; gap:5px; cursor:pointer;">
                <input id="notionAutoCheck" type="checkbox" checked /> 저장 버튼 클릭 시 실시간 자동 전송
              </label>
              <div style="display:flex; gap:5px;">
                <button id="btnNotionDisconnect" class="btn" style="padding:4px 8px; font-size:11px;">해제</button>
                <button id="btnNotionConnect" class="btn" style="padding:4px 10px; font-size:11px; background:#4f46e5; border-color:#6366f1; color:#fff; font-weight:700;">🔌 연결 &amp; 표 자동생성</button>
              </div>
            </div>
            <div id="notionStatusMsg" style="font-size:11px; color:#a7f3d0; line-height:1.4;"></div>
          </div>
          <div class="njd-row">
            <div style="display:flex; gap:4px;">
              <button class="btn vocab-filter-btn btn-active" data-vfilter="all" style="padding:4px 8px; font-size:11px;">전체</button>
              <button class="btn vocab-filter-btn" data-vfilter="vocab" style="padding:4px 8px; font-size:11px;">📚 단어·표현</button>
              <button class="btn vocab-filter-btn" data-vfilter="grammar" style="padding:4px 8px; font-size:11px;">🧩 문법</button>
            </div>
            <div style="display:flex; gap:4px;">
              <button id="btnExportCsv" class="btn btn-green" style="padding:4px 8px; font-size:11px;">📊 엑셀(.csv)</button>
              <button id="btnExportTxt" class="btn" style="padding:4px 8px; font-size:11px; border-color:#38bdf8; color:#bae6fd;">📝 메모장(.txt)</button>
            </div>
          </div>
          <div id="vocabDrawerList" class="drawer-list"></div>
        </div>

        <!-- API Key Drawer -->
        <div id="apiDrawer" class="drawer">
          <div style="font-size:11.5px; color:#cbd5e1;">
            <strong>선택 설정:</strong> Gemini API 키(또는 OpenAI 키)를 입력하면 대사별 <strong>전체 히라가나 독음(후리가나) · 단어별 요미가나 · 맞춤 문법 해설</strong>이 선행 로딩(0.0초 체감)으로 자동 표시됩니다!
          </div>
          <div style="display:flex; gap:6px;">
            <input id="apiKeyInput" class="api-input" type="password" placeholder="AIzaSy... 또는 sk-... (미입력 시 내장 사전 작동)" />
            <button id="btnSaveApiKey" class="btn btn-pink">저장</button>
          </div>
        </div>

        <div class="status-strip">
          <span id="subStatusText">일본어 자막 대기 중... ([일본어(CC)]를 켜주세요)</span>
          <button id="btnSyncDual" class="btn" style="padding:3px 8px; font-size:11px;">한·일 자막 동기화</button>
        </div>

        <!-- Precision Resume Bar -->
        <div id="resumeBar" class="resume-bar">
          <div id="resumeInfoText" style="font-size:12px; color:#e0f2fe; font-weight:700; line-height:1.45;"></div>
          <div class="njd-row" style="justify-content:flex-end; gap:6px;">
            <button id="btnJumpResume" class="btn" style="background:#0284c7; border-color:#38bdf8; color:#fff; font-weight:700;">▶ 이어서 시작</button>
            <button id="btnResetEpProgress" class="btn" style="font-size:11px;">기록 초기화</button>
            <button id="btnDismissResume" class="btn" style="font-size:11px;">✕</button>
          </div>
        </div>

        <!-- Playback & Cue Stepper -->
        <div class="njd-row">
          <div style="display:flex; gap:5px; align-items:center;">
            <button id="btnPrevCue" class="btn">◀ 이전</button>
            <span id="cueCounter" style="font-size:12px; font-weight:700; padding:0 4px;">대사 0 / 0</span>
            <button id="btnNextCueManual" class="btn">다음 ▶</button>
          </div>
          <span id="cueTimeRange" style="font-family:Consolas,monospace; font-size:12px; color:#94a3b8;">00:00 ~ 00:00</span>
        </div>

        <div class="njd-row">
          <button id="btnReplaySeg" class="btn btn-pink">▶ 구간 다시 듣기 (Ctrl+Space)</button>
          <div style="display:flex; gap:4px;">
            <button class="btn rate-btn" data-rate="0.75">0.75x</button>
            <button class="btn rate-btn" data-rate="0.85">0.85x</button>
            <button class="btn rate-btn btn-active" data-rate="1">1.0x</button>
          </div>
        </div>

        <div class="njd-row" style="background:#0a0f1e; border:1px solid #1e2946; border-radius:8px; padding:6px 9px; font-size:11px; color:#94a3b8;">
          <div style="display:flex; align-items:center; gap:4px;">
            <span>🎯 시작점:</span>
            <button id="btnStartTrimMinus" class="btn" style="padding:2px 6px; font-size:10.5px;">-0.2s</button>
            <span id="startTrimLabel" style="font-family:Consolas,monospace; color:#cbd5e1; min-width:34px; text-align:center;">0.0s</span>
            <button id="btnStartTrimPlus" class="btn" style="padding:2px 6px; font-size:10.5px;">+0.2s</button>
          </div>
          <div style="display:flex; align-items:center; gap:4px;">
            <span>끝점:</span>
            <button id="btnEndPadMinus" class="btn" style="padding:2px 6px; font-size:10.5px;">-0.2s</button>
            <span id="endPadLabel" style="font-family:Consolas,monospace; color:#cbd5e1; min-width:34px; text-align:center;">+0.0s</span>
            <button id="btnEndPadPlus" class="btn" style="padding:2px 6px; font-size:10.5px;">+0.2s</button>
          </div>
          <span id="preRollBadge" style="display:none; color:#f472b6; font-weight:700;">🔇 앞 대사 무음 통과 중...</span>
        </div>

        <!-- Granularity Switcher & Answer Tray -->
        <div>
          <div class="njd-row" style="margin-bottom:6px;">
            <span style="font-size:12px; font-weight:700; color:#cbd5e1;">
              내가 조립한 문장 <span id="slotProgressSpan" style="color:#94a3b8; font-weight:600;"></span>
            </span>
            <div class="seg-switch" title="단어 카드 쪼개기 단위를 실시간으로 전환합니다">
              <button class="seg-opt active" data-seg="bunsetsu">① 어절 묶음</button>
              <button class="seg-opt" data-seg="split">② 조사 분리</button>
            </div>
          </div>
          <div id="answerTray" class="answer-tray"></div>
        </div>

        <!-- Scrambled Word Pool -->
        <div>
          <div class="njd-row" style="margin-bottom:5px;">
            <span style="font-size:11.5px; color:#94a3b8; font-weight:700;">섞인 단어 블록 (순서대로 클릭 또는 숫자키 1~9)</span>
          </div>
          <div id="poolTray" class="pool-tray"></div>
        </div>

        <!-- Action Buttons -->
        <div class="njd-row">
          <div style="display:flex; gap:5px; flex-wrap:wrap;">
            <button id="btnUndoBlock" class="btn">↩ 취소 (Backspace)</button>
            <button id="btnHintNextBlock" class="btn">💡 다음 1블록 힌트</button>
            <button id="btnResetBlocks" class="btn">🔄 다시 섞기</button>
            <button id="btnReveal" class="btn">🏳️ 정답 보기</button>
          </div>
          <div>
            <button id="btnAdvanceNext" class="btn btn-green" style="display:none;">다음 대사 재생 (Enter) →</button>
          </div>
        </div>

        <div class="shortcut-bar">
          <span>숫자 1~9: 블록 선택</span>
          <span>Backspace: 취소</span>
          <span>Ctrl+Space: 다시 듣기</span>
          <span>Enter: 다음 대사</span>
        </div>

        <div id="feedbackBanner" class="banner"></div>

        <!-- Unlocked Study Commentary -->
        <div id="studyArea" class="study-area">
          <div class="card">
            <div class="jp-line" id="ansJp"></div>
            <div class="reading-line" id="ansReading" style="display:none;"></div>
            <div class="ko-line" id="ansKo"></div>
            <div class="pron-box" id="ansPron"></div>
          </div>

          <div class="card">
            <div class="sec-label">📐 문장 구조 &amp; 어순 끊어읽기 해설</div>
            <div id="structureDesc" class="structure-desc"></div>
          </div>

          <div class="card">
            <div class="njd-row" style="margin-bottom:6px;">
              <div class="sec-label" style="margin:0;">📚 문장 속 모든 단어 · 조사 · 표현 풀이</div>
              <button id="btnAskAi" class="btn" style="padding:3px 8px; font-size:11px;">✨ AI 심층 해설</button>
            </div>
            <div id="vocabContainer"></div>
          </div>

          <div class="card">
            <div class="njd-row" style="margin-bottom:6px;">
              <div class="sec-label" style="margin:0;">🧩 초보자 맞춤 문법 · 동사 활용 상세 해설</div>
              <button id="btnSaveGrammar" class="btn" style="padding:2px 8px; font-size:11px;">☆ 문법 저장</button>
            </div>
            <div id="grammarTitle" class="grammar-title"></div>
            <div id="grammarDesc" class="grammar-desc"></div>
          </div>
        </div>
      </div>
    </aside>
  `;

  // ==================== References ====================
  const elShell = shadow.getElementById("njdShell");
  const elMiniPill = shadow.getElementById("njdMiniPill");
  const elSubStatus = shadow.getElementById("subStatusText");
  const elCueCounter = shadow.getElementById("cueCounter");
  const elCueTimeRange = shadow.getElementById("cueTimeRange");
  const elSlotProgress = shadow.getElementById("slotProgressSpan");
  const elAnswerTray = shadow.getElementById("answerTray");
  const elPoolTray = shadow.getElementById("poolTray");
  const elBanner = shadow.getElementById("feedbackBanner");
  const elStudyArea = shadow.getElementById("studyArea");
  const elAnsJp = shadow.getElementById("ansJp");
  const elAnsReading = shadow.getElementById("ansReading");
  const elAnsKo = shadow.getElementById("ansKo");
  const elAnsPron = shadow.getElementById("ansPron");
  const elVocabContainer = shadow.getElementById("vocabContainer");
  const elGrammarTitle = shadow.getElementById("grammarTitle");
  const elGrammarDesc = shadow.getElementById("grammarDesc");
  const elBtnAdvanceNext = shadow.getElementById("btnAdvanceNext");
  const elApiDrawer = shadow.getElementById("apiDrawer");
  const elApiKeyInput = shadow.getElementById("apiKeyInput");
  const elVocabDrawer = shadow.getElementById("vocabDrawer");

  function focusStudioSafely() {
    sendPlayerCmd("SET_FOCUS_LOCK", { locked: true });
    const act = shadow.activeElement;
    if (act && (act.tagName === "INPUT" || act.tagName === "TEXTAREA")) {
      return;
    }
    elShell.focus({ preventScroll: true });
  }

  function syncBodyClasses() {
    const onWatch = location.pathname.startsWith("/watch") || Boolean(window.__NJD_MOCK_MODE__);
    if (!onWatch) {
      elShell.classList.remove("visible");
      elMiniPill.classList.remove("visible");
      document.body.classList.remove("njd-active", "njd-hide-subs", "njd-dock-right");
      return;
    }
    if (panelMinimized) {
      elShell.classList.remove("visible");
      elMiniPill.classList.add("visible");
      document.body.classList.remove("njd-active", "njd-dock-right");
    } else {
      elMiniPill.classList.remove("visible");
      elShell.classList.add("visible");
      document.body.classList.add("njd-active");
      document.body.classList.toggle("njd-dock-right", dockMode === "right");
    }
    document.body.classList.toggle("njd-hide-subs", dictationEnabled && !panelMinimized);
  }

  function getActiveCue() {
    return jaCues[activeCueIndex] || null;
  }

  // ==================== Puzzle Generation & Block Interaction ====================
  function prepareCuePuzzle(forceReshuffle) {
    const cue = getActiveCue();
    if (!cue || !window.NJD_ANALYZER) {
      targetTokens = [];
      poolCards = [];
      placedIds = [];
      checkedAttempt = false;
      return;
    }

    const key = `${activeCueIndex}:${segMode}:${cue.text}`;
    if (!forceReshuffle && puzzleCueKey === key) {
      return;
    }
    puzzleCueKey = key;
    targetTokens = window.NJD_ANALYZER.segmentJapanese(cue.text, segMode);
    poolCards = window.NJD_ANALYZER.shuffleTokensWithIds(targetTokens);
    placedIds = passedCueIndices.has(activeCueIndex)
      ? targetTokens.map((_, idx) => {
          // Match cards in exact target order
          return idx;
        })
      : [];

    if (passedCueIndices.has(activeCueIndex)) {
      // Rebuild poolCards in target order if already passed so display matches 100%
      poolCards = targetTokens.map((w, idx) => ({ id: idx, word: w }));
      placedIds = poolCards.map((c) => c.id);
    }
    checkedAttempt = false;
  }

  function getCardById(id) {
    return poolCards.find((c) => c.id === id);
  }

  function getRemainingPoolCards() {
    const placedSet = new Set(placedIds);
    return poolCards.filter((c) => !placedSet.has(c.id));
  }

  function checkAndCompleteIfFull() {
    const cue = getActiveCue();
    if (!cue || !targetTokens.length) return;
    if (placedIds.length < targetTokens.length) return;

    const placedWords = placedIds.map((id) => {
      const c = getCardById(id);
      return c ? c.word : "";
    });

    const allCorrect = placedWords.every((w, i) => w === targetTokens[i]);
    if (allCorrect) {
      checkedAttempt = false;
      passedCueIndices.add(activeCueIndex);
      saveEpisodeProgress();
      sendPlayerCmd("PAUSE");
      showBanner("ok", "🎉 正解(정답)! 완벽하게 문장 어순을 맞혔습니다! 해설 확인 후 Enter를 누르면 다음 대사가 재생됩니다.");
      renderCueUI();
    } else {
      checkedAttempt = true;
      const rightCount = placedWords.filter((w, i) => w === targetTokens[i]).length;
      showBanner(
        "retry",
        `순서가 다른 블록(빨간색)이 있어요! (${rightCount}/${targetTokens.length} 위치 일치) — 빨간 블록을 클릭하거나 Backspace로 수정해 보세요.`
      );
      renderCueUI();
      replayCurrentCue();
    }
  }

  let wrongFlashCardId = -1;
  let wrongFlashTimer = null;

  function pickPoolCard(cardId) {
    if (passedCueIndices.has(activeCueIndex)) return;
    if (placedIds.includes(cardId)) return;

    const card = getCardById(cardId);
    if (!card) return;

    const expectedWord = targetTokens[placedIds.length];
    // Immediate order validation: reject out-of-order block so it does NOT assemble into #answerTray!
    if (card.word !== expectedWord) {
      wrongFlashCardId = cardId;
      if (wrongFlashTimer) clearTimeout(wrongFlashTimer);
      wrongFlashTimer = setTimeout(() => {
        wrongFlashCardId = -1;
        renderCueUI();
      }, 450);
      showBanner(
        "retry",
        `❌ 「${card.word}」은(는) 지금 순서가 아니에요! 대사를 다시 듣고 ${placedIds.length + 1}번째에 올 단어를 골라보세요.`
      );
      renderCueUI();
      return;
    }

    wrongFlashCardId = -1;
    checkedAttempt = false;
    elBanner.className = "banner";
    placedIds.push(cardId);
    renderCueUI();
    checkAndCompleteIfFull();
  }

  function removePlacedAt(posIndex) {
    if (passedCueIndices.has(activeCueIndex)) return;
    if (posIndex < 0 || posIndex >= placedIds.length) return;
    placedIds.splice(posIndex, 1);
    checkedAttempt = false;
    elBanner.className = "banner";
    renderCueUI();
  }

  function undoLastBlock() {
    if (passedCueIndices.has(activeCueIndex) || placedIds.length === 0) return;
    // If last attempt was wrong, smart-trim from the first wrong position onward!
    if (checkedAttempt) {
      let firstWrong = -1;
      for (let i = 0; i < placedIds.length; i++) {
        const c = getCardById(placedIds[i]);
        if (!c || c.word !== targetTokens[i]) {
          firstWrong = i;
          break;
        }
      }
      if (firstWrong >= 0) {
        placedIds.splice(firstWrong);
        checkedAttempt = false;
        elBanner.className = "banner";
        renderCueUI();
        return;
      }
    }
    placedIds.pop();
    checkedAttempt = false;
    elBanner.className = "banner";
    renderCueUI();
  }

  function giveNextBlockHint() {
    if (passedCueIndices.has(activeCueIndex) || !targetTokens.length) return;

    // First remove any misplaced trailing blocks so the hint attaches at the right position
    for (let i = 0; i < placedIds.length; i++) {
      const c = getCardById(placedIds[i]);
      if (!c || c.word !== targetTokens[i]) {
        placedIds.splice(i);
        break;
      }
    }
    checkedAttempt = false;

    const nextPos = placedIds.length;
    if (nextPos >= targetTokens.length) return;
    const neededWord = targetTokens[nextPos];
    const remaining = getRemainingPoolCards();
    const matchCard = remaining.find((c) => c.word === neededWord);
    if (matchCard) {
      placedIds.push(matchCard.id);
      renderCueUI();
      checkAndCompleteIfFull();
    }
  }

  // ==================== Rendering UI ====================
  function renderSubtitleStatus() {
    if (jaCues.length > 0 && koCues.length > 0) {
      elSubStatus.textContent = `✓ 일본어(${jaCues.length}) · 한국어(${koCues.length}) 자막 연동 완료`;
    } else if (jaCues.length > 0) {
      elSubStatus.textContent = `✓ 일본어 대사 ${jaCues.length}문장 준비됨 (한국어 번역은 우측 동기화 클릭)`;
    } else {
      elSubStatus.textContent = "넷플릭스 자막 메뉴에서 [일본어(CC)]를 선택해 주세요";
    }
  }

  function renderCueUI() {
    renderSubtitleStatus();
    const cue = getActiveCue();
    if (!cue) {
      elCueCounter.textContent = "대사 대기 중";
      elAnswerTray.innerHTML = `<span class="tray-placeholder">영상이 재생되고 일본어 자막이 로드되면 단어 블록 퍼즐이 표시됩니다.</span>`;
      elPoolTray.innerHTML = "";
      elStudyArea.classList.remove("open");
      return;
    }

    prepareCuePuzzle(false);
    const isPassed = passedCueIndices.has(activeCueIndex);

    elCueCounter.textContent = `대사 ${activeCueIndex + 1} / ${jaCues.length}`;
    elCueTimeRange.textContent = `${formatMs(cue.startMs)} ~ ${formatMs(cue.endMs)}`;
    elSlotProgress.textContent = `(${placedIds.length} / ${targetTokens.length} 블록)`;

    // Render Answer Tray
    elAnswerTray.classList.toggle("passed", isPassed);
    elAnswerTray.innerHTML = "";
    if (placedIds.length === 0) {
      elAnswerTray.innerHTML = `<span class="tray-placeholder">🎧 대사를 듣고 아래 섞인 일본어 블록을 순서대로 선택하세요!</span>`;
    } else {
      placedIds.forEach((cardId, posIdx) => {
        const card = getCardById(cardId);
        if (!card) return;
        const btn = document.createElement("button");
        btn.className = "word-block placed ok";
        btn.textContent = card.word;
        if (!isPassed) {
          btn.title = "클릭하면 이 블록 이후를 취소합니다";
          btn.addEventListener("click", () => {
            // Since blocks are assembled strictly in order, removing at posIdx trims from posIdx onward!
            placedIds.splice(posIdx);
            elBanner.className = "banner";
            renderCueUI();
          });
        }
        elAnswerTray.appendChild(btn);
      });
    }

    // Render Remaining Scrambled Pool
    elPoolTray.innerHTML = "";
    const remaining = getRemainingPoolCards();
    if (remaining.length === 0) {
      elPoolTray.innerHTML = `<span class="tray-placeholder">${isPassed ? "✓ 모든 단어 블록 조립 완료!" : "모든 블록을 배치했습니다."}</span>`;
    } else {
      remaining.forEach((card, remIdx) => {
        const btn = document.createElement("button");
        btn.className = "word-block" + (card.id === wrongFlashCardId ? " wrong-shake" : "");
        const keyBadge = remIdx < 9 ? `<span class="key-num">${remIdx + 1}</span>` : "";
        btn.innerHTML = `${keyBadge}<span>${escapeHtml(card.word)}</span>`;
        btn.addEventListener("click", () => pickPoolCard(card.id));
        elPoolTray.appendChild(btn);
      });
    }

    if (isPassed) {
      elBtnAdvanceNext.style.display = activeCueIndex < jaCues.length - 1 ? "inline-block" : "none";
      renderUnlockedStudy(cue);
    } else {
      elBtnAdvanceNext.style.display = "none";
      elStudyArea.classList.remove("open");
    }

    triggerBackgroundPrefetch(activeCueIndex);
  }

  function renderUnlockedStudy(cue) {
    elStudyArea.classList.add("open");
    elAnsJp.textContent = cue.text;
    const koMatched = findMatchingKorean(cue.startMs, cue.endMs);

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

    const fallbackAnalysis = window.NJD_ANALYZER
      ? window.NJD_ANALYZER.analyzeSentence(cue.text)
      : { reading: "", structure: "", pronunciation: "", vocab: [], grammar: { title: "", desc: "" } };
    const analysis = cachedAi || fallbackAnalysis;

    if (analysis.reading) {
      elAnsReading.style.display = "block";
      elAnsReading.textContent = `히라가나 독음: ${analysis.reading}`;
    } else {
      elAnsReading.style.display = "none";
    }

    const elStructure = shadow.getElementById("structureDesc");
    if (elStructure) {
      elStructure.textContent =
        analysis.structure || fallbackAnalysis.structure || "주어(주제) + 목적어/부사어 + 서술어(동사/형용사) 구조입니다.";
    }

    elAnsKo.textContent =
      koMatched ||
      (cachedAi && cachedAi.ko) ||
      "(한국어 자막 미연동 — 상단 [한·일 자막 동기화] 또는 [✨ AI 심층 해설]을 눌러보세요)";

    elAnsPron.innerHTML = `<strong>🗣️ 발음·회화 포인트:</strong> ${escapeHtml(analysis.pronunciation || "")}`;

    elVocabContainer.innerHTML = "";
    if (!analysis.vocab || analysis.vocab.length === 0) {
      elVocabContainer.innerHTML = `<div style="font-size:12px; color:#94a3b8;">기본 어휘 문장입니다. 한자 요미가나(읽는 법)와 세부 단어 뜻은 우측 <strong>[✨ AI 심층 해설]</strong>(API키 등록 시 자동 표시)로 확인하실 수 있습니다!</div>`;
    } else {
      analysis.vocab.forEach((v) => {
        const alreadySaved = savedVocab.some((s) => s.kind !== "grammar" && s.term === v.term);
        const box = document.createElement("div");
        box.className = "vocab-entry";
        box.innerHTML = `
          <div class="njd-row">
            <span class="vocab-term">${escapeHtml(v.term)} <span style="font-size:11px; color:#38bdf8;">[${escapeHtml(v.typeLabel || "표현")}]</span></span>
            <button class="btn btn-save-v" style="padding:2px 7px; font-size:11px;">${alreadySaved ? "★ 저장됨" : "☆ 단어 저장"}</button>
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

  // ==================== Episode Progress & Precision Resume ====================
  function saveEpisodeProgress() {
    if (!jaCues.length) return;
    const epId = getWatchEpisodeId();
    if (!epId) return;

    let nextTargetIdx = activeCueIndex;
    if (passedCueIndices.has(activeCueIndex) && activeCueIndex < jaCues.length - 1) {
      nextTargetIdx = activeCueIndex + 1;
    }

    const passedStartMsList = Array.from(passedCueIndices)
      .map((i) => jaCues[i] && jaCues[i].startMs)
      .filter((v) => typeof v === "number");

    const targetCue = jaCues[nextTargetIdx] || jaCues[activeCueIndex];
    const record = {
      episodeId: epId,
      watchUrl: location.origin + location.pathname,
      title: detectEpisodeTitle(),
      passedStartMsList,
      passedCount: passedCueIndices.size,
      totalCues: jaCues.length,
      resumeCueIndex: nextTargetIdx,
      resumeStartMs: targetCue ? targetCue.startMs : 0,
      updatedAt: new Date().toISOString()
    };

    episodeProgressMap[epId] = record;
    const keys = Object.keys(episodeProgressMap);
    if (keys.length > 40) delete episodeProgressMap[keys[0]];

    storageSet("njd_episode_progress_v1", episodeProgressMap);
    storageSet("njd_last_session_v1", record);
  }

  async function restoreEpisodeProgressAndOfferResume() {
    const elResumeBar = shadow.getElementById("resumeBar");
    const elResumeInfo = shadow.getElementById("resumeInfoText");
    if (elResumeBar) elResumeBar.classList.remove("open");

    if (!jaCues.length) return;
    const epId = getWatchEpisodeId();
    episodeProgressMap = await storageGet("njd_episode_progress_v1", episodeProgressMap || {});
    const saved = episodeProgressMap[epId];
    if (!saved) return;

    passedCueIndices.clear();
    const savedMsArr = saved.passedStartMsList || [];
    if (savedMsArr.length > 0) {
      jaCues.forEach((c, idx) => {
        if (savedMsArr.some((ms) => Math.abs(c.startMs - ms) <= 600)) {
          passedCueIndices.add(idx);
        }
      });
    }

    let targetIdx = -1;
    if (typeof saved.resumeStartMs === "number") {
      targetIdx = jaCues.findIndex((c) => Math.abs(c.startMs - saved.resumeStartMs) <= 600);
    }
    if (targetIdx < 0 && typeof saved.resumeCueIndex === "number") {
      targetIdx = Math.min(jaCues.length - 1, Math.max(0, saved.resumeCueIndex));
    }
    if (targetIdx < 0 || (passedCueIndices.size === 0 && targetIdx === 0)) return;

    resumeTargetIndex = targetIdx;
    const autoJumpEpId = await storageGet("njd_auto_jump_episode_v1", "");
    if (autoJumpEpId && autoJumpEpId === epId) {
      storageSet("njd_auto_jump_episode_v1", "");
      jumpToSavedResumePoint();
      return;
    }

    const targetCue = jaCues[targetIdx];
    if (elResumeBar && elResumeInfo && targetCue) {
      elResumeInfo.textContent = `📌 이전 학습 기록 (${passedCueIndices.size}/${jaCues.length} 통과) — ${targetIdx + 1}번 대사(${formatMs(targetCue.startMs)})부터 이어할까요?`;
      elResumeBar.classList.add("open");
    }
    puzzleCueKey = "";
    renderCueUI();
  }

  function jumpToSavedResumePoint() {
    if (resumeTargetIndex < 0 || resumeTargetIndex >= jaCues.length) return;
    const elResumeBar = shadow.getElementById("resumeBar");
    if (elResumeBar) elResumeBar.classList.remove("open");

    activeCueIndex = resumeTargetIndex;
    resumeSeekGuardUntil = Date.now() + 2800;
    puzzleCueKey = "";
    renderCueUI();
    replayCurrentCue();
    showBanner("ok", `▶ 이전 학습 지점인 ${activeCueIndex + 1}번 대사(${formatMs(jaCues[activeCueIndex].startMs)})로 이동했습니다!`);
  }

  // ==================== Playback & Navigation ====================
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
    focusStudioSafely();
  }

  function advanceToNextCue() {
    if (activeCueIndex >= jaCues.length - 1) return;
    activeCueIndex++;
    const nextCue = jaCues[activeCueIndex];

    puzzleCueKey = "";
    elBanner.className = "banner";
    autoPausedForCue.delete(activeCueIndex);
    segmentReplayArmed = true;
    saveEpisodeProgress();
    renderCueUI();

    const bounds = getTargetCueBounds(nextCue);
    resumeSeekGuardUntil = Date.now() + 2600;

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
    focusStudioSafely();
  }

  // ==================== Study Notebook + Notion Real-Time Sync ====================
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
      resolve({ ok: false, error: "크롬/엣지 확장 프로그램 환경에서 작동합니다." });
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
      if (unsyncedCount > 0) btnBulk.textContent = `🔄 노션 일괄전송(${unsyncedCount})`;
    }
    updateVocabCountBadge();
  }

  async function autoPushItemToNotion(itemObj) {
    if (!isNotionConfigured() || notionConfig.autoSync === false) return;
    const res = await callNotionBg("NJD_NOTION_PUSH_ITEM", {
      token: notionConfig.token,
      targetUrl: notionConfig.targetUrl,
      cachedDbId: notionConfig.databaseId || "",
      defaultTitle: "📚 넷플릭스 일본어 단어 · 문법장",
      item: itemObj
    });

    if (res && res.ok) {
      itemObj.notionPageId = res.notionPageId;
      if (res.databaseId && res.databaseId !== notionConfig.databaseId) {
        notionConfig.databaseId = res.databaseId;
        notionConfig.dbTitle = res.dbTitle || notionConfig.dbTitle;
        storageSet("njd_notion_config_v1", notionConfig);
      }
      storageSet("njd_saved_vocab_v1", savedVocab);
      renderVocabDrawer();
      showBanner("ok", `📓 '${itemObj.term}' 항목이 노션 단어장에 실시간 자동 저장되었습니다!`);
    } else if (res && res.error) {
      showBanner("retry", `⚠️ 노션 자동저장 실패: ${res.error}`);
    }
  }

  async function archiveItemFromNotion(notionPageId) {
    if (!notionPageId || !notionConfig.token) return;
    await callNotionBg("NJD_NOTION_ARCHIVE_PAGE", { token: notionConfig.token, notionPageId });
  }

  function isGrammarSaved(grammarTitle, sentenceContext) {
    return savedVocab.some(
      (item) => item.kind === "grammar" && item.term === grammarTitle && item.sentence === sentenceContext
    );
  }

  function toggleSaveGrammar(grammarObj, sentenceContext, koTranslation) {
    const idx = savedVocab.findIndex(
      (item) => item.kind === "grammar" && item.term === grammarObj.title && item.sentence === sentenceContext
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
    storageSet("njd_saved_vocab_v1", savedVocab);
    renderVocabDrawer();
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
    storageSet("njd_saved_vocab_v1", savedVocab);
    renderVocabDrawer();
  }

  function getFilteredSavedItems() {
    if (vocabDrawerFilter === "grammar") return savedVocab.filter((x) => x.kind === "grammar");
    if (vocabDrawerFilter === "vocab") return savedVocab.filter((x) => x.kind !== "grammar");
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
      listEl.innerHTML = `<div style="font-size:12px; color:#94a3b8; padding:8px 2px;">저장된 항목이 없습니다. 대사를 통과한 뒤 <strong>[☆ 단어 저장]</strong> 또는 <strong>[☆ 문법 저장]</strong>을 눌러보세요!</div>`;
      refreshNotionUiBadges();
      return;
    }

    listEl.innerHTML = "";
    filtered.forEach((item) => {
      const isGrammar = item.kind === "grammar";
      const card = document.createElement("div");
      card.className = "vocab-entry";
      card.style.marginBottom = "0";
      if (isGrammar) card.style.borderLeft = "3px solid #f59e0b";
      card.innerHTML = `
        <div class="njd-row">
          <span class="vocab-term" style="color:${isGrammar ? "#fcd34d" : "#f472b6"};">${isGrammar ? "🧩 " : ""}${escapeHtml(item.term)} <span style="font-size:11px; color:${isGrammar ? "#fbbf24" : "#38bdf8"};">[${escapeHtml(item.typeLabel || "표현")}]</span>${item.notionPageId ? ` <span style="font-size:10px; color:#6ee7b7;">📓노션됨</span>` : ""}</span>
          <button class="btn btn-del-saved" style="padding:2px 7px; font-size:11px;">삭제</button>
        </div>
        <div class="vocab-meaning" style="font-weight:${isGrammar ? "500" : "700"}; line-height:1.5;">${escapeHtml(item.meaning || "")}</div>
        ${item.nuance ? `<div class="vocab-nuance">${escapeHtml(item.nuance)}</div>` : ""}
        ${item.sentence ? `<div style="font-size:11.5px; color:#93c5fd; margin-top:4px;">「${escapeHtml(item.sentence)}」</div>` : ""}
      `;
      card.querySelector(".btn-del-saved").addEventListener("click", () => {
        const realIdx = savedVocab.indexOf(item);
        if (realIdx >= 0) {
          const removed = savedVocab.splice(realIdx, 1)[0];
          if (removed && removed.notionPageId) archiveItemFromNotion(removed.notionPageId);
        }
        storageSet("njd_saved_vocab_v1", savedVocab);
        renderVocabDrawer();
        const cue = getActiveCue();
        if (cue && passedCueIndices.has(activeCueIndex)) renderUnlockedStudy(cue);
      });
      listEl.appendChild(card);
    });
    refreshNotionUiBadges();
  }

  function getTodayStamp() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function downloadBlobFile(content, filename, mimeType) {
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

  function exportVocabToCsv() {
    const items = getFilteredSavedItems();
    if (!items.length) {
      showBanner("retry", "💡 내보낼 항목이 없습니다. 먼저 표현이나 문법 포인트를 저장해 주세요!");
      return;
    }
    const esc = (v) => `"${String(v || "").replace(/\r?\n/g, " ").trim().replace(/"/g, '""')}"`;
    const rows = [
      ["번호", "구분", "일본어 단어(요미가나) / 문법명", "한국어 뜻 / 문법 해설", "뉘앙스 / 대사 해석", "출전 일본어 대사", "저장 일시"].map(esc).join(",")
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
    const fileName = `넷플릭스_일본어_${suffix}_${getTodayStamp()}.csv`;
    downloadBlobFile(rows.join("\r\n"), fileName, "text/csv;charset=utf-8;");
    showBanner("ok", `📊 '${fileName}' 엑셀 파일 다운로드가 시작되었습니다!`);
  }

  function exportVocabToTxt() {
    const items = getFilteredSavedItems();
    if (!items.length) {
      showBanner("retry", "💡 내보낼 항목이 없습니다. 먼저 표현이나 문법 포인트를 저장해 주세요!");
      return;
    }
    const lines = [
      "============================================================",
      `  Netflix Japanese Word-Order Studio — 일본어 단어 & 문법 학습장`,
      `  내보낸 날짜: ${getTodayStamp()} (총 ${items.length}개 항목)`,
      "============================================================",
      ""
    ];
    items.forEach((item, i) => {
      const isGrammar = item.kind === "grammar";
      lines.push(`[${i + 1}] ${isGrammar ? "🧩 [문법] " : "📚 [표현] "}${item.term || ""} (${item.typeLabel || "표현"})`);
      lines.push(` • ${isGrammar ? "문법 해설" : "뜻"}: ${item.meaning || ""}`);
      if (item.nuance) lines.push(` • ${isGrammar ? "참고" : "뉘앙스"}: ${item.nuance}`);
      if (item.sentence) lines.push(` • 원문 대사: 「${item.sentence}」`);
      lines.push("");
    });
    const suffix = vocabDrawerFilter === "grammar" ? "문법노트" : vocabDrawerFilter === "vocab" ? "단어장" : "단어문법장";
    const fileName = `넷플릭스_일본어_${suffix}_${getTodayStamp()}.txt`;
    downloadBlobFile(lines.join("\r\n"), fileName, "text/plain;charset=utf-8;");
    showBanner("ok", `📝 '${fileName}' 메모장 파일 다운로드가 시작되었습니다!`);
  }

  // ==================== Fast AI Tutor + Pre-Fetch ====================
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
    if (first !== -1 && last > first) s = s.slice(first, last + 1);
    return JSON.parse(s);
  }

  function buildJpAiPrompt(sentence) {
    return `일본어 초보 한국인 학습자를 위해 아래 일본어 대사의 [모든 단어·조사]와 [문장 구조·문법]을 빠짐없이 아주 쉽게 설명해 JSON만 출력하세요.
대사: "${sentence}"
{
  "reading": "전체 히라가나 발음 [한국어 발음 표기 병기]",
  "ko": "자연스러운 한국어 번역",
  "structure": "[어절1(뜻/역할)] + [어절2(뜻/역할)] ... 형태로 끊어 보여주고 문장이 어떻게 조립되는지 초보자 눈높이에서 2~3문장으로 자세히 설명",
  "pronunciation": "초보자가 주의할 발음·장음·촉음·조사 발음 팁 1~2문장",
  "vocab": [
    {
      "term": "문장 속 모든 단어·조사·어미를 순서대로 하나도 빠짐없이 수록 (표기 [히라가나 · 한글발음])",
      "typeLabel": "명사 | 대명사 | 조사 | 부사 | 동사(기본형: ~) | 형용사(기본형: ~) 등",
      "meaning": "정확한 한국어 뜻",
      "nuance": "초보자용 쉬운 쓰임·활용 설명 1문장"
    }
  ],
  "grammar": {
    "title": "핵심 문법 · 동사/어미 변형 포인트",
    "desc": "동사/형용사가 기본형에서 어떻게 변했는지, 조사가 왜 쓰였는지 초보자도 단번에 이해할 수 있게 3~4문장으로 자세히 설명"
  }
}`;
  }

  function persistAiCache() {
    try {
      storageSet("njd_ai_cache_v2", Array.from(aiCache.entries()).slice(-120));
    } catch (_) {}
  }

  let directModelCache = "";
  let directModelList = [];
  let directKeyPrefix = "";

  async function callAiDirectFallback(cleanKey, prompt) {
    if (cleanKey.startsWith("sk-")) {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cleanKey}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          max_tokens: 600,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "Japanese drama/anime tutor for Korean learners. Concise JSON only." },
            { role: "user", content: prompt }
          ]
        })
      });
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data?.error?.message || `HTTP ${resp.status}`);
      return { data: parseCleanAiJson(data?.choices?.[0]?.message?.content || ""), modelUsed: "gpt-4o-mini" };
    }

    const prefix = cleanKey.slice(0, 10);
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
          !/tts|image|vision|embedding|veo|imagen|audio|live|robotics|computer-use|thinking|aqa/i.test(m.name || "")
      );
      const flashModels = models.filter((m) => /flash/i.test(m.name));
      const pool = flashModels.length > 0 ? flashModels : models;
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
        const genCfg = { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 1500 };
        if (!/flash-lite/i.test(modelName)) {
          if (ver >= 3) genCfg.thinkingConfig = { thinkingLevel: "minimal" };
          else if (ver >= 2.5) genCfg.thinkingConfig = { thinkingBudget: 0 };
        }
        let resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${encodeURIComponent(cleanKey)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: genCfg })
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
              body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: genCfg })
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
        chrome.runtime.sendMessage({ type: "NJD_AI_ANALYZE", apiKey: cleanKey, prompt }, (res) => {
          if (chrome.runtime.lastError) {
            callAiDirectFallback(cleanKey, prompt).then(resolve).catch(reject);
            return;
          }
          if (res && res.ok) resolve({ data: res.data, modelUsed: res.modelUsed });
          else reject(new Error((res && res.error) || "AI 응답 오류"));
        });
      });
    }
    return callAiDirectFallback(cleanKey, prompt);
  }

  function fetchCueAiShared(cueText, cleanKey) {
    if (aiCache.has(cueText)) {
      return Promise.resolve({ data: aiCache.get(cueText), modelUsed: "cached" });
    }
    if (inFlightAiMap.has(cueText)) return inFlightAiMap.get(cueText);
    const p = runAiRequest(cleanKey, buildJpAiPrompt(cueText))
      .then((res) => {
        if (res && res.data) {
          aiCache.set(cueText, res.data);
          persistAiCache();
        }
        return res;
      })
      .finally(() => inFlightAiMap.delete(cueText));
    inFlightAiMap.set(cueText, p);
    return p;
  }

  function triggerBackgroundPrefetch(cueIdx) {
    const cleanKey = sanitizeApiKey(geminiApiKey);
    if (!cleanKey || !jaCues.length) return;
    const targetCue = jaCues[cueIdx];
    if (!targetCue) return;

    fetchCueAiShared(targetCue.text, cleanKey)
      .then(() => {
        const activeNow = getActiveCue();
        if (activeNow && activeNow.text === targetCue.text && passedCueIndices.has(activeCueIndex)) {
          renderUnlockedStudy(activeNow);
        }
        const nextCue = jaCues[cueIdx + 1];
        if (nextCue && !aiCache.has(nextCue.text) && !inFlightAiMap.has(nextCue.text)) {
          fetchCueAiShared(nextCue.text, cleanKey).catch(() => {});
        }
      })
      .catch(() => {});
  }

  async function requestAiManual() {
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
          `✨ AI 일본어 심층 해설 적용 완료! (${result.modelUsed === "cached" ? "사전 분석 캐시 · 0.0초" : result.modelUsed})`
        );
      }
    } catch (err) {
      showBanner("retry", `⚠️ AI 호출 오류: ${err && err.message ? err.message : "오류"}`);
      btn.textContent = "✨ AI 심층 해설";
      btn.disabled = false;
    }
  }

  // ==================== Event Bindings & Keyboard Shortcuts ====================
  function execStudioShortcut(detail) {
    const now = Date.now();
    // Allow rapid number key picks (20ms debounce) while preventing duplicate Enter/Replay
    const cmd = detail.command;
    if (cmd !== "PICK_NUM" && cmd !== "UNDO_LAST" && now - lastShortcutExecMs < 80) return;
    lastShortcutExecMs = now;

    if (cmd === "REPLAY") {
      replayCurrentCue();
    } else if (cmd === "HINT_NEXT") {
      giveNextBlockHint();
    } else if (cmd === "UNDO_LAST") {
      undoLastBlock();
    } else if (cmd === "ENTER") {
      if (passedCueIndices.has(activeCueIndex)) {
        advanceToNextCue();
      } else if (placedIds.length === targetTokens.length) {
        checkAndCompleteIfFull();
      } else {
        replayCurrentCue();
      }
    } else if (cmd === "PICK_NUM") {
      const remaining = getRemainingPoolCards();
      const chosen = remaining[detail.index];
      if (chosen) pickPoolCard(chosen.id);
    }
  }

  document.addEventListener("njd-studio-shortcut", (e) => {
    if (e && e.detail) execStudioShortcut(e.detail);
  });

  shadow.querySelectorAll(".seg-opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      segMode = btn.dataset.seg || "bunsetsu";
      storageSet("njd_seg_mode_v1", segMode);
      shadow.querySelectorAll(".seg-opt").forEach((b) => b.classList.toggle("active", b.dataset.seg === segMode));
      puzzleCueKey = "";
      renderCueUI();
    });
  });

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
      setTimeout(() => shadow.getElementById("notionTokenInput").focus(), 20);
    } else {
      elNotionSetupBox.style.display = "none";
    }
  });

  shadow.getElementById("btnPasteNotionToken").addEventListener("click", async () => {
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
    storageSet("njd_notion_config_v1", notionConfig);
    refreshNotionUiBadges();
  });

  shadow.getElementById("btnNotionDisconnect").addEventListener("click", () => {
    notionConfig = { token: "", targetUrl: "", databaseId: "", dbTitle: "", autoSync: true };
    storageSet("njd_notion_config_v1", notionConfig);
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
      elNotionStatusMsg.textContent = "⚠️ 노션 API 토큰과 노션 페이지 링크를 모두 입력해 주세요.";
      return;
    }

    const btn = shadow.getElementById("btnNotionConnect");
    btn.disabled = true;
    btn.textContent = "연결 확인 중...";
    elNotionStatusMsg.style.color = "#93c5fd";
    elNotionStatusMsg.textContent = "노션 페이지 권한 확인 및 단어·문법장 표 준비 중...";

    const prevChanged = urlVal !== notionConfig.targetUrl;
    const res = await callNotionBg("NJD_NOTION_CONNECT", {
      token: tokenVal,
      targetUrl: urlVal,
      cachedDbId: prevChanged ? "" : (notionConfig.databaseId || ""),
      defaultTitle: "📚 넷플릭스 일본어 단어 · 문법장"
    });

    btn.disabled = false;
    btn.textContent = "🔌 연결 & 표 자동생성";

    if (res && res.ok) {
      notionConfig = {
        token: tokenVal,
        targetUrl: urlVal,
        databaseId: res.databaseId || "",
        dbTitle: res.dbTitle || "📚 넷플릭스 일본어 단어 · 문법장",
        autoSync: autoVal
      };
      storageSet("njd_notion_config_v1", notionConfig);
      refreshNotionUiBadges();
      elNotionStatusMsg.style.color = "#6ee7b7";
      elNotionStatusMsg.textContent = `✓ 연결 성공! '${notionConfig.dbTitle}'에 실시간 자동 저장됩니다.`;
      showBanner("ok", `📓 노션 실시간 자동 저장이 활성화되었습니다! ('${notionConfig.dbTitle}')`);
    } else {
      elNotionStatusMsg.style.color = "#fca5a5";
      elNotionStatusMsg.textContent = `⚠️ ${(res && res.error) || "노션 연결에 실패했습니다."}`;
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
    if (!pendingEntries.length) return;

    const btnBulk = shadow.getElementById("btnNotionBulkSync");
    btnBulk.disabled = true;
    btnBulk.textContent = "전송 중...";

    const res = await callNotionBg("NJD_NOTION_SYNC_BATCH", {
      token: notionConfig.token,
      targetUrl: notionConfig.targetUrl,
      cachedDbId: notionConfig.databaseId || "",
      defaultTitle: "📚 넷플릭스 일본어 단어 · 문법장",
      items: pendingEntries
    });

    btnBulk.disabled = false;
    if (res && res.ok && Array.isArray(res.synced)) {
      res.synced.forEach((s) => {
        if (savedVocab[s.index]) savedVocab[s.index].notionPageId = s.notionPageId;
      });
      storageSet("njd_saved_vocab_v1", savedVocab);
      renderVocabDrawer();
      showBanner("ok", `📓 총 ${res.synced.length}개 항목을 노션으로 일괄 전송 완료했습니다!`);
    } else {
      refreshNotionUiBadges();
      showBanner("retry", `⚠️ 노션 일괄 전송 오류: ${(res && res.error) || "알 수 없는 오류"}`);
    }
  });

  shadow.getElementById("btnJumpResume").addEventListener("click", jumpToSavedResumePoint);
  shadow.getElementById("btnDismissResume").addEventListener("click", () => {
    shadow.getElementById("resumeBar").classList.remove("open");
  });
  shadow.getElementById("btnResetEpProgress").addEventListener("click", () => {
    const epId = getWatchEpisodeId();
    passedCueIndices.clear();
    resumeTargetIndex = -1;
    if (epId && episodeProgressMap[epId]) {
      delete episodeProgressMap[epId];
      storageSet("njd_episode_progress_v1", episodeProgressMap);
    }
    shadow.getElementById("resumeBar").classList.remove("open");
    activeCueIndex = 0;
    puzzleCueKey = "";
    renderCueUI();
    showBanner("ok", "이 에피소드의 일본어 진행 기록을 초기화했습니다.");
  });

  shadow.getElementById("btnApiSetup").addEventListener("click", () => {
    elApiDrawer.classList.toggle("open");
  });
  shadow.getElementById("btnSaveApiKey").addEventListener("click", () => {
    geminiApiKey = sanitizeApiKey(elApiKeyInput.value);
    elApiKeyInput.value = geminiApiKey;
    directModelCache = "";
    storageSet("njd_gemini_api_key_v1", geminiApiKey);
    elApiDrawer.classList.remove("open");
    showBanner("ok", geminiApiKey ? "✓ API 키가 저장되었습니다!" : "API 키가 삭제되었습니다.");
    if (geminiApiKey) {
      triggerBackgroundPrefetch(activeCueIndex);
      if (passedCueIndices.has(activeCueIndex)) requestAiManual();
    }
  });

  shadow.getElementById("btnSyncDual").addEventListener("click", () => sendPlayerCmd("SYNC_DUAL_SUBS"));

  shadow.getElementById("btnPrevCue").addEventListener("click", () => {
    if (activeCueIndex > 0) {
      activeCueIndex--;
      puzzleCueKey = "";
      elBanner.className = "banner";
      saveEpisodeProgress();
      renderCueUI();
      replayCurrentCue();
    }
  });

  shadow.getElementById("btnNextCueManual").addEventListener("click", () => {
    if (activeCueIndex < jaCues.length - 1) {
      activeCueIndex++;
      puzzleCueKey = "";
      elBanner.className = "banner";
      saveEpisodeProgress();
      renderCueUI();
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

  shadow.getElementById("btnUndoBlock").addEventListener("click", undoLastBlock);
  shadow.getElementById("btnHintNextBlock").addEventListener("click", giveNextBlockHint);
  shadow.getElementById("btnResetBlocks").addEventListener("click", () => {
    if (passedCueIndices.has(activeCueIndex)) return;
    prepareCuePuzzle(true);
    elBanner.className = "banner";
    renderCueUI();
  });

  shadow.getElementById("btnReveal").addEventListener("click", () => {
    const cue = getActiveCue();
    if (!cue) return;
    passedCueIndices.add(activeCueIndex);
    puzzleCueKey = "";
    saveEpisodeProgress();
    sendPlayerCmd("PAUSE");
    showBanner("ok", "📖 정답과 해설을 열었습니다! 구간을 다시 들어보며 어순·단어·문법을 익힌 뒤 Enter로 넘어가세요.");
    renderCueUI();
    focusStudioSafely();
  });

  elBtnAdvanceNext.addEventListener("click", advanceToNextCue);
  shadow.getElementById("btnAskAi").addEventListener("click", requestAiManual);

  function mergeCueStream(existing, incoming, isForced) {
    if (!Array.isArray(incoming) || incoming.length === 0) return existing;
    // Never let a tiny Forced Narrative sign track overwrite an already-loaded dialogue track!
    if (isForced && existing.length >= 20) return existing;
    if (incoming.length < 15 && existing.length >= 45 && isForced) return existing;
    // If replacing a tiny initial forced/DOM fallback (<20 cues) with a full episode track (>=40 cues), use the clean full track
    if (!isForced && incoming.length >= 40 && existing.length < 20) {
      return incoming.slice();
    }

    const combined = existing.slice();
    incoming.forEach((nc) => {
      const dup = combined.some(
        (ec) => Math.abs(ec.startMs - nc.startMs) <= 150 && (ec.text === nc.text || ec.text.includes(nc.text))
      );
      if (!dup) combined.push(nc);
    });
    combined.sort((a, b) => a.startMs - b.startMs);
    return combined;
  }

  // ==================== Listen to MAIN World Messages ====================
  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.source !== "NJD_MAIN") return;
    const msg = event.data;

    if (msg.type === "SUBTITLE_TRACK") {
      if (msg.lang === "ja") {
        const prevActiveCue = getActiveCue();
        const prevCount = jaCues.length;
        jaCues = mergeCueStream(jaCues, msg.cues, Boolean(msg.isForced));

        if (prevActiveCue && prevCount >= 10) {
          // Keep user anchored on the exact same cue while background segments append!
          const keepIdx = jaCues.findIndex(
            (c) => Math.abs(c.startMs - prevActiveCue.startMs) <= 150 && c.text === prevActiveCue.text
          );
          if (keepIdx >= 0) activeCueIndex = keepIdx;
        } else {
          const idx = jaCues.findIndex((c) => c.endMs >= lastKnownTimeMs);
          activeCueIndex = idx >= 0 ? idx : 0;
          puzzleCueKey = "";
          restoreEpisodeProgressAndOfferResume();
        }
        renderCueUI();
      } else if (msg.lang === "ko") {
        koCues = mergeCueStream(koCues, msg.cues, Boolean(msg.isForced));
        renderSubtitleStatus();
        const cue = getActiveCue();
        if (cue && passedCueIndices.has(activeCueIndex)) renderUnlockedStudy(cue);
      }
    } else if (msg.type === "LIVE_DOM_CUE") {
      if (msg.lang === "ja" && jaCues.length < 25) {
        const prevLen = jaCues.length;
        jaCues = mergeCueStream(jaCues, [msg.cue], false);
        if (prevLen === 0) {
          activeCueIndex = 0;
          puzzleCueKey = "";
        }
        renderCueUI();
      }
    } else if (msg.type === "NO_FULL_JA_SUB_WARNING") {
      elSubStatus.textContent = "⚠️ 이 에피소드는 일본어(CC) 대사 자막 미제공 구작입니다";
      showBanner("retry", msg.message);
    } else if (msg.type === "PRE_ROLL_STATE") {
      const badge = shadow.getElementById("preRollBadge");
      if (badge) {
        if (msg.waitingReady) {
          badge.textContent = "⏳ 플레이어 준비 후 이동 중...";
          badge.style.color = "#f472b6";
          badge.style.display = msg.active ? "inline" : "none";
        } else if (msg.phase === "approaching") {
          badge.textContent = "⏭️ 곧 받아쓰기 대사 시작...";
          badge.style.color = "#fbbf24";
          badge.style.display = "inline";
        } else if (msg.phase === "speaking") {
          badge.textContent = "🔊 지금 이 대사 조립하기!";
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
      focusStudioSafely();
    } else if (msg.type === "DUAL_SYNC_STATUS") {
      showBanner("ok", msg.message);
    } else if (msg.type === "TICK") {
      if (msg.pathname !== currentPathKey) {
        currentPathKey = msg.pathname;
        jaCues = [];
        koCues = [];
        passedCueIndices.clear();
        autoPausedForCue.clear();
        puzzleCueKey = "";
        syncBodyClasses();
        renderCueUI();
      }

      lastKnownTimeMs = msg.timeMs;
      if (!dictationEnabled || panelMinimized || jaCues.length === 0) return;

      const cue = getActiveCue();
      if (!cue) return;

      const bounds = getTargetCueBounds(cue);

      if (
        !msg.paused &&
        msg.timeMs >= bounds.start - 500 &&
        msg.timeMs < bounds.end &&
        (!passedCueIndices.has(activeCueIndex) || segmentReplayArmed) &&
        (!autoPausedForCue.has(activeCueIndex) || segmentReplayArmed)
      ) {
        sendPlayerCmd("SET_STOP_AT", { stopAtMs: bounds.end });
      }

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
            focusStudioSafely();
          }
        }
      }

      if (
        !segmentReplayArmed &&
        Date.now() > resumeSeekGuardUntil &&
        (msg.timeMs < cue.startMs - 4500 || msg.timeMs > cue.endMs + 4500)
      ) {
        const jumpedIdx = jaCues.findIndex(
          (c) => msg.timeMs >= c.startMs - 1000 && msg.timeMs <= c.endMs + 800
        );
        if (jumpedIdx >= 0 && jumpedIdx !== activeCueIndex) {
          activeCueIndex = jumpedIdx;
          puzzleCueKey = "";
          renderCueUI();
        }
      }
    }
  });

  // ==================== Initialize ====================
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.njd_gemini_api_key_v1) {
        geminiApiKey = sanitizeApiKey(changes.njd_gemini_api_key_v1.newValue || "");
        elApiKeyInput.value = geminiApiKey;
        directModelCache = "";
      }
      if (area === "local" && changes.njd_saved_vocab_v1) {
        savedVocab = changes.njd_saved_vocab_v1.newValue || [];
        renderVocabDrawer();
      }
      if (area === "local" && changes.njd_notion_config_v1) {
        notionConfig = changes.njd_notion_config_v1.newValue || notionConfig;
        refreshNotionUiBadges();
      }
    });
  }

  (async function init() {
    savedVocab = await storageGet("njd_saved_vocab_v1", []);
    notionConfig = await storageGet("njd_notion_config_v1", notionConfig);
    episodeProgressMap = await storageGet("njd_episode_progress_v1", {});
    segMode = await storageGet("njd_seg_mode_v1", "bunsetsu");
    shadow.querySelectorAll(".seg-opt").forEach((b) =>
      b.classList.toggle("active", b.dataset.seg === segMode)
    );
    refreshNotionUiBadges();

    geminiApiKey = await storageGet("njd_gemini_api_key_v1", "");
    const persistedAi = await storageGet("njd_ai_cache_v2", []);
    if (Array.isArray(persistedAi)) {
      persistedAi.forEach(([k, v]) => {
        if (k && v) aiCache.set(k, v);
      });
    }
    if (geminiApiKey) elApiKeyInput.value = geminiApiKey;
    syncBodyClasses();
    renderCueUI();
    setInterval(syncBodyClasses, 1000);
  })();
})();
