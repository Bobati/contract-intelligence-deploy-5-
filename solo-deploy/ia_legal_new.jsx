// ══════════════════════════════════════════════════════════════════════════════
// 법률검토 탭 — 범용 법적 분석 (KT/Palantir 계약 무관)
// ══════════════════════════════════════════════════════════════════════════════

function buildGeneralLegalPrompt(situation, clientName, opponentName, docContext) {
 const client   = clientName.trim()   || "의뢰인";
 const opponent = opponentName.trim() || "상대방";
 const docSection = docContext.trim()
  ? `\n\n【참고 문서/계약서 내용】\n${docContext.trim()}`
  : "";
 return `당신은 ${client}의 4가지 전문가 역할을 동시에 수행하는 통합 검토자입니다.

역할 1. ${client} 사내 변호사 — 계약법·상법, 법적 리스크·권리·의무
역할 2. ${client} 재무/사업 전문가 — ROI, 비용·수익 구조, 사업 기회·위협
역할 3. ${client} 기술 전문가 — 기술 실현가능성, 아키텍처, 보안·데이터 리스크
역할 4. ${client} 파트너십 전문가 — 관계 역학, 신뢰·협력 구조, 장기 전략

【당사자】의뢰인: ${client} / 상대방: ${opponent}${docSection}

【상황/이슈】
${situation}

【분석 지침】
각 관점(perspectives.legal / business / technical / partnership)에서 다음을 분석:
- verdict: "수용" 또는 "조건부 수용" 또는 "거부" 중 하나만
- verdict_reason: 판단 근거 (1문장)
- top_risks: 해당 관점 상위 3개 리스크 배열 (title, severity, detail)
- analysis: 해당 전문가 관점 상세 분석
- redlines: 수정 필요한 항목 2~3개 배열 (issue: 문제, suggestion: 수정 제안)

위험도(risk_level)는 ${client} 입장에서 종합 평가. opponent_legal은 ${opponent} 최강 주장.

출력 형식 — 아래 JSON 구조만 출력. 백틱/마크다운 금지.
{
 "risk_level": "HIGH 또는 MEDIUM 또는 LOW",
 "risk_reason": "종합 위험도 근거 (1~2문장)",
 "situation_summary": "상황 핵심 요약 (2~3문장)",
 "bottom_line": "핵심 결론 한 문장",
 "kt_overall": "${client} 4관점 종합 — 핵심 리스크와 기회, 행동방향",
 "negotiation_strategy": "협상 레버리지 포인트 4개 이상 (법적·사업·기술·파트너십 관점)",
 "opponent_legal": "${opponent} 관점 — 가장 강력한 주장, 법적 근거, 예상 전술",
 "neutral_analysis": "제3자 중립 — 법리·실무 판단, 양측 주장의 강약점, 결과 예측",
 "immediate_actions": [
  {"timeframe": "즉시 (24시간)", "owner": "법무팀", "action": "법적 조치"},
  {"timeframe": "즉시 (24시간)", "owner": "사업팀", "action": "사업적 조치"},
  {"timeframe": "1주내", "owner": "기술팀", "action": "기술 검토"},
  {"timeframe": "1주내", "owner": "파트너십팀", "action": "파트너십 대응"},
  {"timeframe": "1개월내", "owner": "경영진", "action": "전략적 의사결정"}
 ],
 "perspectives": {
  "legal": {
   "verdict": "수용|조건부 수용|거부",
   "verdict_reason": "법적 판단 근거",
   "top_risks": [
    {"title": "리스크 제목", "severity": "HIGH|MEDIUM|LOW", "detail": "상세 설명"},
    {"title": "...", "severity": "...", "detail": "..."},
    {"title": "...", "severity": "...", "detail": "..."}
   ],
   "analysis": "법적 상세 분석",
   "redlines": [
    {"issue": "문제 조항/내용", "suggestion": "구체적 수정 제안"},
    {"issue": "...", "suggestion": "..."}
   ]
  },
  "business": {
   "verdict": "수용|조건부 수용|거부",
   "verdict_reason": "사업적 판단 근거",
   "top_risks": [{"title":"...","severity":"...","detail":"..."},{"title":"...","severity":"...","detail":"..."},{"title":"...","severity":"...","detail":"..."}],
   "analysis": "사업/재무 상세 분석",
   "redlines": [{"issue":"...","suggestion":"..."},{"issue":"...","suggestion":"..."}]
  },
  "technical": {
   "verdict": "수용|조건부 수용|거부",
   "verdict_reason": "기술적 판단 근거",
   "top_risks": [{"title":"...","severity":"...","detail":"..."},{"title":"...","severity":"...","detail":"..."},{"title":"...","severity":"...","detail":"..."}],
   "analysis": "기술 상세 분석",
   "redlines": [{"issue":"...","suggestion":"..."},{"issue":"...","suggestion":"..."}]
  },
  "partnership": {
   "verdict": "수용|조건부 수용|거부",
   "verdict_reason": "파트너십 판단 근거",
   "top_risks": [{"title":"...","severity":"...","detail":"..."},{"title":"...","severity":"...","detail":"..."},{"title":"...","severity":"...","detail":"..."}],
   "analysis": "파트너십 상세 분석 + 협상 전략",
   "redlines": [{"issue":"...","suggestion":"..."},{"issue":"...","suggestion":"..."}]
  }
 }
}`;
}

// ── 리포트 HTML 생성 (Feature 6) ───────────────────────────────────────────
function generateLegalReport(result, query, clientName, opponentName) {
 const client   = clientName   || "의뢰인";
 const opponent = opponentName || "상대방";
 const ts       = new Date().toLocaleString("ko-KR");
 const rv       = (result.risk_level || "MEDIUM").toUpperCase();
 const RC = { HIGH:"#dc2626", MEDIUM:"#d97706", LOW:"#16a34a" };
 const RB = { HIGH:"#fef2f2", MEDIUM:"#fffbeb", LOW:"#f0fdf4" };
 const RBD= { HIGH:"#fecaca", MEDIUM:"#fde68a", LOW:"#bbf7d0" };
 const RL = { HIGH:"고위험",  MEDIUM:"주의",    LOW:"양호"   };
 const rc = RC[rv]||RC.MEDIUM, rb = RB[rv]||RB.MEDIUM, rbd = RBD[rv]||RBD.MEDIUM, rl = RL[rv]||"주의";
 const VCOLOR = {"수용":"#16a34a","조건부 수용":"#d97706","거부":"#dc2626"};
 const SCOLOR = {HIGH:"#dc2626",MEDIUM:"#d97706",LOW:"#16a34a"};
 const p = result.perspectives || {};
 const perspList = [
  {key:"legal",      label:"법적",       icon:"⚖", color:"#1d4ed8", data: p.legal      || {analysis:result.kt_legal||""}},
  {key:"business",   label:"사업/재무",   icon:"💼", color:"#059669", data: p.business   || {analysis:result.kt_business||""}},
  {key:"technical",  label:"기술",        icon:"⚙", color:"#7c3aed", data: p.technical  || {analysis:result.kt_technical||""}},
  {key:"partnership",label:"파트너십",    icon:"🤝", color:"#c2410c", data: p.partnership|| {analysis:result.kt_partnership||""}},
 ];
 const esc = (s) => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br>");
 const verdictBadge = (v,small) => {
  if (!v) return "";
  const vc = VCOLOR[v]||"#6b7280";
  const sym = v==="수용"?"✓":v==="거부"?"✗":"△";
  return `<span style="display:inline-block;padding:${small?"2px 8px":"2px 10px"};border-radius:12px;background:${vc}18;border:1px solid ${vc}55;font-size:${small?"10":"11"}px;font-weight:700;color:${vc}">${sym} ${esc(v)}</span>`;
 };
 const riskCards = (risks) => {
  if (!Array.isArray(risks)||!risks.length) return "<p style='color:#9ca3af;font-size:12px'>해당 없음</p>";
  return risks.map(r=>{const sc=SCOLOR[(r.severity||"").toUpperCase()]||"#6b7280";return`<div style="display:flex;gap:10px;align-items:flex-start;padding:7px 12px;background:#f9fafb;border-radius:6px;margin-bottom:5px;border-left:3px solid ${sc}"><span style="padding:2px 6px;border-radius:4px;background:${sc}18;font-size:10px;font-weight:700;color:${sc};white-space:nowrap;flex-shrink:0;margin-top:1px">${esc(r.severity||"")}</span><div><div style="font-size:12px;font-weight:600;color:#1f2937;margin-bottom:2px">${esc(r.title||"")}</div><div style="font-size:11px;color:#6b7280;line-height:1.6">${esc(r.detail||"")}</div></div></div>`;}).join("");
 };
 const redlineCards = (redlines) => {
  if (!Array.isArray(redlines)||!redlines.length) return "";
  return `<div style="margin-top:14px"><div style="font-size:10px;font-weight:700;color:#6b7280;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">✏ 수정 제안 (Redline)</div>${redlines.map((r,i)=>`<div style="margin-bottom:10px;border-radius:6px;overflow:hidden;border:1px solid #e5e7eb"><div style="padding:8px 12px;background:#fffbeb;border-bottom:1px solid #fde68a"><div style="font-size:10px;font-weight:700;color:#b45309;margin-bottom:3px">⚠ 문제 ${i+1}</div><div style="font-size:12px;color:#374151">${esc(r.issue||"")}</div></div><div style="padding:8px 12px;background:#f0fdf4"><div style="font-size:10px;font-weight:700;color:#065f46;margin-bottom:3px">✓ 수정 제안</div><div style="font-size:12px;color:#374151">${esc(r.suggestion||"")}</div></div></div>`).join("")}</div>`;
 };
 const perspSection = (pe) => `<div style="margin-bottom:24px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden"><div style="background:${pe.color}10;padding:12px 16px;border-bottom:1px solid ${pe.color}25;display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span style="font-size:16px">${pe.icon}</span><span style="font-weight:700;font-size:14px;color:${pe.color}">${esc(pe.label)}</span>${verdictBadge(pe.data.verdict)}${pe.data.verdict_reason?`<span style="font-size:11px;color:#6b7280">${esc(pe.data.verdict_reason)}</span>`:""}</div><div style="padding:16px">${pe.data.top_risks&&pe.data.top_risks.length?`<div style="margin-bottom:14px"><div style="font-size:10px;font-weight:700;color:#6b7280;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">핵심 리스크 TOP 3</div>${riskCards(pe.data.top_risks)}</div>`:""}<div style="margin-bottom:4px"><div style="font-size:10px;font-weight:700;color:#6b7280;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">상세 분석</div><div style="font-size:12px;color:#374151;line-height:1.8">${esc(pe.data.analysis)}</div></div>${redlineCards(pe.data.redlines)}</div></div>`;
 const actionsTable = (actions) => {
  if (!Array.isArray(actions)||!actions.length) return "";
  const oc = {"법무팀":"#1d4ed8","사업팀":"#059669","기술팀":"#7c3aed","파트너십팀":"#c2410c","경영진":"#b45309"};
  return `<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#f3f4f6"><th style="padding:7px 12px;text-align:left;border-bottom:1px solid #e5e7eb;font-weight:700;color:#374151">시한</th><th style="padding:7px 12px;text-align:left;border-bottom:1px solid #e5e7eb;font-weight:700;color:#374151">담당</th><th style="padding:7px 12px;text-align:left;border-bottom:1px solid #e5e7eb;font-weight:700;color:#374151">조치사항</th></tr></thead><tbody>${actions.map((a,i)=>{const c=oc[a.owner]||"#374151";return`<tr style="background:${i%2?"#f9fafb":"#fff"}"><td style="padding:7px 12px;border-bottom:1px solid #f3f4f6;color:#6b7280;white-space:nowrap;font-size:11px">${esc(a.timeframe||"")}</td><td style="padding:7px 12px;border-bottom:1px solid #f3f4f6;white-space:nowrap"><span style="padding:2px 8px;border-radius:4px;background:${c}18;color:${c};font-weight:600;font-size:11px">${esc(a.owner||"")}</span></td><td style="padding:7px 12px;border-bottom:1px solid #f3f4f6;color:#374151;font-size:11px">${esc(a.action||"")}</td></tr>`;}).join("")}</tbody></table>`;
 };

 // 전체 리스크 수집 (C-Level 요약용)
 const allRisks = perspList.flatMap(pe =>
  (Array.isArray(pe.data.top_risks) ? pe.data.top_risks : []).map(r => ({...r, perspLabel: pe.label, perspColor: pe.color, perspIcon: pe.icon}))
 );
 const sevOrder = {HIGH:0,MEDIUM:1,LOW:2};
 const topCrossRisks = [...allRisks].sort((a,b)=>(sevOrder[(a.severity||"LOW").toUpperCase()]||2)-(sevOrder[(b.severity||"LOW").toUpperCase()]||2)).slice(0,5);
 const crossRisksHtml = topCrossRisks.length ? topCrossRisks.map(r=>{
  const sc = SCOLOR[(r.severity||"").toUpperCase()]||"#6b7280";
  return `<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 12px;background:#f9fafb;border-radius:6px;margin-bottom:5px;border-left:3px solid ${sc}">
   <span style="padding:2px 6px;border-radius:4px;background:${sc}18;font-size:9px;font-weight:800;color:${sc};white-space:nowrap;flex-shrink:0;margin-top:1px">${esc(r.severity||"")}</span>
   <div style="flex:1;min-width:0">
    <div style="font-size:12px;font-weight:600;color:#1f2937;margin-bottom:1px">${esc(r.title||"")}</div>
    <div style="font-size:10px;color:#6b7280;line-height:1.5">${esc(r.detail||"")}</div>
   </div>
   <span style="font-size:10px;padding:1px 7px;border-radius:10px;background:${r.perspColor}12;border:1px solid ${r.perspColor}30;color:${r.perspColor};white-space:nowrap;flex-shrink:0;margin-top:2px">${r.perspIcon} ${esc(r.perspLabel)}</span>
  </div>`;
 }).join("") : "<p style='font-size:12px;color:#9ca3af'>리스크 정보 없음</p>";

 // 4관점 판단 그리드 (C-Level 요약용)
 const verdictGridHtml = perspList.map(pe=>{
  const vc = VCOLOR[pe.data.verdict]||"#6b7280";
  const hasVerdict = !!pe.data.verdict;
  return `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:11px 14px;display:flex;gap:10px;align-items:flex-start">
   <span style="font-size:20px;flex-shrink:0;margin-top:1px">${pe.icon}</span>
   <div style="flex:1;min-width:0">
    <div style="font-size:11px;font-weight:700;color:${pe.color};margin-bottom:4px">${esc(pe.label)}</div>
    ${hasVerdict?`<div style="margin-bottom:4px">${verdictBadge(pe.data.verdict,true)}</div>`:""}
    ${pe.data.verdict_reason?`<div style="font-size:10px;color:#6b7280;line-height:1.5">${esc(pe.data.verdict_reason)}</div>`:""}
   </div>
  </div>`;
 }).join("");

 const commonStyle = `font-family:"Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;background:#fff;color:#111;margin:0;padding:36px 44px;max-width:880px;`;

 // ── C-Level 1페이지 요약
 const execPage = `
<div style="min-height:25cm;position:relative;${commonStyle}page-break-after:always;box-sizing:border-box;">
 <!-- 헤더 -->
 <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:22px;padding-bottom:14px;border-bottom:3px solid #1d4ed8">
  <div>
   <div style="font-size:9px;letter-spacing:.16em;color:#6b7280;text-transform:uppercase;margin-bottom:4px">EXECUTIVE SUMMARY · CONFIDENTIAL</div>
   <div style="font-size:20px;font-weight:800;color:#0f172a;margin-bottom:2px">${esc(client)} 법률 검토 요약</div>
   <div style="font-size:12px;color:#6b7280">${esc(client)} vs ${esc(opponent)} &nbsp;·&nbsp; ${esc(ts)}</div>
  </div>
  <div style="text-align:right;flex-shrink:0">
   <div style="display:inline-block;padding:8px 20px;border-radius:20px;background:${rb};border:2px solid ${rc};color:${rc};font-size:16px;font-weight:800">● ${rl}</div>
   <div style="font-size:10px;color:#6b7280;margin-top:6px;max-width:170px;line-height:1.5">${esc(result.risk_reason||"")}</div>
  </div>
 </div>

 <!-- 핵심 결론 -->
 <div style="background:${rb};border-left:5px solid ${rc};border-radius:0 8px 8px 0;padding:13px 18px;margin-bottom:20px">
  <div style="font-size:9px;font-weight:800;color:${rc};letter-spacing:.16em;text-transform:uppercase;margin-bottom:5px">핵심 결론 (Bottom Line)</div>
  <div style="font-size:15px;font-weight:700;color:${rc};line-height:1.65">${esc(result.bottom_line||"")}</div>
 </div>

 <!-- 이슈 요약 -->
 ${result.situation_summary?`<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:7px;padding:11px 16px;margin-bottom:20px"><div style="font-size:9px;font-weight:700;color:#6b7280;letter-spacing:.1em;text-transform:uppercase;margin-bottom:5px">이슈 요약</div><div style="font-size:12px;color:#374151;line-height:1.75">${esc(result.situation_summary)}</div></div>`:""}

 <!-- 2단 레이아웃: 4관점 판단 + 주요 리스크 -->
 <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
  <div>
   <div style="font-size:9px;font-weight:700;color:#6b7280;letter-spacing:.1em;text-transform:uppercase;margin-bottom:9px">4관점 검토 판단</div>
   <div style="display:flex;flex-direction:column;gap:7px">${verdictGridHtml}</div>
  </div>
  <div>
   <div style="font-size:9px;font-weight:700;color:#6b7280;letter-spacing:.1em;text-transform:uppercase;margin-bottom:9px">주요 리스크 (우선순위 순)</div>
   ${crossRisksHtml}
  </div>
 </div>

 <!-- 즉각 조치사항 -->
 <div style="margin-bottom:16px">
  <div style="font-size:9px;font-weight:700;color:#6b7280;letter-spacing:.1em;text-transform:uppercase;margin-bottom:9px">즉각 조치사항</div>
  ${actionsTable(result.immediate_actions)}
 </div>

 <!-- 협상 전략 (있을 경우) -->
 ${result.negotiation_strategy?`<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:7px;padding:11px 16px;margin-bottom:16px"><div style="font-size:9px;font-weight:700;color:#1e40af;letter-spacing:.1em;text-transform:uppercase;margin-bottom:5px">협상 레버리지 포인트</div><div style="font-size:11px;color:#1e3a8a;line-height:1.75">${esc(result.negotiation_strategy)}</div></div>`:""}

 <!-- 푸터 -->
 <div style="position:absolute;bottom:28px;left:44px;right:44px;border-top:1px solid #e5e7eb;padding-top:10px;display:flex;justify-content:space-between;font-size:9px;color:#9ca3af">
  <span>Contract Intelligence — Executive Summary</span>
  <span style="font-weight:700;color:#1d4ed8">▶ 상세 검토 보고서는 다음 페이지(별첨) 참조</span>
  <span>${esc(ts)}</span>
 </div>
</div>`;

 // ── 별첨: 상세 보고서
 const appendixPage = `
<div style="${commonStyle}">
 <!-- 별첨 헤더 -->
 <div style="margin-bottom:28px;padding:16px 20px;background:#f3f4f6;border-radius:8px;border-left:5px solid #6b7280">
  <div style="font-size:9px;font-weight:800;color:#6b7280;letter-spacing:.18em;text-transform:uppercase;margin-bottom:4px">별첨 (APPENDIX)</div>
  <div style="font-size:18px;font-weight:800;color:#1f2937;margin-bottom:2px">상세 법률 검토 보고서</div>
  <div style="font-size:12px;color:#6b7280">${esc(client)} vs ${esc(opponent)} &nbsp;·&nbsp; ${esc(ts)}</div>
 </div>

 <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px">
  <div></div>
  <div style="text-align:right"><div style="display:inline-block;padding:5px 16px;border-radius:16px;background:${rb};border:1px solid ${rc}50;color:${rc};font-size:14px;font-weight:700">● ${rl}</div><div style="font-size:11px;color:#6b7280;margin-top:6px;max-width:200px">${esc(result.risk_reason||"")}</div></div>
 </div>
 <button class="no-print" onclick="window.print()" style="margin-bottom:20px;padding:8px 20px;background:#1d4ed8;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600">🖨 인쇄 / PDF 저장</button>
 <div style="background:${rb};border:1px solid ${rc}40;border-left:4px solid ${rc};border-radius:6px;padding:14px 18px;margin-bottom:16px"><div style="font-size:10px;font-weight:800;color:${rc};letter-spacing:.12em;text-transform:uppercase;margin-bottom:6px">⚖ 종합 의견</div><div style="font-size:15px;font-weight:600;color:${rc};line-height:1.7">${esc(result.bottom_line||"")}</div></div>
 <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:14px 18px;margin-bottom:24px"><div style="font-size:10px;font-weight:700;color:#6b7280;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px">이슈 요약</div><div style="font-size:13px;color:#374151;line-height:1.8">${esc(result.situation_summary||query)}</div></div>
 <h2 style="font-size:14px;font-weight:700;margin:24px 0 12px;padding-bottom:6px;border-bottom:2px solid #e5e7eb">📊 ${esc(client)} 4관점 검토</h2>${perspList.map(pe=>perspSection(pe)).join("")}
 <h2 style="font-size:14px;font-weight:700;margin:24px 0 12px;padding-bottom:6px;border-bottom:2px solid #e5e7eb">🤝 4관점 종합 &amp; 협상 전략</h2>
 <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:14px 18px;margin-bottom:12px"><div style="font-size:12px;color:#1e40af;line-height:1.8">${esc(result.kt_overall||"")}</div></div>
 <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px 18px;margin-bottom:24px"><div style="font-size:10px;font-weight:700;color:#6b7280;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">협상 레버리지 포인트</div><div style="font-size:12px;color:#374151;line-height:1.9">${esc(result.negotiation_strategy||"")}</div></div>
 <h2 style="font-size:14px;font-weight:700;margin:24px 0 12px;padding-bottom:6px;border-bottom:2px solid #e5e7eb">⚔ ${esc(opponent)} 예상 관점</h2>
 <div style="font-size:12px;color:#374151;line-height:1.8;padding:14px 18px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;margin-bottom:24px">${esc(result.opponent_legal||"")}</div>
 <h2 style="font-size:14px;font-weight:700;margin:24px 0 12px;padding-bottom:6px;border-bottom:2px solid #e5e7eb">🔍 제3자 중립 분석</h2>
 <div style="font-size:12px;color:#374151;line-height:1.8;padding:14px 18px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:24px">${esc(result.neutral_analysis||"")}</div>
 <h2 style="font-size:14px;font-weight:700;margin:24px 0 12px;padding-bottom:6px;border-bottom:2px solid #e5e7eb">📋 즉각 조치사항</h2>${actionsTable(result.immediate_actions)}
 <div style="margin-top:40px;padding-top:14px;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af;display:flex;justify-content:space-between"><span>Contract Intelligence — 법률검토 상세 보고서 (별첨)</span><span>${esc(ts)}</span></div>
</div>`;

 const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>${esc(client)} 법률검토 리포트</title><style>
@media print{.no-print{display:none!important}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}@page{margin:0;size:A4}}
body{margin:0;padding:0;background:#fff}
h1,h2{margin:0}
</style></head><body>
${execPage}
${appendixPage}
</body></html>`;
 const w = window.open("","_blank");
 if (w) { w.document.write(html); w.document.close(); }
}

// ── 상수 ──────────────────────────────────────────────────────────────────────
const LEGAL_RISK_COLOR = { HIGH:"#ef4444", MEDIUM:"#f59e0b", LOW:"#22c55e" };
const LEGAL_RISK_BG    = { HIGH:"rgba(239,68,68,0.1)",  MEDIUM:"rgba(245,158,11,0.1)", LOW:"rgba(34,197,94,0.1)"  };
const LEGAL_RISK_BORDER= { HIGH:"rgba(239,68,68,0.3)",  MEDIUM:"rgba(245,158,11,0.3)", LOW:"rgba(34,197,94,0.3)"  };
const LEGAL_RISK_LABEL = { HIGH:"고위험", MEDIUM:"주의", LOW:"양호" };
const VERDICT_COLOR    = { "수용":"#22c55e", "조건부 수용":"#f59e0b", "거부":"#ef4444" };
const VERDICT_BG       = { "수용":"rgba(34,197,94,0.12)", "조건부 수용":"rgba(245,158,11,0.12)", "거부":"rgba(239,68,68,0.12)" };
const SEV_COLOR        = { HIGH:"#ef4444", MEDIUM:"#f59e0b", LOW:"#22c55e" };

// ── ExecSummaryPanel — 인앱 C-Level 요약 뷰 ──────────────────────────────────
function ExecSummaryPanel({ result, clientName, opponentName, currentQuery, onReport }) {
 const client   = clientName   || "의뢰인";
 const opponent = opponentName || "상대방";
 const rv  = (result.risk_level || "MEDIUM").toUpperCase();
 const rc  = LEGAL_RISK_COLOR[rv]  || "#f59e0b";
 const rb  = LEGAL_RISK_BG[rv]    || "rgba(245,158,11,0.1)";
 const rbd = LEGAL_RISK_BORDER[rv] || "rgba(245,158,11,0.3)";
 const rl  = LEGAL_RISK_LABEL[rv]  || "주의";
 const S = { bg:"#020617", card:"#0f172a", cardIn:"#1e293b", border:"#334155",
  t1:"#f1f5f9", t2:"#cbd5e1", t3:"#94a3b8", t4:"#64748b" };

 const persp = result.perspectives || {};
 const perspMeta = [
  {key:"legal",      label:"법적",     icon:"⚖", color:"#60a5fa"},
  {key:"business",   label:"사업/재무",icon:"💼", color:"#34d399"},
  {key:"technical",  label:"기술",     icon:"⚙", color:"#a78bfa"},
  {key:"partnership",label:"파트너십", icon:"🤝", color:"#fb923c"},
 ];

 const getPd = (key) => {
  const d = persp[key];
  if (!d) return { verdict:null, verdict_reason:"", top_risks:[], analysis:result[`kt_${key}`]||"-" };
  if (typeof d === "string") return { verdict:null, verdict_reason:"", top_risks:[], analysis:d };
  return { verdict:d.verdict||null, verdict_reason:d.verdict_reason||"", top_risks:Array.isArray(d.top_risks)?d.top_risks:[], analysis:d.analysis||"-" };
 };

 // 전체 리스크 수집 및 정렬
 const sevOrd = {HIGH:0,MEDIUM:1,LOW:2};
 const allRisks = perspMeta.flatMap(m => {
  const pd = getPd(m.key);
  return pd.top_risks.map(r => ({...r, perspLabel:m.label, perspColor:m.color, perspIcon:m.icon}));
 }).sort((a,b)=>(sevOrd[(a.severity||"LOW").toUpperCase()]||2)-(sevOrd[(b.severity||"LOW").toUpperCase()]||2)).slice(0,5);

 const VerdictBadge = ({verdict, small}) => {
  if (!verdict) return null;
  const vc = VERDICT_COLOR[verdict]||"#94a3b8";
  const vb = VERDICT_BG[verdict]||"rgba(148,163,184,0.12)";
  const sym = verdict==="수용"?"✓":verdict==="거부"?"✗":"△";
  return <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:small?"2px 8px":"3px 11px",
   borderRadius:12,background:vb,border:`1px solid ${vc}55`,fontSize:small?10:11,fontWeight:700,color:vc}}>
   {sym} {verdict}
  </span>;
 };

 return (
  <div style={{display:"flex",flexDirection:"column",gap:14}}>

   {/* 리스크 + 결론 헤더 */}
   <div style={{display:"flex",gap:12,alignItems:"flex-start",flexWrap:"wrap"}}>
    <span style={{display:"inline-flex",alignItems:"center",gap:7,padding:"7px 18px",borderRadius:22,
     background:rb,border:`1.5px solid ${rbd}`,fontSize:14,fontWeight:800,color:rc}}>
     <span style={{width:7,height:7,borderRadius:"50%",background:rc}}/>
     {rl}
    </span>
    <button onClick={onReport}
     style={{marginLeft:"auto",padding:"7px 16px",background:S.cardIn,border:`1px solid ${S.border}`,
      borderRadius:6,fontSize:11,fontWeight:600,color:S.t3,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}
     onMouseEnter={e=>{e.currentTarget.style.background="#263148";e.currentTarget.style.color=S.t1;}}
     onMouseLeave={e=>{e.currentTarget.style.background=S.cardIn;e.currentTarget.style.color=S.t3;}}>
     🖨 리포트 생성
    </button>
   </div>

   {/* 핵심 결론 */}
   {result.bottom_line && (
    <div style={{padding:"13px 18px",background:rb,borderLeft:`4px solid ${rc}`,borderRadius:"0 8px 8px 0",
     border:`1px solid ${rbd}`}}>
     <div style={{fontSize:9,fontWeight:800,color:rc,letterSpacing:".16em",textTransform:"uppercase",marginBottom:5}}>
      핵심 결론 (Bottom Line)
     </div>
     <div style={{fontSize:15,fontWeight:700,color:rc,lineHeight:1.65}}>{result.bottom_line}</div>
    </div>
   )}

   {/* 이슈 요약 */}
   {result.situation_summary && (
    <div style={{padding:"11px 16px",background:S.card,borderRadius:8,border:`1px solid ${S.border}`}}>
     <div style={{fontSize:9,fontWeight:700,color:S.t4,letterSpacing:".1em",textTransform:"uppercase",marginBottom:5}}>이슈 요약</div>
     <div style={{fontSize:12,color:S.t2,lineHeight:1.8}}>{result.situation_summary}</div>
    </div>
   )}

   {/* 2단: 4관점 판단 + 주요 리스크 */}
   <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>

    {/* 4관점 판단 */}
    <div>
     <div style={{fontSize:9,fontWeight:700,color:S.t4,letterSpacing:".1em",textTransform:"uppercase",marginBottom:9}}>
      4관점 검토 판단
     </div>
     <div style={{display:"flex",flexDirection:"column",gap:7}}>
      {perspMeta.map(m=>{
       const pd = getPd(m.key);
       return <div key={m.key} style={{display:"flex",gap:9,alignItems:"flex-start",padding:"9px 12px",
        background:S.cardIn,borderRadius:7,border:`1px solid ${S.border}`}}>
        <span style={{fontSize:17,flexShrink:0,marginTop:1}}>{m.icon}</span>
        <div style={{flex:1,minWidth:0}}>
         <div style={{fontSize:10,fontWeight:700,color:m.color,marginBottom:4}}>{m.label}</div>
         {pd.verdict && <div style={{marginBottom:3}}><VerdictBadge verdict={pd.verdict} small/></div>}
         {pd.verdict_reason && <div style={{fontSize:10,color:S.t4,lineHeight:1.5}}>{pd.verdict_reason}</div>}
        </div>
       </div>;
      })}
     </div>
    </div>

    {/* 주요 리스크 */}
    <div>
     <div style={{fontSize:9,fontWeight:700,color:S.t4,letterSpacing:".1em",textTransform:"uppercase",marginBottom:9}}>
      주요 리스크 (우선순위 순)
     </div>
     <div style={{display:"flex",flexDirection:"column",gap:6}}>
      {allRisks.length===0 && <div style={{fontSize:12,color:S.t4}}>리스크 정보 없음</div>}
      {allRisks.map((r,i)=>{
       const sc = SEV_COLOR[(r.severity||"").toUpperCase()]||"#94a3b8";
       return <div key={i} style={{display:"flex",gap:8,alignItems:"flex-start",padding:"8px 10px",
        background:S.cardIn,borderRadius:7,borderLeft:`3px solid ${sc}`}}>
        <div style={{flexShrink:0,padding:"2px 5px",borderRadius:3,background:`${sc}20`,
         fontSize:8,fontWeight:800,color:sc,marginTop:1}}>{r.severity}</div>
        <div style={{flex:1,minWidth:0}}>
         <div style={{fontSize:11,fontWeight:600,color:S.t1,marginBottom:2}}>{r.title}</div>
         <div style={{fontSize:10,color:S.t3,lineHeight:1.5}}>{r.detail}</div>
        </div>
        <span style={{fontSize:9,padding:"1px 6px",borderRadius:8,background:`${r.perspColor}15`,
         border:`1px solid ${r.perspColor}30`,color:r.perspColor,flexShrink:0,marginTop:1}}>
         {r.perspIcon}
        </span>
       </div>;
      })}
     </div>
    </div>
   </div>

   {/* 즉각 조치사항 */}
   {result.immediate_actions && result.immediate_actions.length>0 && (
    <div>
     <div style={{fontSize:9,fontWeight:700,color:S.t4,letterSpacing:".1em",textTransform:"uppercase",marginBottom:9}}>
      즉각 조치사항
     </div>
     <div style={{display:"flex",flexDirection:"column",gap:6}}>
      {result.immediate_actions.map((a,i)=>{
       const oc = {"법무팀":"#60a5fa","사업팀":"#34d399","기술팀":"#a78bfa","파트너십팀":"#fb923c","경영진":"#fbbf24"}[a.owner]||rc;
       return <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start",padding:"9px 12px",
        background:S.cardIn,border:`1px solid ${S.border}`,borderRadius:7}}>
        <div style={{display:"flex",flexDirection:"column",gap:3,flexShrink:0}}>
         <div style={{padding:"2px 8px",borderRadius:4,background:`${rc}15`,border:`1px solid ${rc}35`,
          fontSize:9,fontWeight:700,color:rc,whiteSpace:"nowrap"}}>{a.timeframe}</div>
         {a.owner && <div style={{padding:"1px 7px",borderRadius:4,background:`${oc}15`,
          fontSize:9,fontWeight:600,color:oc,textAlign:"center"}}>{a.owner}</div>}
        </div>
        <div style={{fontSize:12,color:S.t2,lineHeight:1.65,paddingTop:1}}>{a.action}</div>
       </div>;
      })}
     </div>
    </div>
   )}

   {/* 협상 레버리지 */}
   {result.negotiation_strategy && (
    <div style={{padding:"12px 16px",background:"rgba(29,78,216,0.08)",border:"1px solid rgba(59,130,246,0.25)",borderRadius:8}}>
     <div style={{fontSize:9,fontWeight:700,color:"#60a5fa",letterSpacing:".1em",textTransform:"uppercase",marginBottom:6}}>
      협상 레버리지 포인트
     </div>
     <div style={{fontSize:12,color:S.t2,lineHeight:1.8,whiteSpace:"pre-wrap"}}>{result.negotiation_strategy}</div>
    </div>
   )}

  </div>
 );
}

// ── LegalReviewResult ─────────────────────────────────────────────────────────
function LegalReviewResult({ result, clientName, opponentName, currentQuery }) {
 const [tab, setTab] = useState("summary");
 const client   = clientName   || "의뢰인";
 const opponent = opponentName || "상대방";
 const rv  = (result.risk_level || "MEDIUM").toUpperCase();
 const rc  = LEGAL_RISK_COLOR[rv]  || "#f59e0b";
 const rb  = LEGAL_RISK_BG[rv]    || "rgba(245,158,11,0.1)";
 const rbd = LEGAL_RISK_BORDER[rv] || "rgba(245,158,11,0.3)";
 const rl  = LEGAL_RISK_LABEL[rv]  || "주의";
 const S = { bg:"#020617", card:"#0f172a", cardIn:"#1e293b", border:"#334155",
  t1:"#f1f5f9", t2:"#cbd5e1", t3:"#94a3b8", t4:"#64748b",
  font:"system-ui,-apple-system,'Segoe UI',sans-serif" };

 const persp = result.perspectives || {};
 const getPerspective = (key) => {
  const p = persp[key];
  if (!p) return { verdict:null, verdict_reason:"", top_risks:[], analysis:result[`kt_${key}`]||"-", redlines:[] };
  if (typeof p === "string") return { verdict:null, verdict_reason:"", top_risks:[], analysis:p, redlines:[] };
  return { verdict:p.verdict||null, verdict_reason:p.verdict_reason||"", top_risks:Array.isArray(p.top_risks)?p.top_risks:[], analysis:p.analysis||"-", redlines:Array.isArray(p.redlines)?p.redlines:[] };
 };

 const PERSP_META = [
  {key:"legal",      tabId:"kt_legal",      label:"법적",     icon:"⚖", color:"#60a5fa"},
  {key:"business",   tabId:"kt_business",   label:"사업/재무",icon:"💼", color:"#34d399"},
  {key:"technical",  tabId:"kt_technical",  label:"기술",     icon:"⚙", color:"#a78bfa"},
  {key:"partnership",tabId:"kt_partnership",label:"파트너십", icon:"🤝", color:"#fb923c"},
 ];
 const tabs = [
  {id:"summary",  label:"C-Level 요약", icon:"📊", color:"#fbbf24", group:"exec"},
  ...PERSP_META.map(m=>({id:m.tabId,label:m.label,icon:m.icon,color:m.color,group:"kt"})),
  {id:"opponent", label:opponent,        icon:"⚔",  color:"#f87171", group:"other"},
  {id:"neutral",  label:"제3자",          icon:"🔍", color:"#94a3b8", group:"other"},
  {id:"actions",  label:`조치(${result.immediate_actions?.length||0})`, icon:"📋", color:"#fbbf24", group:"other"},
 ];
 const bodyStyle = {fontSize:13,color:S.t2,lineHeight:1.9,whiteSpace:"pre-wrap",wordBreak:"break-word"};

 const VerdictBadge = ({verdict}) => {
  if (!verdict) return null;
  const vc = VERDICT_COLOR[verdict]||"#94a3b8";
  const vb = VERDICT_BG[verdict]||"rgba(148,163,184,0.12)";
  return <span style={{display:"inline-flex",alignItems:"center",gap:5,padding:"4px 12px",borderRadius:14,
   background:vb,border:`1px solid ${vc}55`,fontSize:12,fontWeight:700,color:vc}}>
   {verdict==="수용"?"✓":verdict==="거부"?"✗":"△"} {verdict}
  </span>;
 };

 const RiskCards = ({risks}) => {
  if (!risks||!risks.length) return <div style={{color:S.t4,fontSize:12}}>해당 없음</div>;
  return <div style={{display:"flex",flexDirection:"column",gap:7}}>
   {risks.slice(0,3).map((r,i)=>{
    const sc = SEV_COLOR[(r.severity||"").toUpperCase()]||"#94a3b8";
    return <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start",padding:"10px 12px",
     background:S.cardIn,borderRadius:7,borderLeft:`3px solid ${sc}`}}>
     <div style={{flexShrink:0,padding:"2px 7px",borderRadius:4,background:`${sc}20`,
      fontSize:9,fontWeight:800,color:sc,letterSpacing:".06em",marginTop:1}}>{r.severity||"?"}</div>
     <div>
      <div style={{fontSize:12,fontWeight:600,color:S.t1,marginBottom:3}}>{r.title||""}</div>
      <div style={{fontSize:11,color:S.t3,lineHeight:1.6}}>{r.detail||""}</div>
     </div>
    </div>;
   })}
  </div>;
 };

 const RedlineCards = ({redlines}) => {
  if (!redlines||!redlines.length) return null;
  return <div style={{marginTop:16,paddingTop:14,borderTop:`1px solid ${S.border}`}}>
   <div style={{fontSize:10,fontWeight:700,color:"#fbbf24",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10}}>
    ✏ 수정 제안 (Redline)
   </div>
   {redlines.map((r,i)=>(
    <div key={i} style={{marginBottom:10,borderRadius:7,overflow:"hidden",border:`1px solid ${S.border}`}}>
     <div style={{padding:"8px 12px",background:"#1c110a",borderBottom:`1px solid ${S.border}`}}>
      <div style={{fontSize:9,fontWeight:700,color:"#f59e0b",letterSpacing:".06em",textTransform:"uppercase",marginBottom:4}}>⚠ 문제</div>
      <div style={{fontSize:12,color:"#fca5a5",lineHeight:1.6}}>{r.issue||""}</div>
     </div>
     <div style={{padding:"8px 12px",background:"#0a1c11"}}>
      <div style={{fontSize:9,fontWeight:700,color:"#22c55e",letterSpacing:".06em",textTransform:"uppercase",marginBottom:4}}>✓ 수정 제안</div>
      <div style={{fontSize:12,color:"#86efac",lineHeight:1.6}}>{r.suggestion||""}</div>
     </div>
    </div>
   ))}
  </div>;
 };

 return (
  <div style={{background:S.card,borderRadius:10,overflow:"hidden",border:`1px solid ${S.border}`,boxShadow:"0 4px 24px rgba(0,0,0,0.4)"}}>

   {/* 헤더 */}
   <div style={{background:S.bg,padding:"14px 20px",borderBottom:`1px solid ${S.border}`}}>
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,flexWrap:"wrap"}}>
     <span style={{display:"inline-flex",alignItems:"center",gap:6,padding:"5px 14px",borderRadius:20,
      background:rb,border:`1px solid ${rbd}`,fontSize:12,fontWeight:700,color:rc}}>
      <span style={{width:6,height:6,borderRadius:"50%",background:rc}}/>
      {rl}
     </span>
     {PERSP_META.map(m=>{
      const pd = getPerspective(m.key);
      if (!pd.verdict) return null;
      const vc = VERDICT_COLOR[pd.verdict]||"#94a3b8";
      return <span key={m.key} style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 9px",borderRadius:12,
       background:`${vc}15`,border:`1px solid ${vc}40`,fontSize:10,fontWeight:700,color:vc}}
       title={`${m.label}: ${pd.verdict}`}>
       <span style={{fontSize:11}}>{m.icon}</span>{pd.verdict}
      </span>;
     })}
    </div>
    <div style={{fontSize:12,color:S.t3,lineHeight:1.7}}>{result.situation_summary||""}</div>
    {result.risk_reason && <div style={{fontSize:11,color:S.t4,marginTop:4}}>{result.risk_reason}</div>}
   </div>

   {/* 종합 결론 */}
   {result.bottom_line && (
    <div style={{padding:"11px 20px",background:rb,borderBottom:`1px solid ${rbd}`,borderLeft:`4px solid ${rc}`}}>
     <div style={{fontSize:9,fontWeight:800,color:rc,letterSpacing:".12em",marginBottom:4,textTransform:"uppercase"}}>⚖ 종합 의견</div>
     <div style={{fontSize:14,fontWeight:600,color:rc,lineHeight:1.75}}>{result.bottom_line}</div>
    </div>
   )}

   {/* 탭 바 */}
   <div style={{background:S.bg,borderBottom:`1px solid ${S.border}`}}>
    <div style={{display:"flex",padding:"0 12px",overflowX:"auto"}}>
     {tabs.map((t,i)=>{
      const active = tab===t.id;
      const showDiv = i>0 && tabs[i-1].group!==t.group;
      return <div key={t.id} style={{display:"flex",alignItems:"center"}}>
       {showDiv && <div style={{width:1,height:18,background:S.border,margin:"0 4px"}}/>}
       <button onClick={()=>setTab(t.id)}
        style={{padding:"10px 11px",border:"none",background:"transparent",cursor:"pointer",
         fontSize:11,fontWeight:active?700:400,color:active?t.color:S.t4,
         borderBottom:active?`2px solid ${t.color}`:"2px solid transparent",
         transition:"all 0.15s",marginBottom:-1,whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:4}}>
        <span style={{fontSize:12}}>{t.icon}</span><span>{t.label}</span>
       </button>
      </div>;
     })}
    </div>
    <div style={{padding:"3px 14px 5px",display:"flex"}}>
     <span style={{fontSize:9,color:"#fbbf2433",letterSpacing:"0.1em",textTransform:"uppercase"}}>요약 →</span>
     <span style={{fontSize:9,color:"#60a5fa33",marginLeft:8,letterSpacing:"0.1em",textTransform:"uppercase"}}>{client} 내부 검토 →</span>
     <span style={{fontSize:9,color:S.border,marginLeft:"auto",letterSpacing:"0.08em",textTransform:"uppercase"}}>외부 관점 →</span>
    </div>
   </div>

   {/* 탭 콘텐츠 */}
   <div style={{padding:"20px"}}>

    {/* C-Level 요약 */}
    {tab==="summary" && (
     <ExecSummaryPanel
      result={result}
      clientName={clientName}
      opponentName={opponentName}
      currentQuery={currentQuery}
      onReport={()=>generateLegalReport(result,currentQuery||"",clientName,opponentName)}
     />
    )}

    {/* KT 4개 관점 */}
    {PERSP_META.map(m=>{
     if (tab!==m.tabId) return null;
     const pd = getPerspective(m.key);
     return <div key={m.key}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,padding:"11px 14px",
       background:S.cardIn,borderRadius:8,border:`1px solid ${S.border}`,flexWrap:"wrap"}}>
       <span style={{fontSize:14,color:m.color}}>{m.icon}</span>
       <span style={{fontSize:12,fontWeight:700,color:m.color}}>{client} {m.label}</span>
       <VerdictBadge verdict={pd.verdict}/>
       {pd.verdict_reason && <span style={{fontSize:11,color:S.t4}}>{pd.verdict_reason}</span>}
      </div>
      {pd.top_risks.length>0 && (
       <div style={{marginBottom:14}}>
        <div style={{fontSize:10,fontWeight:700,color:S.t4,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>
         핵심 리스크 TOP {Math.min(pd.top_risks.length,3)}
        </div>
        <RiskCards risks={pd.top_risks}/>
       </div>
      )}
      <div style={{background:S.card,border:`1px solid ${S.border}`,borderRadius:8,padding:"14px 16px",marginBottom:8}}>
       <div style={{fontSize:10,fontWeight:700,color:S.t4,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>상세 분석</div>
       <div style={bodyStyle}>{pd.analysis}</div>
       <RedlineCards redlines={pd.redlines}/>
      </div>
      {result.kt_overall && (
       <div style={{padding:"12px 16px",background:rb,borderRadius:8,border:`1px solid ${rbd}`,borderLeft:`3px solid ${rc}`}}>
        <div style={{fontSize:9,fontWeight:700,color:rc,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>{client} 4관점 종합</div>
        <div style={{fontSize:12,color:S.t2,lineHeight:1.8}}>{result.kt_overall}</div>
       </div>
      )}
     </div>;
    })}

    {tab==="opponent" && <div style={{background:S.card,border:`1px solid ${S.border}`,borderRadius:8,padding:"14px 16px"}}>
     <div style={{fontSize:10,fontWeight:700,color:"#f87171",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>⚔ {opponent} 관점</div>
     <div style={bodyStyle}>{result.opponent_legal||"-"}</div>
    </div>}

    {tab==="neutral" && <div style={{background:S.card,border:`1px solid ${S.border}`,borderRadius:8,padding:"14px 16px"}}>
     <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>🔍 제3자 중립 분석</div>
     <div style={bodyStyle}>{result.neutral_analysis||"-"}</div>
     {result.negotiation_strategy && <div style={{marginTop:14,paddingTop:14,borderTop:`1px solid ${S.border}`}}>
      <div style={{fontSize:10,fontWeight:700,color:"#fb923c",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>협상 레버리지 포인트</div>
      <div style={bodyStyle}>{result.negotiation_strategy}</div>
     </div>}
    </div>}

    {tab==="actions" && <div>
     {(!result.immediate_actions||!result.immediate_actions.length) && <div style={{color:S.t4,fontSize:12,padding:"12px 0"}}>조치사항 없음</div>}
     {(result.immediate_actions||[]).map((a,i)=>{
      const oc = {"법무팀":"#60a5fa","사업팀":"#34d399","기술팀":"#a78bfa","파트너십팀":"#fb923c","경영진":"#fbbf24"}[a.owner]||rc;
      return <div key={i} style={{display:"flex",gap:12,alignItems:"flex-start",padding:"12px 14px",
       background:S.card,border:`1px solid ${S.border}`,borderRadius:8,marginBottom:8}}>
       <div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0}}>
        <div style={{padding:"3px 9px",borderRadius:4,background:`${rc}18`,border:`1px solid ${rc}40`,fontSize:10,fontWeight:700,color:rc,whiteSpace:"nowrap"}}>{a.timeframe||`조치 ${i+1}`}</div>
        {a.owner && <div style={{padding:"2px 8px",borderRadius:4,background:`${oc}15`,fontSize:9,fontWeight:600,color:oc,textAlign:"center",whiteSpace:"nowrap"}}>{a.owner}</div>}
       </div>
       <div style={{fontSize:13,color:S.t2,lineHeight:1.7,paddingTop:2}}>{a.action||""}</div>
      </div>;
     })}
    </div>}

   </div>
  </div>
 );
}

// ── GeneralLegalReviewTab ─────────────────────────────────────────────────────
function GeneralLegalReviewTab() {
 const [situation, setSituation]       = useState("");
 const [clientName, setClientName]     = useState("");
 const [opponentName, setOpponentName] = useState("");
 const [docContext, setDocContext]     = useState("");
 const [uploadedFile, setUploadedFile] = useState(null);
 const [loading, setLoading]           = useState(false);
 const [error, setError]               = useState(null);
 const [result, setResult]             = useState(null);
 const [currentQuery, setCurrentQuery] = useState("");
 const [legalHistory, setLegalHistory] = useState(() => {
  try { const s = localStorage.getItem("general_legal_history_v2"); return s ? JSON.parse(s) : []; } catch { return []; }
 });
 const [activeId, setActiveId]   = useState(null);
 const [leftTab, setLeftTab]     = useState("review"); // "review" | "history"
 // 추가검토 채팅
 const [chatMsgs, setChatMsgs]   = useState([]);
 const [chatInput, setChatInput] = useState("");
 const [chatLoading, setChatLoading] = useState(false);
 const abortRef   = useRef(null);
 const chatAbortRef = useRef(null);
 const fileRef    = useRef(null);
 const chatEndRef = useRef(null);

 const saveLegalHistory = (h) => {
  try { localStorage.setItem("general_legal_history_v2", JSON.stringify(h.slice(-30))); } catch {}
 };

 // 추가검토: LLM 채팅
 const sendChat = async () => {
  const q = chatInput.trim();
  if (!q || chatLoading) return;
  setChatInput("");
  const userMsg = { role:"user", content:q };
  const msgs = [...chatMsgs, userMsg];
  setChatMsgs(msgs);
  setChatLoading(true);
  const abortCtrl = new AbortController();
  chatAbortRef.current = abortCtrl;
  // 현재 분석 결과를 시스템 컨텍스트로 활용
  const sysCtx = result
   ? `당신은 법률·사업·기술 통합 전문 AI 어시스턴트입니다.\n\n[현재 검토 컨텍스트]\n의뢰인: ${clientName||"의뢰인"} / 상대방: ${opponentName||"상대방"}\n이슈: ${currentQuery}\n위험도: ${result.risk_level}\n핵심 결론: ${result.bottom_line}\n상황 요약: ${result.situation_summary}\n\n위 분석 결과를 바탕으로 추가 질문에 답하세요. 간결하고 실용적으로 답변하세요.`
   : `당신은 법률·사업·기술 통합 전문 AI 어시스턴트입니다. 간결하고 실용적으로 답변하세요.`;
  try {
   const res = await fetch("/api/chat", {
    method:"POST", headers:{"Content-Type":"application/json"}, signal: abortCtrl.signal,
    body: JSON.stringify({
     system: sysCtx,
     max_tokens: 2048,
     messages: msgs.map(m=>({role:m.role,content:m.content})),
    }),
   });
   const data = await res.json();
   const text = (data.content||[]).map(c=>c.text||"").join("").trim() || "(응답 없음)";
   setChatMsgs(prev=>[...prev,{role:"assistant",content:text}]);
   setTimeout(()=>chatEndRef.current?.scrollIntoView({behavior:"smooth"}),50);
  } catch(e) {
   if (e.name!=="AbortError") setChatMsgs(prev=>[...prev,{role:"assistant",content:"오류: "+e.message}]);
  } finally { setChatLoading(false); chatAbortRef.current=null; }
 };

 const handleFileUpload = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
   reader.onload = (ev) => {
    const base64 = ev.target.result.split(",")[1];
    setUploadedFile({ name: file.name, mimeType: "application/pdf", data: base64 });
   };
   reader.readAsDataURL(file);
  } else {
   reader.onload = (ev) => {
    setDocContext(prev => (prev ? prev + "\n\n" : "") + `[${file.name}]\n${ev.target.result}`);
   };
   reader.readAsText(file, "UTF-8");
  }
  e.target.value = "";
 };

 const analyze = async () => {
  if (!situation.trim() || loading) return;
  const query = situation.trim();
  const abortCtrl = new AbortController();
  abortRef.current = abortCtrl;
  setLoading(true); setError(null); setResult(null); setCurrentQuery(query);
  try {
   const body = {
    max_tokens: 8192,
    messages: [{ role:"user", content: buildGeneralLegalPrompt(query, clientName, opponentName, docContext) }],
   };
   if (uploadedFile) body.document = { mimeType: uploadedFile.mimeType, data: uploadedFile.data };
   const res = await fetch("/api/chat", {
    method:"POST", headers:{"Content-Type":"application/json"}, signal: abortCtrl.signal,
    body: JSON.stringify(body),
   });
   if (!res.ok) { const t = await res.text(); throw new Error("API "+res.status+": "+t); }
   const data = await res.json();
   if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
   const text = (data.content||[]).map(c=>c.text||"").join("").trim();
   if (!text) throw new Error("빈 응답");
   const js = text.indexOf("{"), je = text.lastIndexOf("}");
   if (js===-1||je===-1) throw new Error("JSON 응답 없음");
   let parsed;
   try { parsed = JSON.parse(text.slice(js,je+1)); }
   catch(e) {
    const fixed = text.slice(js,je+1).replace(/,(\s*[}\]])/g,"$1");
    try { parsed = JSON.parse(fixed); } catch(e2) { throw new Error("JSON 파싱 실패: "+e.message); }
   }
   const toStr = (v,fb="-") => !v?fb:typeof v==="string"?v:Array.isArray(v)?v.join("\n"):String(v);
   const r = {
    risk_level:           ["HIGH","MEDIUM","LOW"].includes((parsed.risk_level||"").toUpperCase()) ? parsed.risk_level.toUpperCase() : "MEDIUM",
    risk_reason:          toStr(parsed.risk_reason),
    situation_summary:    toStr(parsed.situation_summary, query),
    bottom_line:          toStr(parsed.bottom_line),
    kt_overall:           toStr(parsed.kt_overall),
    negotiation_strategy: toStr(parsed.negotiation_strategy),
    opponent_legal:       toStr(parsed.opponent_legal),
    neutral_analysis:     toStr(parsed.neutral_analysis),
    immediate_actions:    Array.isArray(parsed.immediate_actions) ? parsed.immediate_actions : [],
    perspectives:         parsed.perspectives || {},
    kt_legal:             toStr(parsed.kt_legal),
    kt_business:          toStr(parsed.kt_business),
    kt_technical:         toStr(parsed.kt_technical),
    kt_partnership:       toStr(parsed.kt_partnership),
   };
   setResult(r);
   const entry = { id:Date.now(), query, clientName:clientName||"의뢰인", opponentName:opponentName||"상대방", result:r, ts:new Date().toLocaleString("ko-KR") };
   const nh = [entry, ...legalHistory];
   setLegalHistory(nh); setActiveId(entry.id); saveLegalHistory(nh);
  } catch(e) {
   if (e.name!=="AbortError") setError("오류: "+e.message);
  } finally { setLoading(false); abortRef.current = null; }
 };

 const loadEntry = (entry) => {
  setResult(entry.result); setCurrentQuery(entry.query);
  setClientName(entry.clientName||""); setOpponentName(entry.opponentName||""); setActiveId(entry.id);
 };
 const deleteEntry = (id) => {
  const nh = legalHistory.filter(h=>h.id!==id); setLegalHistory(nh); saveLegalHistory(nh);
  if (activeId===id) { setResult(null); setActiveId(null); }
 };

 const S = { bg:"#020617", card:"#0f172a", cardIn:"#1e293b", border:"#334155",
  t1:"#f1f5f9", t2:"#cbd5e1", t3:"#94a3b8", t4:"#64748b",
  font:"system-ui,-apple-system,'Segoe UI',sans-serif" };

 return (
  <div style={{display:"grid",gridTemplateColumns:"300px 1fr",height:"100%",fontFamily:S.font}}>

   {/* 왼쪽 사이드바 */}
   <div style={{background:S.card,borderRight:`1px solid ${S.border}`,display:"flex",flexDirection:"column",height:"100%",overflow:"hidden"}}>

    {/* ── 탭 바: 제안검토 | 히스토리 ── */}
    <div style={{display:"flex",borderBottom:`1px solid ${S.border}`,flexShrink:0,background:S.bg}}>
     {[["review","제안검토"],["history","히스토리"]].map(([id,label])=>(
      <button key={id} onClick={()=>setLeftTab(id)}
       style={{flex:1,padding:"10px 0",border:"none",background:"transparent",cursor:"pointer",fontFamily:S.font,
        fontSize:12,fontWeight:leftTab===id?700:400,
        color:leftTab===id?"#e2e8f0":"#64748b",
        borderBottom:leftTab===id?"2px solid #60a5fa":"2px solid transparent",
        transition:"all 0.15s",marginBottom:-1}}>
       {label}{id==="history"&&legalHistory.length>0?` (${legalHistory.length})`:""}
      </button>
     ))}
    </div>

    {/* ── 탭 콘텐츠 (flex:1) ── */}
    <div style={{flex:1,overflowY:"auto",minHeight:0}}>

     {/* 제안검토 탭 */}
     {leftTab==="review" && (
      <div style={{padding:"14px 16px"}}>
       <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
        {[["의뢰인","예: KT, A사",clientName,setClientName],["상대방","예: B사, 피고",opponentName,setOpponentName]].map(([label,ph,val,set])=>(
         <div key={label}>
          <div style={{fontSize:10,color:S.t4,marginBottom:4}}>{label}</div>
          <input value={val} onChange={e=>set(e.target.value)} placeholder={ph}
           style={{width:"100%",background:S.cardIn,border:`1px solid ${S.border}`,borderRadius:5,
            padding:"7px 10px",fontSize:11,color:S.t1,outline:"none",boxSizing:"border-box"}}/>
         </div>
        ))}
       </div>

       <div style={{fontSize:10,color:S.t4,marginBottom:4}}>법적 상황 / 이슈 *</div>
       <textarea value={situation} onChange={e=>setSituation(e.target.value)}
        onKeyDown={e=>(e.metaKey||e.ctrlKey)&&e.key==="Enter"&&analyze()}
        placeholder={"계약 위반, 분쟁, 협상 상황을 설명하세요.\n\nCtrl+Enter로 분석 실행"}
        style={{width:"100%",background:S.cardIn,border:`1px solid ${S.border}`,borderRadius:6,
         padding:"10px 12px",fontSize:12,color:S.t1,resize:"none",height:120,outline:"none",
         lineHeight:1.7,boxSizing:"border-box",marginBottom:8}}/>

       <div style={{fontSize:10,color:S.t4,marginBottom:4}}>참고 문서 <span style={{color:"#475569"}}>(선택)</span></div>
       <textarea value={docContext} onChange={e=>setDocContext(e.target.value)}
        placeholder="계약 조항이나 문서 내용 붙여넣기"
        style={{width:"100%",background:S.cardIn,border:`1px solid ${S.border}`,borderRadius:6,
         padding:"10px 12px",fontSize:11,color:S.t1,resize:"none",height:60,outline:"none",
         lineHeight:1.7,boxSizing:"border-box",marginBottom:8}}/>

       <div style={{marginBottom:10}}>
        <div style={{fontSize:10,color:S.t4,marginBottom:5}}>제안서 파일 <span style={{color:"#475569"}}>(PDF · TXT · MD)</span></div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
         <label style={{padding:"6px 10px",background:S.cardIn,border:`1px solid ${S.border}`,borderRadius:5,
          fontSize:11,color:S.t3,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0,transition:"all .15s"}}
          onMouseEnter={e=>{e.currentTarget.style.borderColor="#475569";e.currentTarget.style.color=S.t1;}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor=S.border;e.currentTarget.style.color=S.t3;}}>
          📎 파일
          <input ref={fileRef} type="file" accept=".pdf,.txt,.md" style={{display:"none"}} onChange={handleFileUpload}/>
         </label>
         {uploadedFile ? (
          <div style={{display:"flex",alignItems:"center",gap:5,padding:"4px 8px",
           background:"#0d2d20",border:"1px solid #22c55e40",borderRadius:5,flex:1,minWidth:0}}>
           <span style={{fontSize:10,color:"#86efac",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>
            📄 {uploadedFile.name}
           </span>
           <button onClick={()=>setUploadedFile(null)}
            style={{background:"none",border:"none",cursor:"pointer",color:S.t4,fontSize:11,padding:0,flexShrink:0}}
            onMouseEnter={e=>e.currentTarget.style.color="#f87171"}
            onMouseLeave={e=>e.currentTarget.style.color=S.t4}>✕</button>
          </div>
         ) : (
          <span style={{fontSize:10,color:"#334155",lineHeight:1.5}}>PDF 업로드 시 AI가 직접 읽습니다</span>
         )}
        </div>
       </div>

       <div style={{display:"flex",gap:8}}>
        <button onClick={analyze} disabled={!situation.trim()||loading}
         style={{flex:1,padding:"9px 0",fontFamily:S.font,
          background:situation.trim()&&!loading?"#1d4ed8":"#1e293b",
          border:`1px solid ${situation.trim()&&!loading?"#3b82f660":"#334155"}`,
          borderRadius:5,fontSize:12,fontWeight:600,
          color:situation.trim()&&!loading?"#93c5fd":"#475569",
          cursor:situation.trim()&&!loading?"pointer":"default",transition:"all 0.15s"}}>
         {loading?"분석 중...":"법률 분석"}
        </button>
        {loading && (
         <button onClick={()=>{if(abortRef.current)abortRef.current.abort();}}
          style={{padding:"9px 10px",background:"transparent",border:"1px solid #475569",borderRadius:5,
           fontSize:11,color:S.t4,cursor:"pointer",whiteSpace:"nowrap",fontFamily:S.font}}
          onMouseEnter={e=>{e.currentTarget.style.borderColor="#ef4444";e.currentTarget.style.color="#f87171";}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor="#475569";e.currentTarget.style.color=S.t4;}}>
          ✕
         </button>
        )}
       </div>
      </div>
     )}

     {/* 히스토리 탭 */}
     {leftTab==="history" && (
      <div style={{padding:"12px 14px"}}>
       {legalHistory.length===0 ? (
        <div style={{fontSize:11,color:S.t4,textAlign:"center",marginTop:24}}>분석 히스토리 없음</div>
       ) : <>
        <div style={{fontSize:10,fontWeight:600,color:S.t4,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>
         History ({legalHistory.length})
        </div>
        {legalHistory.map(h=>{
         const rcolor = LEGAL_RISK_COLOR[h.result?.risk_level]||"#94a3b8";
         return <div key={h.id}
          style={{padding:"9px 10px",borderRadius:6,marginBottom:5,cursor:"pointer",transition:"all 0.1s",
           border:`1px solid ${activeId===h.id?rcolor+"55":"#334155"}`,
           background:activeId===h.id?rcolor+"0c":"#1e293b",display:"flex",flexDirection:"column",gap:4}}
          onClick={()=>{loadEntry(h);setLeftTab("review");}}>
          <div style={{display:"flex",alignItems:"center",gap:5}}>
           <div style={{width:5,height:5,borderRadius:"50%",background:rcolor,flexShrink:0}}/>
           <span style={{fontSize:10,color:rcolor,fontWeight:700}}>{h.result?.risk_level||"?"}</span>
           <span style={{fontSize:10,color:S.t4,marginLeft:"auto"}}>{h.ts}</span>
           <button onClick={e=>{e.stopPropagation();deleteEntry(h.id);}}
            style={{background:"none",border:"none",cursor:"pointer",color:S.t4,fontSize:12,padding:"0 2px"}}
            onMouseEnter={e=>e.currentTarget.style.color="#f87171"}
            onMouseLeave={e=>e.currentTarget.style.color=S.t4}>✕</button>
          </div>
          <div style={{fontSize:10,color:"#60a5fa"}}>{h.clientName||"의뢰인"} vs {h.opponentName||"상대방"}</div>
          <div style={{fontSize:11,color:S.t3,lineHeight:1.5}}>{h.query.length>45?h.query.slice(0,45)+"…":h.query}</div>
         </div>;
        })}
       </>}
      </div>
     )}
    </div>

    {/* ── 추가검토 (LLM 채팅, 항상 하단 고정) ── */}
    <div style={{flexShrink:0,height:230,borderTop:`1px solid ${S.border}`,display:"flex",flexDirection:"column",background:S.bg}}>
     {/* 헤더 */}
     <div style={{padding:"7px 14px",borderBottom:`1px solid ${S.border}`,display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
      <span style={{fontSize:10,fontWeight:700,color:"#fbbf24",letterSpacing:"0.1em",textTransform:"uppercase"}}>💬 추가검토</span>
      {result && <span style={{fontSize:9,color:S.t4,marginLeft:2}}>현재 분석 결과 기반 질의</span>}
      {chatMsgs.length>0 && (
       <button onClick={()=>setChatMsgs([])}
        style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",color:S.t4,fontSize:10,padding:0}}
        onMouseEnter={e=>e.currentTarget.style.color="#f87171"}
        onMouseLeave={e=>e.currentTarget.style.color=S.t4}>초기화</button>
      )}
     </div>

     {/* 메시지 영역 */}
     <div style={{flex:1,overflowY:"auto",padding:"8px 12px",display:"flex",flexDirection:"column",gap:7,minHeight:0}}>
      {chatMsgs.length===0 && !chatLoading && (
       <div style={{fontSize:10,color:"#334155",textAlign:"center",marginTop:12,lineHeight:1.8}}>
        {result?"분석 결과에 대해 추가 질문하세요":"분석 후 추가 질문이 가능합니다"}
        {result && <><br/><span style={{color:S.t4,fontSize:9}}>예: 이 계약에서 가장 먼저 협상해야 할 조항은?</span></>}
       </div>
      )}
      {chatMsgs.map((m,i)=>(
       <div key={i} style={{display:"flex",flexDirection:"column",alignItems:m.role==="user"?"flex-end":"flex-start"}}>
        <div style={{
         maxWidth:"88%",padding:"7px 10px",borderRadius:m.role==="user"?"10px 10px 2px 10px":"10px 10px 10px 2px",
         background:m.role==="user"?"#1d4ed820":"#1e293b",
         border:`1px solid ${m.role==="user"?"#3b82f630":"#334155"}`,
         fontSize:11,color:m.role==="user"?"#93c5fd":S.t2,lineHeight:1.65,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>
         {m.content}
        </div>
       </div>
      ))}
      {chatLoading && (
       <div style={{display:"flex",alignItems:"center",gap:5,padding:"4px 2px"}}>
        {[0,1,2].map(i=><div key={i} style={{width:5,height:5,borderRadius:"50%",background:"#60a5fa",
         animation:"bounce 0.7s ease-in-out infinite",animationDelay:`${i*0.15}s`}}/>)}
       </div>
      )}
      <div ref={chatEndRef}/>
     </div>

     {/* 입력 영역 */}
     <div style={{padding:"7px 10px",borderTop:`1px solid ${S.border}`,display:"flex",gap:6,alignItems:"flex-end",flexShrink:0}}>
      <textarea
       value={chatInput}
       onChange={e=>setChatInput(e.target.value)}
       onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendChat();}}}
       placeholder="추가 질문 입력 (Enter 전송, Shift+Enter 줄바꿈)"
       rows={2}
       style={{flex:1,background:S.cardIn,border:`1px solid ${S.border}`,borderRadius:6,
        padding:"6px 9px",fontSize:11,color:S.t1,outline:"none",resize:"none",
        lineHeight:1.6,fontFamily:S.font,boxSizing:"border-box"}}/>
      <button onClick={sendChat} disabled={!chatInput.trim()||chatLoading}
       style={{padding:"6px 11px",borderRadius:6,border:"none",fontFamily:S.font,fontSize:11,fontWeight:600,
        background:chatInput.trim()&&!chatLoading?"#1d4ed8":"#1e293b",
        color:chatInput.trim()&&!chatLoading?"#93c5fd":"#475569",
        cursor:chatInput.trim()&&!chatLoading?"pointer":"default",flexShrink:0,height:52}}>
       {chatLoading?"…":"전송"}
      </button>
     </div>
    </div>

   </div>

   {/* 오른쪽 결과 */}
   <div style={{overflowY:"auto",padding:24,background:S.bg}}>
    {loading && (
     <div style={{background:S.card,border:`1px solid ${S.border}`,borderRadius:10,padding:40,textAlign:"center"}}>
      <div style={{fontSize:13,color:S.t4,letterSpacing:"0.1em"}}>ANALYZING...</div>
      <div style={{fontSize:11,color:"#475569",marginTop:4}}>법적·사업·기술·파트너십 4관점 분석 중</div>
      <div style={{display:"flex",justifyContent:"center",gap:6,marginTop:14}}>
       {[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:"50%",background:"#3b82f6",
        animation:"bounce 0.8s ease-in-out infinite",animationDelay:`${i*0.2}s`}}/>)}
      </div>
     </div>
    )}
    {error && !loading && (
     <div style={{background:"#1c0808",border:"1px solid #ef444430",borderRadius:8,padding:"12px 16px",fontSize:12,color:"#f87171"}}>{error}</div>
    )}
    {result && !loading && (
     <div>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
       <span style={{fontSize:10,color:S.t4,letterSpacing:"0.08em",textTransform:"uppercase"}}>이슈</span>
       <span style={{fontSize:12,color:S.t3,background:S.card,border:`1px solid ${S.border}`,
        borderRadius:5,padding:"4px 10px",flex:1,lineHeight:1.6,wordBreak:"break-all"}}>{currentQuery}</span>
      </div>
      <LegalReviewResult result={result} clientName={clientName} opponentName={opponentName} currentQuery={currentQuery}/>
     </div>
    )}
    {!result && !loading && !error && (
     <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"70%",gap:16}}>
      <div style={{width:52,height:52,borderRadius:12,background:S.card,border:`1px solid ${S.border}`,
       display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,opacity:0.4}}>⚖</div>
      <div style={{fontSize:13,color:S.t4,textAlign:"center",lineHeight:2.2}}>
       법적 상황을 입력하면<br/>
       <span style={{color:"#60a5fa"}}>법적</span> · <span style={{color:"#34d399"}}>사업</span> · <span style={{color:"#a78bfa"}}>기술</span> · <span style={{color:"#fb923c"}}>파트너십</span> 4관점 분석<br/>
       <span style={{fontSize:11,color:"#334155"}}>수용/조건부/거부 판단 · 리스크카드 · Redline · C-Level 리포트</span>
      </div>
     </div>
    )}
   </div>
  </div>
 );
