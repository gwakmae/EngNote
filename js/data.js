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
  let saving = false;
  let loading = false;
  let revision = 0;
  let localBackupOk = false;

  function getSourceIds(item) {
    const ids = [];

    if (Array.isArray(item.sourceIds)) ids.push(...item.sourceIds);
    if (item.sourceId != null) ids.push(item.sourceId);

    return [...new Set(
      ids.map(Number).filter(id => Number.isSafeInteger(id) && id > 0)
    )];
  }

  function draftKey(settings = loadSettings()) {
    return 'engnote-draft:' + JSON.stringify([
      settings.owner,
      settings.repo,
      settings.branch,
      settings.path
    ]);
  }

  function writeLocalDraft() {
    try {
      localStorage.setItem(draftKey(), JSON.stringify({
        savedAt: new Date().toISOString(),
        sha,
        data: state
      }));
      localBackupOk = true;
    } catch (error) {
      localBackupOk = false;
      console.error('브라우저 임시 저장 실패:', error);
    }
  }

  function removeLocalDraft() {
    try {
      localStorage.removeItem(draftKey());
    } catch (error) {
      console.warn('임시 데이터 정리 실패:', error);
    }
  }

  // ── 설정 (localStorage) ──
  function loadSettings() {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('engnote-gh') || '{}') };
    } catch { return { ...DEFAULTS }; }
  }
  function saveSettings(s) {
    if (saving || loading) {
      throw new Error('데이터 저장 또는 불러오기가 끝난 뒤 설정을 변경해 주세요.');
    }

    const previousKey = draftKey();
    const nextSettings = { ...DEFAULTS, ...s };
    const nextKey = draftKey(nextSettings);

    localStorage.setItem('engnote-gh', JSON.stringify(nextSettings));

    if (previousKey !== nextKey) {
      sha = null;

      if (dirty) {
        writeLocalDraft();

        if (localBackupOk) {
          try {
            localStorage.removeItem(previousKey);
          } catch (error) {
            console.warn('이전 임시 데이터 정리 실패:', error);
          }
        }
      }
    }
  }

  function apiUrl(s) {
    return `https://api.github.com/repos/${s.owner}/${s.repo}/contents/${encodeURI(s.path)}?ref=${encodeURIComponent(s.branch)}`;
  }

  // ── 데이터 읽기 ──
  async function load({ ignoreDraft = false } = {}) {
    if (saving || loading) {
      throw new Error('다른 저장 또는 불러오기 작업이 진행 중입니다.');
    }

    loading = true;
    const startRevision = revision;
    const settings = loadSettings();
    let warning = '';

    function applyLoadedText(text, nextSha) {
      if (revision !== startRevision) {
        throw new Error('불러오는 동안 데이터가 변경되어 덮어쓰기를 중단했습니다.');
      }

      applyText(text);
      sha = nextSha;
    }

    try {
      if (!ignoreDraft) {
        let rawDraft = null;

        try {
          rawDraft = localStorage.getItem(draftKey(settings));
        } catch (error) {
          warning = '브라우저 임시 저장소에 접근하지 못했습니다.';
          console.warn(error);
        }

        if (rawDraft) {
          const draft = JSON.parse(rawDraft);

          if (!draft || !draft.data) {
            throw new Error('임시 데이터 형식이 올바르지 않습니다. 브라우저 데이터를 삭제하지 말고 확인해 주세요.');
          }

          applyLoadedText(JSON.stringify(draft.data), draft.sha || null);
          dirty = true;
          writeLocalDraft();

          return { from: 'local', warning };
        }
      }

      if (settings.owner && settings.repo) {
        const response = await fetch(apiUrl(settings), {
          headers: settings.token
            ? { Authorization: `Bearer ${settings.token}` }
            : {},
          cache: 'no-store'
        });

        if (response.ok) {
          const result = await response.json();

          if (typeof result.content !== 'string') {
            throw new Error('GitHub 응답에 데이터 본문이 없습니다.');
          }

          applyLoadedText(decodeBase64(result.content), result.sha);

          if (ignoreDraft) removeLocalDraft();
          return { from: 'github', warning };
        }

        if (response.status !== 404) {
          throw new Error(`GitHub 읽기 실패 (${response.status}). 저장소와 토큰을 확인해 주세요.`);
        }

        warning = 'GitHub에서 데이터 파일을 찾지 못해 정적 파일을 불러왔습니다.';
      }

      const response = await fetch(`data/engnote.json?ts=${Date.now()}`, {
        cache: 'no-store'
      });

      if (!response.ok) {
        throw new Error('data/engnote.json을 읽지 못했습니다.');
      }

      applyLoadedText(await response.text(), null);

      if (ignoreDraft) removeLocalDraft();
      return { from: 'static', warning };
    } finally {
      loading = false;
    }
  }

  function applyText(text) {
    const parsed = JSON.parse(text);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('JSON 최상위 형식이 올바르지 않습니다.');
    }

    for (const field of ['sources', 'entries', 'patterns']) {
      if (parsed[field] != null && !Array.isArray(parsed[field])) {
        throw new Error(`${field}는 배열이어야 합니다.`);
      }
    }

    function normalizeCollection(collection, textField, listField) {
      const seen = new Set();

      return collection.map(original => {
        if (!original || typeof original !== 'object') {
          throw new Error('JSON 항목 형식이 올바르지 않습니다.');
        }

        const id = Number(original.id);

        if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) {
          throw new Error('JSON 항목 ID가 없거나 중복되었습니다.');
        }
        seen.add(id);

        if (typeof original[textField] !== 'string' || !original[textField].trim()) {
          throw new Error(`${textField} 값이 없는 항목이 있습니다.`);
        }

        const item = {
          ...original,
          id,
          [textField]: original[textField].trim()
        };

        if (listField) {
          if (original[listField] != null && !Array.isArray(original[listField])) {
            throw new Error(`${listField}는 배열이어야 합니다.`);
          }

          item[listField] = (original[listField] || [])
            .filter(value => typeof value === 'string' && value.trim())
            .map(value => value.trim());

          item.ko = typeof original.ko === 'string' ? original.ko : '';
          item.sourceIds = getSourceIds(original);

          const legacySourceId = Number(original.sourceId);
          item.sourceId = item.sourceIds.includes(legacySourceId)
            ? legacySourceId
            : item.sourceIds[0] ?? null;

          if (textField === 'en') {
            item.pronUs = typeof original.pronUs === 'string' ? original.pronUs : '';
            item.pronUk = typeof original.pronUk === 'string' && original.pronUk
              ? original.pronUk
              : null;
          }
        }

        return item;
      });
    }

    const sources = normalizeCollection(parsed.sources || [], 'name', null);
    const entries = normalizeCollection(parsed.entries || [], 'en', 'contexts');
    const patterns = normalizeCollection(parsed.patterns || [], 'pattern', 'examples');

    state.version = Math.max(2, Number(parsed.version) || 1);
    state.sources = sources;
    state.entries = entries;
    state.patterns = patterns;

    dirty = false;
    localBackupOk = false;
    revision++;
  }

  function decodeBase64(b64) {
    return decodeURIComponent(escape(atob(b64.replace(/\n/g, ''))));
  }
  function encodeBase64(text) {
    return btoa(unescape(encodeURIComponent(text)));
  }

  // ── 데이터 쓰기 (GitHub Contents API) ──
  async function save() {
    if (saving || loading) {
      throw new Error('다른 저장 또는 불러오기 작업이 진행 중입니다.');
    }

    const settings = loadSettings();

    if (!settings.owner || !settings.repo || !settings.token) {
      throw new Error('설정 탭에서 Owner / Repo / Token을 먼저 입력해 주세요.');
    }

    saving = true;

    try {
      if (!sha) {
        const head = await fetch(apiUrl(settings), {
          headers: { Authorization: `Bearer ${settings.token}` },
          cache: 'no-store'
        });

        if (head.ok) {
          sha = (await head.json()).sha;
        } else if (head.status !== 404) {
          throw new Error(`저장 전 파일 확인 실패 (${head.status})`);
        }
      }

      const snapshot = JSON.stringify(state);
      const body = {
        message:
          `EngNote: 단어 ${state.entries.length}개·패턴 ${state.patterns.length}개 ` +
          `(${new Date().toISOString()})`,
        content: encodeBase64(JSON.stringify(state, null, 2)),
        branch: settings.branch
      };

      if (sha) body.sha = sha;

      const response = await fetch(apiUrl(settings), {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${settings.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const message = await response.text();

        if (response.status === 409) {
          throw new Error(
            '다른 기기에서 파일이 변경되었습니다. 현재 JSON을 백업한 뒤 최신 데이터를 확인해 주세요. 자동 덮어쓰기는 하지 않았습니다.'
          );
        }

        throw new Error(`저장 실패 (${response.status}): ${message.slice(0, 300)}`);
      }

      const result = await response.json();
      sha = result.content.sha;

      if (JSON.stringify(state) === snapshot) {
        dirty = false;
        localBackupOk = false;
        removeLocalDraft();
      } else {
        dirty = true;
        writeLocalDraft();
      }
    } finally {
      saving = false;
    }
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
    if (saving || loading) {
      throw new Error('저장 또는 불러오기가 끝난 뒤 복원해 주세요.');
    }

    const startRevision = revision;
    const text = await file.text();

    if (saving || loading || revision !== startRevision) {
      throw new Error('파일을 읽는 동안 데이터가 변경되어 복원을 중단했습니다.');
    }

    applyText(text);
    markDirty();
  }

  // ── Id 발급 / 더티 플래그 ──
  function nextId(collection) {
    return collection.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1;
  }
  function markDirty() {
    dirty = true;
    revision++;
    writeLocalDraft();
  }

  function hasLocalBackup() {
    return dirty && localBackupOk;
  }

  function isDirty() { return dirty; }

  return {
    state, load, save, exportJson, importJson,
    loadSettings, saveSettings, nextId, markDirty, isDirty,
    getSourceIds, hasLocalBackup
  };
})();