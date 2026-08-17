'use strict';

// EngNoteDbContext 이식.
// 저장소 = GitHub 저장소의 data/engnote.json 하나.
// 읽기: raw fetch (토큰 없이도 public repo면 가능)
// 쓰기: GitHub Contents API (토큰 필요, 설정 탭에서 입력)
const Data = (() => {
  const DEFAULTS = {
    owner: '', repo: '', branch: 'main',
    path: 'data/engnote.json', token: ''
  };

  const state = {
    version: 1,
    sources: [],   // { id, name, createdUtc }
    entries: [],   // { id, en, pronUs, pronUk, ko, sourceId, contexts: [] }
    patterns: []   // { id, pattern, ko, sourceId, examples: [] }
  };

  let sha = null;      // GitHub Contents API 저장 시 필요
  let dirty = false;   // 저장 안 된 변경 있음 표시

  // ── 설정 (localStorage) ──
  function loadSettings() {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('engnote-gh') || '{}') };
    } catch { return { ...DEFAULTS }; }
  }
  function saveSettings(s) {
    localStorage.setItem('engnote-gh', JSON.stringify(s));
  }

  function apiUrl(s) {
    return `https://api.github.com/repos/${s.owner}/${s.repo}/contents/${encodeURI(s.path)}?ref=${encodeURIComponent(s.branch)}`;
  }

  // ── 데이터 읽기 ──
  async function load() {
    const s = loadSettings();

    if (s.owner && s.repo) {
      const res = await fetch(apiUrl(s), {
        headers: s.token ? { Authorization: `Bearer ${s.token}` } : {}
      });
      if (res.ok) {
        const json = await res.json();
        sha = json.sha;
        applyText(decodeBase64(json.content));
        return { from: 'github' };
      }
      if (res.status !== 404) {
        console.warn('GitHub 읽기 실패, 정적 파일로 대체:', res.status);
      }
    }

    const res = await fetch(`data/engnote.json?ts=${Date.now()}`);
    if (!res.ok) throw new Error('data/engnote.json을 읽지 못했습니다.');
    applyText(await res.text());
    return { from: 'static' };
  }

  function applyText(text) {
    const parsed = JSON.parse(text);
    state.version = parsed.version ?? 1;
    state.sources = parsed.sources ?? [];
    state.entries = parsed.entries ?? [];
    state.patterns = parsed.patterns ?? [];
    dirty = false;
  }

  function decodeBase64(b64) {
    return decodeURIComponent(escape(atob(b64.replace(/\n/g, ''))));
  }
  function encodeBase64(text) {
    return btoa(unescape(encodeURIComponent(text)));
  }

  // ── 데이터 쓰기 (GitHub Contents API) ──
  async function save() {
    const s = loadSettings();
    if (!s.owner || !s.repo || !s.token)
      throw new Error('설정 탭에서 Owner / Repo / Token을 먼저 입력해 주세요.');

    if (!sha) {
      const head = await fetch(apiUrl(s), {
        headers: { Authorization: `Bearer ${s.token}` }
      });
      if (head.ok) sha = (await head.json()).sha;
    }

    const body = {
      message: `EngNote: 단어 ${state.entries.length}개·패턴 ${state.patterns.length}개 (${new Date().toISOString()})`,
      content: encodeBase64(JSON.stringify(state, null, 2)),
      branch: s.branch
    };
    if (sha) body.sha = sha;

    const res = await fetch(apiUrl(s), {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${s.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`저장 실패 (${res.status}): ${err.slice(0, 300)}`);
    }
    sha = (await res.json()).content.sha;
    dirty = false;
  }

  // ── 로컬 백업/복원 ──
  function exportJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `engnote-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importJson(file) {
    applyText(await file.text());
    markDirty();
  }

  // ── Id 발급 / 더티 플래그 ──
  function nextId(collection) {
    return collection.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1;
  }
  function markDirty() { dirty = true; }
  function isDirty() { return dirty; }

  return {
    state, load, save, exportJson, importJson,
    loadSettings, saveSettings, nextId, markDirty, isDirty
  };
})();
