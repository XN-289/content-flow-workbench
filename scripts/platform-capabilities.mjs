export const capabilityDimensions = [
  { id: "list", label: "列表" },
  { id: "detail", label: "详情" },
  { id: "comments", label: "评论" },
  { id: "body", label: "正文" },
  { id: "media", label: "媒体" },
  { id: "transcript", label: "逐字稿" }
];

export const platformCapabilities = [
  {
    id: "x",
    label: "X",
    loginBoundary: "只使用无登录公开可见范围；不保存账号登录态，不调用私有接口。",
    riskBoundary: "公开可见性受平台控制，登录墙或风控页一律记录 blocked / failed。",
    capabilities: {
      list: { status: "partial", method: "公开页面 / RSS（可用时）" },
      detail: { status: "partial", method: "公开页面元数据" },
      comments: { status: "unsupported", method: "人工复制" },
      body: { status: "partial", method: "公开页面正文，登录墙内不可得" },
      media: { status: "unknown", method: "先记录链接与描述，不自动下载" },
      transcript: { status: "unknown", method: "可见视频字幕能力待真实验证" }
    }
  },
  {
    id: "xiaohongshu",
    label: "小红书",
    loginBoundary: "只读取游客可见状态；单次自然滚动触发首屏评论，不持续遍历，不使用账号登录态。",
    riskBoundary: "采集范围以人工可见范围为准，unknown 不伪装成 complete。",
    capabilities: {
      list: { status: "partial", method: "浏览器辅助采集书签" },
      detail: { status: "partial", method: "可见状态 + 人工打开详情" },
      comments: { status: "partial", method: "人工复制 / 快速粘贴 / 投递箱" },
      body: { status: "partial", method: "详情书签读取正文并保留原文" },
      media: { status: "partial", method: "详情书签记录封面与媒体清单；逐字稿运行时显式下载单条 MP4" },
      transcript: { status: "partial", method: "可见字幕优先；无字幕时单条信号显式本地 ASR，保留时间轴和人工校对边界" }
    }
  },
  {
    id: "douyin",
    label: "抖音",
    loginBoundary: "不做登录态后台采集；只接受公开链接、人工复制或平台导出。",
    riskBoundary: "不处理签名、验证码、代理或指纹伪装。",
    capabilities: {
      list: { status: "unsupported", method: "平台导出 / 人工登记" },
      detail: { status: "partial", method: "人工复制公开可见信息" },
      comments: { status: "partial", method: "人工复制 / 投递箱" },
      body: { status: "partial", method: "人工复制文案或字幕" },
      media: { status: "unsupported", method: "用户自行下载后导入证据包" },
      transcript: { status: "partial", method: "人工复制公开字幕" }
    }
  },
  {
    id: "bilibili",
    label: "B 站",
    loginBoundary: "只读取公开视频、主页或合集元数据和公开字幕轨；不使用登录态。",
    riskBoundary: "412 / 403、登录墙或风控一律记录 blocked；不伪造采集完成。",
    capabilities: {
      list: { status: "partial", method: "yt-dlp 读取公开主页/合集，单次限制条数" },
      detail: { status: "partial", method: "yt-dlp 读取公开标题、简介、作者和封面" },
      comments: { status: "unsupported", method: "人工复制" },
      body: { status: "partial", method: "公开视频简介；简介不等于逐字稿" },
      media: { status: "partial", method: "只记录封面和链接，不下载视频" },
      transcript: { status: "partial", method: "公开字幕轨优先；无字幕明确 missing，不自动跑 ASR" }
    }
  },
  {
    id: "wechat",
    label: "公众号",
    loginBoundary: "只访问公开文章页；不使用公众号后台或第三方登录态。",
    riskBoundary: "RSS / 公开页面失败时保留失败运行，不生成假信号。",
    capabilities: {
      list: { status: "partial", method: "公开页面 / RSS（可用时）" },
      detail: { status: "partial", method: "公开文章页解析；真实页面 fixture 待验证" },
      comments: { status: "unsupported", method: "人工复制" },
      body: { status: "partial", method: "公开文章正文抽取；真实页面 fixture 待验证" },
      media: { status: "partial", method: "图片描述与链接清单" },
      transcript: { status: "unsupported", method: "文章正文不等于音频逐字稿" }
    }
  }
];

const allowedStatuses = new Set(["complete", "partial", "unsupported", "unknown"]);

export function platformCapabilityRuntime(state = {}) {
  const sourceCounts = (state.sources || []).reduce((counts, source) => {
    const platform = String(source.platform || "other");
    counts[platform] = (counts[platform] || 0) + 1;
    return counts;
  }, {});

  return {
    generatedAt: new Date().toISOString(),
    dimensions: capabilityDimensions,
    platforms: platformCapabilities.map((platform) => {
      for (const capability of Object.values(platform.capabilities)) {
        if (!allowedStatuses.has(capability.status)) {
          throw new Error(`invalid platform capability status: ${capability.status}`);
        }
      }
      return {
        ...platform,
        sourceCount: sourceCounts[platform.id] || 0
      };
    })
  };
}
