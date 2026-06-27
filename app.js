/* ============================================================
   多人擂台（Kahoot 式）— 主程式
   一間房多位玩家，同步答題，即時排行榜。
   host(主持人) 控制開始與題目推進；所有玩家在 players/<id> 下。
   ============================================================ */
(function () {
  "use strict";

  const QDURATION = 20;        // 每題秒數
  const REVEAL_MS = 2500;      // 每題揭曉停留（多人需稍久看排行榜）
  const CFG = window.APP_CONFIG || {};
  const TOPIC = (CFG.topic || "default").replace(/[^a-z0-9\-]/gi, "-").toLowerCase();
  const QR = window.QRCode;
  const QUESTIONS = window.QUESTIONS || [];
  const QMAP = {};
  QUESTIONS.forEach(q => { QMAP[q.id] = q; });

  const S = {
    isHost: false,
    myId: null,
    roomId: null,
    roomRef: null,
    room: null,
    questions: [],
    answered: false,
    lastIndex: -1,
    tick: null,
    hostTimer: null,
    statsWritten: false,
    finishedShown: false,
    advancedFrom: -1,
  };

  let db = null, firebaseReady = false;

  const $ = (id) => document.getElementById(id);
  const views = ["home", "create", "join", "lobby", "quiz", "result", "stats"];
  function show(v) { views.forEach(x => $("view-" + x).classList.toggle("hidden", x !== v)); window.scrollTo(0, 0); }
  function toast(m) { const t = $("toast"); t.textContent = m; t.classList.add("show"); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("show"), 2600); }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function randCode() { const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s = ""; for (let i = 0; i < 4; i++) s += c[Math.floor(Math.random() * c.length)]; return s; }
  function genId() { return "p_" + Math.random().toString(36).slice(2, 9); }
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; }

  function ref(path) { return db.ref("topics/" + TOPIC + "/" + path); }

  function initFirebase() {
    const cfg = window.firebaseConfig || {};
    const unset = !cfg.apiKey || /請貼上|你的專案|你的_/.test(cfg.apiKey + cfg.databaseURL + cfg.projectId);
    if (unset) { $("setupBanner").classList.remove("hidden"); return; }
    try { firebase.initializeApp(cfg); db = firebase.database(); firebaseReady = true; }
    catch (e) { console.error(e); $("setupBanner").classList.remove("hidden"); }
  }
  function requireFirebase() { if (!firebaseReady) { toast("尚未設定 Firebase"); $("setupBanner").classList.remove("hidden"); return false; } return true; }

  function applyBranding() {
    const setText = (id, v) => { const el = $(id); if (el && v != null) el.textContent = v; };
    const setHTML = (id, v) => { const el = $(id); if (el && v != null) el.innerHTML = v; };
    if (CFG.title) document.title = CFG.title;
    setText("brandTitle", CFG.title); setText("brandSubtitle", CFG.subtitle); setText("brandLogo", CFG.logo);
    setText("homeTitle", CFG.title); setHTML("homeIntro", CFG.intro); setHTML("homeFooter", CFG.footer);
    if (CFG.trueLabel) $("choiceTrue").innerHTML = '<span class="emoji">✅</span>' + esc(CFG.trueLabel);
    if (CFG.falseLabel) $("choiceFalse").innerHTML = '<span class="emoji">❌</span>' + esc(CFG.falseLabel);
  }

  // ---- 玩家工具 ----
  function playersOf(room) { return room && room.players ? room.players : {}; }
  function playerCount(room) { return Object.keys(playersOf(room)).length; }
  function scoreOf(p) {
    if (!p || !p.answers) return 0;
    let s = 0; Object.keys(p.answers).forEach(k => { s += (p.answers[k] && p.answers[k].points) || 0; });
    return s;
  }
  // 依分數排序，回傳 [{id,name,score,p}]
  function ranking(room) {
    const pl = playersOf(room);
    return Object.keys(pl).map(id => ({ id, name: pl[id].name, score: scoreOf(pl[id]), p: pl[id] }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }
  function countAnswered(room, idx) {
    const pl = playersOf(room); let n = 0;
    Object.keys(pl).forEach(id => { if (pl[id].answers && pl[id].answers[idx]) n++; });
    return n;
  }

  /* ===== 建立房間 ===== */
  function createRoom() {
    if (!requireFirebase()) return;
    const name = ($("hostName").value || "").trim() || "主持人";
    const count = parseInt($("qCount").value, 10) || 10;
    const ids = shuffle(QUESTIONS.map(q => q.id)).slice(0, Math.min(count, QUESTIONS.length));
    const code = randCode();
    S.isHost = true; S.myId = genId(); S.roomId = code; S.roomRef = ref("mprooms/" + code);
    S.statsWritten = false; S.finishedShown = false; S.advancedFrom = -1;
    S.questions = ids.map(id => QMAP[id]).filter(Boolean);

    const players = {}; players[S.myId] = { name: name, host: true, joinedAt: Date.now() };
    S.roomRef.set({
      status: "lobby", createdAt: firebase.database.ServerValue.TIMESTAMP,
      questionIds: ids, current: -1, deadline: 0, hostId: S.myId, players: players
    }).then(() => {
      buildWait(); attachListener();
    }).catch(e => toast("建立失敗：" + e.message));
  }

  function buildWait() {
    $("createNameCard").classList.add("hidden");
    $("waitCard").classList.remove("hidden");
    $("roomCodeText").textContent = S.roomId;
    const link = location.origin + location.pathname + "?mproom=" + S.roomId;
    $("shareLink").value = link;
    const box = $("qrcode"); box.innerHTML = "";
    if (QR) new QR(box, { text: link, width: 188, height: 188, correctLevel: QR.CorrectLevel.M });
    else box.textContent = "房號：" + S.roomId;
    show("create");
  }

  /* ===== 加入房間 ===== */
  function joinRoom() {
    if (!requireFirebase()) return;
    const code = ($("joinCode").value || "").trim().toUpperCase();
    const name = ($("guestName").value || "").trim() || "玩家";
    if (code.length < 4) { toast("請輸入正確房號"); return; }
    const r = ref("mprooms/" + code);
    r.get().then(snap => {
      if (!snap.exists()) { toast("找不到此房間"); return; }
      const room = snap.val();
      if (room.status !== "lobby") { toast("擂台已開始或已結束，無法加入"); return; }
      S.isHost = false; S.myId = genId(); S.roomId = code; S.roomRef = r;
      S.statsWritten = false; S.finishedShown = false;
      S.questions = (room.questionIds || []).map(id => QMAP[id]).filter(Boolean);
      r.child("players/" + S.myId).set({ name: name, host: false, joinedAt: Date.now() }).then(() => {
        $("lobbyCode").textContent = code;
        show("lobby"); attachListener();
      });
    }).catch(e => toast("加入失敗：" + e.message));
  }

  /* ===== 監聽 ===== */
  function attachListener() {
    S.roomRef.on("value", snap => {
      const room = snap.val();
      if (!room) { if (S.room && S.room.status !== "finished") toast("房間已關閉"); cleanup(); return; }
      S.room = room; onUpdate(room);
    });
  }

  function renderChips(room, chipsId, countId) {
    const rank = ranking(room);
    $(countId).textContent = "目前 " + rank.length + " 人" + (chipsId === "lobbyChips" ? "加入" : "");
    $(chipsId).innerHTML = rank.map(r =>
      '<span class="chip' + (r.id === S.myId ? ' me' : '') + (r.p.host ? ' host' : '') + '">' + esc(r.name) + '</span>'
    ).join("");
  }

  function onUpdate(room) {
    if (room.status === "lobby") {
      if (S.isHost) {
        renderChips(room, "lobbyChips", "lobbyCount");
        const n = playerCount(room);
        const btn = $("btnStartGame");
        btn.disabled = n < 2;
        btn.textContent = n < 2 ? "至少要 2 人才能開始" : ("▶ 開始擂台（" + n + " 人）");
      } else {
        renderChips(room, "lobbyChips2", "lobbyCount2");
      }
    }

    if (room.status === "playing") {
      if (room.current !== S.lastIndex) renderQuestion(room);
      else { updateMiniLb(room); updateAnsweredInfo(room); }
      if (S.isHost) hostSchedule(room);
    }

    if (room.status === "finished" && !S.finishedShown) {
      S.finishedShown = true; stopTick();
      if (S.isHost && !S.statsWritten) { S.statsWritten = true; writeStats(room); }
      renderResult(room);
    }
  }

  /* ===== 開始 / 推進（host） ===== */
  function startGame() {
    if (playerCount(S.room) < 2) { toast("至少要 2 人"); return; }
    S.advancedFrom = -1;
    S.roomRef.update({ status: "playing", current: 0, deadline: Date.now() + QDURATION * 1000 });
  }

  function hostSchedule(room) {
    clearTimeout(S.hostTimer);
    const ms = room.deadline - Date.now() + 900;
    S.hostTimer = setTimeout(hostTryAdvance, Math.max(ms, 300));
    hostTryAdvance();
  }

  function hostTryAdvance() {
    if (!S.roomRef || !S.isHost) return;
    const room = S.room;
    if (!room || room.status !== "playing") return;
    const cur = room.current;
    if (S.advancedFrom === cur) return;
    const total = S.questions.length;
    const everyone = playerCount(room);
    const allAnswered = everyone > 0 && countAnswered(room, cur) >= everyone;
    const expired = Date.now() > room.deadline + 600;
    if (!allAnswered && !expired) return;
    S.advancedFrom = cur;
    const done = cur >= total - 1;
    const doIt = () => {
      const payload = done ? { status: "finished", finishedAt: Date.now() }
        : { current: cur + 1, deadline: Date.now() + QDURATION * 1000 };
      S.roomRef.update(payload).catch(err => { console.error(err); S.advancedFrom = -1; });
    };
    if (allAnswered && !expired) setTimeout(doIt, REVEAL_MS); else doIt();
  }

  /* ===== 答題 ===== */
  function renderQuestion(room) {
    S.lastIndex = room.current; S.answered = false; show("quiz");
    const q = S.questions[room.current]; const total = S.questions.length;
    $("quizProgress").textContent = "第 " + (room.current + 1) + " / " + total + " 題";
    $("quizCategory").textContent = q.category || "食安";
    $("quizClaim").textContent = q.claim;
    ["choiceTrue", "choiceFalse"].forEach(id => { const el = $(id); el.disabled = false; el.classList.remove("selected", "correct", "wrong"); });
    $("quizFeedback").classList.add("hidden"); $("quizFeedback").innerHTML = "";
    $("answeredInfo").classList.add("hidden");
    updateMiniLb(room);
    startTick(room);
    const me = room.players[S.myId];
    if (me && me.answers && me.answers[room.current]) lockAfter(q, me.answers[room.current].choice, room);
  }

  function startTick(room) {
    stopTick();
    const upd = () => {
      const remain = Math.max(0, room.deadline - Date.now());
      const sec = Math.ceil(remain / 1000);
      const t = $("quizTimer"); t.textContent = sec; t.classList.toggle("low", sec <= 5);
      $("quizBar").style.width = (remain / (QDURATION * 1000) * 100) + "%";
      if (remain <= 0) { stopTick(); if (!S.answered) submitAnswer(null, room); }
    };
    upd(); S.tick = setInterval(upd, 200);
  }
  function stopTick() { if (S.tick) { clearInterval(S.tick); S.tick = null; } }

  function submitAnswer(choiceBool, room) {
    room = room || S.room;
    if (S.answered) return; S.answered = true; stopTick();
    const cur = room.current; const q = S.questions[cur];
    const correct = choiceBool !== null && choiceBool === q.answer;
    const remain = Math.max(0, room.deadline - Date.now());
    const points = correct ? 100 + Math.round(remain / 1000) * 5 : 0;
    S.roomRef.child("players/" + S.myId + "/answers/" + cur).set({ choice: choiceBool, correct: correct, points: points });
    lockAfter(q, choiceBool, room);
    if (S.isHost) hostTryAdvance();
  }

  function lockAfter(q, choiceBool, room) {
    const tBtn = $("choiceTrue"), fBtn = $("choiceFalse");
    tBtn.disabled = true; fBtn.disabled = true;
    (q.answer ? tBtn : fBtn).classList.add("correct");
    if (choiceBool !== null && choiceBool !== q.answer) (choiceBool ? tBtn : fBtn).classList.add("wrong");
    if (choiceBool !== null) (choiceBool ? tBtn : fBtn).classList.add("selected");
    const correct = choiceBool !== null && choiceBool === q.answer;
    const fb = $("quizFeedback");
    let head = choiceBool === null ? '<div class="verdict no">⏰ 時間到，未作答</div>'
      : (correct ? '<div class="verdict ok">✅ 答對了！</div>' : '<div class="verdict no">❌ 答錯了</div>');
    fb.innerHTML = head + '<div><strong>' + (q.answer ? "這個說法是「正確的」。" : "這是「謠言／錯誤說法」。") + '</strong><br>' + esc(q.explain) + '</div>';
    fb.classList.remove("hidden");
    $("answeredInfo").classList.remove("hidden");
    updateAnsweredInfo(room);
  }

  function updateAnsweredInfo(room) {
    const el = $("answeredInfo"); if (el.classList.contains("hidden")) return;
    const n = countAnswered(room, room.current), all = playerCount(room);
    el.textContent = "已作答 " + n + " / " + all + " 人" + (n >= all ? "　·　即將公布排行榜…" : "　·　等待其他人…");
  }

  function updateMiniLb(room) {
    const rank = ranking(room);
    const top = rank.slice(0, 3).map((r, i) => ["🥇", "🥈", "🥉"][i] + " " + esc(r.name) + " " + r.score);
    const mineIdx = rank.findIndex(r => r.id === S.myId);
    let mine = mineIdx >= 0 ? ("你：第 " + (mineIdx + 1) + " 名・" + rank[mineIdx].score + " 分") : "";
    $("miniLb").innerHTML = (top.join("　") || "尚無分數") + (mine ? '　|　<b style="color:var(--brand)">' + mine + "</b>" : "");
  }

  /* ===== 結果 ===== */
  function renderResult(room) {
    show("result");
    const rank = ranking(room);
    const meIdx = rank.findIndex(r => r.id === S.myId);
    const champ = rank[0];
    $("resultCrown").textContent = "🏆";
    $("resultTitle").textContent = champ ? ("冠軍：" + champ.name) : "擂台結束";
    if (meIdx === 0) $("resultSub").textContent = "恭喜你拿下全場第一！👑";
    else if (meIdx > 0) $("resultSub").textContent = "你是第 " + (meIdx + 1) + " 名（共 " + rank.length + " 人），再來一場吧！";
    else $("resultSub").textContent = "共 " + rank.length + " 人參戰。";
    $("finalLb").innerHTML = rank.map((r, i) =>
      '<div class="lb-row' + (r.id === S.myId ? ' me' : '') + '">' +
      '<div class="lb-rank">' + (i + 1) + '</div>' +
      '<div class="lb-name">' + esc(r.name) + (r.p.host ? ' 👑' : '') + (r.id === S.myId ? '（你）' : '') + '</div>' +
      '<div class="lb-score">' + r.score + '</div></div>'
    ).join("");
  }

  /* ===== 統計 ===== */
  function writeStats(room) {
    if (!db) return;
    const pl = playersOf(room); let totalAnswers = 0;
    Object.keys(pl).forEach(id => {
      const ans = pl[id].answers; if (!ans) return;
      (room.questionIds || []).forEach((qid, i) => {
        const a = ans[i]; if (!a) return;
        totalAnswers++;
        ref("stats/questions/" + qid + "/attempts").transaction(v => (v || 0) + 1);
        if (!a.correct) ref("stats/questions/" + qid + "/wrong").transaction(v => (v || 0) + 1);
      });
    });
    ref("stats/totals/matches").transaction(v => (v || 0) + 1);
    ref("stats/totals/answers").transaction(v => (v || 0) + totalAnswers);
    const rank = ranking(room);
    ref("matches").push({
      players: rank.length, champion: rank[0] ? rank[0].name : "",
      topScore: rank[0] ? rank[0].score : 0, finishedAt: room.finishedAt || Date.now()
    });
  }

  function loadStats() {
    show("stats"); $("statsList").innerHTML = '<div class="spinner"></div>';
    if (!requireFirebase()) { $("statsList").innerHTML = '<p class="muted center">需先設定 Firebase。</p>'; return; }
    ref("stats").get().then(snap => {
      const data = snap.val() || {}; const totals = data.totals || {}; const qs = data.questions || {};
      $("kpiMatches").textContent = totals.matches || 0;
      $("kpiAnswers").textContent = totals.answers || 0;
      let tw = 0, ta = 0;
      const rows = QUESTIONS.map(q => { const st = qs[q.id] || {}; const att = st.attempts || 0, wrong = st.wrong || 0; tw += wrong; ta += att; return { q, att, wrong, rate: att ? wrong / att : 0 }; });
      $("kpiWrong").textContent = ta ? Math.round(tw / ta * 100) + "%" : "0%";
      const ans = rows.filter(r => r.att > 0).sort((a, b) => b.rate - a.rate || b.att - a.att);
      if (!ans.length) { $("statsList").innerHTML = '<p class="muted center">目前還沒有作答記錄。</p>'; return; }
      $("statsList").innerHTML = ans.map(r => {
        const pct = Math.round(r.rate * 100);
        return '<div class="stat-row"><div class="sq"><span>' + esc(r.q.claim) + '</span><span class="pct">' + pct + '%</span></div>' +
          '<div class="sbar"><i style="width:' + Math.max(pct, 3) + '%"></i></div>' +
          '<div class="meta">作答 ' + r.att + ' 次，答錯 ' + r.wrong + ' 次　·　正解：' + (r.q.answer ? "正確" : "謠言") + '　·　' + esc(r.q.category) + '</div></div>';
      }).join("");
    }).catch(e => { $("statsList").innerHTML = '<p class="muted center">讀取失敗：' + esc(e.message) + '</p>'; });
  }

  function resetStats() {
    if (!requireFirebase()) return;
    const correct = CFG.adminPass || "";
    if (!correct) { toast("尚未設定 adminPass"); return; }
    const pass = window.prompt("請輸入管理密碼以重置統計：");
    if (pass === null) return;
    if (pass !== correct) { toast("密碼錯誤"); return; }
    if (!window.confirm("確定清除「" + (CFG.title || "本主題") + "」的所有統計與記錄嗎？此動作無法復原。")) return;
    Promise.all([ref("stats").remove(), ref("matches").remove(), ref("mprooms").remove()])
      .then(() => { toast("✅ 已重置"); loadStats(); })
      .catch(e => toast("重置失敗：" + e.message));
  }

  /* ===== 清理 ===== */
  function cleanup() { if (S.roomRef) S.roomRef.off(); clearTimeout(S.hostTimer); stopTick(); }
  function resetToHome() {
    cleanup();
    if (S.isHost && S.roomRef && S.room && S.room.status !== "playing") S.roomRef.remove().catch(() => {});
    S.isHost = false; S.myId = null; S.roomId = null; S.roomRef = null; S.room = null;
    S.questions = []; S.lastIndex = -1; S.answered = false; S.advancedFrom = -1;
    S.statsWritten = false; S.finishedShown = false;
    $("createNameCard").classList.remove("hidden"); $("waitCard").classList.add("hidden");
    history.replaceState(null, "", location.pathname);
    show("home");
  }

  function bind() {
    $("btnCreate").onclick = () => { show("create"); $("createNameCard").classList.remove("hidden"); $("waitCard").classList.add("hidden"); };
    $("btnJoinManual").onclick = () => show("join");
    $("btnStats").onclick = loadStats; $("navStats").onclick = loadStats; $("btnStatsBack").onclick = resetToHome;
    $("btnResetStats").onclick = resetStats;
    $("btnBackHome1").onclick = resetToHome; $("btnBackHome2").onclick = resetToHome;
    $("btnDoCreate").onclick = createRoom; $("btnDoJoin").onclick = joinRoom;
    $("btnCancelRoom").onclick = resetToHome; $("btnStartGame").onclick = startGame;
    $("btnPlayAgain").onclick = resetToHome; $("btnResultStats").onclick = loadStats;
    $("btnCopyLink").onclick = () => { const i = $("shareLink"); i.select(); (navigator.clipboard ? navigator.clipboard.writeText(i.value) : Promise.reject()).then(() => toast("已複製連結")).catch(() => { document.execCommand("copy"); toast("已複製連結"); }); };
    $("choiceTrue").onclick = () => submitAnswer(true, S.room);
    $("choiceFalse").onclick = () => submitAnswer(false, S.room);
    $("joinCode").addEventListener("input", e => { e.target.value = e.target.value.toUpperCase(); });
  }

  function start() {
    applyBranding(); initFirebase(); bind();
    const room = new URLSearchParams(location.search).get("mproom");
    if (room) { $("joinCode").value = room.toUpperCase(); show("join"); setTimeout(() => $("guestName").focus(), 100); }
    else show("home");
  }
  document.addEventListener("DOMContentLoaded", start);
})();
