import { DEFAULTS, parseQueueUrl, tokenUrl } from "./queue.js";

const $ = (id) => document.getElementById(id);
const status = (text, cls = "") => {
  $("status").textContent = text;
  $("status").className = cls;
};

function updateTokenLink() {
  const target = parseQueueUrl($("queueUrl").value);
  $("fineLink").href = tokenUrl($("queueUrl").value);
  $("orgNote").textContent = target ? `, with ${target.owner} preselected as the resource owner` : "";
}

async function load() {
  const sync = await chrome.storage.sync.get(DEFAULTS);
  const { token } = await chrome.storage.local.get({ token: "" });
  $("queueUrl").value = sync.queueUrl;
  $("maxCount").value = sync.maxCount;
  $("maxWaitMinutes").value = sync.maxWaitMinutes;
  $("token").value = token;
  updateTokenLink();
}

async function save() {
  const queueUrl = $("queueUrl").value.trim();
  if (!parseQueueUrl(queueUrl)) {
    status("Queue URL must look like https://github.com/<owner>/<repo>/queue/<branch>", "err");
    return false;
  }
  await chrome.storage.sync.set({
    queueUrl,
    maxCount: Number($("maxCount").value),
    maxWaitMinutes: Number($("maxWaitMinutes").value),
  });
  await chrome.storage.local.set({ token: $("token").value.trim() });
  return true;
}

async function test() {
  if (!(await save())) return;
  status("Testing…");
  const r = await chrome.runtime.sendMessage({ type: "refresh" });
  if (r.ok) {
    const { count, waitMinutes, unreadable } = r.summary;
    const wait = waitMinutes == null ? "" : `, est. wait ${Math.round(waitMinutes)}m`;
    const warn = unreadable ? " Token can't read all entries; add Pull requests: Read." : "";
    status(`OK: ${count} in queue${wait}.${warn}`, unreadable ? "err" : "ok");
  } else {
    status(`Error: ${r.message}`, "err");
  }
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (await save()) status("Saved", "ok");
});
$("test").addEventListener("click", test);
$("queueUrl").addEventListener("input", updateTokenLink);
$("reset").addEventListener("click", () => {
  $("maxCount").value = DEFAULTS.maxCount;
  $("maxWaitMinutes").value = DEFAULTS.maxWaitMinutes;
  status("Default thresholds restored in the form; press Save to apply");
});

load();
