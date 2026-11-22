(function () {
  "use strict";

  if (window.__NJD_MAIN_INJECTED__) return;
  window.__NJD_MAIN_INJECTED__ = true;

  let mainFocusLocked = false;

  function isFocusInsideStudio(event) {
    if (mainFocusLocked) return true;
    const active = document.activeElement;
    if (active && active.id === "njd-studio-host") return true;
    if (event && typeof event.composedPath === "function") {
      const path = event.composedPath();
      for (let i = 0; i < path.length; i++) {
        if (path[i] && path[i].id === "njd-studio-host") return true;
      }
    }
    return false;
  }

  ["pointerdown", "mousedown"].forEach((evtType) => {
    window.addEventListener(
      evtType,
      function (e) {
        let inside = false;
        if (typeof e.composedPath === "function") {
          const path = e.composedPath();
          for (let i = 0; i < path.length; i++) {
            if (path[i] && path[i].id === "njd-studio-host") {
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
            if (isFocusInsideStudio(event)) return;
            if (typeof listener === "function") return listener.call(this, event);
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
      if (wrapped) return origRemoveEventListener.call(this, type, wrapped, options);
    }
    return origRemoveEventListener.call(this, type, listener, options);
  };

  if (typeof Element !== "undefined" && Element.prototype.requestFullscreen) {
    const origReqFs = Element.prototype.requestFullscreen;
    Element.prototype.requestFullscreen = function (...args) {
      if (isFocusInsideStudio(null)) return Promise.resolve();
      return origReqFs.apply(this, args);
    };
  }

  if (typeof HTMLElement !== "undefined") {
    const origFocus = HTMLElement.prototype.focus;
    const origBlur = HTMLElement.prototype.blur;

    HTMLElement.prototype.focus = function (...args) {
      const isStudioNode =
        this.id === "njd-studio-host" ||
        (typeof this.getRootNode === "function" &&
          typeof ShadowRoot !== "undefined" &&
          this.getRootNode() instanceof ShadowRoot);

      if (!isStudioNode && (mainFocusLocked || (document.activeElement && document.activeElement.id === "njd-studio-host"))) {
        return;
      }
      return origFocus.apply(this, args);
    };

    HTMLElement.prototype.blur = function (...args) {
      if (this.id === "njd-studio-host" && mainFocusLocked) return;
      return origBlur.apply(this, args);
    };
  }

  // ==================== Japanese & Korean Subtitle Parsing ====================
  function parseTimeAttrToMs(val, tickRate) {
    if (!val) return 0;
    const s = String(val).trim();
    if (/^\d+t$/i.test(s)) {
      const ticks = parseFloat(s.slice(0, -1));
      return Math.round((ticks / (tickRate || 10000000)) * 1000);
    }
    if (/^[\d.]+s$/i.test(s)) {
      return Math.round(parseFloat(s.slice(0, -1)) * 1000);
    }
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

  // Collect <style xml:id="..." tts:ruby="text"/> IDs from IMSC1.1 <head> so referenced furigana spans get stripped!
  function collectRubyTextStyleIds(doc) {
    const ids = new Set();
    const styles = Array.from(doc.getElementsByTagName("*")).filter((el) =>
      (el.localName || el.tagName || "").toLowerCase().endsWith("style")
    );
    styles.forEach((st) => {
      let isRubyText = false;
      let styleId = st.getAttribute("xml:id") || st.getAttribute("id") || "";
      for (let i = 0; i < st.attributes.length; i++) {
        const attr = st.attributes[i];
        if (
          (attr.name === "tts:ruby" || attr.localName === "ruby") &&
          (attr.value === "text" || attr.value === "delimiter")
        ) {
          isRubyText = true;
        }
        if ((attr.name === "xml:id" || attr.localName === "id") && attr.value) {
          styleId = attr.value;
        }
      }
      if (isRubyText && styleId) ids.add(styleId);
    });
    return ids;
  }

  function extractCleanNodeText(node, rubyStyleIds) {
    const clone = node.cloneNode(true);
    const allEls = Array.from(clone.getElementsByTagName("*"));
    allEls.forEach((el) => {
      const local = (el.localName || el.tagName || "").toLowerCase();
      if (local === "br" || local.endsWith(":br")) {
        el.replaceWith(" ");
        return;
      }
      if (local === "rt" || local === "rp") {
        el.remove();
        return;
      }
      const styleRef = el.getAttribute("style") || "";
      if (rubyStyleIds && styleRef && rubyStyleIds.has(styleRef)) {
        el.remove();
        return;
      }
      for (let i = 0; i < el.attributes.length; i++) {
        const attr = el.attributes[i];
        if (
          (attr.name === "tts:ruby" || attr.localName === "ruby") &&
          (attr.value === "text" || attr.value === "delimiter")
        ) {
          el.remove();
          break;
        }
      }
    });
    return (clone.textContent || "").trim();
  }

  function cleanCueText(raw, isKorean) {
    let txt = String(raw || "")
      .replace(/（[^）]*）|\([^)]*\)|［[^］]*］|\[[^\]]*\]|【[^】]*】/g, " ")
      .replace(/♪.*?♪|♪|♫|～♪|♪～/g, " ")
      .replace(/[\u3000\s]+/g, isKorean ? " " : "")
      .trim();

    if (!isKorean) {
      txt = txt.replace(/^[^\s：:]{1,8}[：:]/, "");
      txt = txt.replace(/^[―ー\-]+/, "").trim();
    } else {
      txt = txt.replace(/^-\s*/, "").trim();
    }
    return txt;
  }

  function detectTrackLang(xmlLangAttr, sampleText) {
    if (/[가-힣]/.test(sampleText)) return "ko";
    const attr = String(xmlLangAttr || "").toLowerCase();
    if (attr.startsWith("ko")) return "ko";
    if (attr.startsWith("ja")) return "ja";
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(sampleText)) return "ja";
    return null;
  }

  function mergeAndDedupeCues(rawCues, isKorean) {
    if (!rawCues.length) return [];
    rawCues.sort((a, b) => a.startMs - b.startMs);
    const merged = [];

    for (let i = 0; i < rawCues.length; i++) {
      const c = rawCues[i];
      const text = cleanCueText(c.text, isKorean);
      if (!text) continue;
      if (!isKorean && !/[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/.test(text)) continue;

      const prev = merged[merged.length - 1];
      if (prev && Math.abs(prev.startMs - c.startMs) <= 80) {
        if (prev.text !== text && !prev.text.includes(text)) {
          prev.text = isKorean ? `${prev.text} ${text}`.trim() : `${prev.text}${text}`;
          prev.endMs = Math.max(prev.endMs, c.endMs);
        }
      } else {
        merged.push({
          startMs: c.startMs,
          endMs: Math.max(c.startMs + 600, c.endMs),
          text
        });
      }
    }
    return merged;
  }

  function parseSingleTtmlXml(xmlChunk, forcedLangHint, isForcedTrackHint) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlChunk, "text/xml");
      const tt = doc.documentElement;
      if (!tt || tt.nodeName === "parsererror") return null;

      const tickRate =
        parseFloat(tt.getAttribute("ttp:tickRate") || tt.getAttribute("tickRate") || "10000000") ||
        10000000;
      const xmlLang = forcedLangHint || tt.getAttribute("xml:lang") || tt.getAttribute("lang") || "";

      // Detect if TTML metadata marks this file as Forced Narrative (<itunes:forced> or forced attribute)
      const isForcedMeta =
        Boolean(isForcedTrackHint) ||
        /<(?:\w+:)?forced>\s*true\s*<\//i.test(xmlChunk.slice(0, 1500));

      const rubyStyleIds = collectRubyTextStyleIds(doc);
      let pNodes = Array.from(doc.getElementsByTagName("p"));
      if (pNodes.length === 0 && doc.getElementsByTagNameNS) {
        pNodes = Array.from(doc.getElementsByTagNameNS("*", "p"));
      }
      if (pNodes.length === 0) return null;

      const rawCues = [];
      let sampleConcat = "";

      pNodes.forEach((p) => {
        const begin = p.getAttribute("begin");
        const end = p.getAttribute("end");
        const dur = p.getAttribute("dur");
        if (!begin) return;

        const startMs = parseTimeAttrToMs(begin, tickRate);
        const endMs = end
          ? parseTimeAttrToMs(end, tickRate)
          : startMs + (dur ? parseTimeAttrToMs(dur, tickRate) : 2200);

        const rawTxt = extractCleanNodeText(p, rubyStyleIds);
        if (rawTxt) {
          rawCues.push({ startMs, endMs, text: rawTxt });
          if (sampleConcat.length < 600) sampleConcat += " " + rawTxt;
        }
      });

      const lang = detectTrackLang(xmlLang, sampleConcat);
      if (!lang || rawCues.length === 0) return null;
      return { lang, rawCues, isForcedMeta };
    } catch (_) {
      return null;
    }
  }

  // Handles plain TTML XML, fragmented MP4 (ISOBMFF stpp/imsc1.1 with multiple <tt>...</tt> blocks), and WebVTT!
  function tryParseSubtitlePayload(textBody, forcedLangHint, isForcedTrackHint) {
    if (!textBody || typeof textBody !== "string" || textBody.length < 30) return;

    // 1. Extract ALL <tt ...>...</tt> XML documents (strips binary MP4 ftyp/moof/mdat headers cleanly!)
    if (textBody.includes("<tt") || textBody.includes(":tt")) {
      const ttMatches = textBody.match(/<(?:\w+:)?tt[\s>][\s\S]*?<\/(?:\w+:)?tt>/gi);
      if (ttMatches && ttMatches.length > 0) {
        const groupedRaw = { ja: [], ko: [] };
        let anyForced = false;

        ttMatches.forEach((chunk) => {
          const res = parseSingleTtmlXml(chunk, forcedLangHint, isForcedTrackHint);
          if (res && (res.lang === "ja" || res.lang === "ko")) {
            groupedRaw[res.lang].push(...res.rawCues);
            if (res.isForcedMeta) anyForced = true;
          }
        });

        ["ja", "ko"].forEach((lang) => {
          if (groupedRaw[lang].length > 0) {
            const cues = mergeAndDedupeCues(groupedRaw[lang], lang === "ko");
            if (cues.length > 0) {
              window.postMessage(
                {
                  source: "NJD_MAIN",
                  type: "SUBTITLE_TRACK",
                  lang,
                  cues,
                  isForced: anyForced
                },
                "*"
              );
            }
          }
        });
        return;
      }
    }

    // 2. WebVTT (plain or inside MP4 wvtt text)
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
            .replace(/<rt>.*?<\/rt>/gi, "")
            .replace(/<[^>]+>/g, "")
            .trim();
          if (rawTxt) {
            rawCues.push({ startMs, endMs, text: rawTxt });
            if (sampleConcat.length < 600) sampleConcat += " " + rawTxt;
          }
        });

        const lang = detectTrackLang(forcedLangHint || "", sampleConcat);
        if (!lang) return;
        const cues = mergeAndDedupeCues(rawCues, lang === "ko");
        if (cues.length > 0) {
          window.postMessage(
            {
              source: "NJD_MAIN",
              type: "SUBTITLE_TRACK",
              lang,
              cues,
              isForced: Boolean(isForcedTrackHint)
            },
            "*"
          );
        }
      } catch (_) {}
    }
  }

  // ==================== Hook JSON.parse for Netflix Manifest `timedtexttracks` ====================
  // Directly discovers full-episode subtitle URLs (ignoring Forced Narrative tracks!) as soon as episode loads!
  const fetchedSubUrls = new Set();
  const origFetch = window.fetch;

  function extractBestUrlFromDownloadables(ttDownloadables) {
    if (!ttDownloadables || typeof ttDownloadables !== "object") return null;
    // Prefer single-file XML / WebVTT profiles over segmented DASH profiles
    const preferredProfiles = [
      "imsc1.1",
      "dfxp-ls-sdh",
      "simplesdh",
      "nflx-cmisc",
      "webvtt-lssdh-ios8"
    ];
    const allKeys = [
      ...preferredProfiles.filter((k) => ttDownloadables[k]),
      ...Object.keys(ttDownloadables).filter((k) => !preferredProfiles.includes(k))
    ];

    for (const key of allKeys) {
      const entry = ttDownloadables[key];
      if (!entry || typeof entry !== "object") continue;
      if (Array.isArray(entry.urls) && entry.urls.length > 0) {
        const u = typeof entry.urls[0] === "string" ? entry.urls[0] : entry.urls[0]?.url;
        if (u) return u;
      }
      if (entry.downloadUrls && typeof entry.downloadUrls === "object") {
        const vals = Object.values(entry.downloadUrls);
        if (vals.length > 0 && typeof vals[0] === "string") return vals[0];
      }
    }
    return null;
  }

  async function downloadFullTrackUrl(url, langCode) {
    if (!url || fetchedSubUrls.has(url)) return;
    fetchedSubUrls.add(url);
    try {
      const resp = await origFetch(url);
      const buf = await resp.arrayBuffer();
      const txt = new TextDecoder("utf-8").decode(buf);
      tryParseSubtitlePayload(txt, langCode, false);
    } catch (_) {}
  }

  function inspectTimedTextTracks(tracks) {
    if (!Array.isArray(tracks) || tracks.length === 0) return;

    const validTracks = tracks.filter(
      (t) => t && !t.isNoneTrack && !t.isForcedNarrative && t.trackType !== "FORCED_NARRATIVE_SUBTITLE"
    );

    const jaFull =
      validTracks.find(
        (t) =>
          String(t.language || t.bcp47 || "").toLowerCase().startsWith("ja") &&
          String(t.rawTrackType || "").toLowerCase() === "closedcaptions"
      ) ||
      validTracks.find((t) =>
        String(t.language || t.bcp47 || "").toLowerCase().startsWith("ja")
      );

    const koFull = validTracks.find((t) =>
      String(t.language || t.bcp47 || "").toLowerCase().startsWith("ko")
    );

    if (!jaFull) {
      // Check if only a Forced Narrative ja track exists (common on older licensed dramas on Netflix Korea!)
      const hasAnyJaForced = tracks.some(
        (t) => t && String(t.language || t.bcp47 || "").toLowerCase().startsWith("ja") && t.isForcedNarrative
      );
      if (hasAnyJaForced || koFull) {
        window.postMessage(
          {
            source: "NJD_MAIN",
            type: "NO_FULL_JA_SUB_WARNING",
            message:
              "⚠️ 이 에피소드는 넷플릭스 코리아에서 [일본어 대사 자막(CC)]을 제공하지 않는 라이선스 구작입니다(간판 강제자막만 존재). 넷플릭스 자막 메뉴에 [일본어(CC)]가 있는 작품(예: <심야식당: 도쿄 스토리> 등 넷플릭스 시리즈)을 선택해 주세요!"
          },
          "*"
        );
      }
      return;
    }

    const jaUrl = extractBestUrlFromDownloadables(jaFull.ttDownloadables);
    if (jaUrl) downloadFullTrackUrl(jaUrl, "ja");

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

  const origXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", function () {
      try {
        if (!this.responseType || this.responseType === "text") {
          const txt = this.responseText;
          if (txt && (txt.includes("<tt") || txt.includes(":tt") || txt.includes("WEBVTT"))) {
            tryParseSubtitlePayload(txt);
          }
        } else if (this.responseType === "arraybuffer" && this.response instanceof ArrayBuffer) {
          // Decode full buffer (up to 5MB) because MP4-packaged IMSC1.1 subtitles have binary ftyp/moof headers in bytes 0..1000!
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

  // ==================== Netflix VideoPlayer Control & DRM-Safe Segment Engine ====================
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
      const watchSession = sessionIds.find((id) => String(id).startsWith("watch")) || sessionIds[0];
      return watchSession ? vp.getVideoPlayerBySessionId(watchSession) : null;
    } catch (_) {
      return null;
    }
  }

  function getHtmlVideo() {
    return document.querySelector("video");
  }

  function isDrmPlayerReady() {
    if (window.__NJD_MOCK_MODE__) return Boolean(getNetflixPlayer() || getHtmlVideo());
    const np = getNetflixPlayer();
    const v = getHtmlVideo();
    if (!np || !v) return false;
    const dur =
      typeof np.getDuration === "function" ? Number(np.getDuration() || 0) : (v.duration || 0) * 1000;
    if (v.readyState >= 3 && !v.seeking && dur > 0) {
      if (!playerFirstReadyAtMs) playerFirstReadyAtMs = Date.now();
      return Date.now() - playerFirstReadyAtMs >= 300;
    }
    return false;
  }

  function getCurrentTimeMs() {
    const np = getNetflixPlayer();
    if (np && typeof np.getCurrentTime === "function") return Math.round(np.getCurrentTime());
    const v = getHtmlVideo();
    return v ? Math.round(v.currentTime * 1000) : 0;
  }

  function isPlayerPaused() {
    const np = getNetflixPlayer();
    if (np && typeof np.isPaused === "function") return Boolean(np.isPaused());
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
      window.postMessage({ source: "NJD_MAIN", type: "PRE_ROLL_STATE", active: false, phase: "idle" }, "*");
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
    window.postMessage({ source: "NJD_MAIN", type: "PRE_ROLL_STATE", active: true, waitingReady: true }, "*");
    readyWaitTimer = setInterval(() => {
      if (isDrmPlayerReady()) {
        clearInterval(readyWaitTimer);
        readyWaitTimer = null;
        window.postMessage({ source: "NJD_MAIN", type: "PRE_ROLL_STATE", active: false }, "*");
        taskFn();
      } else if (Date.now() - waitStarted > 15000) {
        clearInterval(readyWaitTimer);
        readyWaitTimer = null;
        window.postMessage({ source: "NJD_MAIN", type: "PRE_ROLL_STATE", active: false }, "*");
      }
    }, 150);
  }

  function seekToMs(ms) {
    const safeMs = Math.max(0, Math.round(ms));
    runWhenPlayerReady(() => {
      const delay = Math.max(0, 420 - (Date.now() - lastSeekWallMs));
      setTimeout(() => {
        lastSeekWallMs = Date.now();
        const np = getNetflixPlayer();
        if (np && typeof np.seek === "function") {
          np.seek(safeMs);
          return;
        }
        const v = getHtmlVideo();
        if (v && window.__NJD_MOCK_MODE__) v.currentTime = safeMs / 1000;
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
    const clamped = Math.min(1.5, Math.max(0.5, Number(rate) || 1.0));
    userPlaybackRate = clamped;
    const v = getHtmlVideo();
    if (v && v.readyState >= 3 && !v.seeking) {
      try {
        v.playbackRate = clamped;
      } catch (_) {}
    }
  }

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

      if (forwardGapMs >= -90 && forwardGapMs <= 4200) {
        if (isPlayerPaused()) {
          playVideo();
        }
      } else {
        const waitCooldown = Math.max(0, 420 - (Date.now() - lastSeekWallMs));
        setTimeout(() => {
          lastSeekWallMs = Date.now();
          const np = getNetflixPlayer();
          if (np && typeof np.seek === "function") {
            np.seek(safeMs);
          } else if (window.__NJD_MOCK_MODE__) {
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
          window.postMessage({ source: "NJD_MAIN", type: "PRE_ROLL_STATE", active: true, phase: "speaking" }, "*");
          return;
        }

        if (safeMs - nowMs > 220 && lastPhase !== "approaching") {
          lastPhase = "approaching";
          window.postMessage({ source: "NJD_MAIN", type: "PRE_ROLL_STATE", active: true, phase: "approaching" }, "*");
        }
      }, 30);
    });
  }

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
        { source: "NJD_MAIN", type: "EXACT_STOP_REACHED", timeMs: nowMs },
        "*"
      );
    }
  }, 25);

  async function syncDualSubtitles() {
    const np = getNetflixPlayer();
    if (!np || typeof np.getTimedTextTrackList !== "function") {
      window.postMessage(
        {
          source: "NJD_MAIN",
          type: "DUAL_SYNC_STATUS",
          message: "넷플릭스 자막 메뉴에서 [한국어]를 한 번 클릭한 뒤 다시 [일본어(CC)]를 선택하면 한·일 자막이 모두 연동됩니다."
        },
        "*"
      );
      return;
    }

    try {
      const tracks = np.getTimedTextTrackList() || [];
      const koTrack = tracks.find(
        (t) =>
          String(t.bcp47 || t.language || "").toLowerCase().startsWith("ko") &&
          !t.isForcedNarrative &&
          t.trackType !== "FORCED_NARRATIVE_SUBTITLE"
      );
      const jaTrack = tracks.find(
        (t) =>
          String(t.bcp47 || t.language || "").toLowerCase().startsWith("ja") &&
          !t.isForcedNarrative &&
          !t.isNoneTrack &&
          t.trackType !== "FORCED_NARRATIVE_SUBTITLE"
      );

      if (!jaTrack) {
        window.postMessage(
          {
            source: "NJD_MAIN",
            type: "NO_FULL_JA_SUB_WARNING",
            message:
              "⚠️ 이 작품은 넷플릭스 자막 목록에 [일본어(CC)] 대사 자막이 없습니다(간판용 강제자막만 존재). 넷플릭스 말풍선 메뉴에 [일본어(CC)]가 지원되는 작품(예: <심야식당: 도쿄 스토리>)을 재생해 주세요!"
          },
          "*"
        );
        return;
      }

      if (koTrack && typeof np.setTimedTextTrack === "function") {
        np.setTimedTextTrack(koTrack);
        await new Promise((r) => setTimeout(r, 900));
      }
      if (jaTrack && typeof np.setTimedTextTrack === "function") {
        np.setTimedTextTrack(jaTrack);
        window.postMessage(
          {
            source: "NJD_MAIN",
            type: "DUAL_SYNC_STATUS",
            message: "✓ 넷플릭스 전체 일본어(CC)·한국어 자막 트랙 동기화를 완료했습니다!"
          },
          "*"
        );
      }
    } catch (_) {}
  }

  // Auto-check subtitle tracks 2.2s after entering a /watch/* episode!
  let autoCheckedPath = "";
  setInterval(() => {
    if (!location.pathname.startsWith("/watch")) return;
    if (autoCheckedPath === location.pathname) return;
    const np = getNetflixPlayer();
    if (!np || typeof np.getTimedTextTrackList !== "function") return;
    const tracks = np.getTimedTextTrackList() || [];
    if (tracks.length === 0) return;

    autoCheckedPath = location.pathname;
    const jaFull = tracks.find(
      (t) =>
        String(t.bcp47 || t.language || "").toLowerCase().startsWith("ja") &&
        !t.isForcedNarrative &&
        !t.isNoneTrack &&
        t.trackType !== "FORCED_NARRATIVE_SUBTITLE"
    );
    if (!jaFull) {
      window.postMessage(
        {
          source: "NJD_MAIN",
          type: "NO_FULL_JA_SUB_WARNING",
          message:
            "⚠️ 현재 에피소드는 넷플릭스에서 [일본어(CC)] 전체 대사 자막을 제공하지 않는 구작 라이선스 영상입니다(화면 글자 자막만 존재). <심야식당: 도쿄 스토리>처럼 자막 메뉴에 [일본어(CC)]가 있는 에피소드에서 모든 대사가 표시됩니다!"
        },
        "*"
      );
    } else {
      // Automatically ensure full Japanese track is selected if currently on Forced Narrative or Korean
      const curTrack = typeof np.getTimedTextTrack === "function" ? np.getTimedTextTrack() : null;
      const curIsFullJa =
        curTrack &&
        String(curTrack.bcp47 || curTrack.language || "").toLowerCase().startsWith("ja") &&
        !curTrack.isForcedNarrative &&
        curTrack.trackType !== "FORCED_NARRATIVE_SUBTITLE";
      if (!curIsFullJa && typeof np.setTimedTextTrack === "function") {
        np.setTimedTextTrack(jaFull);
      }
    }
  }, 1200);

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.source !== "NJD_UI") return;
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

  let lastDomText = "";
  setInterval(() => {
    const isWatchPage = location.pathname.startsWith("/watch") || Boolean(window.__NJD_MOCK_MODE__);
    if (!isWatchPage) return;

    if (getHtmlVideo() || getNetflixPlayer()) {
      window.postMessage(
        {
          source: "NJD_MAIN",
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
      const raw = extractCleanNodeText(container, null);
      if (raw && raw !== lastDomText) {
        lastDomText = raw;
        const lang = detectTrackLang("", raw);
        if (lang) {
          const cleaned = cleanCueText(raw, lang === "ko");
          if (cleaned) {
            const nowMs = getCurrentTimeMs();
            window.postMessage(
              {
                source: "NJD_MAIN",
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
