const xhsProfilePattern = /^\/user\/profile\/([A-Za-z0-9]+)\/?$/;

function isHttpUrl(url) {
  return /^https?:$/.test(url.protocol);
}

function isXiaohongshuHost(url) {
  const hostname = url.hostname.toLowerCase();
  return hostname === "xiaohongshu.com" || hostname.endsWith(".xiaohongshu.com");
}

function decodeRedirectPath(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function canonicalXhsProfileUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    return "";
  }
  if (!isHttpUrl(url) || !isXiaohongshuHost(url)) return "";

  if (url.pathname === "/login") {
    const redirectPath = url.searchParams.get("redirectPath") || "";
    if (!redirectPath) return "";
    try {
      url = new URL(decodeRedirectPath(redirectPath), "https://www.xiaohongshu.com");
    } catch {
      return "";
    }
  }

  const match = url.pathname.match(xhsProfilePattern);
  if (!match || !isXiaohongshuHost(url)) return "";
  return `https://www.xiaohongshu.com/user/profile/${match[1]}`;
}

export async function resolveSourceIntakeUrl(url, fetchImpl = fetch) {
  const parsed = new URL(url);
  if (!isHttpUrl(parsed)) throw new Error("only http(s) links are supported");
  if (parsed.hostname.toLowerCase() !== "xhslink.cn") {
    const canonicalXhs = canonicalXhsProfileUrl(parsed);
    if (isXiaohongshuHost(parsed)) {
      if (!canonicalXhs) throw new Error("Xiaohongshu source intake currently expects a blogger profile page");
      return canonicalXhs;
    }
    return url;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      credentials: "omit",
      signal: controller.signal
    });
    await response.arrayBuffer().catch(() => {});
    const finalUrl = canonicalXhsProfileUrl(response.url || response.headers.get("location") || "");
    if (!finalUrl) {
      throw new Error("short link did not resolve to a Xiaohongshu profile page; paste the final profile URL");
    }
    return finalUrl;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("short link resolution timed out; paste the final profile URL");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
