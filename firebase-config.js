/* ============================================================
   Firebase 設定檔（已填入 food-duel 專案）
   ------------------------------------------------------------
   這些是前端公開設定值，會出現在網頁中，並非密碼。
   真正的存取保護由 Realtime Database 的「安全性規則」決定。
   ============================================================ */
const firebaseConfig = {
  apiKey: "AIzaSyA7DT-yTUIJiNcCiKh2Fj0CEaBrmvdpcEM",
  authDomain: "food-duel.firebaseapp.com",
  databaseURL: "https://food-duel-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "food-duel",
  storageBucket: "food-duel.firebasestorage.app",
  messagingSenderId: "156556716606",
  appId: "1:156556716606:web:94edec1a66863d3eed7f6f",
  measurementId: "G-CZB6KCX4H1"
};

window.firebaseConfig = firebaseConfig;
