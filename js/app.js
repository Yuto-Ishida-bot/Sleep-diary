/* ==========================================================
   睡眠・活動ダイアリー - app.js
   すべてのデータは端末内 localStorage に保存される(サーバー送信なし)
   ========================================================== */

const STORAGE_KEY = "sleepDiary.entries.v1";
const ACTIVITY_TYPES = ["仕事/学業", "運動", "家事", "外出/趣味", "休憩/くつろぎ", "その他"];

let entries = loadEntries();
let editingId = null;      // 編集中のエントリID (nullなら新規)
let activityRows = [];     // フォーム上の一時的な活動行 [{type, minutes}]
let currentCorrPair = "sleep_fatigue";

/* ---------------- ユーティリティ ---------------- */

function loadEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error("読み込み失敗", e);
    return [];
  }
}

function saveEntries() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function uuid() {
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function timeToMinutes(t) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function computeSleepHours(bedtime, waketime) {
  const b = timeToMinutes(bedtime);
  const w = timeToMinutes(waketime);
  if (b === null || w === null) return null;
  let diff = w - b;
  if (diff <= 0) diff += 24 * 60; // 日をまたぐ場合
  return Math.round((diff / 60) * 10) / 10;
}

function fmtDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]})`;
}

function totalActivityMinutes(entry) {
  return (entry.activities || []).reduce((s, a) => s + (Number(a.minutes) || 0), 0);
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove("show"), 1800);
}

/* ---------------- タブ切り替え ---------------- */

function initTabs() {
  const navBtns = document.querySelectorAll(".nav-btn");
  navBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      navBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      document.getElementById(btn.dataset.tab).classList.add("active");
      if (btn.dataset.tab === "tab-history") renderHistory();
      if (btn.dataset.tab === "tab-analysis") renderAnalysis();
    });
  });
}

/* ---------------- スケールボタン(疲労度・体調) ---------------- */

function initScaleButtons() {
  document.querySelectorAll(".scale").forEach((group) => {
    group.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        group.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        group.dataset.value = btn.dataset.val;
      });
    });
  });
}

function getScaleValue(targetId) {
  const group = document.querySelector(`.scale[data-target="${targetId}"]`);
  return group && group.dataset.value ? Number(group.dataset.value) : null;
}

function setScaleValue(targetId, value) {
  const group = document.querySelector(`.scale[data-target="${targetId}"]`);
  if (!group) return;
  group.dataset.value = value ?? "";
  group.querySelectorAll("button").forEach((b) => {
    b.classList.toggle("active", Number(b.dataset.val) === Number(value));
  });
}

/* ---------------- 活動行(動的追加) ---------------- */

function renderActivityRows() {
  const wrap = document.getElementById("activityList");
  wrap.innerHTML = "";
  activityRows.forEach((row, idx) => {
    const div = document.createElement("div");
    div.className = "activity-row";

    const select = document.createElement("select");
    ACTIVITY_TYPES.forEach((type) => {
      const opt = document.createElement("option");
      opt.value = type;
      opt.textContent = type;
      if (row.type === type) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener("change", (e) => { row.type = e.target.value; });

    const minInput = document.createElement("input");
    minInput.type = "number";
    minInput.min = "0";
    minInput.step = "5";
    minInput.placeholder = "分";
    minInput.value = row.minutes ?? "";
    minInput.addEventListener("input", (e) => { row.minutes = e.target.value; });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "icon-btn";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", () => {
      activityRows.splice(idx, 1);
      renderActivityRows();
    });

    div.appendChild(select);
    div.appendChild(minInput);
    div.appendChild(delBtn);
    wrap.appendChild(div);
  });
}

function addActivityRow(type, minutes) {
  activityRows.push({ type: type || ACTIVITY_TYPES[0], minutes: minutes ?? "" });
  renderActivityRows();
}

/* ---------------- フォーム: 保存 / リセット / 編集読み込み ---------------- */

function resetForm() {
  editingId = null;
  document.getElementById("entryForm").reset();
  document.getElementById("f-date").value = todayStr();
  setScaleValue("f-fatigue", null);
  setScaleValue("f-condition", null);
  setScaleValue("f-medtaken", null);
  document.getElementById("medNameField").style.display = "none";
  document.getElementById("f-medname").value = "";
  setStarUI(false);
  activityRows = [];
  renderActivityRows();
  document.getElementById("saveBtn").textContent = "この日の記録を保存";
}

function loadEntryIntoForm(entry) {
  editingId = entry.id;
  document.getElementById("f-date").value = entry.date;
  document.getElementById("f-bedtime").value = entry.bedtime || "";
  document.getElementById("f-waketime").value = entry.waketime || "";
  document.getElementById("f-sleephours").value = entry.sleepHours ?? "";
  setScaleValue("f-fatigue", entry.fatigue);
  setScaleValue("f-condition", entry.condition);
  setScaleValue("f-medtaken", entry.sleepMedTaken);
  document.getElementById("medNameField").style.display = entry.sleepMedTaken === 1 ? "block" : "none";
  document.getElementById("f-medname").value = entry.sleepMedName || "";
  setStarUI(!!entry.star);
  activityRows = (entry.activities || []).map((a) => ({ ...a }));
  renderActivityRows();
  document.getElementById("f-caffeine").value = entry.caffeine ?? "";
  document.getElementById("f-alcohol").value = entry.alcohol ?? "";
  document.getElementById("f-memo").value = entry.memo || "";
  document.getElementById("saveBtn").textContent = "更新を保存";
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
  document.querySelector('.nav-btn[data-tab="tab-record"]').classList.add("active");
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  document.getElementById("tab-record").classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setStarUI(active) {
  const btn = document.getElementById("starToggle");
  btn.dataset.active = active ? "true" : "false";
  btn.textContent = active ? "★" : "☆";
}

function initStarToggle() {
  const btn = document.getElementById("starToggle");
  btn.addEventListener("click", () => {
    setStarUI(btn.dataset.active !== "true");
  });
}

function initMedFields() {
  const group = document.querySelector('.scale[data-target="f-medtaken"]');
  const medNameField = document.getElementById("medNameField");
  group.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      medNameField.style.display = b.dataset.val === "1" ? "block" : "none";
    });
  });
}

function initSleepAutoCalc() {
  const bedtime = document.getElementById("f-bedtime");
  const waketime = document.getElementById("f-waketime");
  const sleepHours = document.getElementById("f-sleephours");
  function recalc() {
    const h = computeSleepHours(bedtime.value, waketime.value);
    if (h !== null) sleepHours.value = h;
  }
  bedtime.addEventListener("change", recalc);
  waketime.addEventListener("change", recalc);
}

function initForm() {
  document.getElementById("f-date").value = todayStr();
  document.getElementById("addActivityBtn").addEventListener("click", () => addActivityRow());

  document.getElementById("entryForm").addEventListener("submit", (e) => {
    e.preventDefault();

    const date = document.getElementById("f-date").value;
    if (!date) { showToast("日付を入力してください"); return; }

    const cleanActivities = activityRows
      .filter((a) => a.minutes !== "" && Number(a.minutes) > 0)
      .map((a) => ({ type: a.type, minutes: Number(a.minutes) }));

    const entry = {
      id: editingId || uuid(),
      date,
      bedtime: document.getElementById("f-bedtime").value || null,
      waketime: document.getElementById("f-waketime").value || null,
      sleepHours: document.getElementById("f-sleephours").value !== ""
        ? Number(document.getElementById("f-sleephours").value) : null,
      fatigue: getScaleValue("f-fatigue"),
      condition: getScaleValue("f-condition"),
      sleepMedTaken: getScaleValue("f-medtaken"),
      sleepMedName: getScaleValue("f-medtaken") === 1
        ? (document.getElementById("f-medname").value || "") : "",
      star: document.getElementById("starToggle").dataset.active === "true",
      activities: cleanActivities,
      caffeine: document.getElementById("f-caffeine").value !== ""
        ? Number(document.getElementById("f-caffeine").value) : 0,
      alcohol: document.getElementById("f-alcohol").value !== ""
        ? Number(document.getElementById("f-alcohol").value) : 0,
      memo: document.getElementById("f-memo").value || "",
    };

    // 同じ日付の既存記録があれば(新規保存時)上書き確認なしで統合
    const existingIdxByDate = entries.findIndex((e) => e.date === date && e.id !== entry.id);
    if (existingIdxByDate !== -1 && !editingId) {
      entries[existingIdxByDate] = entry;
      entry.id = entries[existingIdxByDate].id;
    } else {
      const idx = entries.findIndex((e) => e.id === entry.id);
      if (idx !== -1) entries[idx] = entry;
      else entries.push(entry);
    }

    entries.sort((a, b) => a.date.localeCompare(b.date));
    saveEntries();
    showToast("保存しました");
    resetForm();
  });
}

/* ---------------- 履歴タブ ---------------- */

function renderHistory() {
  const wrap = document.getElementById("historyList");
  wrap.innerHTML = "";

  if (entries.length === 0) {
    wrap.innerHTML = `<div class="empty-state">まだ記録がありません。<br>「記録」タブから最初の1件を追加しましょう。</div>`;
    return;
  }

  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));

  sorted.forEach((entry) => {
    const div = document.createElement("div");
    div.className = "entry-item";

    const badges = [];
    if (entry.sleepHours !== null && entry.sleepHours !== undefined) {
      badges.push(`<span class="badge">😴 ${entry.sleepHours}h</span>`);
    }
    if (entry.fatigue) badges.push(`<span class="badge">🔋疲労 ${entry.fatigue}/5</span>`);
    if (entry.condition) badges.push(`<span class="badge">❤ 体調 ${entry.condition}/5</span>`);
    const actMin = totalActivityMinutes(entry);
    if (actMin > 0) badges.push(`<span class="badge">🏃 ${actMin}分</span>`);
    if (entry.caffeine) badges.push(`<span class="badge">☕ ${entry.caffeine}杯</span>`);
    if (entry.alcohol) badges.push(`<span class="badge">🍺 ${entry.alcohol}杯</span>`);
    if (entry.sleepMedTaken === 1) badges.push(`<span class="badge">💊 ${escapeHtml(entry.sleepMedName || "内服")}</span>`);
    if (entry.star) badges.push(`<span class="badge star-badge">☆</span>`);

    div.innerHTML = `
      <div class="top">
        <span class="date">${fmtDate(entry.date)}</span>
      </div>
      <div class="badges">${badges.join("")}</div>
      ${entry.memo ? `<div style="font-size:12.5px;color:var(--text-dim);">${escapeHtml(entry.memo)}</div>` : ""}
      <div class="actions">
        <button data-action="edit" data-id="${entry.id}">編集</button>
        <button data-action="delete" data-id="${entry.id}">削除</button>
      </div>
    `;
    wrap.appendChild(div);
  });

  wrap.querySelectorAll('button[data-action="edit"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const entry = entries.find((e) => e.id === btn.dataset.id);
      if (entry) loadEntryIntoForm(entry);
    });
  });
  wrap.querySelectorAll('button[data-action="delete"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!confirm("この記録を削除しますか?")) return;
      entries = entries.filter((e) => e.id !== btn.dataset.id);
      saveEntries();
      renderHistory();
      showToast("削除しました");
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ---------------- エクスポート / インポート ---------------- */

function exportData() {
  if (entries.length === 0) { showToast("エクスポートする記録がありません"); return; }
  const payload = {
    app: "sleep-diary-pwa",
    version: 1,
    exportedAt: new Date().toISOString(),
    entries,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = todayStr();
  a.href = url;
  a.download = `sleep-diary-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("エクスポートしました");
}

function importDataFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const incoming = Array.isArray(data) ? data : data.entries;
      if (!Array.isArray(incoming)) throw new Error("形式が不正です");

      let added = 0, updated = 0;
      incoming.forEach((imp) => {
        if (!imp.date) return;
        const idx = entries.findIndex((e) => e.date === imp.date);
        const normalized = {
          id: (idx !== -1 ? entries[idx].id : imp.id) || uuid(),
          date: imp.date,
          bedtime: imp.bedtime ?? null,
          waketime: imp.waketime ?? null,
          sleepHours: imp.sleepHours ?? null,
          fatigue: imp.fatigue ?? null,
          condition: imp.condition ?? null,
          sleepMedTaken: imp.sleepMedTaken ?? null,
          sleepMedName: imp.sleepMedName || "",
          star: !!imp.star,
          activities: Array.isArray(imp.activities) ? imp.activities : [],
          caffeine: imp.caffeine ?? 0,
          alcohol: imp.alcohol ?? 0,
          memo: imp.memo || "",
        };
        if (idx !== -1) { entries[idx] = normalized; updated++; }
        else { entries.push(normalized); added++; }
      });

      entries.sort((a, b) => a.date.localeCompare(b.date));
      saveEntries();
      renderHistory();
      showToast(`インポート完了(新規${added}件・更新${updated}件)`);
    } catch (e) {
      console.error(e);
      showToast("インポートに失敗しました(ファイル形式を確認)");
    }
  };
  reader.readAsText(file);
}

function initBackup() {
  document.getElementById("exportBtn").addEventListener("click", exportData);
  const importBtn = document.getElementById("importBtn");
  const importFile = document.getElementById("importFile");
  importBtn.addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) importDataFromFile(file);
    importFile.value = "";
  });
}

/* ---------------- 分析タブ: 統計 ---------------- */

function average(arr) {
  const nums = arr.filter((v) => v !== null && v !== undefined && !isNaN(v));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function renderStats() {
  const grid = document.getElementById("statGrid");
  const sleepAvg = average(entries.map((e) => e.sleepHours));
  const fatigueAvg = average(entries.map((e) => e.fatigue));
  const conditionAvg = average(entries.map((e) => e.condition));

  const stats = [
    { val: entries.length, lbl: "記録日数" },
    { val: sleepAvg !== null ? sleepAvg.toFixed(1) + "h" : "-", lbl: "平均睡眠時間" },
    { val: fatigueAvg !== null ? fatigueAvg.toFixed(1) : "-", lbl: "平均疲労度" },
    { val: conditionAvg !== null ? conditionAvg.toFixed(1) : "-", lbl: "平均体調" },
  ];

  grid.innerHTML = stats.map((s) => `
    <div class="stat-box">
      <div class="val">${s.val}</div>
      <div class="lbl">${s.lbl}</div>
    </div>
  `).join("");
}

/* ---------------- 分析タブ: 時系列SVGグラフ ---------------- */

function renderTimeSeriesChart() {
  const wrap = document.getElementById("timeSeriesChart");
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const points = sorted.filter((e) => e.sleepHours !== null || e.fatigue !== null);

  if (points.length < 2) {
    wrap.innerHTML = `<div class="empty-state">グラフ表示には2件以上の記録が必要です</div>`;
    return;
  }

  const width = Math.max(340, points.length * 46);
  const height = 200;
  const padL = 34, padR = 12, padT = 14, padB = 26;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const sleepMax = 12; // 軸固定(0-12h)
  const fatigueMax = 5; // 軸固定(1-5)

  const xStep = points.length > 1 ? plotW / (points.length - 1) : 0;

  function xAt(i) { return padL + i * xStep; }
  function ySleep(v) { return padT + plotH * (1 - v / sleepMax); }
  function yFatigue(v) { return padT + plotH * (1 - v / fatigueMax); }

  const sleepPath = points.map((p, i) => {
    if (p.sleepHours === null || p.sleepHours === undefined) return null;
    return `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${ySleep(p.sleepHours).toFixed(1)}`;
  }).filter(Boolean).join(" ");

  const fatiguePath = points.map((p, i) => {
    if (p.fatigue === null || p.fatigue === undefined) return null;
    return `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yFatigue(p.fatigue).toFixed(1)}`;
  }).filter(Boolean).join(" ");

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const y = padT + plotH * t;
    return `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#2c3542" stroke-width="1" />`;
  }).join("");

  const xLabels = points.map((p, i) => {
    if (points.length > 10 && i % Math.ceil(points.length / 8) !== 0) return "";
    const d = new Date(p.date + "T00:00:00");
    return `<text x="${xAt(i).toFixed(1)}" y="${height - 6}" font-size="9" fill="#9aa5b1" text-anchor="middle">${d.getMonth() + 1}/${d.getDate()}</text>`;
  }).join("");

  const sleepDots = points.map((p, i) => {
    if (p.sleepHours === null || p.sleepHours === undefined) return "";
    return `<circle cx="${xAt(i).toFixed(1)}" cy="${ySleep(p.sleepHours).toFixed(1)}" r="3" fill="#4fb3a9" />`;
  }).join("");

  const fatigueDots = points.map((p, i) => {
    if (p.fatigue === null || p.fatigue === undefined) return "";
    return `<circle cx="${xAt(i).toFixed(1)}" cy="${yFatigue(p.fatigue).toFixed(1)}" r="3" fill="#f2b155" />`;
  }).join("");

  wrap.innerHTML = `
    <svg class="chart" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      ${gridLines}
      <path d="${sleepPath}" fill="none" stroke="#4fb3a9" stroke-width="2" />
      <path d="${fatiguePath}" fill="none" stroke="#f2b155" stroke-width="2" />
      ${sleepDots}
      ${fatigueDots}
      ${xLabels}
    </svg>
  `;
}

/* ---------------- 分析タブ: 散布図 + 相関係数 ---------------- */

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  if (denom === 0) return null;
  return num / denom;
}

const CORR_PAIRS = {
  sleep_fatigue: {
    label: "睡眠時間 × 疲労度",
    xLabel: "睡眠時間(h)",
    yLabel: "疲労度",
    getPairs: (sorted) => sorted
      .filter((e) => e.sleepHours != null && e.fatigue != null)
      .map((e) => ({ x: e.sleepHours, y: e.fatigue })),
  },
  activity_fatigue: {
    label: "活動時間 × 疲労度",
    xLabel: "活動時間(分)",
    yLabel: "疲労度",
    getPairs: (sorted) => sorted
      .filter((e) => e.fatigue != null && totalActivityMinutes(e) > 0)
      .map((e) => ({ x: totalActivityMinutes(e), y: e.fatigue })),
  },
  caffeine_sleep: {
    label: "カフェイン × 睡眠時間",
    xLabel: "カフェイン(杯)",
    yLabel: "睡眠時間(h)",
    getPairs: (sorted) => sorted
      .filter((e) => e.sleepHours != null && e.caffeine != null)
      .map((e) => ({ x: e.caffeine, y: e.sleepHours })),
  },
  alcohol_sleep: {
    label: "アルコール × 睡眠時間",
    xLabel: "アルコール(杯)",
    yLabel: "睡眠時間(h)",
    getPairs: (sorted) => sorted
      .filter((e) => e.sleepHours != null && e.alcohol != null)
      .map((e) => ({ x: e.alcohol, y: e.sleepHours })),
  },
  caffeine_fatigue_next: {
    label: "前日カフェイン × 翌日疲労度",
    xLabel: "前日カフェイン(杯)",
    yLabel: "翌日疲労度",
    getPairs: (sorted) => {
      const pairs = [];
      for (let i = 0; i < sorted.length - 1; i++) {
        const cur = sorted[i], next = sorted[i + 1];
        if (isNextDay(cur.date, next.date) && cur.caffeine != null && next.fatigue != null) {
          pairs.push({ x: cur.caffeine, y: next.fatigue });
        }
      }
      return pairs;
    },
  },
  alcohol_fatigue_next: {
    label: "前日アルコール × 翌日疲労度",
    xLabel: "前日アルコール(杯)",
    yLabel: "翌日疲労度",
    getPairs: (sorted) => {
      const pairs = [];
      for (let i = 0; i < sorted.length - 1; i++) {
        const cur = sorted[i], next = sorted[i + 1];
        if (isNextDay(cur.date, next.date) && cur.alcohol != null && next.fatigue != null) {
          pairs.push({ x: cur.alcohol, y: next.fatigue });
        }
      }
      return pairs;
    },
  },
  med_sleep: {
    label: "睡眠薬 × 睡眠時間",
    xLabel: "睡眠薬(0/1)",
    yLabel: "睡眠時間(h)",
    getPairs: (sorted) => sorted
      .filter((e) => e.sleepHours != null && (e.sleepMedTaken === 0 || e.sleepMedTaken === 1))
      .map((e) => ({ x: e.sleepMedTaken, y: e.sleepHours })),
  },
  star_fatigue: {
    label: "☆ × 疲労度",
    xLabel: "☆(0/1)",
    yLabel: "疲労度",
    getPairs: (sorted) => sorted
      .filter((e) => e.fatigue != null && typeof e.star === "boolean")
      .map((e) => ({ x: e.star ? 1 : 0, y: e.fatigue })),
  },
  star_fatigue_next: {
    label: "前日☆ × 翌日疲労度",
    xLabel: "前日☆(0/1)",
    yLabel: "翌日疲労度",
    getPairs: (sorted) => {
      const pairs = [];
      for (let i = 0; i < sorted.length - 1; i++) {
        const cur = sorted[i], next = sorted[i + 1];
        if (isNextDay(cur.date, next.date) && typeof cur.star === "boolean" && next.fatigue != null) {
          pairs.push({ x: cur.star ? 1 : 0, y: next.fatigue });
        }
      }
      return pairs;
    },
  },
};

function isNextDay(d1, d2) {
  const a = new Date(d1 + "T00:00:00");
  const b = new Date(d2 + "T00:00:00");
  return (b - a) === 24 * 60 * 60 * 1000;
}

function corrStrengthTag(r) {
  const abs = Math.abs(r);
  if (abs >= 0.5) return { text: "強い相関", cls: "tag-strong" };
  if (abs >= 0.3) return { text: "中程度の相関", cls: "tag-mid" };
  return { text: "弱い相関", cls: "tag-weak" };
}

function renderScatterChart(pairKey) {
  const wrap = document.getElementById("scatterChart");
  const def = CORR_PAIRS[pairKey];
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const pairs = def.getPairs(sorted);

  document.getElementById("corrPairLabel").textContent = def.label;

  if (pairs.length < 3) {
    wrap.innerHTML = `<div class="empty-state">分析には3件以上のデータが必要です(現在 ${pairs.length} 件)</div>`;
    document.getElementById("corrValue").textContent = "-";
    document.getElementById("corrTag").textContent = "データ不足";
    document.getElementById("corrTag").className = "corr-tag";
    return;
  }

  const xs = pairs.map((p) => p.x);
  const ys = pairs.map((p) => p.y);
  const r = pearson(xs, ys);

  const width = 320, height = 220;
  const padL = 38, padR = 14, padT = 14, padB = 30;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const xMin = 0, xMax = Math.max(...xs) * 1.15 || 1;
  const yMin = 0, yMax = Math.max(...ys) * 1.15 || 1;

  function xPix(v) { return padL + (v - xMin) / (xMax - xMin) * plotW; }
  function yPix(v) { return padT + plotH - (v - yMin) / (yMax - yMin) * plotH; }

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const y = padT + plotH * t;
    return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${width - padR}" y2="${y.toFixed(1)}" stroke="#2c3542" stroke-width="1" />`;
  }).join("");

  const dots = pairs.map((p) =>
    `<circle cx="${xPix(p.x).toFixed(1)}" cy="${yPix(p.y).toFixed(1)}" r="4" fill="#4fb3a9" fill-opacity="0.8" />`
  ).join("");

  // 回帰直線 (最小二乗法)
  let regLine = "";
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  if (den !== 0) {
    const slope = num / den;
    const intercept = my - slope * mx;
    const x1 = xMin, x2 = xMax;
    const y1 = slope * x1 + intercept;
    const y2 = slope * x2 + intercept;
    regLine = `<line x1="${xPix(x1).toFixed(1)}" y1="${yPix(y1).toFixed(1)}" x2="${xPix(x2).toFixed(1)}" y2="${yPix(y2).toFixed(1)}" stroke="#f2b155" stroke-width="1.6" stroke-dasharray="4 3" />`;
  }

  wrap.innerHTML = `
    <svg class="chart" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      ${gridLines}
      ${regLine}
      ${dots}
      <text x="${width / 2}" y="${height - 6}" font-size="10" fill="#9aa5b1" text-anchor="middle">${def.xLabel}</text>
      <text x="10" y="${padT + plotH / 2}" font-size="10" fill="#9aa5b1" text-anchor="middle" transform="rotate(-90 10 ${padT + plotH / 2})">${def.yLabel}</text>
    </svg>
  `;

  if (r === null) {
    document.getElementById("corrValue").textContent = "計算不可";
    document.getElementById("corrTag").textContent = "データ不足";
    document.getElementById("corrTag").className = "corr-tag";
  } else {
    document.getElementById("corrValue").textContent = `r = ${r.toFixed(2)}`;
    const tag = corrStrengthTag(r);
    document.getElementById("corrTag").textContent = tag.text;
    document.getElementById("corrTag").className = "corr-tag " + tag.cls;
  }
}

function initCorrTabs() {
  const tabsWrap = document.getElementById("corrTabs");
  tabsWrap.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      tabsWrap.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentCorrPair = btn.dataset.pair;
      renderScatterChart(currentCorrPair);
    });
  });
}

function renderAnalysis() {
  renderStats();
  renderTimeSeriesChart();
  renderScatterChart(currentCorrPair);
}

/* ---------------- PWAインストール ---------------- */

function initInstallBanner() {
  let deferredPrompt = null;
  const banner = document.getElementById("installBanner");
  const btn = document.getElementById("installBtn");

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    banner.classList.add("show");
  });

  btn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    banner.classList.remove("show");
  });

  window.addEventListener("appinstalled", () => {
    banner.classList.remove("show");
  });
}

function initServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js").catch((err) => {
        console.warn("Service worker registration failed", err);
      });
    });
  }
}

/* ---------------- 初期化 ---------------- */

function init() {
  initTabs();
  initScaleButtons();
  initForm();
  initSleepAutoCalc();
  initMedFields();
  initStarToggle();
  initCorrTabs();
  initBackup();
  initInstallBanner();
  initServiceWorker();
  resetForm();
  renderHistory();
}

document.addEventListener("DOMContentLoaded", init);
