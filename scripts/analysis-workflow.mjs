import crypto from "node:crypto";

export const analysisSchemaVersion = 2;
export const analysisSourceMode = "transcript-heuristic-v2";

const unverified = "unverified";

function now() {
  return new Date().toISOString();
}

function createAnalysisId(timestamp = now()) {
  return `analysis-${String(timestamp).slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`;
}

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clipText(value = "", limit = 300) {
  const text = cleanText(value);
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1))}…` : text;
}

function countMatches(text, pattern) {
  const matches = String(text || "").match(pattern);
  return matches ? matches.length : 0;
}

function formatTimestamp(value) {
  const totalMs = Math.max(0, Math.round((Number(value) || 0) * 1000));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const milliseconds = totalMs % 1000;
  const prefix = hours > 0 ? `${String(hours).padStart(2, "0")}:` : "";
  return `${prefix}${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function median(values) {
  const sorted = values
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function transcriptSourceType(source = "", model = "") {
  const marker = `${source} ${model}`.toLowerCase();
  if (marker.includes("platform-subtitle")) return "platform-subtitle";
  if (marker.includes("local-asr")) return "local-asr";
  if (/import|manual|human|pasted|visible-page|user-provided/.test(marker)) return "imported";
  return "unknown";
}

function transcriptReviewNote(sourceType) {
  if (sourceType === "platform-subtitle") {
    return "来源为平台字幕轨；文本和时间轴仍需人工校对，字幕缺失片段不能用正文补写。";
  }
  if (sourceType === "local-asr") {
    return "来源为本地 ASR；同音字、断句和术语仍需人工校对。";
  }
  if (sourceType === "imported") {
    return "来源为导入或人工记录；转写来源、完整性和时间轴准确性仍需人工核对。";
  }
  return "逐字稿来源未明确标注；引用和结构判断前必须人工核对。";
}

function transcriptEvidence(signal = {}) {
  const source = String(signal.transcriptSource || "");
  const model = String(signal.transcriptModel || "");
  const sourceType = transcriptSourceType(source, model);
  const transcriptSegments = Array.isArray(signal.transcriptSegments) ? signal.transcriptSegments : [];
  return {
    evidenceState: unverified,
    status: String(signal.transcriptStatus || ""),
    source,
    sourceType,
    model,
    capturedAt: String(signal.transcriptCapturedAt || ""),
    durationSeconds: Number(signal.transcriptDurationSeconds || 0),
    segmentCount: transcriptSegments.length,
    timelineAvailable: transcriptSegments.some((segment) => (
      segment
      && Number.isFinite(Number(segment.start))
      && String(segment.startTimestamp || "").trim()
    )),
    reviewRequired: true,
    reviewNote: transcriptReviewNote(sourceType)
  };
}

function timestampValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  const text = String(value ?? "").trim();
  if (!text) return null;
  const direct = Number(text);
  if (Number.isFinite(direct)) return Math.max(0, direct);
  const parts = text.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

function chapterEvidence(signal, segments) {
  const rawChapters = Array.isArray(signal.chapters) ? signal.chapters : [];
  return rawChapters
    .map((chapter, index) => {
      if (!chapter || typeof chapter !== "object") return null;
      const milliseconds = Number(chapter.timeMilliseconds);
      const startSeconds = timestampValue(
        chapter.startSeconds
        ?? chapter.start
        ?? chapter.startTimestamp
        ?? (Number.isFinite(milliseconds) ? milliseconds / 1000 : null)
      );
      return {
        index,
        title: cleanText(chapter.title),
        startSeconds,
        startTimestamp: cleanText(chapter.startTimestamp)
          || (startSeconds === null ? "" : formatTimestamp(startSeconds))
      };
    })
    .filter((chapter) => chapter && (chapter.title || chapter.startSeconds !== null))
    .sort((left, right) => (left.startSeconds ?? 0) - (right.startSeconds ?? 0))
    .map((chapter, index, chapters) => {
      const nextStart = chapters[index + 1]?.startSeconds ?? Infinity;
      const chapterSegments = chapter.startSeconds === null
        ? []
        : segments.filter((segment) => segment.start >= chapter.startSeconds && segment.start < nextStart);
      return {
        ...chapter,
        index,
        segmentCount: chapterSegments.length,
        transcriptExcerpt: clipText(chapterSegments.map((segment) => segment.text).join(" "), 500)
      };
    });
}

function commentEvidence(signal = {}) {
  const rawComments = Array.isArray(signal.comments) ? signal.comments : [];
  const samples = rawComments
    .filter((comment) => comment && typeof comment === "object" && cleanText(comment.content))
    .map((comment, index) => ({
      index,
      id: cleanText(comment.id),
      content: clipText(comment.content, 600),
      author: cleanText(comment.author),
      likes: Number(comment.likes || 0),
      createdAt: cleanText(comment.createdAt),
      ipLocation: cleanText(comment.ipLocation),
      isAuthor: comment.isAuthor === true,
      subCommentCount: Number(comment.subCommentCount || 0)
    }))
    .sort((left, right) => right.likes - left.likes || left.index - right.index)
    .slice(0, 12)
    .map(({ index: _index, ...comment }, index) => ({ ...comment, sampleIndex: index }));
  const sourceScope = signal.commentScope && typeof signal.commentScope === "object"
    ? signal.commentScope
    : {};
  const capturedCount = Number(sourceScope.capturedCount ?? rawComments.length);
  return {
    evidenceState: unverified,
    scope: {
      ...sourceScope,
      capturedCount: Number.isFinite(capturedCount) ? Math.max(0, capturedCount) : rawComments.length,
      hasMore: sourceScope.hasMore === true,
      complete: sourceScope.complete === true,
      note: cleanText(sourceScope.note)
        || "只保留页面可见或导入的评论样本，不代表全部评论。"
    },
    samples,
    samplesTruncated: rawComments.length > samples.length,
    totalSamplesAvailable: rawComments.length
  };
}

function splitUntimedTranscript(value = "") {
  const text = cleanText(value);
  if (!text) return [];
  const sentences = text.match(/[^。！？!?；;\n]+[。！？!?；;]?/g) || [];
  const chunks = [];
  for (const sentence of sentences.map((item) => item.trim()).filter(Boolean)) {
    let remaining = sentence;
    while (remaining.length > 180) {
      chunks.push(remaining.slice(0, 180));
      remaining = remaining.slice(180);
    }
    if (remaining) chunks.push(remaining);
  }
  return chunks.slice(0, 400);
}

function normalizedSegments(signal, timestamp) {
  const rawSegments = Array.isArray(signal.transcriptSegments) ? signal.transcriptSegments : [];
  const segments = rawSegments
    .map((segment, index) => {
      const text = cleanText(segment?.text);
      const start = Number(segment?.start);
      const end = Number(segment?.end);
      if (!text || !Number.isFinite(start) || start < 0) return null;
      const normalizedEnd = Number.isFinite(end) && end >= start
        ? end
        : (Number(rawSegments?.[index + 1]?.start) || start);
      return {
        index,
        start,
        end: normalizedEnd,
        startTimestamp: segment.startTimestamp || formatTimestamp(start),
        endTimestamp: segment.endTimestamp || formatTimestamp(normalizedEnd),
        text
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
  if (!segments.length) {
    if (rawSegments.length) {
      throw new Error("逐字稿不包含可用的时间轴分段");
    }
    const untimedText = splitUntimedTranscript(signal.transcriptText);
    if (!untimedText.length) {
      throw new Error("逐字稿缺少可分析文本");
    }
    return untimedText.map((text, index) => ({
      index,
      start: null,
      end: null,
      startTimestamp: "",
      endTimestamp: "",
      timingState: "not-provided",
      text,
      analysisTimestamp: timestamp
    }));
  }
  return segments.map((segment, index) => ({
    ...segment,
    index,
    timingState: "provided",
    analysisTimestamp: timestamp
  }));
}

function quoteFromSegments(segments, why, limit = 260) {
  const usable = segments.filter((segment) => segment?.text);
  if (!usable.length) return null;
  return {
    startTimestamp: usable[0].startTimestamp,
    endTimestamp: usable[usable.length - 1].endTimestamp,
    text: clipText(usable.map((segment) => segment.text).join(" "), limit),
    why
  };
}

function detectHookPattern(text) {
  if (/[?？]/.test(text)) return "提问式钩子";
  if (/不是.+而是|反而|其实|但是|却/.test(text)) return "反差式钩子";
  if (/不要|别|千万|阻止你|不想让你|秘密|潜规则/.test(text)) return "警示式钩子";
  if (/我|曾经|后来|有一次/.test(text)) return "自述式钩子";
  if (/\d|[一二三四五六七八九十百千万]/.test(text)) return "数字式钩子";
  return "判断式钩子";
}

function hookAnalysis(segments) {
  const hasTiming = segments.some((segment) => Number.isFinite(segment.start));
  const hookSegments = hasTiming
    ? segments.filter((segment) => segment.start < 15).slice(0, 4)
    : segments.slice(0, 4);
  const selected = hookSegments.length ? hookSegments : segments.slice(0, 2);
  const text = selected.map((segment) => segment.text).join(" ");
  return {
    pattern: detectHookPattern(text),
    quote: quoteFromSegments(selected, "前 15 秒用于快速建立身份、冲突或收益预期。"),
    candidateRead: `候选判断：开头更像“${detectHookPattern(text)}”，用短句先制造认知缺口，再展开解释。`,
    evidenceState: unverified
  };
}

function promiseAnalysis(segments) {
  const hasTiming = segments.some((segment) => Number.isFinite(segment.start));
  const interval = hasTiming ? segments.filter((segment) => segment.start <= 45) : segments.slice(0, 5);
  const pattern = /为什么|如何|怎么|真相|关键|本质|反而|不是.+而是|才能|核心|秘密|潜规则|方法/;
  const matching = interval.filter((segment) => pattern.test(segment.text));
  const selected = (matching.length ? matching : interval).slice(0, 3);
  return {
    quote: quoteFromSegments(selected, "候选承诺或张力：这里开始把具体经历上升为可复用解释。"),
    tension: matching.length ? "问题与反差被显性提出" : "张力主要依赖开头判断，后文才补解释",
    evidenceState: unverified
  };
}

function structureAnalysis(segments) {
  const bucketSize = Math.ceil(segments.length / 4);
  const definitions = [
    {
      id: "opening",
      label: "开头钩子",
      role: "先给判断、冲突或结果预期",
      selector: (text) => detectHookPattern(text)
    },
    {
      id: "problem",
      label: "问题铺陈",
      role: "解释为什么普通做法失效",
      selector: (text) => /普通|很多|大多数|问题|困境|痛苦|为什么|不是/.test(text) ? "问题与处境被具体化" : "铺陈背景与上下文"
    },
    {
      id: "mechanism",
      label: "机制 / 反转",
      role: "给出反常识解释或分点机制",
      selector: (text) => /本质|关键|反而|因为|机制|第一|第二|首先|其次|不是.+而是/.test(text) ? "出现解释机制或反转" : "进入原因与案例拆解"
    },
    {
      id: "close",
      label: "行动收束",
      role: "把理解转成可执行动作或情绪回报",
      selector: (text) => /所以|建议|要|需要|可以|试着|记住|最后|才能真正|才能/.test(text) ? "出现行动建议或结论" : "用态度与判断收束"
    }
  ];
  return definitions.map((definition, index) => {
    const from = index * bucketSize;
    const to = index === definitions.length - 1 ? segments.length : Math.min(segments.length, from + bucketSize);
    const bucket = segments.slice(from, to);
    const fallback = bucket.length ? bucket : segments.slice(-1);
    const text = fallback.map((segment) => segment.text).join(" ");
    return {
      id: definition.id,
      label: definition.label,
      role: definition.role,
      startTimestamp: fallback[0]?.startTimestamp || "",
      endTimestamp: fallback[fallback.length - 1]?.endTimestamp || "",
      candidateSummary: definition.selector(text),
      quote: quoteFromSegments(fallback.slice(0, 3), `${definition.role}。`),
      evidenceState: unverified
    };
  }).filter((part) => part.quote);
}

function pacingAnalysis(signal, segments) {
  const transcriptText = cleanText(signal.transcriptText);
  const characterCount = transcriptText.replace(/\s/g, "").length;
  const hasTiming = segments.some((segment) => Number.isFinite(segment.end));
  const lastEnd = hasTiming
    ? segments.reduce((maximum, segment) => Math.max(maximum, Number(segment.end) || 0), 0)
    : 0;
  const durationSeconds = Math.max(Number(signal.transcriptDurationSeconds) || 0, lastEnd);
  if (!hasTiming || durationSeconds <= 0) {
    return {
      timelineAvailable: false,
      durationSeconds: 0,
      characterCount,
      segmentCount: segments.length,
      charsPerSecond: null,
      segmentsPerMinute: null,
      averageSegmentCharacters: round(
        segments.reduce((total, segment) => total + cleanText(segment.text).replace(/\s/g, "").length, 0)
        / Math.max(1, segments.length),
        1
      ),
      longSegmentCount: segments
        .map((segment) => cleanText(segment.text).replace(/\s/g, "").length)
        .filter((value) => value >= 60).length,
      shortSegmentRatio: round(
        segments
          .map((segment) => cleanText(segment.text).replace(/\s/g, "").length)
          .filter((value) => value <= 10).length / Math.max(1, segments.length),
        2
      ),
      fastestWindow: null,
      candidateRead: "逐字稿没有时间轴，只能判断结构、语言与信息密度；无法判断真实口播节奏。",
      evidenceState: unverified
    };
  }
  const charsPerSecond = durationSeconds > 0 ? characterCount / durationSeconds : 0;
  const segmentsPerMinute = durationSeconds > 0 ? segments.length / (durationSeconds / 60) : 0;
  const segmentLengths = segments.map((segment) => cleanText(segment.text).replace(/\s/g, "").length);
  const fastest = segments
    .map((segment) => {
      const windowSegments = segments.filter((candidate) => candidate.start >= segment.start && candidate.start < segment.start + 15);
      const chars = windowSegments.reduce((total, candidate) => total + candidate.text.replace(/\s/g, "").length, 0);
      return {
        startTimestamp: segment.startTimestamp,
        endTimestamp: windowSegments.at(-1)?.endTimestamp || segment.endTimestamp,
        chars,
        charsPerSecond: chars / 15
      };
    })
    .sort((a, b) => b.chars - a.chars)[0] || null;

  const density = charsPerSecond >= 6
    ? "高密度"
    : charsPerSecond >= 4
      ? "中高密度"
      : charsPerSecond >= 2.5
        ? "中等密度"
        : "留白较多";
  return {
    timelineAvailable: true,
    durationSeconds: round(durationSeconds, 3),
    characterCount,
    segmentCount: segments.length,
    charsPerSecond: round(charsPerSecond, 2),
    segmentsPerMinute: round(segmentsPerMinute, 2),
    averageSegmentCharacters: round(segmentLengths.reduce((total, value) => total + value, 0) / Math.max(1, segmentLengths.length), 1),
    longSegmentCount: segmentLengths.filter((value) => value >= 60).length,
    shortSegmentRatio: round(segmentLengths.filter((value) => value <= 10).length / Math.max(1, segmentLengths.length), 2),
    fastestWindow: fastest ? {
      startTimestamp: fastest.startTimestamp,
      endTimestamp: fastest.endTimestamp,
      charsPerSecond: round(fastest.charsPerSecond, 2)
    } : null,
    candidateRead: `候选判断：整体为${density}口播，平均约 ${round(charsPerSecond, 2)} 字/秒；节奏结论仍需结合真实完播与停留数据。`,
    evidenceState: unverified
  };
}

function audienceSignals(segments) {
  const categories = [
    {
      id: "pain",
      label: "痛点与困境",
      pattern: /社交|朋友|关系|职场|沟通|敏感|孤独|父母|老师|讨好|消耗|焦虑|内耗|没钱|赚钱|普通人/g
    },
    {
      id: "desire",
      label: "欲望与回报",
      pattern: /自由|价值|认可|成长|改变|掌控|松弛|爽|赢|成功|吸引力|被爱|尊重/g
    },
    {
      id: "identity",
      label: "身份与人群",
      pattern: /高敏感|普通人|女生|男生|INFJ|INFP|职场人|年轻人|成年人|同龄人|家庭|小孩/g
    }
  ];
  return categories.map((category) => {
    const counts = segments.map((segment) => ({
      segment,
      count: countMatches(segment.text, category.pattern)
    })).filter((item) => item.count > 0);
    const total = counts.reduce((sum, item) => sum + item.count, 0);
    return {
      id: category.id,
      label: category.label,
      count: total,
      quote: total ? quoteFromSegments(counts.slice(0, 2).map((item) => item.segment), `${category.label}的原文线索。`) : null,
      evidenceState: unverified
    };
  }).sort((a, b) => b.count - a.count);
}

function retentionAnalysis(segments) {
  const mechanisms = [
    { id: "second-person", label: "第二人称对话", pattern: /你/g, why: "用直接称呼拉近语境并维持注意力。" },
    { id: "question", label: "连续提问", pattern: /[?？]/g, why: "问题句制造未完成感。" },
    { id: "contrast", label: "反常识转折", pattern: /不是.+而是|反而|但是|却|其实/g, why: "通过认知反转制造继续观看的理由。" },
    { id: "enumeration", label: "分点 / 清单", pattern: /第一|第二|第三|首先|其次|最后|三个|几点/g, why: "结构信号帮助观众预期信息密度。" },
    { id: "narrative", label: "个人经历", pattern: /我曾经|后来|有一次|我|我们/g, why: "用具体经历承载抽象判断。" },
    { id: "tension", label: "秘密 / 真相", pattern: /秘密|真相|本质|关键|潜规则|不会告诉你|不想让你/g, why: "信息差语言制造张力。" },
    { id: "action", label: "行动指令", pattern: /关注|点赞|收藏|评论|试试|记住|一定要/g, why: "在结尾或转折处提供明确动作。" }
  ];
  return mechanisms.map((mechanism) => {
    const matches = segments.map((segment) => ({
      segment,
      count: countMatches(segment.text, mechanism.pattern)
    })).filter((item) => item.count > 0);
    const count = matches.reduce((total, item) => total + item.count, 0);
    return count ? {
      id: mechanism.id,
      label: mechanism.label,
      count,
      quote: quoteFromSegments(matches.slice(0, 2).map((item) => item.segment), mechanism.why),
      why: mechanism.why,
      evidenceState: unverified
    } : null;
  }).filter(Boolean);
}

function emotionalPayoff(segments) {
  const cues = [
    { id: "courage", label: "勇敢与掌控", test: /勇敢|掌控|主动权|反抗|边界|不再/, count: /勇敢|掌控|主动权|反抗|边界|不再/g },
    { id: "recognition", label: "被看见与认可", test: /认可|尊重|被爱|理解|价值|值得/, count: /认可|尊重|被爱|理解|价值|值得/g },
    { id: "freedom", label: "自由与松弛", test: /自由|松弛|轻松|舒服|爽|不用/, count: /自由|松弛|轻松|舒服|爽|不用/g },
    { id: "growth", label: "成长与清醒", test: /成长|清醒|成熟|社会化|改变|变强/, count: /成长|清醒|成熟|社会化|改变|变强/g }
  ];
  const observed = cues.map((cue) => {
    const matches = segments.filter((segment) => cue.test.test(segment.text));
    return {
      id: cue.id,
      label: cue.label,
      count: matches.reduce((total, segment) => total + countMatches(segment.text, cue.count), 0),
      quote: matches.length ? quoteFromSegments(matches.slice(0, 2), `${cue.label}的情绪线索。`) : null
    };
  }).filter((cue) => cue.count > 0).sort((a, b) => b.count - a.count);
  return {
    primary: observed[0] || null,
    cues: observed,
    candidateRead: observed.length
      ? `候选判断：主要情绪回报是“${observed[0].label}”，仍需用评论和收藏数据验证观众是否真的获得了这种感受。`
      : "候选判断：逐字稿里没有足够明显的情绪回报线索，建议核对结尾与高互动评论。",
    evidenceState: unverified
  };
}

function authorBaseline(state, signal) {
  const peerSignals = (state.signals || []).filter((item) => item.sourceId && item.sourceId === signal.sourceId);
  const values = peerSignals.map((item) => Number(item.engagement)).filter((value) => Number.isFinite(value) && value >= 0);
  const peerMedian = median(values);
  const current = Number(signal.engagement);
  const relativeMultiple = Number.isFinite(current) && peerMedian > 0 ? current / peerMedian : null;
  return {
    sampleCount: values.length,
    peerMedianEngagement: peerMedian,
    currentEngagement: Number.isFinite(current) ? current : null,
    relativeMultiple: relativeMultiple === null ? null : round(relativeMultiple, 2),
    sampleAdequate: values.length >= 5,
    candidateRead: peerMedian === null
      ? "候选判断：缺少同作者可用互动样本，无法比较相对表现。"
      : `候选判断：同作者 ${values.length} 条样本的互动中位数为 ${peerMedian}；当前内容约为 ${relativeMultiple === null ? "未知" : `${round(relativeMultiple, 2)}×`}。样本不代表平台推荐因果。`,
    evidenceState: unverified
  };
}

function reusableFormula(hook, structure, retention) {
  const order = structure.map((part) => part.label).join(" → ");
  const retentionLabels = retention.slice(0, 3).map((item) => item.label).join("、") || "直接判断";
  return {
    name: `${hook.pattern} + 机制拆解`,
    skeleton: `${order}；持续使用${retentionLabels}。`,
    candidateUse: "建议把它当作写作假设，不当作已验证的爆款公式；先用同一结构改写一版，再用自己的真实数据对照。",
    evidenceState: unverified
  };
}

function allQuotes({ hook, promiseAndTension, structure, audience, retention, emotionalPayoff }) {
  const candidates = [
    hook.quote,
    promiseAndTension.quote,
    ...structure.map((part) => part.quote),
    ...audience.map((item) => item.quote),
    ...retention.map((item) => item.quote),
    ...(emotionalPayoff.cues || []).map((item) => item.quote)
  ].filter(Boolean);
  const unique = new Map();
  for (const quote of candidates) {
    const key = `${quote.startTimestamp}-${quote.endTimestamp}-${quote.text}`;
    if (!unique.has(key)) unique.set(key, quote);
  }
  return [...unique.values()].slice(0, 12);
}

function evidenceGaps(signal, baseline, transcript, chapters, comments) {
  const transcriptGap = transcript.sourceType === "platform-subtitle"
    ? "逐字稿来自平台字幕轨，错字、断句和字幕覆盖范围仍需人工校对，不能证明字幕解释了完播或流量。"
    : transcript.sourceType === "local-asr"
      ? "逐字稿来自本地 ASR，同音字、断句和术语仍需人工校对。"
      : transcript.sourceType === "imported"
        ? "逐字稿来自导入或人工记录，转写完整性与时间轴准确性仍需人工核对。"
        : "逐字稿来源未明确标注，不能假定它来自 ASR 或平台字幕。";
  const gaps = [
    transcriptGap,
    "没有平台完播率、停留率、推荐来源和受众画像，不能证明内容结构导致爆火。",
    "当前分析是确定性启发式，不是人工评审或外部模型结论。"
  ];
  if (comments.scope.complete !== true) {
    gaps.push(`评论范围不完整：当前 ${comments.scope.capturedCount} 条，hasMore=${comments.scope.hasMore}；不能据此推断完整受众反应。`);
  } else if (comments.scope.capturedCount > 0) {
    gaps.push("评论为平台可见样本，仍可能与实际受众结构存在偏差。");
  } else {
    gaps.push("没有可用评论样本，情绪回报与真实共鸣只能标记为候选。");
  }
  if (chapters.length) {
    gaps.push("章节来自平台元数据；章节边界不自动等于内容机制，仍需结合原文和真实留存数据核对。");
  }
  if (!baseline.sampleAdequate) {
    gaps.push(`同作者互动样本仅 ${baseline.sampleCount} 条，相对表现不稳定。`);
  }
  if (!cleanText(signal.contentText)) {
    gaps.push("缺少已校验的正文文本，标题与正文之间的承诺是否一致仍待核对。");
  }
  return gaps;
}

export function createTranscriptAnalysis({
  state = {},
  signalId = "",
  timestamp = now(),
  runId = createAnalysisId(timestamp)
} = {}) {
  const normalizedSignalId = cleanText(signalId);
  if (!normalizedSignalId) throw new Error("signalId is required");
  const signal = (state.signals || []).find((item) => item.id === normalizedSignalId);
  if (!signal) throw new Error("signal not found");
  const transcriptText = cleanText(signal.transcriptText);
  if (!transcriptText) throw new Error("这条信号还没有逐字稿，请先取得平台字幕、完成转写或导入逐字稿");
  const segments = normalizedSegments(signal, timestamp);
  const transcript = transcriptEvidence(signal);
  const chapters = chapterEvidence(signal, segments);
  const comments = commentEvidence(signal);
  const hook = hookAnalysis(segments);
  const promiseAndTension = promiseAnalysis(segments);
  const structure = structureAnalysis(segments);
  const pacing = pacingAnalysis(signal, segments);
  const audience = audienceSignals(segments);
  const retention = retentionAnalysis(segments);
  const payoff = emotionalPayoff(segments);
  const baseline = authorBaseline(state, signal);
  const formula = reusableFormula(hook, structure, retention);
  const gaps = evidenceGaps(signal, baseline, transcript, chapters, comments);
  const analysisSegments = segments.map(({ analysisTimestamp: _analysisTimestamp, ...segment }) => segment);
  const summary = [
    `候选拆解：${hook.pattern}`,
    structure.length ? `按 ${structure.map((part) => part.label).join(" → ")} 组织。` : "",
    pacing.candidateRead,
    payoff.primary ? `最终情绪回报更像“${payoff.primary.label}”，仍需评论与互动数据核对。` : ""
  ].join("");
  const contentHash = crypto.createHash("sha256")
    .update(transcriptText)
    .digest("hex");
  return {
    id: runId,
    signalId: normalizedSignalId,
    status: "completed",
    schemaVersion: analysisSchemaVersion,
    evidenceState: unverified,
    createdAt: timestamp,
    finishedAt: timestamp,
    sourceMode: analysisSourceMode,
    input: {
      transcriptHash: contentHash,
      transcriptStatus: transcript.status,
      transcriptSource: transcript.source,
      transcriptSourceType: transcript.sourceType,
      transcriptModel: transcript.model,
      transcriptCapturedAt: transcript.capturedAt,
      transcriptEvidenceState: transcript.evidenceState,
      transcriptDurationSeconds: transcript.durationSeconds,
      timelineAvailable: transcript.timelineAvailable,
      characterCount: transcriptText.length,
      segmentCount: segments.length,
      transcriptSegments: analysisSegments,
      chapters,
      commentScope: comments.scope,
      comments: comments.samples
    },
    analysis: {
      summary,
      hook,
      promiseAndTension,
      structure,
      pacing,
      audience: audience.filter((item) => item.count > 0),
      retention,
      emotionalPayoff: payoff,
      authorBaseline: baseline,
      reusableFormula: formula,
      evidenceGaps: gaps,
      quotes: allQuotes({ hook, promiseAndTension, structure, audience, retention, emotionalPayoff: payoff }),
      evidenceContext: {
        evidenceState: unverified,
        transcript,
        chapters,
        comments
      },
      agentContext: {
        evidenceState: unverified,
        transcript,
        transcriptSegments: analysisSegments,
        chapters,
        commentScope: comments.scope,
        commentSamples: comments.samples
      }
    }
  };
}

export function latestAnalysisForSignal(state = {}, signalId = "") {
  return (state.analysisRuns || [])
    .filter((run) => run.signalId === signalId && run.status === "completed")
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0] || null;
}

export function analysisRuntime(state = {}) {
  const runs = Array.isArray(state.analysisRuns) ? state.analysisRuns : [];
  const completed = runs.filter((run) => run.status === "completed");
  const signalIds = new Set(completed.map((run) => run.signalId).filter(Boolean));
  return {
    generatedAt: now(),
    completedCount: completed.length,
    analyzedSignalCount: signalIds.size,
    latestRunId: completed[0]?.id || "",
    evidenceState: unverified,
    boundary: "启发式候选分析；引用原文必须保留时间戳，不得作为平台因果证明。"
  };
}
