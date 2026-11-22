(function () {
  "use strict";

  const STORAGE_PROGRESS_KEY = "sitcom_dictation_progress_v1";
  const STORAGE_VOCAB_KEY = "sitcom_dictation_vocab_v1";
  const STORAGE_CUSTOM_EP_KEY = "sitcom_dictation_custom_eps_v1";
  const STORAGE_SYNC_KEY = "sitcom_dictation_sync_offsets_v1";
  const STORAGE_NOTION_KEY = "sitcom_dictation_notion_v1";

  // State
  let episodes = [];
  let currentModeFilter = "all"; // 'all' | 'youtube' | 'companion'
  let currentEpIndex = 0;
  let currentLineIndex = 0;
  let progressMap = loadJSON(STORAGE_PROGRESS_KEY, {});
  let savedVocab = loadJSON(STORAGE_VOCAB_KEY, []);
  let syncOffsets = loadJSON(STORAGE_SYNC_KEY, {});
  let webNotionCfg = loadJSON(STORAGE_NOTION_KEY, {
    token: "",
    targetUrl: "",
    databaseId: "",
    dbTitle: "",
    autoSync: true
  });
  let freeMode = false;
  let autoLoop = false;
  let playbackSpeed = 1.0;
  let startOffsetSec = 0.0;
  let endOffsetSec = 0.0;

  // Per-line hint state
  let showFirstLetterHint = false;
  let revealedWordIndices = new Set();
  let lastMatchedDisplaySet = new Set();
  let hasAttemptedCurrent = false;

  // YouTube Player State
  let ytPlayer = null;
  let ytReady = false;
  let segmentMonitor = null;
  let autoLoopTimeout = null;
  let pendingPlayOnReady = false;
  let ytPreRollActive = false;
  let ytWasMutedBeforePreRoll = false;

  // Contraction & Variant Atomic Expansion Dictionary
  const ATOMIC_EXPANSIONS = {
    "i'm": ["i", "am"],
    "you're": ["you", "are"],
    "we're": ["we", "are"],
    "they're": ["they", "are"],
    "he's": ["he", "is"],
    "she's": ["she", "is"],
    "it's": ["it", "is"],
    "that's": ["that", "is"],
    "there's": ["there", "is"],
    "what's": ["what", "is"],
    "who's": ["who", "is"],
    "how's": ["how", "is"],
    "let's": ["let", "us"],
    "don't": ["do", "not"],
    "doesn't": ["does", "not"],
    "didn't": ["did", "not"],
    "can't": ["can", "not"],
    "cannot": ["can", "not"],
    "won't": ["will", "not"],
    "wouldn't": ["would", "not"],
    "shouldn't": ["should", "not"],
    "couldn't": ["could", "not"],
    "isn't": ["is", "not"],
    "aren't": ["are", "not"],
    "wasn't": ["was", "not"],
    "weren't": ["were", "not"],
    "haven't": ["have", "not"],
    "hasn't": ["has", "not"],
    "i've": ["i", "have"],
    "you've": ["you", "have"],
    "we've": ["we", "have"],
    "they've": ["they", "have"],
    "would've": ["would", "have"],
    "could've": ["could", "have"],
    "should've": ["should", "have"],
    "i'll": ["i", "will"],
    "you'll": ["you", "will"],
    "we'll": ["we", "will"],
    "they'll": ["they", "will"],
    "i'd": ["i", "would"],
    "you'd": ["you", "would"],
    "gonna": ["going", "to"],
    "wanna": ["want", "to"],
    "gotta": ["got", "to"],
    "kinda": ["kind", "of"],
    "sorta": ["sort", "of"],
    "c'mon": ["come", "on"],
    "alright": ["all", "right"],
    "holdup": ["hold", "up"],
    "drugstore": ["drug", "store"],
    "anymore": ["any", "more"],
    "'cause": ["because"],
    "cause": ["because"],
    "cuz": ["because"],
    "cos": ["because"],
    "ok": ["okay"],
    "rach": ["rachel"],
    "yeah": ["yes"],
    "yep": ["yes"],
    "1": ["one"],
    "2": ["two"],
    "3": ["three"],
    "4": ["four"],
    "5": ["five"],
    "6": ["six"],
    "7": ["seven"],
    "8": ["eight"],
    "9": ["nine"],
    "10": ["ten"],
    "11": ["eleven"],
    "12": ["twelve"]
  };

  // Auto Pattern Dictionary for Imported SRT Companion Courses
  const AUTO_EXPRESSION_PATTERNS = [
    { regex: /\bgo(?:ing|es|ne)? out with\b/i, term: "go out with ~", type: "phrasal", typeLabel: "구동사", meaning: "~와 데이트하다, 사귀다", nuance: "연애·데이트 상황에서 가장 자주 쓰이는 일상 구동사입니다." },
    { regex: /\bfigure(?:d|s|ing)? out\b/i, term: "figure out", type: "phrasal", typeLabel: "구동사", meaning: "(답·이유·해결책을) 알아내다, 파악하다", nuance: "복잡한 상황을 이해하거나 문제를 풀었을 때 씁니다." },
    { regex: /\bfreak(?:ed|s|ing)? out\b/i, term: "freak out", type: "phrasal", typeLabel: "구동사/슬랭", meaning: "기겁하다, 패닉에 빠지다, 흥분하다", nuance: "미드 주인공들이 당황하거나 깜짝 놀랄 때 매 회차 쓰는 표현입니다." },
    { regex: /\bhang(?:ing|s)? out\b|\bhung out\b/i, term: "hang out", type: "phrasal", typeLabel: "구동사", meaning: "(친하게) 어울려 놀다, 시간을 보내다", nuance: "특별한 목적 없이 편하게 만나 시간을 보낼 때 사용합니다." },
    { regex: /\bend(?:ed|s|ing)? up\b/i, term: "end up + V-ing/명사", type: "phrasal", typeLabel: "구동사", meaning: "결국 ~하게 되다", nuance: "원래 계획과 달리 돌고 돌아 결국 어떤 결과에 이르렀을 때 씁니다." },
    { regex: /\bturn(?:ed|s|ing)? out\b/i, term: "turn out", type: "phrasal", typeLabel: "구동사", meaning: "(결과적으로) ~임이 드러나다, 밝혀지다", nuance: "예상치 못한 반전이나 진실이 밝혀질 때 자주 쓰입니다." },
    { regex: /\bdeal(?:ing)? with\b|\bdealt with\b/i, term: "deal with", type: "phrasal", typeLabel: "구동사", meaning: "(문제·상황을) 처리하다, 감당하다", nuance: "성가시거나 까다로운 대상을 다룰 때 사용합니다." },
    { regex: /\bsupposed to\b/i, term: "be supposed to + 동사원형", type: "idiom", typeLabel: "필수 구문", meaning: "~하기로 되어 있다, 원래 ~해야 한다", nuance: "약속·규칙·기대치를 말할 때 미국인이 매일 쓰는 핵심 패턴입니다." },
    { regex: /\bwhat if\b/i, term: "What if ~?", type: "idiom", typeLabel: "회화 패턴", meaning: "만약 ~라면 어쩌지?", nuance: "가정의 상황이나 걱정을 던질 때 문두에 쓰는 대표 표현입니다." },
    { regex: /\bbig deal\b/i, term: "a big deal", type: "idiom", typeLabel: "관용어", meaning: "대단한 일, 중요한 문제", nuance: "'not a big deal(별일 아니야)' 형태로도 매우 자주 쓰입니다." },
    { regex: /\bmake(?:s|d|ing)? sense\b|\bmade sense\b/i, term: "make sense", type: "idiom", typeLabel: "관용어", meaning: "말이 되다, 이치에 맞다", nuance: "상대의 설명이 납득될 때 'That makes sense!'라고 반응합니다." },
    { regex: /\bgonna\b/i, term: "gonna (going to)", type: "slang", typeLabel: "구어 축약", meaning: "~할 것이다 (미래 의도·예측)", nuance: "구어체에서 'going to'가 축약되어 [거너]로 발음됩니다." },
    { regex: /\bwanna\b/i, term: "wanna (want to)", type: "slang", typeLabel: "구어 축약", meaning: "~하고 싶다", nuance: "'want to'의 구어 축약형으로 [워너]로 자연스럽게 이어집니다." },
    { regex: /\bgotta\b/i, term: "gotta (have got to)", type: "slang", typeLabel: "구어 축약", meaning: "꼭 ~해야 한다 / 틀림없이 ~일 것이다", nuance: "'have got to'에서 have가 생략되고 축약된 구어 표현입니다." }
  ];

  // DOM Elements
  const elEpisodeBar = document.getElementById("episodeBar");
  const elYoutubeConsole = document.getElementById("youtubeConsole");
  const elCompanionConsole = document.getElementById("companionConsole");
  const elCompanionTargetEpisode = document.getElementById("companionTargetEpisode");
  const elCompanionTimecodeDigits = document.getElementById("companionTimecodeDigits");
  const elCompanionSceneCue = document.getElementById("companionSceneCue");
  const elBtnSyncReset = document.getElementById("btnSyncReset");
  const elTimelineList = document.getElementById("timelineList");
  const elTimelineTitle = document.getElementById("timelineTitle");
  const elSegmentTimeLabel = document.getElementById("segmentTimeLabel");
  const elStartOffsetLabel = document.getElementById("startOffsetLabel");
  const elEndOffsetLabel = document.getElementById("endOffsetLabel");
  const elPreRollCurtain = document.getElementById("preRollCurtain");
  const elLineStepBadge = document.getElementById("lineStepBadge");
  const elSpeakerChip = document.getElementById("speakerChip");
  const elSceneContextNote = document.getElementById("sceneContextNote");
  const elWordCountInfo = document.getElementById("wordCountInfo");
  const elWordSlots = document.getElementById("wordSlots");
  const elDictationInput = document.getElementById("dictationInput");
  const elFeedbackBanner = document.getElementById("feedbackBanner");
  const elFeedbackText = document.getElementById("feedbackText");
  const elFeedbackAccuracy = document.getElementById("feedbackAccuracy");
  const elStudySection = document.getElementById("studySection");
  const elAnswerEn = document.getElementById("answerEn");
  const elAnswerKo = document.getElementById("answerKo");
  const elPronunciationTip = document.getElementById("pronunciationTip");
  const elVocabList = document.getElementById("vocabList");
  const elGrammarTitle = document.getElementById("grammarTitle");
  const elGrammarDesc = document.getElementById("grammarDesc");
  const elBtnCheckAnswer = document.getElementById("btnCheckAnswer");
  const elBtnNextLine = document.getElementById("btnNextLine");
  const elSavedVocabCount = document.getElementById("savedVocabCount");
  const elSubtitleShield = document.getElementById("subtitleShield");

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function saveJSON(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (_) {}
  }

  function initEpisodes() {
    const customEps = loadJSON(STORAGE_CUSTOM_EP_KEY, []);
    episodes = [...(window.SITCOM_EPISODES || []), ...customEps];
  }

  function getCurrentEpisode() {
    return episodes[currentEpIndex];
  }

  function isCompanionMode(ep) {
    return Boolean(ep && ep.mode === "companion");
  }

  function getEpisodeSyncOffset(epId) {
    return Number(syncOffsets[epId] || 0);
  }

  function adjustEpisodeSyncOffset(epId, delta) {
    const next = Math.round((getEpisodeSyncOffset(epId) + delta) * 10) / 10;
    syncOffsets[epId] = next;
    saveJSON(STORAGE_SYNC_KEY, syncOffsets);
  }

  function getCurrentLine() {
    const ep = getCurrentEpisode();
    return ep ? ep.lines[currentLineIndex] : null;
  }

  function getEpisodePassedSet(epId) {
    const arr = progressMap[epId] || [];
    return new Set(arr);
  }

  function markLinePassed(epId, lineIdx) {
    const set = getEpisodePassedSet(epId);
    set.add(lineIdx);
    progressMap[epId] = Array.from(set);
    saveJSON(STORAGE_PROGRESS_KEY, progressMap);
  }

  function isLineUnlocked(epId, lineIdx) {
    if (freeMode || lineIdx === 0) return true;
    const passed = getEpisodePassedSet(epId);
    return passed.has(lineIdx) || passed.has(lineIdx - 1);
  }

  // ==================== Auxiliary Native TTS (for Companion Mode) ====================
  function speakAuxiliaryEnglish(rate) {
    const line = getCurrentLine();
    if (!line || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(line.en);
    utter.lang = "en-US";
    utter.rate = rate || 1.0;
    const voices = window.speechSynthesis.getVoices();
    const usVoice =
      voices.find((v) => v.lang === "en-US" && /Google|Natural|Aria|Guy|Jenny|Zira|David/i.test(v.name)) ||
      voices.find((v) => v.lang && v.lang.startsWith("en"));
    if (usVoice) utter.voice = usVoice;
    window.speechSynthesis.speak(utter);
  }

  // ==================== YouTube IFrame API ====================
  function loadYouTubeAPI() {
    if (window.YT && window.YT.Player) {
      createPlayer();
      return;
    }
    window.onYouTubeIframeAPIReady = function () {
      createPlayer();
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  }

  function createPlayer() {
    const firstYtEp = episodes.find((e) => !isCompanionMode(e)) || episodes[0];
    if (!firstYtEp || !firstYtEp.videoId) return;

    ytPlayer = new YT.Player("ytPlayer", {
      videoId: firstYtEp.videoId,
      playerVars: {
        playsinline: 1,
        rel: 0,
        modestbranding: 1,
        cc_load_policy: 0,
        iv_load_policy: 3,
        controls: 1,
        origin: window.location.origin
      },
      events: {
        onReady: function () {
          ytReady = true;
          ytPlayer.setPlaybackRate(playbackSpeed);
          if (pendingPlayOnReady) {
            pendingPlayOnReady = false;
            playCurrentSegment();
          }
        },
        onStateChange: function (e) {
          if (e.data === YT.PlayerState.PLAYING) {
            try {
              ytPlayer.unloadModule("captions");
              ytPlayer.unloadModule("cc");
            } catch (_) {}
          }
        }
      }
    });
  }

  function restoreYtAudioAndCurtain() {
    if (elPreRollCurtain) {
      elPreRollCurtain.style.display = "none";
    }
    ytPreRollActive = false;
  }

  function clearSegmentTimers() {
    if (segmentMonitor) {
      clearInterval(segmentMonitor);
      segmentMonitor = null;
    }
    if (autoLoopTimeout) {
      clearTimeout(autoLoopTimeout);
      autoLoopTimeout = null;
    }
    restoreYtAudioAndCurtain();
  }

  function playCurrentSegment() {
    const ep = getCurrentEpisode();
    const line = getCurrentLine();
    if (!ep || !line) return;

    if (isCompanionMode(ep)) {
      speakAuxiliaryEnglish(1.0);
      return;
    }

    clearSegmentTimers();

    if (!ytReady || !ytPlayer || typeof ytPlayer.seekTo !== "function") {
      pendingPlayOnReady = true;
      return;
    }

    const startSec = Math.max(0, line.start + startOffsetSec - 0.02);
    const endSec = Math.max(startSec + 0.5, line.end + endOffsetSec);

    const currentBeforeSeek =
      typeof ytPlayer.getCurrentTime === "function" ? Number(ytPlayer.getCurrentTime() || 0) : 0;
    const isNearbyBuffered = Math.abs(currentBeforeSeek - startSec) <= 10;

    ytPlayer.setPlaybackRate(playbackSpeed);
    // Prefer in-buffer seek (allowSeekAhead=false) when nearby to avoid 5s DASH GOP chunk resets,
    // while keeping normal audio ON at all times!
    ytPlayer.seekTo(startSec, !isNearbyBuffered);
    ytPlayer.playVideo();

    if (isNearbyBuffered) {
      setTimeout(function () {
        if (!ytReady || !ytPlayer || typeof ytPlayer.getCurrentTime !== "function") return;
        const afterT = Number(ytPlayer.getCurrentTime() || 0);
        if (Math.abs(afterT - startSec) > 4.5) {
          ytPlayer.seekTo(startSec, true);
        }
      }, 65);
    }

    segmentMonitor = setInterval(function () {
      if (!ytPlayer || typeof ytPlayer.getCurrentTime !== "function") return;
      const now = Number(ytPlayer.getCurrentTime() || 0);

      if (now >= endSec) {
        clearInterval(segmentMonitor);
        segmentMonitor = null;
        ytPlayer.pauseVideo();

        const currEp = getCurrentEpisode();
        const isPassed = getEpisodePassedSet(currEp.id).has(currentLineIndex);
        if (autoLoop && !isPassed) {
          autoLoopTimeout = setTimeout(function () {
            playCurrentSegment();
          }, 1200);
        }
      }
    }, 20);
  }

  // ==================== SmartSitcomGrader™ ====================
  function getDisplayWords(text) {
    return text
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  function cleanWord(raw) {
    return raw
      .toLowerCase()
      .replace(/[’‘`]/g, "'")
      .replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, "");
  }

  function expandToAtomicTokens(text, withDisplayMap) {
    const rawWords = getDisplayWords(text);
    const atoms = [];

    rawWords.forEach((rw, displayIdx) => {
      const subParts = rw.split(/[-—–]+/).filter(Boolean);
      subParts.forEach((part) => {
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

  function isTokenCloseMatch(a, b) {
    if (a === b) return true;
    if (a.length >= 5 && b.length >= 5 && Math.abs(a.length - b.length) <= 1) {
      return levenshtein(a, b) <= 1;
    }
    return false;
  }

  function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }
    return dp[m][n];
  }

  function gradeDictation(targetText, userText) {
    const displayWords = getDisplayWords(targetText);
    const targetAtoms = expandToAtomicTokens(targetText, true);
    const userAtoms = expandToAtomicTokens(userText, false);

    const T = targetAtoms.length;
    const U = userAtoms.length;

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

    const matchedAtomIndices = new Set();
    let i = 0;
    let j = 0;
    while (i < T && j < U) {
      if (isTokenCloseMatch(targetAtoms[i].tok, userAtoms[j])) {
        matchedAtomIndices.add(i);
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        i++;
      } else {
        j++;
      }
    }

    const atomsPerDisplay = new Map();
    targetAtoms.forEach((item, atomIdx) => {
      if (!atomsPerDisplay.has(item.displayIdx)) {
        atomsPerDisplay.set(item.displayIdx, []);
      }
      atomsPerDisplay.get(item.displayIdx).push(atomIdx);
    });

    const matchedDisplayIndices = new Set();
    displayWords.forEach((_, dIdx) => {
      const atomList = atomsPerDisplay.get(dIdx) || [];
      if (atomList.length === 0 || atomList.every((aIdx) => matchedAtomIndices.has(aIdx))) {
        matchedDisplayIndices.add(dIdx);
      }
    });

    const accuracy = T === 0 ? 100 : Math.round((matchedAtomIndices.size / T) * 100);
    const passed =
      matchedAtomIndices.size === T ||
      (T >= 11 && T - matchedAtomIndices.size <= 1 && U <= T + 2);

    return {
      passed,
      accuracy,
      matchedDisplayIndices,
      totalWords: displayWords.length,
      matchedWordsCount: matchedDisplayIndices.size
    };
  }

  // ==================== SRT Parser & Auto Analyzer ====================
  function parseTimestampToSec(ts) {
    const m = ts.trim().match(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/);
    if (!m) return 0;
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const ss = parseInt(m[3], 10);
    const ms = parseInt(m[4].padEnd(3, "0"), 10);
    return Math.round((hh * 3600 + mm * 60 + ss + ms / 1000) * 10) / 10;
  }

  function autoAnalyzeLine(enText) {
    const vocab = [];
    AUTO_EXPRESSION_PATTERNS.forEach((pat) => {
      if (pat.regex.test(enText) && vocab.length < 3) {
        vocab.push({
          term: pat.term,
          type: pat.type,
          typeLabel: pat.typeLabel,
          meaning: pat.meaning,
          nuance: pat.nuance
        });
      }
    });

    let grammar = {
      title: "실전 구어체 문장 구조",
      desc: "강세가 실리는 내용어(명사·동사·형용사)와 약하게 발음되는 기능어(전치사·관사·대명사)의 리듬 차이에 유의해 다시 들어보세요."
    };

    if (/\b(?:would|could|should)(?:'ve|\s+have)\s+\w+/i.test(enText)) {
      grammar = {
        title: "조동사 + have p.p. (과거 사실에 대한 가정·후회·추측)",
        desc: "'would/could/should have + 과거분사' 구문으로, 회화에서는 'would've[우드브]', 'could've[쿠드브]', 'should've[슈드브]'로 축약 발음됩니다."
      };
    } else if (/\b(?:have|has|i've|you've|we've|they've|he's|she's)\s+(?:never\s+|always\s+|just\s+)?\w+(?:ed|en|ne|t)\b/i.test(enText)) {
      grammar = {
        title: "현재완료 시제 (have/has + p.p.)",
        desc: "과거에 일어난 일이 현재의 상황이나 감정에 직접적인 영향을 미치고 있음을 나타내는 현재완료 표현입니다."
      };
    } else if (/^what if\b/i.test(enText)) {
      grammar = {
        title: "가정·제안 의문문 (What if + 주어 + 동사?)",
        desc: "'만약 ~라면 어쩌지?'라는 의미로 미래의 가능성을 가정할 때 현재시제를 결합해 사용합니다."
      };
    } else if (/\?$/.test(enText.trim())) {
      grammar = {
        title: "구어체 의문문 억양 포인트",
        desc: "Yes/No 의문문은 문장 끝을 올리고(↗), 의문사(What, Why, How, Where)로 시작하는 의문문은 문장 끝을 내려(↘) 발음합니다."
      };
    }

    return { vocab, grammar };
  }

  function parseSrtOrPlainText(rawText) {
    const normalized = rawText.replace(/\r\n/g, "\n").trim();
    if (!normalized) return [];

    const hasSrtTiming = /\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/.test(normalized);
    const lines = [];

    if (hasSrtTiming) {
      const blocks = normalized.split(/\n\s*\n/);
      blocks.forEach((block) => {
        const bLines = block.split("\n").map((s) => s.trim()).filter(Boolean);
        const timeIdx = bLines.findIndex((l) => l.includes("-->"));
        if (timeIdx === -1) return;
        const parts = bLines[timeIdx].split("-->");
        const start = parseTimestampToSec(parts[0]);
        const end = Math.max(start + 1.5, parseTimestampToSec(parts[1]));
        const textBody = bLines
          .slice(timeIdx + 1)
          .join(" ")
          .replace(/<[^>]+>/g, "")
          .replace(/\[.*?\]|\(.*?\)|♪.*?♪|♪/g, "")
          .replace(/^\s*-\s*/, "")
          .replace(/\s+/g, " ")
          .trim();

        if (textBody.length >= 4 && /[a-zA-Z]/.test(textBody)) {
          const analysis = autoAnalyzeLine(textBody);
          lines.push({
            start,
            end,
            speaker: "Character",
            sceneCue: `쿠팡플레이 ${formatClock(start)} 지점 대사`,
            context: "쿠팡플레이 정품 창에서 해당 시간 구간을 듣고 받아쓰세요.",
            en: textBody,
            ko: "(자막 파일에서 생성된 병행 학습 대사입니다)",
            pronunciation: "쿠팡플레이 원음과 보조 발음 듣기 버튼을 함께 활용해 연음을 확인해 보세요.",
            vocab: analysis.vocab,
            grammar: analysis.grammar
          });
        }
      });
    } else {
      normalized.split("\n").forEach((rawLine, idx) => {
        const cleaned = rawLine
          .replace(/\[.*?\]|\(.*?\)/g, "")
          .replace(/^\s*[-•]\s*/, "")
          .trim();
        if (cleaned.length >= 4 && /[a-zA-Z]/.test(cleaned)) {
          let speaker = "Character";
          let en = cleaned;
          const spMatch = cleaned.match(/^([A-Za-z가-힣\s]{2,15}):\s*(.+)$/);
          if (spMatch) {
            speaker = spMatch[1].trim();
            en = spMatch[2].trim();
          }
          const analysis = autoAnalyzeLine(en);
          lines.push({
            start: idx * 5,
            end: idx * 5 + 4,
            speaker,
            sceneCue: `${idx + 1}번째 등록 대사`,
            context: "쿠팡플레이 영상 흐름에 맞춰 순서대로 받아쓰기를 진행하세요.",
            en,
            ko: "(대본 텍스트에서 생성된 병행 학습 대사입니다)",
            pronunciation: "보조 발음 듣기(1.0x / 0.75x)로 연음 구간을 점검할 수 있습니다.",
            vocab: analysis.vocab,
            grammar: analysis.grammar
          });
        }
      });
    }

    return lines.slice(0, 120);
  }

  // ==================== Rendering UI ====================
  function formatSec(sec) {
    const safe = Math.max(0, sec);
    const m = Math.floor(safe / 60);
    const s = (safe % 60).toFixed(1).padStart(4, "0");
    return `${String(m).padStart(2, "0")}:${s}`;
  }

  function formatClock(sec) {
    const safe = Math.max(0, Math.round(sec));
    const m = Math.floor(safe / 60);
    const s = safe % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function renderEpisodeBar() {
    elEpisodeBar.innerHTML = "";
    episodes.forEach((ep, idx) => {
      const epMode = isCompanionMode(ep) ? "companion" : "youtube";
      if (currentModeFilter !== "all" && currentModeFilter !== epMode) {
        return;
      }

      const passedSet = getEpisodePassedSet(ep.id);
      const total = ep.lines.length;
      const done = passedSet.size;
      const pct = total ? Math.round((done / total) * 100) : 0;
      const companion = isCompanionMode(ep);

      const card = document.createElement("div");
      card.className =
        "episode-card" +
        (companion ? " companion-card" : "") +
        (idx === currentEpIndex ? " active" : "");

      card.innerHTML = `
        <div class="ep-card-top">
          <span class="show-badge ${companion ? "companion-badge" : ""}">
            ${companion ? "🟦 " : "▶️ "}${escapeHtml(ep.show)}
          </span>
          <span class="level-badge">${escapeHtml(ep.difficulty || "중급")}</span>
        </div>
        <div class="ep-card-title" title="${escapeHtml(ep.title)}">${escapeHtml(ep.title)}</div>
        <div class="ep-card-progress">
          <div class="progress-track">
            <div class="progress-fill" style="width:${pct}%"></div>
          </div>
          <span>${done}/${total}</span>
        </div>
      `;
      card.addEventListener("click", () => selectEpisode(idx));
      elEpisodeBar.appendChild(card);
    });
  }

  function renderLeftConsole() {
    const ep = getCurrentEpisode();
    const line = getCurrentLine();
    if (!ep || !line) return;

    if (isCompanionMode(ep)) {
      elYoutubeConsole.style.display = "none";
      elCompanionConsole.classList.add("active");

      const sync = getEpisodeSyncOffset(ep.id);
      const adjStart = Math.max(0, line.start + sync);
      const adjEnd = Math.max(adjStart + 1, line.end + sync);

      elCompanionTargetEpisode.textContent =
        ep.ottGuideTarget || `${ep.show} · ${ep.title}`;
      elCompanionTimecodeDigits.textContent = `${formatClock(adjStart)} ~ ${formatClock(adjEnd)}`;
      elCompanionSceneCue.textContent = `🎬 장면 가이드: ${line.sceneCue || line.context || "해당 타임코드 구간을 재생해 들어보세요."}`;
      elBtnSyncReset.textContent = `${sync >= 0 ? "+" : ""}${sync.toFixed(0)}s`;
    } else {
      elCompanionConsole.classList.remove("active");
      elYoutubeConsole.style.display = "block";
      elSegmentTimeLabel.textContent = `${formatSec(Math.max(0, line.start + startOffsetSec))} ~ ${formatSec(line.end + endOffsetSec)}`;
    }
  }

  function renderTimeline() {
    const ep = getCurrentEpisode();
    if (!ep) return;
    const passedSet = getEpisodePassedSet(ep.id);
    const sync = isCompanionMode(ep) ? getEpisodeSyncOffset(ep.id) : 0;

    elTimelineTitle.textContent = `${ep.show} 대사 목록 (${passedSet.size} / ${ep.lines.length} 통과)`;
    elTimelineList.innerHTML = "";

    ep.lines.forEach((line, idx) => {
      const passed = passedSet.has(idx);
      const unlocked = isLineUnlocked(ep.id, idx);
      const item = document.createElement("div");
      item.className =
        "line-item" +
        (idx === currentLineIndex ? " active" : "") +
        (passed ? " passed" : "") +
        (!unlocked ? " locked" : "");

      const previewText = passed
        ? line.en
        : unlocked
        ? isCompanionMode(ep)
          ? `🎧 쿠팡플레이 ${formatClock(line.start + sync)} 구간 듣고 받아쓰기`
          : "🎧 대사를 듣고 받아쓰기를 통과해 보세요"
        : "🔒 이전 대사를 통과하면 열립니다";

      const timeStr = isCompanionMode(ep)
        ? formatClock(line.start + sync)
        : formatSec(line.start);

      item.innerHTML = `
        <div class="line-num">${passed ? "✓" : idx + 1}</div>
        <div class="line-info">
          <div class="line-meta">
            <span>${escapeHtml(line.speaker)}</span>
            <span>${timeStr}</span>
          </div>
          <div class="line-preview">${escapeHtml(previewText)}</div>
        </div>
      `;

      item.addEventListener("click", () => {
        if (!isLineUnlocked(ep.id, idx)) return;
        selectLine(idx, !isCompanionMode(ep));
      });

      elTimelineList.appendChild(item);
    });
  }

  function renderWordSlots() {
    const ep = getCurrentEpisode();
    const line = getCurrentLine();
    if (!ep || !line) return;

    const words = getDisplayWords(line.en);
    const isPassed = getEpisodePassedSet(ep.id).has(currentLineIndex);

    elWordCountInfo.textContent = `(총 ${words.length}단어)`;
    elWordSlots.innerHTML = "";

    words.forEach((w, idx) => {
      const chip = document.createElement("span");
      if (isPassed || lastMatchedDisplaySet.has(idx)) {
        chip.className = "word-chip correct";
        chip.textContent = w;
      } else if (revealedWordIndices.has(idx)) {
        chip.className = "word-chip hinted";
        chip.textContent = w;
      } else if (showFirstLetterHint) {
        const clean = cleanWord(w);
        const firstChar = w[0] || "";
        const maskLen = Math.max(1, clean.length - 1);
        chip.className = "word-chip" + (hasAttemptedCurrent ? " wrong" : "");
        chip.textContent = firstChar + "_".repeat(maskLen);
      } else {
        const clean = cleanWord(w);
        chip.className = "word-chip" + (hasAttemptedCurrent ? " wrong" : "");
        chip.textContent = "_".repeat(Math.max(2, clean.length));
      }
      elWordSlots.appendChild(chip);
    });
  }

  function renderStudySection() {
    const ep = getCurrentEpisode();
    const line = getCurrentLine();
    if (!ep || !line) return;

    const isPassed = getEpisodePassedSet(ep.id).has(currentLineIndex);
    if (!isPassed) {
      elStudySection.classList.remove("unlocked");
      return;
    }

    elStudySection.classList.add("unlocked");
    elAnswerEn.textContent = line.en;
    elAnswerKo.textContent = line.ko || "";

    if (line.pronunciation) {
      elPronunciationTip.style.display = "block";
      elPronunciationTip.innerHTML = `<strong>🗣️ 원어민 발음 · 연음 포인트:</strong> ${escapeHtml(line.pronunciation)}`;
    } else {
      elPronunciationTip.style.display = "none";
    }

    elVocabList.innerHTML = "";
    const vocabArr = line.vocab || [];
    if (vocabArr.length === 0) {
      elVocabList.innerHTML = `<div style="font-size:13px; color:var(--text-secondary);">이 대사는 기본 일상 어휘 중심입니다. 원어민의 억양과 강세 리듬에 집중해 복습해 보세요!</div>`;
    } else {
      vocabArr.forEach((v) => {
        const saved = isVocabSaved(v.term);
        const typeClass =
          v.type === "idiom"
            ? "type-idiom"
            : v.type === "phrasal"
            ? "type-phrasal"
            : v.type === "slang"
            ? "type-slang"
            : "type-vocab";

        const div = document.createElement("div");
        div.className = "vocab-item";
        div.innerHTML = `
          <div class="vocab-head">
            <div class="vocab-term-wrap">
              <span class="vocab-term">${escapeHtml(v.term)}</span>
              <span class="type-tag ${typeClass}">${escapeHtml(v.typeLabel || "표현")}</span>
            </div>
            <button class="btn btn-sm btn-save-vocab ${saved ? "btn-toggle active" : ""}">
              ${saved ? "★ 저장됨" : "☆ 단어장 저장"}
            </button>
          </div>
          <div class="vocab-meaning">${escapeHtml(v.meaning)}</div>
          <div class="vocab-nuance">${escapeHtml(v.nuance || "")}</div>
          ${v.example ? `<div class="vocab-example">Ex) "${escapeHtml(v.example)}"</div>` : ""}
        `;

        div.querySelector(".btn-save-vocab").addEventListener("click", () => {
          toggleSaveVocab(v, ep.show, line.en);
          renderStudySection();
        });

        elVocabList.appendChild(div);
      });
    }

    const g = line.grammar || { title: "핵심 구문 분석", desc: "" };
    elGrammarTitle.textContent = g.title;
    elGrammarDesc.textContent = g.desc;

    const btnSaveGrammar = document.getElementById("btnSaveStudioGrammar");
    if (btnSaveGrammar) {
      const gSaved = savedVocab.some(
        (item) => item.kind === "grammar" && item.term === g.title && item.sentence === line.en
      );
      btnSaveGrammar.textContent = gSaved ? "★ 문법 저장됨" : "☆ 문법 저장";
      btnSaveGrammar.classList.toggle("btn-toggle", gSaved);
      btnSaveGrammar.classList.toggle("active", gSaved);
      btnSaveGrammar.onclick = () => {
        toggleSaveVocab(
          {
            kind: "grammar",
            term: g.title,
            typeLabel: "문법 포인트",
            meaning: g.desc,
            nuance: line.ko ? `해석: ${line.ko}` : "",
            example: line.en
          },
          ep.show,
          line.en
        );
        renderStudySection();
      };
    }
  }

  function renderCurrentLine() {
    const ep = getCurrentEpisode();
    const line = getCurrentLine();
    if (!ep || !line) return;

    const isPassed = getEpisodePassedSet(ep.id).has(currentLineIndex);

    elLineStepBadge.textContent = `Line ${currentLineIndex + 1} / ${ep.lines.length}`;
    elSpeakerChip.textContent = `🎙️ ${line.speaker}`;
    elSceneContextNote.textContent = line.context || ep.summary || "";

    showFirstLetterHint = false;
    revealedWordIndices = new Set();
    lastMatchedDisplaySet = new Set();
    hasAttemptedCurrent = false;

    if (isPassed) {
      elDictationInput.value = line.en;
      elDictationInput.classList.add("passed-input");
      elBtnNextLine.style.display =
        currentLineIndex < ep.lines.length - 1 ? "inline-flex" : "none";
      showBanner(
        "success",
        currentLineIndex < ep.lines.length - 1
          ? "🎉 통과 완료! 아래 단어·숙어·문법 해설을 학습한 뒤 Enter를 눌러 다음 대사로 넘어가세요."
          : "🏆 이 에피소드의 모든 대사 받아쓰기를 완주했습니다! 축하합니다!",
        "100% 완료"
      );
    } else {
      elDictationInput.value = "";
      elDictationInput.classList.remove("passed-input");
      elBtnNextLine.style.display = "none";
      hideBanner();
    }

    renderLeftConsole();
    renderWordSlots();
    renderStudySection();
    renderTimeline();
    renderEpisodeBar();
    elDictationInput.focus();
  }

  function showBanner(kind, message, rightInfo) {
    elFeedbackBanner.className = `feedback-banner show ${kind}`;
    elFeedbackText.textContent = message;
    elFeedbackAccuracy.textContent = rightInfo || "";
  }

  function hideBanner() {
    elFeedbackBanner.className = "feedback-banner";
  }

  // ==================== Actions ====================
  function selectEpisode(epIdx) {
    clearSegmentTimers();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    if (ytReady && ytPlayer && typeof ytPlayer.pauseVideo === "function") {
      try {
        ytPlayer.pauseVideo();
      } catch (_) {}
    }

    currentEpIndex = epIdx;
    const ep = getCurrentEpisode();
    const passedSet = getEpisodePassedSet(ep.id);

    let firstUnpassed = 0;
    for (let i = 0; i < ep.lines.length; i++) {
      if (!passedSet.has(i)) {
        firstUnpassed = i;
        break;
      }
    }
    currentLineIndex = firstUnpassed;

    if (!isCompanionMode(ep) && ytReady && ytPlayer && typeof ytPlayer.cueVideoById === "function") {
      ytPlayer.cueVideoById({
        videoId: ep.videoId,
        startSeconds: Math.max(0, ep.lines[currentLineIndex].start - 0.08)
      });
    }

    renderCurrentLine();
  }

  function selectLine(lineIdx, autoPlay) {
    clearSegmentTimers();
    currentLineIndex = lineIdx;
    renderCurrentLine();
    if (autoPlay && !isCompanionMode(getCurrentEpisode())) {
      playCurrentSegment();
    }
  }

  function handleCheckOrAdvance() {
    const ep = getCurrentEpisode();
    const line = getCurrentLine();
    if (!ep || !line) return;

    const isAlreadyPassed = getEpisodePassedSet(ep.id).has(currentLineIndex);
    if (isAlreadyPassed) {
      goToNextLine();
      return;
    }

    const userText = elDictationInput.value.trim();
    if (!userText) {
      if (!isCompanionMode(ep)) {
        playCurrentSegment();
      }
      showBanner(
        "retry",
        isCompanionMode(ep)
          ? "🎧 쿠팡플레이 창에서 안내된 타임코드 구간을 듣고 들리는 만큼 입력해 보세요!"
          : "🎧 먼저 대사를 듣고 들리는 만큼 입력해 보세요!",
        ""
      );
      return;
    }

    hasAttemptedCurrent = true;
    const result = gradeDictation(line.en, userText);
    lastMatchedDisplaySet = result.matchedDisplayIndices;

    if (result.passed) {
      clearSegmentTimers();
      markLinePassed(ep.id, currentLineIndex);
      elDictationInput.classList.add("passed-input");
      elBtnNextLine.style.display =
        currentLineIndex < ep.lines.length - 1 ? "inline-flex" : "none";

      const msg =
        result.accuracy === 100
          ? "🎉 완벽합니다! 대사 받아쓰기를 통과했습니다. 아래 표현·문법 해설을 확인하세요!"
          : "✨ 아주 잘 들으셨습니다! 핵심 대사를 통과했습니다. 원문 철자와 해설을 함께 확인해 보세요!";
      showBanner("success", msg, `정확도 ${result.accuracy}%`);

      renderWordSlots();
      renderStudySection();
      renderTimeline();
      renderEpisodeBar();
    } else {
      renderWordSlots();
      showBanner(
        "retry",
        `아직 안 들린 부분이 있어요! (${result.matchedWordsCount}/${result.totalWords} 단어 일치) — 초록색 단어를 참고해 다시 들어보세요.`,
        `정확도 ${result.accuracy}%`
      );
      if (!isCompanionMode(ep)) {
        playCurrentSegment();
      }
    }
  }

  function goToNextLine() {
    const ep = getCurrentEpisode();
    if (!ep) return;
    if (currentLineIndex < ep.lines.length - 1) {
      selectLine(currentLineIndex + 1, !isCompanionMode(ep));
    }
  }

  // ==================== Saved Vocabulary & Notion Real-Time Sync ====================
  function extractWebNotionUuid(raw) {
    const cleanPath = String(raw || "").trim().split("?")[0].split("#")[0];
    const matches = cleanPath.replace(/-/g, "").match(/[0-9a-fA-F]{32}/g);
    if (!matches || !matches.length) return "";
    const hex = matches[matches.length - 1].toLowerCase();
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  async function webNotionProxy(token, method, path, body) {
    const resp = await fetch("/api/notion-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, method, path, body })
    });
    return await resp.json();
  }

  function desiredWebNotionColumns() {
    return {
      "구분": {
        select: {
          options: [
            { name: "구동사", color: "purple" },
            { name: "관용어/슬랭", color: "pink" },
            { name: "핵심 어휘", color: "blue" },
            { name: "문법 포인트", color: "yellow" },
            { name: "표현", color: "default" }
          ]
        }
      },
      "뜻 · 해설": { rich_text: {} },
      "뉘앙스 · 해석": { rich_text: {} },
      "원문 대사": { rich_text: {} },
      "작품명": { rich_text: {} },
      "저장일": { date: {} },
      "암기 완료": { checkbox: {} }
    };
  }

  async function inspectWebNotionDb(token, dbId, dbObjOverride) {
    const dbRes = dbObjOverride
      ? { ok: true, data: dbObjOverride }
      : await webNotionProxy(token, "GET", `/databases/${dbId}`);
    if (!dbRes.ok || !dbRes.data || dbRes.data.archived || dbRes.data.in_trash) return null;

    const props = dbRes.data.properties || {};
    let titlePropName = "표현 / 문법";
    Object.keys(props).forEach((k) => {
      if (props[k] && props[k].type === "title") titlePropName = k;
    });

    const desired = desiredWebNotionColumns();
    const missing = {};
    let hasMissing = false;
    Object.keys(desired).forEach((col) => {
      if (!props[col]) {
        missing[col] = desired[col];
        hasMissing = true;
      }
    });
    if (hasMissing) {
      await webNotionProxy(token, "PATCH", `/databases/${dbId}`, { properties: missing });
    }
    const titleArr = Array.isArray(dbRes.data.title) ? dbRes.data.title : [];
    const dbTitle = titleArr.map((t) => t.plain_text || "").join("").trim() || "📚 넷플릭스 영어 단어 · 문법장";
    return { databaseId: dbRes.data.id, titlePropName, dbTitle };
  }

  async function ensureWebNotionDb(token, targetUrl, cachedDbId) {
    const defaultTitle = "📚 넷플릭스 영어 단어 · 문법장";
    if (cachedDbId) {
      const cleanCached = extractWebNotionUuid(cachedDbId);
      if (cleanCached) {
        const ready = await inspectWebNotionDb(token, cleanCached);
        if (ready) return ready;
      }
    }
    const uuid = extractWebNotionUuid(targetUrl);
    if (!uuid) {
      throw new Error("노션 페이지 링크(URL)에서 32자리 ID를 찾지 못했습니다.");
    }

    const asDb = await webNotionProxy(token, "GET", `/databases/${uuid}`);
    if (asDb.ok && asDb.data && !asDb.data.archived) {
      const ready = await inspectWebNotionDb(token, uuid, asDb.data);
      if (ready) return ready;
    }
    if (asDb.status === 401) {
      throw new Error("노션 API 토큰이 올바르지 않습니다.");
    }

    const asPage = await webNotionProxy(token, "GET", `/pages/${uuid}`);
    if (asPage.status === 401) throw new Error("노션 API 토큰이 올바르지 않습니다.");
    if (!asPage.ok) {
      throw new Error("노션 페이지에 접근할 수 없습니다! 페이지 우측 상단 [•••] → [연결]에서 통합을 먼저 추가해 주세요.");
    }

    const children = await webNotionProxy(token, "GET", `/blocks/${uuid}/children?page_size=50`);
    if (children.ok && Array.isArray(children.data?.results)) {
      const existing = children.data.results.find(
        (b) =>
          b &&
          b.type === "child_database" &&
          !b.archived &&
          b.child_database &&
          /단어.*문법장|Dictation/i.test(b.child_database.title || "")
      );
      if (existing) {
        const reused = await inspectWebNotionDb(token, existing.id);
        if (reused) return reused;
      }
    }

    const created = await webNotionProxy(token, "POST", "/databases", {
      parent: { type: "page_id", page_id: uuid },
      title: [{ type: "text", text: { content: defaultTitle } }],
      properties: Object.assign({ "표현 / 문법": { title: {} } }, desiredWebNotionColumns())
    });
    if (!created.ok) {
      throw new Error(created.data?.message || "노션 표 자동 생성 실패");
    }
    return { databaseId: created.data.id, titlePropName: "표현 / 문법", dbTitle: defaultTitle };
  }

  async function pushWebVocabItemToNotion(token, dbInfo, item) {
    const cat = String(item.kind === "grammar" ? "문법 포인트" : (item.typeLabel || "표현"))
      .replace(/,/g, "·")
      .slice(0, 80);
    const sentenceVal = item.sentence || item.example || "";
    const isoDate = (item.savedAt || new Date().toISOString()).slice(0, 10);

    const res = await webNotionProxy(token, "POST", "/pages", {
      parent: { database_id: dbInfo.databaseId },
      properties: {
        [dbInfo.titlePropName]: { title: [{ text: { content: String(item.term || "").slice(0, 300) } }] },
        "구분": { select: { name: cat || "표현" } },
        "뜻 · 해설": { rich_text: item.meaning ? [{ text: { content: String(item.meaning).slice(0, 1900) } }] : [] },
        "뉘앙스 · 해석": { rich_text: item.nuance ? [{ text: { content: String(item.nuance).slice(0, 1900) } }] : [] },
        "원문 대사": { rich_text: sentenceVal ? [{ text: { content: String(sentenceVal).slice(0, 1900) } }] : [] },
        "작품명": { rich_text: item.show ? [{ text: { content: String(item.show).slice(0, 300) } }] : [] },
        "저장일": { date: { start: isoDate } },
        "암기 완료": { checkbox: false }
      }
    });
    if (!res.ok) {
      throw new Error(res.data?.message || `노션 저장 오류 (${res.status})`);
    }
    return res.data.id;
  }

  function refreshWebNotionStatusUI() {
    const badge = document.getElementById("webNotionStatusBadge");
    const bulkBtn = document.getElementById("btnWebNotionBulkSync");
    const tokenIn = document.getElementById("webNotionTokenInput");
    const urlIn = document.getElementById("webNotionUrlInput");
    const autoChk = document.getElementById("webNotionAutoCheck");

    if (tokenIn && document.activeElement !== tokenIn) tokenIn.value = webNotionCfg.token || "";
    if (urlIn && document.activeElement !== urlIn) urlIn.value = webNotionCfg.targetUrl || "";
    if (autoChk) autoChk.checked = webNotionCfg.autoSync !== false;

    const connected = Boolean(webNotionCfg.token && webNotionCfg.targetUrl);
    if (badge) {
      badge.textContent = connected
        ? `🟢 연결됨 (${webNotionCfg.dbTitle || "실시간 자동저장 ON"})`
        : "⚪ 미연결";
      badge.style.color = connected ? "#6ee7b7" : "#94a3b8";
    }
    if (bulkBtn) {
      const unsynced = savedVocab.filter((x) => !x.notionPageId).length;
      bulkBtn.style.display = connected && unsynced > 0 ? "inline-flex" : "none";
      bulkBtn.textContent = `🔄 미전송분 일괄 동기화(${unsynced})`;
    }
  }

  function isVocabSaved(term) {
    return savedVocab.some((item) => item.kind !== "grammar" && item.term === term);
  }

  function toggleSaveVocab(vocabObj, showName, sentenceContext) {
    const isGrammar = vocabObj.kind === "grammar";
    const idx = savedVocab.findIndex((item) =>
      isGrammar
        ? item.kind === "grammar" && item.term === vocabObj.term && item.sentence === sentenceContext
        : item.kind !== "grammar" && item.term === vocabObj.term
    );
    if (idx >= 0) {
      const removed = savedVocab.splice(idx, 1)[0];
      if (removed && removed.notionPageId && webNotionCfg.token) {
        webNotionProxy(webNotionCfg.token, "PATCH", `/pages/${removed.notionPageId}`, { archived: true }).catch(() => {});
      }
    } else {
      const newEntry = {
        ...vocabObj,
        show: showName,
        sentence: sentenceContext || vocabObj.example || "",
        savedAt: new Date().toISOString()
      };
      savedVocab.unshift(newEntry);

      if (webNotionCfg.token && webNotionCfg.targetUrl && webNotionCfg.autoSync !== false) {
        (async () => {
          try {
            const dbInfo = await ensureWebNotionDb(
              webNotionCfg.token,
              webNotionCfg.targetUrl,
              webNotionCfg.databaseId
            );
            const pageId = await pushWebVocabItemToNotion(webNotionCfg.token, dbInfo, newEntry);
            newEntry.notionPageId = pageId;
            if (dbInfo.databaseId !== webNotionCfg.databaseId) {
              webNotionCfg.databaseId = dbInfo.databaseId;
              webNotionCfg.dbTitle = dbInfo.dbTitle;
              saveJSON(STORAGE_NOTION_KEY, webNotionCfg);
            }
            saveJSON(STORAGE_VOCAB_KEY, savedVocab);
            refreshWebNotionStatusUI();
            showBanner("success", `📓 '${newEntry.term}' 항목이 노션 단어장에 실시간 자동 저장되었습니다!`, "노션 동기화됨");
          } catch (err) {
            showBanner("retry", `⚠️ 노션 자동저장 실패: ${err.message || err}`, "");
          }
        })();
      }
    }
    saveJSON(STORAGE_VOCAB_KEY, savedVocab);
    updateSavedVocabCounter();
    refreshWebNotionStatusUI();
  }

  function updateSavedVocabCounter() {
    elSavedVocabCount.textContent = String(savedVocab.length);
  }

  function renderSavedVocabModal() {
    refreshWebNotionStatusUI();
    const container = document.getElementById("savedVocabList");
    if (savedVocab.length === 0) {
      container.innerHTML = `<p style="color:var(--text-secondary); font-size:14px;">아직 저장한 단어·숙어·문법이 없습니다. 대사를 통과한 뒤 '☆ 단어장 저장' 또는 '☆ 문법 저장' 버튼을 눌러 나만의 미드 표현장을 만들어 보세요!</p>`;
      return;
    }

    container.innerHTML = "";
    savedVocab.forEach((v) => {
      const card = document.createElement("div");
      card.className = "vocab-item";
      card.innerHTML = `
        <div class="vocab-head">
          <div class="vocab-term-wrap">
            <span class="vocab-term">${v.kind === "grammar" ? "🧩 " : ""}${escapeHtml(v.term)}</span>
            <span class="show-badge">${escapeHtml(v.show || "Sitcom")}</span>
            ${v.notionPageId ? `<span style="font-size:11px; color:#6ee7b7; font-weight:700;">📓 노션됨</span>` : ""}
          </div>
          <button class="btn btn-sm">삭제</button>
        </div>
        <div class="vocab-meaning">${escapeHtml(v.meaning)}</div>
        <div class="vocab-nuance">${escapeHtml(v.nuance || "")}</div>
        ${v.sentence || v.example ? `<div class="vocab-example">"${escapeHtml(v.sentence || v.example)}"</div>` : ""}
      `;
      card.querySelector("button").addEventListener("click", () => {
        toggleSaveVocab(v, v.show, v.sentence);
        renderSavedVocabModal();
        renderStudySection();
      });
      container.appendChild(card);
    });
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function extractYouTubeId(input) {
    const trimmed = input.trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
    const m = trimmed.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  // ==================== Event Bindings ====================
  function bindEvents() {
    // Mode Filter Tabs
    document.querySelectorAll(".mode-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        currentModeFilter = tab.dataset.modeFilter;
        document.querySelectorAll(".mode-tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");

        if (currentModeFilter === "kindle") {
          enterKindleModeUI();
          return;
        }

        exitKindleModeUI();
        const currEp = getCurrentEpisode();
        const currMode = isCompanionMode(currEp) ? "companion" : "youtube";
        if (currentModeFilter !== "all" && currMode !== currentModeFilter) {
          const matchIdx = episodes.findIndex((e) =>
            currentModeFilter === "companion" ? isCompanionMode(e) : !isCompanionMode(e)
          );
          if (matchIdx >= 0) {
            selectEpisode(matchIdx);
            return;
          }
        }
        renderEpisodeBar();
        renderCurrentLine();
      });
    });

    // Coupang Play Split Popup Launcher
    document.getElementById("btnLaunchCoupangSplit").addEventListener("click", () => {
      const ep = getCurrentEpisode();
      const targetUrl = (ep && ep.ottUrl) || "https://www.coupangplay.com";
      const halfW = Math.max(520, Math.floor((window.screen.availWidth || 1440) * 0.48));
      const fullH = Math.max(700, (window.screen.availHeight || 900) - 40);
      window.open(
        targetUrl,
        "CoupangPlayCompanionWindow",
        `left=0,top=0,width=${halfW},height=${fullH},menubar=no,toolbar=yes,location=yes,status=no,resizable=yes,scrollbars=yes`
      );
    });

    // Sync Offset Controls
    document.querySelectorAll(".sync-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const ep = getCurrentEpisode();
        if (!ep) return;
        adjustEpisodeSyncOffset(ep.id, parseFloat(btn.dataset.sync));
        renderLeftConsole();
        renderTimeline();
      });
    });

    elBtnSyncReset.addEventListener("click", () => {
      const ep = getCurrentEpisode();
      if (!ep) return;
      syncOffsets[ep.id] = 0;
      saveJSON(STORAGE_SYNC_KEY, syncOffsets);
      renderLeftConsole();
      renderTimeline();
    });

    // Auxiliary Native TTS Buttons
    document.getElementById("btnTtsNormal").addEventListener("click", () => speakAuxiliaryEnglish(1.0));
    document.getElementById("btnTtsSlow").addEventListener("click", () => speakAuxiliaryEnglish(0.72));

    document.getElementById("btnPlaySegment").addEventListener("click", playCurrentSegment);
    document.getElementById("btnReplayFromAnswer").addEventListener("click", playCurrentSegment);

    const btnAutoLoop = document.getElementById("btnAutoLoop");
    btnAutoLoop.addEventListener("click", () => {
      autoLoop = !autoLoop;
      btnAutoLoop.textContent = `🔁 구간 반복: ${autoLoop ? "ON" : "OFF"}`;
      btnAutoLoop.classList.toggle("active", autoLoop);
      if (autoLoop) playCurrentSegment();
    });

    const btnToggleShield = document.getElementById("btnToggleShield");
    btnToggleShield.addEventListener("click", () => {
      const visible = elSubtitleShield.classList.toggle("visible");
      btnToggleShield.classList.toggle("active", visible);
    });

    const btnFreeMode = document.getElementById("btnFreeMode");
    btnFreeMode.addEventListener("click", () => {
      freeMode = !freeMode;
      btnFreeMode.textContent = `🔓 자유 이동 모드: ${freeMode ? "ON" : "OFF"}`;
      btnFreeMode.classList.toggle("active", freeMode);
      renderTimeline();
    });

    document.querySelectorAll(".speed-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        playbackSpeed = parseFloat(btn.dataset.speed);
        document.querySelectorAll(".speed-btn").forEach((b) => {
          b.classList.remove("btn-toggle", "active");
        });
        btn.classList.add("btn-toggle", "active");
        if (ytReady && ytPlayer && typeof ytPlayer.setPlaybackRate === "function") {
          ytPlayer.setPlaybackRate(playbackSpeed);
        }
        playCurrentSegment();
      });
    });

    const btnStartMinus = document.getElementById("btnStartMinus");
    const btnStartPlus = document.getElementById("btnStartPlus");
    if (btnStartMinus) {
      btnStartMinus.addEventListener("click", () => {
        startOffsetSec = Math.max(-1.2, Math.round((startOffsetSec - 0.2) * 10) / 10);
        if (elStartOffsetLabel) {
          elStartOffsetLabel.textContent = `${startOffsetSec > 0 ? "+" : ""}${startOffsetSec.toFixed(1)}s`;
        }
        const line = getCurrentLine();
        if (line) {
          elSegmentTimeLabel.textContent = `${formatSec(Math.max(0, line.start + startOffsetSec))} ~ ${formatSec(line.end + endOffsetSec)}`;
        }
        playCurrentSegment();
      });
    }
    if (btnStartPlus) {
      btnStartPlus.addEventListener("click", () => {
        startOffsetSec = Math.min(1.4, Math.round((startOffsetSec + 0.2) * 10) / 10);
        if (elStartOffsetLabel) {
          elStartOffsetLabel.textContent = `${startOffsetSec > 0 ? "+" : ""}${startOffsetSec.toFixed(1)}s`;
        }
        const line = getCurrentLine();
        if (line) {
          elSegmentTimeLabel.textContent = `${formatSec(Math.max(0, line.start + startOffsetSec))} ~ ${formatSec(line.end + endOffsetSec)}`;
        }
        playCurrentSegment();
      });
    }

    document.getElementById("btnExtendMinus").addEventListener("click", () => {
      endOffsetSec = Math.max(-0.9, Math.round((endOffsetSec - 0.3) * 10) / 10);
      elEndOffsetLabel.textContent = `${endOffsetSec >= 0 ? "+" : ""}${endOffsetSec.toFixed(1)}s`;
      const line = getCurrentLine();
      if (line) elSegmentTimeLabel.textContent = `${formatSec(Math.max(0, line.start + startOffsetSec))} ~ ${formatSec(line.end + endOffsetSec)}`;
      playCurrentSegment();
    });

    document.getElementById("btnExtendPlus").addEventListener("click", () => {
      endOffsetSec = Math.min(2.4, Math.round((endOffsetSec + 0.3) * 10) / 10);
      elEndOffsetLabel.textContent = `${endOffsetSec >= 0 ? "+" : ""}${endOffsetSec.toFixed(1)}s`;
      const line = getCurrentLine();
      if (line) elSegmentTimeLabel.textContent = `${formatSec(Math.max(0, line.start + startOffsetSec))} ~ ${formatSec(line.end + endOffsetSec)}`;
      playCurrentSegment();
    });

    document.getElementById("btnResetEpisode").addEventListener("click", () => {
      const ep = getCurrentEpisode();
      if (!ep) return;
      if (confirm(`'${ep.title}'의 받아쓰기 통과 기록을 초기화할까요?`)) {
        progressMap[ep.id] = [];
        saveJSON(STORAGE_PROGRESS_KEY, progressMap);
        selectLine(0, false);
      }
    });

    // Hints & Give Up
    document.getElementById("btnHintLetters").addEventListener("click", () => {
      showFirstLetterHint = true;
      renderWordSlots();
      elDictationInput.focus();
    });

    document.getElementById("btnHintOneWord").addEventListener("click", () => {
      const line = getCurrentLine();
      if (!line) return;
      const words = getDisplayWords(line.en);
      for (let idx = 0; idx < words.length; idx++) {
        if (!lastMatchedDisplaySet.has(idx) && !revealedWordIndices.has(idx)) {
          revealedWordIndices.add(idx);
          break;
        }
      }
      renderWordSlots();
      elDictationInput.focus();
    });

    document.getElementById("btnGiveUp").addEventListener("click", () => {
      const ep = getCurrentEpisode();
      const line = getCurrentLine();
      if (!ep || !line) return;
      clearSegmentTimers();
      markLinePassed(ep.id, currentLineIndex);
      elDictationInput.value = line.en;
      elDictationInput.classList.add("passed-input");
      elBtnNextLine.style.display =
        currentLineIndex < ep.lines.length - 1 ? "inline-flex" : "none";
      showBanner(
        "success",
        "📖 정답과 해설을 열었습니다! 원어민 음성을 다시 들으며 연음과 핵심 표현·문법을 익힌 뒤 다음 대사로 넘어가세요.",
        "학습 완료"
      );
      renderWordSlots();
      renderStudySection();
      renderTimeline();
      renderEpisodeBar();
    });

    elBtnCheckAnswer.addEventListener("click", handleCheckOrAdvance);
    elBtnNextLine.addEventListener("click", goToNextLine);

    elDictationInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleCheckOrAdvance();
      }
    });

    window.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.code === "Space") {
        e.preventDefault();
        playCurrentSegment();
      } else if (e.altKey && e.code === "KeyH") {
        e.preventDefault();
        showFirstLetterHint = true;
        renderWordSlots();
      }
    });

    // Vocab Modal
    const vocabModal = document.getElementById("vocabModal");
    document.getElementById("btnOpenVocabModal").addEventListener("click", () => {
      renderSavedVocabModal();
      vocabModal.classList.add("open");
    });
    document.getElementById("btnCloseVocabModal").addEventListener("click", () => {
      vocabModal.classList.remove("open");
    });

    const webNotionAutoCheck = document.getElementById("webNotionAutoCheck");
    if (webNotionAutoCheck) {
      webNotionAutoCheck.addEventListener("change", (e) => {
        webNotionCfg.autoSync = Boolean(e.target.checked);
        saveJSON(STORAGE_NOTION_KEY, webNotionCfg);
        refreshWebNotionStatusUI();
      });
    }

    const btnWebNotionConnect = document.getElementById("btnWebNotionConnect");
    if (btnWebNotionConnect) {
      btnWebNotionConnect.addEventListener("click", async () => {
        const tokenVal = String(document.getElementById("webNotionTokenInput").value || "").trim().replace(/\s+/g, "");
        const urlVal = String(document.getElementById("webNotionUrlInput").value || "").trim();
        const msgEl = document.getElementById("webNotionMsg");
        if (!tokenVal || !urlVal) {
          msgEl.style.color = "#fca5a5";
          msgEl.textContent = "⚠️ 노션 API 토큰과 노션 페이지 링크를 모두 입력해 주세요.";
          return;
        }
        btnWebNotionConnect.disabled = true;
        btnWebNotionConnect.textContent = "연결 확인 중...";
        msgEl.style.color = "#93c5fd";
        msgEl.textContent = "노션 페이지 권한 확인 및 단어·문법장 표 준비 중...";
        try {
          const dbInfo = await ensureWebNotionDb(
            tokenVal,
            urlVal,
            urlVal === webNotionCfg.targetUrl ? webNotionCfg.databaseId : ""
          );
          webNotionCfg = {
            token: tokenVal,
            targetUrl: urlVal,
            databaseId: dbInfo.databaseId,
            dbTitle: dbInfo.dbTitle,
            autoSync: Boolean(document.getElementById("webNotionAutoCheck").checked)
          };
          saveJSON(STORAGE_NOTION_KEY, webNotionCfg);
          refreshWebNotionStatusUI();
          msgEl.style.color = "#6ee7b7";
          msgEl.textContent = `✓ 연결 성공! '${dbInfo.dbTitle}'에 실시간 자동 저장됩니다.`;
        } catch (err) {
          msgEl.style.color = "#fca5a5";
          msgEl.textContent = `⚠️ ${err.message || "연결 실패 ('실행하기.bat' 서버 실행 여부를 확인해 주세요)"}`;
        } finally {
          btnWebNotionConnect.disabled = false;
          btnWebNotionConnect.textContent = "🔌 연결 & 노션 표 자동 생성";
        }
      });
    }

    const btnWebNotionBulkSync = document.getElementById("btnWebNotionBulkSync");
    if (btnWebNotionBulkSync) {
      btnWebNotionBulkSync.addEventListener("click", async () => {
        const msgEl = document.getElementById("webNotionMsg");
        const unsyncedIndices = [];
        savedVocab.forEach((item, idx) => {
          if (!item.notionPageId) unsyncedIndices.push(idx);
        });
        if (!unsyncedIndices.length) return;
        btnWebNotionBulkSync.disabled = true;
        btnWebNotionBulkSync.textContent = "전송 중...";
        try {
          const dbInfo = await ensureWebNotionDb(
            webNotionCfg.token,
            webNotionCfg.targetUrl,
            webNotionCfg.databaseId
          );
          for (let k = unsyncedIndices.length - 1; k >= 0; k--) {
            const idx = unsyncedIndices[k];
            const pageId = await pushWebVocabItemToNotion(webNotionCfg.token, dbInfo, savedVocab[idx]);
            savedVocab[idx].notionPageId = pageId;
          }
          saveJSON(STORAGE_VOCAB_KEY, savedVocab);
          renderSavedVocabModal();
          msgEl.style.color = "#6ee7b7";
          msgEl.textContent = `✓ 총 ${unsyncedIndices.length}개 항목을 노션 단어장으로 일괄 전송 완료했습니다!`;
        } catch (err) {
          msgEl.style.color = "#fca5a5";
          msgEl.textContent = `⚠️ 일괄 전송 오류: ${err.message || err}`;
        } finally {
          btnWebNotionBulkSync.disabled = false;
          refreshWebNotionStatusUI();
        }
      });
    }

    // SRT / Script Companion Modal
    const srtModal = document.getElementById("srtModal");
    const srtFileInput = document.getElementById("srtFileInput");
    const srtRawTextarea = document.getElementById("srtRawTextarea");
    const srtShowInput = document.getElementById("srtShowInput");
    const srtTitleInput = document.getElementById("srtTitleInput");
    const srtStatusMsg = document.getElementById("srtStatusMsg");

    document.getElementById("btnOpenSrtModal").addEventListener("click", () => {
      srtStatusMsg.textContent = "";
      srtFileInput.value = "";
      srtRawTextarea.value = "";
      srtTitleInput.value = "";
      srtModal.classList.add("open");
    });

    document.getElementById("btnCloseSrtModal").addEventListener("click", () => {
      srtModal.classList.remove("open");
    });

    srtFileInput.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (!srtTitleInput.value.trim()) {
        srtTitleInput.value = file.name.replace(/\.[^.]+$/, "");
      }
      const reader = new FileReader();
      reader.onload = function () {
        srtRawTextarea.value = String(reader.result || "");
        srtStatusMsg.textContent = `✓ '${file.name}' 파일을 불러왔습니다. 아래 [병행 학습 코스 생성하기]를 눌러주세요.`;
      };
      reader.readAsText(file, "utf-8");
    });

    document.getElementById("btnCreateSrtCourse").addEventListener("click", () => {
      const raw = srtRawTextarea.value.trim();
      if (!raw) {
        srtStatusMsg.textContent = "⚠️ .srt 자막 파일을 선택하거나 영어 대사 텍스트를 입력해 주세요.";
        return;
      }
      const parsedLines = parseSrtOrPlainText(raw);
      if (parsedLines.length === 0) {
        srtStatusMsg.textContent = "⚠️ 추출 가능한 영어 대사를 찾지 못했습니다.";
        return;
      }

      const showName = srtShowInput.value.trim() || "Friends (쿠팡플레이)";
      const epTitle = srtTitleInput.value.trim() || `쿠팡플레이 병행 에피소드 (${parsedLines.length}문장)`;

      const newCompanionEp = {
        id: `companion-${Date.now()}`,
        mode: "companion",
        ottPlatform: "쿠팡플레이",
        ottUrl: "https://www.coupangplay.com",
        ottGuideTarget: `${showName} → ${epTitle} (자막 '끄기' 권장)`,
        show: showName,
        seasonInfo: "쿠팡플레이 병행",
        title: `[쿠팡플레이 병행] ${epTitle}`,
        difficulty: "커스텀 병행",
        summary: "직접 추가한 쿠팡플레이 병행 학습 코스입니다.",
        lines: parsedLines
      };

      const customEps = loadJSON(STORAGE_CUSTOM_EP_KEY, []);
      customEps.push(newCompanionEp);
      saveJSON(STORAGE_CUSTOM_EP_KEY, customEps);

      episodes.push(newCompanionEp);
      srtModal.classList.remove("open");

      currentModeFilter = "companion";
      document.querySelectorAll(".mode-tab").forEach((t) => {
        t.classList.toggle("active", t.dataset.modeFilter === "companion");
      });
      selectEpisode(episodes.length - 1);
    });

    // YouTube Import Modal
    const importModal = document.getElementById("importModal");
    const importStatusMsg = document.getElementById("importStatusMsg");
    const importUrlInput = document.getElementById("importUrlInput");

    document.getElementById("btnOpenImportModal").addEventListener("click", () => {
      importStatusMsg.textContent = "";
      importUrlInput.value = "";
      importModal.classList.add("open");
    });
    document.getElementById("btnCloseImportModal").addEventListener("click", () => {
      importModal.classList.remove("open");
    });

    document.getElementById("btnRunImport").addEventListener("click", async () => {
      const vid = extractYouTubeId(importUrlInput.value);
      if (!vid) {
        importStatusMsg.textContent = "올바른 유튜브 영상 주소(URL) 또는 11자리 영상 ID를 입력해 주세요.";
        return;
      }
      importStatusMsg.textContent = "유튜브 영상 임베드 가능 여부 및 영어 자막 타임스탬프를 추출하는 중입니다...";
      try {
        const res = await fetch(`/api/import?v=${encodeURIComponent(vid)}`);
        const data = await res.json();
        if (data.error) {
          importStatusMsg.textContent = `⚠️ ${data.error}`;
          return;
        }
        if (!data.lines || data.lines.length === 0) {
          importStatusMsg.textContent = "⚠️ 추출 가능한 영어 대사가 없습니다.";
          return;
        }

        const newEp = {
          id: `custom-${vid}-${Date.now()}`,
          mode: "youtube",
          show: data.channel || "Custom Clip",
          seasonInfo: data.isManualCaption ? "수동 영어자막" : "자동 영어자막",
          title: data.title || `YouTube Clip (${vid})`,
          videoId: vid,
          channel: data.channel || "YouTube",
          difficulty: "커스텀",
          summary: "직접 추가한 유튜브 클립 받아쓰기 코스입니다.",
          lines: data.lines.slice(0, 40)
        };

        const customEps = loadJSON(STORAGE_CUSTOM_EP_KEY, []);
        customEps.push(newEp);
        saveJSON(STORAGE_CUSTOM_EP_KEY, customEps);

        episodes.push(newEp);
        importModal.classList.remove("open");
        selectEpisode(episodes.length - 1);
      } catch (err) {
        importStatusMsg.textContent = "⚠️ 로컬 서버 연결이 필요합니다 ('실행하기.bat'로 실행했는지 확인해 주세요).";
      }
    });
  }

  // ==================== Kindle Reading Companion Engine ====================
  const STORAGE_KINDLE_HISTORY_KEY = "kindle_companion_history_v1";
  const STORAGE_KINDLE_AI_KEY = "kindle_companion_ai_key_v1";
  const STORAGE_KINDLE_BOOK_KEY = "kindle_companion_book_title_v1";
  const STORAGE_KINDLE_AI_CACHE_KEY = "kindle_companion_ai_cache_v1";

  const KINDLE_SAMPLE_PASSAGES = [
    {
      book: "Atomic Habits — James Clear (p. 16)",
      passage:
        "Habits are the compound interest of self-improvement; the same way that money multiplies through compound interest, the effects of your habits multiply as you repeat them.",
      prebuilt: {
        isAi: true,
        koFull:
          "습관은 자기계발의 복리 이자와 같다. 돈이 복리를 통해 불어나는 것과 똑같은 방식으로, 당신의 습관이 내는 효과도 그것을 반복할수록 배가된다.",
        backbone:
          "뼈대 구조: [1절] Habits(S) + are(V) + the compound interest(C) ; [2절] the effects of your habits(S) + multiply(V) + [부사절 as you repeat them]",
        chunks: [
          { en: "Habits are the compound interest", ko: "습관은 복리 이자이다" },
          { en: "of self-improvement;", ko: "자기계발의; (즉, 다시 설명하자면)" },
          { en: "the same way that money multiplies through compound interest,", ko: "돈이 복리를 통해 불어나는 것과 똑같은 방식으로," },
          { en: "the effects of your habits multiply", ko: "당신의 습관이 지닌 효과들도 배로 불어난다" },
          { en: "as you repeat them.", ko: "당신이 그 습관들을 반복함에 따라." }
        ],
        grammarList: [
          {
            title: "세미콜론(;) 부연 대등 연결 & 관계부사 대용 that절 (the same way that ~)",
            desc: "원서에서 세미콜론(;)은 앞 문장의 핵심 비유(습관 = 복리)를 뒷문장에서 구체적 원리로 풀어줄 때 씁니다. 또한 'in the same way that S+V(~하는 것과 똑같은 방식으로)'에서 전치사 in이 생략되어 부사구처럼 문두를 이끕니다."
          },
          {
            title: "비례·시간 접속사 as (as you repeat them)",
            desc: "동사 'multiply(배가되다)'와 함께 쓰인 'as'는 단순 시간이 아니라 '~함에 따라 비례하여(~할수록)'라는 점진적 누적의 뉘앙스를 전달합니다."
          }
        ],
        vocab: [
          { term: "compound interest", typeLabel: "핵심 명사구", meaning: "복리(이자), 눈덩이처럼 불어나는 누적 효과", nuance: "원금뿐 아니라 붙은 이자에 다시 이자가 붙어 기하급수적으로 커지는 현상을 뜻합니다." },
          { term: "self-improvement", typeLabel: "명사", meaning: "자기계발, 자기 발전", nuance: "꾸준한 노력을 통해 스스로의 삶과 역량을 개선하는 일입니다." },
          { term: "multiply", typeLabel: "동사", meaning: "크게 증가하다, 배가되다, 증식하다", nuance: "단순히 조금 늘어나는(increase) 수준이 아니라 곱셈처럼 몇 배로 불어날 때 씁니다." }
        ]
      }
    },
    {
      book: "The Great Gatsby — F. Scott Fitzgerald (Ch. 1)",
      passage:
        "Whenever you feel like criticizing any one, just remember that all the people in this world haven't had the advantages that you've had.",
      prebuilt: {
        isAi: true,
        koFull:
          "누군가를 비판하고 싶은 마음이 들 때마다, 이 세상 모든 사람이 네가 누려온 그런 혜택들을 다 누리며 살지는 못했다는 사실을 기억하렴.",
        backbone:
          "뼈대 구조: [양보·시간 부사절 Whenever ~] , (You) just remember(명령문 본동사 V) + [목적어 명사절 that all the people ~ haven't had the advantages ~]",
        chunks: [
          { en: "Whenever you feel like criticizing any one,", ko: "네가 누군가를 비판하고 싶은 기분이 들 때마다," },
          { en: "just remember", ko: "그저 이 사실만은 꼭 기억하렴" },
          { en: "that all the people in this world haven't had", ko: "이 세상 모든 사람이 다 가졌던 것은 아니라는 점을 (부분부정)" },
          { en: "the advantages that you've had.", ko: "네가 지금껏 누려왔던 그 유리한 환경(혜택)들을." }
        ],
        grammarList: [
          {
            title: "전체어(all / every) + 부정어(not) = 부분부정 ('모두가 ~한 것은 아니다')",
            desc: "원서 독해에서 가장 오역하기 쉬운 핵심 구문입니다! 'all the people ~ haven't had'는 '아무도 못 누렸다(전체부정)'가 아니라 '세상 모든 사람이 다 누린 것은 아니다(누군가는 못 누렸다)'라는 부분부정입니다."
          },
          {
            title: "복합관계부사 Whenever + feel like V-ing (~하고 싶은 마음이 들다)",
            desc: "'Whenever(~할 때는 언제나)'가 시간·조건 부사절을 이끌고, 'feel like + 동명사(-ing)'가 '~하고 싶다'는 내면의 충동을 부드럽게 묘사합니다."
          }
        ],
        vocab: [
          { term: "feel like V-ing", typeLabel: "필수 구문", meaning: "~하고 싶은 기분(마음)이 들다", nuance: "'want to'보다 감성적·순간적으로 어떤 충동이나 기분이 올라올 때 씁니다." },
          { term: "criticize", typeLabel: "동사", meaning: "비판하다, 비난하다, 흠잡다", nuance: "남의 결점이나 잘못을 지적하고 평가하는 행위를 뜻합니다." },
          { term: "advantage", typeLabel: "명사", meaning: "(남보다 유리한) 혜택, 이점, 좋은 배경", nuance: "이 문맥에서는 주인공 닉이 타고난 부유하고 안정적인 가정·교육 배경을 뜻합니다." }
        ]
      }
    },
    {
      book: "Sapiens — Yuval Noah Harari (Part 1)",
      passage:
        " Sapiens can cooperate in extremely flexible ways with countless numbers of strangers, which is why Sapiens rule the world whereas ants eat our leftovers.",
      prebuilt: {
        isAi: true,
        koFull:
          "호모 사피엔스는 셀 수 없이 많은 낯선 사람들과 극도로 유연한 방식으로 협력할 수 있으며, 바로 그것이 개미들은 우리의 남은 음식 찌꺼기를 먹는 반면 사피엔스가 세상을 지배하는 이유이다.",
        backbone:
          "뼈대 구조: Sapiens(S) + can cooperate(V) ~ , which(앞 문장 전체 수식 계속적 관계대명사) + is(V) + why Sapiens rule the world [대조절 whereas ~]",
        chunks: [
          { en: "Sapiens can cooperate", ko: "사피엔스는 협력할 수 있다" },
          { en: "in extremely flexible ways", ko: "극도로 유연한 방식들로" },
          { en: "with countless numbers of strangers,", ko: "셀 수 없이 많은 낯선 타인들과 함께," },
          { en: "which is why Sapiens rule the world", ko: "그리고 바로 그것이 사피엔스가 세상을 지배하는 이유이다" },
          { en: "whereas ants eat our leftovers.", ko: "반면에 개미들은 우리가 남긴 찌꺼기를 먹는 데 비해." }
        ],
        grammarList: [
          {
            title: "앞 문장 전체를 받는 계속적 용법 (, which is why + 결과)",
            desc: "쉼표 뒤의 'which'는 특정 단어 하나가 아니라 앞 문장 전체('낯선 이들과 유연하게 협력할 수 있다는 사실')를 통째로 받아 '그리고 바로 그 때문에 ~한 결과가 나온다'로 자연스럽게 이어줍니다."
          },
          {
            title: "대조 접속사 whereas (~인 반면에)",
            desc: "논픽션 원서에서 두 대상(사피엔스 vs 개미)의 상반된 특성을 선명하게 대조할 때 'while'보다 훨씬 명확한 의미로 쓰이는 접속사입니다."
          }
        ],
        vocab: [
          { term: "cooperate", typeLabel: "동사", meaning: "협력하다, 협동하다", nuance: "공동의 목표를 위해 여러 개체가 힘을 합쳐 일하는 것을 뜻합니다." },
          { term: "countless", typeLabel: "형용사", meaning: "셀 수 없이 많은, 무수한", nuance: "'count(세다) + -less(~할 수 없는)'가 결합된 직관적인 형용사입니다." },
          { term: "leftovers", typeLabel: "명사(복수형)", meaning: "먹다 남은 음식, 찌꺼기", nuance: "보통 복수형 'leftovers'로 쓰여 식사 후 남은 음식을 가리킵니다." }
        ]
      }
    }
  ];

  let kindleAutoWatch = true;
  let kindlePollTimer = null;
  let lastKindleClipHash = "__INIT__";
  let kindleHistory = loadJSON(STORAGE_KINDLE_HISTORY_KEY, []);
  let kindleAiKey = String(localStorage.getItem(STORAGE_KINDLE_AI_KEY) || "").trim();
  let kindleBookTitle = String(localStorage.getItem(STORAGE_KINDLE_BOOK_KEY) || "").trim();
  let kindleAiCacheObj = loadJSON(STORAGE_KINDLE_AI_CACHE_KEY, {});
  let activeKindlePassage = "";
  let cachedKindleGeminiModels = [];

  function enterKindleModeUI() {
    clearSegmentTimers();
    if (ytReady && ytPlayer && typeof ytPlayer.pauseVideo === "function") {
      try { ytPlayer.pauseVideo(); } catch (_) {}
    }
    elEpisodeBar.style.display = "none";
    elYoutubeConsole.style.display = "none";
    elCompanionConsole.classList.remove("active");
    const sitcomTl = document.getElementById("sitcomTimelineWrap");
    const sitcomRight = document.getElementById("sitcomRightArena");
    const kindleLeft = document.getElementById("kindleLeftConsole");
    const kindleRight = document.getElementById("kindleRightArena");

    if (sitcomTl) sitcomTl.style.display = "none";
    if (sitcomRight) sitcomRight.style.display = "none";
    if (kindleLeft) kindleLeft.style.display = "flex";
    if (kindleRight) kindleRight.style.display = "flex";

    const bookIn = document.getElementById("kindleBookTitleInput");
    if (bookIn && kindleBookTitle) bookIn.value = kindleBookTitle;
    const keyIn = document.getElementById("kindleAiKeyInput");
    if (keyIn && kindleAiKey) keyIn.value = kindleAiKey;

    renderKindleHistoryList();
    if (!activeKindlePassage) {
      if (kindleHistory.length > 0) {
        loadKindlePassageItem(kindleHistory[0].passage, kindleHistory[0].book, false);
      } else {
        loadKindleSample(0);
      }
    }
    startKindleClipboardPolling();
  }

  function exitKindleModeUI() {
    stopKindleClipboardPolling();
    elEpisodeBar.style.display = "flex";
    const sitcomTl = document.getElementById("sitcomTimelineWrap");
    const sitcomRight = document.getElementById("sitcomRightArena");
    const kindleLeft = document.getElementById("kindleLeftConsole");
    const kindleRight = document.getElementById("kindleRightArena");

    if (sitcomTl) sitcomTl.style.display = "block";
    if (sitcomRight) sitcomRight.style.display = "flex";
    if (kindleLeft) kindleLeft.style.display = "none";
    if (kindleRight) kindleRight.style.display = "none";
  }

  function startKindleClipboardPolling() {
    stopKindleClipboardPolling();
    lastKindleClipHash = "__INIT__";
    if (!kindleAutoWatch) return;

    const pollOnce = async () => {
      if (currentModeFilter !== "kindle" || !kindleAutoWatch) return;
      try {
        const res = await fetch("/api/kindle-clipboard");
        const snap = await res.json();
        if (!snap || !snap.ok) return;

        if (lastKindleClipHash === "__INIT__") {
          lastKindleClipHash = snap.hash || "";
          return;
        }
        if (!snap.hash || snap.hash === lastKindleClipHash) return;
        lastKindleClipHash = snap.hash;

        if (snap.kind === "text" && snap.text) {
          const parsed = window.KINDLE_ANALYZER
            ? window.KINDLE_ANALYZER.parseKindleClipboardRaw(snap.text)
            : { passage: snap.text, bookMeta: "" };
          if (parsed.passage && parsed.passage.length >= 5) {
            if (parsed.bookMeta) {
              kindleBookTitle = parsed.bookMeta;
              localStorage.setItem(STORAGE_KINDLE_BOOK_KEY, kindleBookTitle);
              const bookIn = document.getElementById("kindleBookTitleInput");
              if (bookIn) bookIn.value = kindleBookTitle;
            }
            loadKindlePassageItem(parsed.passage, kindleBookTitle, true);
          }
        } else if (snap.kind === "image") {
          handleKindleCapturedImage(snap.text || "", snap.imageBase64 || "");
        }
      } catch (_) {}
    };

    pollOnce();
    kindlePollTimer = setInterval(pollOnce, 900);
  }

  function stopKindleClipboardPolling() {
    if (kindlePollTimer) {
      clearInterval(kindlePollTimer);
      kindlePollTimer = null;
    }
  }

  function speakKindlePassage(rate) {
    const txt = (document.getElementById("kindleInputArea")?.value || activeKindlePassage || "").trim();
    if (!txt || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(txt);
    utter.lang = "en-US";
    utter.rate = rate || 1.0;
    const voices = window.speechSynthesis.getVoices();
    const usVoice =
      voices.find((v) => v.lang === "en-US" && /Google|Natural|Aria|Guy|Jenny|Zira/i.test(v.name)) ||
      voices.find((v) => v.lang && v.lang.startsWith("en"));
    if (usVoice) utter.voice = usVoice;
    window.speechSynthesis.speak(utter);
  }

  function pushKindleHistory(passage, book) {
    const cleanP = passage.trim();
    if (!cleanP) return;
    const existingIdx = kindleHistory.findIndex((h) => h.passage === cleanP);
    if (existingIdx >= 0) kindleHistory.splice(existingIdx, 1);
    kindleHistory.unshift({
      passage: cleanP,
      book: book || kindleBookTitle || "Kindle 영어원서",
      savedAt: new Date().toISOString()
    });
    if (kindleHistory.length > 35) kindleHistory = kindleHistory.slice(0, 35);
    saveJSON(STORAGE_KINDLE_HISTORY_KEY, kindleHistory);
    renderKindleHistoryList();
  }

  function renderKindleHistoryList() {
    const listEl = document.getElementById("kindleHistoryList");
    const countEl = document.getElementById("kindleHistoryCount");
    if (countEl) countEl.textContent = String(kindleHistory.length);
    if (!listEl) return;

    if (kindleHistory.length === 0) {
      listEl.innerHTML = `<div style="font-size:12.5px; color:var(--text-muted); padding:10px;">킨들 프로그램에서 문장을 복사(<kbd>Ctrl</kbd>+<kbd>C</kbd>)하면 이곳에 원서 문장 기록이 차곡차곡 쌓입니다.</div>`;
      return;
    }

    listEl.innerHTML = "";
    kindleHistory.forEach((item, idx) => {
      const row = document.createElement("div");
      row.className = "line-item" + (item.passage === activeKindlePassage ? " active" : "");
      row.innerHTML = `
        <div class="line-num">${idx + 1}</div>
        <div class="line-info">
          <div class="line-meta">
            <span>📖 ${escapeHtml(item.book || "Kindle 원서")}</span>
          </div>
          <div class="line-preview">${escapeHtml(item.passage)}</div>
        </div>
      `;
      row.addEventListener("click", () => {
        loadKindlePassageItem(item.passage, item.book, false);
      });
      listEl.appendChild(row);
    });
  }

  async function ensureKindleGeminiModelList(apiKey) {
    if (cachedKindleGeminiModels.length > 0) return cachedKindleGeminiModels;
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
    );
    const data = await resp.json();
    if (!resp.ok || data.error) {
      throw new Error(data?.error?.message || `API 키 오류 (${resp.status})`);
    }
    const valid = (data.models || []).filter(
      (m) =>
        Array.isArray(m.supportedGenerationMethods) &&
        m.supportedGenerationMethods.includes("generateContent") &&
        /^models\/gemini/i.test(m.name || "") &&
        !/tts|image|embedding|veo|imagen|audio|live|robotics|computer-use|thinking|aqa/i.test(m.name || "")
    );
    const flashPool = valid.filter((m) => /flash/i.test(m.name));
    const pool = (flashPool.length ? flashPool : valid).slice();
    pool.sort((a, b) => {
      const liteA = /flash-lite/i.test(a.name) ? 1 : 0;
      const liteB = /flash-lite/i.test(b.name) ? 1 : 0;
      if (liteB !== liteA) return liteB - liteA;
      const expA = /exp|preview/i.test(a.name) ? 1 : 0;
      const expB = /exp|preview/i.test(b.name) ? 1 : 0;
      if (expA !== expB) return expA - expB;
      const vA = parseFloat((a.name.match(/gemini-(\d+(?:\.\d+)?)/i) || [0, "0"])[1]);
      const vB = parseFloat((b.name.match(/gemini-(\d+(?:\.\d+)?)/i) || [0, "0"])[1]);
      return vB - vA;
    });
    cachedKindleGeminiModels = pool.map((m) => m.name);
    return cachedKindleGeminiModels.length ? cachedKindleGeminiModels : ["models/gemini-flash-lite-latest"];
  }

  function buildKindleBookPrompt(passageText, bookTitleHint) {
    return `한국인 영어원서 독자를 위해 아래 영어원서 문장(${bookTitleHint || "영어원서"})을 정밀 분석해 순수 JSON만 출력하세요.
1) chunks: 긴 영어 문장을 앞에서부터 의미 단위(Sense-Group, 4~9단어 내외)로 끊어 배열로 만들고, 각 조각의 정확한 직독직해 한국어 뜻(ko)을 매칭하세요.
2) koFull: 문장 전체의 자연스럽고 매끄러운 한국어 번역.
3) backbone: 문장의 핵심 뼈대(주절 주어 S + 본동사 V + 목적어/보어 O/C 및 종속절 연결 구조)를 한눈에 보이게 1~2문장으로 요약.
4) grammarList: 이 문장을 이해하는 데 꼭 필요한 원서 문장 구조·문법(분사구문, 관계절, 도치, 가정법, 부분부정, 강조구문, 세미콜론/대시 등) 2~3개를 골라 초중급자도 단번에 이해되게 자세히 설명.
5) vocab: 문장 속 주요 원서 어휘·구동사·관용구·다의어를 빠짐없이 뽑아 이 문맥에서의 정확한 뜻(meaning)과 뉘앙스·유의어(nuance) 설명.

형식:
{"koFull":"전체 번역","backbone":"주절 뼈대 요약","chunks":[{"en":"영어 조각","ko":"직독직해 뜻"}],"grammarList":[{"title":"구문·문법명","desc":"상세 설명"}],"vocab":[{"term":"단어/숙어","typeLabel":"품사/구분","meaning":"문맥 속 뜻","nuance":"원서 뉘앙스·유의어"}]}

원서 문장: "${passageText}"`;
  }

  async function requestKindleAiAnalysis(passageText, bookTitleHint, optionalImageB64) {
    const cleanKey = String(kindleAiKey || "").trim();
    if (!cleanKey) return null;

    if (!optionalImageB64 && kindleAiCacheObj[passageText]) {
      return kindleAiCacheObj[passageText];
    }

    let parsed = null;
    if (cleanKey.startsWith("sk-")) {
      const prompt = buildKindleBookPrompt(passageText, bookTitleHint);
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cleanKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.2,
          max_tokens: 1500,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "Expert English literature & non-fiction reading tutor for Korean learners. Output valid JSON only." },
            { role: "user", content: prompt }
          ]
        })
      });
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data?.error?.message || `HTTP ${resp.status}`);
      parsed = JSON.parse(data.choices[0].message.content);
    } else {
      const models = await ensureKindleGeminiModelList(cleanKey);
      const userParts = [];
      if (optionalImageB64) {
        userParts.push({ inlineData: { mimeType: "image/png", data: optionalImageB64 } });
        userParts.push({
          text:
            `첨부된 킨들 캡처 이미지에서 영어 원서 문장을 정확히 추출해 extractedPassage 필드에 넣고, ` +
            buildKindleBookPrompt(passageText || "(이미지 내 영어 문장)", bookTitleHint).replace(
              '{"koFull":',
              '{"extractedPassage":"추출된 영어 원문","koFull":'
            )
        });
      } else {
        userParts.push({ text: buildKindleBookPrompt(passageText, bookTitleHint) });
      }

      let lastErr = "AI 응답 실패";
      for (const modelName of models.slice(0, 3)) {
        try {
          const genCfg = { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 1600 };
          const ver = parseFloat((modelName.match(/gemini-(\d+(?:\.\d+)?)/i) || [0, "0"])[1]);
          if (!/flash-lite/i.test(modelName)) {
            if (ver >= 3) genCfg.thinkingConfig = { thinkingLevel: "minimal" };
            else if (ver >= 2.5) genCfg.thinkingConfig = { thinkingBudget: 0 };
          }
          const url = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${encodeURIComponent(cleanKey)}`;
          let resp = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: userParts }], generationConfig: genCfg })
          });
          let data = await resp.json();
          if (resp.status === 400 && genCfg.thinkingConfig) {
            delete genCfg.thinkingConfig;
            resp = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ contents: [{ parts: userParts }], generationConfig: genCfg })
            });
            data = await resp.json();
          }
          if (!resp.ok || data.error) {
            lastErr = data?.error?.message || `HTTP ${resp.status}`;
            continue;
          }
          const parts = data?.candidates?.[0]?.content?.parts || [];
          const ansPart =
            parts.find((p) => !p.thought && typeof p.text === "string" && p.text.includes("{")) ||
            parts[parts.length - 1];
          if (!ansPart || !ansPart.text) continue;
          let rawJson = ansPart.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
          const fb = rawJson.indexOf("{");
          const lb = rawJson.lastIndexOf("}");
          if (fb !== -1 && lb > fb) rawJson = rawJson.slice(fb, lb + 1);
          parsed = JSON.parse(rawJson);
          break;
        } catch (e) {
          lastErr = e.message || String(e);
        }
      }
      if (!parsed) throw new Error(lastErr);
    }

    parsed.isAi = true;
    const cacheKey = parsed.extractedPassage || passageText;
    if (cacheKey) {
      kindleAiCacheObj[cacheKey] = parsed;
      const keys = Object.keys(kindleAiCacheObj);
      if (keys.length > 80) delete kindleAiCacheObj[keys[0]];
      saveJSON(STORAGE_KINDLE_AI_CACHE_KEY, kindleAiCacheObj);
    }
    return parsed;
  }

  async function handleKindleCapturedImage(offlineOcrText, imageBase64) {
    const statusEl = document.getElementById("kindleAnalyzeStatus");
    if (kindleAiKey && imageBase64) {
      if (statusEl) statusEl.textContent = "⚡ 캡처 이미지 AI 비전 원문 추출 및 구문 분석 중...";
      try {
        const aiRes = await requestKindleAiAnalysis(offlineOcrText, kindleBookTitle, imageBase64);
        const finalPassage = (aiRes && aiRes.extractedPassage) || offlineOcrText;
        if (finalPassage) {
          activeKindlePassage = finalPassage;
          document.getElementById("kindleInputArea").value = finalPassage;
          pushKindleHistory(finalPassage, kindleBookTitle);
          renderKindleAnalysisResult(finalPassage, aiRes, kindleBookTitle);
          return;
        }
      } catch (_) {}
    }
    if (offlineOcrText && offlineOcrText.length >= 4) {
      loadKindlePassageItem(offlineOcrText, kindleBookTitle, true);
    }
  }

  function renderKindleAnalysisResult(passageText, analysis, bookLabel) {
    const sourceTag = `[원서] ${bookLabel || kindleBookTitle || "Kindle 영어원서"}`;
    const badgeEl = document.getElementById("kindleSourceBadge");
    const statusEl = document.getElementById("kindleAnalyzeStatus");
    const slashEl = document.getElementById("kindleSlashChunks");
    const fullKoEl = document.getElementById("kindleFullKo");
    const backboneEl = document.getElementById("kindleBackboneBox");
    const grammarEl = document.getElementById("kindleGrammarList");
    const vocabEl = document.getElementById("kindleVocabList");

    if (badgeEl) badgeEl.textContent = `📖 ${bookLabel || kindleBookTitle || "Kindle 영어원서"}`;
    if (statusEl) {
      statusEl.textContent = analysis.isAi
        ? "✨ 정밀 직독직해 · 문장구조 · 어휘 분석 완료"
        : "✓ 내장 구문 분석 완료 (AI 키 연결 시 한글 직독직해 자동 생성)";
    }

    slashEl.innerHTML = "";
    (analysis.chunks || []).forEach((ch, idx) => {
      const row = document.createElement("div");
      row.style.cssText =
        "display:grid; grid-template-columns:1.15fr 1fr; gap:10px; align-items:center; padding:9px 12px; border-radius:8px; background:rgba(15,23,42,0.55); border:1px solid #243359;";
      row.innerHTML = `
        <div style="font-size:14.5px; font-weight:700; color:#fff; font-family:Georgia, 'Pretendard', serif;">
          <span style="color:#f59e0b; font-size:11.5px; margin-right:5px;">#${idx + 1}</span>${escapeHtml(ch.en)} <span style="color:#f59e0b; font-weight:900;">/</span>
        </div>
        <div style="font-size:13px; color:#bae6fd; font-weight:600; line-height:1.45;">
          ${escapeHtml(ch.ko || "")}
        </div>
      `;
      slashEl.appendChild(row);
    });

    fullKoEl.textContent = analysis.koFull || "";
    backboneEl.innerHTML = `<strong>🎯 문장 뼈대 요약:</strong> ${escapeHtml(analysis.backbone || "")}`;

    // Render Grammar / Sentence Architecture Cards (with Save to Notion!)
    grammarEl.innerHTML = "";
    (analysis.grammarList || []).forEach((g) => {
      const gSaved = savedVocab.some(
        (item) => item.kind === "grammar" && item.term === g.title && item.sentence === passageText
      );
      const gCard = document.createElement("div");
      gCard.className = "vocab-item";
      gCard.style.borderLeft = "3px solid #f59e0b";
      gCard.innerHTML = `
        <div class="vocab-head">
          <div class="vocab-term-wrap">
            <span class="vocab-term" style="color:#fcd34d;">🧩 ${escapeHtml(g.title)}</span>
          </div>
          <button class="btn btn-sm ${gSaved ? "btn-toggle active" : ""}">
            ${gSaved ? "★ 노션·단어장 저장됨" : "☆ 구문·문법 저장"}
          </button>
        </div>
        <div class="vocab-meaning" style="font-weight:500; line-height:1.55;">${escapeHtml(g.desc)}</div>
      `;
      gCard.querySelector("button").addEventListener("click", () => {
        toggleSaveVocab(
          {
            kind: "grammar",
            term: g.title,
            typeLabel: "원서 문법·구문",
            meaning: g.desc,
            nuance: analysis.koFull && !analysis.koFull.startsWith("💡") ? `해석: ${analysis.koFull}` : "",
            example: passageText
          },
          sourceTag,
          passageText
        );
        renderKindleAnalysisResult(passageText, analysis, bookLabel);
      });
      grammarEl.appendChild(gCard);
    });

    // Render Contextual Book Vocabulary Cards (with Real-Time Save to Notion!)
    vocabEl.innerHTML = "";
    const vList = analysis.vocab || [];
    if (vList.length === 0) {
      vocabEl.innerHTML = `<div style="font-size:13px; color:var(--text-secondary);">기본 어휘로 구성된 문장입니다. 상단 [✨ 원서 AI 키 설정]을 연결하면 모든 다의어·숙어 뜻풀이가 제공됩니다.</div>`;
    } else {
      vList.forEach((v) => {
        const isSaved = isVocabSaved(v.term);
        const vCard = document.createElement("div");
        vCard.className = "vocab-item";
        vCard.innerHTML = `
          <div class="vocab-head">
            <div class="vocab-term-wrap">
              <span class="vocab-term">${escapeHtml(v.term)}</span>
              <span class="type-tag type-vocab">${escapeHtml(v.typeLabel || "원서 어휘")}</span>
            </div>
            <button class="btn btn-sm ${isSaved ? "btn-toggle active" : ""}">
              ${isSaved ? "★ 노션·단어장 저장됨" : "☆ 단어장 · 노션 저장"}
            </button>
          </div>
          <div class="vocab-meaning">${escapeHtml(v.meaning || "")}</div>
          <div class="vocab-nuance">${escapeHtml(v.nuance || "")}</div>
        `;
        vCard.querySelector("button").addEventListener("click", () => {
          toggleSaveVocab(
            {
              kind: "vocab",
              term: v.term,
              typeLabel: v.typeLabel || "원서 어휘",
              meaning: v.meaning,
              nuance: v.nuance || "",
              example: passageText
            },
            sourceTag,
            passageText
          );
          renderKindleAnalysisResult(passageText, analysis, bookLabel);
        });
        vocabEl.appendChild(vCard);
      });
    }
  }

  async function loadKindlePassageItem(rawPassage, bookLabel, isAutoDetected) {
    const cleanPassage = String(rawPassage || "").replace(/\s+/g, " ").trim();
    if (!cleanPassage) return;
    activeKindlePassage = cleanPassage;

    const inputEl = document.getElementById("kindleInputArea");
    if (inputEl) inputEl.value = cleanPassage;

    const effBook = bookLabel || kindleBookTitle || "Kindle 영어원서";
    pushKindleHistory(cleanPassage, effBook);

    // Check if matches one of the 3 curated sample passages first
    const matchedSample = KINDLE_SAMPLE_PASSAGES.find(
      (s) => s.passage.trim() === cleanPassage
    );
    if (matchedSample && matchedSample.prebuilt) {
      renderKindleAnalysisResult(cleanPassage, matchedSample.prebuilt, matchedSample.book);
      return;
    }

    // Immediate fast offline render (<5ms), followed by 0.8s AI upgrade if AI key is configured!
    const offlineResult = window.KINDLE_ANALYZER
      ? window.KINDLE_ANALYZER.analyzeOfflinePassage(cleanPassage)
      : { isAi: false, koFull: "", chunks: [{ en: cleanPassage, ko: "" }], backbone: "", grammarList: [], vocab: [] };
    renderKindleAnalysisResult(cleanPassage, offlineResult, effBook);

    if (isAutoDetected) {
      const statusEl = document.getElementById("kindleAnalyzeStatus");
      if (statusEl) statusEl.textContent = "📖 킨들 클립보드 문장 자동 감지됨!";
    }

    if (kindleAiKey) {
      const statusEl = document.getElementById("kindleAnalyzeStatus");
      if (statusEl) statusEl.textContent = "⚡ AI 원서 직독직해 · 문장구조 분석 중...";
      try {
        const aiRes = await requestKindleAiAnalysis(cleanPassage, effBook, "");
        if (aiRes && activeKindlePassage === cleanPassage) {
          renderKindleAnalysisResult(cleanPassage, aiRes, effBook);
        }
      } catch (err) {
        if (statusEl) {
          statusEl.textContent = `⚠️ AI 오류 (${err.message || err}) — 오프라인 구문 분석 표시 중`;
        }
      }
    }
  }

  function loadKindleSample(sampleIndex) {
    const sample = KINDLE_SAMPLE_PASSAGES[sampleIndex];
    if (!sample) return;
    kindleBookTitle = sample.book;
    const bookIn = document.getElementById("kindleBookTitleInput");
    if (bookIn) bookIn.value = sample.book;
    loadKindlePassageItem(sample.passage, sample.book, false);
  }

  function bindKindleEvents() {
    const btnWatch = document.getElementById("btnToggleKindleWatch");
    if (btnWatch) {
      btnWatch.addEventListener("click", () => {
        kindleAutoWatch = !kindleAutoWatch;
        btnWatch.textContent = kindleAutoWatch
          ? "🟢 클립보드 자동 감지: ON"
          : "⚪ 클립보드 자동 감지: OFF";
        btnWatch.style.borderColor = kindleAutoWatch ? "#10b981" : "#64748b";
        btnWatch.style.color = kindleAutoWatch ? "#6ee7b7" : "#94a3b8";
        if (kindleAutoWatch) startKindleClipboardPolling();
        else stopKindleClipboardPolling();
      });
    }

    const bookIn = document.getElementById("kindleBookTitleInput");
    if (bookIn) {
      bookIn.addEventListener("change", () => {
        kindleBookTitle = bookIn.value.trim();
        localStorage.setItem(STORAGE_KINDLE_BOOK_KEY, kindleBookTitle);
      });
    }

    const btnAiToggle = document.getElementById("btnToggleKindleAiKey");
    const aiBox = document.getElementById("kindleAiSetupBox");
    if (btnAiToggle && aiBox) {
      btnAiToggle.addEventListener("click", () => {
        aiBox.style.display = aiBox.style.display === "flex" ? "none" : "flex";
      });
    }

    const btnSaveAi = document.getElementById("btnSaveKindleAiKey");
    if (btnSaveAi) {
      btnSaveAi.addEventListener("click", () => {
        kindleAiKey = String(document.getElementById("kindleAiKeyInput").value || "")
          .trim()
          .replace(/^["']+|["']+$/g, "")
          .replace(/\s+/g, "");
        cachedKindleGeminiModels = [];
        localStorage.setItem(STORAGE_KINDLE_AI_KEY, kindleAiKey);
        const msgEl = document.getElementById("kindleAiKeyMsg");
        if (msgEl) {
          msgEl.textContent = kindleAiKey
            ? "✓ 원서 AI 키가 저장되었습니다! 현재 문장을 즉시 정밀 분석합니다."
            : "AI 키가 삭제되었습니다 (내장 구문 분석기 작동).";
        }
        if (kindleAiKey && activeKindlePassage) {
          loadKindlePassageItem(activeKindlePassage, kindleBookTitle, false);
        }
      });
    }

    document.querySelectorAll(".kindle-sample-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        loadKindleSample(parseInt(btn.dataset.sample || "0", 10));
      });
    });

    const btnAnalyze = document.getElementById("btnAnalyzeKindle");
    if (btnAnalyze) {
      btnAnalyze.addEventListener("click", () => {
        const raw = document.getElementById("kindleInputArea").value;
        const parsed = window.KINDLE_ANALYZER
          ? window.KINDLE_ANALYZER.parseKindleClipboardRaw(raw)
          : { passage: raw, bookMeta: "" };
        if (parsed.bookMeta) {
          kindleBookTitle = parsed.bookMeta;
          localStorage.setItem(STORAGE_KINDLE_BOOK_KEY, kindleBookTitle);
          document.getElementById("kindleBookTitleInput").value = kindleBookTitle;
        }
        loadKindlePassageItem(parsed.passage || raw, kindleBookTitle, false);
      });
    }

    const btnTts1 = document.getElementById("btnKindleTtsNormal");
    const btnTtsSlow = document.getElementById("btnKindleTtsSlow");
    if (btnTts1) btnTts1.addEventListener("click", () => speakKindlePassage(1.0));
    if (btnTtsSlow) btnTtsSlow.addEventListener("click", () => speakKindlePassage(0.78));

    const btnClearHist = document.getElementById("btnClearKindleHistory");
    if (btnClearHist) {
      btnClearHist.addEventListener("click", () => {
        kindleHistory = [];
        saveJSON(STORAGE_KINDLE_HISTORY_KEY, kindleHistory);
        renderKindleHistoryList();
      });
    }

    const btnOpenNotion = document.getElementById("btnOpenNotionFromKindle");
    if (btnOpenNotion) {
      btnOpenNotion.addEventListener("click", () => {
        renderSavedVocabModal();
        document.getElementById("vocabModal").classList.add("open");
      });
    }
  }

  // ==================== Boot ====================
  initEpisodes();
  updateSavedVocabCounter();
  bindEvents();
  bindKindleEvents();
  renderCurrentLine();
  loadYouTubeAPI();
})();
