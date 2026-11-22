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

// Sort models for MINIMUM LATENCY:
// 1st priority: newest flash-lite (e.g. gemini-3.5-flash-lite — minimal thinking by default, ~0.7s response!)
// 2nd priority: newest standard flash (with minimal thinking config)
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
  // Fast path: NEVER re-fetch /v1beta/models once cached! Saves ~700ms on every request!
  if (cachedGeminiModel && cachedForKeyPrefix === prefix) {
    return [cachedGeminiModel, ...cachedModelList.filter((n) => n !== cachedGeminiModel)];
  }

  const listResp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
  );
  const listData = await listResp.json();

  if (!listResp.ok || listData.error) {
    const errMsg = listData?.error?.message || `HTTP ${listResp.status}`;
    throw new Error(`API 키 인증 실패 (${errMsg})`);
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
  cachedModelList = sortModelsForSpeed(pool);
  cachedForKeyPrefix = prefix;

  return cachedModelList.length > 0 ? cachedModelList : ["models/gemini-flash-lite-latest"];
}

function buildGenerationConfig(modelName, useMinimalThinking) {
  const cfg = {
    responseMimeType: "application/json",
    temperature: 0.2,
    maxOutputTokens: 600
  };
  if (!useMinimalThinking) return cfg;

  const ver = parseFloat((modelName.match(/gemini-(\d+(?:\.\d+)?)/i) || [0, "0"])[1]);
  // Flash-lite already defaults to minimal thinking; for heavier Flash models, minimize CoT latency:
  if (!/flash-lite/i.test(modelName)) {
    if (ver >= 3) {
      cfg.thinkingConfig = { thinkingLevel: "minimal" };
    } else if (ver >= 2.5) {
      cfg.thinkingConfig = { thinkingBudget: 0 };
    }
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
  const tryList = candidates.slice(0, 4);
  let lastError = "사용 가능한 Gemini 모델을 찾지 못했습니다.";

  for (const modelName of tryList) {
    try {
      let { resp, data } = await tryGenerateWithModel(apiKey, modelName, prompt, true);

      // If a specific model snapshot rejects thinkingConfig (HTTP 400), immediately retry plain config
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

      if (!answerPart || !answerPart.text) {
        lastError = "응답 텍스트가 비어 있습니다.";
        continue;
      }

      const parsed = extractCleanJson(answerPart.text);
      cachedGeminiModel = modelName;
      cachedForKeyPrefix = prefix;

      return {
        parsed,
        modelUsed: modelName.replace(/^models\//, "")
      };
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
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
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
  const rawText = data?.choices?.[0]?.message?.content;
  if (!rawText) throw new Error("OpenAI 응답 본문이 비어 있습니다.");
  return {
    parsed: extractCleanJson(rawText),
    modelUsed: "gpt-4o-mini"
  };
}

// ==================== Notion Real-Time Auto-Sync Engine ====================
const NOTION_VERSION = "2022-06-28";
const DEFAULT_EN_DB_TITLE = "📚 넷플릭스 영어 단어 · 문법장";

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
  if (!cleanToken) {
    throw new Error("노션 연동 토큰(API 키)을 입력해 주세요.");
  }
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${cleanToken}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json"
    }
  };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }
  const resp = await fetch(`https://api.notion.com/v1${path}`, opts);
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}

function getDesiredDbSchemaProperties() {
  return {
    "구분": {
      select: {
        options: [
          { name: "구동사", color: "purple" },
          { name: "관용어/슬랭", color: "pink" },
          { name: "핵심 어휘", color: "blue" },
          { name: "회화 표현", color: "green" },
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

  if (!dbRes.ok || !dbRes.data || dbRes.data.archived || dbRes.data.in_trash) {
    return null;
  }

  const props = dbRes.data.properties || {};
  let titlePropName = "표현 / 문법";
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
    dbTitle: extractPlainTitle(dbRes.data.title) || DEFAULT_EN_DB_TITLE,
    dbUrl: dbRes.data.url || ""
  };
}

async function ensureNotionDatabase(token, targetUrlOrId, cachedDbId, defaultTitle) {
  const dbTitleToCreate = defaultTitle || DEFAULT_EN_DB_TITLE;

  // 1. Fast path: reuse already-verified databaseId if still active
  if (cachedDbId) {
    const cleanCached = extractNotionUuid(cachedDbId);
    if (cleanCached) {
      const prepared = await inspectAndPrepareDatabase(token, cleanCached);
      if (prepared) return prepared;
    }
  }

  const targetUuid = extractNotionUuid(targetUrlOrId);
  if (!targetUuid) {
    throw new Error(
      "노션 페이지 주소(URL)에서 32자리 페이지 ID를 찾지 못했습니다. 노션 우측 상단 [공유] → [링크 복사]한 주소를 그대로 붙여넣어 주세요."
    );
  }

  // 2. Check if targetUuid itself is an existing Notion Database
  const asDb = await notionRequest(token, "GET", `/databases/${targetUuid}`);
  if (asDb.ok && asDb.data && !asDb.data.archived && !asDb.data.in_trash) {
    const prepared = await inspectAndPrepareDatabase(token, targetUuid, asDb.data);
    if (prepared) return prepared;
  }
  if (asDb.status === 401) {
    throw new Error("노션 API 토큰이 올바르지 않습니다. 'ntn_...' 또는 'secret_...' 키 전체를 확인해 주세요.");
  }

  // 3. Otherwise treat targetUuid as a Notion Page and reuse/create our study Database inside it!
  const asPage = await notionRequest(token, "GET", `/pages/${targetUuid}`);
  if (asPage.status === 401) {
    throw new Error("노션 API 토큰이 올바르지 않습니다. 'ntn_...' 또는 'secret_...' 키 전체를 확인해 주세요.");
  }
  if (!asPage.ok) {
    throw new Error(
      "노션 페이지에 접근할 수 없습니다! 연결할 노션 페이지 우측 상단 [•••] → [연결(Connections)]에서 통합(Integration)을 먼저 추가해 주세요."
    );
  }

  // If the user pasted a row inside a database, use its parent database!
  if (asPage.data?.parent?.type === "database_id" && asPage.data.parent.database_id) {
    const parentPrepared = await inspectAndPrepareDatabase(token, asPage.data.parent.database_id);
    if (parentPrepared) return parentPrepared;
  }

  // Check child blocks first so we reuse an existing study database on the same page instead of duplicating
  const childrenRes = await notionRequest(token, "GET", `/blocks/${targetUuid}/children?page_size=50`);
  if (childrenRes.ok && Array.isArray(childrenRes.data?.results)) {
    const existingChildDb = childrenRes.data.results.find(
      (b) =>
        b &&
        b.type === "child_database" &&
        !b.archived &&
        !b.in_trash &&
        b.child_database &&
        (b.child_database.title === dbTitleToCreate ||
          /단어.*문법장|Dictation/i.test(b.child_database.title || ""))
    );
    if (existingChildDb) {
      const reused = await inspectAndPrepareDatabase(token, existingChildDb.id);
      if (reused) return reused;
    }
  }

  // Create a brand-new ready-to-study Notion Database inside the page!
  const createBody = {
    parent: { type: "page_id", page_id: targetUuid },
    title: [{ type: "text", text: { content: dbTitleToCreate } }],
    properties: Object.assign(
      { "표현 / 문법": { title: {} } },
      getDesiredDbSchemaProperties()
    )
  };

  const createdDb = await notionRequest(token, "POST", "/databases", createBody);
  if (!createdDb.ok) {
    throw new Error(
      `노션 표 자동 생성 실패: ${createdDb.data?.message || `HTTP ${createdDb.status}`}`
    );
  }

  return {
    databaseId: createdDb.data.id,
    titlePropName: "표현 / 문법",
    dbTitle: dbTitleToCreate,
    dbUrl: createdDb.data.url || ""
  };
}

async function createNotionVocabRow(token, dbInfo, item) {
  const categoryRaw = item.kind === "grammar" ? "문법 포인트" : (item.typeLabel || "표현");
  const safeCategory = safeText(categoryRaw.replace(/,/g, "·"), 80) || "표현";
  const isoDate = (item.savedAt || new Date().toISOString()).slice(0, 10);

  const properties = {
    [dbInfo.titlePropName]: {
      title: [{ text: { content: safeText(item.term || "(무제)", 300) } }]
    },
    "구분": {
      select: { name: safeCategory }
    },
    "뜻 · 해설": {
      rich_text: item.meaning ? [{ text: { content: safeText(item.meaning, 1900) } }] : []
    },
    "뉘앙스 · 해석": {
      rich_text: item.nuance ? [{ text: { content: safeText(item.nuance, 1900) } }] : []
    },
    "원문 대사": {
      rich_text: item.sentence ? [{ text: { content: safeText(item.sentence, 1900) } }] : []
    },
    "작품명": {
      rich_text: item.show ? [{ text: { content: safeText(item.show, 300) } }] : []
    },
    "저장일": {
      date: { start: /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? isoDate : new Date().toISOString().slice(0, 10) }
    },
    "암기 완료": {
      checkbox: false
    }
  };

  const created = await notionRequest(token, "POST", "/pages", {
    parent: { database_id: dbInfo.databaseId },
    properties
  });

  if (!created.ok) {
    throw new Error(created.data?.message || `노션 저장 오류 (HTTP ${created.status})`);
  }

  return {
    notionPageId: created.data.id,
    pageUrl: created.data.url || ""
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === "ND_AI_ANALYZE") {
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

  if (message.type === "ND_NOTION_CONNECT") {
    (async () => {
      try {
        const dbInfo = await ensureNotionDatabase(
          message.token,
          message.targetUrl,
          message.cachedDbId || "",
          message.defaultTitle || DEFAULT_EN_DB_TITLE
        );
        sendResponse(Object.assign({ ok: true }, dbInfo));
      } catch (err) {
        sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
      }
    })();
    return true;
  }

  if (message.type === "ND_NOTION_PUSH_ITEM") {
    (async () => {
      try {
        const dbInfo = await ensureNotionDatabase(
          message.token,
          message.targetUrl,
          message.cachedDbId || "",
          message.defaultTitle || DEFAULT_EN_DB_TITLE
        );
        const row = await createNotionVocabRow(message.token, dbInfo, message.item || {});
        sendResponse({
          ok: true,
          notionPageId: row.notionPageId,
          databaseId: dbInfo.databaseId,
          dbTitle: dbInfo.dbTitle
        });
      } catch (err) {
        sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
      }
    })();
    return true;
  }

  if (message.type === "ND_NOTION_SYNC_BATCH") {
    (async () => {
      try {
        const dbInfo = await ensureNotionDatabase(
          message.token,
          message.targetUrl,
          message.cachedDbId || "",
          message.defaultTitle || DEFAULT_EN_DB_TITLE
        );
        const items = Array.isArray(message.items) ? message.items : [];
        const synced = [];
        // Sync chronologically (oldest first so newest appears at top in Notion default view)
        for (let i = items.length - 1; i >= 0; i--) {
          const entry = items[i];
          if (!entry || !entry.item) continue;
          const row = await createNotionVocabRow(message.token, dbInfo, entry.item);
          synced.push({ index: entry.index, notionPageId: row.notionPageId });
        }
        sendResponse({
          ok: true,
          synced,
          databaseId: dbInfo.databaseId,
          dbTitle: dbInfo.dbTitle
        });
      } catch (err) {
        sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
      }
    })();
    return true;
  }

  if (message.type === "ND_NOTION_ARCHIVE_PAGE") {
    (async () => {
      try {
        if (!message.notionPageId) {
          sendResponse({ ok: true });
          return;
        }
        await notionRequest(message.token, "PATCH", `/pages/${message.notionPageId}`, {
          archived: true
        });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
      }
    })();
    return true;
  }

  return false;
});
