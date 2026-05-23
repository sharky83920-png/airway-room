// content.js — 教材/題庫/技術內容的 Firebase 共享層
// Schema：airwayContent/{lessons|questions|techniques}
// 啟動流程：
//   1. 嘗試從 Firebase 讀
//   2. Firebase 無資料 → 用 data/*.json 灌入 Firebase 當 seed
//   3. Firebase 有資料 → 用 Firebase 的版本
//   4. 監聽 Firebase 變動，任何 client 改動所有人即時收到

const SEED_FILES = {
  lessons: 'data/lessons.json',
  questions: 'data/questions.json',
  techniques: 'data/techniques.json'
};

const _state = {
  lessons: null,
  questions: null,
  techniques: null,
  ready: false,
  fbAvailable: false,
  optionMap: {}
};

const _listeners = [];

function _emit() {
  _listeners.forEach(fn => { try { fn(_state); } catch (e) { console.error(e); } });
}

async function _fetchSeed(name) {
  const res = await fetch(SEED_FILES[name]);
  return res.json();
}

async function _initFirebase() {
  if (typeof firebase === 'undefined' || !window.FIREBASE_CONFIG) return false;
  try {
    if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
    return true;
  } catch (e) {
    console.error('content firebase init failed:', e);
    return false;
  }
}

async function loadAll() {
  _state.fbAvailable = await _initFirebase();

  // 1. 同時取得本地 seed（之後降級或 reset 時使用）
  const seeds = {};
  for (const k of Object.keys(SEED_FILES)) {
    try { seeds[k] = await _fetchSeed(k); } catch (e) { seeds[k] = null; }
  }
  _state._seeds = seeds;

  if (!_state.fbAvailable) {
    // 降級：純本地
    Object.assign(_state, seeds);
    _buildOptionMap();
    _state.ready = true;
    _emit();
    return _state;
  }

  // 2. 從 Firebase 讀
  const root = firebase.database().ref('airwayContent');
  const snap = await root.once('value');
  const current = snap.val() || {};

  // 3. 缺哪一塊就用 seed 灌入
  const writes = {};
  for (const k of Object.keys(SEED_FILES)) {
    if (current[k]) {
      _state[k] = current[k];
    } else if (seeds[k]) {
      _state[k] = seeds[k];
      writes[k] = seeds[k];
    }
  }
  if (Object.keys(writes).length) {
    await root.update(writes);
  }

  _buildOptionMap();
  _state.ready = true;
  _emit();

  // 4. 訂閱後續變動
  ['lessons', 'questions', 'techniques'].forEach(section => {
    root.child(section).on('value', (s) => {
      const v = s.val();
      if (v) {
        _state[section] = v;
        if (section === 'questions') _buildOptionMap();
        _emit();
      }
    });
  });

  return _state;
}

function _buildOptionMap() {
  _state.optionMap = {};
  if (_state.questions && _state.questions.options) {
    _state.questions.options.forEach(o => { _state.optionMap[o.id] = o.label; });
  }
}

async function saveSection(section, data) {
  if (!['lessons', 'questions', 'techniques'].includes(section)) {
    throw new Error('invalid section: ' + section);
  }
  _state[section] = data;
  if (section === 'questions') _buildOptionMap();
  _emit();
  if (_state.fbAvailable) {
    await firebase.database().ref(`airwayContent/${section}`).set(data);
  }
}

async function resetToDefaults() {
  const writes = {};
  for (const k of Object.keys(SEED_FILES)) {
    if (_state._seeds[k]) {
      _state[k] = JSON.parse(JSON.stringify(_state._seeds[k]));
      writes[k] = _state[k];
    }
  }
  _buildOptionMap();
  _emit();
  if (_state.fbAvailable) {
    await firebase.database().ref('airwayContent').update(writes);
  }
}

function onUpdate(fn) { _listeners.push(fn); }

function get() { return _state; }

window.Content = { loadAll, saveSection, resetToDefaults, onUpdate, get };
