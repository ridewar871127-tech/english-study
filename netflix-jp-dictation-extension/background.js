"use strict";

let cachedGeminiModel = "";
let cachedModelList = [];
let cachedForKeyPrefix = "";

function sanitizeKey(raw) {
  return String(raw || "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .replace(/\s+/g, "");
}

function extractCleanJson(rawText) {
  let s = String(rawText || "").trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const firstBrace = s.indexOf("{");
  const lastBrace = s.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    s = s.slice(firstBrace, lastBrace + 1);
  }
  return JSON.parse(s);
}

function sortModelsForSpeed(models) {
  const copy = models.slice();
  copy.sort((a, b) => {
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
  return copy.map((m) => m.name);
}

async function ensureModelCandidates(apiKey) {
  const prefix = apiKey.slice(0, 10);
  if (cachedGeminiModel && cachedForKeyPrefix === prefix) {
    return [cachedGeminiModel, ...cachedModelList.filter((n) => n !== cachedGeminiModel)];
  }

  const listResp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
  );
  const listData = await listResp.json();
  if (!listResp.ok || listData.error) {
    throw new Error(`API 키 인증 실패 (${listData?.error?.message || `HTTP ${listResp.status}`})`);
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
  cachedModelList = sortModelsForSpeed(flashModels.length > 0 ? flashModels : models);
  cachedForKeyPrefix = prefix;
  return cachedModelList.length > 0 ? cachedModelList : ["models/gemini-flash-lite-latest"];
}

function buildGenerationConfig(modelName, useMinimalThinking) {
  const cfg = { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 1500 };
  if (!useMinimalThinking) return cfg;
  const ver = parseFloat((modelName.match(/gemini-(\d+(?:\.\d+)?)/i) || [0, "0"])[1]);
  if (!/flash-lite/i.test(modelName)) {
    if (ver >= 3) cfg.thinkingConfig = { thinkingLevel: "minimal" };
    else if (ver >= 2.5) cfg.thinkingConfig = { thinkingBudget: 0 };
  }
  return cfg;
}

async function tryGenerateWithModel(apiKey, modelName, prompt, useMinimalThinking) {
  const url = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: buildGenerationConfig(modelName, useMinimalThinking)
    })
  });
  const data = await resp.json();
  return { resp, data };
}

async function callGemini(apiKey, prompt) {
  const prefix = apiKey.slice(0, 10);
  const candidates = await ensureModelCandidates(apiKey);
  let lastError = "사용 가능한 Gemini 모델을 찾지 못했습니다.";

  for (const modelName of candidates.slice(0, 4)) {
    try {
      let { resp, data } = await tryGenerateWithModel(apiKey, modelName, prompt, true);
      if (resp.status === 400 && !/flash-lite/i.test(modelName)) {
        ({ resp, data } = await tryGenerateWithModel(apiKey, modelName, prompt, false));
      }
      if (!resp.ok || data.error) {
        lastError = data?.error?.message || `HTTP ${resp.status}`;
        continue;
      }
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const answerPart =
        parts.find((p) => !p.thought && typeof p.text === "string" && p.text.includes("{")) ||
        parts.find((p) => !p.thought && typeof p.text === "string") ||
        parts[parts.length - 1];
      if (!answerPart || !answerPart.text) continue;

      const parsed = extractCleanJson(answerPart.text);
      cachedGeminiModel = modelName;
      cachedForKeyPrefix = prefix;
      return { parsed, modelUsed: modelName.replace(/^models\//, "") };
    } catch (e) {
      lastError = e && e.message ? e.message : String(e);
    }
  }
  cachedGeminiModel = "";
  throw new Error(lastError);
}

async function callOpenAI(apiKey, prompt) {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 1400,
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
  return { parsed: extractCleanJson(data?.choices?.[0]?.message?.content || ""), modelUsed: "gpt-4o-mini" };
}

// ==================== Notion Real-Time Auto-Sync Engine (Japanese) ====================
const NOTION_VERSION = "2022-06-28";
const DEFAULT_JP_DB_TITLE = "📚 넷플릭스 일본어 단어 · 문법장";

function extractNotionUuid(raw) {
  const cleanPath = String(raw || "").trim().split("?")[0].split("#")[0];
  const matches = cleanPath.replace(/-/g, "").match(/[0-9a-fA-F]{32}/g);
  if (!matches || matches.length === 0) return "";
  const hex = matches[matches.length - 1].toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function safeText(str, maxLen) {
  return String(str || "").trim().slice(0, maxLen || 1900);
}

function extractPlainTitle(titleArr) {
  if (!Array.isArray(titleArr)) return "";
  return titleArr.map((t) => t.plain_text || t?.text?.content || "").join("").trim();
}

async function notionRequest(token, method, path, body) {
  const cleanToken = sanitizeKey(token);
  if (!cleanToken) throw new Error("노션 연동 토큰(API 키)을 입력해 주세요.");
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${cleanToken}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json"
    }
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const resp = await fetch(`https://api.notion.com/v1${path}`, opts);
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}

function getDesiredDbSchemaProperties() {
  return {
    "구분": {
      select: {
        options: [
          { name: "명사", color: "blue" },
          { name: "동사", color: "purple" },
          { name: "형용사·부사", color: "green" },
          { name: "조사·조동사", color: "orange" },
          { name: "관용구·회화", color: "pink" },
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

async function inspectAndPrepareDatabase(token, dbId, dbObjOverride) {
  const dbRes = dbObjOverride
    ? { ok: true, data: dbObjOverride }
    : await notionRequest(token, "GET", `/databases/${dbId}`);
  if (!dbRes.ok || !dbRes.data || dbRes.data.archived || dbRes.data.in_trash) return null;

  const props = dbRes.data.properties || {};
  let titlePropName = "단어(요미가나) / 문법";
  for (const [k, v] of Object.entries(props)) {
    if (v && v.type === "title") {
      titlePropName = k;
      break;
    }
  }

  const desired = getDesiredDbSchemaProperties();
  const missingPatch = {};
  let hasMissing = false;
  for (const [colName, colDef] of Object.entries(desired)) {
    if (!props[colName]) {
      missingPatch[colName] = colDef;
      hasMissing = true;
    }
  }
  if (hasMissing) {
    await notionRequest(token, "PATCH", `/databases/${dbId}`, { properties: missingPatch });
  }

  return {
    databaseId: dbRes.data.id,
    titlePropName,
    dbTitle: extractPlainTitle(dbRes.data.title) || DEFAULT_JP_DB_TITLE,
    dbUrl: dbRes.data.url || ""
  };
}

async function ensureNotionDatabase(token, targetUrlOrId, cachedDbId, defaultTitle) {
  const dbTitleToCreate = defaultTitle || DEFAULT_JP_DB_TITLE;
  if (cachedDbId) {
    const cleanCached = extractNotionUuid(cachedDbId);
    if (cleanCached) {
      const prepared = await inspectAndPrepareDatabase(token, cleanCached);
      if (prepared) return prepared;
    }
  }

  const targetUuid = extractNotionUuid(targetUrlOrId);
  if (!targetUuid) {
    throw new Error("노션 페이지 주소(URL)에서 32자리 ID를 찾지 못했습니다. [공유] → [링크 복사]한 주소를 붙여넣어 주세요.");
  }

  const asDb = await notionRequest(token, "GET", `/databases/${targetUuid}`);
  if (asDb.ok && asDb.data && !asDb.data.archived && !asDb.data.in_trash) {
    const prepared = await inspectAndPrepareDatabase(token, targetUuid, asDb.data);
    if (prepared) return prepared;
  }
  if (asDb.status === 401) throw new Error("노션 API 토큰이 올바르지 않습니다.");

  const asPage = await notionRequest(token, "GET", `/pages/${targetUuid}`);
  if (asPage.status === 401) throw new Error("노션 API 토큰이 올바르지 않습니다.");
  if (!asPage.ok) {
    throw new Error("노션 페이지에 접근할 수 없습니다! 페이지 우측 상단 [•••] → [연결]에서 통합(Integration)을 먼저 추가해 주세요.");
  }

  const childrenRes = await notionRequest(token, "GET", `/blocks/${targetUuid}/children?page_size=50`);
  if (childrenRes.ok && Array.isArray(childrenRes.data?.results)) {
    const existingChildDb = childrenRes.data.results.find(
      (b) =>
        b &&
        b.type === "child_database" &&
        !b.archived &&
        !b.in_trash &&
        b.child_database &&
        (b.child_database.title === dbTitleToCreate || /일본어.*문법장/i.test(b.child_database.title || ""))
    );
    if (existingChildDb) {
      const reused = await inspectAndPrepareDatabase(token, existingChildDb.id);
      if (reused) return reused;
    }
  }

  const createdDb = await notionRequest(token, "POST", "/databases", {
    parent: { type: "page_id", page_id: targetUuid },
    title: [{ type: "text", text: { content: dbTitleToCreate } }],
    properties: Object.assign({ "단어(요미가나) / 문법": { title: {} } }, getDesiredDbSchemaProperties())
  });
  if (!createdDb.ok) {
    throw new Error(`노션 표 자동 생성 실패: ${createdDb.data?.message || `HTTP ${createdDb.status}`}`);
  }

  return {
    databaseId: createdDb.data.id,
    titlePropName: "단어(요미가나) / 문법",
    dbTitle: dbTitleToCreate,
    dbUrl: createdDb.data.url || ""
  };
}

async function createNotionVocabRow(token, dbInfo, item) {
  const categoryRaw = item.kind === "grammar" ? "문법 포인트" : (item.typeLabel || "표현");
  const safeCategory = safeText(categoryRaw.replace(/,/g, "·"), 80) || "표현";
  const isoDate = (item.savedAt || new Date().toISOString()).slice(0, 10);

  const created = await notionRequest(token, "POST", "/pages", {
    parent: { database_id: dbInfo.databaseId },
    properties: {
      [dbInfo.titlePropName]: { title: [{ text: { content: safeText(item.term || "(무제)", 300) } }] },
      "구분": { select: { name: safeCategory } },
      "뜻 · 해설": { rich_text: item.meaning ? [{ text: { content: safeText(item.meaning, 1900) } }] : [] },
      "뉘앙스 · 해석": { rich_text: item.nuance ? [{ text: { content: safeText(item.nuance, 1900) } }] : [] },
      "원문 대사": { rich_text: item.sentence ? [{ text: { content: safeText(item.sentence, 1900) } }] : [] },
      "작품명": { rich_text: item.show ? [{ text: { content: safeText(item.show, 300) } }] : [] },
      "저장일": { date: { start: /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? isoDate : new Date().toISOString().slice(0, 10) } },
      "암기 완료": { checkbox: false }
    }
  });
  if (!created.ok) throw new Error(created.data?.message || `노션 저장 오류 (HTTP ${created.status})`);
  return { notionPageId: created.data.id, pageUrl: created.data.url || "" };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === "NJD_AI_ANALYZE") {
    (async () => {
      try {
        const key = sanitizeKey(message.apiKey);
        if (!key) {
          sendResponse({ ok: false, error: "저장된 API 키가 없습니다." });
          return;
        }
        const result = key.startsWith("sk-")
          ? await callOpenAI(key, message.prompt)
          : await callGemini(key, message.prompt);
        sendResponse({ ok: true, data: result.parsed, modelUsed: result.modelUsed });
      } catch (err) {
        sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
      }
    })();
    return true;
  }

  if (message.type === "NJD_NOTION_CONNECT") {
    (async () => {
      try {
        const dbInfo = await ensureNotionDatabase(message.token, message.targetUrl, message.cachedDbId || "", message.defaultTitle);
        sendResponse(Object.assign({ ok: true }, dbInfo));
      } catch (err) {
        sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
      }
    })();
    return true;
  }

  if (message.type === "NJD_NOTION_PUSH_ITEM") {
    (async () => {
      try {
        const dbInfo = await ensureNotionDatabase(message.token, message.targetUrl, message.cachedDbId || "", message.defaultTitle);
        const row = await createNotionVocabRow(message.token, dbInfo, message.item || {});
        sendResponse({ ok: true, notionPageId: row.notionPageId, databaseId: dbInfo.databaseId, dbTitle: dbInfo.dbTitle });
      } catch (err) {
        sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
      }
    })();
    return true;
  }

  if (message.type === "NJD_NOTION_SYNC_BATCH") {
    (async () => {
      try {
        const dbInfo = await ensureNotionDatabase(message.token, message.targetUrl, message.cachedDbId || "", message.defaultTitle);
        const items = Array.isArray(message.items) ? message.items : [];
        const synced = [];
        for (let i = items.length - 1; i >= 0; i--) {
          const entry = items[i];
          if (!entry || !entry.item) continue;
          const row = await createNotionVocabRow(message.token, dbInfo, entry.item);
          synced.push({ index: entry.index, notionPageId: row.notionPageId });
        }
        sendResponse({ ok: true, synced, databaseId: dbInfo.databaseId, dbTitle: dbInfo.dbTitle });
      } catch (err) {
        sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
      }
    })();
    return true;
  }

  if (message.type === "NJD_NOTION_ARCHIVE_PAGE") {
    (async () => {
      try {
        if (message.notionPageId) {
          await notionRequest(message.token, "PATCH", `/pages/${message.notionPageId}`, { archived: true });
        }
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
      }
    })();
    return true;
  }

  return false;
});
