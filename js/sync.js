// sync.js — airway-room 房間同步
// 結構：{namespace}/{code}/
//   ├── state            host 廣播：任意 JSON
//   ├── students/{id}    學員 presence
//   └── answers/{id}     學員提交（互考用）
//
// 預設 namespace = 'airwayRooms'（互考用）
// 技術帶練用 namespace = 'airwayTechRooms'
// 若 Firebase 無法初始化，自動退回 BroadcastChannel

let _fbReady = false;

function initFirebase() {
  if (_fbReady) return true;
  if (typeof firebase === 'undefined' || !window.FIREBASE_CONFIG) return false;
  try {
    if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
    _fbReady = true;
    return true;
  } catch (e) {
    console.error('Firebase init failed:', e);
    return false;
  }
}

function safe(fn, arg) { try { fn(arg); } catch (e) { console.error(e); } }

// ===== Firebase 版 =====
class FirebaseRoom {
  constructor(code, role, namespace) {
    this.code = code;
    this.role = role;
    this.namespace = namespace || 'airwayRooms';
    this.base = firebase.database().ref(`${this.namespace}/${code}`);
    this.stateRef = this.base.child('state');
    this.studentsRef = this.base.child('students');
    this.answersRef = this.base.child('answers');
    this._stateListeners = [];
    this._studentsListeners = [];
    this._answersListeners = [];
    this._selfId = null;
    this._selfRef = null;

    this.stateRef.on('value', (s) => {
      const v = s.val();
      if (v) this._stateListeners.forEach(fn => safe(fn, v));
    });
    this.studentsRef.on('value', (s) => {
      const v = s.val() || {};
      this._studentsListeners.forEach(fn => safe(fn, v));
    });
    this.answersRef.on('value', (s) => {
      const v = s.val() || {};
      this._answersListeners.forEach(fn => safe(fn, v));
    });
  }

  broadcast(state) {
    return this.stateRef.set({ ...state, ts: Date.now() });
  }
  clearAnswers() {
    return this.answersRef.remove();
  }

  async joinAsStudent(name) {
    this._selfId = `s_${Math.random().toString(36).slice(2, 10)}`;
    this._selfRef = this.studentsRef.child(this._selfId);
    await this._selfRef.set({ name, joinedAt: Date.now() });
    this._selfRef.onDisconnect().remove();
    this.answersRef.child(this._selfId).onDisconnect().remove();
    return this._selfId;
  }
  submitAnswer(choice) {
    if (!this._selfId) return Promise.reject(new Error('not joined'));
    return this.answersRef.child(this._selfId).set({ choice, ts: Date.now() });
  }

  onState(fn) { this._stateListeners.push(fn); }
  onStudents(fn) { this._studentsListeners.push(fn); }
  onAnswers(fn) { this._answersListeners.push(fn); }

  destroy() {
    try { this.stateRef.off(); this.studentsRef.off(); this.answersRef.off(); } catch {}
    if (this._selfRef) {
      try {
        this._selfRef.remove();
        this.answersRef.child(this._selfId).remove();
      } catch {}
    }
  }
}

// ===== 退回模式：BroadcastChannel =====
class LocalRoom {
  constructor(code, role, namespace) {
    this.code = code;
    this.role = role;
    this.namespace = namespace || 'airwayRooms';
    this.ch = new BroadcastChannel(`${this.namespace}-${code}`);
    this._stateListeners = [];
    this._studentsListeners = [];
    this._answersListeners = [];
    this.students = JSON.parse(localStorage.getItem(this._k('students')) || '{}');
    this.answers = JSON.parse(localStorage.getItem(this._k('answers')) || '{}');
    this.state = JSON.parse(localStorage.getItem(this._k('state')) || 'null');
    this._selfId = null;
    this.ch.onmessage = (e) => this._handle(e.data);
  }
  _k(name) { return `${this.namespace}-${this.code}-${name}`; }
  _persist(name, val) { localStorage.setItem(this._k(name), JSON.stringify(val)); }
  _handle(msg) {
    if (msg.kind === 'state') {
      this.state = msg.data;
      this._persist('state', this.state);
      this._stateListeners.forEach(fn => safe(fn, this.state));
    } else if (msg.kind === 'join') {
      this.students[msg.id] = msg.data;
      this._persist('students', this.students);
      this._studentsListeners.forEach(fn => safe(fn, this.students));
    } else if (msg.kind === 'leave') {
      delete this.students[msg.id];
      this._persist('students', this.students);
      this._studentsListeners.forEach(fn => safe(fn, this.students));
    } else if (msg.kind === 'answer') {
      this.answers[msg.id] = msg.data;
      this._persist('answers', this.answers);
      this._answersListeners.forEach(fn => safe(fn, this.answers));
    } else if (msg.kind === 'clearAnswers') {
      this.answers = {};
      this._persist('answers', this.answers);
      this._answersListeners.forEach(fn => safe(fn, this.answers));
    }
  }

  broadcast(state) {
    const data = { ...state, ts: Date.now() };
    this.state = data; this._persist('state', data);
    this.ch.postMessage({ kind: 'state', data });
    return Promise.resolve();
  }
  clearAnswers() {
    this.answers = {}; this._persist('answers', {});
    this.ch.postMessage({ kind: 'clearAnswers' });
    return Promise.resolve();
  }
  async joinAsStudent(name) {
    this._selfId = `s_${Math.random().toString(36).slice(2, 10)}`;
    const data = { name, joinedAt: Date.now() };
    this.students[this._selfId] = data;
    this._persist('students', this.students);
    this.ch.postMessage({ kind: 'join', id: this._selfId, data });
    window.addEventListener('beforeunload', () => {
      this.ch.postMessage({ kind: 'leave', id: this._selfId });
    });
    return this._selfId;
  }
  submitAnswer(choice) {
    const data = { choice, ts: Date.now() };
    this.answers[this._selfId] = data;
    this._persist('answers', this.answers);
    this.ch.postMessage({ kind: 'answer', id: this._selfId, data });
    return Promise.resolve();
  }
  onState(fn) {
    this._stateListeners.push(fn);
    if (this.state) safe(fn, this.state);
  }
  onStudents(fn) {
    this._studentsListeners.push(fn);
    safe(fn, this.students);
  }
  onAnswers(fn) {
    this._answersListeners.push(fn);
    safe(fn, this.answers);
  }
  destroy() { try { this.ch.close(); } catch {} }
}

function createRoom(code, role, namespace) {
  if (initFirebase()) return new FirebaseRoom(code, role, namespace);
  console.warn('Firebase 未啟用，退回本地同步');
  return new LocalRoom(code, role, namespace);
}

function getSyncMode() {
  if (_fbReady) return 'cloud';
  // 其他模組（如 content.js）可能已經 init 過 firebase
  if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
    _fbReady = true;
    return 'cloud';
  }
  return 'local';
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

window.AirwaySync = { createRoom, generateRoomCode, getSyncMode };
