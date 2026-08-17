'use strict';

// 문장 패턴 탭 — 패턴 목록, 검색, 정렬, 상세 카드, 수동 추가
const PatternView = (() => {
  const SortMode = { NEWEST: 'newest', ALPHA: 'alpha', FREQ: 'freq' };

  let sortMode = SortMode.NEWEST;
  let searchText = '';
  const checkedSourceIds = new Set();

  const $ = sel => document.querySelector(sel);

  function render(container) {
    container.innerHTML = `
      <div class="prompt-panel">
        <details class="usage-guide">
          <summary>표시하는 방법</summary>
          <ul>
            <li>문장에서 패턴 배우기: <code>@@It is no use crying@@</code> over spilt milk.</li>
            <li>패턴 직접 질문: <code>It is no use ~ing</code> 또는 <code>have a hard time ~ing</code></li>
            <li>단어 탭에서 @@ 표시한 문장을 여기 붙여도 자동으로 패턴 분석됨</li>
          </ul>
        </details>
        <strong>패턴을 배울 영어 문장 / 패턴</strong>
        <textarea id="pat-analysis-input" rows="4" placeholder="예: @@It is no use crying@@ over spilt milk. 또는 It is no use ~ing"></textarea>
        <div class="prompt-buttons">
          <button id="pat-copy-filled" class="primary">📋 입력 포함 복사</button>
          <button id="pat-copy-prompt" class="muted">📄 프롬프트만 복사</button>
        </div>
        <details>
          <summary style="cursor:pointer;font-size:13px;color:#777">프롬프트 보기</summary>
          <textarea id="pat-prompt-preview" rows="10" style="margin-top:6px;font-size:12px">${Util.escapeHtml(PATTERN_PROMPT)}</textarea>
        </details>
      </div>
      <div class="list-column">
        <div class="list-toolbar">
          <input id="pat-search" class="search" type="search" placeholder="검색 (패턴/설명/예문)">
          <button id="pat-source-btn" class="ghost source-btn">출처: 전체 보기 ▾</button>
          <select id="pat-sort">
            <option value="newest">최근 등록순</option>
            <option value="alpha">알파벳순</option>
            <option value="freq">예문 많은 순</option>
          </select>
          <button id="pat-manual-add" class="primary">✏️ 수동 추가</button>
        </div>
        <div class="entry-scroll"><div id="pattern-list"></div></div>
      </div>
    `;

    $('#pat-sort').value = sortMode;
    $('#pat-sort').addEventListener('change', e => { sortMode = e.target.value; refresh(); });
    $('#pat-search').addEventListener('input', e => { searchText = e.target.value; refresh(); });
    $('#pat-manual-add').addEventListener('click', openManualModal);
    $('#pat-source-btn').addEventListener('click', () =>
      App.openSourceModal({ checkedIds: checkedSourceIds, onChanged: refresh }));
    $('#pat-copy-filled').addEventListener('click', copyPromptWithInput);
    $('#pat-copy-prompt').addEventListener('click', () =>
      App.copyText($('#pat-prompt-preview').value, '프롬프트 복사됨 ✓'));

    refresh();
  }

  function refresh() {
    if (!$('#pattern-list')) return;

    const all = Data.state.patterns;
    const q = searchText.trim().toLowerCase();

    let filtered = all;
    if (checkedSourceIds.size > 0)
      filtered = filtered.filter(p => p.sourceId != null && checkedSourceIds.has(p.sourceId));
    if (q) {
      filtered = filtered.filter(p =>
        p.pattern.toLowerCase().includes(q) ||
        (p.ko || '').toLowerCase().includes(q) ||
        (p.examples || []).some(ex => ex.toLowerCase().includes(q)));
    }

    let sorted;
    switch (sortMode) {
      case SortMode.ALPHA: sorted = [...filtered].sort((a, b) => a.pattern.localeCompare(b.pattern, 'en')); break;
      case SortMode.FREQ: sorted = [...filtered].sort((a, b) => (b.examples?.length || 0) - (a.examples?.length || 0)); break;
      default: sorted = [...filtered].sort((a, b) => b.id - a.id);
    }

    drawList(sorted);

    App.setHeader(
      filtered.length === all.length
        ? `패턴 총 ${all.length.toLocaleString()}개`
        : `패턴 ${all.length.toLocaleString()}개 중 ${filtered.length.toLocaleString()}개 표시`);
    updateSourceButton();
  }

  function drawList(items) {
    const host = $('#pattern-list');
    if (!host) return;
    host.innerHTML = '';

    const frag = document.createDocumentFragment();
    for (const entry of items) {
      const div = document.createElement('div');
      div.className = 'entry-item';
      div.dataset.id = entry.id;

      const pat = document.createElement('span');
      pat.className = 'entry-en';
      pat.textContent = entry.pattern;

      const ko = document.createElement('span');
      ko.className = 'entry-ko';
      ko.textContent = entry.ko || '';

      div.append(pat, ko);
      div.addEventListener('click', () => openDetail(entry));
      frag.appendChild(div);
    }
    host.appendChild(frag);
  }

  // ── 상세 카드 ──
  function openDetail(entry) {
    const source = Data.state.sources.find(s => s.id === entry.sourceId);

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'detail-modal';
    modal.innerHTML = `
      <div class="modal-card">
        <div class="detail-en">${Util.escapeHtml(entry.pattern)}</div>
        <div class="detail-source">출처: ${Util.escapeHtml(source ? source.name : '(수동/미지정)')}</div>
        <div class="detail-ko">${Util.escapeHtml(entry.ko || '')}</div>
        <hr>
        <div class="ctx-head">예문 (${(entry.examples || []).length})</div>
        <ul class="ctx-list">
          ${(entry.examples || []).map(ex => `<li>${Util.escapeHtml(ex)}</li>`).join('')}
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
      if (!confirm(`'${entry.pattern}' 을 삭제할까요?`)) return;
      const i = Data.state.patterns.findIndex(p => p.id === entry.id);
      if (i >= 0) Data.state.patterns.splice(i, 1);
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
        <h2 style="color:var(--primary)">수동으로 패턴 추가</h2>
        <label class="field">영어 패턴 * (빈자리는 ~ 로)<input id="p-pattern" autocomplete="off" placeholder="예: It is no use ~ing"></label>
        <label class="field">한국어 설명 / 뜻<input id="p-ko" autocomplete="off"></label>
        <label class="field">예문<textarea id="p-ex" rows="2"></textarea></label>
        <div class="card-buttons">
          <button id="p-cancel">취소</button>
          <button class="primary" id="p-save">저장</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('#p-pattern').focus();

    modal.querySelector('#p-cancel').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    modal.querySelector('#p-save').addEventListener('click', () => {
      try {
        const pattern = modal.querySelector('#p-pattern').value.trim();
        if (!pattern) { App.toast('영어 패턴은 꼭 입력해 주세요.', true); return; }

        const ex = modal.querySelector('#p-ex').value.trim();
        const parsed = [{ pattern, ko: modal.querySelector('#p-ko').value.trim(), examples: ex ? [ex] : [] }];
        const { added, merged } = Merger.importPatterns(parsed, null);

        App.setSyncDirty();
        modal.remove();
        refresh();
        App.toast(added > 0 ? `'${pattern}' 등록됨` : merged > 0 ? `'${pattern}' 기존 항목에 합쳐짐` : `'${pattern}' 이미 동일한 내용 있음`);
      } catch (err) {
        console.error(err);
        App.toast('저장 중 오류: ' + err.message, true);
      }
    });
  }

  function updateSourceButton() {
    const btn = $('#pat-source-btn');
    if (!btn) return;
    const names = Data.state.sources.filter(s => checkedSourceIds.has(s.id)).map(s => s.name);
    btn.textContent = '출처: ' + (names.length === 0 ? '전체 보기' : names.length === 1 ? names[0] : `${names.length}개 선택됨`) + ' ▾';
  }

  function copyPromptWithInput() {
    const input = $('#pat-analysis-input').value.trim();
    const template = $('#pat-prompt-preview').value;
    const text = input
      ? (template.includes(PATTERN_PROMPT_PLACEHOLDER)
        ? template.replace(PATTERN_PROMPT_PLACEHOLDER, input)
        : template + '\n\n[입력]\n' + input)
      : template;
    App.copyText(text, '입력 포함 복사됨 ✓');
  }

  return { render, refresh };
})();
