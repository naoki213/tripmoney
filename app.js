// ====== 設定 ======
const TRIP_YEAR = 2025;
const BUDGET_JPY = 800000;
const STORAGE_KEY = "trip-budget-records-v1";

const CATEGORIES = [
  "宿泊費","交通費","食費","観光代","土産代","その他"
];

// 円グラフ配色（視認性重視）
const COLORS = [
  "#ff4d4d", // 赤
  "#4d79ff", // 青
  "#4dff4d", // 緑
  "#ffb84d", // オレンジ
  "#b84dff", // 紫
  "#ffd24d"  // 黄
];

// ====== ユーティリティ ======
const qs  = (s, el=document) => el.querySelector(s);
const qsa = (s, el=document) => [...el.querySelectorAll(s)];
const fmtJPY = (n) => (Math.round(n)||0).toLocaleString("ja-JP");

// 9/12〜9/22の配列を作る
function buildFixedDates() {
  const dates = [];
  const start = new Date(TRIP_YEAR, 8, 12); // 月は0始まり: 8=9月
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

// ストレージ
function loadRecords() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}
function saveRecords(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

// ====== 状態 ======
let state = {
  selectedDate: null,
  selectedType: null,
  records: loadRecords(),
  chart: null,
};

// ====== 初期化（※1回だけ） ======
document.addEventListener("DOMContentLoaded", () => {
  renderDateTabs();
  renderTypeButtons();
  initRate();
  attachEvents();
  initCloudButtons();   // Google Sheets 連携ボタン
  loadGapiAndGis();     // Google SDK ロード
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
    if (i === 0) state.selectedDate = d.iso; // 初期選択は最初の日
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
    const effVal = base * 1.022; // ← 指定倍率
    eff.textContent = isFinite(effVal) ? effVal.toFixed(2) : "0";
    // EUR入力→JPY自動変換
    const eur = parseFloat(qs("#amountEUR").value || "0");
    if (eur > 0) {
      qs("#amountJPY").value = Math.round(eur * effVal);
    }
  };
  eurRateInput.addEventListener("input", updateEff);
  updateEff();
}

// ====== イベント ======
function attachEvents() {
  qs("#amountEUR").addEventListener("input", () => {
    const eur = parseFloat(qs("#amountEUR").value || "0");
    const effVal = parseFloat(qs("#effectiveRate").textContent || "0");
    if (eur > 0 && effVal > 0) {
      qs("#amountJPY").value = Math.round(eur * effVal);
    }
  });

  qs("#saveBtn").addEventListener("click", onSave);
}

function toast(msg, ok=true){
  const el = qs("#toast");
  el.textContent = msg;
  el.style.color = ok ? "#0a2a45" : "#b00020";
  el.classList.add("show");
  setTimeout(()=> el.classList.remove("show"), 1800);
}

// ====== 保存処理（※この関数は1つだけ） ======
function onSave() {
  const date      = state.selectedDate;
  const type      = state.selectedType;
  const amountJPY = Math.round(parseFloat(qs("#amountJPY").value || "0"));
  const amountEUR = parseFloat(qs("#amountEUR").value || "0");
  const eurRate   = parseFloat(qs("#eurRateInput").value || "0");
  const detail    = qs("#detail").value.trim();

  if (!date) { toast("日付を選択してください", false); return; }
  if (!type) { toast("種類を選択してください", false); return; }
  if (!amountJPY && !amountEUR) { toast("円またはユーロの金額を入力してください", false); return; }

  let finalJPY = amountJPY;
  if (!finalJPY && amountEUR) {
    const effVal = eurRate * 1.022; // ← 指定倍率
    finalJPY = Math.round(amountEUR * effVal);
  }

  const rec = {
    id: crypto.randomUUID(),
    date,
    type,
    amountJPY: finalJPY,
    amountEUR: amountEUR || null,
    eurRate: eurRate || null,
    eurMarkup: 1.022,
    detail,
    createdAt: Date.now()
  };

  // 先にローカル保存
  state.records.unshift(rec);
  saveRecords(state.records);

  // サインイン済みなら Sheets にも自動保存
  if (authed) {
    appendRecordToSheet(rec).then(()=>{
      cloudToast("Sheetsに保存しました");
    }).catch(err=>{
      cloudToast("Sheets保存に失敗: " + err.message, false);
    });
  }

  // 入力クリア（種類と日付は保持）
  qs("#amountJPY").value = "";
  qs("#amountEUR").value = "";
  qs("#detail").value = "";

  toast("保存しました");
  syncUI();
}

// ====== 表示同期 ======
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
        // 1) サインイン済みなら、上書き前にクラウド最新を取り込む（他端末追加分を温存）
        if (authed) {
          // トークン延命ヘルパーを入れている人は次行を有効化
          // await ensureSignedIn();
          await loadAllFromSheet(true);
        }

        // 2) ローカルから1件削除
        state.records = state.records.filter(r => r.id !== rec.id);
        saveRecords(state.records);
        syncUI();

        // 3) サインイン済みなら、ローカル全件をSheetsへ上書き（＝削除反映）
        if (authed) {
          await pushAllToSheet();
          cloudToast("Sheetsからも削除しました");
        }
      } catch (err) {
        cloudToast("削除同期に失敗: " + (err.message || err), false);
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
  // 集計
  const sumByCat = Object.fromEntries(CATEGORIES.map(c => [c, 0]));
  let total = 0;
  state.records.forEach(r => {
    sumByCat[r.type] += r.amountJPY;
    total += r.amountJPY;
  });
  const remain = Math.max(0, BUDGET_JPY - total);

  qs("#spentAmount").textContent = fmtJPY(total);
  qs("#remainAmount").textContent = fmtJPY(remain);

  // グラフ
  const data = CATEGORIES.map(c => sumByCat[c]);
  const ctx = qs("#pieChart").getContext("2d");

  if (state.chart) {
    state.chart.data.datasets[0].data = data;
    state.chart.update();
  } else {
    state.chart = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: CATEGORIES,
        datasets: [{
          data,
          backgroundColor: COLORS,
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (item) => {
                const label = item.label || "";
                const val = item.raw || 0;
                return `${label}: ${fmtJPY(val)} 円`;
              }
            }
          }
        },
        cutout: "62%"
      }
    });
  }

  // 凡例
  const legend = qs("#chartLegend");
  legend.innerHTML = "";
  CATEGORIES.forEach((c, i) => {
    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = `<span class="dot" style="background:${COLORS[i]}"></span> ${c}：<strong>${fmtJPY(sumByCat[c])}</strong>円`;
    legend.appendChild(item);
  });
}

// ====== Google Sheets 連携設定 ======
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
let authed = false; // サインイン状態

// ====== クラウド（Sheets）関連 ======
function initCloudButtons(){
  const signin  = qs("#signinBtn");
  const signout = qs("#signoutBtn");
  const syncBtn = qs("#syncBtn");
  if (signin)  signin.addEventListener("click", handleAuthClick);
  if (signout) signout.addEventListener("click", handleSignoutClick);
  if (syncBtn) syncBtn.addEventListener("click", handleSyncClick);
  setCloudButtons();
}

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

// gapi & GIS を読み込み（scriptタグは index.html で読み込むこと）
function loadGapiAndGis(){
  // gapi.js の準備待ち
  const waitGapi = new Promise((res)=>{
    const t = setInterval(()=>{
      if (window.gapi && window.gapi.load) {
        clearInterval(t);
        gapi.load("client", async ()=>{
          await gapi.client.init({
            apiKey: GSHEETS.API_KEY,
            discoveryDocs: [GSHEETS.DISCOVERY_DOC],
          });
          gapiInited = true;
          setCloudButtons();
          res();
        });
      }
    }, 100);
  });

  // Google Identity Services の準備待ち
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
              // 初回サインイン時にクラウド→ローカル取り込み
              loadAllFromSheet(true).catch(err=>{
                cloudToast("Sheets読込に失敗: " + err.message, false);
              });
            }
          },
        });
        gisInited = true;
        setCloudButtons();
        res();
      }
    }, 100);
  });

  Promise.all([waitGapi, waitGIS]).then(()=> setCloudButtons());
}

function handleAuthClick(){
  if (!tokenClient) return;
  tokenClient.requestAccessToken({ prompt: "consent" });
}

function handleSignoutClick(){
  authed = false; // 単純化：ページ更新で完全リセットでもOK
  setCloudButtons();
  cloudToast("サインアウトしました");
}

async function handleSyncClick(){
  try {
    await pushAllToSheet();
    cloudToast("Sheetsに同期しました");
  } catch(e){
    cloudToast("同期失敗: " + (e.message || e.statusText || e), false);
    console.error(e);
  }
}

// 1レコードを末尾に追加
async function appendRecordToSheet(rec){
  ensureAuthed();
  const values = [[
    rec.id, rec.date, rec.type,
    rec.amountJPY, rec.amountEUR ?? "",
    rec.eurRate ?? "", rec.eurMarkup ?? "",
    rec.detail ?? "", rec.createdAt
  ]];
  return gapi.client.sheets.spreadsheets.values.append({
    spreadsheetId: GSHEETS.SPREADSHEET_ID,
    range: "Sheet1!A1",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    resource: { values }
  });
}

// シート全体を読み込んで state.records を置き換え（replaceLocal=trueで置換）
async function loadAllFromSheet(replaceLocal=false){
  ensureAuthed();
  const res = await gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId: GSHEETS.SPREADSHEET_ID,
    range: "Sheet1!A1:Z100000"
  });

  const rows = res.result.values || [];
  if (!rows.length) {
    await ensureHeaderRow();
    return;
  }

  // 1行目がヘッダーかどうか判定
  let start = 0;
  if (rows[0] && rows[0][0] === "id") start = 1;

  const recs = rows.slice(start).map(r => ({
    id: r[0],
    date: r[1],
    type: r[2],
    amountJPY: Number(r[3]||0),
    amountEUR: r[4] ? Number(r[4]) : null,
    eurRate:  r[5] ? Number(r[5]) : null,
    eurMarkup:r[6] ? Number(r[6]) : null,
    detail:   r[7] || "",
    createdAt:r[8] ? Number(r[8]) : Date.now()
  })).filter(x => x.id);

  if (recs.length){
    if (replaceLocal) {
      state.records = recs.sort((a,b)=> b.createdAt - a.createdAt);
      saveRecords(state.records);
      syncUI();
    }
  } else {
    await ensureHeaderRow();
  }
}

// ローカル全件をシートに反映（ヘッダー作成→本体一括書込）
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

function ensureAuthed(){
  if (!authed) throw new Error("サインインしていません");
}
