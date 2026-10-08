export const DEFAULTS = {
  queueUrl: "",
  maxCount: 15,
  maxWaitMinutes: 10,
};

export const COLORS = {
  green: "#16A34A",
  blue: "#2563EB",
  red: "#DC2626",
  gray: "#6B7280",
};

export const QUERY = `query($owner:String!, $name:String!, $branch:String!) {
  repository(owner:$owner, name:$name) {
    mergeQueue(branch:$branch) {
      url
      entries(first:100) {
        totalCount
        nodes { position state enqueuedAt estimatedTimeToMerge pullRequest { number } }
      }
    }
  }
}`;

const QUEUE_URL_RE = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/queue\/([^?#\s]+)/;

// Fine-grained token page prefilled with the permissions this extension needs. GitHub can't
// prefill the repository selection, so the user still picks the repo on that page.
export function tokenUrl(queueUrl) {
  const target = parseQueueUrl(queueUrl);
  const params = new URLSearchParams({
    name: "Merge Queue Badge",
    description: "Read-only access to show the merge queue size on a browser toolbar badge",
    expires_in: "90",
    pull_requests: "read",
    contents: "read",
    metadata: "read",
  });
  if (target) params.set("target_name", target.owner);
  return `https://github.com/settings/personal-access-tokens/new?${params}`;
}

export function parseQueueUrl(url) {
  const m = QUEUE_URL_RE.exec(String(url ?? "").trim());
  if (!m) return null;
  return { owner: m[1], name: m[2], branch: decodeURIComponent(m[3]) };
}

// waitMinutes: largest estimatedTimeToMerge (seconds) among entries, i.e. what a PR joining
// now would wait. Falls back to the age of the oldest entry. null when neither is available.
export function summarize(mergeQueue, now = Date.now()) {
  const nodes = (mergeQueue?.entries?.nodes ?? []).filter(Boolean);
  const count = mergeQueue?.entries?.totalCount ?? nodes.length;
  const unreadable = Math.min(count, 100) - nodes.length > 0;
  const estimates = nodes.map((n) => n.estimatedTimeToMerge).filter((s) => Number.isFinite(s));
  if (estimates.length) {
    return { count, waitMinutes: Math.max(...estimates) / 60, unreadable };
  }
  const enqueued = nodes.map((n) => Date.parse(n.enqueuedAt)).filter(Number.isFinite);
  if (enqueued.length) {
    return { count, waitMinutes: Math.max(0, now - Math.min(...enqueued)) / 60000, unreadable };
  }
  return { count, waitMinutes: null, unreadable };
}

export function colorFor({ count, waitMinutes }, { maxCount, maxWaitMinutes }) {
  if (count > maxCount || (waitMinutes != null && waitMinutes > maxWaitMinutes)) return "red";
  if (count === 0) return "green";
  return "blue";
}

export function tooltipFor(summary, thresholds) {
  const { count, waitMinutes, unreadable } = summary;
  let text = `${count} in merge queue`;
  if (waitMinutes != null) text += `, est. wait ${Math.round(waitMinutes)}m`;
  const reasons = [];
  if (count > thresholds.maxCount) reasons.push(`more than ${thresholds.maxCount} items`);
  if (waitMinutes != null && waitMinutes > thresholds.maxWaitMinutes) {
    reasons.push(`wait over ${thresholds.maxWaitMinutes}m`);
  }
  if (reasons.length) text += ` (${reasons.join(", ")})`;
  if (unreadable) text += ". Token can't read all entries (needs Pull requests: Read)";
  return text;
}

export class QueueError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // "no-token" | "auth" | "no-queue" | "bad-url" | "network"
  }
}

export async function fetchSummary({ queueUrl, token }, fetchImpl = fetch) {
  const target = parseQueueUrl(queueUrl);
  if (!queueUrl) throw new QueueError("bad-url", "Set the merge queue URL in options");
  if (!target) throw new QueueError("bad-url", "Queue URL must look like https://github.com/<owner>/<repo>/queue/<branch>");
  if (!token) throw new QueueError("no-token", "Set a GitHub token in options");
  let res;
  try {
    res = await fetchImpl("https://api.github.com/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables: target }),
    });
  } catch (e) {
    throw new QueueError("network", `Network error: ${e.message}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new QueueError("auth", "GitHub token invalid or lacks access");
  }
  if (!res.ok) throw new QueueError("network", `GitHub returned HTTP ${res.status}`);
  const body = await res.json();
  if (body.errors?.length && !body.data?.repository) {
    const msg = body.errors.map((e) => e.message).join("; ");
    const kind = body.errors.some((e) => e.type === "NOT_FOUND") ? "no-queue" : "auth";
    throw new QueueError(kind, msg);
  }
  const mq = body.data?.repository?.mergeQueue;
  if (!mq) throw new QueueError("no-queue", "No merge queue found");
  return summarize(mq);
}
