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

  function attachSource(item, source) {
    const previousIds = Data.getSourceIds(item);
    const nextIds = [...previousIds];

    if (source && !nextIds.includes(source.id)) {
      nextIds.push(source.id);
    }

    item.sourceIds = nextIds;

    if (item.sourceId == null && nextIds.length > 0) {
      item.sourceId = nextIds[0];
    }

    return nextIds.length !== previousIds.length;
  }

  // parsed: [{ en, pronUs, pronUk, ko, contexts: [] }]
  function importWords(parsed, source) {
    const entries = Data.state.entries;
    let added = 0;
    let merged = 0;
    let skipped = 0;

    if (!parsed.length) return { added, merged, skipped };

    ensureSource(source);

    const byKey = new Map(
      entries.map(entry => [Parser.normalizeKey(entry.en), entry])
    );

    for (const item of parsed) {
      const key = Parser.normalizeKey(item.en);
      const target = byKey.get(key);
      const now = new Date().toISOString();

      if (!target) {
        const entry = {
          id: Data.nextId(entries),
          en: item.en,
          pronUs: item.pronUs || '',
          pronUk: item.pronUk ?? null,
          ko: item.ko || '',
          sourceId: source ? source.id : null,
          sourceIds: source ? [source.id] : [],
          contexts: [...new Set(item.contexts || [])],
          createdUtc: now,
          updatedUtc: now
        };

        entries.push(entry);
        byKey.set(key, entry);
        added++;
        continue;
      }

      let changed = attachSource(target, source);
      target.contexts = target.contexts || [];

      for (const context of item.contexts || []) {
        const duplicate = target.contexts.some(
          existing => normalizeText(existing) === normalizeText(context)
        );

        if (duplicate) continue;

        target.contexts.push(context);
        changed = true;
      }

      if (item.ko && !(target.ko || '').toLowerCase().includes(item.ko.toLowerCase())) {
        target.ko = target.ko ? target.ko + '; ' + item.ko : item.ko;
        changed = true;
      }

      if (!target.pronUs && item.pronUs) {
        target.pronUs = item.pronUs;
        changed = true;
      }

      if (target.pronUk == null && item.pronUk != null) {
        target.pronUk = item.pronUk;
        changed = true;
      }

      if (changed) {
        target.updatedUtc = now;
        merged++;
      } else {
        skipped++;
      }
    }

    if (added + merged > 0) Data.markDirty();

    return { added, merged, skipped };
  }

  // parsed: [{ pattern, ko, examples: [] }]
  function importPatterns(parsed, source) {
    const patterns = Data.state.patterns;
    let added = 0;
    let merged = 0;
    let skipped = 0;

    if (!parsed.length) return { added, merged, skipped };

    ensureSource(source);

    const byKey = new Map(
      patterns.map(pattern => [Parser.normalizeKey(pattern.pattern), pattern])
    );

    for (const item of parsed) {
      const key = Parser.normalizeKey(item.pattern);
      const target = byKey.get(key);
      const now = new Date().toISOString();

      if (!target) {
        const entry = {
          id: Data.nextId(patterns),
          pattern: item.pattern,
          ko: item.ko || '',
          sourceId: source ? source.id : null,
          sourceIds: source ? [source.id] : [],
          examples: [...new Set(item.examples || [])],
          createdUtc: now,
          updatedUtc: now
        };

        patterns.push(entry);
        byKey.set(key, entry);
        added++;
        continue;
      }

      let changed = attachSource(target, source);
      target.examples = target.examples || [];

      for (const example of item.examples || []) {
        const duplicate = target.examples.some(
          existing => normalizeText(existing) === normalizeText(example)
        );

        if (duplicate) continue;

        target.examples.push(example);
        changed = true;
      }

      if (item.ko && !(target.ko || '').toLowerCase().includes(item.ko.toLowerCase())) {
        target.ko = target.ko ? target.ko + '; ' + item.ko : item.ko;
        changed = true;
      }

      if (changed) {
        target.updatedUtc = now;
        merged++;
      } else {
        skipped++;
      }
    }

    if (added + merged > 0) Data.markDirty();

    return { added, merged, skipped };
  }

  // ── 출처 병합 ──
  // sourceIds에 속한 출처들의 단어·패턴을 모두 targetId 출처로 옮기고,
  // 옮겨진 출처들은 삭제한다. newName이 있으면 대상 출처 이름도 바꾼다.
  // 반환: 옮겨진 항목 수 (단어 + 패턴)
  function mergeSources(targetId, sourceIds, newName) {
    const target = Data.state.sources.find(source => source.id === targetId);
    if (!target) return 0;

    const moving = new Set(sourceIds.filter(id => id !== targetId));
    if (!moving.size) return 0;

    if (newName && newName.trim()) {
      target.name = newName.trim();
    }

    let moved = 0;

    for (const item of [...Data.state.entries, ...Data.state.patterns]) {
      const ids = Data.getSourceIds(item);
      if (!ids.some(id => moving.has(id))) continue;

      item.sourceIds = [...new Set(
        ids.map(id => moving.has(id) ? targetId : id)
      )];

      if (moving.has(item.sourceId)) {
        item.sourceId = targetId;
      } else if (item.sourceId == null) {
        item.sourceId = item.sourceIds[0] ?? null;
      }

      moved++;
    }

    Data.state.sources = Data.state.sources.filter(
      source => !moving.has(source.id)
    );

    Data.markDirty();
    return moved;
  }

  return { importWords, importPatterns, mergeSources };
})();