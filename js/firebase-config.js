// Firebase 公開設定（共用 ems-assessment 既有的 Realtime DB 專案）
// 命名空間用 airwayRooms/，與 ems-assessment 的 rooms/ 完全隔離，房號相同也不會衝突
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyAKELajoTSf6n3FQEDD0Fo0n9_tDqF0Clo",
  authDomain: "emt-primary-survey.firebaseapp.com",
  databaseURL: "https://emt-primary-survey-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "emt-primary-survey",
  storageBucket: "emt-primary-survey.firebasestorage.app",
  messagingSenderId: "15740450886",
  appId: "1:15740450886:web:82a44ff54263e79902f247",
  measurementId: "G-6YD60F57HQ"
};
