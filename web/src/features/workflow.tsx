import React, { useMemo, useState } from "react";
import { api, isLocalRehearsal } from "../lib/api";
import { PUBLICATION_STATUS_LABEL, STAGE_LABEL } from "../lib/constants";
import { countChars, fmtDate, fmtDateTime, platformLabel, toneForEvidence } from "../lib/format";
import {
  MANUAL_GATE_KEYS,
  MANUAL_GATE_LABELS,
  PRODUCTION_CHECK_KEYS,
  PRODUCTION_CHECK_LABELS,
  evaluateStageGate
} from "../lib/stage-gates";
import { useStore } from "../state/store";
import { Shell } from "../components/AppShell";
import { Button, Card, CheckItem, Chip, EmptyState, Field, QueueRow, Sheet, StageTrack, TimelineItem } from "../components/primitives";

type SheetMode = "script" | "publication" | "review" | "friction" | null;

export function WorkflowView() {
  const { state, activeTopicId, setActiveTopic, mutate, busy, refresh, setView } = useStore();
  const [sheet, setSheet] = useState<SheetMode>(null);
  const [draft, setDraft] = useState<any>({});
  const [error, setError] = useState<string | null>(null);

  const topics = state?.topics || [];
  const activeTopic = topics.find((topic: any) => topic.id === activeTopicId) || topics[0];
  const stageGate = evaluateStageGate(state, activeTopic);

  const related = useMemo(() => {
    if (!activeTopic || !state) return { scripts: [], publications: [], reviews: [], evidence: [], transcripts: [], frictions: [] };
    const signalIds = new Set(activeTopic.sourceSignalIds || []);
    return {
      scripts: state.scripts.filter((script: any) => script.topicId === activeTopic.id),
      publications: state.publications.filter((item: any) => item.topicId === activeTopic.id),
      reviews: state.reviews.filter((item: any) => item.topicId === activeTopic.id),
      evidence: state.evidencePackages.filter((item: any) => signalIds.has(item.signalId)),
      transcripts: state.transcriptRuns.filter((item: any) => signalIds.has(item.signalId)),
      frictions: state.frictionLog.slice(0, 5)
    };
  }, [activeTopic, state]);

  if (!state) return null;

  const stageCounts = topics.reduce((acc: Record<string, number>, topic: any) => {
    acc[topic.stage] = (acc[topic.stage] || 0) + 1;
    return acc;
  }, {});

  const openSheet = (mode: SheetMode) => {
    setError(null);
    if (mode === "script") {
      const latest = related.scripts[related.scripts.length - 1];
      setDraft(
        latest
          ? { ...latest }
          : { topicId: activeTopic?.id || "", tool: "口播稿", versionNote: "第 1 版", inputSummary: "", text: "" }
      );
    }
    if (mode === "publication") setDraft({ topicId: activeTopic?.id || "", platform: "xiaohongshu", status: "draft", url: "", nextAction: "" });
    if (mode === "review") setDraft({ topicId: activeTopic?.id || "", reach: "", engagement: "", hypothesis: "", keep: "", cut: "", nextMove: "" });
    if (mode === "friction") setDraft({ stuckAt: "", minutes: "", note: "" });
    setSheet(mode);
  };

  const save = async () => {
    setError(null);
    try {
      if (sheet === "script") {
        if (!draft.text?.trim()) throw new Error("正文不能为空");
        await api.record("scripts", { ...draft, topicId: activeTopic?.id });
      }
      if (sheet === "publication") {
        await api.record("publications", { ...draft, topicId: activeTopic?.id });
      }
      if (sheet === "review") {
          const shouldAdvance = activeTopic?.stage === "published";
          await api.saveReview({ ...draft, topicId: activeTopic?.id }, shouldAdvance);
      }
      if (sheet === "friction") {
        await api.record("frictionLog", { ...draft });
      }
        await refresh();
      setSheet(null);
    } catch (err: any) {
      setError(err.message || "保存失败");
    }
  };

  const toggleGate = (key: string) => {
    if (!activeTopic) return;
    const gates = { ...(activeTopic.gates || {}), [key]: !activeTopic.gates?.[key] };
    mutate("gates", () => api.update("topics", activeTopic.id, { gates }), "人工关卡已更新");
  };

  const toggleCheck = (key: string) => {
    if (!activeTopic) return;
    const checks = { ...(activeTopic.productionChecks || {}), [key]: !activeTopic.productionChecks?.[key] };
    mutate("checks", () => api.update("topics", activeTopic.id, { productionChecks: checks }), "制作检查已更新");
  };

  const latestScript = related.scripts[related.scripts.length - 1];
  const chars = countChars(latestScript?.text);
    const pendingGates = MANUAL_GATE_KEYS.filter((key) => activeTopic?.gates?.[key] !== true);
    const pendingChecks = PRODUCTION_CHECK_KEYS.filter((key) => activeTopic?.productionChecks?.[key] !== true);

  return (
    <>
      <Shell
        queueLabel="选题库"
        inspectorLabel="对象时间线与摩擦"
      queue={
        <>
          <div className="card-head">
            <h2 className="card-title">选题库</h2>
            <span className="card-sub">{topics.length} 个</span>
          </div>
          <div className="queue">
            {topics.map((topic: any) => (
              <QueueRow
                key={topic.id}
                selected={topic.id === activeTopic?.id}
                tone={topic.stage === "reviewed" ? "success" : "action"}
                title={topic.title}
                meta={`${STAGE_LABEL[topic.stage] || topic.stage} · ${fmtDate(topic.updatedAt)}`}
                onClick={() => setActiveTopic(topic.id)}
              />
            ))}
            {!topics.length ? <EmptyState text="还没有选题" /> : null}
          </div>

          <div className="stack" style={{ gap: 6 }}>
            <span className="section-label">阶段漏斗</span>
            {Object.keys(STAGE_LABEL).map((stage) => (
              <div key={stage} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span className="muted">{STAGE_LABEL[stage]}</span>
                <span className="tabular subtle">{stageCounts[stage] || 0}</span>
              </div>
            ))}
          </div>
        </>
      }
      canvas={
        activeTopic ? (
          <>
            <Card
              title={activeTopic.title}
              hint={`${activeTopic.targetReader || "未设定目标读者"} · 更新于 ${fmtDateTime(activeTopic.updatedAt)}`}
              actions={
                <>
                  <Button small onClick={() => openSheet("script")}>
                    {related.scripts.length ? "编辑口播稿" : "新建口播稿"}
                  </Button>
                  <Button
                    small
                    variant="primary"
                      disabled={!stageGate.canAdvance || busy === "stage"}
                      title={stageGate.reason}
                      onClick={() => {
                        if (!stageGate.canAdvance || !stageGate.nextStage) return;
                        mutate("stage", () => api.update("topics", activeTopic.id, { stage: stageGate.nextStage }), "阶段已推进");
                      }}
                  >
                      {stageGate.nextStage ? `推进到${stageGate.nextStageLabel}` : "已到终态"}
                  </Button>
                </>
              }
            >
              <div className="stack" style={{ gap: 10 }}>
                <div className="inline">
                  <Chip tone="neutral">当前阶段：{STAGE_LABEL[activeTopic.stage] || activeTopic.stage}</Chip>
                  {pendingGates.length ? <Chip tone="warning">{pendingGates.length} 项人工关卡待确认</Chip> : <Chip tone="success">关卡已通过</Chip>}
                  {pendingChecks.length ? <Chip tone="warning">制作检查 {pendingChecks.length} 项未完成</Chip> : <Chip tone="success">制作检查完成</Chip>}
                </div>
                  {stageGate.blocked && stageGate.nextStage ? (
                    <div className="inline" role="status">
                      <Chip tone="warning">推进已锁定</Chip>
                      <span className="subtle" style={{ fontSize: 12, lineHeight: "18px" }}>
                        {stageGate.reason}
                      </span>
                    </div>
                  ) : null}
                <StageTrack current={activeTopic.stage} />
                <p className="muted" style={{ fontSize: 13, lineHeight: "22px" }}>{activeTopic.coreIdea}</p>
              </div>
            </Card>

            <div className="canvas-columns">
              <Card title="人工关卡" hint="未确认时不能推进阶段">
                <div className="stack" style={{ gap: 6 }}>
                    {MANUAL_GATE_KEYS.map((key) => (
                    <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <CheckItem done={Boolean(activeTopic.gates?.[key])}>{MANUAL_GATE_LABELS[key]}</CheckItem>
                      <Button small onClick={() => toggleGate(key)} disabled={busy === "gates"}>
                        {activeTopic.gates?.[key] ? "撤销" : "确认"}
                      </Button>
                    </div>
                  ))}
                </div>
              </Card>

              <Card title="制作检查" hint="服务端在阶段推进时校验">
                <div className="stack" style={{ gap: 6 }}>
                    {PRODUCTION_CHECK_KEYS.map((key) => (
                    <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <CheckItem done={Boolean(activeTopic.productionChecks?.[key])}>{PRODUCTION_CHECK_LABELS[key]}</CheckItem>
                      <Button small onClick={() => toggleCheck(key)} disabled={busy === "checks"}>
                        {activeTopic.productionChecks?.[key] ? "撤销" : "完成"}
                      </Button>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <Card
              title={latestScript ? `口播稿 · 第 ${related.scripts.length} 版` : "口播稿"}
              hint={latestScript ? `${chars.nonSpace} 字（原始 ${chars.raw}） · ${latestScript.tool}` : "还没有稿件"}
              actions={
                <Button small onClick={() => openSheet("script")}>
                  {latestScript ? "编辑" : "新建"}
                </Button>
              }
            >
              {latestScript ? (
                <div className="stack" style={{ gap: 8 }}>
                  <p className="muted" style={{ fontSize: 13, lineHeight: "22px", maxWidth: "70ch" }}>
                    {latestScript.text}
                  </p>
                  <span className="subtle" style={{ fontSize: 12 }}>
                    {latestScript.versionNote || "无版本说明"} · 编辑在侧边面板打开，保存即入库
                  </span>
                </div>
              ) : (
                  <EmptyState text="这个选题还没有稿件" action={<Button onClick={() => openSheet("script")}>写第一版</Button>} />
              )}
            </Card>

            <div className="canvas-columns">
              <Card
                title="发布记录"
                hint={`${related.publications.length} 条`}
                actions={
                  <Button small onClick={() => openSheet("publication")}>
                    新增
                  </Button>
                }
              >
                {related.publications.length ? (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>平台</th>
                        <th>状态</th>
                        <th>性质</th>
                      </tr>
                    </thead>
                    <tbody>
                      {related.publications.map((item: any) => (
                        <tr key={item.id}>
                          <td>{platformLabel(item.platform)}</td>
                          <td>{PUBLICATION_STATUS_LABEL[item.status] || item.status}</td>
                          <td>
                            {isLocalRehearsal(item.url) ? (
                              <Chip tone="warning" outline>
                                本地演练 · 未公开
                              </Chip>
                            ) : item.url ? (
                              <Chip tone="action">已填平台链接</Chip>
                            ) : (
                              <Chip tone="warning">待回填链接</Chip>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <EmptyState text="还没有发布记录" />
                )}
              </Card>

              <Card
                title="复盘"
                hint={`${related.reviews.length} 条`}
                actions={
                  <Button small onClick={() => openSheet("review")}>
                    新增
                  </Button>
                }
              >
                {related.reviews.length ? (
                  <div className="stack" style={{ gap: 8 }}>
                    {related.reviews.map((review: any) => (
                      <div key={review.id} className="stack" style={{ gap: 4 }}>
                        <span className="inline">
                          <Chip tone={review.hypothesisMet ? "success" : "warning"}>{review.hypothesisMet ? "假设成立" : "假设未验证"}</Chip>
                          <span className="subtle" style={{ fontSize: 12 }}>
                            {fmtDate(review.updatedAt)}
                          </span>
                        </span>
                        <span className="muted" style={{ fontSize: 13, lineHeight: "22px" }}>
                          {review.hypothesis}
                        </span>
                        {review.nextMove ? <span className="subtle" style={{ fontSize: 12 }}>下一步：{review.nextMove}</span> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState text="还没有复盘" action={<Button onClick={() => openSheet("review")}>写复盘</Button>} />
                )}
              </Card>
            </div>
          </>
        ) : (
          <Card title="工作流">
            <EmptyState
              text="还没有选题。先到信息流分诊信号，再从一条信号直接开题。"
              action={<Button variant="primary" onClick={() => setView("flow")}>去信息流</Button>}
            />
          </Card>
        )
      }
      inspector={
        activeTopic ? (
          <>
            <Card title="对象时间线" tight>
              <div className="queue">
                {related.reviews.map((review: any) => (
                  <TimelineItem
                    key={review.id}
                    tone="success"
                    title="复盘完成"
                    meta={`${fmtDate(review.updatedAt)} · 结论已入库`}
                    right={<Chip tone="success">完成</Chip>}
                  />
                ))}
                {related.publications.map((item: any) => (
                  <TimelineItem
                    key={item.id}
                    tone={isLocalRehearsal(item.url) ? "neutral" : "action"}
                    title={`发布记录 · ${platformLabel(item.platform)}`}
                    meta={`${fmtDate(item.publishedAt || item.updatedAt)} · ${isLocalRehearsal(item.url) ? "非公开平台发布" : item.url || "待回填链接"}`}
                    right={isLocalRehearsal(item.url) ? <Chip tone="neutral" outline>本地演练</Chip> : <Chip tone="action">已登记</Chip>}
                  />
                ))}
                {related.evidence.map((item: any) => (
                  <TimelineItem
                    key={item.id}
                    tone={toneForEvidence(item.verification?.state)}
                    title={`证据包 · ${item.packageKey?.slice(-6)}`}
                    meta={`${item.layers?.length || 0} 层材料 · ${item.verification?.note || item.failureReason || "无备注"}`}
                    right={<Chip tone={toneForEvidence(item.verification?.state)}>{item.verification?.state === "verified" ? "已校验" : item.verification?.state === "rejected" ? "已驳回" : "unverified"}</Chip>}
                  />
                ))}
                {related.transcripts.map((item: any) => (
                  <TimelineItem
                    key={item.id}
                    tone={item.status === "failed" ? "danger" : "candidate"}
                    title={`候选逐字稿 · ${item.segmentCount ?? 0} 段`}
                    meta={`${fmtDate(item.finishedAt)} · 本地 ASR · 待人工校对`}
                    right={<Chip tone={item.status === "failed" ? "danger" : "candidate"}>{item.status === "failed" ? "失败" : "unverified"}</Chip>}
                  />
                ))}
                {!related.reviews.length && !related.publications.length && !related.evidence.length && !related.transcripts.length ? (
                  <EmptyState text="这个对象还没有历史记录" />
                ) : null}
              </div>
            </Card>

            <Card title="摩擦记录" hint={`${state.frictionLog.length} 条`} tight>
              <div className="stack" style={{ gap: 8 }}>
                {related.frictions.map((item: any) => (
                  <div key={item.id} className="stack" style={{ gap: 2 }}>
                    <span style={{ fontSize: 12 }}>{item.stuckAt}</span>
                    <span className="subtle" style={{ fontSize: 11 }}>
                      {item.minutes ? `${item.minutes} 分钟 · ` : ""}
                      {item.note || "无备注"}
                    </span>
                  </div>
                ))}
                <Button small onClick={() => openSheet("friction")}>
                  记录一次卡点
                </Button>
              </div>
            </Card>
          </>
        ) : null
      }
      mobileAction={
          <Button onClick={() => openSheet("script")}>
          {latestScript ? "编辑口播稿" : "写第一版稿"}
        </Button>
      }
      />

      <Sheet
        open={sheet !== null}
        title={
          sheet === "script" ? "口播稿" : sheet === "publication" ? "新增发布记录" : sheet === "review" ? "新增复盘" : "记录摩擦"
        }
        onClose={() => setSheet(null)}
        footer={
          <>
            <Button onClick={() => setSheet(null)}>取消</Button>
            <Button variant="primary" onClick={save}>
              保存
            </Button>
          </>
        }
      >
        {sheet === "script" ? (
          <>
            <Field label="版本说明" hint="例如：第 2 版，压缩开头">
              <input className="input" value={draft.versionNote || ""} onChange={(e) => setDraft({ ...draft, versionNote: e.target.value })} />
            </Field>
            <Field label="正文" hint={`当前 ${countChars(draft.text).nonSpace} 字（原始 ${countChars(draft.text).raw}）`} error={error || undefined}>
              <textarea className="textarea" value={draft.text || ""} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
            </Field>
          </>
        ) : null}

        {sheet === "publication" ? (
          <>
            <Field label="平台">
              <select className="select" value={draft.platform} onChange={(e) => setDraft({ ...draft, platform: e.target.value })}>
                <option value="xiaohongshu">小红书</option>
                <option value="douyin">抖音</option>
                <option value="shipinhao">视频号</option>
                <option value="bilibili">B站</option>
                <option value="wechat">公众号</option>
              </select>
            </Field>
            <Field label="状态">
              <select className="select" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                <option value="draft">草稿</option>
                <option value="ready">待发</option>
                <option value="published">已发</option>
                <option value="blocked">受阻</option>
                <option value="failed">失败</option>
              </select>
            </Field>
            <Field label="链接" hint="真实发布后回填平台链接；留空表示尚未公开发布">
              <input className="input" value={draft.url || ""} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://" />
            </Field>
            <Field label="下一步" error={error || undefined}>
              <input className="input" value={draft.nextAction || ""} onChange={(e) => setDraft({ ...draft, nextAction: e.target.value })} />
            </Field>
          </>
        ) : null}

        {sheet === "review" ? (
          <>
            <Field label="假设">
              <input className="input" value={draft.hypothesis || ""} onChange={(e) => setDraft({ ...draft, hypothesis: e.target.value })} />
            </Field>
            <div className="inline">
              <Field label="触达">
                <input className="input" value={draft.reach || ""} onChange={(e) => setDraft({ ...draft, reach: e.target.value })} />
              </Field>
              <Field label="互动">
                <input className="input" value={draft.engagement || ""} onChange={(e) => setDraft({ ...draft, engagement: e.target.value })} />
              </Field>
            </div>
            <Field label="保留">
              <input className="input" value={draft.keep || ""} onChange={(e) => setDraft({ ...draft, keep: e.target.value })} />
            </Field>
            <Field label="砍掉">
              <input className="input" value={draft.cut || ""} onChange={(e) => setDraft({ ...draft, cut: e.target.value })} />
            </Field>
            <Field label="下一步" error={error || undefined}>
              <input className="input" value={draft.nextMove || ""} onChange={(e) => setDraft({ ...draft, nextMove: e.target.value })} />
            </Field>
          </>
        ) : null}

        {sheet === "friction" ? (
          <>
            <Field label="卡在哪里">
              <input className="input" value={draft.stuckAt || ""} onChange={(e) => setDraft({ ...draft, stuckAt: e.target.value })} />
            </Field>
            <Field label="耗时（分钟）">
              <input className="input" value={draft.minutes || ""} onChange={(e) => setDraft({ ...draft, minutes: e.target.value })} />
            </Field>
            <Field label="备注" error={error || undefined}>
              <textarea className="textarea" style={{ minHeight: 100 }} value={draft.note || ""} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
            </Field>
          </>
        ) : null}
      </Sheet>
    </>
  );
}
