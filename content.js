const STORAGE_KEY = "hiddenVideos";
const RESTORE_BAR_ID = "ysh-restore-bar";
const CARD_SELECTORS = [
  "ytd-rich-item-renderer",
  "ytd-grid-video-renderer",
  "ytd-video-renderer",
  "ytd-compact-video-renderer"
];
const OFFICIAL_HIDE_LABELS = [
  "非表示",
  "動画を非表示",
  "興味なし",
  "hide",
  "dismiss",
  "not interested",
  "remove from"
];

let hiddenVideos = {};
let observer;
let activeCard = null;
let floatingButton = null;
let hideFloatingButtonTimer = 0;

init();

async function init() {
  hiddenVideos = await getHiddenVideos();
  ensureFloatingButton();
  hideKnownCards();
  decorateCards();
  updateRestoreBar();
  startObserver();
  window.addEventListener("scroll", updateFloatingButtonPosition, true);
  window.addEventListener("resize", updateFloatingButtonPosition);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[STORAGE_KEY]) return;
    hiddenVideos = changes[STORAGE_KEY].newValue || {};
    hideKnownCards();
    decorateCards();
    updateRestoreBar();
  });
}

function startObserver() {
  observer = new MutationObserver(() => {
    hideKnownCards();
    decorateCards();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

function getCards() {
  return CARD_SELECTORS.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
}

function decorateCards() {
  for (const card of getCards()) {
    const video = readVideo(card);
    if (!video.id) continue;

    if (card.dataset.yshReady === "true" && card.dataset.yshVideoId === video.id) continue;

    card.dataset.yshReady = "true";
    card.dataset.yshVideoId = video.id;
    card.classList.toggle("ysh-card-hidden", Boolean(hiddenVideos[video.id]));

    card.classList.add("ysh-hide-target");
    wireCardVisibilityState(card);
  }
}

function wireCardVisibilityState(card) {
  if (card.dataset.yshVisibilityReady === "true") return;

  card.dataset.yshVisibilityReady = "true";
  card.addEventListener("pointerenter", () => showFloatingButtonForCard(card));
  card.addEventListener("pointermove", () => showFloatingButtonForCard(card));
  card.addEventListener("pointerdown", () => showFloatingButtonForCard(card));
  card.addEventListener("focusin", () => showFloatingButtonForCard(card));
  card.addEventListener("pointerleave", scheduleFloatingButtonHide);
  card.addEventListener("focusout", () => {
    if (!card.matches(":hover")) scheduleFloatingButtonHide();
  });
}

function ensureFloatingButton() {
  if (floatingButton) return floatingButton;

  floatingButton = document.createElement("button");
  floatingButton.className = "ysh-hide-button";
  floatingButton.type = "button";
  floatingButton.title = "この動画を非表示";
  floatingButton.setAttribute("aria-label", "この動画を非表示");
  floatingButton.textContent = "非表示";
  floatingButton.addEventListener("pointerenter", () => {
    window.clearTimeout(hideFloatingButtonTimer);
  });
  floatingButton.addEventListener("pointerleave", scheduleFloatingButtonHide);
  floatingButton.addEventListener("click", hideActiveVideo);

  document.documentElement.appendChild(floatingButton);
  return floatingButton;
}

function showFloatingButtonForCard(card) {
  if (card.classList.contains("ysh-card-hidden")) return;

  activeCard = card;
  window.clearTimeout(hideFloatingButtonTimer);
  updateFloatingButtonPosition();
  ensureFloatingButton().classList.add("ysh-hide-button-visible");
}

function scheduleFloatingButtonHide() {
  window.clearTimeout(hideFloatingButtonTimer);
  hideFloatingButtonTimer = window.setTimeout(() => {
    if (floatingButton?.matches(":hover") || activeCard?.matches(":hover")) return;
    activeCard = null;
    floatingButton?.classList.remove("ysh-hide-button-visible");
  }, 160);
}

function updateFloatingButtonPosition() {
  if (!activeCard || !floatingButton) return;
  if (!document.documentElement.contains(activeCard)) {
    activeCard = null;
    floatingButton.classList.remove("ysh-hide-button-visible");
    return;
  }

  const target = getThumbnailTarget(activeCard) || activeCard;
  const rect = target.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;

  floatingButton.style.left = `${Math.max(8, rect.left + 8)}px`;
  floatingButton.style.top = `${Math.max(8, rect.top + 8)}px`;
}

function getThumbnailTarget(card) {
  return (
    card.querySelector("a#thumbnail") ||
    card.querySelector("#thumbnail") ||
    card.querySelector("a.ytd-thumbnail") ||
    card.querySelector("a[href*='/watch']")
  );
}

async function hideActiveVideo(event) {
  event.preventDefault();
  event.stopPropagation();

  const card = activeCard;
  if (!card) return;

  floatingButton.disabled = true;
  floatingButton.textContent = "処理中";

  const usedOfficialHide = await hideVideoWithYouTubeMenu(card);
  if (usedOfficialHide) {
    showToast("YouTubeで非表示にしました");
    activeCard = null;
    floatingButton.classList.remove("ysh-hide-button-visible");
    floatingButton.disabled = false;
    floatingButton.textContent = "非表示";
    return;
  }

  await hideVideoLocally(card, readVideo(card));
  activeCard = null;
  floatingButton.classList.remove("ysh-hide-button-visible");
  floatingButton.disabled = false;
  floatingButton.textContent = "非表示";
}

function hideKnownCards() {
  for (const card of getCards()) {
    const video = readVideo(card);
    if (video.id && hiddenVideos[video.id]) {
      card.classList.add("ysh-card-hidden");
    }
  }
}

async function hideVideoWithYouTubeMenu(card) {
  const menuButton = findActionMenuButton(card);
  if (!menuButton) return false;

  menuButton.click();

  const menuItem = await waitForOfficialHideMenuItem();
  if (!menuItem) {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return false;
  }

  menuItem.click();
  return true;
}

function findActionMenuButton(card) {
  const selectors = [
    "ytd-menu-renderer button#button",
    "ytd-menu-renderer yt-icon-button button",
    "button[aria-label*='操作']",
    "button[aria-label*='その他']",
    "button[aria-label*='Action']",
    "button[aria-label*='More']"
  ];

  for (const selector of selectors) {
    const buttons = Array.from(card.querySelectorAll(selector));
    const button = buttons.find((candidate) => {
      return !candidate.classList.contains("ysh-hide-button") && isVisible(candidate);
    });
    if (button) return button;
  }

  return null;
}

async function waitForOfficialHideMenuItem() {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 1400) {
    const item = findOfficialHideMenuItem();
    if (item) return item;
    await delay(80);
  }

  return null;
}

function findOfficialHideMenuItem() {
  const menuItems = Array.from(
    document.querySelectorAll(
      [
        "ytd-menu-service-item-renderer",
        "tp-yt-paper-item",
        "yt-list-item-view-model",
        "[role='menuitem']"
      ].join(",")
    )
  );

  return menuItems.find((item) => {
    if (!isVisible(item)) return false;

    const label = normalizeText(item.textContent);
    return OFFICIAL_HIDE_LABELS.some((candidate) => label.includes(candidate));
  });
}

function normalizeText(text) {
  return (text || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function isVisible(element) {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function hideVideoLocally(card, video) {
  if (!video.id) return;

  hiddenVideos = {
    ...hiddenVideos,
    [video.id]: {
      id: video.id,
      title: video.title || "タイトル不明",
      channel: video.channel || "チャンネル不明",
      url: video.url || `https://www.youtube.com/watch?v=${video.id}`,
      hiddenAt: new Date().toISOString()
    }
  };

  card.classList.add("ysh-card-hidden");
  await chrome.storage.local.set({ [STORAGE_KEY]: hiddenVideos });
  showToast("公式メニューが見つからないため、この端末だけで非表示にしました");
  updateRestoreBar();
}

function readVideo(card) {
  const link = card.querySelector("a[href*='/watch?v=']");
  const url = link ? new URL(link.href, location.origin) : null;
  const id = url?.searchParams.get("v") || card.dataset.yshVideoId || "";

  const titleElement =
    card.querySelector("#video-title") ||
    card.querySelector("a#video-title-link") ||
    card.querySelector("yt-formatted-string[aria-label]");

  const channelElement =
    card.querySelector("ytd-channel-name a") ||
    card.querySelector("#channel-name a") ||
    card.querySelector(".ytd-channel-name a");

  const title =
    titleElement?.textContent?.trim() ||
    titleElement?.getAttribute("title") ||
    titleElement?.getAttribute("aria-label") ||
    "";

  const channel = channelElement?.textContent?.trim() || "";

  return {
    id,
    title,
    channel,
    url: url?.href || ""
  };
}

async function getHiddenVideos() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY] || {};
}

function updateRestoreBar() {
  const count = Object.keys(hiddenVideos).length;
  let bar = document.getElementById(RESTORE_BAR_ID);

  if (!count) {
    bar?.remove();
    return;
  }

  if (!bar) {
    bar = document.createElement("div");
    bar.id = RESTORE_BAR_ID;

    const label = document.createElement("span");
    label.className = "ysh-restore-label";

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "すべて表示に戻す";
    button.addEventListener("click", restoreAllVideos);

    bar.append(label, button);
    document.documentElement.appendChild(bar);
  }

  const label = bar.querySelector(".ysh-restore-label");
  label.textContent = `${count}件の動画を非表示中`;
}

async function restoreAllVideos() {
  hiddenVideos = {};
  await chrome.storage.local.set({ [STORAGE_KEY]: hiddenVideos });

  for (const card of getCards()) {
    card.classList.remove("ysh-card-hidden");
  }

  updateRestoreBar();
  showToast("すべて表示に戻しました");
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "ysh-toast";
  toast.textContent = message;
  document.documentElement.appendChild(toast);

  window.setTimeout(() => {
    toast.classList.add("ysh-toast-out");
    window.setTimeout(() => toast.remove(), 180);
  }, 1400);
}
