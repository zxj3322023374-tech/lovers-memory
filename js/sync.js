// ===== Cloud Sync Module =====
// Uses GitHub API to sync data.json between devices
// Both users share the same repo and token

const SYNC_FILE = "sync-data.json";
let syncConfig = { token: "", repo: "lovers-memory" };

// Load sync config from IndexedDB (via settings)
async function loadSyncConfig() {
  const s = await loadSettings();
  if (s.syncToken) syncConfig.token = s.syncToken;
  if (s.syncRepo) syncConfig.repo = s.syncRepo;
}

// Base64 encode/decode helpers
function base64Encode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function base64Decode(str) {
  return decodeURIComponent(escape(atob(str)));
}

// Export all data from IndexedDB
async function exportAllData() {
  const [photos, timeline, messages, settings] = await Promise.all([
    dbGetAll("photos"),
    dbGetAll("timeline"),
    dbGetAll("messages"),
    openDB().then(db => new Promise(res => {
      const tx = db.transaction("settings", "readonly");
      const req = tx.objectStore("settings").getAll();
      req.onsuccess = () => { db.close(); res(req.result); };
    }))
  ]);
  return { photos, timeline, messages, settings, lastSync: Date.now() };
}

// Import all data to IndexedDB
async function importAllData(data) {
  const stores = ["photos", "timeline", "messages"];
  for (const store of stores) {
    await dbClear(store);
    for (const item of (data[store] || [])) {
      await dbPut(store, item);
    }
  }
  await dbClear("settings");
  for (const item of (data.settings || [])) {
    await dbPut("settings", item);
  }
}

// Push data to GitHub
async function pushToCloud() {
  if (!syncConfig.token) return { success: false, msg: "未配置 Token" };
  
  const data = await exportAllData();
  const json = JSON.stringify(data);
  const content = base64Encode(json);
  const url = `https://api.github.com/repos/zxj3322023374-tech/${syncConfig.repo}/contents/${SYNC_FILE}`;
  
  // First, GET to get SHA
  let sha = null;
  try {
    const getReq = new Request(url);
    getReq.headers.set("Authorization", "token " + syncConfig.token);
    getReq.headers.set("Accept", "application/vnd.github+json");
    const getResp = await fetch(getReq);
    if (getResp.ok) {
      const getData = await getResp.json();
      sha = getData.sha;
    }
  } catch (e) { /* file doesn't exist yet */ }
  
  // PUT to save
  const body = JSON.stringify({
    message: "Sync: " + new Date().toLocaleString("zh-CN"),
    content: content,
    ...(sha ? { sha } : {})
  });
  
  try {
    const putResp = await fetch(url, {
      method: "PUT",
      headers: {
        "Authorization": "token " + syncConfig.token,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json"
      },
      body: body
    });
    if (!putResp.ok) {
      const err = await putResp.json();
      return { success: false, msg: err.message || "推送失败" };
    }
    return { success: true, msg: "同步成功 " + new Date().toLocaleTimeString("zh-CN") };
  } catch (e) {
    return { success: false, msg: "网络错误: " + e.message };
  }
}

// Pull data from GitHub
async function pullFromCloud() {
  if (!syncConfig.token) return { success: false, msg: "未配置 Token" };
  
  const url = `https://api.github.com/repos/zxj3322023374-tech/${syncConfig.repo}/contents/${SYNC_FILE}`;
  
  try {
    const resp = await fetch(url, {
      headers: {
        "Authorization": "token " + syncConfig.token,
        "Accept": "application/vnd.github+json"
      }
    });
    if (!resp.ok) {
      if (resp.status === 404) return { success: false, msg: "云端暂无数据" };
      const err = await resp.json();
      return { success: false, msg: err.message || "拉取失败" };
    }
    const data = await resp.json();
    const json = base64Decode(data.content.replace(/\n/g, ""));
    const parsed = JSON.parse(json);
    await importAllData(parsed);
    return { success: true, msg: "拉取成功 " + new Date().toLocaleTimeString("zh-CN") };
  } catch (e) {
    return { success: false, msg: "网络错误: " + e.message };
  }
}


// ===== Auto Sync =====
let autoSyncEnabled = false;
let lastSyncHash = "";
let syncTimer = null;
let pushDebounce = null;

// Get a hash of all current data
async function getDataHash() {
  const data = await exportAllData();
  delete data.lastSync;
  return btoa(JSON.stringify(data).substring(0, 200));
}

// Debounced push (wait 3s after last change before pushing)
function schedulePush() {
  if (!autoSyncEnabled || !syncConfig.token) return;
  if (pushDebounce) clearTimeout(pushDebounce);
  pushDebounce = setTimeout(async () => {
    const hash = await getDataHash();
    if (hash !== lastSyncHash) {
      const result = await pushToCloud();
      if (result.success) {
        lastSyncHash = hash;
        setSyncStatus("已自动同步 " + new Date().toLocaleTimeString("zh-CN"), true);
      }
    }
  }, 3000);
}

// Periodic pull every 60s
async function startAutoSync() {
  if (!autoSyncEnabled || !syncConfig.token) return;
  
  // Initial pull on enable
  const pullResult = await pullFromCloud();
  if (pullResult.success) {
    lastSyncHash = await getDataHash();
    await updateHero();
    renderPhotos();
    renderTimeline();
    renderMessages();
    setSyncStatus("已连接云端", true);
  }
  
  // Schedule periodic pulls
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = setInterval(async () => {
    try {
      await pullFromCloud();
      const hash = await getDataHash();
      if (hash !== lastSyncHash) {
        lastSyncHash = hash;
        updateHero(); renderPhotos(); renderTimeline(); renderMessages();
        setSyncStatus("云端有更新", true);
      }
    } catch(e) { /* silent */ }
  }, 60000);
  
  // Also pull on page focus
  window.addEventListener("focus", async () => {
    if (!autoSyncEnabled) return;
    try {
      await pullFromCloud();
      const hash = await getDataHash();
      if (hash !== lastSyncHash) {
        lastSyncHash = hash;
        updateHero(); renderPhotos(); renderTimeline(); renderMessages();
      }
    } catch(e) { /* silent */ }
  });
  
  // Push on page blur
  window.addEventListener("beforeunload", async () => {
    if (!autoSyncEnabled) return;
    await pushToCloud();
  });
}

// Hook into app's data flow - patch dbPut to trigger schedulePush
const _originalDbPut = dbPut;
dbPut = async function(store, data) {
  const result = await _originalDbPut(store, data);
  schedulePush();
  return result;
};
const _originalDbDelete = dbDelete;
dbDelete = async function(store, id) {
  const result = await _originalDbDelete(store, id);
  schedulePush();
  return result;
};
const _originalDbClear = dbClear;
dbClear = async function(store) {
  const result = await _originalDbClear(store);
  schedulePush();
  return result;
};

// ===== UI Handlers =====
let syncAutoInterval = null;

function setSyncStatus(text, ok = true) {
  const el = document.getElementById("syncStatus");
  if (el) {
    el.textContent = text;
    el.style.color = ok ? "var(--text-tertiary)" : "#c06050";
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadSyncConfig();
  // Load auto-sync setting
  autoSyncEnabled = (await loadSettings()).autoSync === "1";
  const autoSyncCheckbox = document.getElementById("autoSync");
  if (autoSyncCheckbox) autoSyncCheckbox.checked = autoSyncEnabled;
  if (autoSyncEnabled) startAutoSync();
  
  // Populate sync UI
  const tokenInput = document.getElementById("syncToken");
  const repoInput = document.getElementById("syncRepo");
  if (tokenInput) tokenInput.value = syncConfig.token || "";
  if (repoInput) repoInput.value = syncConfig.repo || "lovers-memory";
  
  // Save sync config
  // Auto sync toggle
const autoSyncCheckbox = document.getElementById("autoSync");
if (autoSyncCheckbox) {
  autoSyncCheckbox.checked = autoSyncEnabled;
  autoSyncCheckbox.addEventListener("change", async () => {
    autoSyncEnabled = autoSyncCheckbox.checked;
    await saveSetting("autoSync", autoSyncEnabled ? "1" : "0");
    if (autoSyncEnabled) {
      startAutoSync();
    } else {
      if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
      setSyncStatus("已关闭自动同步", true);
    }
  });
}

document.getElementById("saveSync").addEventListener("click", async () => {
    syncConfig.token = document.getElementById("syncToken").value.trim();
    syncConfig.repo = document.getElementById("syncRepo").value.trim() || "lovers-memory";
    await saveSetting("syncToken", syncConfig.token);
    await saveSetting("syncRepo", syncConfig.repo);
    setSyncStatus("配置已保存", true);
  });
  
  // Push button
  document.getElementById("pushDataBtn").addEventListener("click", async () => {
    setSyncStatus("正在推送...");
    const result = await pushToCloud();
    setSyncStatus(result.msg, result.success);
  });
  
  // Pull button
  document.getElementById("pullDataBtn").addEventListener("click", async () => {
    setSyncStatus("正在拉取...");
    const result = await pullFromCloud();
    setSyncStatus(result.msg, result.success);
    if (result.success) {
      // Refresh all views
      await updateHero();
      await renderPhotos();
      await renderTimeline();
      await renderMessages();
    }
  });
});

