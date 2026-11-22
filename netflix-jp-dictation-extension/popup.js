(function () {
  "use strict";

  const elApi = document.getElementById("apiInput");
  const elMsg = document.getElementById("saveMsg");
  const elCount = document.getElementById("vCount");
  const elList = document.getElementById("vList");
  const elResumeCard = document.getElementById("resumeCard");
  const elResumeTitle = document.getElementById("resumeTitle");
  const elResumeMeta = document.getElementById("resumeMeta");

  let currentList = [];
  let popupFilter = "all";
  let lastSession = null;

  document.getElementById("btnGoNetflix").addEventListener("click", () => {
    window.open("https://www.netflix.com/browse", "_blank");
  });

  function formatMs(ms) {
    const sec = Math.max(0, Math.floor((ms || 0) / 1000));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function getTodayStamp() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function downloadBlob(content, filename, mimeType) {
    const blob = new Blob(["\uFEFF" + content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
  }

  function getFilteredPopupList() {
    if (popupFilter === "grammar") return currentList.filter((x) => x.kind === "grammar");
    if (popupFilter === "vocab") return currentList.filter((x) => x.kind !== "grammar");
    return currentList;
  }

  document.querySelectorAll(".p-filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      popupFilter = btn.dataset.pf || "all";
      document.querySelectorAll(".p-filter").forEach((b) => { b.style.borderColor = "#334675"; });
      btn.style.borderColor = "#ec4899";
      renderVocab(currentList);
    });
  });

  document.getElementById("btnPopupCsv").addEventListener("click", () => {
    const items = getFilteredPopupList();
    if (!items.length) return;
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
    downloadBlob(rows.join("\r\n"), `넷플릭스_일본어_단어문법장_${getTodayStamp()}.csv`, "text/csv;charset=utf-8;");
  });

  document.getElementById("btnPopupTxt").addEventListener("click", () => {
    const items = getFilteredPopupList();
    if (!items.length) return;
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
    downloadBlob(lines.join("\r\n"), `넷플릭스_일본어_단어문법장_${getTodayStamp()}.txt`, "text/plain;charset=utf-8;");
  });

  function renderResume(session) {
    lastSession = session;
    if (!session || !session.watchUrl) {
      elResumeCard.classList.remove("show");
      return;
    }
    elResumeCard.classList.add("show");
    elResumeTitle.textContent = session.title || "최근 학습한 일본어 에피소드";
    const nextNum = (session.resumeCueIndex || 0) + 1;
    elResumeMeta.textContent = `${session.passedCount || 0}/${session.totalCues || "?"} 완료 · ${nextNum}번 대사(${formatMs(session.resumeStartMs)})`;
  }

  document.getElementById("btnLaunchResume").addEventListener("click", () => {
    if (!lastSession || !lastSession.watchUrl) return;
    const resumeSec = Math.max(0, Math.floor((lastSession.resumeStartMs || 0) / 1000));
    const baseWatchUrl = String(lastSession.watchUrl).split("?")[0];
    const targetUrl = resumeSec > 0 ? `${baseWatchUrl}?t=${resumeSec}` : baseWatchUrl;

    chrome.storage.local.set({ njd_auto_jump_episode_v1: lastSession.episodeId }, () => {
      if (chrome.tabs && typeof chrome.tabs.query === "function") {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const activeTab = tabs && tabs[0];
          if (activeTab && activeTab.id && String(activeTab.url || "").includes("netflix.com")) {
            chrome.tabs.update(activeTab.id, { url: targetUrl });
            window.close();
          } else {
            window.open(targetUrl, "_blank");
          }
        });
      } else {
        window.open(targetUrl, "_blank");
      }
    });
  });

  function renderVocab(list) {
    currentList = list;
    const filtered = getFilteredPopupList();
    elCount.textContent = String(list.length);
    if (!filtered.length) {
      elList.innerHTML = `<div style="font-size:12px; color:#94a3b8;">대사를 통과한 뒤 [☆ 단어 저장] 또는 [☆ 문법 저장]을 누르면 이곳에 모입니다.</div>`;
      return;
    }
    elList.innerHTML = "";
    filtered.forEach((item) => {
      const isGrammar = item.kind === "grammar";
      const div = document.createElement("div");
      div.className = "v-card";
      if (isGrammar) div.style.borderLeft = "3px solid #f59e0b";
      div.innerHTML = `
        <div class="v-top">
          <span class="v-term" style="color:${isGrammar ? "#fcd34d" : "#f472b6"};">${isGrammar ? "🧩 " : ""}${escapeHtml(item.term)}${item.notionPageId ? ` <span style="font-size:10px; color:#6ee7b7;">📓</span>` : ""}</span>
          <button class="btn" style="padding:2px 6px; font-size:11px;">삭제</button>
        </div>
        <div class="v-mean">${escapeHtml(item.meaning || "")}</div>
        ${item.sentence ? `<div class="v-sent">「${escapeHtml(item.sentence)}」</div>` : ""}
      `;
      div.querySelector("button").addEventListener("click", () => {
        const realIdx = list.indexOf(item);
        if (realIdx >= 0) {
          const removed = list.splice(realIdx, 1)[0];
          if (removed && removed.notionPageId && popupNotionCfg.token) {
            chrome.runtime.sendMessage({
              type: "NJD_NOTION_ARCHIVE_PAGE",
              token: popupNotionCfg.token,
              notionPageId: removed.notionPageId
            });
          }
        }
        chrome.storage.local.set({ njd_saved_vocab_v1: list }, () => {
          renderVocab(list);
          renderPopupNotionState();
        });
      });
      elList.appendChild(div);
    });
  }

  let popupNotionCfg = { token: "", targetUrl: "", databaseId: "", dbTitle: "", autoSync: true };

  function renderPopupNotionState() {
    const badge = document.getElementById("pNotionBadge");
    const syncBtn = document.getElementById("btnPopupNotionSync");
    const connected = Boolean(popupNotionCfg.token && popupNotionCfg.targetUrl);
    if (badge) {
      badge.textContent = connected ? "🟢 실시간 자동저장 ON" : "⚪ 미연결";
      badge.style.color = connected ? "#6ee7b7" : "#94a3b8";
    }
    if (syncBtn) {
      const unsynced = currentList.filter((x) => !x.notionPageId).length;
      syncBtn.style.display = connected && unsynced > 0 ? "inline-block" : "none";
      syncBtn.textContent = `🔄 미전송(${unsynced})`;
    }
  }

  function escapeHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(
      ["njd_saved_vocab_v1", "njd_gemini_api_key_v1", "njd_last_session_v1", "njd_notion_config_v1"],
      (res) => {
        elApi.value = res.njd_gemini_api_key_v1 || "";
        popupNotionCfg = res.njd_notion_config_v1 || popupNotionCfg;
        document.getElementById("pNotionToken").value = popupNotionCfg.token || "";
        document.getElementById("pNotionUrl").value = popupNotionCfg.targetUrl || "";
        renderVocab(res.njd_saved_vocab_v1 || []);
        renderResume(res.njd_last_session_v1 || null);
        renderPopupNotionState();
      }
    );

    document.getElementById("btnPopupNotionConnect").addEventListener("click", () => {
      const tokenVal = String(document.getElementById("pNotionToken").value || "").trim().replace(/\s+/g, "");
      const urlVal = String(document.getElementById("pNotionUrl").value || "").trim();
      const msgEl = document.getElementById("pNotionMsg");
      if (!tokenVal || !urlVal) {
        msgEl.style.color = "#fca5a5";
        msgEl.textContent = "⚠️ 노션 API 토큰과 페이지 링크를 모두 입력해 주세요.";
        return;
      }
      const btn = document.getElementById("btnPopupNotionConnect");
      btn.disabled = true;
      btn.textContent = "연결 확인 중...";

      chrome.runtime.sendMessage(
        {
          type: "NJD_NOTION_CONNECT",
          token: tokenVal,
          targetUrl: urlVal,
          cachedDbId: urlVal === popupNotionCfg.targetUrl ? (popupNotionCfg.databaseId || "") : "",
          defaultTitle: "📚 넷플릭스 일본어 단어 · 문법장"
        },
        (resp) => {
          btn.disabled = false;
          btn.textContent = "🔌 노션 연결 & 표 생성";
          if (resp && resp.ok) {
            popupNotionCfg = {
              token: tokenVal,
              targetUrl: urlVal,
              databaseId: resp.databaseId || "",
              dbTitle: resp.dbTitle || "📚 넷플릭스 일본어 단어 · 문법장",
              autoSync: true
            };
            chrome.storage.local.set({ njd_notion_config_v1: popupNotionCfg }, () => {
              renderPopupNotionState();
              msgEl.style.color = "#6ee7b7";
              msgEl.textContent = `✓ '${popupNotionCfg.dbTitle}' 실시간 자동저장 연결 완료!`;
            });
          } else {
            msgEl.style.color = "#fca5a5";
            msgEl.textContent = `⚠️ ${(resp && resp.error) || "연결 실패"}`;
          }
        }
      );
    });

    document.getElementById("btnPopupNotionSync").addEventListener("click", () => {
      const pending = [];
      currentList.forEach((item, index) => {
        if (!item.notionPageId) pending.push({ index, item });
      });
      if (!pending.length) return;
      const syncBtn = document.getElementById("btnPopupNotionSync");
      const msgEl = document.getElementById("pNotionMsg");
      syncBtn.disabled = true;
      syncBtn.textContent = "전송 중...";
      chrome.runtime.sendMessage(
        {
          type: "NJD_NOTION_SYNC_BATCH",
          token: popupNotionCfg.token,
          targetUrl: popupNotionCfg.targetUrl,
          cachedDbId: popupNotionCfg.databaseId || "",
          defaultTitle: "📚 넷플릭스 일본어 단어 · 문법장",
          items: pending
        },
        (resp) => {
          syncBtn.disabled = false;
          if (resp && resp.ok && Array.isArray(resp.synced)) {
            resp.synced.forEach((s) => {
              if (currentList[s.index]) currentList[s.index].notionPageId = s.notionPageId;
            });
            chrome.storage.local.set({ njd_saved_vocab_v1: currentList }, () => {
              renderVocab(currentList);
              renderPopupNotionState();
              msgEl.style.color = "#6ee7b7";
              msgEl.textContent = `✓ ${resp.synced.length}개 항목을 노션에 일괄 전송했습니다!`;
            });
          } else {
            renderPopupNotionState();
            msgEl.style.color = "#fca5a5";
            msgEl.textContent = `⚠️ ${(resp && resp.error) || "전송 오류"}`;
          }
        }
      );
    });

    document.getElementById("btnSaveKey").addEventListener("click", () => {
      const clean = String(elApi.value || "")
        .trim()
        .replace(/^["']+|["']+$/g, "")
        .replace(/\s+/g, "");
      elApi.value = clean;
      chrome.storage.local.set({ njd_gemini_api_key_v1: clean }, () => {
        elMsg.textContent = "✓ 저장되었습니다!";
        setTimeout(() => { elMsg.textContent = ""; }, 2000);
      });
    });
  }
})();
