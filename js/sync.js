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
  
  // Populate sync UI
  const tokenInput = document.getElementById("syncToken");
  const repoInput = document.getElementById("syncRepo");
  if (tokenInput) tokenInput.value = syncConfig.token || "";
  if (repoInput) repoInput.value = syncConfig.repo || "lovers-memory";
  
  // Save sync config
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
