(function () {
  "use strict";

  // ==================== 1. Clean Kindle Citation & Extract Book Metadata ====================
  // Kindle for PC automatically appends a citation footer when copying (Ctrl+C), e.g.:
  // "Clear, James. Atomic Habits (p. 25). Avery. Kindle Edition."
  // or "Excerpt From: Yuval Noah Harari. Sapiens. Apple Books."
  function parseKindleClipboardRaw(rawText) {
    const normalized = String(rawText || "").replace(/\r\n/g, "\n").trim();
    if (!normalized) return { passage: "", bookMeta: "" };

    const lines = normalized
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length >= 2) {
      const lastLine = lines[lines.length - 1];
      const isKindleFooter =
        /Kindle Edition\.?$/i.test(lastLine) ||
        /\((?:p\.|pp\.|Page|Location|Loc\.?)\s*\d+/i.test(lastLine) ||
        /^Excerpt From:?/i.test(lastLine) ||
        /판권|저작권|All rights reserved/i.test(lastLine);

      if (isKindleFooter) {
        const bodyPassage = lines
          .slice(0, -1)
          .join(" ")
          .replace(/^["“”]+|["“”]+$/g, "")
          .replace(/\s+/g, " ")
          .trim();

        // Extract clean readable book title + page from Kindle footer
        let cleanBook = lastLine
          .replace(/\s*Kindle Edition\.?$/i, "")
          .replace(/^Excerpt From:?\s*/i, "")
          .trim();

        const pageMatch = lastLine.match(/\((?:p\.|pp\.|Page|Location|Loc\.?)\s*[\d-]+\)/i);
        // Temporarily remove "(p. 142)" before splitting on ". " so "p. 142" never splits mid-parenthesis!
        const withoutPage = pageMatch ? cleanBook.replace(pageMatch[0], "").replace(/\s+/g, " ").trim() : cleanBook;
        const parts = withoutPage.split(/\.\s+/).filter(Boolean);
        if (parts.length >= 2) {
          const candidateTitle = parts[1].replace(/\.$/, "").trim();
          cleanBook = pageMatch ? `${candidateTitle} ${pageMatch[0]}` : candidateTitle;
        }

        if (bodyPassage.length >= 3) {
          return { passage: bodyPassage, bookMeta: cleanBook };
        }
      }
    }

    return {
      passage: normalized.replace(/\s+/g, " ").trim(),
      bookMeta: ""
    };
  }

  // ==================== 2. Built-in Literary & Non-Fiction Vocabulary Dictionary ====================
  const BOOK_VOCAB_DB = [
    { regex: /\bcompound interest\b/i, term: "compound interest", pos: "명사구", meaning: "복리(이자), 눈덩이처럼 불어나는 누적 효과", nuance: "원서에서는 금융뿐 아니라 습관·지식이 시간과 함께 기하급수적으로 쌓이는 비유로 자주 쓰입니다." },
    { regex: /\bself-improvement\b/i, term: "self-improvement", pos: "명사", meaning: "자기계발, 자기 발전", nuance: "스스로의 습관·역량·인격을 꾸준히 개선하는 과정을 뜻합니다." },
    { regex: /\bimperceptible\b/i, term: "imperceptible", pos: "형용사", meaning: "감지할 수 없을 정도로 미세한", nuance: "당장 눈에는 안 보일 만큼 아주 서서히 일어나는 변화를 묘사할 때 원서에서 애용하는 고급 형용사입니다." },
    { regex: /\btrajectory\b/i, term: "trajectory", pos: "명사", meaning: "궤적, 나아가는 방향(진로)", nuance: "단기 점수가 아니라 인생이나 조직이 장기적으로 향하는 '방향성'을 말할 때 자주 등장합니다." },
    { regex: /\bdecisive\b/i, term: "decisive", pos: "형용사", meaning: "결정적인, 중대한 / 결단력 있는", nuance: "'decisive moment(결정적 순간)'처럼 결과를 가르는 핵심 분기점을 뜻합니다." },
    { regex: /\bthreshold\b/i, term: "threshold", pos: "명사", meaning: "임계점, 문턱, 새로운 단계의 시작점", nuance: "일정 수준까지 에너지가 쌓여 비로소 변화가 터져 나오는 '임계치'를 뜻하는 원서 필수 어휘입니다." },
    { regex: /\bvulnerable\b/i, term: "vulnerable", pos: "형용사", meaning: "상처받기 쉬운, 취약한, 연약한", nuance: "심리·문학 원서에서 타인의 비판이나 위험에 노출되어 쉽게 영향받는 상태를 묘사합니다." },
    { regex: /\bconsequence(?:s)?\b/i, term: "consequence", pos: "명사", meaning: "(행동에 따르는) 결과, 후폭풍, 중요성", nuance: "'of little consequence(별 중요치 않은)'라는 관용구로도 문학 작품에 자주 등장합니다." },
    { regex: /\bunreserved(?:ly)?\b/i, term: "unreservedly", pos: "부사", meaning: "기탄없이, 아낌없이, 숨김없이", nuance: "감정이나 비밀을 유보하지 않고 솔직하게 털어놓는 태도를 뜻합니다." },
    { regex: /\bprivy to\b/i, term: "be privy to ~", pos: "고급 숙어", meaning: "(남들이 모르는 비밀·내막을) 은밀히 알고 있다", nuance: "소설이나 역사서에서 소수만 공유하는 비밀 이야기를 접하게 되었을 때 쓰는 격식 표현입니다." },
    { regex: /\binevitabl(?:e|y)\b/i, term: "inevitable", pos: "형용사", meaning: "피할 수 없는, 필연적인", nuance: "논픽션·역사 원서에서 인과관계상 반드시 일어날 수밖에 없는 흐름을 강조할 때 쓰입니다." },
    { regex: /\bparadox(?:ical|ically)?\b/i, term: "paradox", pos: "명사", meaning: "역설, 모순되지만 진리를 담은 현상", nuance: "겉보기엔 앞뒤가 안 맞지만 깊이 들여다보면 핵심 진실을 담고 있는 상황을 가리킵니다." },
    { regex: /\bcognitive\b/i, term: "cognitive", pos: "형용사", meaning: "인지의, 사고·인식 과정의", nuance: "심리·과학 교양서(사피엔스 등)에서 인간의 뇌 작용과 사고 능력을 설명할 때 빠지지 않는 단어입니다." },
    { regex: /\bfiction(?:s|al)?\b/i, term: "shared fiction / fiction", pos: "명사", meaning: "허구, (집단이 공유하는) 상상의 믿음", nuance: "문학 장르뿐 아니라 국가·화폐·법률처럼 인간이 집단적 합의로 믿는 개념을 가리키기도 합니다." },
    { regex: /\bunprecedented\b/i, term: "unprecedented", pos: "형용사", meaning: "전례 없는, 사상 초유의", nuance: "역사상 이전에 단 한 번도 없었던 규모나 사건을 수식할 때 씁니다." },
    { regex: /\bcooperat(?:e|ion|ive)\b/i, term: "cooperate", pos: "동사", meaning: "협력하다, 협동하다", nuance: "'cooperate flexibly(유연하게 협력하다)'처럼 대규모 집단의 협업 능력을 설명할 때 자주 쓰입니다." },
    { regex: /\bsubtl(?:e|y|ety)\b/i, term: "subtle", pos: "형용사", meaning: "(차이·느낌이) 미묘한, 섬세한 (b 묵음: [써틀])", nuance: "철자 b가 발음되지 않으며, 눈치채기 힘들 만큼 세밀하고 은근한 뉘앙스를 뜻합니다." },
    { regex: /\bcontemplat(?:e|ed|ing|ion)\b/i, term: "contemplate", pos: "동사", meaning: "깊이 숙고하다, 가만히 응시하다", nuance: "단순히 생각하는 것을 넘어 조용히 오랜 시간 깊이 곱씹어 생각하는 문어체 동사입니다." },
    { regex: /\breluctant(?:ly)?\b/i, term: "reluctant", pos: "형용사", meaning: "꺼리는, 내키지 않아 하는, 마지못한", nuance: "'be reluctant to + 동사원형(~하기를 주저하다)' 패턴으로 소설 인물 심리 묘사에 자주 쓰입니다." },
    { regex: /\bsimultaneous(?:ly)?\b/i, term: "simultaneously", pos: "부사", meaning: "동시에, 일제히", nuance: "두 가지 사건이나 감정이 같은 순간에 겹쳐 일어날 때 사용합니다." },
    { regex: /\bin retrospect\b/i, term: "in retrospect", pos: "숙어", meaning: "돌이켜 생각해 보면, 회고해 보면", nuance: "과거의 사건을 시간이 흐른 뒤 지금 시점에서 되돌아보며 깨달음을 말할 때 씁니다." },
    { regex: /\btake\s+(?:\w+\s+)?for granted\b/i, term: "take ~ for granted", pos: "필수 관용구", meaning: "~을 당연하게 여기다 (고마움·가치를 잊다)", nuance: "원서 에세이·소설 모두에서 최빈출되는 핵심 관용 표현입니다." },
    { regex: /\bas a rule\b/i, term: "as a rule", pos: "관용구", meaning: "대체로, 원칙적으로, 평소 습관상", nuance: "'보통은 / 대개는'이라는 뜻으로 문두나 문미에 삽입되어 일반적 경향을 나타냅니다." },
    { regex: /\bturn(?:ed|s|ing)? out\b/i, term: "turn out (to be)", pos: "구동사", meaning: "(결국) ~인 것으로 밝혀지다, 드러나다", nuance: "예상과 다른 결과나 숨겨진 진실이 나중에 판명될 때 씁니다." },
    { regex: /\baccount for\b/i, term: "account for", pos: "구동사", meaning: "① (원인·이유를) 설명하다 ② (비율을) 차지하다", nuance: "논픽션 원서에서 문맥에 따라 두 가지 뜻으로 모두 매우 자주 쓰이는 핵심 구동사입니다." },
    { regex: /\bbring(?:s|ing)? about\b|\bbrought about\b/i, term: "bring about", pos: "구동사", meaning: "(변화·결과를) 초래하다, 불러일으키다", nuance: "'cause'보다 격식 있는 표현으로 사회적 변화나 사건의 원인을 서술할 때 씁니다." },
    { regex: /\bgive(?:s|n|ing)? rise to\b|\bgave rise to\b/i, term: "give rise to ~", pos: "고급 숙어", meaning: "~을 낳다, ~이 생겨나게 하다", nuance: "원서에서 새로운 현상·감정·사상의 탄생 배경을 설명할 때 자주 등장합니다." },
    { regex: /\bregardless of\b/i, term: "regardless of ~", pos: "전치사구", meaning: "~에 상관없이, ~을 불문하고", nuance: "조건이나 배경에 구애받지 않는 보편적 사실을 강조할 때 씁니다." },
    { regex: /\bnot so much\b[\s\S]+?\bas\b/i, term: "not so much A as B", pos: "원서 핵심 구문", meaning: "A라기보다는 오히려 B이다", nuance: "직역하면 헷갈리기 쉬우나 원서에서 저자의 핵심 주장을 정교하게 대비할 때 자주 나오는 고급 구문입니다." },
    { regex: /\bno matter (?:how|what|where|when|who)\b/i, term: "no matter + 의문사", pos: "복합관계 구문", meaning: "아무리 ~하더라도 / 무엇(어디·언제)이 ~하더라도", nuance: "양보 부사절을 이끌며 주절의 단호한 결론을 돋보이게 만듭니다." }
  ];

  // ==================== 3. Syntactic Slash-Chunker (끊어읽기 분해기) ====================
  function buildSlashChunks(text) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean) return [];

    // Split into sentences first, then split long sentences at natural syntactic boundaries
    const rawSentences = clean.match(/[^.!?]+[.!?]+["”']?|[^.!?]+$/g) || [clean];
    const chunks = [];

    const splitRegex =
      /(?<=[,;:])\s+|(?=\b(?:which|who|whom|whose|where|when|although|though|even though|whereas|while|because|since|unless|until|provided that|so that|as if|as though|whether)\b)/gi;

    rawSentences.forEach((sent) => {
      const s = sent.trim();
      if (!s) return;
      if (s.split(/\s+/).length <= 8) {
        chunks.push({ en: s, role: inferChunkRole(s) });
        return;
      }

      const subParts = s.split(splitRegex).map((p) => p.trim()).filter(Boolean);
      let buffer = "";
      subParts.forEach((part) => {
        const candidate = buffer ? `${buffer} ${part}` : part;
        if (candidate.split(/\s+/).length < 4) {
          buffer = candidate;
        } else {
          if (buffer) {
            chunks.push({ en: buffer, role: inferChunkRole(buffer) });
            buffer = part;
          } else {
            chunks.push({ en: part, role: inferChunkRole(part) });
          }
        }
      });
      if (buffer) {
        if (chunks.length > 0 && buffer.split(/\s+/).length <= 3) {
          chunks[chunks.length - 1].en += " " + buffer;
        } else {
          chunks.push({ en: buffer, role: inferChunkRole(buffer) });
        }
      }
    });

    return chunks.map((c) => ({
      en: c.en,
      ko: c.role
    }));
  }

  function inferChunkRole(chunk) {
    const c = chunk.trim();
    if (/^(?:which|who|whom|whose|where)\b/i.test(c)) {
      return "↳ [관계사절 수식] 앞 명사(또는 앞 내용)를 뒤에서 보충 설명하는 구간";
    }
    if (/^(?:although|though|even though|whereas|while)\b/i.test(c)) {
      return "↳ [양보·대조절] '비록 ~일지라도 / 반면에 ~이지만' 배경 대비 구간";
    }
    if (/^(?:because|since|as|for)\b/i.test(c)) {
      return "↳ [이유·배경절] '~하기 때문에 / ~함에 따라' 원인을 덧붙이는 구간";
    }
    if (/^(?:if|unless|once|whenever|when|until)\b/i.test(c)) {
      return "↳ [조건·시간 부사절] '~할 때 / 일단 ~하면' 전제 상황을 여는 구간";
    }
    if (/^[A-Za-z]+ing\b/i.test(c) && c.endsWith(",")) {
      return "↳ [분사구문 도입부] '~하면서 / ~한 채로' 주절의 동시 동작·배경 묘사";
    }
    if (/^to\s+[a-z]+\b/i.test(c)) {
      return "↳ [to부정사구] '~하기 위해서 / ~하는 것' 목적·결과 연결 구간";
    }
    if (/^(?:in|on|at|by|with|without|through|despite|from|for|under|over)\b/i.test(c) && c.endsWith(",")) {
      return "↳ [전치사구 배경] 문장 본론(주어+동사)이 나오기 전 시간·수단·상황 설정";
    }
    return "↳ [핵심 의미 덩어리] 주어·서술어 중심의 중심 서술 구간";
  }

  // ==================== 4. Deep Literary Sentence Structure Analyzer ====================
  function detectBookSentenceStructures(text) {
    const s = String(text || "").trim();
    const notes = [];

    if (/,\s*[a-z]+ing\b/i.test(s) || /^[A-Z][a-z]+ing\b[^.!?]+,/i.test(s)) {
      notes.push({
        title: "분사구문 (Participial Construction: ~, V-ing ...)",
        desc: "접속사와 주어를 생략하고 동사를 '-ing(현재분사)'로 바꿔 문장을 매끄럽게 이어주는 원서 대표 문어체 구조입니다. 앞 절의 동작과 동시에 일어나거나('~하면서'), 앞 내용의 자연스러운 결과('그 결과 ~하다')로 앞에서부터 순서대로 읽으면 됩니다."
      });
    }
    if (/\b(?:which|who|whom|whose|where)\b/i.test(s)) {
      notes.push({
        title: "관계사절 후치 수식 (명사 + who / which / whose / where ~)",
        desc: "영어 원서가 길어지는 가장 큰 이유입니다! 한국어처럼 길게 앞에서 꾸미지 않고, 먼저 핵심 명사를 던진 뒤 관계사로 이어 붙여 '그런데 그것은(그 사람은) ~하다'처럼 앞에서 뒤로 자연스럽게 풀어가며 읽으세요."
      });
    }
    if (/\bhad\s+[a-z]+ed\b/i.test(s) || /\bhad\s+(?:been|gone|seen|known|made|come|taken|given|told)\b/i.test(s)) {
      notes.push({
        title: "과거완료 시제 (had + p.p. — 대과거 / 가정법 과거완료)",
        desc: "소설·서사 원서의 기본 시제는 '과거형'이기 때문에, 이야기 기준 시점보다 '그 이전에 이미 일어난 사건'을 말할 때 'had + 과거분사(p.p.)'를 사용합니다."
      });
    }
    if (/\bnot\s+only\b[\s\S]+?\bbut\s+(?:also\s+)?/i.test(s) || /\bnot\s+so\s+much\b/i.test(s)) {
      notes.push({
        title: "상관 대조·강조 구문 (not only A but B / not so much A as B)",
        desc: "필자가 정말 강조하고 싶은 핵심 메시지는 항상 앞부분(A)이 아니라 뒷부분(B)에 놓입니다! B 구간에 힘을 주어 읽으면 문단 전체의 요지가 한눈에 들어옵니다."
      });
    }
    if (/;/.test(s) || /—|--/.test(s)) {
      notes.push({
        title: "원서 문장부호 독해법 — 세미콜론(;)과 대시(—)",
        desc: "원서에서 세미콜론(;)은 '마침표보다 가깝고 쉼표보다 명확한 접속사(즉 / 왜냐하면 / 반면에)' 역할을 하며, 긴 대시(—)는 앞 내용을 즉석에서 부연 설명하거나 극적으로 강조할 때 쓰입니다."
      });
    }
    if (/\bthe\s+(?:more|less|[a-z]+er)\b[\s\S]+?,\s*\bthe\s+(?:more|less|[a-z]+er)\b/i.test(s)) {
      notes.push({
        title: "비례 강조 구문 (The + 비교급 ~, the + 비교급 ...)",
        desc: "'~하면 할수록, 그만큼 더 ...하다'라는 비례 인과관계를 압축적으로 표현하는 원서 필수 구문입니다."
      });
    }
    if (/\bit\s+(?:is|was|seems|appears|turned out)\b[\s\S]+?\b(?:that|to\s+[a-z]+)\b/i.test(s)) {
      notes.push({
        title: "가주어(It) — 진주어(that절 / to부정사) 또는 It ~ that 강조구문",
        desc: "주어가 길어지는 것을 피하기 위해 문두에 형식 주어 'It'을 먼저 세우고 진짜 핵심 내용을 뒤의 'that절' 또는 'to부정사구'에 배치한 구조입니다."
      });
    }

    if (notes.length === 0) {
      notes.push({
        title: "주절(주어 + 본동사) 중심 끊어읽기 구문 분석",
        desc: "원서의 긴 문장을 만났을 때는 전치사구(in/on/with/through ~)나 부사절을 괄호로 묶어 덜어내고, '누가(주어 S) + 어쨌다(본동사 V)'라는 중심 뼈대를 먼저 잡는 것이 핵심입니다."
      });
    }

    return notes;
  }

  function extractOfflineVocab(text) {
    const found = [];
    for (const entry of BOOK_VOCAB_DB) {
      if (entry.regex.test(text)) {
        found.push({
          term: entry.term,
          typeLabel: entry.pos,
          meaning: entry.meaning,
          nuance: entry.nuance
        });
      }
      if (found.length >= 6) break;
    }

    // Also pick notable long academic/literary words (>= 8 chars) if fewer than 3 matched
    if (found.length < 3) {
      const commonSkip = new Set([
        "something", "everything", "anything", "everyone", "themselves",
        "therefore", "sometimes", "different", "important", "understand",
        "remembered", "continued", "following", "questions"
      ]);
      const words = String(text || "").match(/\b[a-zA-Z]{8,}\b/g) || [];
      for (const rawW of words) {
        const lower = rawW.toLowerCase();
        if (commonSkip.has(lower)) continue;
        if (found.some((f) => f.term.toLowerCase().includes(lower))) continue;
        found.push({
          term: lower,
          typeLabel: "원서 어휘",
          meaning: "문맥 속 핵심 장문 어휘 (상단 [✨ AI 원서 정밀 해설] 연결 시 모든 단어 뜻·발음·어원까지 즉시 풀이됩니다)",
          nuance: `원문 등장 형태: "${rawW}"`
        });
        if (found.length >= 4) break;
      }
    }

    return found;
  }

  function analyzeOfflinePassage(passageText) {
    const chunks = buildSlashChunks(passageText);
    const structures = detectBookSentenceStructures(passageText);
    const vocab = extractOfflineVocab(passageText);

    return {
      isAi: false,
      koFull:
        "💡 우측 상단 [✨ 원서 AI 키 설정]에 무료 Gemini 키를 입력하면 모든 킨들 원서 문장의 자연스러운 한국어 번역과 끊어읽기 직독직해가 0.8초 만에 자동 생성됩니다! (현재는 내장 오프라인 구문·어휘 분석 결과입니다.)",
      chunks,
      backbone: `총 ${chunks.length}개 의미 덩어리(Sense Groups)로 구성된 문장입니다. 앞 덩어리부터 순서대로 의미를 쌓아가며 읽어보세요.`,
      grammarList: structures,
      vocab
    };
  }

  window.KINDLE_ANALYZER = {
    parseKindleClipboardRaw,
    analyzeOfflinePassage
  };
})();
