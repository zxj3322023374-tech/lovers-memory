// ===== IndexedDB =====
const DB_NAME = "LoversMemoryDB";
const DB_VER = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("photos"))
        db.createObjectStore("photos", { keyPath: "id", autoIncrement: true });
      if (!db.objectStoreNames.contains("timeline"))
        db.createObjectStore("timeline", { keyPath: "id", autoIncrement: true });
      if (!db.objectStoreNames.contains("messages"))
        db.createObjectStore("messages", { keyPath: "id", autoIncrement: true });
      if (!db.objectStoreNames.contains("settings"))
        db.createObjectStore("settings", { keyPath: "key" });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function dbPut(store, data) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(data);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}

function dbGetAll(store) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); reject(req.error); };
  }));
}

function dbDelete(store, id) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}

function dbClear(store) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).clear();
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}

// ===== Settings =====
async function loadSettings() {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction("settings", "readonly");
    const req = tx.objectStore("settings").getAll();
    req.onsuccess = () => {
      const items = req.result || [];
      const s = {};
      items.forEach(i => s[i.key] = i.value);
      db.close();
      resolve(s);
    };
    req.onerror = () => { db.close(); resolve({}); };
  });
}

async function saveSetting(key, value) {
  await dbPut("settings", { key, value });
}

// ===== Compress Image =====
function compressImage(file, maxW = 800, quality = 0.8) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxW) { h *= maxW / w; w = maxW; }
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ===== Render =====
async function renderPhotos() {
  const photos = await dbGetAll("photos");
  photos.sort((a, b) => b.timestamp - a.timestamp);
  const grid = document.getElementById("photoGrid");
  const empty = document.getElementById("photoEmpty");
  if (photos.length === 0) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">-</div><p>还没有照片，点击上方按钮上传第一张吧</p></div>';
    return;
  }
  grid.innerHTML = photos.map(p => `
    <div class="photo-card" data-id="${p.id}">
      <img src="${p.imageData}" alt="${p.caption || ''}">
      <div class="photo-card-overlay">
        <div class="photo-caption">${escapeHtml(p.caption || '')}</div>
        <div class="photo-time">${formatTime(p.timestamp)}</div>
      </div>
      <button class="photo-edit-btn" data-action="edit" data-id="${p.id}">&#x270E;</button>
      <button class="photo-del-btn" data-action="delete" data-id="${p.id}">&#x2715;</button>
    </div>
  `).join("");
}

async function renderTimeline() {
  const events = await dbGetAll("timeline");
  events.sort((a, b) => {
    if (a.eventDate !== b.eventDate) return a.eventDate.localeCompare(b.eventDate);
    return b.timestamp - a.timestamp;
  });
  const container = document.getElementById("timelineContainer");
  if (events.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">-</div><p>还没有记录，开始记录你们的珍贵时刻吧</p></div>';
    return;
  }
  container.innerHTML = events.map(e => `
    <div class="tl-item" data-id="${e.id}">
      <div class="tl-date">${e.eventDate}</div>
      <div class="tl-title">${escapeHtml(e.title || '')}</div>
      ${e.desc ? `<div class="tl-desc">${escapeHtml(e.desc)}</div>` : ''}
    </div>
  `).join("");
  document.querySelectorAll(".tl-item").forEach(el => {
    el.addEventListener("click", () => editTimelineEvent(parseInt(el.dataset.id)));
  });
}

async function renderMessages() {
  const msgs = await dbGetAll("messages");
  msgs.sort((a, b) => b.timestamp - a.timestamp);
  const list = document.getElementById("msgList");
  if (msgs.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">-</div><p>还没有留言，写第一句吧</p></div>';
    return;
  }
  list.innerHTML = msgs.map(m => `
    <div class="msg-card">
      <div class="msg-header">
        <span class="msg-author">${escapeHtml(m.author || '匿名')}</span>
        <div>
          <span class="msg-time">${formatTime(m.timestamp)}</span>
          <button class="msg-del-btn" data-id="${m.id}">删除</button>
        </div>
      </div>
      <div class="msg-content">${escapeHtml(m.content)}</div>
    </div>
  `).join("");
  document.querySelectorAll(".msg-del-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await dbDelete("messages", parseInt(btn.dataset.id));
      renderMessages();
    });
  });
}

async function updateHero() {
  const s = await loadSettings();
  document.getElementById("name1").textContent = s.name1 || "你";
  document.getElementById("name2").textContent = s.name2 || "TA";
  document.getElementById("setName1").value = s.name1 || "";
  document.getElementById("setName2").value = s.name2 || "";
  document.getElementById("setAnniv").value = s.anniv || "";
  document.getElementById("annivDisplay").textContent = s.anniv || "—";
  if (s.anniv) {
    const diff = Math.floor((Date.now() - new Date(s.anniv).getTime()) / 86400000);
    document.getElementById("daysCount").textContent = Math.max(0, diff + 1);
  } else {
    document.getElementById("daysCount").textContent = "0";
  }
  // Hero background
  if (s.heroBg) {
    document.getElementById("heroBg").classList.add("has-image");
    document.getElementById("heroBg").style.backgroundImage = `url(${s.heroBg})`;
  }
}

// ===== Helpers =====
function formatTime(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// ===== Upload Photo =====
document.getElementById("photoInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const imageData = await compressImage(file);
  await dbPut("photos", { imageData, caption: "", timestamp: Date.now() });
  e.target.value = "";
  renderPhotos();
});

// ===== Photo Delete =====
document.addEventListener("click", async (e) => {
  const delBtn = e.target.closest(".photo-del-btn");
  if (!delBtn) return;
  const id = parseInt(delBtn.dataset.id);
  if (confirm("确定删除这张照片吗？")) {
    await dbDelete("photos", id);
    renderPhotos();
  }
});

// ===== Photo Edit / View =====
document.addEventListener("click", (e) => {
  const editBtn = e.target.closest(".photo-edit-btn");
  const card = e.target.closest(".photo-card");
  if (editBtn) {
    const id = parseInt(editBtn.dataset.id);
    showEditModal(id);
  } else if (card && !e.target.closest("button")) {
    const img = card.querySelector("img");
    const caption = card.querySelector(".photo-caption")?.textContent || "";
    const time = card.querySelector(".photo-time")?.textContent || "";
    showPhotoModal(img.src, caption, time);
  }
});

// ===== Photo Modal =====
function showPhotoModal(src, caption, time) {
  document.getElementById("modalPhotoImg").src = src;
  document.getElementById("modalPhotoCaption").textContent = caption;
  document.getElementById("modalPhotoTime").textContent = time;
  document.getElementById("photoModal").classList.add("active");
}

// ===== Edit Modal =====
let editingPhotoId = null;
function showEditModal(id) {
  editingPhotoId = id;
  document.getElementById("editCaption").value = "";
  document.getElementById("editModal").classList.add("active");
}

document.getElementById("editSaveBtn").addEventListener("click", async () => {
  if (!editingPhotoId) return;
  const caption = document.getElementById("editCaption").value.trim();
  const photos = await dbGetAll("photos");
  const photo = photos.find(p => p.id === editingPhotoId);
  if (photo) {
    photo.caption = caption;
    await dbPut("photos", photo);
  }
  editingPhotoId = null;
  document.getElementById("editModal").classList.remove("active");
  renderPhotos();
});

// ===== Timeline =====
document.getElementById("addTimelineBtn").addEventListener("click", () => {
  editingTimelineId = null;
  document.getElementById("tlModalTitle").textContent = "记录事件";
  document.getElementById("tlDate").value = new Date().toISOString().split("T")[0];
  document.getElementById("tlTitle").value = "";
  document.getElementById("tlDesc").value = "";
  document.getElementById("tlDeleteBtn").style.display = "none";
  document.getElementById("timelineModal").classList.add("active");
});

let editingTimelineId = null;

async function editTimelineEvent(id) {
  const events = await dbGetAll("timeline");
  const ev = events.find(e => e.id === id);
  if (!ev) return;
  editingTimelineId = id;
  document.getElementById("tlModalTitle").textContent = "编辑事件";
  document.getElementById("tlDate").value = ev.eventDate;
  document.getElementById("tlTitle").value = ev.title || "";
  document.getElementById("tlDesc").value = ev.desc || "";
  document.getElementById("tlDeleteBtn").style.display = "block";
  document.getElementById("timelineModal").classList.add("active");
}

document.getElementById("tlSaveBtn").addEventListener("click", async () => {
  const data = {
    eventDate: document.getElementById("tlDate").value,
    title: document.getElementById("tlTitle").value.trim(),
    desc: document.getElementById("tlDesc").value.trim(),
  };
  if (!data.eventDate || !data.title) { alert("日期和标题不能为空"); return; }
  if (editingTimelineId) {
    const all = await dbGetAll("timeline");
    const existing = all.find(e => e.id === editingTimelineId);
    if (existing) { data.timestamp = existing.timestamp; data.id = editingTimelineId; }
  } else {
    data.timestamp = Date.now();
  }
  await dbPut("timeline", data);
  editingTimelineId = null;
  document.getElementById("timelineModal").classList.remove("active");
  renderTimeline();
});

document.getElementById("tlDeleteBtn").addEventListener("click", async () => {
  if (!editingTimelineId || !confirm("确定删除这条记录吗？")) return;
  await dbDelete("timeline", editingTimelineId);
  editingTimelineId = null;
  document.getElementById("timelineModal").classList.remove("active");
  renderTimeline();
});

// ===== Messages =====
document.getElementById("msgSendBtn").addEventListener("click", async () => {
  const input = document.getElementById("msgInput");
  const content = input.value.trim();
  if (!content) return;
  const s = await loadSettings();
  await dbPut("messages", {
    author: s.name1 || "你",
    content,
    timestamp: Date.now()
  });
  input.value = "";
  renderMessages();
});
document.getElementById("msgInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); document.getElementById("msgSendBtn").click(); }
});

// ===== Settings =====
document.getElementById("saveSettings").addEventListener("click", async () => {
  await saveSetting("name1", document.getElementById("setName1").value.trim());
  await saveSetting("name2", document.getElementById("setName2").value.trim());
  await saveSetting("anniv", document.getElementById("setAnniv").value);
  updateHero();
  alert("设置已保存");
});

// ===== Hero BG Upload =====
document.getElementById("heroBg").addEventListener("dblclick", () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const imgData = await compressImage(file, 1600, 0.7);
    await saveSetting("heroBg", imgData);
    updateHero();
  };
  input.click();
});

// ===== Export / Clear =====
document.getElementById("exportData").addEventListener("click", async () => {
  const [photos, timeline, messages, settingsArr] = await Promise.all([
    dbGetAll("photos"), dbGetAll("timeline"), dbGetAll("messages"),
    openDB().then(db => new Promise(res => {
      const tx = db.transaction("settings", "readonly");
      const req = tx.objectStore("settings").getAll();
      req.onsuccess = () => { db.close(); res(req.result); };
    }))
  ]);
  const data = { photos, timeline, messages, settings: settingsArr, exportTime: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "our-memory-backup.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById("clearData").addEventListener("click", async () => {
  if (!confirm("确定要清空所有数据吗？此操作不可恢复！")) return;
  if (!confirm("再次确认：所有照片、记录和留言都将被删除。")) return;
  await Promise.all([dbClear("photos"), dbClear("timeline"), dbClear("messages")]);
  renderPhotos(); renderTimeline(); renderMessages();
  alert("数据已清空");
});

// ===== Tab Navigation =====
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", async () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    tab.classList.add("active");
    const name = tab.dataset.tab;
    document.getElementById("tab-" + name).classList.add("active");
    if (name === "photos") renderPhotos();
    if (name === "timeline") renderTimeline();
    if (name === "messages") renderMessages();
    if (name === "settings") updateHero();
  });
});

// ===== Modal Close =====
document.querySelectorAll(".modal-overlay").forEach(m => {
  m.addEventListener("click", (e) => {
    if (e.target === m) m.classList.remove("active");
  });
});
document.querySelectorAll(".modal-close").forEach(btn => {
  btn.addEventListener("click", () => btn.closest(".modal-overlay").classList.remove("active"));
});

// ===== Init =====
updateHero();
renderPhotos();
renderTimeline();
renderMessages();
