import { DEFAULTS, COLORS, fetchSummary, colorFor, tooltipFor, QueueError } from "./queue.js";

async function getSettings() {
  const [sync, local] = await Promise.all([
    chrome.storage.sync.get(DEFAULTS),
    chrome.storage.local.get({ token: "" }),
  ]);
  return { ...sync, token: local.token };
}

async function show(text, color, title) {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setTitle({ title });
}

const ERROR_BADGES = {
  "no-token": "?",
  "bad-url": "?",
  auth: "!",
  network: "!",
  "no-queue": "–",
};

export async function refresh() {
  const settings = await getSettings();
  try {
    const summary = await fetchSummary(settings);
    await show(String(summary.count), COLORS[colorFor(summary, settings)], tooltipFor(summary, settings));
    return { ok: true, summary };
  } catch (e) {
    const kind = e instanceof QueueError ? e.kind : "network";
    await show(ERROR_BADGES[kind] ?? "!", COLORS.gray, `Merge queue: ${e.message}`);
    return { ok: false, kind, message: e.message };
  }
}

function ensureAlarm() {
  chrome.alarms.create("refresh", { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  chrome.contextMenus.create({ id: "refresh-now", title: "Refresh now", contexts: ["action"] });
  refresh();
  chrome.storage.sync.get(DEFAULTS).then(({ queueUrl }) => {
    if (!queueUrl) chrome.runtime.openOptionsPage();
  });
});
chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === "refresh-now") refresh();
});
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  refresh();
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "refresh") refresh();
});
chrome.storage.onChanged.addListener(() => refresh());
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "refresh") {
    refresh().then(sendResponse);
    return true;
  }
});
chrome.action.onClicked.addListener(async () => {
  const { queueUrl } = await chrome.storage.sync.get(DEFAULTS);
  if (queueUrl) chrome.tabs.create({ url: queueUrl });
  else chrome.runtime.openOptionsPage();
});
