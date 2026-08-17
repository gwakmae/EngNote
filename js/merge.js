'use strict';

// EntryImporter.cs 이식 — 단어/패턴 병합.
// 반환: { added, merged, skipped }
const Merger = (() => {
  function normalizeText(s) {
    return (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function ensureSource(source) {
    if (source && !source.id) {
      source.id = Data.nextId(Data.state.sources);
      source.createdUtc = new Date().toISOString();
      Data.state.sources.push(source);
      Data.markDirty();
    }
    return source;
  }

  // parsed: [{ en, pronUs, pronUk, ko, contexts: [] }]
  function importWords(parsed, source) {
    const entries = Data.state.entries;
    let added = 0, merged = 0, skipped = 0;
    ensureSource(source);

    const byKey = new Map();
    for (const e of entries) byKey.set(Parser.normalizeKey(e.en), e);

    for (const p of parsed) {
      const key = Parser.normalizeKey(p.en);
      const target = byKey.get(key);

      if (!target) {
        const entry = {
          id: Data.nextId(entries),
          en: p.en,
          pronUs: p.pronUs || '',
          pronUk: p.pronUk ?? null,
          ko: p.ko || '',
          sourceId: source ? source.id : null,
          contexts: [...(p.contexts || [])]
        };
        entries.push(entry);
        byKey.set(key, entry);
        added++;
        continue;
      }

      // 기존 단어: 맥락 병합 (출처는 최초 등록 출처 유지)
      let changed = false;

      for (const c of (p.contexts || [])) {
        const dup = target.contexts.some(tc => normalizeText(tc) === normalizeText(c));
        if (dup) { skipped++; continue; }
        target.contexts.push(c);
        changed = true;
      }
      if (p.ko && !target.ko.toLowerCase().includes(p.ko.toLowerCase())) {
        target.ko = target.ko ? target.ko + '; ' + p.ko : p.ko;
        changed = true;
      }
      if (!target.pronUs && p.pronUs) {
        target.pronUs = p.pronUs;
        changed = true;
      }
      if (target.pronUk == null && p.pronUk != null) {
        target.pronUk = p.pronUk;
        changed = true;
      }
      if (changed) merged++;
    }

    if (added + merged > 0) Data.markDirty();
    return { added, merged, skipped };
  }

  // parsed: [{ pattern, ko, examples: [] }]
  function importPatterns(parsed, source) {
    const patterns = Data.state.patterns;
    let added = 0, merged = 0, skipped = 0;
    ensureSource(source);

    const byKey = new Map();
    for (const p of patterns) byKey.set(Parser.normalizeKey(p.pattern), p);

    for (const p of parsed) {
      const key = Parser.normalizeKey(p.pattern);
      const target = byKey.get(key);

      if (!target) {
        const entry = {
          id: Data.nextId(patterns),
          pattern: p.pattern,
          ko: p.ko || '',
          sourceId: source ? source.id : null,
          examples: [...(p.examples || [])]
        };
        patterns.push(entry);
        byKey.set(key, entry);
        added++;
        continue;
      }

      // 기존 패턴: 예문 병합
      let changed = false;

      for (const ex of (p.examples || [])) {
        const dup = target.examples.some(te => normalizeText(te) === normalizeText(ex));
        if (dup) { skipped++; continue; }
        target.examples.push(ex);
        changed = true;
      }
      if (p.ko && !target.ko.toLowerCase().includes(p.ko.toLowerCase())) {
        target.ko = target.ko ? target.ko + '; ' + p.ko : p.ko;
        changed = true;
      }
      if (changed) merged++;
    }

    if (added + merged > 0) Data.markDirty();
    return { added, merged, skipped };
  }

  return { importWords, importPatterns };
})();
