'use strict';

// 단어 탭 — EngNote MainWindow + NhatKy listView 이식
const WordView = (() => {
  const SortMode = { HIERARCHY: 'hierarchy', NEWEST: 'newest', ALPHA: 'alpha', FREQ: 'freq' };

  let sortMode = SortMode.HIERARCHY;
  let searchText = '';
  const checkedSourceIds = new Set();   // 비어 있으면 전체 보기
  let highlightKeys = null;

  const $ = sel => document.querySelector(sel);

  // ── 렌더 진입점 ──
  function render(container) {
    container.innerHTML = `
      <div class="prompt-panel">
        <details class="usage-guide" open>
          <summary>표시하는 방법</summary>
          <ul>
            <li>한 단어 모를 때: <code>@@word</code> (앞에만)</li>
            <li>숙어/구동사 모를 때: <code>@@take into account@@</code> (앞뒤로)</li>
            <li>문장 패턴 모를 때: <code>@@It is no use crying@@</code> (해당 부분)</li>
            <li>단어·구만 통째로 물어볼 때: 그냥 적고 <strong>직접 질문 프롬프트</strong> 사용</li>
            <li>여러 개 표시 가능, 한글 메모 섞여도 OK</li>
          </ul>
        </details>
        <strong>분석할 영어 (문장 / 구 / 단어)</strong>
        <textarea id="word-analysis-input" rows="4" placeholder="예: We need to @@take into account@@ the shipping cost.&#10;또는 그냥: take into account"></textarea>
        <div class="prompt-buttons">
          <button id="btn-copy-filled" class="primary">📋 문장 포함 복사</button>
          <button id="btn-copy-prompt" class="muted">📄 프롬프트만 복사</button>
        </div>
        <details>
          <summary style="cursor:pointer;font-size:13px;color:#777">프롬프트 보기 (문장에서 @@ 표시 분석용)</summary>
          <textarea id="word-prompt-preview" rows="10" style="margin-top:6px;font-size:12px">${Util.escapeHtml(WORD_PROMPT)}</textarea>
        </details>
        <details>
          <summary style="cursor:pointer;font-size:13px;color:#777">직접 질문 프롬프트 (단어·구·문장 모두 이것 하나로)</summary>
          <p style="font-size:12px;color:#777;margin:6px 0 0">
            위 입력창에 단어·구·문장을 적고 아래 버튼을 누르면, 내용이 프롬프트에 끼워져서 복사됩니다.
          </p>
          <textarea id="manual-prompt-preview" rows="10" style="margin-top:6px;font-size:12px">${Util.escapeHtml(MANUAL_PROMPT)}</textarea>
          <button id="btn-copy-manual" class="muted" style="margin-top:6px;width:100%">📄 직접 질문 프롬프트 복사 (입력 내용 포함)</button>
        </details>
      </div>
      <div class="list-column">
        <div class="list-toolbar">
          <input id="word-search" class="search" type="search" placeholder="검색 (영어/뜻/문장)">
          <button id="word-source-btn" class="ghost source-btn">출처: 전체 보기 ▾</button>
          <select id="word-sort">
            <option value="hierarchy">계층 관계</option>
            <option value="newest">최근 등록순</option>
            <option value="alpha">알파벳순</option>
            <option value="freq">자주 본 순</option>
          </select>
          <button id="word-manual-add" class="primary">✏️ 수동 추가</button>
        </div>
        <div class="entry-scroll"><div id="word-list"></div></div>
      </div>
    `;

    $('#word-sort').value = sortMode;
    $('#word-sort').addEventListener('change', e => { sortMode = e.target.value; refresh(); });
    $('#word-search').addEventListener('input', e => { searchText = e.target.value; refresh(); });
    $('#word-manual-add').addEventListener('click', openManualModal);
    $('#word-source-btn').addEventListener('click', () =>
      App.openSourceModal({ checkedIds: checkedSourceIds, onChanged: refresh }));
    $('#btn-copy-filled').addEventListener('click', copyPromptWithSentence);
    $('#btn-copy-prompt').addEventListener('click', () =>
      App.copyText($('#word-prompt-preview').value, '프롬프트 복사됨 ✓ — 캡처 이미지와 함께 붙여넣으세요'));
    $('#btn-copy-manual').addEventListener('click', copyManualPrompt);

    refresh();
  }

  // ── 필터 + 정렬 + 그리기 ──
  function refresh() {
    if (!$('#word-list')) return;

    const all = Data.state.entries;
    const q = searchText.trim().toLowerCase();

    let filtered = all;
    if (checkedSourceIds.size > 0)
      filtered = filtered.filter(e => e.sourceId != null && checkedSourceIds.has(e.sourceId));
    if (q) {
      filtered = filtered.filter(e =>
        e.en.toLowerCase().includes(q) ||
        (e.ko || '').toLowerCase().includes(q) ||
        (e.contexts || []).some(c => c.toLowerCase().includes(q)));
    }

    let sorted;
    switch (sortMode) {
      case SortMode.HIERARCHY: sorted = buildHierarchy(filtered); break;
      case SortMode.NEWEST: sorted = [...filtered].sort((a, b) => b.id - a.id).map(e => ({ entry: e, child: false })); break;
      case SortMode.ALPHA: sorted = [...filtered].sort((a, b) => a.en.localeCompare(b.en, 'en')).map(e => ({ entry: e, child: false })); break;
      case SortMode.FREQ: sorted = [...filtered].sort((a, b) => (b.contexts?.length || 0) - (a.contexts?.length || 0)).map(e => ({ entry: e, child: false })); break;
      default: sorted = filtered.map(e => ({ entry: e, child: false }));
    }

    drawList(sorted);

    App.setHeader(
      filtered.length === all.length
        ? `단어 총 ${all.length.toLocaleString()}개`
        : `단어 ${all.length.toLocaleString()}개 중 ${filtered.length.toLocaleString()}개 표시`);
    updateSourceButton();
  }

  // ── 계층 정리: "take"가 있고 "take into account"도 있으면 자식으로 ──
  function buildHierarchy(list) {
    const parentOf = new Map();

    for (const child of list) {
      const childKey = Parser.normalizeKey(child.en);
      let best = null;
      for (const parent of list) {
        if (parent.id === child.id) continue;
        const parentKey = Parser.normalizeKey(parent.en);
        if (!parentKey) continue;
        if (childKey.startsWith(parentKey + ' ')) {
          if (!best || parent.en.trim().length > best.en.trim().length) best = parent;
        }
      }
      if (best) parentOf.set(child.id, best.id);
    }

    const result = [];
    const placed = new Set();

    function addWithChildren(node, isChild) {
      if (placed.has(node.id)) return;
      placed.add(node.id);
      result.push({ entry: node, child: isChild });
      const children = list
        .filter(c => parentOf.get(c.id) === node.id)
        .sort((a, b) => a.en.localeCompare(b.en, 'en'));
      for (const c of children) addWithChildren(c, true);
    }

    const roots = list
      .filter(e => !parentOf.has(e.id))
      .sort((a, b) => a.en.localeCompare(b.en, 'en'));
    for (const r of roots) addWithChildren(r, false);

    for (const e of list.filter(x => !placed.has(x.id)).sort((a, b) => a.en.localeCompare(b.en, 'en')))
      result.push({ entry: e, child: false });

    return result;
  }

  // ── 목록 그리기 ──
  function drawList(items) {
    const host = $('#word-list');
    if (!host) return;
    host.innerHTML = '';

    const frag = document.createDocumentFragment();
    for (const { entry, child } of items) {
      const div = document.createElement('div');
      div.className = 'entry-item' + (child ? ' child' : '');
      div.dataset.id = entry.id;

      if (highlightKeys && (entry.contexts || []).some(c => highlightKeys.has(Parser.normalizeKey(c))))
        div.classList.add('highlighted');

      const en = document.createElement('span');
      en.className = 'entry-en';
      en.textContent = (child ? '└ ' : '') + entry.en;
      div.appendChild(en);

      // 발음: 있는 것(난이도 있는 단어)만 미국 발음 표시
      if (entry.pronUs) {
        const pron = document.createElement('span');
        pron.className = 'entry-pron';
        pron.textContent = entry.pronUs;
        div.appendChild(pron);
      }

      const ko = document.createElement('span');
      ko.className = 'entry-ko';
      ko.textContent = entry.ko || '';
      div.appendChild(ko);

      div.addEventListener('click', () => openDetail(entry));
      div.addEventListener('mouseenter', () => highlightGroup(entry));
      div.addEventListener('mouseleave', clearHighlights);

      frag.appendChild(div);
    }
    host.appendChild(frag);
  }

  // ── 관계 하이라이트: 같은 원문 문장을 공유하는 단어들 ──
  function highlightGroup(entry) {
    if (!(entry.contexts || []).length) return;
    highlightKeys = new Set(entry.contexts.map(c => Parser.normalizeKey(c)));
    applyHighlights();
  }
  function clearHighlights() {
    if (!highlightKeys) return;
    highlightKeys = null;
    applyHighlights();
  }
  function applyHighlights() {
    document.querySelectorAll('#word-list .entry-item').forEach(el => {
      const entry = Data.state.entries.find(e => e.id === +el.dataset.id);
      const on = !!(highlightKeys && entry && (entry.contexts || []).some(c => highlightKeys.has(Parser.normalizeKey(c))));
      el.classList.toggle('highlighted', on);
    });
  }

  // ── 상세 카드 (미국 발음 기본, 영국 발음은 있을 때만) ──
  function openDetail(entry) {
    const source = Data.state.sources.find(s => s.id === entry.sourceId);

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'detail-modal';
    modal.innerHTML = `
      <div class="modal-card">
        <div class="detail-en">${Util.escapeHtml(entry.en)}</div>
        <div class="detail-source">출처: ${Util.escapeHtml(source ? source.name : '(수동/미지정)')}</div>
        ${entry.pronUs ? `<div class="detail-pron">미국&nbsp; ${Util.escapeHtml(entry.pronUs)}</div>` : ''}
        ${entry.pronUk ? `<div class="detail-pron">영국&nbsp; ${Util.escapeHtml(entry.pronUk)}</div>` : ''}
        <div class="detail-ko">${Util.escapeHtml(entry.ko || '')}</div>
        <hr>
        <div class="ctx-head">원문 문장 (${(entry.contexts || []).length})</div>
        <ul class="ctx-list">
          ${(entry.contexts || []).map(c => `<li>${Util.escapeHtml(c)}</li>`).join('')}
        </ul>
        <div class="card-buttons">
          <button class="danger" id="btn-detail-delete">삭제</button>
          <button id="btn-detail-close">닫기</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#btn-detail-close').addEventListener('click', closeDetail);
    modal.addEventListener('click', e => { if (e.target === modal) closeDetail(); });
    modal.querySelector('#btn-detail-delete').addEventListener('click', () => {
      if (!confirm(`'${entry.en}' 를 삭제할까요?`)) return;
      const i = Data.state.entries.findIndex(e => e.id === entry.id);
      if (i >= 0) Data.state.entries.splice(i, 1);
      Data.markDirty();
      App.setSyncDirty();
      closeDetail();
      refresh();
      App.toast('삭제됨');
    });
  }
  function closeDetail() {
    $('#detail-modal')?.remove();
  }

  // ── 수동 추가 모달 ──
  function openManualModal() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'manual-modal';
    modal.innerHTML = `
      <div class="modal-card">
        <h2 style="color:var(--primary)">수동으로 단어 추가</h2>
        <label class="field">영어 *<input id="m-en" autocomplete="off" placeholder="예: take into account"></label>
        <label class="field">미국 발음 (한글 — 어려운 단어만)<input id="m-pron-us" autocomplete="off"></label>
        <label class="field">영국 발음 (미국과 다를 때만)<input id="m-pron-uk" autocomplete="off"></label>
        <label class="field">한국어 뜻 (문맥상의 의미)<input id="m-ko" autocomplete="off"></label>
        <label class="field">원문 문장 (이 단어를 만난 문장)<textarea id="m-ctx" rows="2"></textarea></label>
        <div class="card-buttons">
          <button id="m-cancel">취소</button>
          <button class="primary" id="m-save">저장</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('#m-en').focus();

    modal.querySelector('#m-cancel').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    modal.querySelector('#m-save').addEventListener('click', () => {
      try {
        const en = modal.querySelector('#m-en').value.trim();
        if (!en) { App.toast('영어 원문은 꼭 입력해 주세요.', true); return; }

        const pronUs = modal.querySelector('#m-pron-us').value.trim();
        let pronUk = modal.querySelector('#m-pron-uk').value.trim();
        if (!pronUk || pronUk === pronUs) pronUk = null;
        const ctx = modal.querySelector('#m-ctx').value.trim();

        const parsed = [{ en, pronUs, pronUk, ko: modal.querySelector('#m-ko').value.trim(), contexts: ctx ? [ctx] : [] }];
        const { added, merged } = Merger.importWords(parsed, null);

        App.setSyncDirty();
        modal.remove();
        refresh();
        App.toast(added > 0 ? `'${en}' 등록됨` : merged > 0 ? `'${en}' 기존 항목에 합쳐짐` : `'${en}' 이미 동일한 내용 있음`);
      } catch (err) {
        console.error(err);
        App.toast('저장 중 오류: ' + err.message, true);
      }
    });
  }

  function updateSourceButton() {
    const btn = $('#word-source-btn');
    if (!btn) return;
    const names = Data.state.sources.filter(s => checkedSourceIds.has(s.id)).map(s => s.name);
    btn.textContent = '출처: ' + (names.length === 0 ? '전체 보기' : names.length === 1 ? names[0] : `${names.length}개 선택됨`) + ' ▾';
  }

  // ── 프롬프트 복사 ──
  function copyPromptWithSentence() {
    const sentence = $('#word-analysis-input').value.trim();
    const template = $('#word-prompt-preview').value;
    const text = sentence
      ? (template.includes(WORD_PROMPT_PLACEHOLDER)
        ? template.replace(WORD_PROMPT_PLACEHOLDER, sentence)
        : template + '\n\n[영어 문장]\n' + sentence)
      : template;
    App.copyText(text, '문장 포함 복사됨 ✓');
  }

  // ── 직접 질문 프롬프트 복사 (입력창 내용을 [입력] 자리에 끼움) ──
  function copyManualPrompt() {
    const input = $('#word-analysis-input').value.trim();
    const template = $('#manual-prompt-preview').value;
    const text = input
      ? (template.includes(MANUAL_PROMPT_PLACEHOLDER)
        ? template.replace(MANUAL_PROMPT_PLACEHOLDER, input)
        : template + '\n\n[입력]\n' + input)
      : template;
    App.copyText(text, input
      ? '직접 질문 프롬프트 복사됨 ✓ (입력 내용 포함)'
      : '직접 질문 프롬프트 복사됨 ✓ — 입력 내용이 비어 있습니다');
  }

  return { render, refresh };
})();
