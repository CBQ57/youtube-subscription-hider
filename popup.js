const STORAGE_KEY = "hiddenVideos";

const summary = document.getElementById("summary");
const empty = document.getElementById("empty");
const list = document.getElementById("list");
const restoreAll = document.getElementById("restoreAll");

render();

restoreAll.addEventListener("click", async () => {
  await chrome.storage.local.set({ [STORAGE_KEY]: {} });
  await render();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[STORAGE_KEY]) render();
});

async function render() {
  const hiddenVideos = await getHiddenVideos();
  const videos = Object.values(hiddenVideos).sort((a, b) => {
    return new Date(b.hiddenAt || 0) - new Date(a.hiddenAt || 0);
  });

  summary.textContent = `${videos.length}件を端末内で非表示中`;
  empty.hidden = videos.length > 0;
  restoreAll.disabled = videos.length === 0;
  list.replaceChildren(...videos.map((video) => createVideoRow(video, hiddenVideos)));
}

function createVideoRow(video, hiddenVideos) {
  const row = document.createElement("article");
  row.className = "video";

  const title = document.createElement("a");
  title.className = "video-title";
  title.href = video.url || `https://www.youtube.com/watch?v=${video.id}`;
  title.target = "_blank";
  title.rel = "noreferrer";
  title.textContent = video.title || "タイトル不明";

  const meta = document.createElement("p");
  meta.className = "video-meta";
  meta.textContent = `${video.channel || "チャンネル不明"} / ${formatDate(video.hiddenAt)}`;

  const actions = document.createElement("div");
  actions.className = "video-actions";

  const restore = document.createElement("button");
  restore.className = "restore-one";
  restore.type = "button";
  restore.textContent = "表示に戻す";
  restore.addEventListener("click", async () => {
    const next = { ...hiddenVideos };
    delete next[video.id];
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
    await render();
  });

  actions.append(restore);
  row.append(title, meta, actions);
  return row;
}

async function getHiddenVideos() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY] || {};
}

function formatDate(value) {
  if (!value) return "日時不明";

  return new Intl.DateTimeFormat("ja-JP", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
