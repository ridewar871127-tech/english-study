(function () {
  "use strict";

  const segmenter =
    typeof Intl !== "undefined" && Intl.Segmenter
      ? new Intl.Segmenter("ja", { granularity: "word" })
      : null;

  const PARTICLES = new Set([
    "は", "が", "を", "に", "で", "と", "へ", "も", "の", "や",
    "から", "まで", "より", "だけ", "しか", "ばかり", "ばっか", "ほど",
    "くらい", "ぐらい", "こそ", "さえ", "でも", "とか", "なんて",
    "とは", "には", "では", "への", "からの", "までの", "って",
    "ね", "よ", "か", "な", "わ", "ぞ", "ぜ", "さ", "かしら", "っけ",
    "よね", "かな", "かも", "かい", "だい"
  ]);

  const INFLECTION_SUFFIXES = new Set([
    "まし", "ました", "ます", "ません", "ませんでした", "ましょう", "ませ",
    "した", "して", "しま", "しまい", "しまっ",
    "ん", "た", "だ", "っ", "て", "で",
    "ちゃ", "ちゃっ", "ちゃう", "ちゃい", "ちゃった", "じゃ", "じゃっ", "じゃう", "じゃい", "じゃった",
    "てる", "てた", "てい", "ている", "ていた", "でる", "でた", "でい", "でいる",
    "とく", "とこう", "といた", "どく", "どいた",
    "なきゃ", "なくちゃ", "なけりゃ",
    "ない", "なかっ", "なかった", "なく", "ぬ", "ず",
    "たい", "たかっ", "たかった", "たく", "たがる",
    "れる", "れ", "られる", "られ", "せる", "せ", "させる", "させ",
    "よう", "う", "まい", "そう", "すぎ", "すぎる", "すぎた",
    "ください", "なさい", "っぱなし", "ながら", "たり", "だり"
  ]);

  const BUNSETSU_ATTACH = new Set([
    "です", "でした", "だ", "だった", "だろう", "でしょう", "じゃん", "じゃない", "じゃなかった", "なんだ", "なんです"
  ]);

  function rawSegment(sentence) {
    const cleaned = String(sentence || "")
      .replace(/[。、．，！？!?…―ー～「」『』（）()［］\[\]【】・\s\u3000]/g, (m) =>
        m === "ー" ? "ー" : ""
      )
      .trim();
    if (!cleaned) return [];
    if (!segmenter) return Array.from(cleaned);

    const out = [];
    for (const seg of segmenter.segment(cleaned)) {
      if (seg.isWordLike || /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf0-9a-zA-Zー]/.test(seg.segment)) {
        const token = seg.segment.trim();
        if (token) out.push(token);
      }
    }
    return out;
  }

  function mergeInflections(inputTokens) {
    const rawTokens = [];
    for (let i = 0; i < inputTokens.length; i++) {
      const cur = inputTokens[i];
      const nxt = inputTokens[i + 1];
      if (cur === "ま" && (nxt === "した" || nxt === "せん" || nxt === "しょう" || nxt === "す" || nxt === "し")) {
        rawTokens.push(cur + nxt);
        i++;
      } else {
        rawTokens.push(cur);
      }
    }

    const merged = [];
    for (let i = 0; i < rawTokens.length; i++) {
      const tok = rawTokens[i];
      const prev = merged[merged.length - 1];

      if (!prev) {
        merged.push(tok);
        continue;
      }

      const prevIsCaseParticle = ["は", "が", "を", "に", "へ", "と", "から", "まで", "より", "も", "の"].includes(prev);

      if (
        !prevIsCaseParticle &&
        (INFLECTION_SUFFIXES.has(tok) ||
          prev.endsWith("っ") ||
          ((prev === "し" || prev === "き" || prev === "こ" || prev === "い") && !PARTICLES.has(tok) && INFLECTION_SUFFIXES.has(tok)))
      ) {
        merged[merged.length - 1] = prev + tok;
        continue;
      }

      if (prev.endsWith("ん") && (tok === "です" || tok === "だ" || tok === "でした" || tok === "だった")) {
        merged[merged.length - 1] = prev + tok;
        continue;
      }

      merged.push(tok);
    }
    return merged;
  }

  function segmentJapanese(sentence, mode) {
    const raw = rawSegment(sentence);
    const splitTokens = mergeInflections(raw);
    if (mode === "split") {
      return splitTokens;
    }

    const bunsetsu = [];
    for (let i = 0; i < splitTokens.length; i++) {
      const tok = splitTokens[i];
      if (bunsetsu.length > 0 && (PARTICLES.has(tok) || BUNSETSU_ATTACH.has(tok))) {
        bunsetsu[bunsetsu.length - 1] += tok;
      } else {
        bunsetsu.push(tok);
      }
    }

    if (bunsetsu.length === 1 && splitTokens.length >= 2) {
      return splitTokens;
    }
    return bunsetsu;
  }

  function shuffleTokensWithIds(tokens) {
    const items = tokens.map((word, idx) => ({ id: idx, word }));
    if (items.length <= 1) return items;

    const allSame = items.every((x) => x.word === items[0].word);
    if (allSame) return items;

    for (let attempt = 0; attempt < 8; attempt++) {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = items[i];
        items[i] = items[j];
        items[j] = tmp;
      }
      const sameOrder = items.every((x, idx) => x.word === tokens[idx]);
      if (!sameOrder) break;
    }
    return items;
  }

  // ==================== Beginner Core Word & Particle Dictionary (Offline Fallback) ====================
  const CORE_WORD_DICT = {
    // Particles (조사)
    "は": { reading: "わ (와)", pos: "보조사", meaning: "~은/는 (문장의 주제 표시)", nuance: "철자는 'は(하)'이지만 조사로 쓰일 때는 반드시 [와(わ)]로 발음합니다!" },
    "が": { reading: "が (가)", pos: "주격조사", meaning: "~이/가 (주어 강조 · 새로운 정보)", nuance: "누가/무엇이 그랬는지 주체를 콕 집어 말하거나 감정·가능 표현 앞에 씁니다." },
    "を": { reading: "お (오)", pos: "목적격조사", meaning: "~을/를 (동작의 목적어)", nuance: "동사가 작용하는 대상을 나타내며 발음은 [오]와 같습니다." },
    "に": { reading: "に (니)", pos: "부사격조사", meaning: "~에 / ~에게 / ~(시간)에", nuance: "도착점, 존재 위치, 시간, 행위의 대상(~에게)을 나타내는 핵심 조사입니다." },
    "で": { reading: "で (데)", pos: "부사격조사", meaning: "~에서(동작 장소) / ~(수단·이유)로", nuance: "'に'가 존재 위치라면, 'で'는 그곳에서 활동·행동이 벌어지는 장소를 뜻합니다." },
    "と": { reading: "と (토)", pos: "격조사", meaning: "~와/과(함께) / ~라고(인용)", nuance: "누군가와 함께할 때('友達と') 또는 말·생각을 인용할 때('〜と思う') 씁니다." },
    "へ": { reading: "え (에)", pos: "방향조사", meaning: "~(방향)으로, ~에", nuance: "철자는 'へ(헤)'이지만 조사로 쓰일 때는 [에(え)]로 발음하며 이동 방향을 나타냅니다!" },
    "も": { reading: "も (모)", pos: "보조사", meaning: "~도, 역시", nuance: "'は/が/を' 대신 자리에 들어가 '~도 마찬가지다'라는 뜻을 더합니다." },
    "の": { reading: "の (노)", pos: "관형격조사", meaning: "~의 (소유·수식) / ~하는 것", nuance: "명사와 명사를 연결('私の本: 내 책')하거나 동사를 명사화할 때 씁니다." },
    "から": { reading: "から (카라)", pos: "조사/접속", meaning: "~부터(출발) / ~이기 때문에(이유)", nuance: "명사 뒤에서는 '~부터', 동사/형용사 뒤에서는 '왜냐하면 ~이니까'를 뜻합니다." },
    "まで": { reading: "まで (마데)", pos: "보조사", meaning: "~까지", nuance: "시간·장소의 끝 지점을 나타냅니다 ('ここまで: 여기까지')." },
    "よ": { reading: "よ (요)", pos: "종조사", meaning: "~야 / ~거든(요) (정보 전달·강조)", nuance: "상대방이 모르는 사실을 알려주거나 내 주장을 강조할 때 문장 끝에 붙입니다." },
    "ね": { reading: "ね (네)", pos: "종조사", meaning: "~지? / ~네(요) (공감·확인)", nuance: "상대방에게 동의를 구하거나 감탄을 나눌 때 문장 끝에 붙입니다." },
    "か": { reading: "か (카)", pos: "종조사", meaning: "~입니까? / ~인가? (의문)", nuance: "문장 맨 끝에 붙어 마침표 문장도 질문(의문문)으로 바꿔 줍니다." },
    "な": { reading: "な (나)", pos: "종조사", meaning: "~하지 마(금지) / ~하네(독백 감탄)", nuance: "동사 기본형 뒤에 붙으면 강한 금지('気にするな: 신경 쓰지 마!')가 됩니다." },
    "だけ": { reading: "だけ (다케)", pos: "보조사", meaning: "~만, 오직 ~뿐", nuance: "범위를 한정할 때 긍정문·부정문 모두에 자연스럽게 씁니다." },
    "しか": { reading: "しか (시카)", pos: "보조사", meaning: "~밖에 (뒤에 반드시 부정형 동반!)", nuance: "'〜しかない(~밖에 없다)'처럼 항상 부정 표현과 짝을 이룹니다." },

    // Common Pronouns, Nouns, Adverbs, Verbs
    "私": { reading: "わたし (와타시)", pos: "대명사", meaning: "나, 저", nuance: "남녀 모두 가장 표준적이고 정중하게 자신을 가리키는 1인칭 대명사입니다." },
    "僕": { reading: "ぼく (보쿠)", pos: "대명사", meaning: "나 (주로 남성의 부드러운 1인칭)", nuance: "남성이 일상에서 겸손하거나 친근하게 자신을 부를 때 씁니다." },
    "俺": { reading: "おれ (오레)", pos: "대명사", meaning: "나 (남성의 편한 반말 1인칭)", nuance: "친한 사이나 혼잣말에서 남성이 쓰는 격식 없는 1인칭입니다." },
    "あなた": { reading: "あなた (아나타)", pos: "대명사", meaning: "당신", nuance: "실제 회화에서는 'あなた' 대신 상대방의 이름+'さん'을 부르는 것이 자연스럽습니다." },
    "今日": { reading: "きょう (쿄우)", pos: "명사", meaning: "오늘", nuance: "시간 명사로 조사 없이 바로 부사처럼 문장에 들어갑니다." },
    "昨日": { reading: "きのう (키노우)", pos: "명사", meaning: "어제", nuance: "과거 시제 문장('〜ました / 〜た')과 함께 쓰이는 대표 시간 명사입니다." },
    "明日": { reading: "あした (아시타)", pos: "명사", meaning: "내일", nuance: "일상 회화에서는 [아시타], 격식 있는 자리에서는 [아스]로도 읽습니다." },
    "今": { reading: "いま (이마)", pos: "명사/부사", meaning: "지금", nuance: "현재 시점을 나타내는 필수 기초 단어입니다." },
    "ここ": { reading: "ここ (코코)", pos: "지시대명사", meaning: "여기, 이곳", nuance: "ここ(여기) · そこ(거기) · あそこ(저기) · どこ(어디) 세트로 외워두세요!" },
    "それ": { reading: "それ (소레)", pos: "지시대명사", meaning: "그것", nuance: "これ(이것) · それ(그것) · あれ(저것) · どれ(어느 것) 지시어입니다." },
    "これ": { reading: "これ (코레)", pos: "지시대명사", meaning: "이것", nuance: "말하는 사람 가까이에 있는 사물을 가리킵니다." },
    "何": { reading: "なに / なん (나니/난)", pos: "의문사", meaning: "무엇, 뭐", nuance: "조사 'が/を' 앞에서는 [나니], 'だ/です/の' 앞에서는 [난]으로 읽습니다." },
    "なんでも": { reading: "なんでも (난데모)", pos: "연어", meaning: "무엇이든, 뭐든지", nuance: "의문사 '何(なん)'에 'でも(~라도)'가 붙어 전면 긍정을 나타냅니다." },
    "全部": { reading: "ぜんぶ (젠부)", pos: "명사/부사", meaning: "전부, 모두", nuance: "남김없이 전체를 말할 때 부사처럼 바로 동사를 꾸며줍니다." },
    "友達": { reading: "ともだち (토모다치)", pos: "명사", meaning: "친구", nuance: "일상 대화에 가장 자주 나오는 인물 명사 중 하나입니다." },
    "映画": { reading: "えいが (에이가)", pos: "명사", meaning: "영화", nuance: "'映画を見る(영화를 보다)' 연어로 자주 함께 쓰입니다." },
    "深夜": { reading: "しんや (신야)", pos: "명사", meaning: "심야, 깊은 밤", nuance: "자정 무렵의 늦은 밤 시간대를 뜻합니다." },
    "食堂": { reading: "しょくどう (쇼쿠도우)", pos: "명사", meaning: "식당", nuance: "정겨운 대중 음식점이나 구내식당을 가리킵니다." },
    "ようこそ": { reading: "ようこそ (요우코소)", pos: "감탄/부사", meaning: "어서 오세요, 환영합니다!", nuance: "'〜へようこそ(~에 오신 것을 환영합니다)' 패턴으로 씁니다." },
    "どうして": { reading: "どうして (도우시테)", pos: "의문부사", meaning: "어째서, 왜", nuance: "'なぜ(문어적)'와 'なんで(편한 구어)' 사이의 가장 자연스러운 '왜' 표현입니다." },
    "せっかく": { reading: "せっかく (셋카쿠)", pos: "부사", meaning: "모처럼, 애써서", nuance: "모처럼 얻은 귀한 기회를 강조할 때 문두에 씁니다." },
    "見ました": { reading: "みました (미마시타)", pos: "동사 과거정중형", meaning: "보았습니다 (기본형: 見る 보다)", nuance: "2그룹(일단) 동사 '見る(보다)' + 정중 과거 어미 '〜ました'가 결합된 형태입니다." },
    "来た": { reading: "きた (키타)", pos: "동사 과거형", meaning: "왔다 (기본형: 来る[くる] 오다)", nuance: "불규칙 동사 '来る(쿠루)'의 과거형은 [키타(来た)]로 발음이 바뀌니 꼭 기억하세요!" },
    "来たんだ": { reading: "きたんだ (키탄다)", pos: "동사+강조어미", meaning: "온 거야, 왔잖아 (기본형: 来る 오다)", nuance: "'来た(왔다)' + 이유·상황 강조의 'んだ'가 붙어 설득력을 높인 표현입니다." },
    "言っちゃったんです": { reading: "いっちゃったんです (잇챳탄데스)", pos: "동사 축약+정중", meaning: "말해 버린 거예요 (기본형: 言う 말하다)", nuance: "言う(말하다) → 言ってしまう(말해버리다) → 言っちゃう(축약) → 言っちゃったんです(과거+설명)!" },
    "作る": { reading: "つくる (츠쿠루)", pos: "동사 기본형", meaning: "(음식·물건을) 만들다", nuance: "1그룹(오단) 동사로 정중형은 '作ります(만듭니다)'가 됩니다." },
    "できる": { reading: "できる (데키루)", pos: "가능동사", meaning: "할 수 있다, 가능하다", nuance: "'する(하다)'의 가능형 역할을 하는 핵심 동사입니다." },
    "気": { reading: "き (키)", pos: "명사", meaning: "마음, 기분, 신경", nuance: "'気にする(신경 쓰다)', '気がする(기분이 들다)' 등 수많은 관용구를 만듭니다." },
    "する": { reading: "する (스루)", pos: "동사 기본형", meaning: "하다", nuance: "명사 뒤에 붙어 수많은 동작 동사를 만드는 불규칙 핵심 동사입니다." },
    "です": { reading: "です (데스)", pos: "정중 조동사", meaning: "~입니다 (정중한 단정)", nuance: "명사나 형용사 뒤에 붙어 공손한 문장을 완성하며 [데스](끝 '스'는 약하게)로 발음합니다." }
  };

  function explainUnknownTokenForBeginner(tok) {
    if (CORE_WORD_DICT[tok]) {
      const d = CORE_WORD_DICT[tok];
      return {
        term: `${tok} [${d.reading}]`,
        typeLabel: d.pos,
        meaning: d.meaning,
        nuance: d.nuance
      };
    }

    // Heuristic morphological breakdown for inflected verbs/adjectives when offline
    if (tok.endsWith("ました")) {
      const stem = tok.slice(0, -3);
      return {
        term: tok,
        typeLabel: "동사 과거정중형",
        meaning: `(${stem}~) 했습니다 (과거 정중 표현)`,
        nuance: "동사 어간 뒤에 '〜ました(~했습니다)'가 붙은 정중한 과거 시제 서술어입니다. AI 키를 연결하면 정확한 기본형과 요미가나가 표시됩니다."
      };
    }
    if (tok.endsWith("ません")) {
      const stem = tok.slice(0, -3);
      return {
        term: tok,
        typeLabel: "동사 부정정중형",
        meaning: `(${stem}~) 하지 않습니다`,
        nuance: "'〜ます'의 현재/미래 부정형인 '〜ません'이 결합된 정중 표현입니다."
      };
    }
    if (tok.endsWith("ます")) {
      const stem = tok.slice(0, -2);
      return {
        term: tok,
        typeLabel: "동사 정중형",
        meaning: `(${stem}~) 합니다`,
        nuance: "동사에 정중 조동사 '〜ます'가 결합된 형태입니다."
      };
    }
    if (tok.endsWith("ている") || tok.endsWith("てる")) {
      return {
        term: tok,
        typeLabel: "동사 진행/상태형",
        meaning: "~하고 있다 / ~해 있는 상태다",
        nuance: "'〜ている(회화 축약 〜てる)'가 붙어 현재 진행 중인 동작이나 결과 상태를 나타냅니다."
      };
    }
    if (PARTICLES.has(tok)) {
      return {
        term: tok,
        typeLabel: "조사/어미",
        meaning: "문장 성분의 역할·뉘앙스를 정해주는 조사",
        nuance: "앞 단어 뒤에 붙어 문장 내 문법적 관계를 연결해 줍니다."
      };
    }

    return {
      term: tok,
      typeLabel: /[\u30a0-\u30ff]/.test(tok) ? "외래어/명사" : "단어/어구",
      meaning: "(우측 [✨ AI 심층 해설]을 켜면 한자 독음과 정확한 뜻이 모두 표시됩니다)",
      nuance: "문장을 구성하는 개별 어휘 단위입니다."
    };
  }

  function buildBeginnerStructureGuide(jpText) {
    const bunsetsuChunks = segmentJapanese(jpText, "bunsetsu");
    const splitTokens = segmentJapanese(jpText, "split");

    const annotatedChunks = bunsetsuChunks.map((chunk) => {
      if (chunk.endsWith("は")) return `[${chunk} (주제: ~은/는)]`;
      if (chunk.endsWith("が")) return `[${chunk} (주어: ~이/가)]`;
      if (chunk.endsWith("を")) return `[${chunk} (목적어: ~을/를)]`;
      if (chunk.endsWith("に")) return `[${chunk} (대상·시간·장소: ~에)]`;
      if (chunk.endsWith("で")) return `[${chunk} (장소·수단: ~에서/로)]`;
      if (chunk.endsWith("と")) return `[${chunk} (동반·인용: ~와/라고)]`;
      if (chunk.endsWith("へ")) return `[${chunk} (방향: ~으로)]`;
      if (chunk.endsWith("から")) return `[${chunk} (출발·이유: ~부터/이니까)]`;
      if (chunk.endsWith("まで")) return `[${chunk} (도달: ~까지)]`;
      return `[${chunk}]`;
    });

    return `${annotatedChunks.join(" ＋ ")}  👉 일본어는 한국어와 어순([주어/주제 → 시간·대상·목적어 → 마지막에 동사/서술어])이 거의 같아서, 각 어절 끝에 붙은 조사(${splitTokens.filter((t) => PARTICLES.has(t)).join(", ") || "어미"})만 파악하면 문장 뼈대가 한눈에 들어옵니다!`;
  }

  function detectJpGrammar(sentence) {
    const s = String(sentence || "");
    if (/ちゃ(?:う|った|って)|じゃ(?:う|った|って)/.test(s)) {
      return {
        title: "초보 필수 회화 축약: 〜ちゃう / 〜じゃう (원래 형태: 〜てしまう)",
        desc: "원래 문법은 '동사 て형 + しまう(~해 버리다: 완료·실수·아쉬움)'이지만, 실제 드라마 회화에서는 발음하기 쉽게 '〜てしまう → 〜ちゃう', '〜でしまう → 〜じゃう'(과거형은 〜ちゃった)로 줄여서 말합니다!"
      };
    }
    if (/んです|んだ(?:から|よ|ね|けど|$|[。！？])/.test(s)) {
      return {
        title: "이유·상황 설명의 핵심 표현: 〜んです / 〜んだ",
        desc: "문장 끝에 'んです(정중) / んだ(반말)'를 붙이면 단순한 사실 전달이 아니라 '왜냐하면 ~한 상황이거든요 / ~인 거란 말이야'처럼 상대에게 배경 사정을 설명하거나 감정을 강조하는 뉘앙스가 생깁니다."
      };
    }
    if (/てくれ(?:る|た|て)|てもら(?:う|った|って)|てあげ(?:る|た|て)/.test(s)) {
      return {
        title: "주고받기(수수) 표현: 〜てくれる / 〜てもらう / 〜てあげる",
        desc: "한국어보다 훨씬 자주 쓰이는 일본어 핵심 문법입니다! 상대가 나를 위해 무언가를 해주면 '〜てくれる(해 주다)', 내가 상대에게 부탁해 도움을 받으면 '〜てもらう(받다)', 내가 남을 위해 해주면 '〜てあげる(해 주다)'를 씁니다."
      };
    }
    if (/ないで(?:ください)?|するな/.test(s)) {
      return {
        title: "금지·부정 요청 표현 (〜ないでください vs 동사원형+な)",
        desc: "정중하게 '~하지 말아 주세요'라고 부탁할 때는 '동사 ない형 + でください'를 쓰고, 친한 사이에 '신경 쓰지 마!(気にするな)'처럼 짧고 강하게 말릴 때는 '동사 기본형 + な'를 붙입니다."
      };
    }
    if (/です|ます|ました|ません|でした/.test(s)) {
      return {
        title: "초보 기본 정중체 (丁寧語: です · ます · ました)",
        desc: "한국어의 '~입니다 / ~합니다 / ~했습니다'에 해당하는 가장 기본적인 존댓말입니다. 명사·형용사 뒤에는 'です(현재) / でした(과거)'를, 동사 뒤에는 'ます(현재·미래) / ました(과거) / ません(부정)'을 붙입니다."
      };
    }
    return {
      title: "일상 반말체(보통체) & 일본어 기본 어순 원리",
      desc: "가족이나 친한 사이에서 'です/ます'를 빼고 동사·형용사의 기본형/과거형(〜た)/부정형(〜ない)으로 끝맺는 친근한 말투입니다. 맨 끝 서술어의 시제(과거/현재)와 긍정·부정만 먼저 확인하면 전체 뜻이 쉽게 잡힙니다!"
    };
  }

  function analyzeSentence(jpText) {
    const splitTokens = segmentJapanese(jpText, "split");
    // Build word-by-word list covering EVERY token in the sentence in order for beginners!
    const allWordItems = splitTokens.map((tok) => explainUnknownTokenForBeginner(tok));

    const pronTips = [];
    if (/は/.test(jpText)) {
      pronTips.push("조사 'は'는 [하]가 아니라 [와]로 읽습니다.");
    }
    if (/へ/.test(jpText)) {
      pronTips.push("방향 조사 'へ'는 [헤]가 아니라 [에]로 읽습니다.");
    }
    if (/っ/.test(jpText)) {
      pronTips.push("작은 'っ(촉음)'에서는 반 박자 숨을 딱 멈췄다가 다음 소리를 내세요.");
    }
    if (/ん/.test(jpText)) {
      pronTips.push("'ん'은 받침처럼 대충 넘기지 말고 온전한 한 박자 길이를 유지해 발음하세요.");
    }
    if (pronTips.length === 0) {
      pronTips.push("일본어는 글자 하나하나를 일정한 박자(모라)로 또박또박 끊어 읽는 것이 핵심입니다.");
    }

    return {
      reading: "",
      structure: buildBeginnerStructureGuide(jpText),
      pronunciation: pronTips.join(" "),
      vocab: allWordItems,
      grammar: detectJpGrammar(jpText)
    };
  }

  window.NJD_ANALYZER = {
    segmentJapanese,
    shuffleTokensWithIds,
    analyzeSentence
  };
})();
