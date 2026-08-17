'use strict';

// 설정 탭 — GitHub 저장 설정, 동기화, 백업/복원
const SettingsView = (() => {
  const $ = sel => document.querySelector(sel);

  function render(container) {
    const s = Data.loadSettings();

    container.innerHTML = `
      <div class="form-view">
        <h2>GitHub 저장 설정</h2>
        <p style="font-size:13px;color:#777;margin:0">
          데이터는 GitHub 저장소의 <code>data/engnote.json</code> 하나에 저장됩니다.
          읽기는 Public 저장소면 토큰 없이 되고, 저장(쓰기)에는 Contents 읽기/쓰기 권한의 토큰이 필요합니다.
          설정은 이 브라우저(localStorage)에만 보관됩니다.
        </p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <label class="field">Owner (사용자/조직)<input id="gh-owner" value="${Util.escapeHtml(s.owner)}" placeholder="예: gwakm"></label>
          <label class="field">Repo<input id="gh-repo" value="${Util.escapeHtml(s.repo)}" placeholder="예: engnote-web"></label>
          <label class="field">Branch<input id="gh-branch" value="${Util.escapeHtml(s.branch)}"></label>
          <label class="field">데이터 경로<input id="gh-path" value="${Util.escapeHtml(s.path)}"></label>
        </div>
        <label class="field">Token (contents 읽기/쓰기)<input id="gh-token" type="password" value="${Util.escapeHtml(s.token)}"></label>
        <div class="form-actions">
          <button id="btn-save-settings" class="primary">설정 저장</button>
          <button id="btn-reload" class="ghost">⬇ 다시 불러오기</button>
          <button id="btn-push" class="accent">⬆ GitHub에 지금 저장</button>
        </div>
        <div id="settings-result" class="result-box" style="display:none"></div>

        <h2>백업 / 복원</h2>
        <p style="font-size:13px;color:#777;margin:0">
          구조 변경 같은 큰 작업 전에는 JSON 백업을 받아두세요. 복원은 백업 파일을 선택하면 즉시 반영됩니다.
        </p>
        <div class="form-actions" style="justify-content:flex-start">
          <button id="btn-export" class="ghost">JSON 백업 다운로드</button>
          <label class="ghost" style="padding:10px 14px;border:1px solid var(--line);border-radius:6px;cursor:pointer">
            JSON 복원(파일 선택)<input id="import-json-file" type="file" accept="application/json" style="display:none">
          </label>
        </div>
      </div>
    `;

    $('#btn-save-settings').addEventListener('click', () => {
      Data.saveSettings({
        owner: $('#gh-owner').value.trim(),
        repo: $('#gh-repo').value.trim(),
        branch: $('#gh-branch').value.trim() || 'main',
        path: $('#gh-path').value.trim() || 'data/engnote.json',
        token: $('#gh-token').value.trim()
      });
      showResult('설정을 저장했습니다.');
    });

    $('#btn-reload').addEventListener('click', async () => {
      try {
        const info = await Data.load();
        WordView.refresh();
        PatternView.refresh();
        App.setSyncClean();
        showResult(`불러오기 완료 (${info.from === 'github' ? 'GitHub' : '정적 파일'}): 단어 ${Data.state.entries.length}개, 패턴 ${Data.state.patterns.length}개, 출처 ${Data.state.sources.length}개`);
      } catch (e) {
        showResult('불러오기 실패: ' + e.message, true);
      }
    });

    $('#btn-push').addEventListener('click', async () => {
      try {
        await Data.save();
        App.setSyncClean();
        showResult('GitHub에 저장했습니다. GitHub Pages라면 1~2분 뒤 배포에 반영됩니다.');
      } catch (e) {
        showResult('저장 실패: ' + e.message, true);
      }
    });

    $('#btn-export').addEventListener('click', () => Data.exportJson());

    $('#import-json-file').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      if (!confirm('현재 데이터를 이 백업 파일 내용으로 덮어씁니다. 계속할까요?')) { e.target.value = ''; return; }
      try {
        await Data.importJson(file);
        App.setSyncDirty();
        WordView.refresh();
        PatternView.refresh();
        showResult(`복원 완료: 단어 ${Data.state.entries.length}개, 패턴 ${Data.state.patterns.length}개. GitHub에 저장하려면 위 [지금 저장]을 누르세요.`);
      } catch (err) {
        showResult('복원 실패: ' + err.message, true);
      }
      e.target.value = '';
    });
  }

  function showResult(msg, isError = false) {
    const box = $('#settings-result');
    box.style.display = 'block';
    box.style.borderColor = isError ? 'var(--danger)' : 'var(--line)';
    box.textContent = msg;
  }

  return { render };
})();
