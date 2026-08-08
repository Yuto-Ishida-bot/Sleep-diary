/* ==========================================================
   睡眠・活動ダイアリー - app.js
   すべてのデータは端末内 localStorage に保存される(サーバー送信なし)

   スケールの向きの約束:
     疲労度 1 = 疲労なし  〜 5 = 非常に疲れている
     体調   1 = とても良い 〜 5 = とても悪い
   どちらも「1 が良い状態」で揃えている。
   ========================================================== */

const STORAGE_KEY = "sleepDiary.entries.v2";
const LEGACY_KEY = "sleepDiary.entries.v1";

let entries = loadEntries();
let editingId = null;      // 編集中のエントリID (nullなら新規)
let currentCorrPair = "sleep_fatigue";

/* ---------------- 保存・読み込み・マイグレーション ---------------- */

// v1 -> v2: 体調スケールを反転(旧 1=悪い/5=良い → 新 1=良い/5=悪い)し、
// 廃止した「日中の活動」項目を取り除く。
function migrateV1Entry(old) {
  return {
    id: old.id,
    date: old.date,
    bedtime: old.bedtime ?? null,
    waketime: old.waketime ?? null,
    deepMin: null,
    lightMin: null,
    remMin: null,
    awakenings: null,
    sleepHours: old.sleepHours ?? null,
    fatigue: old.fatigue ?? null,
    condition: (old.condition === null || old.condition === undefined)
      ? null : (6 - Number(old.condition)),
    sleepMedTaken: old.sleepMedTaken ?? null,
    sleepMedName: old.sleepMedName || "",
    star: !!old.star,
    caffeine: old.caffeine ?? 0,
    alcohol: old.alcohol ?? 0,
    memo: old.memo || "",
  };
}

function loadEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
    // v2 が無く v1 がある場合は一度だけ変換して移行する
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      if (Array.isArray(parsed)) {
        const migrated = parsed.map(migrateV1Entry);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
    }
    return [];
  } catch (e) {
    console.error("読み込み失敗", e);
    return [];
  }
}

function saveEntries() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

/* ---------------- ユーティリティ ---------------- */

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

// 就寝〜起床の「床上時間」(時間単位)。日をまたぐ場合も正しく計算する。
function computeTimeInBedHours(bedtime, waketime) {
  const b = timeToMinutes(bedtime);
  const w = timeToMinutes(waketime);
  if (b === null || w === null) return null;
  let diff = w - b;
  if (diff <= 0) diff += 24 * 60;
  return Math.round((diff / 60) * 100) / 100;
}

function fmtDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]})`;
}

// 分 -> 「1時間37分」形式
function fmtMinutes(min) {
  if (min === null || min === undefined || isNaN(min)) return "-";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m}分`;
  return `${h}時間${m}分`;
}

// 3ステージの合計(分)。すべて未入力なら null。
function stageTotalMinutes(entry) {
  const vals = [entry.deepMin, entry.lightMin, entry.remMin]
    .filter((v) => v !== null && v !== undefined && !isNaN(v));
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + Number(b), 0);
}

// 分析で使う「実睡眠時間(時間)」。ステージ入力があればその合計を優先する。
function actualSleepHours(entry) {
  const total = stageTotalMinutes(entry);
  if (total !== null) return Math.round((total / 60) * 100) / 100;
  return entry.sleepHours ?? null;
}

// 睡眠効率(%) = 実睡眠時間 / 床上時間
function sleepEfficiency(entry) {
  const actual = actualSleepHours(entry);
  const inBed = computeTimeInBedHours(entry.bedtime, entry.waketime);
  if (actual === null || inBed === null || inBed === 0) return null;
  return Math.round((actual / inBed) * 1000) / 10;
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

/* ---------------- スケールボタン ---------------- */

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

/* ---------------- 睡眠ステージ入力 ---------------- */

// 時間欄と分欄から合計分を取り出す。両方空なら null。
function readStageMinutes(prefix) {
  const hEl = document.getElementById(`f-${prefix}-h`);
  const mEl = document.getElementById(`f-${prefix}-m`);
  const hRaw = hEl.value.trim();
  const mRaw = mEl.value.trim();
  if (hRaw === "" && mRaw === "") return null;
  const h = hRaw === "" ? 0 : Number(hRaw);
  const m = mRaw === "" ? 0 : Number(mRaw);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

function writeStageMinutes(prefix, minutes) {
  const hEl = document.getElementById(`f-${prefix}-h`);
  const mEl = document.getElementById(`f-${prefix}-m`);
  if (minutes === null || minutes === undefined || isNaN(minutes)) {
    hEl.value = "";
    mEl.value = "";
    return;
  }
  hEl.value = Math.floor(minutes / 60);
  mEl.value = Math.round(minutes % 60);
}

// フォームの入力内容から、床上時間・実睡眠時間・睡眠効率の表示を更新する
function updateComputedOutputs() {
  const bedtime = document.getElementById("f-bedtime").value;
  const waketime = document.getElementById("f-waketime").value;
  const inBed = computeTimeInBedHours(bedtime, waketime);
  document.getElementById("timeInBedOut").textContent =
    inBed === null ? "-" : fmtMinutes(Math.round(inBed * 60));

  const draft = {
    deepMin: readStageMinutes("deep"),
    lightMin: readStageMinutes("light"),
    remMin: readStageMinutes("rem"),
    sleepHours: null,
    bedtime, waketime,
  };
  const total = stageTotalMinutes(draft);
  document.getElementById("actualSleepOut").textContent =
    total === null ? "-" : fmtMinutes(total);

  const eff = sleepEfficiency(draft);
  document.getElementById("efficiencyOut").textContent =
    eff === null ? "-" : `${eff}%`;
}

function initStageInputs() {
  ["f-deep-h", "f-deep-m", "f-light-h", "f-light-m", "f-rem-h", "f-rem-m",
   "f-bedtime", "f-waketime"].forEach((id) => {
    const el = document.getElementById(id);
    el.addEventListener("input", updateComputedOutputs);
    el.addEventListener("change", updateComputedOutputs);
  });
}

/* ---------------- ☆ / 睡眠薬 ---------------- */

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
  writeStageMinutes("deep", null);
  writeStageMinutes("light", null);
  writeStageMinutes("rem", null);
  document.getElementById("f-awakenings").value = "";
  updateComputedOutputs();
  document.getElementById("saveBtn").textContent = "この日の記録を保存";
}

function loadEntryIntoForm(entry) {
  editingId = entry.id;
  document.getElementById("f-date").value = entry.date;
  document.getElementById("f-bedtime").value = entry.bedtime || "";
  document.getElementById("f-waketime").value = entry.waketime || "";
  writeStageMinutes("deep", entry.deepMin);
  writeStageMinutes("light", entry.lightMin);
  writeStageMinutes("rem", entry.remMin);
  document.getElementById("f-awakenings").value = entry.awakenings ?? "";
  setScaleValue("f-fatigue", entry.fatigue);
  setScaleValue("f-condition", entry.condition);
  setScaleValue("f-medtaken", entry.sleepMedTaken);
  document.getElementById("medNameField").style.display = entry.sleepMedTaken === 1 ? "block" : "none";
  document.getElementById("f-medname").value = entry.sleepMedName || "";
  setStarUI(!!entry.star);
  document.getElementById("f-caffeine").value = entry.caffeine ?? "";
  document.getElementById("f-alcohol").value = entry.alcohol ?? "";
  document.getElementById("f-memo").value = entry.memo || "";
  updateComputedOutputs();
  document.getElementById("saveBtn").textContent = "更新を保存";
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
  document.querySelector('.nav-btn[data-tab="tab-record"]').classList.add("active");
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  document.getElementById("tab-record").classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function initForm() {
  document.getElementById("f-date").value = todayStr();

  document.getElementById("entryForm").addEventListener("submit", (e) => {
    e.preventDefault();

    const date = document.getElementById("f-date").value;
    if (!date) { showToast("日付を入力してください"); return; }

    const awakeRaw = document.getElementById("f-awakenings").value;

    const entry = {
      id: editingId || uuid(),
      date,
      bedtime: document.getElementById("f-bedtime").value || null,
      waketime: document.getElementById("f-waketime").value || null,
      deepMin: readStageMinutes("deep"),
      lightMin: readStageMinutes("light"),
      remMin: readStageMinutes("rem"),
      awakenings: awakeRaw !== "" ? Number(awakeRaw) : null,
      sleepHours: null, // 実睡眠時間はステージ合計から都度算出する
      fatigue: getScaleValue("f-fatigue"),
      condition: getScaleValue("f-condition"),
      sleepMedTaken: getScaleValue("f-medtaken"),
      sleepMedName: getScaleValue("f-medtaken") === 1
        ? (document.getElementById("f-medname").value || "") : "",
      star: document.getElementById("starToggle").dataset.active === "true",
      caffeine: document.getElementById("f-caffeine").value !== ""
        ? Number(document.getElementById("f-caffeine").value) : 0,
      alcohol: document.getElementById("f-alcohol").value !== ""
        ? Number(document.getElementById("f-alcohol").value) : 0,
      memo: document.getElementById("f-memo").value || "",
    };

    // ステージ未入力なら、就寝〜起床から求めた時間を保険として残す
    if (stageTotalMinutes(entry) === null) {
      entry.sleepHours = computeTimeInBedHours(entry.bedtime, entry.waketime);
    }

    // 同じ日付の既存記録があれば(新規保存時)上書きする
    const existingIdxByDate = entries.findIndex((e) => e.date === date && e.id !== entry.id);
    if (existingIdxByDate !== -1 && !editingId) {
      entry.id = entries[existingIdxByDate].id;
      entries[existingIdxByDate] = entry;
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
    const actual = actualSleepHours(entry);
    if (actual !== null) badges.push(`<span class="badge">😴 ${actual}h</span>`);
    if (entry.deepMin != null) badges.push(`<span class="badge">🌑 深 ${fmtMinutes(entry.deepMin)}</span>`);
    if (entry.lightMin != null) badges.push(`<span class="badge">🌗 浅 ${fmtMinutes(entry.lightMin)}</span>`);
    if (entry.remMin != null) badges.push(`<span class="badge">💭 レム ${fmtMinutes(entry.remMin)}</span>`);
    if (entry.awakenings != null) badges.push(`<span class="badge">👁 覚醒 ${entry.awakenings}回</span>`);
    if (entry.fatigue) badges.push(`<span class="badge">🔋 疲労 ${entry.fatigue}/5</span>`);
    if (entry.condition) badges.push(`<span class="badge">❤ 体調 ${entry.condition}/5</span>`);
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
    version: 2,
    scaleNote: "fatigue 1=疲労なし〜5=強い / condition 1=とても良い〜5=とても悪い",
    exportedAt: new Date().toISOString(),
    entries,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sleep-diary-backup-${todayStr()}.json`;
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

      // 旧形式(version 1 / activities を含む)なら体調スケールを反転して取り込む
      const isLegacy = !Array.isArray(data) && Number(data.version) === 1;

      let added = 0, updated = 0;
      incoming.forEach((raw) => {
        if (!raw.date) return;
        const imp = isLegacy ? migrateV1Entry({ ...raw, id: raw.id || uuid() }) : raw;
        const idx = entries.findIndex((e) => e.date === imp.date);
        const normalized = {
          id: (idx !== -1 ? entries[idx].id : imp.id) || uuid(),
          date: imp.date,
          bedtime: imp.bedtime ?? null,
          waketime: imp.waketime ?? null,
          deepMin: imp.deepMin ?? null,
          lightMin: imp.lightMin ?? null,
          remMin: imp.remMin ?? null,
          awakenings: imp.awakenings ?? null,
          sleepHours: imp.sleepHours ?? null,
          fatigue: imp.fatigue ?? null,
          condition: imp.condition ?? null,
          sleepMedTaken: imp.sleepMedTaken ?? null,
          sleepMedName: imp.sleepMedName || "",
          star: !!imp.star,
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
  const sleepAvg = average(entries.map((e) => actualSleepHours(e)));
  const deepAvg = average(entries.map((e) => e.deepMin));
  const remAvg = average(entries.map((e) => e.remMin));
  const fatigueAvg = average(entries.map((e) => e.fatigue));
  const conditionAvg = average(entries.map((e) => e.condition));
  const awakenAvg = average(entries.map((e) => e.awakenings));

  const stats = [
    { val: entries.length, lbl: "記録日数" },
    { val: sleepAvg !== null ? sleepAvg.toFixed(1) + "h" : "-", lbl: "平均実睡眠" },
    { val: deepAvg !== null ? fmtMinutes(Math.round(deepAvg)) : "-", lbl: "平均深い睡眠" },
    { val: remAvg !== null ? fmtMinutes(Math.round(remAvg)) : "-", lbl: "平均レム睡眠" },
    { val: fatigueAvg !== null ? fatigueAvg.toFixed(1) : "-", lbl: "平均疲労度" },
    { val: conditionAvg !== null ? conditionAvg.toFixed(1) : "-", lbl: "平均体調" },
    { val: awakenAvg !== null ? awakenAvg.toFixed(1) + "回" : "-", lbl: "平均中途覚醒" },
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
  const points = sorted.filter((e) => actualSleepHours(e) !== null || e.fatigue !== null);

  if (points.length < 2) {
    wrap.innerHTML = `<div class="empty-state">グラフ表示には2件以上の記録が必要です</div>`;
    return;
  }

  const width = Math.max(340, points.length * 46);
  const height = 200;
  const padL = 34, padR = 12, padT = 14, padB = 26;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const sleepMax = 12;
  const fatigueMax = 5;
  const xStep = points.length > 1 ? plotW / (points.length - 1) : 0;

  function xAt(i) { return padL + i * xStep; }
  function ySleep(v) { return padT + plotH * (1 - v / sleepMax); }
  function yFatigue(v) { return padT + plotH * (1 - v / fatigueMax); }

  const sleepPath = points.map((p, i) => {
    const v = actualSleepHours(p);
    if (v === null) return null;
    return `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${ySleep(v).toFixed(1)}`;
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
    const v = actualSleepHours(p);
    if (v === null) return "";
    return `<circle cx="${xAt(i).toFixed(1)}" cy="${ySleep(v).toFixed(1)}" r="3" fill="#4fb3a9" />`;
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

/* ---------------- 分析タブ: ステージ積み上げ棒グラフ ---------------- */

function renderStageChart() {
  const wrap = document.getElementById("stageChart");
  const sorted = [...entries]
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((e) => stageTotalMinutes(e) !== null);

  if (sorted.length < 1) {
    wrap.innerHTML = `<div class="empty-state">睡眠ステージを入力すると内訳が表示されます</div>`;
    return;
  }

  const barW = 22, gap = 12;
  const width = Math.max(320, sorted.length * (barW + gap) + 40);
  const height = 200;
  const padL = 34, padT = 14, padB = 26;
  const plotH = height - padT - padB;
  const maxMin = Math.max(600, ...sorted.map((e) => stageTotalMinutes(e)));

  function yFor(min) { return plotH * (min / maxMin); }

  const bars = sorted.map((e, i) => {
    const x = padL + i * (barW + gap);
    const deep = Number(e.deepMin) || 0;
    const light = Number(e.lightMin) || 0;
    const rem = Number(e.remMin) || 0;
    const hDeep = yFor(deep), hLight = yFor(light), hRem = yFor(rem);
    let yCursor = padT + plotH;
    const rects = [];
    yCursor -= hDeep;
    rects.push(`<rect x="${x}" y="${yCursor.toFixed(1)}" width="${barW}" height="${hDeep.toFixed(1)}" fill="#7c4dff" />`);
    yCursor -= hLight;
    rects.push(`<rect x="${x}" y="${yCursor.toFixed(1)}" width="${barW}" height="${hLight.toFixed(1)}" fill="#c964e0" />`);
    yCursor -= hRem;
    rects.push(`<rect x="${x}" y="${yCursor.toFixed(1)}" width="${barW}" height="${hRem.toFixed(1)}" fill="#ff8a80" />`);
    const d = new Date(e.date + "T00:00:00");
    const label = sorted.length > 12 && i % 2 !== 0
      ? ""
      : `<text x="${(x + barW / 2).toFixed(1)}" y="${height - 8}" font-size="9" fill="#9aa5b1" text-anchor="middle">${d.getMonth() + 1}/${d.getDate()}</text>`;
    return rects.join("") + label;
  }).join("");

  const gridLines = [0, 0.5, 1].map((t) => {
    const y = padT + plotH * t;
    const val = Math.round((maxMin * (1 - t)) / 60);
    return `<line x1="${padL}" y1="${y}" x2="${width - 8}" y2="${y}" stroke="#2c3542" stroke-width="1" />` +
           `<text x="${padL - 5}" y="${y + 3}" font-size="9" fill="#9aa5b1" text-anchor="end">${val}h</text>`;
  }).join("");

  wrap.innerHTML = `
    <svg class="chart" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      ${gridLines}
      ${bars}
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

function isNextDay(d1, d2) {
  const a = new Date(d1 + "T00:00:00");
  const b = new Date(d2 + "T00:00:00");
  return (b - a) === 24 * 60 * 60 * 1000;
}

// 同じ日の x と y を取り出す共通ヘルパー
function sameDayPairs(sorted, getX, getY) {
  const pairs = [];
  sorted.forEach((e) => {
    const x = getX(e);
    const y = getY(e);
    if (x !== null && x !== undefined && !isNaN(x) &&
        y !== null && y !== undefined && !isNaN(y)) {
      pairs.push({ x: Number(x), y: Number(y) });
    }
  });
  return pairs;
}

// 前日の x と 翌日の y を取り出す共通ヘルパー
function nextDayPairs(sorted, getX, getY) {
  const pairs = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i], next = sorted[i + 1];
    if (!isNextDay(cur.date, next.date)) continue;
    const x = getX(cur);
    const y = getY(next);
    if (x !== null && x !== undefined && !isNaN(x) &&
        y !== null && y !== undefined && !isNaN(y)) {
      pairs.push({ x: Number(x), y: Number(y) });
    }
  }
  return pairs;
}

const getFatigue = (e) => e.fatigue;
const getCondition = (e) => e.condition;
const getDeep = (e) => e.deepMin;
const getStar = (e) => (typeof e.star === "boolean" ? (e.star ? 1 : 0) : null);
const getMed = (e) => (e.sleepMedTaken === 0 || e.sleepMedTaken === 1) ? e.sleepMedTaken : null;

const CORR_PAIRS = {
  sleep_fatigue: {
    label: "実睡眠時間 × 疲労度", xLabel: "実睡眠時間(h)", yLabel: "疲労度",
    getPairs: (s) => sameDayPairs(s, actualSleepHours, getFatigue),
  },
  deep_fatigue: {
    label: "深い睡眠 × 疲労度", xLabel: "深い睡眠(分)", yLabel: "疲労度",
    getPairs: (s) => sameDayPairs(s, getDeep, getFatigue),
  },
  light_fatigue: {
    label: "浅い睡眠 × 疲労度", xLabel: "浅い睡眠(分)", yLabel: "疲労度",
    getPairs: (s) => sameDayPairs(s, (e) => e.lightMin, getFatigue),
  },
  rem_fatigue: {
    label: "レム睡眠 × 疲労度", xLabel: "レム睡眠(分)", yLabel: "疲労度",
    getPairs: (s) => sameDayPairs(s, (e) => e.remMin, getFatigue),
  },
  awaken_fatigue: {
    label: "中途覚醒回数 × 疲労度", xLabel: "目が覚めた回数", yLabel: "疲労度",
    getPairs: (s) => sameDayPairs(s, (e) => e.awakenings, getFatigue),
  },
  efficiency_fatigue: {
    label: "睡眠効率 × 疲労度", xLabel: "睡眠効率(%)", yLabel: "疲労度",
    getPairs: (s) => sameDayPairs(s, sleepEfficiency, getFatigue),
  },
  deep_condition: {
    label: "深い睡眠 × 体調", xLabel: "深い睡眠(分)", yLabel: "体調",
    getPairs: (s) => sameDayPairs(s, getDeep, getCondition),
  },
  med_sleep: {
    label: "睡眠薬 × 実睡眠時間", xLabel: "睡眠薬(0=なし/1=あり)", yLabel: "実睡眠時間(h)",
    getPairs: (s) => sameDayPairs(s, getMed, actualSleepHours),
  },
  med_deep: {
    label: "睡眠薬 × 深い睡眠", xLabel: "睡眠薬(0=なし/1=あり)", yLabel: "深い睡眠(分)",
    getPairs: (s) => sameDayPairs(s, getMed, getDeep),
  },
  caffeine_sleep: {
    label: "カフェイン × 実睡眠時間", xLabel: "カフェイン(杯)", yLabel: "実睡眠時間(h)",
    getPairs: (s) => sameDayPairs(s, (e) => e.caffeine, actualSleepHours),
  },
  alcohol_sleep: {
    label: "アルコール × 実睡眠時間", xLabel: "アルコール(杯)", yLabel: "実睡眠時間(h)",
    getPairs: (s) => sameDayPairs(s, (e) => e.alcohol, actualSleepHours),
  },
  alcohol_deep: {
    label: "アルコール × 深い睡眠", xLabel: "アルコール(杯)", yLabel: "深い睡眠(分)",
    getPairs: (s) => sameDayPairs(s, (e) => e.alcohol, getDeep),
  },
  caffeine_fatigue_next: {
    label: "前日カフェイン × 翌日疲労度", xLabel: "前日カフェイン(杯)", yLabel: "翌日疲労度",
    getPairs: (s) => nextDayPairs(s, (e) => e.caffeine, getFatigue),
  },
  alcohol_fatigue_next: {
    label: "前日アルコール × 翌日疲労度", xLabel: "前日アルコール(杯)", yLabel: "翌日疲労度",
    getPairs: (s) => nextDayPairs(s, (e) => e.alcohol, getFatigue),
  },
  star_fatigue: {
    label: "☆ × 疲労度", xLabel: "☆(0/1)", yLabel: "疲労度",
    getPairs: (s) => sameDayPairs(s, getStar, getFatigue),
  },
  star_fatigue_next: {
    label: "前日☆ × 翌日疲労度", xLabel: "前日☆(0/1)", yLabel: "翌日疲労度",
    getPairs: (s) => nextDayPairs(s, getStar, getFatigue),
  },
  star_deep: {
    label: "☆ × 深い睡眠", xLabel: "☆(0/1)", yLabel: "深い睡眠(分)",
    getPairs: (s) => sameDayPairs(s, getStar, getDeep),
  },
};

function corrStrengthTag(r) {
  const abs = Math.abs(r);
  if (abs >= 0.5) return { text: "強い相関", cls: "tag-strong" };
  if (abs >= 0.3) return { text: "中程度の相関", cls: "tag-mid" };
  return { text: "弱い相関", cls: "tag-weak" };
}

// 相関の向きを日本語で説明する。疲労度・体調は「1が良い」ので向きを言い換える。
function corrDirectionHint(def, r, n) {
  if (r === null) return "";
  // x が大きいほど y がどうなるか、を説明する
  const yIsScore = def.yLabel.includes("疲労度") || def.yLabel.includes("体調");
  let tail;
  if (yIsScore) {
    // スコアは 1 が良い状態なので、r が正 = 数値が上がる = 状態は悪化
    tail = r > 0
      ? `${def.yLabel}のスコアが高い(状態が悪い)傾向`
      : `${def.yLabel}のスコアが低い(状態が良い)傾向`;
  } else {
    tail = `${def.yLabel}が${r > 0 ? "長い・多い" : "短い・少ない"}傾向`;
  }
  return `n = ${n} 件。${def.xLabel}が大きいほど、${tail}にあります。相関は因果関係を示すものではない点にご注意ください。`;
}

function renderScatterChart(pairKey) {
  const wrap = document.getElementById("scatterChart");
  const hintEl = document.getElementById("corrHint");
  const def = CORR_PAIRS[pairKey];
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const pairs = def.getPairs(sorted);

  document.getElementById("corrPairLabel").textContent = def.label;

  if (pairs.length < 3) {
    wrap.innerHTML = `<div class="empty-state">分析には3件以上のデータが必要です(現在 ${pairs.length} 件)</div>`;
    document.getElementById("corrValue").textContent = "-";
    document.getElementById("corrTag").textContent = "データ不足";
    document.getElementById("corrTag").className = "corr-tag";
    hintEl.textContent = "";
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
    const y1 = slope * xMin + intercept;
    const y2 = slope * xMax + intercept;
    regLine = `<line x1="${xPix(xMin).toFixed(1)}" y1="${yPix(y1).toFixed(1)}" x2="${xPix(xMax).toFixed(1)}" y2="${yPix(y2).toFixed(1)}" stroke="#f2b155" stroke-width="1.6" stroke-dasharray="4 3" />`;
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
    document.getElementById("corrTag").textContent = "ばらつき無し";
    document.getElementById("corrTag").className = "corr-tag";
    hintEl.textContent = `n = ${pairs.length} 件。どちらかの値が全日で同じため、相関を計算できません。値に幅が出てくると計算されます。`;
  } else {
    document.getElementById("corrValue").textContent = `r = ${r.toFixed(2)}`;
    const tag = corrStrengthTag(r);
    document.getElementById("corrTag").textContent = tag.text;
    document.getElementById("corrTag").className = "corr-tag " + tag.cls;
    hintEl.textContent = corrDirectionHint(def, r, pairs.length);
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
  renderStageChart();
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
  initStageInputs();
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
