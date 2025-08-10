// ====== 設定 ======
const TRIP_YEAR = 2025;
const BUDGET_JPY = 800000;

// ローカル保存キー
const STORAGE_KEY = "trip-budget-records-v1";
// 削除キュー（自動/手動同期時に最優先で反映）
const DELETED_KEY = "trip-budget-deleted-ids";

// 種類（固定）
const CATEGORIES = ["宿泊費","交通費","食費","観光代","土産代","その他"];

// 円グラフ配色（視認性重視）
const COLORS = [
  "#ff4d4d", // 赤
  "#4d79ff", // 青
  "#4dff4d", // 緑
  "#ffb84d", // オレンジ
  "#b84dff", // 紫
  "#ffd24d"  // 黄
];

// ---- 自動同期設定 ----
const AUTO_SYNC = true;
const AUTO_SYNC_INTERVAL_MS = 60 * 1000; // 60秒ごと（必要なら 120000 に）

// ====== ユーティリティ ======
const qs  = (s, el=document) => el.querySelector(s);
const qsa = (s, el=document) => [...el.querySelectorAll(s)];
const fmtJPY = (n) => (Math.round(n)||0).toLocaleString("ja-JP");

// ローカル I/O
function loadRecords() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}
function saveRecords(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}
function loadDeletedIds(){
  try { return JSON.parse(localStorage.getItem(DELETED_KEY) || "[]"); }
  catch { return []; }
}
function saveDeletedIds(arr){
  localStorage.setItem(DELETED_KEY, JSON.stringify(arr));
}

// 9/12〜9/22の配列
function buildFixedDates() {
  const dates = [];
  const start = new Date(TRIP_YEAR, 8, 12); // 8 = 9月
  const end   = new Date(TRIP_YEAR, 8, 22);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) {
    const y = d.getFullYear();
    const m = d.getMonth()+1;
    const day = d.getDate();
    const label = `${m}/${day}`;
    const iso = `${y}-${String(m).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    dates.push({ label, iso });
  }
  return dates;
}

// ====== 状態 ======
let state = {
  selectedDate: null,
  selectedType: null,
  records: loadRecords(),
  chart: null,
};
let isUserTyping = false; // 入力中は自動同期を止める

// ====== 初期化 ======
document.addEventListener("DOMContentLoaded", () => {
  renderDateTabs();
  renderTypeButtons();
  initRate();
  attachEvents();
  initCloudButtons(); // クラウドボタン
  loadGapiAndGis();   // Google SDK
  syncUI();
});

// ====== UI構築 ======
function renderDateTabs() {
  const wrap = qs("#dateTabs");
  wrap.innerHTML = "";
  const dates = buildFixedDates();
  dates.forEach((d, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill";
    btn.textContent = d.label;
    btn.setAttribute("data-iso", d.iso);
    btn.addEventListener("click", () => {
      state.selectedDate = d.iso;
      highlightDateTab(d.iso);
    });
    wrap.appendChild(btn);
    if (i === 0) state.selectedDate = d.iso;
  });
  highlightDateTab(state.selectedDate);
}
function highlightDateTab(iso) {
  qsa("#dateTabs .pill").forEach(b => {
    b.classList.toggle("active", b.getAttribute("data-iso") === iso);
  });
}

function renderTypeButtons() {
  const wrap = qs("#typeButtons");
  wrap.innerHTML = "";
  CATEGORIES.forEach(cat => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill";
    btn.textContent = cat;
    btn.addEventListener("click", () => {
      state.selectedType = cat;
      highlightType(cat);
    });
    wrap.appendChild(btn);
  });
}
function highlightType(cat) {
  qsa("#typeButtons .pill").forEach(b => {
    b.classList.toggle("active", b.textContent === cat);
  });
}
function initRate() {
  const eurRateInput = qs("#eurRateInput");
  const eff = qs("#effectiveRate");
  const updateEff = () => {
    const base = parseFloat(eurRateInput.value || "0");
    const effVal = base * 1.022; // 指定倍率
    eff.textContent = isFinite(effVal) ? effVal.toFixed(2) : "0";
    const eur = parseFloat(qs("#amountEUR").value || "0");
    if (eur > 0) qs("#amountJPY").value = Math.round(eur * effVal);
  };
  eurRateInput.addEventListener("input", updateEff);
  updateEff();
}

// ====== 入出力 ======
function attachEvents() {
  qs("#amountEUR").addEventListener("input", () => {
    const eur = parseFloat(qs("#amountEUR").value || "0");
    const effVal = parseFloat(qs("#effectiveRate").textContent || "0");
    if (eur > 0 && effVal > 0) qs("#amountJPY").value = Math.round(eur * effVal);
  });
  qs("#saveBtn").addEventListener("click", onSave);

  // 入力中フラグ（入力欄にフォーカスがある間は自動同期を止める）
  ["#amountJPY", "#amountEUR", "#detail"].forEach(sel => {
    const el = qs(sel);
    el.addEventListener("focus", () => { isUserTyping = true; });
    el.addEventListener("blur",  () => { isUserTyping = false; });
  });
}

function toast(msg, ok=true){
  const el = qs("#toast");
  el.textContent = msg;
  el.style.color = ok ? "#0a2a45" : "#b00020";
  el.classList.add("show");
  setTimeout(()=> el.classList.remove("show"), 1800);
}

// ====== 保存 ======
function onSave() {
  const date = state.selectedDate;
  const type = state.selectedType;
  const amountJPY = Math.round(parseFloat(qs("#amountJPY").value || "0"));
  const amountEUR = parseFloat(qs("#amountEUR").value || "0");
  const eurRate   = parseFloat(qs("#eurRateInput").value || "0");
  const detail    = qs("#detail").value.trim();

  if (!date)  return toast("日付を選択してください", false);
  if (!type)  return toast("種類を選択してください", false);
  if (!amountJPY && !amountEUR) return toast("円またはユーロの金額を入力してください", false);

  let finalJPY = amountJPY;
  if (!finalJPY && amountEUR) {
    const effVal = eurRate * 1.022;
    finalJPY = Math.round(amountEUR * effVal);
  }

  const rec = {
    id: crypto.randomUUID(),
    date, type,
    amountJPY: finalJPY,
    amountEUR: amountEUR || null,
    eurRate: eurRate || null,
    eurMarkup: 1.022,
    detail,
    createdAt: Date.now()
  };

  // 先にローカル保存（キャンセルしても残る）
  state.records.unshift(rec);
  saveRecords(state.records);

  // 未ログインなら、この“クリック”をトリガーに同意ダイアログ→成功後に保存
  (async () => {
    try {
      if (!authed) {
        cloudToast("Googleにサインインしています…");
        await ensureSignedIn("consent"); // ★ 保存クリック起因なのでポップアップOK
      }
      await appendRecordToSheet(rec);
      cloudToast("Sheetsに保存しました");
      // 好みで双方向同期したい場合は次行を有効化
      // await twoWaySync();
    } catch (e) {
      cloudToast("クラウド保存できませんでした（ローカルには保存済み）", false);
      console.error(e);
    }
  })();

  // 入力クリア（種類と日付は保持）
  qs("#amountJPY").value = "";
  qs("#amountEUR").value = "";
  qs("#detail").value = "";

  toast("保存しました");
  syncUI();
}

// ====== 表示 ======
function syncUI() {
  renderList();
  renderStatsAndChart();
}

function renderList() {
  const list = qs("#recordList");
  list.innerHTML = "";

  if (!state.records.length) {
    qs("#emptyState").style.display = "block";
    return;
  }
  qs("#emptyState").style.display = "none";

  state.records.forEach(rec => {
    const li = document.createElement("li");
    li.className = "record";
    li.setAttribute("data-id", rec.id);

    const date = document.createElement("div");
    date.className = "date";
    date.textContent = toDisplayDate(rec.date);

    const mid = document.createElement("div");
    const title = document.createElement("div");
    title.innerHTML = `<strong>${rec.type}</strong> <span class="meta">${rec.detail || ""}</span>`;
    mid.appendChild(title);

    const amt = document.createElement("div");
    amt.className = "amount";
    amt.textContent = `${fmtJPY(rec.amountJPY)} 円`;

    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "削除";
    del.addEventListener("click", async () => {
      if (!confirm("この記録を削除しますか？")) return;

      try {
        // ① 削除IDをキューへ（復活防止の肝）
        const deleted = loadDeletedIds();
        deleted.push(rec.id);
        saveDeletedIds([...new Set(deleted)]);

        // ② ローカルから削除
        state.records = state.records.filter(r => r.id !== rec.id);
        saveRecords(state.records);
        syncUI();

        // ③ サインイン済みなら双方向同期でクラウドにも反映
        if (authed) {
          if (tokenClient) { try { tokenClient.requestAccessToken({ prompt: '' }); } catch {} }
          await twoWaySync();
          cloudToast("Sheetsからも削除しました");
        }
      } catch (err) {
        cloudToast("削除同期失敗: " + (err.message || err), false);
        console.error(err);
      }
    });

    li.appendChild(date);
    li.appendChild(mid);
    li.appendChild(amt);
    li.appendChild(del);
    list.appendChild(li);
  });
}

function toDisplayDate(iso){
  const [y,m,d] = iso.split("-").map(Number);
  return `${m}/${d}`;
}

function renderStatsAndChart() {
  const sumByCat = Object.fromEntries(CATEGORIES.map(c => [c, 0]));
  let total = 0;
  state.records.forEach(r => {
    sumByCat[r.type] += r.amountJPY;
    total += r.amountJPY;
  });
  const remain = Math.max(0, BUDGET_JPY - total);

  qs("#spentAmount").textContent = fmtJPY(total);
  qs("#remainAmount").textContent = fmtJPY(remain);

  const data = CATEGORIES.map(c => sumByCat[c]);
  const ctx = qs("#pieChart").getContext("2d");

  if (state.chart) {
    state.chart.data.datasets[0].data = data;
    state.chart.update();
  } else {
    state.chart = new Chart(ctx, {
      type: "doughnut",
      data: { labels: CATEGORIES, datasets: [{ data, backgroundColor: COLORS, borderWidth: 0 }] },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (item) => `${item.label}: ${fmtJPY(item.raw)} 円` } }
        },
        cutout: "62%"
      }
    });
  }

  const legend = qs("#chartLegend");
  legend.innerHTML = "";
  CATEGORIES.forEach((c, i) => {
    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = `<span class="dot" style="background:${COLORS[i]}"></span> ${c}：<strong>${fmtJPY(sumByCat[c])}</strong>円`;
    legend.appendChild(item);
  });
}

// ====== Google Sheets 連携 ======
const GSHEETS = {
  API_KEY: "AIzaSyCl16O5UWCsDdNB3o2M8m4osCj5TlatXX0",
  CLIENT_ID: "217890720524-tgpuqqv60m8pv1t3evn17a15d52jsrki.apps.googleusercontent.com",
  SPREADSHEET_ID: "11GyzKABbLvZ54uy7XfwwUPCNcoPMAn0PB_mzdxZ0tm4",
  DISCOVERY_DOC: "https://sheets.googleapis.com/$discovery/rest?version=v4",
  SCOPE: "https://www.googleapis.com/auth/spreadsheets"
};
let gapiInited = false;
let gisInited = false;
let tokenClient = null;
let authed = false;
let tokenRefreshTimer = null;
let autoSyncTimer = null;

// トースト（クラウド用）
function cloudToast(msg, ok=true){
  const el = qs("#cloudToast");
  if (!el) return;
  el.textContent = msg;
  el.style.color = ok ? "#0a2a45" : "#b00020";
  el.classList.add("show");
  setTimeout(()=> el.classList.remove("show"), 2200);
}
function setCloudButtons(){
  const signin  = qs("#signinBtn");
  const signout = qs("#signoutBtn");
  const syncBtn = qs("#syncBtn");
  if (signin)  signin.disabled  = !(gapiInited && gisInited) || authed;
  if (signout) signout.disabled = !authed;
  if (syncBtn) syncBtn.disabled = !authed;
}
function initCloudButtons(){
  const signin  = qs("#signinBtn");
  const signout = qs("#signoutBtn");
  const syncBtn = qs("#syncBtn");
  if (signin)  signin.addEventListener("click", handleAuthClick);
  if (signout) signout.addEventListener("click", handleSignoutClick);
  if (syncBtn) syncBtn.addEventListener("click", handleSyncClick);
  setCloudButtons();
}

// トークン自動延長
function startTokenAutoRefresh(){
  if (tokenRefreshTimer) clearInterval(tokenRefreshTimer);
  tokenRefreshTimer = setInterval(() => {
    if (!tokenClient || !authed) return;
    try { tokenClient.requestAccessToken({ prompt: '' }); } catch {}
  }, 45 * 60 * 1000);
}
function trySilentSignIn() {
  if (!tokenClient || authed) return;
  try { tokenClient.requestAccessToken({ prompt: '' }); } catch {}
}

// 自動同期
function startAutoSync(){
  if (!AUTO_SYNC) return;
  stopAutoSync();
  autoSyncTimer = setInterval(async () => {
    if (!authed) return;
    if (isUserTyping) return; // 入力中は同期しない
    if (document.visibilityState !== 'visible') return;
    if (!navigator.onLine) return;
    try {
      if (tokenClient) { try { tokenClient.requestAccessToken({ prompt: '' }); } catch {} }
      await twoWaySync();
      cloudToast("自動同期しました");
    } catch (e) {
      console.debug("auto sync failed:", e?.message || e);
    }
  }, AUTO_SYNC_INTERVAL_MS);
}
function stopAutoSync(){
  if (autoSyncTimer) clearInterval(autoSyncTimer);
  autoSyncTimer = null;
}

// SDK読み込み
function loadGapiAndGis(){
  // gapi.js の準備待ち
  const waitGapi = new Promise((res)=>{
    const t = setInterval(()=>{
      if (window.gapi && window.gapi.load) {
        clearInterval(t);
        gapi.load("client", async ()=>{
          await gapi.client.init({ apiKey: GSHEETS.API_KEY, discoveryDocs: [GSHEETS.DISCOVERY_DOC] });
          gapiInited = true;
          setCloudButtons();
          res();
        });
      }
    }, 100);
  });

  // GIS の準備待ち
  const waitGIS = new Promise((res)=>{
    const t = setInterval(()=>{
      if (window.google && window.google.accounts && window.google.accounts.oauth2) {
        clearInterval(t);
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: GSHEETS.CLIENT_ID,
          scope: GSHEETS.SCOPE,
          callback: (response) => {
            if (response && response.access_token) {
              authed = true;
              setCloudButtons();
              cloudToast("サインインしました");
              startTokenAutoRefresh();
              // 起動直後：取り込み→双方向同期→自動同期開始
              loadAllFromSheet(true).catch(err=> cloudToast("Sheets読込失敗: " + err.message, false));
              twoWaySync().catch(()=>{});
              startAutoSync();
            }
          },
        });
        gisInited = true;
        setCloudButtons();
        res();
      }
    }, 100);
  });

  Promise.all([waitGapi, waitGIS]).then(()=>{
    setCloudButtons();
    trySilentSignIn(); // 起動時に静かに再認可
    // 画面復帰・オンライン復帰でも同期
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' && authed && !isUserTyping) {
        try {
          if (tokenClient) { try { tokenClient.requestAccessToken({ prompt: '' }); } catch {} }
          await twoWaySync();
          cloudToast("再表示で同期しました");
        } catch {}
      }
    });
    window.addEventListener('online', async () => {
      if (authed && !isUserTyping) {
        try { await twoWaySync(); cloudToast("オンライン復帰で同期しました"); } catch {}
      }
    });
  });
}

function handleAuthClick(){ if (tokenClient) tokenClient.requestAccessToken({ prompt: "consent" }); }
function handleSignoutClick(){
  authed = false;
  setCloudButtons();
  stopAutoSync();
  cloudToast("サインアウトしました");
}

// ★ 保存時に使う：ユーザー操作起因でサインインを約束チェーンにする
async function ensureSignedIn(promptMode = "consent") {
  if (authed) return;
  if (!tokenClient) throw new Error("認証クライアントの初期化前です");
  const originalCb = tokenClient.callback;
  const signedIn = new Promise((resolve, reject) => {
    tokenClient.callback = (resp) => {
      try {
        if (resp && resp.access_token) {
          authed = true;
          setCloudButtons();
          cloudToast("サインインしました");
          // 元のcallbackにも渡す（初期同期や自動同期の起動を維持）
          try { originalCb && originalCb(resp); } catch {}
          resolve();
        } else {
          reject(new Error("アクセストークン取得に失敗"));
        }
      } finally {
        tokenClient.callback = originalCb; // もとに戻す
      }
    };
  });
  tokenClient.requestAccessToken({ prompt: promptMode });
  await signedIn;
}

// 手動「今すぐ同期」→ 双方向同期
async function handleSyncClick(){
  try {
    if (!authed) {
      await ensureSignedIn("consent"); // 手動同期時も未ログインなら同意→同期
    }
    if (tokenClient) { try { tokenClient.requestAccessToken({ prompt: '' }); } catch {} }
    await twoWaySync();
    cloudToast("Sheetsと双方向同期しました");
  } catch(e){
    cloudToast("同期失敗: " + (e.message || e), false);
    console.error(e);
  }
}

// ====== 双方向同期ロジック ======
async function twoWaySync() {
  ensureAuthed();

  // 1) Sheets全件取得（ローカル非破壊）
  const sheetRecords = await fetchAllFromSheet();

  // 2) 削除キュー適用（この端末で削除済IDは最優先で除去）
  const deletedIds = new Set(loadDeletedIds());
  const sheetAfterDelete = sheetRecords.filter(r => !deletedIds.has(r.id));

  // 3) ローカルとマージ（idの和集合）／同一idは createdAt 新しい方
  const mergedMap = new Map();
  sheetAfterDelete.forEach(r => mergedMap.set(r.id, r));
  state.records.forEach(r => {
    const ex = mergedMap.get(r.id);
    if (!ex || (r.createdAt || 0) > (ex.createdAt || 0)) mergedMap.set(r.id, r);
  });

  // 4) マージ結果を配列化・降順
  const merged = Array.from(mergedMap.values()).sort((a,b)=> (b.createdAt||0) - (a.createdAt||0));

  // 5) Sheetsをマージ結果で上書き → ローカル更新 → 削除キュークリア
  state.records = merged;
  saveRecords(state.records);
  await pushAllToSheet();
  saveDeletedIds([]); // ← ここで空にする（復活防止）
  syncUI();
}

// ローカルを触らずSheets全件を配列で取得
async function fetchAllFromSheet() {
  ensureAuthed();
  const res = await gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId: GSHEETS.SPREADSHEET_ID,
    range: "Sheet1!A1:Z100000"
  });
  const rows = res.result.values || [];
  if (!rows.length) return [];
  let start = 0;
  if (rows[0][0] === "id") start = 1;

  return rows.slice(start).map(r => ({
    id: r[0],
    date: r[1],
    type: r[2],
    amountJPY: Number(r[3]||0),
    amountEUR: r[4] ? Number(r[4]) : null,
    eurRate:  r[5] ? Number(r[5]) : null,
    eurMarkup:r[6] ? Number(r[6]) : null,
    detail:   r[7] || "",
    createdAt:r[8] ? Number(r[8]) : 0
  })).filter(x => x.id);
}

// ====== Sheets I/O（上書き保存・読み込み・初期化） ======
async function appendRecordToSheet(rec){
  ensureAuthed();
  const values = [[
    rec.id, rec.date, rec.type, rec.amountJPY, rec.amountEUR ?? "",
    rec.eurRate ?? "", rec.eurMarkup ?? "", rec.detail ?? "", rec.createdAt
  ]];
  return gapi.client.sheets.spreadsheets.values.append({
    spreadsheetId: GSHEETS.SPREADSHEET_ID,
    range: "Sheet1!A1",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    resource: { values }
  });
}

async function loadAllFromSheet(replaceLocal=false){
  ensureAuthed();
  const res = await gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId: GSHEETS.SPREADSHEET_ID,
    range: "Sheet1!A1:Z100000"
  });
  const rows = res.result.values || [];
  if (!rows.length) { await ensureHeaderRow(); return; }
  let start = 0;
  if (rows[0][0] === "id") start = 1;
  const recs = rows.slice(start).map(r => ({
    id: r[0], date: r[1], type: r[2],
    amountJPY: Number(r[3]||0), amountEUR: r[4] ? Number(r[4]) : null,
    eurRate: r[5] ? Number(r[5]) : null, eurMarkup: r[6] ? Number(r[6]) : null,
    detail: r[7] || "", createdAt: r[8] ? Number(r[8]) : Date.now()
  })).filter(x => x.id);

  if (recs.length && replaceLocal) {
    state.records = recs.sort((a,b)=> (b.createdAt||0) - (a.createdAt||0));
    saveRecords(state.records);
    syncUI();
  } else if (!recs.length) {
    await ensureHeaderRow();
  }
}

async function pushAllToSheet(){
  ensureAuthed();
  await clearSheet();
  await ensureHeaderRow();
  if (!state.records.length) return;
  const values = state.records.slice().reverse().map(rec => [
    rec.id, rec.date, rec.type,
    rec.amountJPY, rec.amountEUR ?? "",
    rec.eurRate ?? "", rec.eurMarkup ?? "",
    rec.detail ?? "", rec.createdAt
  ]);
  return gapi.client.sheets.spreadsheets.values.append({
    spreadsheetId: GSHEETS.SPREADSHEET_ID,
    range: "Sheet1!A1",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    resource: { values }
  });
}

async function ensureHeaderRow(){
  const header = [["id","date","type","amountJPY","amountEUR","eurRate","eurMarkup","detail","createdAt"]];
  return gapi.client.sheets.spreadsheets.values.update({
    spreadsheetId: GSHEETS.SPREADSHEET_ID,
    range: "Sheet1!A1:I1",
    valueInputOption: "RAW",
    resource: { values: header }
  });
}
async function clearSheet(){
  return gapi.client.sheets.spreadsheets.values.clear({
    spreadsheetId: GSHEETS.SPREADSHEET_ID,
    range: "Sheet1!A:Z"
  });
}

function ensureAuthed(){ if (!authed) throw new Error("サインインしていません"); }
