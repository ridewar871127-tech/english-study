(function () {
  "use strict";

  const EXPRESSIONS = [
    // Phrasal Verbs
    { regex: /\bfigure(?:d|s|ing)?\s+(?:it\s+|this\s+|that\s+)?out\b/i, term: "figure out", type: "phrasal", typeLabel: "필수 구동사", meaning: "(문제·이유·해결책을) 알아내다, 이해하다", nuance: "머리를 굴려 복잡한 상황을 파악하거나 답을 찾아냈을 때 씁니다.", example: "Don't worry, we'll figure something out." },
    { regex: /\bfreak(?:ed|s|ing)?\s+out\b/i, term: "freak out", type: "phrasal", typeLabel: "구동사/슬랭", meaning: "기겁하다, 패닉에 빠지다, 과민반응하다", nuance: "깜짝 놀라거나 감정적으로 폭발할 때 미드 매 회차에 등장합니다.", example: "Please don't freak out when I tell you this." },
    { regex: /\bend(?:ed|s|ing)?\s+up\b/i, term: "end up + V-ing / 장소", type: "phrasal", typeLabel: "필수 구동사", meaning: "결국 ~하게 되다, 결국 ~에 이르다", nuance: "의도치 않은 과정을 거쳐 최종적으로 맞이한 결과를 말할 때 씁니다.", example: "We ended up ordering pizza at midnight." },
    { regex: /\bturn(?:ed|s|ing)?\s+out\b/i, term: "turn out", type: "phrasal", typeLabel: "필수 구동사", meaning: "(결과적으로) ~임이 밝혀지다, 판명되다", nuance: "예상과 다른 반전 사실이 드러났을 때 'It turned out that ~' 형태로 자주 씁니다.", example: "It turned out to be a huge misunderstanding." },
    { regex: /\bshow(?:ed|s|ing|n)?\s+up\b/i, term: "show up", type: "phrasal", typeLabel: "구동사", meaning: "(약속 장소에) 나타나다, 모습을 드러내다", nuance: "'appear'보다 훨씬 자연스러운 일상 회화 표현입니다.", example: "He didn't even show up for the meeting." },
    { regex: /\bbring(?:ing|s)?\s+(?:it\s+|that\s+|this\s+)?up\b|\bbrought\s+(?:it\s+|that\s+|this\s+)?up\b/i, term: "bring up", type: "phrasal", typeLabel: "구동사", meaning: "(화제·민감한 주제를) 꺼내다, 언급하다", nuance: "대화 도중 특정 이야기를 화두로 올릴 때 씁니다.", example: "Why did you have to bring that up at dinner?" },
    { regex: /\bcome(?:s|ing)?\s+up\s+with\b|\bcame\s+up\s+with\b/i, term: "come up with", type: "phrasal", typeLabel: "구동사", meaning: "(아이디어·해결책·핑계를) 떠올리다, 내놓다", nuance: "직장·수사·일상 미드 모두에서 압도적으로 많이 쓰이는 3단어 구동사입니다.", example: "We need to come up with a better plan." },
    { regex: /\bput(?:ting|s)?\s+up\s+with\b/i, term: "put up with", type: "phrasal", typeLabel: "구동사", meaning: "(불쾌한 사람·상황을) 꾹 참다, 견디다", nuance: "'tolerate'의 대표 구어체 표현입니다.", example: "I can't put up with his attitude anymore." },
    { regex: /\bget(?:ting|s)?\s+over\b|\bgot\s+over\b/i, term: "get over", type: "phrasal", typeLabel: "구동사", meaning: "(실연·충격·어려움을) 극복하다, 잊다", nuance: "'Get over it!(이제 좀 잊고 넘어가!)'처럼 단독 문장으로도 자주 쓰입니다.", example: "It took him months to get over the breakup." },
    { regex: /\brun(?:ning|s)?\s+into\b|\bran\s+into\b/i, term: "run into", type: "phrasal", typeLabel: "구동사", meaning: "(우연히) 마주치다 / (문제에) 부딪히다", nuance: "길에서 지인을 예고 없이 딱 마주쳤을 때 씁니다.", example: "Guess who I ran into at the coffee shop?" },
    { regex: /\blook(?:ed|s|ing)?\s+into\b/i, term: "look into", type: "phrasal", typeLabel: "구동사", meaning: "(사건·문제를) 조사하다, 알아보다", nuance: "수사물·법정물(슈츠, 브루클린 나인-나인 등) 단골 표현입니다.", example: "I'll look into it right away." },
    { regex: /\blook(?:ed|s|ing)?\s+(?:it\s+|them\s+|this\s+)?over\b/i, term: "look ~ over", type: "phrasal", typeLabel: "구동사", meaning: "(서류·자료를) 쭉 검토하다, 훑어보다", nuance: "비즈니스 장면에서 보고서나 계약서를 확인할 때 자주 씁니다.", example: "Give me ten minutes to look it over." },
    { regex: /\bdeal(?:ing|s)?\s+with\b|\bdealt\s+with\b/i, term: "deal with", type: "phrasal", typeLabel: "구동사", meaning: "(골치 아픈 문제·사람을) 처리하다, 상대하다", nuance: "피곤하거나 까다로운 일을 감당해 해결할 때 씁니다.", example: "Let me deal with him." },
    { regex: /\bhang(?:ing|s)?\s+out\b|\bhung\s+out\b/i, term: "hang out", type: "phrasal", typeLabel: "구동사", meaning: "어울려 놀다, 편하게 시간을 보내다", nuance: "친구들과 거창한 계획 없이 만나 시간을 보낼 때 사용합니다.", example: "Do you want to hang out this weekend?" },
    { regex: /\bgo(?:ing|es|ne)?\s+out\s+with\b|\bwent\s+out\s+with\b/i, term: "go out with", type: "phrasal", typeLabel: "구동사", meaning: "~와 데이트하다, 사귀다", nuance: "연애·썸 관련 대화에서 가장 기본이 되는 구동사입니다.", example: "Are they still going out with each other?" },
    { regex: /\bmake(?:s|ing)?\s+up\b|\bmade\s+up\b/i, term: "make up", type: "phrasal", typeLabel: "다의 구동사", meaning: "① (거짓 이야기를) 지어내다 ② 화해하다 ③ 보충하다", nuance: "문맥에 따라 변명을 꾸며내거나(make it up), 싸운 뒤 화해할 때 씁니다.", example: "You're totally making that up!" },
    { regex: /\bback(?:ed|s|ing)?\s+(?:me|you|him|her|us|them)\s+up\b/i, term: "back someone up", type: "phrasal", typeLabel: "구동사", meaning: "(누군가의 편을 들어) 지원하다, 거들어 주다", nuance: "회의나 말싸움에서 내 말이 맞다고 힘을 실어줄 때 씁니다.", example: "Thanks for backing me up in there." },
    { regex: /\bcall(?:ed|s|ing)?\s+(?:it\s+|this\s+)?off\b/i, term: "call off", type: "phrasal", typeLabel: "구동사", meaning: "(예정된 행사·결혼·거래를) 취소하다, 철회하다", nuance: "'cancel'보다 구어체에서 훨씬 생동감 있게 쓰입니다.", example: "They called off the wedding at the last minute." },
    { regex: /\bscrew(?:ed|s|ing)?\s+up\b|\bmess(?:ed|es|ing)?\s+up\b/i, term: "screw up / mess up", type: "slang", typeLabel: "구동사/슬랭", meaning: "(일을) 완전히 망치다, 큰 실수를 저지르다", nuance: "자신의 실수를 자책할 때 'I messed up / I screwed up'이라고 합니다.", example: "I really messed up the interview." },
    { regex: /\bblow\s+it\b|\bblew\s+it\b/i, term: "blow it", type: "idiom", typeLabel: "관용어/슬랭", meaning: "(결정적 기회를) 날려 먹다, 망치다", nuance: "잘 될 수 있었던 중요한 순간을 망쳤을 때 씁니다.", example: "Don't blow it this time!" },

    // High-Frequency Idioms & Spoken Patterns
    { regex: /\bsupposed\s+to\b/i, term: "be supposed to + 동사원형", type: "idiom", typeLabel: "중급 필수 구문", meaning: "~하기로 되어 있다 / 원래 ~해야 한다", nuance: "약속·규칙·예상과 실제 상황을 비교할 때 매 에피소드마다 등장합니다.", example: "What am I supposed to say to that?" },
    { regex: /\bmake(?:s|ing)?\s+(?:more\s+|no\s+|any\s+)?sense\b|\bmade\s+(?:more\s+|no\s+)?sense\b/i, term: "make sense", type: "idiom", typeLabel: "관용 표현", meaning: "말이 되다, 앞뒤가 맞다, 일리가 있다", nuance: "상대방의 설명이 납득될 때 'That makes sense'라고 맞장구칩니다.", example: "None of this makes any sense." },
    { regex: /\bbig\s+deal\b/i, term: "a big deal", type: "idiom", typeLabel: "관용어", meaning: "대단한 일, 심각한 문제", nuance: "'It's no big deal(별일 아니야)' 또는 'make a big deal out of ~(호들갑 떨다)'로 활용됩니다.", example: "Stop acting like it's not a big deal." },
    { regex: /\bif\s+anything\b/i, term: "if anything", type: "idiom", typeLabel: "중급 관용어", meaning: "오히려 반대로, 굳이 따지자면", nuance: "앞선 말을 부정한 뒤 정반대의 사실을 강조할 때 쓰는 세련된 연결어입니다.", example: "If anything, you owe me an apology." },
    { regex: /\bon\s+the\s+same\s+page\b/i, term: "on the same page", type: "idiom", typeLabel: "비즈니스/일상 관용어", meaning: "생각·이해가 일치하는, 같은 입장인", nuance: "서로 오해 없이 의견이 맞는지 확인할 때 씁니다.", example: "Let's make sure we're on the same page." },
    { regex: /\bout\s+of\s+(?:my|your|his|her|our|their)\s+mind\b/i, term: "out of one's mind", type: "idiom", typeLabel: "관용어", meaning: "제정신이 아닌, 미친", nuance: "'Are you out of your mind?(너 제정신이냐?)' 형태로 자주 쓰입니다.", example: "You must be out of your mind to take that risk." },
    { regex: /\bfor\s+the\s+record\b/i, term: "for the record", type: "idiom", typeLabel: "관용어", meaning: "분명히 해두는데, 참고로 분명히 말하자면", nuance: "법정물(<슈츠> 등)은 물론 일상 대화에서도 내 입장을 명확히 남길 때 씁니다.", example: "Just for the record, I was against this idea." },
    { regex: /\bgive\s+(?:me|you|him|her|us)\s+a\s+break\b/i, term: "give someone a break", type: "idiom", typeLabel: "관용어", meaning: "좀 봐주다 / (감탄) 제발 적당히 좀 해라!", nuance: "너무 가혹하게 굴지 말라고 하거나, 어이없는 말에 '에이 설마!'라고 반응할 때 씁니다.", example: "Oh, give me a break! You don't believe that, do you?" },
    { regex: /\bwhat\s+if\b/i, term: "What if + 주어 + 동사?", type: "idiom", typeLabel: "회화 핵심 패턴", meaning: "만약 ~라면 어쩌지? / ~하는 게 어때?", nuance: "걱정되는 가능성을 상상하거나 새로운 대안을 제시할 때 씁니다.", example: "What if someone finds out?" },
    { regex: /\bnothing\s+but\b/i, term: "nothing but ~", type: "idiom", typeLabel: "중급 구문", meaning: "오직 ~일 뿐인 (~외에는 아무것도 아닌)", nuance: "'only'를 훨씬 강하게 표현하는 원어민 선호 구문입니다.", example: "You've been nothing but kind to me." },
    { regex: /\bas\s+far\s+as\s+i\s+know\b|\bas\s+far\s+as\s+i'm\s+concerned\b/i, term: "as far as I know / I'm concerned", type: "idiom", typeLabel: "관용 구문", meaning: "내가 아는 한에서는 / 내 입장에서는", nuance: "단정 짓지 않고 내 지식·입장의 범위를 한정할 때 씁니다.", example: "As far as I know, the deal is still on." },
    { regex: /\bat\s+the\s+end\s+of\s+the\s+day\b/i, term: "at the end of the day", type: "idiom", typeLabel: "관용어", meaning: "결국에는, 궁극적으로 따져보면", nuance: "여러 조건을 다 따져본 뒤 가장 본질적인 결론을 내릴 때 씁니다.", example: "At the end of the day, it's your decision." },
    { regex: /\bby\s+any\s+chance\b/i, term: "by any chance", type: "idiom", typeLabel: "정중한 회화 표현", meaning: "혹시라도, 행여나", nuance: "질문에 덧붙이면 '혹시 ~인가요?'라는 공손하고 자연스러운 어감이 됩니다.", example: "Did you see my keys by any chance?" },
    { regex: /\bfeel\s+like\b/i, term: "feel like + 명사/V-ing/절", type: "idiom", typeLabel: "회화 필수 구문", meaning: "~하고 싶은 기분이다 / ~라는 느낌이 들다", nuance: "내 기분이나 직감을 부드럽게 표현할 때 'think' 대신 아주 자주 씁니다.", example: "I feel like getting tacos tonight." }
  ];

  function buildPronunciationTip(enText) {
    const tips = [];
    if (/\bgonna\b|\bgoing to\b/i.test(enText)) {
      tips.push("'going to(gonna)'는 [거너]로 약화되어 뒷단어 동사에 강세가 실립니다.");
    }
    if (/\bwanna\b|\bwant to\b/i.test(enText)) {
      tips.push("'want to(wanna)'에서 t 소리가 탈락해 [워너]처럼 부드럽게 이어집니다.");
    }
    if (/\bgotta\b|\bgot to\b/i.test(enText)) {
      tips.push("'got to(gotta)'는 모음 사이 t가 플랩(Flap)되어 [가러]에 가깝게 발음됩니다.");
    }
    if (/\b(?:would|could|should)(?:'ve|\s+have)\b/i.test(enText)) {
      tips.push("조동사 뒤 'have'는 [해브]가 아니라 약화 모음 [어브/브](would've[우드브])로 아주 짧게 지나갑니다.");
    }
    if (/\bdid you\b|\bcould you\b|\bwould you\b/i.test(enText)) {
      tips.push("'d + y' 연음(구개음화)으로 'did you[디쥬]', 'could you[쿠쥬]', 'would you[우쥬]'처럼 소리 납니다.");
    }
    if (/\bout of\b|\bkind of\b|\bsort of\b|\ba lot of\b/i.test(enText)) {
      tips.push("전치사 'of'가 앞 단어 끝 자음과 연음되어 'out of[아우러]', 'kind of[카인더]', 'a lot of[어라러]'로 들립니다.");
    }
    if (tips.length === 0) {
      tips.push("내용어(명사·본동사·형용사·부사)는 길고 뚜렷하게, 기능어(관사·전치사·대명사)는 짧고 약하게 넘어가는 영어 강세 박자에 집중해 들어보세요.");
    }
    return tips.join(" ");
  }

  function detectGrammar(enText) {
    const t = enText.trim();

    if (/\b(?:would|could|should|might)(?:'ve|\s+have)\s+\w+/i.test(t)) {
      return {
        title: "조동사 + have + 과거분사(p.p.) — 과거 사실에 대한 가정·후회·추측",
        desc: "이미 지나간 과거 일을 두고 '~했을 텐데(would have p.p.)', '~했어야 했는데(should have p.p.)', '~할 수도 있었는데(could have p.p.)'의 미묘한 아쉬움·추측을 전달하는 중급 핵심 문법입니다."
      };
    }
    if (/\bif\s+[a-z']+\s+(?:were|had|did|knew|went|got|came|saw|took|made|thought|wanted|could)\b/i.test(t)) {
      return {
        title: "가정법 과거 / 조건절 구문 (If + 과거시제 ~)",
        desc: "현재 사실과 반대되는 상황을 가정하거나 완곡하게 상상할 때 If절에 과거형 동사를 사용합니다."
      };
    }
    if (/\b(?:have|has|i've|you've|we've|they've)\s+been\s+\w+ing\b/i.test(t)) {
      return {
        title: "현재완료진행형 (have/has been + V-ing)",
        desc: "과거 어느 시점부터 시작한 행동이 '지금 이 순간까지도 계속 이어지고 있음'을 생생하게 강조하는 시제입니다."
      };
    }
    if (/\b(?:have|has|i've|you've|we've|they've)\s+(?:never\s+|ever\s+|just\s+|already\s+)?(?:been|done|seen|heard|made|gone|got|gotten|had|known|told|said|taken|given|met|lost|found|\w+ed)\b/i.test(t)) {
      return {
        title: "현재완료 시제 (have/has + p.p.)",
        desc: "단순 과거 사실 나열이 아니라, 과거의 경험·결과가 '현재의 대화 상황'에 직접적인 영향을 미치고 있을 때 사용합니다."
      };
    }
    if (/\bused\s+to\s+[a-z]+\b/i.test(t)) {
      return {
        title: "과거의 상태·습관 (used to + 동사원형 vs. be used to + V-ing)",
        desc: "'used to + 동사원형'은 예전에는 ~하곤 했다(지금은 안 함)를 뜻하며, 앞에 be/get동사가 붙어 명사/V-ing가 오면 '~에 익숙하다'라는 전혀 다른 뜻이 됩니다."
      };
    }
    if (/\b(?:make|made|let|have|had)\s+(?:me|you|him|her|us|them)\s+[a-z]+\b/i.test(t)) {
      return {
        title: "사역동사 구문 (make / let / have + 목적어 + 동사원형)",
        desc: "목적어가 특정 행동을 하게 만들거나 허락할 때 to부정사가 아닌 '원형부정사(동사원형)'를 목적격보어로 취합니다."
      };
    }
    if (/,\s*(?:isn't|aren't|wasn't|weren't|don't|doesn't|didn't|won't|can't|haven't|right)\s*[a-z]*\?$/i.test(t)) {
      return {
        title: "부가의문문 (Tag Question — 상대방의 동의·확인 유도)",
        desc: "긍정문 뒤에는 부정형 꼬리를, 부정문 뒤에는 긍정형 꼬리를 붙여 '그렇지?'라고 자연스럽게 동의를 구하는 구어 패턴입니다."
      };
    }
    if (/\bwhat\s+(?:happened|happens|matters|mattered|went\s+wrong|makes|[a-z']+\s+(?:is|was|mean|meant|want|wanted|need|needed|said|did))\b/i.test(t) && !/^what\b/i.test(t)) {
      return {
        title: "선행사 포함 관계대명사 what 명사절 ('~하는 것 / 무슨 일이 ~했는지')",
        desc: "'the thing that'을 한 단어 'what'으로 응축하거나 의문사절(간접의문문)로 동사의 목적어·주어 역할을 수행하는 중급 회화 필수 구조입니다."
      };
    }
    if (/^(?:Wait|Look|Listen|Stop|Tell|Give|Let|Don't|Never|Please|Come|Go|Take)\b/.test(t)) {
      return {
        title: "구어체 명령문 / 주의 환기 담화 표지 (Discourse Marker)",
        desc: "주어 You를 생략하고 동사원형(또는 Don't + 원형)으로 시작해 상대방의 주의를 끌거나 즉각적인 행동을 요청하는 문장입니다."
      };
    }
    return {
      title: "실전 구어체 호흡 & 어순 구조",
      desc: "핵심 주어+동사 뼈대를 먼저 던진 뒤, 전치사구·부사절로 상황 정보를 뒤에 덧붙이는 전형적인 영어 어순 감각을 익혀 보세요."
    };
  }

  function analyzeSentence(enText) {
    const foundVocab = [];
    for (const item of EXPRESSIONS) {
      if (item.regex.test(enText)) {
        foundVocab.push({
          term: item.term,
          type: item.type,
          typeLabel: item.typeLabel,
          meaning: item.meaning,
          nuance: item.nuance,
          example: item.example
        });
        if (foundVocab.length >= 4) break;
      }
    }

    return {
      pronunciation: buildPronunciationTip(enText),
      vocab: foundVocab,
      grammar: detectGrammar(enText)
    };
  }

  window.ND_ANALYZER = {
    analyzeSentence
  };
})();
