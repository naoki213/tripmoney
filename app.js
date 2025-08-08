// ====== 設定 ======
const TRIP_YEAR = 2025;
const BUDGET_JPY = 800000;
const STORAGE_KEY = "trip-budget-records-v1";

const CATEGORIES = [
  "宿泊費","交通費","食費","観光代","土産代","その他"
];

// 円グラフ用の配色（淡い青系を中心に）
const COLORS = [
  "#8ec9ff","#6bb6ff","#49a3ff","#2f92fb","#89a7ff","#a8ccff"
];

// ====== ユーティリティ ======
const qs = (s, el=document) => el.querySelector(s);
const qsa = (s, el=document) => [...el.querySelectorAll(s)];
const fmtJPY = (n) => (Math.round(n)||0).toLocaleString("ja-JP");

// 9/12〜9/22の配列を作る
function buildFixedDates() {
  const dates = [];
  const start = new Date(TRIP_YEAR, 8, 12); // 月は0始まり: 8=9月
  const end = new Date(TRIP_YEAR, 8, 22);
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
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
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

// ====== 初期化 ======
document.addEventListener("DOMContentLoaded", () => {
  renderDateTabs();
  renderTypeButtons();
  initRate();
  attachEvents();
  syncUI();
});

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
    if (i === 0) { // 初期選択は最初の日
      state.selectedDate = d.iso;
    }
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
    const effVal = base * 1.05;
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

function onSave() {
  const date = state.selectedDate;
  const type = state.selectedType;
  const amountJPY = Math.round(parseFloat(qs("#amountJPY").value || "0"));
  const amountEUR = parseFloat(qs("#amountEUR").value || "0");
  const eurRate = parseFloat(qs("#eurRateInput").value || "0");
  const detail = qs("#detail").value.trim();

  if (!date) { toast("日付を選択してください", false); return; }
  if (!type) { toast("種類を選択してください", false); return; }
  if (!amountJPY && !amountEUR) { toast("円またはユーロの金額を入力してください", false); return; }

  let finalJPY = amountJPY;
  if (!finalJPY && amountEUR) {
    const effVal = eurRate * 1.05;
    finalJPY = Math.round(amountEUR * effVal);
  }

  const rec = {
    id: crypto.randomUUID(),
    date,
    type,
    amountJPY: finalJPY,
    amountEUR: amountEUR || null,
    eurRate: eurRate || null,
    eurMarkup: 1.05,
    detail,
    createdAt: Date.now()
  };

  state.records.unshift(rec);
  saveRecords(state.records);
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
    del.addEventListener("click", () => {
      if (confirm("この記録を削除しますか？")) {
        state.records = state.records.filter(r => r.id !== rec.id);
        saveRecords(state.records);
        syncUI();
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
