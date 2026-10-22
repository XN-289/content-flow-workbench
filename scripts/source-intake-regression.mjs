import assert from "node:assert/strict";
import {
  SOURCE_INTAKE_ROUTES,
  SOURCE_INTAKE_TYPES,
  classifySourceIntakeUrl,
  resolveSourceIntake,
  resolveSourceIntakeUrl
} from "./source-intake.mjs";

let passed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`not ok - ${name}`);
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

function mockResponse(url, { location = "", status = 302 } = {}) {
  return {
    url,
    status,
    headers: new Map(location ? [["location", location]] : []),
    arrayBuffer: async () => new ArrayBuffer(0)
  };
}

await check("direct profile URL is canonicalized", async () => {
  const result = await resolveSourceIntake(
    "https://www.xiaohongshu.com/user/profile/abc123?utm_source=profile"
  );
  assert.equal(result.detectedType, SOURCE_INTAKE_TYPES.profile);
  assert.equal(result.canonicalUrl, "https://www.xiaohongshu.com/user/profile/abc123");
  assert.equal(result.profileId, "abc123");
  assert.equal(result.bestSafeRoute, SOURCE_INTAKE_ROUTES.profile);
  assert.equal(result.requiresBrowserAssistance, true);
  assert.equal(result.existingRecord, null);
});

await check("login redirect path is reduced to a profile identity", async () => {
  const target = "https://www.xiaohongshu.com/user/profile/loginprofile?xsec_token=temporary";
  const input = `https://www.xiaohongshu.com/login?redirectPath=${encodeURIComponent(target)}`;
  const result = await classifySourceIntakeUrl(input);
  assert.equal(result.detectedType, SOURCE_INTAKE_TYPES.profile);
  assert.equal(result.canonicalUrl, "https://www.xiaohongshu.com/user/profile/loginprofile");
});

await check("explore note keeps xsec and share parameters", async () => {
  const input = "https://www.xiaohongshu.com/explore/note123?xsec_token=token-a&xsec_source=pc_share&source=webshare";
  const result = await classifySourceIntakeUrl(input);
  assert.equal(result.detectedType, SOURCE_INTAKE_TYPES.note);
  assert.equal(result.noteId, "note123");
  assert.match(result.canonicalUrl, /\/explore\/note123\?/);
  assert.match(result.canonicalUrl, /xsec_token=token-a/);
  assert.match(result.canonicalUrl, /xsec_source=pc_share/);
  assert.match(result.canonicalUrl, /source=webshare/);
  assert.equal(result.bestSafeRoute, SOURCE_INTAKE_ROUTES.note);
});

await check("discovery item note is recognized", async () => {
  const result = await classifySourceIntakeUrl(
    "https://www.xiaohongshu.com/discovery/item/64abc_def-1?xsec_token=token-b"
  );
  assert.equal(result.detectedType, SOURCE_INTAKE_TYPES.note);
  assert.equal(result.noteId, "64abc_def-1");
  assert.match(result.canonicalUrl, /xsec_token=token-b/);
});

await check("other public URL stays a public-page source", async () => {
  const result = await classifySourceIntakeUrl("https://example.com/posts/42?ref=share#section");
  assert.equal(result.detectedType, SOURCE_INTAKE_TYPES.publicUrl);
  assert.equal(result.canonicalUrl, "https://example.com/posts/42?ref=share#section");
  assert.equal(result.bestSafeRoute, SOURCE_INTAKE_ROUTES.publicPage);
  assert.equal(result.requiresBrowserAssistance, false);
});

await check("non-http schemes are rejected", async () => {
  const result = await classifySourceIntakeUrl("javascript:alert(1)");
  assert.equal(result.detectedType, SOURCE_INTAKE_TYPES.invalid);
  assert.equal(result.ok, false);
  assert.equal(result.bestSafeRoute, SOURCE_INTAKE_ROUTES.manualReview);
});

await check("local and private URLs are rejected", async () => {
  for (const input of [
    "http://localhost:5177/api/state",
    "http://127.0.0.1/private",
    "http://192.168.1.10/admin",
    "http://[::1]/private"
  ]) {
    const result = await classifySourceIntakeUrl(input);
    assert.equal(result.detectedType, SOURCE_INTAKE_TYPES.invalid, input);
    assert.match(result.reason, /private-or-local/);
  }
});

await check("URLs containing credentials are rejected", async () => {
  const result = await classifySourceIntakeUrl("https://user:secret@example.com/article");
  assert.equal(result.detectedType, SOURCE_INTAKE_TYPES.invalid);
  assert.match(result.reason, /credentials/);
});

await check("short link resolves to a profile with credential-free GET", async () => {
  let request = null;
  const result = await classifySourceIntakeUrl("https://xhslink.cn/o/profile-short", {
    fetchImpl: async (input, options) => {
      request = { input, options };
      return mockResponse("https://www.xiaohongshu.com/user/profile/shortprofile");
    }
  });
  assert.equal(request.input, "https://xhslink.cn/o/profile-short");
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.credentials, "omit");
  assert.equal(request.options.redirect, "follow");
  assert.equal(result.detectedType, SOURCE_INTAKE_TYPES.profile);
  assert.equal(result.canonicalUrl, "https://www.xiaohongshu.com/user/profile/shortprofile");
  assert.equal(result.resolvedFromShortLink, true);
});

await check("short link resolves through a login redirect to a note", async () => {
  const target = "https://www.xiaohongshu.com/explore/shortnote?xsec_token=short-token&xsec_source=pc_share";
  const result = await classifySourceIntakeUrl("https://xhslink.cn/o/note-short", {
    fetchImpl: async () => mockResponse(
      `https://www.xiaohongshu.com/login?redirectPath=${encodeURIComponent(target)}`
    )
  });
  assert.equal(result.detectedType, SOURCE_INTAKE_TYPES.note);
  assert.equal(result.noteId, "shortnote");
  assert.match(result.canonicalUrl, /xsec_token=short-token/);
});

await check("short link failure returns a safe manual fallback", async () => {
  const result = await classifySourceIntakeUrl("https://xhslink.cn/o/blocked", {
    fetchImpl: async () => {
      throw new Error("network blocked");
    }
  });
  assert.equal(result.detectedType, SOURCE_INTAKE_TYPES.unresolvedShortLink);
  assert.equal(result.canonicalUrl, "https://xhslink.cn/o/blocked");
  assert.equal(result.bestSafeRoute, SOURCE_INTAKE_ROUTES.manualShortLinkResolution);
  assert.equal(result.requiresBrowserAssistance, true);
  assert.match(result.reason, /network blocked/);
});

await check("short link redirecting outside Xiaohongshu is not followed as a source", async () => {
  const result = await classifySourceIntakeUrl("https://xhslink.cn/o/external", {
    fetchImpl: async () => mockResponse("https://example.com/not-xhs")
  });
  assert.equal(result.detectedType, SOURCE_INTAKE_TYPES.unresolvedShortLink);
  assert.match(result.reason, /did-not-resolve/);
});

await check("existing profile source is matched by profile ID", async () => {
  const state = {
    sources: [{
      id: "source-existing-profile",
      url: "https://www.xiaohongshu.com/user/profile/existingprofile"
    }],
    signals: []
  };
  const result = await classifySourceIntakeUrl(
    "https://www.xiaohongshu.com/user/profile/existingprofile?from=duplicate",
    { state }
  );
  assert.deepEqual(result.existingRecord, {
    entityType: "source",
    id: "source-existing-profile",
    matchedBy: "profileId"
  });
  assert.equal(result.bestSafeRoute, SOURCE_INTAKE_ROUTES.existingRecord);
});

await check("existing note signal is matched by note ID despite different token", async () => {
  const state = {
    sources: [],
    signals: [{
      id: "signal-existing-note",
      noteId: "same-note",
      url: "https://www.xiaohongshu.com/explore/same-note?xsec_token=old-token"
    }]
  };
  const result = await classifySourceIntakeUrl(
    "https://www.xiaohongshu.com/discovery/item/same-note?xsec_token=new-token",
    { context: { state } }
  );
  assert.deepEqual(result.existingRecord, {
    entityType: "signal",
    id: "signal-existing-note",
    matchedBy: "noteId"
  });
  assert.equal(result.nextAction, "open-existing-record");
  assert.equal(result.requiresBrowserAssistance, false);
});

await check("state can be passed directly as the second argument", async () => {
  const state = {
    sources: [],
    signals: [{ id: "signal-direct-state", url: "https://example.com/reused?utm_source=old&ref=old" }]
  };
  const result = await classifySourceIntakeUrl("https://example.com/reused?utm_source=new", state);
  assert.equal(result.existingRecord?.id, "signal-direct-state");
  assert.equal(result.existingRecord?.matchedBy, "url");
});

await check("legacy resolver still returns a canonical string", async () => {
  const result = await resolveSourceIntakeUrl(
    "https://xhslink.cn/o/legacy",
    async (input, options) => {
      assert.equal(input, "https://xhslink.cn/o/legacy");
      assert.equal(options.method, "GET");
      return mockResponse("https://www.xiaohongshu.com/user/profile/legacyprofile");
    }
  );
  assert.equal(result, "https://www.xiaohongshu.com/user/profile/legacyprofile");
});

await check("legacy resolver throws for an unresolved short link", async () => {
  await assert.rejects(
    () => resolveSourceIntakeUrl("https://xhslink.cn/o/failure", async () => {
      throw new Error("unavailable");
    }),
    /unavailable/
  );
});

if (failures.length) {
  console.error(`\nsource-intake regression: ${passed} passed, ${failures.length} failed`);
  process.exitCode = 1;
} else {
  console.log(`\nsource-intake regression: ${passed} passed`);
}
