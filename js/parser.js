'use strict';

// ═══ 공용 유틸 ═══
const Util = {
  escapeHtml(s) {
    return (s ?? '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
};

// ═══ 단어 분석 프롬프트 (DefaultPrompt.cs 이식 + 발음 난이도 규칙 + 패턴 자동 분리) ═══
const WORD_PROMPT_PLACEHOLDER = '(여기에 *표시한* 영어 문장을 붙여넣는다)';

const WORD_PROMPT = `너는 영어 교사다. 나는 영어를 학습하는 한국인이다.
아래 [영어 문장]에서 내가 표시한 단어·표현만 분석해줘.

[내가 표시하는 방법]
- 텍스트 입력: *word* 처럼 별표로 감싼 부분이 내가 모르는 단어다.
- 이미지 입력: 밑줄이나 형광펜으로 표시된 부분이 내가 모르는 단어다.
- 표시되지 않은 단어는 내가 아는 단어이므로 절대 분석하지 않는다.

[분석 형식]
1. 전체 문장의 자연스러운 한국어 해석을 먼저 적는다.
2. 표시된 각 단어·표현에 대해:
   - 난이도가 있는 단어·표현이면 미국 발음을 한글 표기로 먼저 적는다(이게 메인이다).
     book, school, water 같은 기초 단어는 발음을 생략한다.
   - 영국 발음이 뚜렷이 다를 때만 영국 발음도 함께 적는다. (예: schedule — 미국 스케줄 / 영국 쉐줄)
   - 사전적 의미를 나열하지 말고, 이 문장의 문맥에서 쓰인 그 뜻으로 설명한다.
   - 문장 안에서의 역할(품사, 무엇을 꾸미는지, 어떤 덩어리에 속하는지)을 짚어준다.
3. 문장 구조를 큰 틀부터 하향식으로 분석한다.
   예: "I like that people who participate party"에서
   주절 "I like that people" + "who" 이하가 "people"을 꾸미는 것처럼 보여준다.
4. 이 문장에서 재활용할 만한 문장 패턴·구문이 보이면 그것도 짚어준다.

[앱 등록용 데이터 - 반드시 준수]
위 분석이 모두 끝난 후, 문서의 맨 마지막에 아래 블록들을 출력한다.
- 이 블록들은 내가 프로그램에 붙여넣을 것이므로 형식을 절대 바꾸지 않는다.
- 블록 안에서는 마크다운, 이모지, 부연설명을 일절 쓰지 않는다.

(1) 단어 블록 — 항상 출력한다.
- 단어/표현 하나당 "---" 하나로 구분한다.
- 필드: en(영어 원문), pron-us(미국 발음 한글), pron-uk(영국 발음 한글), ko(한국어 뜻), ctx(그 단어가 나온 원문 문장)
- pron-us는 난이도가 있는 단어에만 쓴다. 기초 단어면 그 줄을 생략한다.
- pron-uk는 미국 발음과 다를 때만 쓴다. 같으면 그 줄을 생략한다.
- 값이 없는 필드는 줄 자체를 생략한다.
- 필드 이름과 순서는 바꾸지 않는다.
- en은 내가 표시한 표현 그대로 적는다. 단, 활용형이면 표제어(동사 원형 등)를 쓴다.
- ctx에는 별표나 밑줄 표시를 제거한 깨끗한 문장을 쓴다.
- 여기에는 "문장에 그대로 쓰이는 낱말 덩어리"만 넣는다. (단어, 숙어, 구동사 등)

@@APP-DATA-BEGIN@@
---
en: take into account
pron-us: 테익 인투 어카운트
ko: ~을 고려하다
ctx: We need to take into account the shipping cost.
---
en: schedule
pron-us: 스케줄
pron-uk: 쉐줄
ko: 일정
ctx: The schedule is tight this week.
---
@@APP-DATA-END@@

(2) 패턴 블록 — 문장에 재활용할 만한 문장 패턴·구문이 있을 때만 출력한다. 없으면 블록 자체를 생략한다.
- 단어 블록의 en과 패턴을 중복 등록하지 않는다. 빈자리(~)를 끼워 넣어 재활용하는 "문장 틀"만 여기 넣는다.
- 패턴 하나당 "---" 하나로 구분한다.
- 필드: pattern(영어 패턴, 빈자리는 ~ 로 표시), ko(한국어 설명/뜻), ex(예문 — 여러 개면 줄을 반복한다)
- ex에는 해석 없이 영어 문장만 쓰고, 방금 분석한 문장을 예문으로 우선 활용한다.
- 필드 이름과 순서는 바꾸지 않는다.

@@PATTERN-DATA-BEGIN@@
---
pattern: It is no use ~ing
ko: ~해 봤자 소용없다
ex: It is no use crying over spilt milk.
---
@@PATTERN-DATA-END@@

[영어 문장]
${WORD_PROMPT_PLACEHOLDER}`;

// ═══ 문장 패턴 프롬프트 ═══
const PATTERN_PROMPT_PLACEHOLDER = '(여기에 영어 문장이나 배우고 싶은 패턴을 붙여넣는다)';

const PATTERN_PROMPT = `너는 영어 교사다. 나는 영어 문장 패턴(구문)을 학습하는 한국인이다.
아래 [입력]을 보고 영어 문장 패턴을 가르쳐줘.

[입력의 두 가지 경우]
- 영어 문장을 주면: 그 문장에 쓰인 핵심 패턴·구문을 뽑아 설명한다.
- 패턴 자체를 주면(예: It is no use ~ing): 그 패턴을 설명한다.

[분석 형식]
1. 패턴을 한눈에 보여준다. 예: It is no use + ~ing / have a hard time + ~ing
2. 패턴의 의미와 뉘앙스를 한국어로 설명한다. 사전적 나열이 아니라 실제로 쓰이는 맥락 위주로.
3. 문장 구조를 큰 틀부터 하향식으로 분석한다.
   패턴 안에서 어느 자리에 무엇이 오는지, 예문이 그 틀에 어떻게 끼워 맞춰지는지 보여준다.
4. 예문 2~3개를 들고, 각 예문의 자연스러운 한국어 해석을 붙인다.

[앱 등록용 데이터 - 반드시 준수]
위 분석이 모두 끝난 후, 문서의 맨 마지막에 아래 블록을 정확히 한 번만 출력한다.
- 이 블록은 내가 프로그램에 붙여넣을 것이므로 형식을 절대 바꾸지 않는다.
- 블록 안에서는 마크다운, 이모지, 부연설명을 일절 쓰지 않는다.
- 패턴 하나당 "---" 하나로 구분한다.
- 필드: pattern(영어 패턴), ko(한국어 설명/뜻), ex(예문 — 여러 개면 줄을 반복한다)
- 값이 없는 필드는 줄 자체를 생략한다.
- 필드 이름과 순서는 바꾸지 않는다.
- pattern의 빈자리는 ~ 로 표시한다. (예: It is no use ~ing)
- ex에는 해석 없이 영어 문장만 쓴다.

@@PATTERN-DATA-BEGIN@@
---
pattern: It is no use ~ing
ko: ~해 봤자 소용없다
ex: It is no use crying over spilt milk.
ex: It is no use arguing with him.
---
pattern: have a hard time ~ing
ko: ~하는 데 애를 먹다, ~하기 힘들다
ex: I had a hard time finding parking downtown.
ex: She is having a hard time adjusting to the new job.
---
@@PATTERN-DATA-END@@

[입력]
${PATTERN_PROMPT_PLACEHOLDER}`;

// ═══ 파서 (AppDataParser.cs 이식, 단어/패턴 두 종류) ═══
const Parser = (() => {
  const WORD_BEGIN = '@@APP-DATA-BEGIN@@';
  const WORD_END = '@@APP-DATA-END@@';
  const PAT_BEGIN = '@@PATTERN-DATA-BEGIN@@';
  const PAT_END = '@@PATTERN-DATA-END@@';

  function normalizeKey(s) {
    return (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function extractBlock(text, begin, end) {
    const lower = text.toLowerCase();
    let start = lower.indexOf(begin.toLowerCase());
    if (start < 0) return '';
    start += begin.length;
    let stop = lower.indexOf(end.toLowerCase(), start);
    if (stop < 0) stop = text.length;
    return text.slice(start, stop).trim();
  }

  function normalizeField(raw) {
    const key = raw.trim().toLowerCase().replace(/[-_\s]/g, '');
    switch (key) {
      case 'en': case 'english': case 'word': return 'en';
      case 'pronus': case 'us': case 'american': return 'pronus';
      case 'pronuk': case 'uk': case 'british': return 'pronuk';
      case 'ko': case 'korean': case 'meaning': case '뜻': return 'ko';
      case 'ctx': case 'context': case 'sentence': case '문장': return 'ctx';
      case 'pattern': case 'ptn': case '패턴': return 'pattern';
      case 'ex': case 'example': case '예문': return 'ex';
      default: return key;
    }
  }

  function splitChunks(block) {
    return block.split(/^\s*---+\s*$/m);
  }

  // ── 단어 블록 파싱 ──
  function parseWordChunk(chunk) {
    if (!chunk || !chunk.trim()) return null;
    const entry = { en: '', pronUs: '', pronUk: null, ko: '', contexts: [] };

    for (const rawLine of chunk.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      const m = line.match(/^([A-Za-z\-_]+)\s*[:：]\s*(.*)$/);
      if (!m) continue;
      const field = normalizeField(m[1]);
      const value = m[2].trim();

      switch (field) {
        case 'en': entry.en = value; break;
        case 'pronus': entry.pronUs = value; break;
        case 'pronuk': entry.pronUk = value; break;
        case 'ko': entry.ko = value; break;
        case 'ctx': if (value) entry.contexts.push(value); break;
      }
    }

    if (!entry.en) return null;
    if (!entry.pronUk || entry.pronUk === entry.pronUs) entry.pronUk = null;
    return entry;
  }

  // 마커가 없을 때: 첫 "en:" 줄부터 끝까지 (관대한 fallback)
  function fallbackExtractWords(text) {
    const m = text.match(/^\s*en\s*[:：]/im);
    if (!m) return '';
    return text.slice(m.index).trim();
  }

  function parseWords(rawText) {
    if (!rawText || !rawText.trim()) return [];
    let block = extractBlock(rawText, WORD_BEGIN, WORD_END);
    if (!block) block = fallbackExtractWords(rawText);
    if (!block) return [];

    const result = [];
    for (const chunk of splitChunks(block)) {
      const entry = parseWordChunk(chunk);
      if (entry) result.push(entry);
    }
    return result;
  }

  // ── 패턴 블록 파싱 (fallback 없음 — 마커 필수) ──
  function parsePatternChunk(chunk) {
    if (!chunk || !chunk.trim()) return null;
    const entry = { pattern: '', ko: '', examples: [] };

    for (const rawLine of chunk.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      const m = line.match(/^([A-Za-z\-_]+)\s*[:：]\s*(.*)$/);
      if (!m) continue;
      const field = normalizeField(m[1]);
      const value = m[2].trim();

      switch (field) {
        case 'pattern': entry.pattern = value; break;
        case 'ko': entry.ko = value; break;
        case 'ex': if (value) entry.examples.push(value); break;
      }
    }

    if (!entry.pattern) return null;
    return entry;
  }

  function parsePatterns(rawText) {
    if (!rawText || !rawText.trim()) return [];
    const block = extractBlock(rawText, PAT_BEGIN, PAT_END);
    if (!block) return [];

    const result = [];
    for (const chunk of splitChunks(block)) {
      const entry = parsePatternChunk(chunk);
      if (entry) result.push(entry);
    }
    return result;
  }

  return { parseWords, parsePatterns, normalizeKey };
})();
