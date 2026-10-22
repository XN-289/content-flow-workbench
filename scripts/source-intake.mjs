import { isIP } from "node:net";

const xhsProfilePattern = /^\/user\/profile\/([A-Za-z0-9_-]+)\/?$/;
const xhsNotePattern = /^\/(?:explore|discovery\/item)\/([A-Za-z0-9_-]+)\/?$/;
const defaultTimeoutMs = 8000;

export const SOURCE_INTAKE_TYPES = Object.freeze({
  profile: "xhs-profile",
  note: "xhs-note",
  publicUrl: "public-url",
  invalid: "invalid",
  unresolvedShortLink: "xhs-short-link-unresolved"
});

export const SOURCE_INTAKE_ROUTES = Object.freeze({
  existingRecord: "open-existing-record",
  profile: "browser-assisted-profile",
  note: "browser-assisted-note",
  publicPage: "public-page",
  xhsPublicPage: "browser-assisted-public-page",
  manualReview: "manual-review",
  manualShortLinkResolution: "manual-short-link-resolution"
});

function isHttpUrl(url) {
  return /^https?:$/.test(url.protocol);
}

function normalizedHostname(hostname = "") {
  return String(hostname).toLowerCase().replace(/\.$/, "");
}

function isXiaohongshuHost(url) {
  const hostname = normalizedHostname(url.hostname);
  return hostname === "xiaohongshu.com" || hostname.endsWith(".xiaohongshu.com");
}

function isXhsShortHost(url) {
  const hostname = normalizedHostname(url.hostname);
  return hostname === "xhslink.cn" || hostname.endsWith(".xhslink.cn");
}

function decodeRedirectPath(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function unwrapXhsLoginUrl(value) {
  let url = value instanceof URL ? new URL(value.toString()) : new URL(String(value));
  for (let attempt = 0; attempt < 3 && isXiaohongshuHost(url) && url.pathname === "/login"; attempt += 1) {
    const redirectPath = url.searchParams.get("redirectPath") || "";
    if (!redirectPath) return { url: null, reason: "xiaohongshu-login-url-has-no-redirect-path" };
    try {
      url = new URL(decodeRedirectPath(redirectPath), "https://www.xiaohongshu.com");
    } catch {
      return { url: null, reason: "xiaohongshu-login-redirect-is-invalid" };
    }
    if (!isXiaohongshuHost(url)) {
      return { url: null, reason: "xiaohongshu-login-redirect-is-not-a-xiaohongshu-url" };
    }
  }
  if (isXiaohongshuHost(url) && url.pathname === "/login") {
    return { url: null, reason: "xiaohongshu-login-redirect-is-too-deep" };
  }
  return { url, reason: "" };
}

function xhsProfileId(url) {
  return url.pathname.match(xhsProfilePattern)?.[1] || "";
}

function xhsNoteId(url) {
  return url.pathname.match(xhsNotePattern)?.[1] || "";
}

export function canonicalXhsProfileUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    return "";
  }
  if (!isHttpUrl(parsed) || !isXiaohongshuHost(parsed)) return "";

  const unwrapped = unwrapXhsLoginUrl(parsed);
  if (!unwrapped.url) return "";
  const profileId = xhsProfileId(unwrapped.url);
  return profileId ? `https://www.xiaohongshu.com/user/profile/${profileId}` : "";
}

function canonicalXhsNote(value) {
  let parsed;
  try {
    parsed = value instanceof URL ? new URL(value.toString()) : new URL(String(value || "").trim());
  } catch {
    return { canonicalUrl: "", noteId: "" };
  }
  if (!isHttpUrl(parsed) || !isXiaohongshuHost(parsed)) {
    return { canonicalUrl: "", noteId: "" };
  }

  const unwrapped = unwrapXhsLoginUrl(parsed);
  if (!unwrapped.url) return { canonicalUrl: "", noteId: "" };
  const noteId = xhsNoteId(unwrapped.url);
  if (!noteId) return { canonicalUrl: "", noteId: "" };

  const canonical = new URL(unwrapped.url.pathname, "https://www.xiaohongshu.com");
  canonical.search = unwrapped.url.search;
  return { canonicalUrl: canonical.toString(), noteId };
}

function isPrivateIpv4(hostname) {
  if (isIP(hostname) !== 4) return false;
  const octets = hostname.split(".").map(Number);
  const [first, second, third] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0 && [0, 2].includes(third))
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || first >= 224;
}

function isPrivateIpv6(hostname) {
  if (isIP(hostname) !== 6) return false;
  const normalized = hostname.toLowerCase();
  return normalized === "::"
    || normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || /^fe[89ab]/.test(normalized)
    || normalized.startsWith("::ffff:127.")
    || normalized.startsWith("::ffff:10.")
    || normalized.startsWith("::ffff:192.168.");
}

function isUnsafeHostname(hostname) {
  const host = normalizedHostname(hostname).replace(/^\[|\]$/g, "");
  return !host
    || host === "localhost"
    || host.endsWith(".localhost")
    || host.endsWith(".local")
    || host.endsWith(".internal")
    || host.endsWith(".home.arpa")
    || (!host.includes(".") && isIP(host) === 0)
    || isPrivateIpv4(host)
    || isPrivateIpv6(host);
}

function publicUrlResult(inputUrl, canonicalUrl) {
  return {
    ok: true,
    inputUrl,
    detectedType: SOURCE_INTAKE_TYPES.publicUrl,
    canonicalUrl,
    platform: "other",
    profileId: "",
    noteId: "",
    existingRecord: null,
    bestSafeRoute: SOURCE_INTAKE_ROUTES.publicPage,
    nextAction: "collect-public-page",
    requiresBrowserAssistance: false,
    resolvedFromShortLink: false,
    warnings: []
  };
}

function invalidResult(inputUrl, reason) {
  return {
    ok: false,
    inputUrl,
    detectedType: SOURCE_INTAKE_TYPES.invalid,
    canonicalUrl: "",
    platform: "",
    profileId: "",
    noteId: "",
    existingRecord: null,
    bestSafeRoute: SOURCE_INTAKE_ROUTES.manualReview,
    nextAction: "paste-valid-public-url",
    requiresBrowserAssistance: false,
    resolvedFromShortLink: false,
    reason,
    warnings: []
  };
}

function unresolvedShortLinkResult(inputUrl, reason, status = "") {
  const result = {
    ok: false,
    inputUrl,
    detectedType: SOURCE_INTAKE_TYPES.unresolvedShortLink,
    canonicalUrl: inputUrl,
    platform: "xiaohongshu",
    profileId: "",
    noteId: "",
    existingRecord: null,
    bestSafeRoute: SOURCE_INTAKE_ROUTES.manualShortLinkResolution,
    nextAction: "open-short-link-and-paste-final-url",
    requiresBrowserAssistance: true,
    resolvedFromShortLink: true,
    reason,
    warnings: ["short-link-was-not-resolved-to-a-supported-xiaohongshu-url"]
  };
  if (status) result.httpStatus = status;
  return result;
}

function stateFromContext(context) {
  if (!context || typeof context !== "object") return null;
  if (Array.isArray(context.sources) || Array.isArray(context.signals)) return context;
  if (context.state && typeof context.state === "object") return context.state;
  if (context.data && typeof context.data === "object") return context.data;
  return null;
}

function recordUrls(record) {
  if (!record || typeof record !== "object") return [];
  return ["url", "sourceUrl", "profileUrl", "pageUrl", "canonicalUrl", "normalizedUrl"]
    .map((field) => String(record[field] || "").trim())
    .filter(Boolean);
}

function comparableUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    const canonicalParams = new URLSearchParams();
    for (const key of [...url.searchParams.keys()].sort()) {
      if (/^(utm_|ref$|spm$)/i.test(key)) continue;
      for (const paramValue of url.searchParams.getAll(key)) {
        canonicalParams.append(key, paramValue);
      }
    }
    url.search = canonicalParams.toString();
    return url.toString();
  } catch {
    return "";
  }
}

function matchingRecord(records, target) {
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    if (target.noteId && String(record.noteId || record.contentId || "").trim() === target.noteId) {
      return { record, matchedBy: "noteId" };
    }
    for (const value of recordUrls(record)) {
      let url;
      try {
        url = new URL(value);
      } catch {
        continue;
      }
      const parsed = isXiaohongshuHost(url) ? unwrapXhsLoginUrl(url).url : url;
      if (!parsed) continue;
      if (target.noteId && isXiaohongshuHost(parsed) && xhsNoteId(parsed) === target.noteId) {
        return { record, matchedBy: "noteId" };
      }
      if (target.profileId && isXiaohongshuHost(parsed) && xhsProfileId(parsed) === target.profileId) {
        return { record, matchedBy: "profileId" };
      }
      if (target.canonicalUrl && comparableUrl(value) === comparableUrl(target.canonicalUrl)) {
        return { record, matchedBy: "url" };
      }
    }
  }
  return null;
}

function findExistingRecord(context, target) {
  const state = stateFromContext(context);
  if (!state) return null;

  const collections = [
    ["signal", Array.isArray(state.signals) ? state.signals : []],
    ["source", Array.isArray(state.sources) ? state.sources : []]
  ];
  for (const [entityType, records] of collections) {
    const match = matchingRecord(records, target);
    if (!match) continue;
    return {
      entityType,
      id: String(match.record.id || ""),
      matchedBy: match.matchedBy
    };
  }
  return null;
}

function withExistingRecord(result, context) {
  const existingRecord = findExistingRecord(context, result);
  if (!existingRecord) return result;
  return {
    ...result,
    existingRecord,
    bestSafeRoute: SOURCE_INTAKE_ROUTES.existingRecord,
    nextAction: "open-existing-record",
    requiresBrowserAssistance: false
  };
}

function classifyXiaohongshuUrl(parsed, inputUrl, context, options = {}) {
  const unwrapped = unwrapXhsLoginUrl(parsed);
  if (!unwrapped.url) return invalidResult(inputUrl, unwrapped.reason);
  const target = unwrapped.url;
  const profileId = xhsProfileId(target);
  if (profileId) {
    return withExistingRecord({
      ok: true,
      inputUrl,
      detectedType: SOURCE_INTAKE_TYPES.profile,
      canonicalUrl: `https://www.xiaohongshu.com/user/profile/${profileId}`,
      platform: "xiaohongshu",
      profileId,
      noteId: "",
      existingRecord: null,
      bestSafeRoute: SOURCE_INTAKE_ROUTES.profile,
      nextAction: "import-profile-source",
      requiresBrowserAssistance: true,
      resolvedFromShortLink: Boolean(options.resolvedFromShortLink),
      warnings: ["public-browser-session-may-stop-at-login-or-verification"]
    }, context);
  }

  const note = canonicalXhsNote(target);
  if (note.noteId) {
    return withExistingRecord({
      ok: true,
      inputUrl,
      detectedType: SOURCE_INTAKE_TYPES.note,
      canonicalUrl: note.canonicalUrl,
      platform: "xiaohongshu",
      profileId: "",
      noteId: note.noteId,
      existingRecord: null,
      bestSafeRoute: SOURCE_INTAKE_ROUTES.note,
      nextAction: "capture-note-then-transcribe",
      requiresBrowserAssistance: true,
      resolvedFromShortLink: Boolean(options.resolvedFromShortLink),
      warnings: ["public-browser-session-may-stop-at-login-or-verification"]
    }, context);
  }

  return withExistingRecord({
    ok: true,
    inputUrl,
    detectedType: SOURCE_INTAKE_TYPES.publicUrl,
    canonicalUrl: target.toString(),
    platform: "xiaohongshu",
    profileId: "",
    noteId: "",
    existingRecord: null,
    bestSafeRoute: SOURCE_INTAKE_ROUTES.xhsPublicPage,
    nextAction: "open-public-page-with-browser-assistance",
    requiresBrowserAssistance: true,
    resolvedFromShortLink: Boolean(options.resolvedFromShortLink),
    warnings: ["not-a-recognized-xiaohongshu-profile-or-note-url"]
  }, context);
}

function classifyResolvedUrl(parsed, inputUrl, context, options = {}) {
  if (!isHttpUrl(parsed)) return invalidResult(inputUrl, "only-http-and-https-urls-are-supported");
  if (parsed.username || parsed.password) return invalidResult(inputUrl, "credentials-in-urls-are-not-allowed");
  if (isXiaohongshuHost(parsed)) return classifyXiaohongshuUrl(parsed, inputUrl, context, options);
  if (isUnsafeHostname(parsed.hostname)) return invalidResult(inputUrl, "private-or-local-urls-are-not-supported");
  return withExistingRecord(publicUrlResult(inputUrl, parsed.toString()), context);
}

async function releaseResponseBody(response) {
  if (response?.body && typeof response.body.cancel === "function") {
    try {
      await response.body.cancel();
    } catch {
      // A consumed or redirected response may not expose a cancelable body.
    }
    return;
  }
  if (typeof response?.arrayBuffer === "function") {
    await response.arrayBuffer().catch(() => {});
  }
}

async function resolveShortLink(shortUrl, context, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return unresolvedShortLinkResult(shortUrl, "fetch-is-not-available");
  }

  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Math.max(250, Math.min(30000, Number(options.timeoutMs)))
    : defaultTimeoutMs;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(shortUrl, {
      method: "GET",
      redirect: "follow",
      credentials: "omit",
      headers: { accept: "text/html,application/xhtml+xml" },
      signal: controller.signal
    });
    const location = response?.headers?.get?.("location") || "";
    await releaseResponseBody(response);

    const candidates = [response?.url, location].filter(Boolean);
    for (const candidate of candidates) {
      let resolved;
      try {
        resolved = new URL(candidate, shortUrl);
      } catch {
        continue;
      }
      if (!isXiaohongshuHost(resolved)) continue;
      return classifyXiaohongshuUrl(resolved, shortUrl, context, { resolvedFromShortLink: true });
    }
    return unresolvedShortLinkResult(
      shortUrl,
      "short-link-did-not-resolve-to-xiaohongshu",
      response?.status || ""
    );
  } catch (error) {
    const reason = error?.name === "AbortError"
      ? "short-link-resolution-timed-out"
      : `short-link-resolution-failed:${String(error?.message || "unknown-error").slice(0, 200)}`;
    return unresolvedShortLinkResult(shortUrl, reason);
  } finally {
    clearTimeout(timeout);
  }
}

function normaliseOptions(value) {
  if (typeof value === "function") return { fetchImpl: value };
  if (!value || typeof value !== "object") return {};
  if (stateFromContext(value)) return { state: value };
  return value;
}

export async function classifySourceIntakeUrl(value, options = {}) {
  const inputUrl = String(value || "").trim();
  const resolvedOptions = normaliseOptions(options);
  const context = resolvedOptions.state || resolvedOptions.context || null;
  let parsed;
  try {
    parsed = new URL(inputUrl);
  } catch {
    return invalidResult(inputUrl, "url-is-not-valid");
  }
  if (!isHttpUrl(parsed)) return invalidResult(inputUrl, "only-http-and-https-urls-are-supported");
  if (isXhsShortHost(parsed)) {
    if (parsed.username || parsed.password) return invalidResult(inputUrl, "credentials-in-urls-are-not-allowed");
    return resolveShortLink(inputUrl, context, resolvedOptions);
  }
  return classifyResolvedUrl(parsed, inputUrl, context);
}

export async function resolveSourceIntake(value, options = {}) {
  return classifySourceIntakeUrl(value, options);
}

// Kept for existing callers that expect a canonical URL string.
export async function resolveSourceIntakeUrl(value, fetchImpl = fetch) {
  const result = await resolveSourceIntake(value, { fetchImpl });
  if (result.detectedType === SOURCE_INTAKE_TYPES.invalid) {
    throw new Error(result.reason || "invalid source URL");
  }
  if (result.detectedType === SOURCE_INTAKE_TYPES.unresolvedShortLink) {
    throw new Error(result.reason || "short link did not resolve; paste the final Xiaohongshu URL");
  }
  return result.canonicalUrl;
}
