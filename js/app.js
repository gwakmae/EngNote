'use strict';

// 앱 진입점 — 탭 전환, 헤더, 동기화 배지, 토스트, 공용 출처 관리 모달, 최초 로딩
const App = (() => {
  const views = { words: WordView, patterns: PatternView, import: ImportView, settings: SettingsView };
  const SPLIT_VIEWS = new Set(['words', 'patterns']);  // 프롬프트 열 + 목록 열 구조
  let currentView = null;

  const $ = sel => document.querySelector(sel);

  function switchView(name) {
    if (!views[name]) return;
    currentView = name;

    document.querySelectorAll('.nav-button').forEach(b =>
      b.classList.toggle('active', b.dataset.view === name));

    const main = $('#main-view');
    main.innerHTML = '';
    const section = document.createElement('section');
    section.className = 'view active' + (SPLIT_VIEWS.has(name) ? ' split-view' : '');
    section.id = 'view-' + name;
    main.appendChild(section);

    views[name].render(section);
  }

  function setHeader(text) {
    $('#header-count').textContent = text;
  }

  function setSyncDirty() {
    const badge = $('#sync-badge');
    badge.className = 'sync-badge dirty';
    badge.textContent = '● 저장 안 됨';
  }
  function setSyncClean() {
    const badge = $('#sync-badge');
    badge.className = 'sync-badge ok';
    badge.textContent = '✓ 저장됨';
  }
  function setSyncError(msg) {
    const badge = $('#sync-badge');
    badge.className = 'sync-badge error';
    badge.textContent = msg || '오류';
  }

  function toast(msg, isError = false) {
    const box = document.createElement('div');
    box.className = 'toast' + (isError ? ' error' : '');
    box.textContent = msg;
    $('#toast-container').appendChild(box);
    setTimeout(() => box.remove(), 1800);
  }

  // ── 클립보드 복사 (fallback 포함) ──
  async function copyText(text, okMsg) {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMsg);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast(okMsg);
    }
  }

  // ── 공용 출처 관리 모달 (단어/패턴 탭이 함께 사용) ──
  // checkedIds: 이 뷰가 쓰는 필터용 Set, onChanged: 체크/이름/병합 변경 시 호출
  function openSourceModal({ checkedIds, onChanged }) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'source-modal';

    // 항목 수는 단어 + 패턴 합산
    function countBySource() {
      const countBy = new Map();
      for (const e of Data.state.entries)
        if (e.sourceId != null) countBy.set(e.sourceId, (countBy.get(e.sourceId) || 0) + 1);
      for (const p of Data.state.patterns)
        if (p.sourceId != null) countBy.set(p.sourceId, (countBy.get(p.sourceId) || 0) + 1);
      return countBy;
    }

    // ── 병합 모드 상태 ──
    let mergeMode = false;
    const mergeSelected = new Set();

    modal.innerHTML = `
      <div class="modal-card">
        <h2 style="color:var(--primary)">출처 관리</h2>
        <p id="src-guide" style="font-size:13px;color:#777;margin:0">
          체크한 출처의 항목만 모아봅니다. 아무것도 체크하지 않으면 전체가 보입니다.<br>
          이름 칸을 직접 고치면 바로 반영됩니다. (괄호 숫자는 단어+패턴 합계)
        </p>
        <input id="src-search" type="search" placeholder="출처 이름 검색">
        <div id="src-list" style="max-height:46dvh;overflow-y:auto"></div>
        <div class="card-buttons" style="justify-content:space-between;flex-wrap:wrap">
          <button id="src-merge-toggle" class="ghost">🔗 합치기 모드</button>
          <div style="display:flex;gap:8px">
            <button id="src-show-all">전체 보기 (모두 해제)</button>
            <button class="primary" id="src-close">닫기</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const guideEl = modal.querySelector('#src-guide');
    const toggleBtn = modal.querySelector('#src-merge-toggle');
    const showAllBtn = modal.querySelector('#src-show-all');

    function drawRows(filter = '') {
      const host = modal.querySelector('#src-list');
      host.innerHTML = '';
      const countBy = countBySource();
      const rows = [...Data.state.sources]
        .sort((a, b) => b.id - a.id)
        .filter(s => !filter || s.name.toLowerCase().includes(filter.toLowerCase()));

      for (const s of rows) {
        const row = document.createElement('div');
        row.className = 'source-row';

        const cb = document.createElement('input');
        cb.type = 'checkbox';

        if (mergeMode) {
          // ── 병합 모드: 병합 대상 선택용 ──
          cb.checked = mergeSelected.has(s.id);
          cb.addEventListener('change', () => {
            cb.checked ? mergeSelected.add(s.id) : mergeSelected.delete(s.id);
          });
        } else {
          // ── 필터 모드: 기존 동작 ──
          cb.checked = checkedIds.has(s.id);
          cb.addEventListener('change', () => {
            cb.checked ? checkedIds.add(s.id) : checkedIds.delete(s.id);
            onChanged && onChanged();
          });
        }

        const name = document.createElement('input');
        name.type = 'text';
        name.value = s.name;
        name.addEventListener('change', () => {
          const v = name.value.trim();
          if (v && v !== s.name) {
            s.name = v;
            Data.markDirty();
            setSyncDirty();
            toast('출처 이름 저장됨');
            onChanged && onChanged();
          }
        });

        const count = document.createElement('span');
        count.className = 'count';
        count.textContent = `(${countBy.get(s.id) || 0})`;

        row.append(cb, name, count);
        host.appendChild(row);
      }
      if (!rows.length)
        host.innerHTML = '<p style="color:#999;font-size:13px">출처가 없습니다.</p>';
    }

    // ── 합치기 모드 토글 / 실행 ──
    function setMergeMode(on) {
      mergeMode = on;
      mergeSelected.clear();
      if (on) {
        guideEl.innerHTML =
          '합칠 출처를 <strong>2개 이상</strong> 체크한 뒤 [합치기 실행]을 누르세요.<br>' +
          '선택된 출처의 단어·패턴이 하나로 모이고, 나머지 출처는 사라집니다.';
        toggleBtn.textContent = '✔ 합치기 실행';
        toggleBtn.className = 'accent';
        showAllBtn.style.display = 'none';
      } else {
        guideEl.innerHTML =
          '체크한 출처의 항목만 모아봅니다. 아무것도 체크하지 않으면 전체가 보입니다.<br>' +
          '이름 칸을 직접 고치면 바로 반영됩니다. (괄호 숫자는 단어+패턴 합계)';
        toggleBtn.textContent = '🔗 합치기 모드';
        toggleBtn.className = 'ghost';
        showAllBtn.style.display = '';
      }
      drawRows(modal.querySelector('#src-search').value.trim());
    }

    function doMerge() {
      if (mergeSelected.size < 2) {
        toast('합칠 출처를 2개 이상 선택해 주세요.', true);
        return;
      }

      // 대상 = 가장 먼저 만든 출처 (id가 가장 작은 것)
      const picked = [...mergeSelected].sort((a, b) => a - b);
      const targetId = picked[0];
      const target = Data.state.sources.find(s => s.id === targetId);
      const pickedNames = picked
        .map(id => Data.state.sources.find(s => s.id === id)?.name)
        .filter(Boolean);

      const newName = prompt(
        `다음 출처들을 하나로 합칩니다:\n\n  ${pickedNames.join('\n  ')}\n\n` +
        `합친 후의 출처 이름을 입력하세요.`,
        target ? target.name : ''
      );
      if (newName === null) return;          // 취소
      if (!newName.trim()) {
        toast('이름을 입력해 주세요.', true);
        return;
      }

      const moved = Merger.mergeSources(targetId, picked, newName);

      // 필터에 사라진 출처가 남아 있으면 정리
      for (const id of picked) {
        if (id !== targetId) checkedIds.delete(id);
      }

      setSyncDirty();
      setMergeMode(false);
      onChanged && onChanged();
      toast(`출처 병합 완료: 항목 ${moved}개 이동`);
    }

    toggleBtn.addEventListener('click', () => {
      if (mergeMode) doMerge();
      else setMergeMode(true);
    });

    modal.querySelector('#src-search').addEventListener('input', e => drawRows(e.target.value.trim()));
    showAllBtn.addEventListener('click', () => {
      checkedIds.clear();
      drawRows(modal.querySelector('#src-search').value.trim());
      onChanged && onChanged();
    });
    modal.querySelector('#src-close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

    drawRows();
  }

  async function boot() {
    document.querySelectorAll('.nav-button').forEach(b =>
      b.addEventListener('click', () => switchView(b.dataset.view)));

    // 브랜드(EngNote) 클릭 → 단어 탭으로
    document.querySelector('.brand').addEventListener('click', () => switchView('words'));

    // 저장 안 된 채 페이지를 떠나려 하면 경고
    window.addEventListener('beforeunload', e => {
      if (Data.isDirty()) { e.preventDefault(); e.returnValue = ''; }
    });

    switchView('words');

    try {
      await Data.load();
      WordView.refresh();
      setSyncClean();
    } catch (err) {
      // 첫 실행 등으로 파일이 없으면 빈 상태로 시작
      console.warn(err);
      WordView.refresh();
      setSyncError('데이터 없음');
      toast('data/engnote.json을 찾지 못해 빈 상태로 시작합니다.', true);
    }
  }

  document.addEventListener('DOMContentLoaded', boot);

  return { switchView, setHeader, setSyncDirty, setSyncClean, setSyncError, toast, copyText, openSourceModal };
})();
