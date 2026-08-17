'use strict';

// ═══ 공용 유틸 ═══
const Util = {
  escapeHtml(s) {
    return (s ?? '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
};

// ═══ 단어 분석 프롬프트 (@@ 표시법 + 발음 난이도 규칙 + 패턴 자동 분리) ═══
const WORD_PROMPT_PLACEHOLDER = '(여기에 표시한 영어 문장을 붙여넣는다)';

const WORD_PROMPT = `너는 영어 교사다. 나는 영어를 학습하는 한국인이다.
아래 [영어 문장]에서 내가 표시한 부분만 분석해줘.

[내가 표시하는 방법]
1. 한 단어만 모를 때: @@word (단어 앞에만 @@)
   예: The @@schedule is tight.
   
2. 여러 단어(숙어/구동사)를 모를 때: @@phrase here@@ (앞뒤로 @@)
   예: We need to @@take into account@@ the cost.
   
3. 문장 패턴이나 긴 구문을 모를 때: @@pattern part@@ (해당 부분을 앞뒤로)
   예: @@It is no use crying@@ over spilt milk.

- 표시되지 않은 부분은 내가 아는 내용이므로 절대 분석하지 않는다.
- 입력 텍스트에 한글이나 메모가 섞여 있어도 영어 문장만 추출해서 분석한다.

[분석 형식]
1. 전체 문장의 자연스러운 한국어 해석을 먼저 적는다.
2. 표시된 부분에 대해:
   - 한 단어(@@word)인 경우: 발음(어려운 단어만), 뜻, 문장 내 역할 설명
   - 여러 단어(@@phrase@@)인 경우: 숙어/구동사로 설명하고, 필요시 패턴으로도 분리
3. 문장 구조를 큰 틀부터 하향식으로 분석한다.

[앱 등록용 데이터 - 반드시 준수]
분석이 끝난 후 맨 마지막에 아래 블록들을 출력한다.
- 형식을 절대 바꾸지 않는다. 마크다운, 이모지, 부연설명 금지.
- ctx에는 @@ 표시를 제거한 깨끗한 문장을 쓴다.

(1) 단어 블록 — @@word 또는 @@phrase@@로 표시된 것이 "문장에 쓰이는 낱말/숙어"인 경우
- 하나당 "---"로 구분
- 필드: en(영어 원문), pron-us(미국 발음, 어려운 단어만), pron-uk(영국 발음, 다를 때만), ko(한국어 뜻), ctx(원문 문장)

@@APP-DATA-BEGIN@@
---
en: take into account
pron-us: 테익 인투 어카운트
ko: ~을 고려하다
ctx: We need to take into account the shipping cost.
---
@@APP-DATA-END@@

(2) 패턴 블록 — @@phrase@@로 표시된 것이 "재활용 가능한 문장 틀"인 경우 (없으면 생략)
- 하나당 "---"로 구분  
- 필드: pattern(빈자리는 ~로 표시), ko(설명), ex(예문, 방금 문장 포함)

@@PATTERN-DATA-BEGIN@@
---
pattern: It is no use ~ing
ko: ~해 봤자 소용없다
ex: It is no use crying over spilt milk.
---
@@PATTERN-DATA-END@@

[영어 문장]
${WORD_PROMPT_PLACEHOLDER}`;

// ═══ 문장 패턴 프롬프트 (패턴 전용 질문용) ═══
const PATTERN_PROMPT_PLACEHOLDER = '(여기에 영어 문장이나 패턴을 붙여넣는다)';

const PATTERN_PROMPT = `너는 영어 교사다. 나는 영어 문장 패턴(구문)을 학습하는 한국인이다.
아래 [입력]을 보고 영어 문장 패턴을 가르쳐줘.

[입력의 두 가지 경우]
- 영어 문장을 주면: 그 문장에 쓰인 핵심 패턴·구문을 뽑아 설명한다.
- 패턴 자체를 주면(예: It is no use ~ing): 그 패턴을 설명한다.

[분석 형식]
1. 패턴을 한눈에 보여준다. 예: It is no use + ~ing
2. 패턴의 의미와 뉘앙스를 한국어로 설명한다.
3. 문장 구조를 큰 틀부터 하향식으로 분석한다.
4. 예문 2~3개를 들고 해석을 붙인다.

[앱 등록용 데이터 - 반드시 준수]
위 분석 후 맨 마지막에 아래 블록을 정확히 한 번만 출력한다.
- 형식을 절대 바꾸지 않는다. 마크다운, 이모지, 부연설명 금지.
- 패턴 하나당 "---"로 구분.
- 필드: pattern(빈자리 ~), ko(설명), ex(예문)

@@PATTERN-DATA-BEGIN@@
---
pattern: It is no use ~ing
ko: ~해 봤자 소용없다
ex: It is no use crying over spilt milk.
ex: It is no use arguing with him.
---
@@PATTERN-DATA-END@@

[입력]
${PATTERN_PROMPT_PLACEHOLDER}`;

// ═══ 파서 ═══
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
