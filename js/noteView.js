'use strict';

const NoteView = (() => {
  const PAGE_SIZE = 20;

  let typeFilter = 'all';
  let sortMode = 'recent';
  let searchText = '';
  let hideMeanings = false;
  let page = 1;
  let openKey = null;
  let rows = [];
  let sentenceIndex = new Map();
  let activeDialog = null;
  let questionInput = '';
  let questionMode = 'manual';
  let questionOpen = false;

  const checkedSourceIds = new Set();
  const $ = selector => document.querySelector(selector);

  function make(tag, className, text) {
    const element = document.createElement(tag);

    if (className) element.className = className;
    if (text != null) element.textContent = text;

    return element;
  }

  function sentenceKey(text) {
    return Parser.normalizeKey((text || '').replace(/@@/g, ''));
  }

  function getQuestionTemplate() {
    if (questionMode === 'marked') {
      return {
        text: WORD_PROMPT,
        placeholder: WORD_PROMPT_PLACEHOLDER
      };
    }

    if (questionMode === 'pattern') {
      return {
        text: PATTERN_PROMPT,
        placeholder: PATTERN_PROMPT_PLACEHOLDER
      };
    }

    return {
      text: MANUAL_PROMPT,
      placeholder: MANUAL_PROMPT_PLACEHOLDER
    };
  }

  function makeRow(type, item) {
    const title = type === 'pattern' ? item.pattern : item.en;
    const sentences = type === 'pattern'
      ? item.examples || []
      : item.contexts || [];

    const date = Date.parse(item.updatedUtc || item.createdUtc || '');

    return {
      key: type + ':' + item.id,
      type,
      item,
      title,
      sentences,
      timestamp: Number.isFinite(date) ? date : 0,
      label: type === 'pattern'
        ? '패턴'
        : /\s/.test(title.trim()) ? '표현' : '단어'
    };
  }

  function rebuildRows() {
    rows = [
      ...Data.state.entries.map(item => makeRow('word', item)),
      ...Data.state.patterns.map(item => makeRow('pattern', item))
    ];

    sentenceIndex = new Map();

    for (const row of rows) {
      const keys = new Set(row.sentences.map(sentenceKey).filter(Boolean));

      for (const key of keys) {
        if (!sentenceIndex.has(key)) sentenceIndex.set(key, []);
        sentenceIndex.get(key).push(row);
      }
    }
  }

  function getRelated(row) {
    const result = new Map();

    for (const sentence of row.sentences) {
      const key = sentenceKey(sentence);
      if (!key) continue;

      for (const related of sentenceIndex.get(key) || []) {
        if (related.key !== row.key) result.set(related.key, related);
      }
    }

    return [...result.values()].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'pattern' ? -1 : 1;
      return a.title.localeCompare(b.title, 'en');
    });
  }

  function resetPage() {
    page = 1;
    openKey = null;
    refresh();
    scrollToTop();
  }

  function scrollToTop() {
    const scroll = $('#note-list-scroll');
    if (scroll) scroll.scrollTop = 0;
  }

  function render(container) {
    container.classList.add('notebook-view');

    container.innerHTML = `
      <details class="note-question" id="note-question">
        <summary>＋ AI에 질문하기</summary>
        <div class="note-question-body">
          <p class="note-question-guide">
            질문을 복사해 AI에 붙여넣고, 답변은 [가져오기]에 등록하세요.
            표시 부분만 질문할 때는 한 단어 앞에 @@,
            여러 단어 앞뒤에 @@를 붙입니다.
          </p>
          <label class="field">
            질문 방식
            <select id="note-question-mode">
              <option value="manual">단어·표현·문장 직접 질문</option>
              <option value="marked">@@로 표시한 부분만 질문</option>
              <option value="pattern">문장 패턴 중심으로 질문</option>
            </select>
          </label>
          <textarea
            id="note-question-input"
            rows="3"
            aria-label="AI에 질문할 영어"
            placeholder="단어, 표현 또는 영어 문장을 입력하세요."
          ></textarea>
          <div class="note-question-actions">
            <button type="button" class="primary" id="note-copy-filled">
              📋 입력 포함 복사
            </button>
            <button type="button" class="ghost" id="note-copy-template">
              프롬프트만 복사
            </button>
          </div>
        </div>
      </details>

      <div class="note-toolbar">
        <input
          id="note-search"
          class="note-search"
          type="search"
          aria-label="학습 노트 검색"
          placeholder="영어·뜻·원문 검색"
        >
        <select id="note-type" aria-label="항목 종류">
          <option value="all">전체</option>
          <option value="word">단어·표현</option>
          <option value="pattern">패턴</option>
        </select>
        <select id="note-sort" aria-label="정렬 방식">
          <option value="recent">최근 등록·변경순</option>
          <option value="alpha">알파벳순</option>
          <option value="freq">문장 많은 순</option>
        </select>
        <button type="button" class="ghost note-source" id="note-source">
          출처: 전체 보기 ▾
        </button>
        <button
          type="button"
          class="ghost note-meaning-toggle"
          id="note-hide-meanings"
          aria-pressed="false"
        >뜻 가리기</button>
        <button type="button" class="primary" id="note-add">
          ＋ 수동 추가
        </button>
      </div>

      <div class="note-list-scroll" id="note-list-scroll">
        <div class="note-list" id="note-list"></div>
      </div>

      <nav class="note-pagination" aria-label="학습 노트 페이지">
        <button type="button" id="note-prev">이전</button>
        <span id="note-page-info" aria-live="polite"></span>
        <button type="button" id="note-next">다음</button>
      </nav>
    `;

    $('#note-question').open = questionOpen;
    $('#note-question-mode').value = questionMode;
    $('#note-question-input').value = questionInput;
    $('#note-search').value = searchText;
    $('#note-type').value = typeFilter;
    $('#note-sort').value = sortMode;

    $('#note-question').addEventListener('toggle', event => {
      questionOpen = event.currentTarget.open;
    });

    $('#note-question-mode').addEventListener('change', event => {
      questionMode = event.target.value;
    });

    $('#note-question-input').addEventListener('input', event => {
      questionInput = event.target.value;
    });

    $('#note-copy-filled').addEventListener('click', () => {
      const input = questionInput.trim();

      if (!input) {
        App.toast('질문할 내용을 먼저 입력해 주세요.', true);
        $('#note-question-input').focus();
        return;
      }

      const template = getQuestionTemplate();
      const text = template.text.replace(template.placeholder, () => input);
      App.copyText(text, '입력 포함 프롬프트 복사됨 ✓');
    });

    $('#note-copy-template').addEventListener('click', () => {
      App.copyText(getQuestionTemplate().text, '프롬프트 복사됨 ✓');
    });

    $('#note-search').addEventListener('input', event => {
      searchText = event.target.value;
      resetPage();
    });

    $('#note-type').addEventListener('change', event => {
      typeFilter = event.target.value;
      resetPage();
    });

    $('#note-sort').addEventListener('change', event => {
      sortMode = event.target.value;
      resetPage();
    });

    $('#note-source').addEventListener('click', () => {
      App.openSourceModal({
        checkedIds: checkedSourceIds,
        onChanged: resetPage
      });
    });

    $('#note-hide-meanings').addEventListener('click', () => {
      hideMeanings = !hideMeanings;
      openKey = null;
      refresh();
    });

    $('#note-add').addEventListener('click', openManualDialog);

    $('#note-prev').addEventListener('click', () => {
      if (page <= 1) return;

      page--;
      openKey = null;
      refresh();
      scrollToTop();
    });

    $('#note-next').addEventListener('click', () => {
      page++;
      openKey = null;
      refresh();
      scrollToTop();
    });

    refresh();
  }

  function refresh() {
    const host = $('#note-list');
    if (!host) return;

    const validSourceIds = new Set(Data.state.sources.map(source => source.id));

    for (const id of checkedSourceIds) {
      if (!validSourceIds.has(id)) checkedSourceIds.delete(id);
    }

    rebuildRows();

    const query = searchText.trim().toLowerCase();

    let filtered = rows.filter(row => {
      if (typeFilter !== 'all' && row.type !== typeFilter) return false;

      if (
        checkedSourceIds.size &&
        !Data.getSourceIds(row.item).some(id => checkedSourceIds.has(id))
      ) {
        return false;
      }

      if (!query) return true;

      return row.title.toLowerCase().includes(query) ||
        (row.item.ko || '').toLowerCase().includes(query) ||
        row.sentences.some(sentence => sentence.toLowerCase().includes(query));
    });

    filtered = [...filtered].sort((a, b) => {
      if (sortMode === 'alpha') {
        return a.title.localeCompare(b.title, 'en') ||
          a.key.localeCompare(b.key);
      }

      if (sortMode === 'freq') {
        return b.sentences.length - a.sentences.length ||
          a.title.localeCompare(b.title, 'en');
      }

      return b.timestamp - a.timestamp ||
        b.item.id - a.item.id ||
        a.key.localeCompare(b.key);
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    page = Math.min(Math.max(1, page), totalPages);

    const start = (page - 1) * PAGE_SIZE;
    const visibleRows = filtered.slice(start, start + PAGE_SIZE);

    if (!visibleRows.some(row => row.key === openKey)) {
      openKey = null;
    }

    host.replaceChildren();

    if (!visibleRows.length) {
      host.appendChild(make(
        'div',
        'note-empty',
        rows.length
          ? '조건에 맞는 항목이 없습니다. 검색어나 출처 필터를 확인해 주세요.'
          : '아직 등록된 항목이 없습니다. AI 답변을 가져오거나 수동으로 추가해 보세요.'
      ));
    } else {
      const fragment = document.createDocumentFragment();

      for (const row of visibleRows) {
        fragment.appendChild(buildCard(row));
      }

      host.appendChild(fragment);
    }

    const wordCount = Data.state.entries.length;
    const patternCount = Data.state.patterns.length;

    App.setHeader(
      `단어·표현 ${wordCount.toLocaleString()}개 · ` +
      `패턴 ${patternCount.toLocaleString()}개 · ` +
      `${filtered.length.toLocaleString()}개 표시`
    );

    $('#note-page-info').textContent = filtered.length
      ? `${page} / ${totalPages} · ${start + 1}–${start + visibleRows.length} / ${filtered.length}`
      : '0개';

    $('#note-prev').disabled = page <= 1;
    $('#note-next').disabled = page >= totalPages;

    const meaningButton = $('#note-hide-meanings');
    meaningButton.textContent = hideMeanings ? '뜻 표시하기' : '뜻 가리기';
    meaningButton.setAttribute('aria-pressed', String(hideMeanings));

    updateSourceButton();
  }

  function updateSourceButton() {
    const button = $('#note-source');
    if (!button) return;

    const names = Data.state.sources
      .filter(source => checkedSourceIds.has(source.id))
      .map(source => source.name);

    const label = !names.length
      ? '전체 보기'
      : names.length === 1 ? names[0] : `${names.length}개 선택됨`;

    button.textContent = '출처: ' + label + ' ▾';
    button.title = names.length ? names.join(', ') : '전체 출처';
  }

  function buildCard(row) {
    const opened = openKey === row.key;
    const card = make('article', 'note-card' + (opened ? ' is-open' : ''));
    const button = make('button', 'note-summary');

    button.type = 'button';
    button.dataset.noteKey = row.key;
    button.setAttribute('aria-expanded', String(opened));

    const detailId = 'note-detail-' + row.type + '-' + row.item.id;
    button.setAttribute('aria-controls', detailId);

    const kind = make(
      'span',
      'note-kind' + (row.type === 'pattern' ? ' pattern' : ''),
      row.label
    );

    const title = make('span', 'note-title', row.title);
    const meaning = make(
      'span',
      'note-meaning' + (hideMeanings ? ' is-hidden' : ''),
      hideMeanings ? '펼쳐서 뜻 보기' : row.item.ko || '뜻 미등록'
    );

    const arrow = make('span', 'note-arrow', opened ? '▲' : '▼');
    arrow.setAttribute('aria-hidden', 'true');

    button.append(kind, title, meaning, arrow);

    button.addEventListener('click', () => {
      openKey = openKey === row.key ? null : row.key;
      refresh();

      const replacement = [...document.querySelectorAll('.note-summary')]
        .find(element => element.dataset.noteKey === row.key);

      if (replacement) replacement.focus({ preventScroll: true });
    });

    const body = make('div');
    body.id = detailId;
    body.hidden = !opened;

    if (opened) body.appendChild(buildDetail(row, true));

    card.append(button, body);
    return card;
  }

  function buildDetail(row, includeRelated) {
    const detail = make('div', 'note-detail');

    detail.appendChild(make(
      'div',
      'note-detail-meaning',
      row.item.ko || '등록된 뜻이 없습니다.'
    ));

    if (row.type === 'word') {
      const pronunciations = [];

      if (row.item.pronUs) {
        pronunciations.push('미국: ' + row.item.pronUs);
      }

      if (row.item.pronUk && row.item.pronUk !== row.item.pronUs) {
        pronunciations.push('영국: ' + row.item.pronUk);
      }

      if (pronunciations.length) {
        detail.appendChild(make(
          'div',
          'note-detail-pron',
          pronunciations.join(' / ')
        ));
      }
    }

    const sourceNames = Data.getSourceIds(row.item).map(id => {
      const source = Data.state.sources.find(candidate => candidate.id === id);
      return source ? source.name : '미확인 출처 #' + id;
    });

    detail.appendChild(make(
      'div',
      'note-detail-source',
      '출처: ' + (sourceNames.length ? sourceNames.join(' · ') : '수동 / 미지정')
    ));

    const contextDetails = make('details');
    contextDetails.open = true;

    const contextSummary = make(
      'summary',
      'note-section-title',
      `${row.type === 'pattern' ? '예문' : '원문'} (${row.sentences.length})`
    );

    contextDetails.appendChild(contextSummary);

    if (row.sentences.length) {
      const list = make('ul', 'note-contexts');

      for (const sentence of row.sentences) {
        list.appendChild(make('li', '', sentence));
      }

      contextDetails.appendChild(list);
    } else {
      contextDetails.appendChild(make(
        'p',
        'note-help',
        '등록된 문장이 없습니다.'
      ));
    }

    detail.appendChild(contextDetails);

    if (includeRelated) {
      const related = getRelated(row);

      if (related.length) {
        const relatedBox = make('div', 'note-related');

        relatedBox.appendChild(make(
          'div',
          'note-section-title',
          `같은 문장을 공유하는 항목 (${related.length})`
        ));

        for (const relatedRow of related.slice(0, 5)) {
          relatedBox.appendChild(buildRelatedButton(relatedRow));
        }

        if (related.length > 5) {
          const more = make(
            'button',
            'ghost',
            `관련 항목 ${related.length}개 모두 보기`
          );

          more.type = 'button';
          more.addEventListener('click', () => openRelatedList(row));
          relatedBox.appendChild(more);
        }

        detail.appendChild(relatedBox);
      }
    }

    const actions = make('div', 'note-detail-actions');
    const deleteButton = make('button', 'danger', '삭제');

    deleteButton.type = 'button';
    deleteButton.addEventListener('click', () => deleteRow(row));

    actions.appendChild(deleteButton);
    detail.appendChild(actions);

    return detail;
  }

  function buildRelatedButton(row) {
    const button = make(
      'button',
      'note-related-button',
      `[${row.label}] ${row.title}` +
      (!hideMeanings && row.item.ko ? ' — ' + row.item.ko : '')
    );

    button.type = 'button';
    button.addEventListener('click', () => openRelatedDetail(row));

    return button;
  }

  function openDialog(title) {
    let returnFocus = document.activeElement;

    if (activeDialog) {
      returnFocus = activeDialog.returnFocus;
      closeDialogs(false);
    }

    const overlay = make('div', 'modal');
    const card = make('div', 'modal-card');

    card.tabIndex = -1;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'note-dialog-title');

    const heading = make('h2', 'note-dialog-title', title);
    heading.id = 'note-dialog-title';

    const content = make('div');
    const actions = make('div', 'card-buttons');
    const closeButton = make('button', 'primary', '닫기');

    closeButton.type = 'button';
    closeButton.addEventListener('click', () => closeDialogs());

    actions.appendChild(closeButton);
    card.append(heading, content, actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    function onKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialogs();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = [...card.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), ' +
        'select:not([disabled]), textarea:not([disabled]), summary, [tabindex="0"]'
      )].filter(element => element.getClientRects().length > 0);

      if (!focusable.length) {
        event.preventDefault();
        card.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;

      if (event.shiftKey && (current === first || current === card)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || current === card)) {
        event.preventDefault();
        first.focus();
      }
    }

    overlay.addEventListener('keydown', onKeydown);
    overlay.addEventListener('click', event => {
      if (event.target === overlay) closeDialogs();
    });

    activeDialog = { overlay, returnFocus };
    card.focus();

    return { content, card };
  }

  function closeDialogs(restoreFocus = true) {
    if (!activeDialog) return;

    const previous = activeDialog;
    activeDialog = null;
    previous.overlay.remove();

    if (
      restoreFocus &&
      previous.returnFocus &&
      previous.returnFocus.isConnected
    ) {
      previous.returnFocus.focus({ preventScroll: true });
    }
  }

  function openRelatedDetail(row) {
    const dialog = openDialog(row.title);
    dialog.content.appendChild(buildDetail(row, false));
  }

  function openRelatedList(row) {
    const dialog = openDialog('같은 문장을 공유하는 항목');
    const list = make('div', 'note-related');

    for (const related of getRelated(row)) {
      list.appendChild(buildRelatedButton(related));
    }

    dialog.content.appendChild(list);
  }

  function deleteRow(row) {
    const approved = confirm(
      `'${row.title}' 항목을 삭제할까요?\n` +
      '연결된 모든 출처에서 이 항목이 제거됩니다.'
    );

    if (!approved) return;

    const collection = row.type === 'pattern'
      ? Data.state.patterns
      : Data.state.entries;

    const index = collection.findIndex(item => item.id === row.item.id);
    if (index < 0) return;

    collection.splice(index, 1);
    Data.markDirty();

    openKey = null;
    closeDialogs();
    App.setSyncDirty();
    refresh();
    App.toast('삭제됨 · GitHub 미저장');
  }

  function openManualDialog() {
    const dialog = openDialog('학습 항목 수동 추가');
    const form = make('form');

    const sourceOptions = [...Data.state.sources]
      .sort((a, b) => b.id - a.id)
      .map(source =>
        `<option value="${source.id}">${Util.escapeHtml(source.name)}</option>`
      )
      .join('');

    form.innerHTML = `
      <label class="field">
        종류
        <select name="kind">
          <option value="word">단어·표현</option>
          <option value="pattern">문장 패턴</option>
        </select>
      </label>

      <label class="field">
        영어 *
        <input
          name="english"
          required
          autocomplete="off"
          placeholder="예: take into account / It is no use ~ing"
        >
      </label>

      <label class="field">
        한국어 뜻 / 설명
        <textarea name="meaning" rows="2"></textarea>
      </label>

      <div data-pron-fields>
        <label class="field">
          미국 발음
          <input name="pronUs" autocomplete="off">
        </label>
        <label class="field">
          영국 발음
          <input name="pronUk" autocomplete="off">
        </label>
      </div>

      <label class="field">
        원문 / 예문 — 여러 개면 한 줄에 하나씩
        <textarea name="sentences" rows="3"></textarea>
      </label>

      <label class="field">
        출처
        <select name="source">
          <option value="">수동 / 미지정</option>
          ${sourceOptions}
        </select>
      </label>

      <p class="note-help">
        등록 내용은 브라우저에 임시 저장됩니다.
        다른 기기에서도 보려면 설정에서 GitHub에 저장하세요.
      </p>

      <div class="card-buttons">
        <button type="submit" class="accent">등록</button>
      </div>
    `;

    const fields = form.elements;

    fields.namedItem('kind').addEventListener('change', () => {
      form.querySelector('[data-pron-fields]').hidden =
        fields.namedItem('kind').value === 'pattern';
    });

    form.addEventListener('submit', event => {
      event.preventDefault();

      try {
        const kind = fields.namedItem('kind').value;
        const english = fields.namedItem('english').value.trim();
        const ko = fields.namedItem('meaning').value.trim();

        if (!english) {
          App.toast('영어를 입력해 주세요.', true);
          fields.namedItem('english').focus();
          return;
        }

        const sentences = fields.namedItem('sentences').value
          .split(/\r?\n/)
          .map(value => value.trim())
          .filter(Boolean);

        const sourceId = Number(fields.namedItem('source').value);
        const source = Data.state.sources.find(item => item.id === sourceId) || null;

        let result;

        if (kind === 'pattern') {
          result = Merger.importPatterns([{
            pattern: english,
            ko,
            examples: sentences
          }], source);
        } else {
          const pronUs = fields.namedItem('pronUs').value.trim();
          const rawPronUk = fields.namedItem('pronUk').value.trim();

          result = Merger.importWords([{
            en: english,
            ko,
            pronUs,
            pronUk: rawPronUk && rawPronUk !== pronUs ? rawPronUk : null,
            contexts: sentences
          }], source);
        }

        closeDialogs();

        typeFilter = 'all';
        searchText = '';
        checkedSourceIds.clear();
        sortMode = 'recent';
        page = 1;
        openKey = null;

        $('#note-type').value = typeFilter;
        $('#note-search').value = '';
        $('#note-sort').value = sortMode;

        if (Data.isDirty()) App.setSyncDirty();
        else App.setSyncClean();

        refresh();
        scrollToTop();

        const message = result.added
          ? '새 항목 등록됨 · GitHub 미저장'
          : result.merged
            ? '기존 항목에 내용·출처 병합됨 · GitHub 미저장'
            : '이미 동일한 내용이 있습니다.';

        App.toast(message);
      } catch (error) {
        console.error(error);
        App.toast('등록 실패: ' + error.message, true);
      }
    });

    dialog.content.appendChild(form);
    fields.namedItem('english').focus();
  }

  return { render, refresh, closeDialogs };
})();
