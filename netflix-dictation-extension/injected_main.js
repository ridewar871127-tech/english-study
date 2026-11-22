(function () {
  "use strict";

  if (window.__ND_MAIN_INJECTED__) return;
  window.__ND_MAIN_INJECTED__ = true;

  // ==================== Netflix Hotkey Isolation Shield (Capture & Bubble) ====================
  // Netflix attaches global shortcuts (f = fullscreen, m = mute, s = skip, Space = play/pause,
  // Arrow keys = seek/volume) in the CAPTURE phase on window/document/root containers.
  // Because this script runs at document_start in MAIN world, wrapping addEventListener here
  // intercepts all Netflix keyboard listeners before they ever fire while typing in #nd-studio-host.
  let mainFocusLocked = false;

  function isFocusInsideStudio(event) {
    if (mainFocusLocked) return true;
    const active = document.activeElement;
    if (active && active.id === "nd-studio-host") {
      return true;
    }
    if (event && typeof event.composedPath === "function") {
      const path = event.composedPath();
      for (let i = 0; i < path.length; i++) {
        const n = path[i];
        if (n && n.id === "nd-studio-host") return true;
      }
    }
    return false;
  }

  // Track mouse/pointer clicks inside vs outside #nd-studio-host directly in MAIN world too
  ["pointerdown", "mousedown"].forEach((evtType) => {
    window.addEventListener(
      evtType,
      function (e) {
        let inside = false;
        if (typeof e.composedPath === "function") {
          const path = e.composedPath();
          for (let i = 0; i < path.length; i++) {
            if (path[i] && path[i].id === "nd-studio-host") {
              inside = true;
              break;
            }
          }
        }
        mainFocusLocked = inside;
      },
      true
    );
  });

  // Layer 1: Top-of-tree window capture interceptor (runs before any window/document/inline handlers)
  ["keydown", "keyup", "keypress"].forEach((evtType) => {
    window.addEventListener(
      evtType,
      function (e) {
        if (!isFocusInsideStudio(e)) return;

        if (evtType === "keydown") {
          if (e.ctrlKey && e.code === "Space") {
            e.preventDefault();
            e.stopImmediatePropagation();
            window.postMessage({ source: "ND_MAIN", type: "STUDIO_SHORTCUT", command: "REPLAY" }, "*");
            return;
          }
          if (e.altKey && e.code === "KeyH") {
            e.preventDefault();
            e.stopImmediatePropagation();
            window.postMessage({ source: "ND_MAIN", type: "STUDIO_SHORTCUT", command: "HINT_FIRST" }, "*");
            return;
          }
          if (e.key === "Enter" && !e.shiftKey) {
            // Only trigger grade/advance if focused on the dictation textarea (not API key input)
            const path = typeof e.composedPath === "function" ? e.composedPath() : [];
            const targetEl = path[0];
            if (targetEl && targetEl.id === "dictInput") {
              e.preventDefault();
              e.stopImmediatePropagation();
              window.postMessage({ source: "ND_MAIN", type: "STUDIO_SHORTCUT", command: "ENTER" }, "*");
              return;
            }
          }
        }

        // Block all Netflix page listeners (f=fullscreen, m=mute, s=skip, Space=pause, Arrows=seek)
        // while keeping native browser text editing (typing f, Space, Backspace, Ctrl+A/C/V) intact!
        e.stopImmediatePropagation();
      },
      true
    );
  });

  function isCaptureOption(options) {
    if (typeof options === "boolean") return options;
    if (options && typeof options === "object") return Boolean(options.capture);
    return false;
  }

  const listenerMap = new WeakMap();
  const origAddEventListener = EventTarget.prototype.addEventListener;
  const origRemoveEventListener = EventTarget.prototype.removeEventListener;

  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (
      (type === "keydown" ||
        type === "keyup" ||
        type === "keypress" ||
        type === "focusin" ||
        type === "focusout") &&
      listener &&
      (typeof listener === "function" || typeof listener.handleEvent === "function")
    ) {
      // Do not block listeners attached directly inside our own ShadowRoot elements
      const isInsideShadow =
        typeof Node !== "undefined" &&
        this instanceof Node &&
        typeof this.getRootNode === "function" &&
        typeof ShadowRoot !== "undefined" &&
        this.getRootNode() instanceof ShadowRoot;

      if (!isInsideShadow) {
        let perTypeMap = listenerMap.get(listener);
        if (!perTypeMap) {
          perTypeMap = new Map();
          listenerMap.set(listener, perTypeMap);
        }
        const key = `${type}:${isCaptureOption(options) ? "1" : "0"}`;
        let wrapped = perTypeMap.get(key);
        if (!wrapped) {
          wrapped = function (event) {
            if (isFocusInsideStudio(event)) {
              return;
            }
            if (typeof listener === "function") {
              return listener.call(this, event);
            }
            return listener.handleEvent(event);
          };
          perTypeMap.set(key, wrapped);
        }
        return origAddEventListener.call(this, type, wrapped, options);
      }
    }
    return origAddEventListener.call(this, type, listener, options);
  };

  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    if (listener && listenerMap.has(listener)) {
      const perTypeMap = listenerMap.get(listener);
      const key = `${type}:${isCaptureOption(options) ? "1" : "0"}`;
      const wrapped = perTypeMap && perTypeMap.get(key);
      if (wrapped) {
        return origRemoveEventListener.call(this, type, wrapped, options);
      }
    }
    return origRemoveEventListener.call(this, type, listener, options);
  };

  // Secondary guard: prevent programmatic fullscreen trigger while typing in dictation box
  if (typeof Element !== "undefined" && Element.prototype.requestFullscreen) {
    const origReqFs = Element.prototype.requestFullscreen;
    Element.prototype.requestFullscreen = function (...args) {
      if (isFocusInsideStudio(null)) {
        return Promise.resolve();
      }
      return origReqFs.apply(this, args);
    };
  }

  // Guard 3: Block Netflix Player / React FocusTrap from stealing focus via .focus() or .blur()
  if (typeof HTMLElement !== "undefined") {
    const origFocus = HTMLElement.prototype.focus;
    const origBlur = HTMLElement.prototype.blur;

    HTMLElement.prototype.focus = function (...args) {
      const isStudioNode =
        this.id === "nd-studio-host" ||
        (typeof this.getRootNode === "function" &&
          typeof ShadowRoot !== "undefined" &&
          this.getRootNode() instanceof ShadowRoot);

      if (!isStudioNode && (mainFocusLocked || (document.activeElement && document.activeElement.id === "nd-studio-host"))) {
        return;
      }
      return origFocus.apply(this, args);
    };

    HTMLElement.prototype.blur = function (...args) {
      if (this.id === "nd-studio-host" && mainFocusLocked) {
        return;
      }
      return origBlur.apply(this, args);
    };
  }

  // ==================== Subtitle Parsing (TTML / DFXP / WebVTT) ====================
  function parseTimeAttrToMs(val, tickRate) {
    if (!val) return 0;
    const s = String(val).trim();
    // Tick format: e.g. "354120000t" with tickRate=10000000
    if (/^\d+t$/i.test(s)) {
      const ticks = parseFloat(s.slice(0, -1));
      return Math.round((ticks / (tickRate || 10000000)) * 1000);
    }
    // Seconds format: "12.345s"
    if (/^[\d.]+s$/i.test(s)) {
      return Math.round(parseFloat(s.slice(0, -1)) * 1000);
    }
    // Clock format: "00:01:23.456" or "00:01:23:12"
    const m = s.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:[.,:](\d{1,3}))?$/);
    if (m) {
      const hh = parseInt(m[1], 10);
      const mm = parseInt(m[2], 10);
      const ss = parseInt(m[3], 10);
      const ms = m[4] ? parseInt(m[4].padEnd(3, "0").slice(0, 3), 10) : 0;
      return (hh * 3600 + mm * 60 + ss) * 1000 + ms;
    }
    return 0;
  }

  function cleanCueText(raw, isKorean) {
    let txt = String(raw || "")
      .replace(/\[.*?\]|\(.*?\)/g, " ")
      .replace(/♪.*?♪|♪|♫/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Remove leading dash or speaker ALL-CAPS prefix (e.g. "HARVEY: ", "- RACHEL: ")
    txt = txt.replace(/^(?:-\s*)?[A-Z][A-Z0-9\s.'-]{1,16}:\s*/, "");
    txt = txt.replace(/^-\s+/, "").trim();

    if (!isKorean) {
      txt = txt.replace(/\s+-\s+/g, " ");
    }
    return txt.trim();
  }

  function detectTrackLang(xmlLangAttr, sampleText) {
    if (/[가-힣]/.test(sampleText)) return "ko";
    const attr = String(xmlLangAttr || "").toLowerCase();
    if (attr.startsWith("ko")) return "ko";
    if (attr.startsWith("en")) return "en";
    if (/[a-zA-Z]{3,}/.test(sampleText) && !/[\u3040-\u30ff\u4e00-\u9fff]/.test(sampleText)) {
      return "en";
    }
    return null;
  }

  function mergeAndDedupeCues(rawCues, isKorean) {
    if (!rawCues.length) return [];
    rawCues.sort((a, b) => a.startMs - b.startMs);
    const merged = [];

    for (let i = 0; i < rawCues.length; i++) {
      const c = rawCues[i];
      const text = cleanCueText(c.text, isKorean);
      if (!text || (!isKorean && !/[a-zA-Z]/.test(text))) continue;

      const prev = merged[merged.length - 1];
      // Merge identical or simultaneous dual-speaker lines occurring at exact same startMs
      if (prev && Math.abs(prev.startMs - c.startMs) <= 45) {
        if (prev.text !== text && !prev.text.includes(text)) {
          prev.text = `${prev.text} ${text}`.trim();
          prev.endMs = Math.max(prev.endMs, c.endMs);
        }
      } else {
        merged.push({
          startMs: c.startMs,
          endMs: Math.max(c.startMs + 450, c.endMs),
          text
        });
      }
    }
    return merged;
  }

  function extractAllTtmlBlocks(rawText) {
    const blocks = [];
    const re = /<(?:[a-zA-Z0-9_]+:)?tt\b[\s\S]*?<\/(?:[a-zA-Z0-9_]+:)?tt>/g;
    let m;
    while ((m = re.exec(rawText)) !== null) {
      blocks.push(m[0]);
    }
    return blocks;
  }

  function tryParseSubtitlePayload(textBody, forcedLangHint) {
    if (!textBody || typeof textBody !== "string" || textBody.length < 30) return;

    // 1. TTML / DFXP / MP4-wrapped IMSC1.1 XML (<tt ...> ... </tt>)
    if ((textBody.includes("<tt") || textBody.includes(":tt")) && (textBody.includes("<p") || textBody.includes(":p"))) {
      try {
        const ttBlocks = extractAllTtmlBlocks(textBody);
        const xmlDocsToParse = ttBlocks.length > 0 ? ttBlocks : [textBody];
        const parser = new DOMParser();

        const rawCues = [];
        let sampleConcat = "";
        let detectedXmlLang = "";
        let hasForcedFlag = false;

        xmlDocsToParse.forEach((xmlChunk) => {
          const doc = parser.parseFromString(xmlChunk, "text/xml");
          const tt = doc.documentElement;
          if (!tt) return;

          const tickRateAttr =
            tt.getAttribute("ttp:tickRate") ||
            tt.getAttribute("tickRate") ||
            "10000000";
          const tickRate = parseFloat(tickRateAttr) || 10000000;
          const xmlLang = tt.getAttribute("xml:lang") || tt.getAttribute("lang") || "";
          if (xmlLang && !detectedXmlLang) detectedXmlLang = xmlLang;

          if (/forced/i.test(xmlChunk.slice(0, 1200))) {
            hasForcedFlag = true;
          }

          const allEls = Array.from(doc.getElementsByTagName("*"));
          const pNodes = allEls.filter((el) => el.localName === "p" || el.tagName === "p");

          pNodes.forEach((p) => {
            const begin = p.getAttribute("begin");
            const end = p.getAttribute("end");
            const dur = p.getAttribute("dur");
            if (!begin) return;

            const startMs = parseTimeAttrToMs(begin, tickRate);
            const endMs = end
              ? parseTimeAttrToMs(end, tickRate)
              : startMs + (dur ? parseTimeAttrToMs(dur, tickRate) : 2200);

            const clone = p.cloneNode(true);
            Array.from(clone.getElementsByTagName("*")).forEach((node) => {
              if (node.localName === "br" || node.tagName === "br") {
                node.replaceWith(" ");
              }
            });
            const rawTxt = (clone.textContent || "").trim();
            if (rawTxt) {
              rawCues.push({ startMs, endMs, text: rawTxt });
              if (sampleConcat.length < 600) sampleConcat += " " + rawTxt;
            }
          });
        });

        if (!rawCues.length) return;
        const lang = forcedLangHint || detectTrackLang(detectedXmlLang, sampleConcat);
        if (!lang) return;

        const cues = mergeAndDedupeCues(rawCues, lang === "ko");
        const isLikelyForced = hasForcedFlag && cues.length < 25;
        if (cues.length >= 1) {
          window.postMessage(
            { source: "ND_MAIN", type: "SUBTITLE_TRACK", lang, cues, isForced: isLikelyForced },
            "*"
          );
        }
      } catch (_) {}
      return;
    }

    // 2. WebVTT (WEBVTT)
    if (textBody.includes("WEBVTT")) {
      try {
        const vttStart = textBody.indexOf("WEBVTT");
        const cleanVtt = textBody.slice(vttStart);
        const blocks = cleanVtt.replace(/\r\n/g, "\n").split(/\n\s*\n/);
        const rawCues = [];
        let sampleConcat = "";

        blocks.forEach((block) => {
          const lines = block.split("\n").map((s) => s.trim()).filter(Boolean);
          const tIdx = lines.findIndex((l) => l.includes("-->"));
          if (tIdx === -1) return;
          const parts = lines[tIdx].split("-->");
          const startMs = parseTimeAttrToMs(parts[0].trim().split(/\s+/)[0], 1000);
          const endMs = parseTimeAttrToMs(parts[1].trim().split(/\s+/)[0], 1000);
          const rawTxt = lines
            .slice(tIdx + 1)
            .join(" ")
            .replace(/<[^>]+>/g, " ")
            .trim();
          if (rawTxt) {
            rawCues.push({ startMs, endMs, text: rawTxt });
            if (sampleConcat.length < 600) sampleConcat += " " + rawTxt;
          }
        });

        const lang = forcedLangHint || detectTrackLang("", sampleConcat);
        if (!lang) return;
        const cues = mergeAndDedupeCues(rawCues, lang === "ko");
        if (cues.length >= 1) {
          window.postMessage(
            { source: "ND_MAIN", type: "SUBTITLE_TRACK", lang, cues, isForced: false },
            "*"
          );
        }
      } catch (_) {}
    }
  }

  // ==================== Netflix Manifest Hook (Full Non-Forced Track Downloader) ====================
  const origFetch = window.fetch;
  const fetchedSubtitleUrls = new Set();

  function extractBestUrlFromDownloadables(ttDownloadables) {
    if (!ttDownloadables || typeof ttDownloadables !== "object") return "";
    const preferredProfiles = [
      "imsc1.1",
      "dfxp-ls-sdh",
      "simplesdh",
      "nflx-cmisc",
      "webvtt-lssdh-ios8"
    ];
    const keys = [
      ...preferredProfiles.filter((k) => ttDownloadables[k]),
      ...Object.keys(ttDownloadables)
    ];

    for (const key of keys) {
      const info = ttDownloadables[key];
      if (!info) continue;
      if (info.urls && Array.isArray(info.urls) && info.urls.length > 0 && info.urls[0].url) {
        return info.urls[0].url;
      }
      if (info.downloadUrls && typeof info.downloadUrls === "object") {
        const vals = Object.values(info.downloadUrls);
        if (vals.length > 0 && typeof vals[0] === "string") return vals[0];
      }
    }
    return "";
  }

  async function downloadFullTrackUrl(url, langCode) {
    if (!url || fetchedSubtitleUrls.has(url)) return;
    fetchedSubtitleUrls.add(url);
    try {
      const res = await origFetch.call(window, url);
      if (!res.ok) return;
      const buf = await res.arrayBuffer();
      const decoded = new TextDecoder("utf-8").decode(buf);
      tryParseSubtitlePayload(decoded, langCode);
    } catch (_) {}
  }

  function inspectTimedTextTracks(tracks) {
    if (!Array.isArray(tracks) || tracks.length === 0) return;

    const validTracks = tracks.filter(
      (t) => t && !t.isNoneTrack && !t.isForcedNarrative && t.trackType !== "FORCED_NARRATIVE_SUBTITLE"
    );

    const enFull =
      validTracks.find(
        (t) =>
          String(t.language || t.bcp47 || "").toLowerCase().startsWith("en") &&
          String(t.rawTrackType || "").toLowerCase() === "closedcaptions"
      ) ||
      validTracks.find((t) =>
        String(t.language || t.bcp47 || "").toLowerCase().startsWith("en")
      );

    const koFull = validTracks.find((t) =>
      String(t.language || t.bcp47 || "").toLowerCase().startsWith("ko")
    );

    if (enFull) {
      const enUrl = extractBestUrlFromDownloadables(enFull.ttDownloadables);
      if (enUrl) downloadFullTrackUrl(enUrl, "en");
    }
    if (koFull) {
      const koUrl = extractBestUrlFromDownloadables(koFull.ttDownloadables);
      if (koUrl) downloadFullTrackUrl(koUrl, "ko");
    }
  }

  const origJsonParse = JSON.parse;
  JSON.parse = function (...args) {
    const parsed = origJsonParse.apply(this, args);
    try {
      if (parsed && typeof parsed === "object") {
        if (Array.isArray(parsed.timedtexttracks)) {
          setTimeout(() => inspectTimedTextTracks(parsed.timedtexttracks), 0);
        } else if (parsed.result && Array.isArray(parsed.result.timedtexttracks)) {
          setTimeout(() => inspectTimedTextTracks(parsed.result.timedtexttracks), 0);
        } else if (Array.isArray(parsed.result)) {
          parsed.result.forEach((item) => {
            if (item && Array.isArray(item.timedtexttracks)) {
              setTimeout(() => inspectTimedTextTracks(item.timedtexttracks), 0);
            }
          });
        }
      }
    } catch (_) {}
    return parsed;
  };

  // ==================== Hook fetch & XMLHttpRequest (Including Binary MP4 Subtitles!) ====================
  window.fetch = async function (...args) {
    const response = await origFetch.apply(this, args);
    try {
      const cloned = response.clone();
      cloned
        .arrayBuffer()
        .then((buf) => {
          if (buf && buf.byteLength > 30 && buf.byteLength < 5000000) {
            const txt = new TextDecoder("utf-8").decode(buf);
            if (txt.includes("<tt") || txt.includes(":tt") || txt.includes("WEBVTT")) {
              tryParseSubtitlePayload(txt);
            }
          }
        })
        .catch(() => {});
    } catch (_) {}
    return response;
  };

  const origXhrOpen = XMLHttpRequest.prototype.open;
  const origXhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__ndUrl = url;
    return origXhrOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", function () {
      try {
        if (!this.responseType || this.responseType === "text") {
          const txt = this.responseText;
          if (txt && (txt.includes("<tt") || txt.includes(":tt") || txt.includes("WEBVTT"))) {
            tryParseSubtitlePayload(txt);
          }
        } else if (this.responseType === "arraybuffer" && this.response instanceof ArrayBuffer) {
          if (this.response.byteLength > 30 && this.response.byteLength < 5000000) {
            const fullTxt = new TextDecoder("utf-8").decode(this.response);
            if (fullTxt.includes("<tt") || fullTxt.includes(":tt") || fullTxt.includes("WEBVTT")) {
              tryParseSubtitlePayload(fullTxt);
            }
          }
        } else if (this.responseType === "blob" && this.response instanceof Blob) {
          if (this.response.size > 30 && this.response.size < 5000000) {
            this.response
              .text()
              .then((txt) => {
                if (txt.includes("<tt") || txt.includes(":tt") || txt.includes("WEBVTT")) {
                  tryParseSubtitlePayload(txt);
                }
              })
              .catch(() => {});
          }
        }
      } catch (_) {}
    });
    return origXhrSend.apply(this, args);
  };

  // ==================== Netflix Internal VideoPlayer & DRM-Safe Segment Engine ====================
  // IMPORTANT: Never mutate <video>.currentTime directly or set <video>.playbackRate > 1.5 on Netflix,
  // and never call np.seek() before <video>.readyState >= 3 — doing so triggers Netflix DRM error D7375 / M7375!
  let userPlaybackRate = 1.0;
  let exactStopAtMs = 0;
  let preRollTimer = null;
  let readyWaitTimer = null;
  let preRollActive = false;
  let savedUserMuted = false;
  let lastSeekWallMs = 0;
  let playerFirstReadyAtMs = 0;

  function getNetflixPlayer() {
    try {
      const api = window.netflix?.appContext?.state?.playerApp?.getAPI?.();
      const vp = api?.videoPlayer;
      if (!vp) return null;
      const sessionIds = vp.getAllPlayerSessionIds?.() || [];
      const watchSession =
        sessionIds.find((id) => String(id).startsWith("watch")) || sessionIds[0];
      if (!watchSession) return null;
      return vp.getVideoPlayerBySessionId(watchSession);
    } catch (_) {
      return null;
    }
  }

  function getHtmlVideo() {
    return document.querySelector("video");
  }

  function isDrmPlayerReady() {
    if (window.__ND_MOCK_MODE__) return Boolean(getNetflixPlayer() || getHtmlVideo());
    const np = getNetflixPlayer();
    const v = getHtmlVideo();
    if (!np || !v) return false;
    const dur =
      typeof np.getDuration === "function" ? Number(np.getDuration() || 0) : (v.duration || 0) * 1000;
    if (v.readyState >= 3 && !v.seeking && dur > 0) {
      if (!playerFirstReadyAtMs) playerFirstReadyAtMs = Date.now();
      // Give PlayReady/Widevine 300ms settle time after initial readyState >= 3 before first programmatic seek
      return Date.now() - playerFirstReadyAtMs >= 300;
    }
    return false;
  }

  function getCurrentTimeMs() {
    const np = getNetflixPlayer();
    if (np && typeof np.getCurrentTime === "function") {
      return Math.round(np.getCurrentTime());
    }
    const v = getHtmlVideo();
    return v ? Math.round(v.currentTime * 1000) : 0;
  }

  function isPlayerPaused() {
    const np = getNetflixPlayer();
    if (np && typeof np.isPaused === "function") {
      return Boolean(np.isPaused());
    }
    const v = getHtmlVideo();
    return v ? Boolean(v.paused) : true;
  }

  function setSafeMuteState(shouldMute) {
    const v = getHtmlVideo();
    const np = getNetflixPlayer();
    if (v && v.readyState >= 1) {
      v.muted = Boolean(shouldMute);
    }
    if (np && typeof np.setMuted === "function") {
      try {
        np.setMuted(Boolean(shouldMute));
      } catch (_) {}
    }
  }

  function getSafeMuteState() {
    const v = getHtmlVideo();
    if (v) return Boolean(v.muted);
    const np = getNetflixPlayer();
    if (np && typeof np.isMuted === "function") return Boolean(np.isMuted());
    if (np && typeof np.getMuted === "function") return Boolean(np.getMuted());
    return false;
  }

  function clearPreRollGuard() {
    if (readyWaitTimer) {
      clearInterval(readyWaitTimer);
      readyWaitTimer = null;
    }
    if (preRollTimer) {
      clearInterval(preRollTimer);
      preRollTimer = null;
    }
    if (preRollActive) {
      preRollActive = false;
      window.postMessage({ source: "ND_MAIN", type: "PRE_ROLL_STATE", active: false, phase: "idle" }, "*");
    }
  }

  function runWhenPlayerReady(taskFn) {
    if (readyWaitTimer) {
      clearInterval(readyWaitTimer);
      readyWaitTimer = null;
    }
    if (isDrmPlayerReady()) {
      taskFn();
      return;
    }
    const waitStarted = Date.now();
    window.postMessage({ source: "ND_MAIN", type: "PRE_ROLL_STATE", active: true, waitingReady: true }, "*");
    readyWaitTimer = setInterval(() => {
      if (isDrmPlayerReady()) {
        clearInterval(readyWaitTimer);
        readyWaitTimer = null;
        window.postMessage({ source: "ND_MAIN", type: "PRE_ROLL_STATE", active: false }, "*");
        taskFn();
      } else if (Date.now() - waitStarted > 15000) {
        clearInterval(readyWaitTimer);
        readyWaitTimer = null;
        window.postMessage({ source: "ND_MAIN", type: "PRE_ROLL_STATE", active: false }, "*");
      }
    }, 150);
  }

  function seekToMs(ms) {
    const safeMs = Math.max(0, Math.round(ms));
    runWhenPlayerReady(() => {
      const nowWall = Date.now();
      const delay = Math.max(0, 420 - (nowWall - lastSeekWallMs));
      setTimeout(() => {
        lastSeekWallMs = Date.now();
        const np = getNetflixPlayer();
        if (np && typeof np.seek === "function") {
          np.seek(safeMs);
          return;
        }
        const v = getHtmlVideo();
        if (v && window.__ND_MOCK_MODE__) v.currentTime = safeMs / 1000;
      }, delay);
    });
  }

  function playVideo() {
    const np = getNetflixPlayer();
    if (np && typeof np.play === "function") {
      np.play();
      return;
    }
    const v = getHtmlVideo();
    if (v) v.play().catch(() => {});
  }

  function pauseVideo() {
    clearPreRollGuard();
    const np = getNetflixPlayer();
    if (np && typeof np.pause === "function") {
      np.pause();
      return;
    }
    const v = getHtmlVideo();
    if (v) v.pause();
  }

  function setPlaybackRate(rate) {
    // Clamp strictly within DRM-safe range [0.5, 1.5] so PlayReady/Widevine never throws D7375!
    const clamped = Math.min(1.5, Math.max(0.5, Number(rate) || 1.0));
    userPlaybackRate = clamped;
    const v = getHtmlVideo();
    if (v && v.readyState >= 3 && !v.seeking) {
      try {
        v.playbackRate = clamped;
      } catch (_) {}
    }
  }

  // DRM-Safe Exact Dialogue Playback (With Full Natural Audio — Never Mutes!):
  // 1) Never mutates <video>.currentTime or uses high playbackRate (>1.5x) — zero D7375 risk!
  // 2) If playhead is already within 4.2s before targetMs (e.g. advancing to next cue), skips np.seek()
  //    completely so Netflix never snaps back 4s to an earlier keyframe!
  // 3) Keeps normal sound ON 100% of the time and signals live cue phase ("approaching" -> "speaking")!
  function seekExactAndPlay(targetMs, stopAtMs, rate) {
    clearPreRollGuard();
    const safeMs = Math.max(0, Math.round(targetMs));
    if (rate !== undefined) {
      setPlaybackRate(rate);
    }

    runWhenPlayerReady(() => {
      exactStopAtMs =
        typeof stopAtMs === "number" && stopAtMs > safeMs ? Math.round(stopAtMs) : 0;

      const nowMsBefore = getCurrentTimeMs();
      const forwardGapMs = safeMs - nowMsBefore;
      preRollActive = true;

      // Case A: Playhead is already right before targetMs (0ms ~ 4200ms ahead) -> DO NOT call np.seek()!
      if (forwardGapMs >= -90 && forwardGapMs <= 4200) {
        if (isPlayerPaused()) {
          playVideo();
        }
      } else {
        // Case B: Replay or Jump -> Use official np.seek(safeMs) with cooldown & normal audio ON
        const waitCooldown = Math.max(0, 420 - (Date.now() - lastSeekWallMs));
        setTimeout(() => {
          lastSeekWallMs = Date.now();
          const np = getNetflixPlayer();
          if (np && typeof np.seek === "function") {
            np.seek(safeMs);
          } else if (window.__ND_MOCK_MODE__) {
            const v = getHtmlVideo();
            if (v) v.currentTime = safeMs / 1000;
          }

          setTimeout(() => {
            if (isPlayerPaused()) {
              playVideo();
            }
          }, 130);
        }, waitCooldown);
      }

      const startedWallMs = Date.now();
      let lastPhase = "";

      preRollTimer = setInterval(() => {
        if (!preRollActive) {
          clearInterval(preRollTimer);
          preRollTimer = null;
          return;
        }
        const nowMs = getCurrentTimeMs();
        const elapsedWall = Date.now() - startedWallMs;

        if (nowMs >= safeMs - 85 || elapsedWall > 6500) {
          preRollActive = false;
          clearInterval(preRollTimer);
          preRollTimer = null;
          window.postMessage({ source: "ND_MAIN", type: "PRE_ROLL_STATE", active: true, phase: "speaking" }, "*");
          return;
        }

        if (safeMs - nowMs > 220 && lastPhase !== "approaching") {
          lastPhase = "approaching";
          window.postMessage({ source: "ND_MAIN", type: "PRE_ROLL_STATE", active: true, phase: "approaching" }, "*");
        }
      }, 30);
    });
  }

  // Reset playerFirstReadyAtMs when navigating between episodes
  let watchedPathForReady = location.pathname;
  setInterval(() => {
    if (location.pathname !== watchedPathForReady) {
      watchedPathForReady = location.pathname;
      playerFirstReadyAtMs = 0;
      exactStopAtMs = 0;
      clearPreRollGuard();
    }
    if (exactStopAtMs <= 0 || preRollActive) return;
    if (isPlayerPaused()) return;
    const nowMs = getCurrentTimeMs();
    if (nowMs >= exactStopAtMs && nowMs <= exactStopAtMs + 2200) {
      exactStopAtMs = 0;
      pauseVideo();
      window.postMessage(
        { source: "ND_MAIN", type: "EXACT_STOP_REACHED", timeMs: nowMs },
        "*"
      );
    }
  }, 25);

  async function syncDualSubtitles() {
    const np = getNetflixPlayer();
    if (!np || typeof np.getTimedTextTrackList !== "function") {
      window.postMessage(
        {
          source: "ND_MAIN",
          type: "DUAL_SYNC_STATUS",
          message: "넷플릭스 플레이어 우측 하단 자막 메뉴에서 [한국어]를 한 번 클릭한 뒤 다시 [영어(CC)]를 선택하면 한·영 자막이 모두 자동 연동됩니다."
        },
        "*"
      );
      return;
    }

    try {
      const tracks = np.getTimedTextTrackList() || [];
      const koTrack = tracks.find((t) =>
        String(t.bcp47 || t.language || "").toLowerCase().startsWith("ko")
      );
      const enTrack =
        tracks.find(
          (t) =>
            String(t.bcp47 || t.language || "").toLowerCase().startsWith("en") &&
            !t.isForcedNarrative
        ) ||
        tracks.find((t) =>
          String(t.bcp47 || t.language || "").toLowerCase().startsWith("en")
        );

      if (koTrack && typeof np.setTimedTextTrack === "function") {
        np.setTimedTextTrack(koTrack);
        await new Promise((r) => setTimeout(r, 850));
      }
      if (enTrack && typeof np.setTimedTextTrack === "function") {
        np.setTimedTextTrack(enTrack);
        window.postMessage(
          {
            source: "ND_MAIN",
            type: "DUAL_SYNC_STATUS",
            message: "✓ 넷플릭스 영어·한국어 자막 트랙 동기화를 요청했습니다!"
          },
          "*"
        );
      }
    } catch (_) {}
  }

  // Listen for commands from content_ui.js
  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.source !== "ND_UI") {
      return;
    }
    const msg = event.data;
    switch (msg.type) {
      case "SEEK_EXACT_PLAY":
        seekExactAndPlay(msg.timeMs, msg.stopAtMs, msg.rate);
        break;
      case "SET_STOP_AT":
        exactStopAtMs = typeof msg.stopAtMs === "number" ? Math.round(msg.stopAtMs) : 0;
        if (msg.rate !== undefined) setPlaybackRate(msg.rate);
        break;
      case "SEEK":
        seekToMs(msg.timeMs);
        break;
      case "PLAY":
        playVideo();
        break;
      case "PAUSE":
        exactStopAtMs = 0;
        pauseVideo();
        break;
      case "SET_RATE":
        setPlaybackRate(msg.rate);
        break;
      case "SYNC_DUAL_SUBS":
        syncDualSubtitles();
        break;
      case "PARSE_RAW_SUB":
        tryParseSubtitlePayload(msg.payload);
        break;
      case "SET_FOCUS_LOCK":
        mainFocusLocked = Boolean(msg.locked);
        break;
    }
  });

  // Live DOM Fallback Observer (.player-timedtext)
  let lastDomText = "";
  setInterval(() => {
    const isWatchPage =
      location.pathname.startsWith("/watch") || Boolean(window.__ND_MOCK_MODE__);
    if (!isWatchPage) return;

    const v = getHtmlVideo();
    if (v || getNetflixPlayer()) {
      window.postMessage(
        {
          source: "ND_MAIN",
          type: "TICK",
          timeMs: getCurrentTimeMs(),
          paused: isPlayerPaused(),
          pathname: location.pathname
        },
        "*"
      );
    }

    const container = document.querySelector(".player-timedtext");
    if (container) {
      const spans = Array.from(container.querySelectorAll("span"));
      const raw = spans
        .map((s) => s.textContent || "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (raw && raw !== lastDomText) {
        lastDomText = raw;
        const lang = detectTrackLang("", raw);
        if (lang) {
          const cleaned = cleanCueText(raw, lang === "ko");
          if (cleaned) {
            const nowMs = getCurrentTimeMs();
            window.postMessage(
              {
                source: "ND_MAIN",
                type: "LIVE_DOM_CUE",
                lang,
                cue: { startMs: Math.max(0, nowMs - 200), endMs: nowMs + 2600, text: cleaned }
              },
              "*"
            );
          }
        }
      }
    }
  }, 50);
})();
