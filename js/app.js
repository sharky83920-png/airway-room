// app.js — airway-room 主程式
// 路由：
//   #/        首頁
//   #/learn   教材
//   #/tech    技術複習（個人）
//   #/solo    單機自測
//   #/host/XXXX     互考考官
//   #/play/XXXX     互考學員
//   #/techhost/XXXX 技術帶練教官
//   #/techplay/XXXX 技術帶練學員

// ===== 全域狀態 =====
const S = {
  selfName: '',
  roomCode: null,
  room: null,             // 同步房間實例
  // host (quiz)
  hostQueue: [],
  hostCurrentIdx: -1,
  hostRevealed: false,
  // play (quiz)
  playState: null,
  playAnswered: false,
  playChoice: null,
  playLastQid: null,
  // solo
  soloQueue: [],
  soloIdx: 0,
  soloRevealed: false,
  soloCorrect: 0,
  soloChoice: null,
  // tech personal
  techCurrent: null,
  techStepIdx: 0,
  // techhost
  techhostTechId: null,
  techhostStepIdx: 0,
  // edit modal
  editCtx: null,          // { kind, target, isNew }
};

let _latestAnswers = {};

// ===== 啟動 =====
async function bootstrap() {
  try {
    await Content.loadAll();
  } catch (e) {
    alert('內容載入失敗：' + e.message);
    return;
  }
  Content.onUpdate(onContentUpdated);
  updateSyncIndicator();
  window.addEventListener('hashchange', route);
  route();
}

function onContentUpdated() {
  // 內容變更：刷新當前畫面（若是受影響的 view）
  const head = (location.hash || '#/').replace(/^#\//, '').split('/')[0];
  if (head === 'learn') renderLearn();
  if (head === 'tech') renderTechHome();
  if (head === 'solo') soloRender();
  if (head === 'techhost' && S.techhostTechId) renderTechhostStep();
  if (head === 'host' && S.hostCurrentIdx >= 0) renderHostQuestionArea();
}

function updateSyncIndicator() {
  const el = document.getElementById('sync-indicator');
  if (!el) return;
  setTimeout(() => {
    const mode = AirwaySync.getSyncMode();
    if (mode === 'cloud') {
      el.textContent = '☁️ 雲端同步可用';
      el.className = 'sync-badge cloud';
    } else {
      el.textContent = '⚠️ 雲端不可用（僅本機）';
      el.className = 'sync-badge local';
    }
  }, 400);
}

// ===== 路由 =====
function route() {
  const hash = location.hash || '#/';
  const parts = hash.replace(/^#\//, '').split('/');
  const head = parts[0] || '';
  const arg = parts[1] ? parts[1].toUpperCase() : '';

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

  // 離開房間就清理連線
  if (S.room && !['host','play','techhost','techplay'].includes(head)) {
    try { S.room.destroy(); } catch {}
    S.room = null;
    S.roomCode = null;
  }

  if (head === '' || head === '/') show('view-home');
  else if (head === 'learn') { show('view-learn'); renderLearn(); }
  else if (head === 'tech') { show('view-tech'); renderTechHome(); }
  else if (head === 'solo') { show('view-solo'); soloStart(); }
  else if (head === 'host' && !arg) show('dialog-host');
  else if (head === 'join' && !arg) show('dialog-join');
  else if (head === 'host' && arg) { show('view-host'); startHost(arg); }
  else if (head === 'play' && arg) { show('view-play'); startPlay(arg); }
  else if (head === 'techhost' && arg) { show('view-techhost'); startTechHost(arg); }
  else if (head === 'techplay' && arg) { show('view-techplay'); startTechPlay(arg); }
  else show('view-home');
}

function show(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

// ===== 首頁按鈕 =====
let _hostKind = 'quiz';
function openHostSetup(kind) {
  _hostKind = kind || 'quiz';
  const title = kind === 'tech' ? '🏫 開技術帶練房間' : '🎤 開互考房間';
  document.getElementById('dialog-host-title').textContent = title;
  location.hash = '#/host';
}
function openJoinSetup() { location.hash = '#/join'; }

function confirmHost() {
  const name = (document.getElementById('host-name-input').value || '教官').trim();
  S.selfName = name;
  const code = AirwaySync.generateRoomCode();
  location.hash = _hostKind === 'tech' ? `#/techhost/${code}` : `#/host/${code}`;
}

function confirmJoin() {
  const codeRaw = (document.getElementById('join-code-input').value || '').trim().toUpperCase();
  const name = (document.getElementById('join-name-input').value || '').trim();
  if (!/^[A-Z2-9]{4}$/.test(codeRaw)) { toast('房號需 4 碼英數'); return; }
  if (!name) { toast('請輸入你的稱呼'); return; }
  S.selfName = name;
  // 嘗試先判斷該房號是哪種房間：先查 airwayTechRooms，再查 airwayRooms
  detectRoomKindAndGo(codeRaw);
}

async function detectRoomKindAndGo(code) {
  if (typeof firebase === 'undefined' || !firebase.apps.length) {
    location.hash = `#/play/${code}`;
    return;
  }
  try {
    const techSnap = await firebase.database().ref(`airwayTechRooms/${code}/state`).once('value');
    if (techSnap.exists()) { location.hash = `#/techplay/${code}`; return; }
  } catch {}
  location.hash = `#/play/${code}`;
}

// ===== 教材（learn）=====
let _activeCatIdx = 0;
function renderLearn() {
  const tabsEl = document.getElementById('learn-tabs');
  const contentEl = document.getElementById('learn-content');
  const C = Content.get();
  if (!tabsEl || !contentEl || !C.lessons) return;

  const cats = C.lessons.categories || [];
  if (_activeCatIdx >= cats.length) _activeCatIdx = 0;

  tabsEl.innerHTML = cats.map((c, i) =>
    `<div class="cat-tab ${i === _activeCatIdx ? 'active' : ''}" onclick="switchLearnTab(${i})">
       ${escapeHtml(c.icon || '')} ${escapeHtml(c.title)}
       <button class="btn ghost small" onclick="event.stopPropagation();editLessonCategory('${escapeAttr(c.id)}')">✏️</button>
     </div>`
  ).join('');

  renderLearnCategory(_activeCatIdx);
}

function switchLearnTab(idx) {
  _activeCatIdx = idx;
  renderLearn();
}

function renderLearnCategory(idx) {
  const C = Content.get();
  const cat = C.lessons.categories[idx];
  const contentEl = document.getElementById('learn-content');
  if (!cat) { contentEl.innerHTML = ''; return; }
  contentEl.innerHTML = (cat.items || []).map(it => {
    let html = `<div class="lesson-item">
      <div class="item-edit-btns">
        <button class="btn ghost small" onclick="editLessonItem('${escapeAttr(it.id)}')">✏️</button>
      </div>
      <h3>${escapeHtml(it.name)}</h3>`;
    if (it.indication) html += `<div class="row"><span class="label">適應症</span> ${escapeHtml(it.indication)}</div>`;
    if (it.contraindication) html += `<div class="row"><span class="label">禁忌</span> <span class="contra">${escapeHtml(it.contraindication)}</span></div>`;
    if (it.sizing) html += `<div class="row"><span class="label">尺寸</span> ${escapeHtml(it.sizing)}</div>`;
    if (it.flow) html += `<div class="row"><span class="label">流速</span> ${escapeHtml(it.flow)}</div>`;
    if (it.fio2) html += `<div class="row"><span class="label">FiO₂</span> ${escapeHtml(it.fio2)}</div>`;
    if (it.steps && it.steps.length) {
      html += `<div class="row"><span class="label">步驟</span><ol>${it.steps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol></div>`;
    }
    if (it.pearls && it.pearls.length) {
      html += `<div class="row"><span class="label pearl">重點</span><ul>${it.pearls.map(s => `<li class="pearl">${escapeHtml(s)}</li>`).join('')}</ul></div>`;
    }
    html += `</div>`;
    return html;
  }).join('') || '<p class="text-dim">本分類尚無項目</p>';
}

// ===== 技術複習（個人）=====
function renderTechHome() {
  const picker = document.getElementById('tech-picker');
  const viewer = document.getElementById('tech-viewer');
  if (S.techCurrent) {
    picker.classList.add('hidden');
    viewer.classList.remove('hidden');
    renderTechViewer();
    return;
  }
  picker.classList.remove('hidden');
  viewer.classList.add('hidden');
  const list = document.getElementById('tech-list');
  const C = Content.get();
  const techs = (C.techniques && C.techniques.techniques) || [];
  list.innerHTML = techs.map(t =>
    `<div class="tech-card" onclick="openTech('${escapeAttr(t.id)}')">
       <div class="item-edit-btns">
         <button class="btn ghost small" onclick="event.stopPropagation();editTechnique('${escapeAttr(t.id)}')">✏️</button>
       </div>
       <div class="tech-name">${escapeHtml(t.name)}</div>
       <div class="tech-summary">${escapeHtml(t.summary || '')}</div>
       <div class="tech-step-count">${(t.steps || []).length} 步</div>
     </div>`
  ).join('') || '<p class="text-dim">尚未建立技術，按「+ 新增技術」開始</p>';
}

function openTech(id) {
  const C = Content.get();
  const t = (C.techniques.techniques || []).find(x => x.id === id);
  if (!t) return;
  S.techCurrent = t;
  S.techStepIdx = 0;
  renderTechHome();
}

function renderTechViewer() {
  const t = S.techCurrent;
  if (!t) return;
  const steps = t.steps || [];
  if (S.techStepIdx >= steps.length) S.techStepIdx = steps.length - 1;
  if (S.techStepIdx < 0) S.techStepIdx = 0;
  const step = steps[S.techStepIdx] || { title: '無步驟', narration: '請編輯技術加入步驟' };

  const viewer = document.getElementById('tech-viewer');
  viewer.innerHTML = `
    <div class="flex-row mb-1">
      <button class="btn ghost" onclick="backToTechList()">← 返回技術清單</button>
      <span class="spacer"></span>
      <span class="text-dim text-small">${escapeHtml(t.name)}・第 ${S.techStepIdx + 1} / ${steps.length} 步</span>
    </div>
    <div class="step-viewer">
      <div class="step-img-wrap">
        ${step.imageUrl ? `<img src="${escapeAttr(step.imageUrl)}" alt="" />` : '<span>（無圖）</span>'}
      </div>
      <div class="step-title">${escapeHtml(step.title || '')}</div>
      ${step.caption ? `<div class="step-caption">${escapeHtml(step.caption)}</div>` : ''}
      <div class="step-narration">${escapeHtml(step.narration || '')}</div>
    </div>
    <div class="step-pip">
      ${steps.map((_, i) => `<span class="pip ${i === S.techStepIdx ? 'active' : ''}" onclick="techGotoStep(${i})"></span>`).join('')}
    </div>
    <div class="step-nav">
      <button class="btn" onclick="techPrev()" ${S.techStepIdx === 0 ? 'disabled' : ''}>← 上一步</button>
      <button class="btn ghost" onclick="editTechnique('${escapeAttr(t.id)}')">✏️ 編輯技術</button>
      <button class="btn primary" onclick="techNext()" ${S.techStepIdx === steps.length - 1 ? 'disabled' : ''}>下一步 →</button>
    </div>
  `;
}

function backToTechList() { S.techCurrent = null; renderTechHome(); }
function techPrev() { S.techStepIdx--; renderTechViewer(); }
function techNext() { S.techStepIdx++; renderTechViewer(); }
function techGotoStep(i) { S.techStepIdx = i; renderTechViewer(); }

// ===== 單機自測（solo）=====
function soloStart() {
  const C = Content.get();
  const qs = (C.questions && C.questions.questions) || [];
  S.soloQueue = shuffle([...qs]);
  S.soloIdx = 0;
  S.soloCorrect = 0;
  S.soloRevealed = false;
  S.soloChoice = null;
  soloRender();
}

function soloRender() {
  const q = S.soloQueue[S.soloIdx];
  const total = S.soloQueue.length;
  if (!q) {
    document.getElementById('solo-card').innerHTML = '<p class="text-dim">題庫為空，請按「+ 新增題目」</p>';
    document.getElementById('solo-progress').textContent = '';
    return;
  }
  document.getElementById('solo-progress').textContent = `第 ${S.soloIdx + 1} / ${total} 題`;
  document.getElementById('solo-score').textContent = `已答 ${S.soloIdx} 題・全對 ${S.soloCorrect} 題`;
  const cardEl = document.getElementById('solo-card');
  cardEl.innerHTML = renderQuestion(q, {
    revealed: S.soloRevealed,
    selectedSet: S.soloChoice ? new Set(S.soloChoice) : new Set(),
    onClick: 'soloToggle',
    multi: true
  });
  document.getElementById('solo-reveal').disabled = !S.soloChoice || S.soloChoice.length === 0 || S.soloRevealed;
}

function soloToggle(optId) {
  if (S.soloRevealed) return;
  const set = new Set(S.soloChoice || []);
  if (set.has(optId)) set.delete(optId); else set.add(optId);
  S.soloChoice = Array.from(set);
  soloRender();
}

function soloReveal() {
  if (S.soloRevealed) return;
  S.soloRevealed = true;
  const q = S.soloQueue[S.soloIdx];
  const isCustom = !!(q.choices && q.choices.length);
  const correctSet = new Set(isCustom ? (q.correct || []) : (q.primary || []));
  const avoidSet = new Set(isCustom ? [] : (q.avoid || []));
  const selected = new Set(S.soloChoice || []);
  let allCorrect = true;
  for (const c of correctSet) if (!selected.has(c)) allCorrect = false;
  for (const a of avoidSet) if (selected.has(a)) allCorrect = false;
  if (allCorrect && selected.size > 0) S.soloCorrect++;
  soloRender();
}

function soloNext() {
  if (S.soloIdx >= S.soloQueue.length - 1) {
    toast(`完成！全對 ${S.soloCorrect} / ${S.soloQueue.length} 題`);
    soloStart();
    return;
  }
  S.soloIdx++;
  S.soloRevealed = false;
  S.soloChoice = null;
  soloRender();
}

function editCurrentSoloQuestion() {
  const q = S.soloQueue[S.soloIdx];
  if (q) editQuestion(q.id);
}

// ===== 互考考官（host）=====
function startHost(code) {
  S.roomCode = code;
  document.getElementById('host-room-code').textContent = code;
  document.getElementById('host-join-url').textContent = buildJoinUrl(code);
  const C = Content.get();
  S.hostQueue = shuffle([...(C.questions.questions || [])]);
  S.hostCurrentIdx = -1;
  S.hostRevealed = false;
  S.room = AirwaySync.createRoom(code, 'host', 'airwayRooms');
  S.room.onStudents(renderHostStudents);
  S.room.onAnswers(renderHostAnswers);
  S.room.broadcast({ kind: 'lobby' });
  renderHostQuestionArea();
}

function buildJoinUrl(code) {
  const base = location.origin + location.pathname.replace(/index\.html$/, '');
  return `${base}#/play/${code}`;
}
function buildTechJoinUrl(code) {
  const base = location.origin + location.pathname.replace(/index\.html$/, '');
  return `${base}#/techplay/${code}`;
}

function copyJoinUrl(kind) {
  const url = kind === 'tech' ? buildTechJoinUrl(S.roomCode) : buildJoinUrl(S.roomCode);
  navigator.clipboard.writeText(url).then(() => toast('已複製學員加入網址'),
    () => toast('複製失敗：' + url));
}

function toggleQR(wrapId, targetId) {
  const wrap = document.getElementById(wrapId);
  const target = document.getElementById(targetId);
  if (wrap.classList.contains('hidden')) {
    wrap.classList.remove('hidden');
    target.innerHTML = '';
    const url = targetId.startsWith('techhost') ? buildTechJoinUrl(S.roomCode) : buildJoinUrl(S.roomCode);
    if (window.QRCode) {
      new QRCode(target, { text: url, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
    } else {
      target.textContent = url;
      toast('QR 套件未載入，顯示純文字網址');
    }
  } else wrap.classList.add('hidden');
}

function renderHostStudents(students) {
  const list = Object.entries(students || {});
  document.getElementById('student-count').textContent = `(${list.length})`;
  const listEl = document.getElementById('host-students-list');
  listEl.innerHTML = list.length
    ? list.map(([id, s]) => `<span class="student-chip" data-id="${id}">${escapeHtml(s.name)}</span>`).join('')
    : '<span class="text-dim text-small">等待學員加入…</span>';
  updateHostAnsweredChips();
}

function renderHostAnswers(answers) {
  _latestAnswers = answers || {};
  updateHostAnsweredChips();
  if (S.hostCurrentIdx < 0) return;
  const q = S.hostQueue[S.hostCurrentIdx];
  const counts = {};
  Object.values(_latestAnswers).forEach(a => {
    (a.choice || []).forEach(c => { counts[c] = (counts[c] || 0) + 1; });
  });
  const C = Content.get();
  const countsEl = document.getElementById('host-answer-counts');
  if (!countsEl) return;
  const isCustom = !!(q.choices && q.choices.length);
  const options = isCustom ? q.choices : (C.questions.options || []);
  const correctIds = isCustom ? (q.correct || []) : (q.primary || []);
  const avoidIds = isCustom ? [] : (q.avoid || []);
  countsEl.innerHTML = options.map(opt => {
    const isCorrect = correctIds.includes(opt.id);
    const isAvoid = avoidIds.includes(opt.id);
    const tag = isCorrect ? ' ✅' : isAvoid ? ' ❌' : '';
    const cnt = counts[opt.id] || 0;
    if (cnt === 0 && !isCorrect && !isAvoid) return '';
    const prefix = isCustom ? `${opt.id.toUpperCase()}. ` : '';
    return `<div class="count-row"><span>${prefix}${escapeHtml(opt.label)}${tag}</span><strong>${cnt}</strong></div>`;
  }).filter(Boolean).join('');
}

function updateHostAnsweredChips() {
  const answeredIds = new Set(Object.keys(_latestAnswers || {}));
  document.querySelectorAll('#host-students-list .student-chip').forEach(chip => {
    chip.classList.toggle('answered', answeredIds.has(chip.dataset.id));
  });
  const total = document.querySelectorAll('#host-students-list .student-chip').length;
  document.getElementById('answered-count').textContent =
    S.hostCurrentIdx >= 0 ? `${answeredIds.size} / ${total} 已作答` : '';
}

function renderHostQuestionArea() {
  const area = document.getElementById('host-question-area');
  if (S.hostCurrentIdx < 0) {
    area.innerHTML = `<div class="card text-center text-dim"><p>等所有學員加入後，按下方「出下一題」開始</p></div>`;
    document.getElementById('host-reveal-btn').disabled = true;
    return;
  }
  const q = S.hostQueue[S.hostCurrentIdx];
  let html = `<div class="card">`;
  html += `<div class="scenario-box"><span class="qid">${q.id}</span>${escapeHtml(q.scenario)}</div>`;
  html += `<h3>標準答案（只有考官看到）</h3>`;
  html += renderQuestion(q, { revealed: true, selectedSet: new Set(), multi: true, disabled: true });
  if (q.explain) html += `<div class="explain-box"><strong>解釋：</strong>${escapeHtml(q.explain)}</div>`;
  html += `<h3 class="mt-2">📊 學員作答即時統計</h3><div id="host-answer-counts" class="answer-counts"></div>`;
  html += `</div>`;
  area.innerHTML = html;
  renderHostAnswers(_latestAnswers);
  document.getElementById('host-reveal-btn').disabled = S.hostRevealed;
}

async function hostNextQuestion() {
  if (!S.room) return;
  S.hostCurrentIdx++;
  if (S.hostCurrentIdx >= S.hostQueue.length) {
    toast('題庫已出完，重新洗牌');
    const C = Content.get();
    S.hostQueue = shuffle([...(C.questions.questions || [])]);
    S.hostCurrentIdx = 0;
  }
  S.hostRevealed = false;
  _latestAnswers = {};
  await S.room.clearAnswers();
  const q = S.hostQueue[S.hostCurrentIdx];
  const C = Content.get();
  const isCustom = !!(q.choices && q.choices.length);
  await S.room.broadcast({
    kind: 'question',
    qid: q.id,
    scenario: q.scenario,
    options: isCustom ? q.choices : C.questions.options,
    choices: q.choices || null,
    revealed: false
  });
  renderHostQuestionArea();
}

async function hostReveal() {
  if (!S.room || S.hostCurrentIdx < 0) return;
  S.hostRevealed = true;
  const q = S.hostQueue[S.hostCurrentIdx];
  const C = Content.get();
  const isCustom = !!(q.choices && q.choices.length);
  await S.room.broadcast({
    kind: 'question',
    qid: q.id,
    scenario: q.scenario,
    options: isCustom ? q.choices : C.questions.options,
    choices: q.choices || null,
    revealed: true,
    correct: q.correct || [],
    primary: q.primary || [],
    secondary: q.secondary || [],
    avoid: q.avoid || [],
    explain: q.explain || ''
  });
  renderHostQuestionArea();
}

async function hostBackToLobby() {
  if (!S.room) return;
  S.hostCurrentIdx = -1;
  S.hostRevealed = false;
  _latestAnswers = {};
  await S.room.clearAnswers();
  await S.room.broadcast({ kind: 'lobby' });
  renderHostQuestionArea();
}

// ===== 互考學員（play）=====
async function startPlay(code) {
  if (!S.selfName) {
    location.hash = '#/join';
    setTimeout(() => {
      const ci = document.getElementById('join-code-input');
      if (ci) ci.value = code;
    }, 50);
    return;
  }
  S.roomCode = code;
  document.getElementById('play-room-code').textContent = code;
  S.room = AirwaySync.createRoom(code, 'play', 'airwayRooms');
  try { await S.room.joinAsStudent(S.selfName); }
  catch (e) { toast('加入房間失敗：' + e.message); return; }
  S.room.onState(renderPlay);
  document.getElementById('play-area').innerHTML =
    `<div class="card text-center"><p>✅ 已加入房間 <strong>${escapeHtml(code)}</strong></p><p class="text-dim">你是 ${escapeHtml(S.selfName)}，等考官出題…</p></div>`;
}

function renderPlay(state) {
  S.playState = state;
  const area = document.getElementById('play-area');
  if (!state) return;
  if (state.kind === 'lobby') {
    S.playAnswered = false; S.playChoice = null;
    area.innerHTML = `<div class="card text-center"><p>📋 已在大廳，等考官出題…</p><p class="text-dim text-small">你是 ${escapeHtml(S.selfName)}</p></div>`;
    return;
  }
  if (state.kind === 'question') {
    if (S.playLastQid !== state.qid) {
      S.playLastQid = state.qid;
      S.playAnswered = false;
      S.playChoice = null;
    }
    const q = {
      id: state.qid,
      scenario: state.scenario,
      choices: state.choices,
      correct: state.correct,
      primary: state.primary,
      secondary: state.secondary,
      avoid: state.avoid,
      explain: state.explain
    };
    let html = renderQuestion(q, {
      revealed: !!state.revealed,
      selectedSet: new Set(S.playChoice || []),
      onClick: S.playAnswered || state.revealed ? null : 'playToggle',
      multi: true,
      optionsOverride: state.options
    });
    if (!state.revealed) {
      html += `<div class="flex-row mt-2">
        <button class="btn primary" id="play-submit" ${S.playAnswered ? 'disabled' : ''} onclick="playSubmit()">
          ${S.playAnswered ? '✓ 已提交，等揭曉' : '送出答案'}
        </button>
        <span class="text-dim text-small">可複選</span>
      </div>`;
    } else {
      const isCustom = !!(state.choices && state.choices.length);
      const correctSet = new Set(isCustom ? (state.correct || []) : (state.primary || []));
      const avoidSet = new Set(isCustom ? [] : (state.avoid || []));
      const sel = new Set(S.playChoice || []);
      let missed = [...correctSet].filter(c => !sel.has(c));
      let wrong = [...sel].filter(s => avoidSet.has(s));
      let result = (missed.length || wrong.length) ? '⚠️ 部分有誤' : '✅ 完全正確！';
      html += `<div class="explain-box mt-2"><strong>${result}</strong></div>`;
    }
    area.innerHTML = html;
    const sub = document.getElementById('play-submit');
    if (sub) sub.disabled = S.playAnswered || !(S.playChoice && S.playChoice.length);
  }
}

function playToggle(optId) {
  if (S.playAnswered || (S.playState && S.playState.revealed)) return;
  const set = new Set(S.playChoice || []);
  if (set.has(optId)) set.delete(optId); else set.add(optId);
  S.playChoice = Array.from(set);
  renderPlay(S.playState);
}

async function playSubmit() {
  if (!S.room) return;
  if (!S.playChoice || !S.playChoice.length) { toast('請至少選一個答案'); return; }
  try {
    await S.room.submitAnswer(S.playChoice);
    S.playAnswered = true;
    toast('已送出，等考官揭曉');
    renderPlay(S.playState);
  } catch (e) { toast('送出失敗：' + e.message); }
}

// ===== 技術帶練 — 教官（techhost）=====
function startTechHost(code) {
  S.roomCode = code;
  document.getElementById('techhost-room-code').textContent = code;
  document.getElementById('techhost-join-url').textContent = buildTechJoinUrl(code);
  const C = Content.get();
  const sel = document.getElementById('techhost-pick');
  sel.innerHTML = '<option value="">— 選擇 —</option>' +
    (C.techniques.techniques || []).map(t => `<option value="${escapeAttr(t.id)}">${escapeHtml(t.name)}</option>`).join('');
  S.techhostTechId = null;
  S.techhostStepIdx = 0;
  S.room = AirwaySync.createRoom(code, 'host', 'airwayTechRooms');
  S.room.onStudents(renderTechhostStudents);
  S.room.broadcast({ kind: 'lobby' });
  renderTechhostStep();
}

function techhostPickChange() {
  const sel = document.getElementById('techhost-pick');
  const id = sel.value;
  if (!id) { S.techhostTechId = null; S.techhostStepIdx = 0; renderTechhostStep(); return; }
  S.techhostTechId = id;
  S.techhostStepIdx = 0;
  broadcastTechStep();
}

function renderTechhostStudents(students) {
  const list = Object.entries(students || {});
  document.getElementById('techhost-student-count').textContent = `(${list.length})`;
  document.getElementById('techhost-students-list').innerHTML = list.length
    ? list.map(([id, s]) => `<span class="student-chip">${escapeHtml(s.name)}</span>`).join('')
    : '<span class="text-dim text-small">等待學員加入…</span>';
}

function renderTechhostStep() {
  const area = document.getElementById('techhost-step-area');
  if (!S.techhostTechId) { area.innerHTML = '<div class="card text-dim text-center">先選擇上方的技術</div>'; return; }
  const C = Content.get();
  const t = (C.techniques.techniques || []).find(x => x.id === S.techhostTechId);
  if (!t) { area.innerHTML = '<div class="card text-dim">技術不存在</div>'; return; }
  const steps = t.steps || [];
  if (S.techhostStepIdx >= steps.length) S.techhostStepIdx = steps.length - 1;
  const step = steps[S.techhostStepIdx] || {};
  area.innerHTML = `
    <div class="card">
      <div class="text-dim text-small">${escapeHtml(t.name)}・第 ${S.techhostStepIdx + 1} / ${steps.length} 步</div>
      <div class="step-viewer" style="margin-top:0.5rem">
        <div class="step-img-wrap">
          ${step.imageUrl ? `<img src="${escapeAttr(step.imageUrl)}" alt="" />` : '<span>（無圖）</span>'}
        </div>
        <div class="step-title">${escapeHtml(step.title || '')}</div>
        ${step.caption ? `<div class="step-caption">${escapeHtml(step.caption)}</div>` : ''}
        <div class="step-narration">${escapeHtml(step.narration || '')}</div>
      </div>
      <div class="step-pip">
        ${steps.map((_, i) => `<span class="pip ${i === S.techhostStepIdx ? 'active' : ''}" onclick="techhostGotoStep(${i})"></span>`).join('')}
      </div>
    </div>
  `;
}

function techhostGotoStep(i) { S.techhostStepIdx = i; broadcastTechStep(); }
function techhostPrev() { if (S.techhostStepIdx > 0) { S.techhostStepIdx--; broadcastTechStep(); } }
function techhostNext() {
  const C = Content.get();
  const t = (C.techniques.techniques || []).find(x => x.id === S.techhostTechId);
  if (!t) return;
  if (S.techhostStepIdx < (t.steps || []).length - 1) { S.techhostStepIdx++; broadcastTechStep(); }
}
function broadcastTechStep() {
  if (!S.room) return;
  const C = Content.get();
  const t = (C.techniques.techniques || []).find(x => x.id === S.techhostTechId);
  if (!t) return;
  const step = (t.steps || [])[S.techhostStepIdx] || {};
  S.room.broadcast({
    kind: 'tech-step',
    techId: t.id,
    techName: t.name,
    stepIdx: S.techhostStepIdx,
    totalSteps: (t.steps || []).length,
    step: step
  });
  renderTechhostStep();
}

function techhostBackToLobby() {
  if (!S.room) return;
  S.techhostTechId = null; S.techhostStepIdx = 0;
  document.getElementById('techhost-pick').value = '';
  S.room.broadcast({ kind: 'lobby' });
  renderTechhostStep();
}

// ===== 技術帶練 — 學員（techplay）=====
async function startTechPlay(code) {
  if (!S.selfName) {
    location.hash = '#/join';
    setTimeout(() => { const ci = document.getElementById('join-code-input'); if (ci) ci.value = code; }, 50);
    return;
  }
  S.roomCode = code;
  document.getElementById('techplay-room-code').textContent = code;
  S.room = AirwaySync.createRoom(code, 'play', 'airwayTechRooms');
  try { await S.room.joinAsStudent(S.selfName); }
  catch (e) { toast('加入房間失敗：' + e.message); return; }
  S.room.onState(renderTechPlay);
}

function renderTechPlay(state) {
  const area = document.getElementById('techplay-area');
  if (!state || state.kind === 'lobby') {
    area.innerHTML = `<div class="card text-center"><p>📋 已加入房間 <strong>${escapeHtml(S.roomCode)}</strong></p><p class="text-dim">等教官選技術…</p></div>`;
    return;
  }
  if (state.kind === 'tech-step') {
    const step = state.step || {};
    area.innerHTML = `
      <div class="text-dim text-small mb-1">${escapeHtml(state.techName)}・第 ${state.stepIdx + 1} / ${state.totalSteps} 步</div>
      <div class="step-viewer">
        <div class="step-img-wrap">
          ${step.imageUrl ? `<img src="${escapeAttr(step.imageUrl)}" alt="" />` : '<span>（無圖）</span>'}
        </div>
        <div class="step-title">${escapeHtml(step.title || '')}</div>
        ${step.caption ? `<div class="step-caption">${escapeHtml(step.caption)}</div>` : ''}
        <div class="step-narration">${escapeHtml(step.narration || '')}</div>
      </div>
    `;
  }
}

// ===== 共用：題目渲染 =====
// 自動偵測題型：
//   - q.choices 存在 → 自訂 4 選項格式，正解看 q.correct
//   - 否則 → 固定 8 選項格式，正解看 q.primary/secondary/avoid
function renderQuestion(q, opts) {
  const { revealed, selectedSet, onClick, disabled, optionsOverride } = opts;
  const C = Content.get();
  const isCustom = !!(q.choices && q.choices.length);

  let options, correctSet, secondarySet, avoidSet;
  if (isCustom) {
    options = q.choices;
    correctSet = new Set(q.correct || []);
    secondarySet = new Set();
    avoidSet = new Set();
  } else {
    options = optionsOverride || (C.questions && C.questions.options) || [];
    correctSet = new Set(q.primary || []);
    secondarySet = new Set(q.secondary || []);
    avoidSet = new Set(q.avoid || []);
  }

  let html = '';
  if (q.scenario) html += `<div class="scenario-box"><span class="qid">${q.id || ''}</span>${escapeHtml(q.scenario)}</div>`;
  html += `<div class="options-grid">`;
  options.forEach(opt => {
    const sel = selectedSet.has(opt.id);
    let cls = 'opt-btn';
    let tag = '';
    if (revealed) {
      if (correctSet.has(opt.id)) { cls += ' correct'; tag = '<span class="opt-tag correct-tag">正解</span>'; }
      else if (secondarySet.has(opt.id)) { cls += ' secondary-correct'; tag = '<span class="opt-tag secondary-tag">可考慮</span>'; }
      else if (avoidSet.has(opt.id)) { cls += ' wrong-avoid'; tag = '<span class="opt-tag avoid-tag">禁忌</span>'; }
    } else if (sel) cls += ' selected';
    const click = (!disabled && onClick) ? `onclick="${onClick}('${opt.id}')"` : '';
    const dis = (disabled || revealed) ? 'disabled' : '';
    const prefix = isCustom ? `<strong style="margin-right:0.5rem">${opt.id.toUpperCase()}.</strong>` : '';
    html += `<button class="${cls}" ${click} ${dis}>${prefix}${escapeHtml(opt.label)}${tag}</button>`;
  });
  html += `</div>`;
  if (revealed && q.explain) html += `<div class="explain-box"><strong>解釋：</strong>${escapeHtml(q.explain)}</div>`;
  return html;
}

// ============================================================
// ===== 編輯 Modal (lesson / question / technique) =====
// ============================================================

function openEditModal(title, bodyHtml, opts) {
  S.editCtx = opts;
  document.getElementById('edit-modal-title').textContent = title;
  document.getElementById('edit-modal-body').innerHTML = bodyHtml;
  document.getElementById('edit-modal-delete').classList.toggle('hidden', !!opts.isNew);
  document.getElementById('edit-modal').classList.remove('hidden');
}

function closeEditModal() {
  document.getElementById('edit-modal').classList.add('hidden');
  S.editCtx = null;
}

// ---- Lesson category ----
function editLessonCategory(id) {
  const C = Content.get();
  const cats = C.lessons.categories || [];
  const isNew = !id;
  const cat = isNew ? { id: 'cat-' + Date.now(), icon: '📂', title: '', items: [] } : cats.find(c => c.id === id);
  if (!cat) return;
  const body = `
    <label>ID（英文小寫，不可重複）</label>
    <input class="input" id="ec-id" value="${escapeAttr(cat.id)}" ${isNew ? '' : 'disabled'} />
    <label>圖示 emoji</label>
    <input class="input" id="ec-icon" value="${escapeAttr(cat.icon || '')}" />
    <label>分類名稱</label>
    <input class="input" id="ec-title" value="${escapeAttr(cat.title || '')}" />
  `;
  openEditModal(isNew ? '新增分類' : '編輯分類', body, { kind: 'lesson-cat', id: cat.id, isNew });
}

// ---- Lesson item ----
function editLessonItem(id) {
  const C = Content.get();
  const cat = (C.lessons.categories || [])[_activeCatIdx];
  if (!cat) return;
  const isNew = !id;
  const it = isNew ? {
    id: 'item-' + Date.now(),
    name: '', indication: '', contraindication: '', sizing: '', flow: '', fio2: '', steps: [], pearls: []
  } : (cat.items || []).find(x => x.id === id);
  if (!it) return;
  const body = `
    <label>ID（英文小寫，不可重複）</label>
    <input class="input" id="ei-id" value="${escapeAttr(it.id)}" ${isNew ? '' : 'disabled'} />
    <label>名稱</label>
    <input class="input" id="ei-name" value="${escapeAttr(it.name || '')}" />
    <label>適應症</label>
    <textarea class="textarea" id="ei-ind">${escapeHtml(it.indication || '')}</textarea>
    <label>禁忌</label>
    <textarea class="textarea" id="ei-contra">${escapeHtml(it.contraindication || '')}</textarea>
    <label>尺寸（可空）</label>
    <input class="input" id="ei-sizing" value="${escapeAttr(it.sizing || '')}" />
    <label>流速（可空）</label>
    <input class="input" id="ei-flow" value="${escapeAttr(it.flow || '')}" />
    <label>FiO₂（可空）</label>
    <input class="input" id="ei-fio2" value="${escapeAttr(it.fio2 || '')}" />
    <label>步驟（每行一項）</label>
    <textarea class="textarea" id="ei-steps" style="min-height:120px">${escapeHtml((it.steps || []).join('\n'))}</textarea>
    <label>重點（每行一項）</label>
    <textarea class="textarea" id="ei-pearls" style="min-height:100px">${escapeHtml((it.pearls || []).join('\n'))}</textarea>
  `;
  openEditModal(isNew ? '新增項目' : '編輯項目', body, { kind: 'lesson-item', catId: cat.id, id: it.id, isNew });
}

// ---- Question ----
// 兩種題型：
//   A. 自訂選項（新增題目預設）：q.choices = [{id,label}] + q.correct = [id,...]
//   B. 固定 8 選項（舊題）：q.primary/secondary/avoid 對應 Content.questions.options
function editQuestion(id) {
  const C = Content.get();
  const qs = C.questions.questions || [];
  const isNew = !id;
  const q = isNew ? {
    id: 'q' + Date.now().toString().slice(-4),
    scenario: '',
    choices: [
      { id: 'a', label: '' },
      { id: 'b', label: '' },
      { id: 'c', label: '' },
      { id: 'd', label: '' }
    ],
    correct: [],
    explain: ''
  } : qs.find(x => x.id === id);
  if (!q) return;

  // 偵測題型
  const isCustom = !!q.choices;
  let body;
  if (isCustom) {
    // 快速模式：4 個自訂選項 + 4 個正解 checkbox
    body = `
      <label>題號（不可重複）</label>
      <input class="input" id="eq-id" value="${escapeAttr(q.id)}" ${isNew ? '' : 'disabled'} />
      <label>情境（題目敘述）</label>
      <textarea class="textarea" id="eq-scenario" style="min-height:100px" placeholder="例：昏迷，有呼吸，有鼾音，應該…？">${escapeHtml(q.scenario || '')}</textarea>
      <label>4 個選項（勾選正解，可複選）</label>
      <div id="eq-choices-wrap">
        ${(q.choices || []).map((c, i) => `
          <div class="flex-row mb-1" style="align-items:center">
            <input type="checkbox" id="eq-correct-${c.id}" value="${c.id}" ${(q.correct||[]).includes(c.id) ? 'checked' : ''} style="width:20px;height:20px;flex:0 0 20px" />
            <strong style="width:1.5rem;text-align:center">${c.id.toUpperCase()}</strong>
            <input class="input" id="eq-choice-${c.id}" value="${escapeAttr(c.label)}" placeholder="選項 ${c.id.toUpperCase()} 文字" />
          </div>
        `).join('')}
      </div>
      <label>解釋（揭曉時顯示，可空）</label>
      <textarea class="textarea" id="eq-explain" style="min-height:80px">${escapeHtml(q.explain || '')}</textarea>
    `;
  } else {
    // 舊題進階模式：固定 8 選項
    const opts = C.questions.options || [];
    const checkboxes = (field, values) => opts.map(o =>
      `<label class="flex-row" style="font-size:0.9rem;color:var(--text);font-weight:normal">
         <input type="checkbox" name="eq-${field}" value="${o.id}" ${values.includes(o.id) ? 'checked' : ''}/>
         ${escapeHtml(o.label)}
       </label>`).join('');
    body = `
      <p class="text-dim text-small">這是進階多選題（固定 8 選項）。新題建議用「快速 4 選」格式。</p>
      <label>題號（不可重複）</label>
      <input class="input" id="eq-id" value="${escapeAttr(q.id)}" disabled />
      <label>情境描述</label>
      <textarea class="textarea" id="eq-scenario" style="min-height:120px">${escapeHtml(q.scenario || '')}</textarea>
      <label>應做（primary）</label>
      <div>${checkboxes('primary', q.primary || [])}</div>
      <label>可考慮（secondary）</label>
      <div>${checkboxes('secondary', q.secondary || [])}</div>
      <label>禁忌（avoid）</label>
      <div>${checkboxes('avoid', q.avoid || [])}</div>
      <label>解釋</label>
      <textarea class="textarea" id="eq-explain" style="min-height:100px">${escapeHtml(q.explain || '')}</textarea>
    `;
  }
  openEditModal(isNew ? '新增題目（快速）' : '編輯題目', body, { kind: 'question', id: q.id, isNew, isCustom });
}

// ---- Technique ----
function editTechnique(id) {
  const C = Content.get();
  const techs = C.techniques.techniques || [];
  const isNew = !id;
  const t = isNew ? { id: 'tech-' + Date.now(), name: '', summary: '', steps: [] } : techs.find(x => x.id === id);
  if (!t) return;
  S.editingTechSteps = JSON.parse(JSON.stringify(t.steps || []));
  const body = `
    <label>ID（英文小寫，不可重複）</label>
    <input class="input" id="et-id" value="${escapeAttr(t.id)}" ${isNew ? '' : 'disabled'} />
    <label>技術名稱</label>
    <input class="input" id="et-name" value="${escapeAttr(t.name || '')}" />
    <label>摘要</label>
    <input class="input" id="et-summary" value="${escapeAttr(t.summary || '')}" />
    <hr style="border-color:var(--border);margin:1rem 0" />
    <div class="flex-row">
      <h4 style="margin:0">步驟</h4>
      <span class="spacer"></span>
      <button class="btn small" onclick="techStepAdd()">+ 新增步驟</button>
    </div>
    <div id="et-steps-wrap" class="mt-1"></div>
  `;
  openEditModal(isNew ? '新增技術' : '編輯技術', body, { kind: 'technique', id: t.id, isNew });
  renderTechStepsEditor();
}

function renderTechStepsEditor() {
  const wrap = document.getElementById('et-steps-wrap');
  if (!wrap) return;
  wrap.innerHTML = (S.editingTechSteps || []).map((step, i) => `
    <div class="step-edit-row">
      <div class="step-edit-head">
        <strong>步驟 ${i + 1}</strong>
        <span>
          <button class="btn small ghost" onclick="techStepMove(${i},-1)" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn small ghost" onclick="techStepMove(${i},1)" ${i === S.editingTechSteps.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="btn small danger" onclick="techStepRemove(${i})">刪</button>
        </span>
      </div>
      <input class="input" placeholder="步驟標題" value="${escapeAttr(step.title || '')}" oninput="techStepEdit(${i},'title',this.value)" />
      <input class="input mt-1" placeholder="圖片說明（可空）" value="${escapeAttr(step.caption || '')}" oninput="techStepEdit(${i},'caption',this.value)" />
      <textarea class="textarea mt-1" placeholder="口條（朗讀腳本）" oninput="techStepEdit(${i},'narration',this.value)">${escapeHtml(step.narration || '')}</textarea>
      <div class="image-upload-area mt-1" onclick="document.getElementById('img-up-${i}').click()">
        ${step.imageUrl ? `<img src="${escapeAttr(step.imageUrl)}" class="image-preview" />` : '點此選圖（jpg/png）'}
      </div>
      <input type="file" id="img-up-${i}" accept="image/*" style="display:none" onchange="techStepUpload(${i}, this.files[0])" />
      <input class="input mt-1 text-small" placeholder="或直接貼上 URL" value="${escapeAttr(step.imageUrl || '')}" oninput="techStepEdit(${i},'imageUrl',this.value);renderTechStepsEditor()" />
    </div>
  `).join('') || '<p class="text-dim text-small">尚無步驟，按上方「+ 新增步驟」</p>';
}

function techStepAdd() {
  S.editingTechSteps.push({ title: '', caption: '', narration: '', imageUrl: '' });
  renderTechStepsEditor();
}
function techStepRemove(i) {
  if (!confirm('刪除這個步驟？')) return;
  S.editingTechSteps.splice(i, 1);
  renderTechStepsEditor();
}
function techStepMove(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= S.editingTechSteps.length) return;
  [S.editingTechSteps[i], S.editingTechSteps[j]] = [S.editingTechSteps[j], S.editingTechSteps[i]];
  renderTechStepsEditor();
}
function techStepEdit(i, field, val) {
  if (!S.editingTechSteps[i]) return;
  S.editingTechSteps[i][field] = val;
}

async function techStepUpload(i, file) {
  if (!file) return;
  if (!firebase.storage) { toast('Storage 未載入'); return; }
  toast('上傳中…');
  try {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `airway/${S.editCtx.id || 'misc'}/${Date.now()}_${i}.${ext}`;
    const ref = firebase.storage().ref(path);
    const snap = await ref.put(file);
    const url = await snap.ref.getDownloadURL();
    S.editingTechSteps[i].imageUrl = url;
    renderTechStepsEditor();
    toast('上傳完成');
  } catch (e) {
    console.error(e);
    toast('上傳失敗：' + e.message);
  }
}

// ===== editSave / editDelete dispatcher =====
async function editSave() {
  if (!S.editCtx) return;
  const C = Content.get();
  try {
    if (S.editCtx.kind === 'lesson-cat') {
      const lessons = JSON.parse(JSON.stringify(C.lessons));
      const id = document.getElementById('ec-id').value.trim();
      const icon = document.getElementById('ec-icon').value.trim();
      const title = document.getElementById('ec-title').value.trim();
      if (!id || !title) { toast('ID 和名稱必填'); return; }
      const existing = lessons.categories.find(c => c.id === (S.editCtx.isNew ? id : S.editCtx.id));
      if (S.editCtx.isNew) {
        if (lessons.categories.find(c => c.id === id)) { toast('ID 已存在'); return; }
        lessons.categories.push({ id, icon, title, items: [] });
      } else {
        existing.icon = icon; existing.title = title;
      }
      await Content.saveSection('lessons', lessons);
    }
    else if (S.editCtx.kind === 'lesson-item') {
      const lessons = JSON.parse(JSON.stringify(C.lessons));
      const cat = lessons.categories.find(c => c.id === S.editCtx.catId);
      if (!cat) return;
      const id = document.getElementById('ei-id').value.trim();
      const newItem = {
        id,
        name: document.getElementById('ei-name').value.trim(),
        indication: document.getElementById('ei-ind').value.trim(),
        contraindication: document.getElementById('ei-contra').value.trim(),
        sizing: document.getElementById('ei-sizing').value.trim(),
        flow: document.getElementById('ei-flow').value.trim(),
        fio2: document.getElementById('ei-fio2').value.trim(),
        steps: document.getElementById('ei-steps').value.split('\n').map(s => s.trim()).filter(Boolean),
        pearls: document.getElementById('ei-pearls').value.split('\n').map(s => s.trim()).filter(Boolean)
      };
      if (!newItem.name) { toast('名稱必填'); return; }
      cat.items = cat.items || [];
      if (S.editCtx.isNew) {
        if (cat.items.find(x => x.id === id)) { toast('ID 已存在'); return; }
        cat.items.push(newItem);
      } else {
        const idx = cat.items.findIndex(x => x.id === S.editCtx.id);
        cat.items[idx] = newItem;
      }
      await Content.saveSection('lessons', lessons);
    }
    else if (S.editCtx.kind === 'question') {
      const questions = JSON.parse(JSON.stringify(C.questions));
      const id = document.getElementById('eq-id').value.trim();
      let q;
      if (S.editCtx.isCustom) {
        // 快速 4 選格式
        const choices = ['a','b','c','d'].map(letter => ({
          id: letter,
          label: (document.getElementById(`eq-choice-${letter}`)?.value || '').trim()
        })).filter(c => c.label);
        const correct = ['a','b','c','d'].filter(letter => document.getElementById(`eq-correct-${letter}`)?.checked);
        if (choices.length < 2) { toast('至少要 2 個選項'); return; }
        if (correct.length === 0) { toast('至少勾一個正解'); return; }
        q = {
          id,
          scenario: document.getElementById('eq-scenario').value.trim(),
          choices,
          correct,
          explain: document.getElementById('eq-explain').value.trim()
        };
      } else {
        // 舊式進階格式
        const getChecked = (field) => Array.from(document.querySelectorAll(`input[name="eq-${field}"]:checked`)).map(el => el.value);
        q = {
          id,
          scenario: document.getElementById('eq-scenario').value.trim(),
          primary: getChecked('primary'),
          secondary: getChecked('secondary'),
          avoid: getChecked('avoid'),
          explain: document.getElementById('eq-explain').value.trim()
        };
      }
      if (!q.scenario) { toast('情境必填'); return; }
      if (S.editCtx.isNew) {
        if (questions.questions.find(x => x.id === id)) { toast('題號已存在'); return; }
        questions.questions.push(q);
      } else {
        const idx = questions.questions.findIndex(x => x.id === S.editCtx.id);
        questions.questions[idx] = q;
      }
      await Content.saveSection('questions', questions);
    }
    else if (S.editCtx.kind === 'technique') {
      const techniques = JSON.parse(JSON.stringify(C.techniques));
      const id = document.getElementById('et-id').value.trim();
      const t = {
        id,
        name: document.getElementById('et-name').value.trim(),
        summary: document.getElementById('et-summary').value.trim(),
        steps: S.editingTechSteps || []
      };
      if (!t.name) { toast('技術名稱必填'); return; }
      techniques.techniques = techniques.techniques || [];
      if (S.editCtx.isNew) {
        if (techniques.techniques.find(x => x.id === id)) { toast('ID 已存在'); return; }
        techniques.techniques.push(t);
      } else {
        const idx = techniques.techniques.findIndex(x => x.id === S.editCtx.id);
        techniques.techniques[idx] = t;
      }
      await Content.saveSection('techniques', techniques);
    }
    toast('已儲存');
    closeEditModal();
  } catch (e) {
    console.error(e);
    toast('儲存失敗：' + e.message);
  }
}

async function editDelete() {
  if (!S.editCtx || S.editCtx.isNew) return;
  if (!confirm('確定刪除？此動作無法復原（可按首頁的「重置」還原預設範例）')) return;
  const C = Content.get();
  try {
    if (S.editCtx.kind === 'lesson-cat') {
      const lessons = JSON.parse(JSON.stringify(C.lessons));
      lessons.categories = lessons.categories.filter(c => c.id !== S.editCtx.id);
      await Content.saveSection('lessons', lessons);
    } else if (S.editCtx.kind === 'lesson-item') {
      const lessons = JSON.parse(JSON.stringify(C.lessons));
      const cat = lessons.categories.find(c => c.id === S.editCtx.catId);
      cat.items = (cat.items || []).filter(x => x.id !== S.editCtx.id);
      await Content.saveSection('lessons', lessons);
    } else if (S.editCtx.kind === 'question') {
      const questions = JSON.parse(JSON.stringify(C.questions));
      questions.questions = (questions.questions || []).filter(x => x.id !== S.editCtx.id);
      await Content.saveSection('questions', questions);
    } else if (S.editCtx.kind === 'technique') {
      const techniques = JSON.parse(JSON.stringify(C.techniques));
      techniques.techniques = (techniques.techniques || []).filter(x => x.id !== S.editCtx.id);
      await Content.saveSection('techniques', techniques);
      if (S.techCurrent && S.techCurrent.id === S.editCtx.id) S.techCurrent = null;
    }
    toast('已刪除');
    closeEditModal();
  } catch (e) {
    console.error(e);
    toast('刪除失敗：' + e.message);
  }
}

// ===== 工具 =====
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
let _toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

window.addEventListener('DOMContentLoaded', bootstrap);
