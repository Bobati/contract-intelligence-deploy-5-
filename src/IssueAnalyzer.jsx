import { useState, useRef, useEffect, Component } from "react";

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{padding:"20px",background:"#1a0808",border:"1px solid #ef444433",borderRadius:8,margin:"12px 0",fontFamily:"monospace"}}>
          <div style={{color:"#f87171",fontWeight:700,marginBottom:8}}>렌더링 오류 (개발자용)</div>
          <pre style={{color:"#fca5a5",fontSize:11,whiteSpace:"pre-wrap",wordBreak:"break-all"}}>{this.state.error?.message}{"\n"}{this.state.error?.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// ------------------------------------------------------------------------------
// ------------------------------------------------------------------------------
const SUPABASE_URL = typeof __SUPABASE_URL__ !== "undefined" ? __SUPABASE_URL__ : null;
const SUPABASE_KEY = typeof __SUPABASE_KEY__ !== "undefined" ? __SUPABASE_KEY__ : null;
const USE_SUPABASE = !!(SUPABASE_URL && SUPABASE_KEY);

const getSessionId = () => {
 try { return localStorage.getItem("_ckt_session") || ""; } catch { return ""; }
};
const setSessionId = (id) => {
 try { localStorage.setItem("_ckt_session", id); } catch {}
};
let SESSION_ID = getSessionId();

const sbFetch = async (method, table, body) => {
 const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
 method,
 headers: {
 "Content-Type": "application/json",
 "apikey": SUPABASE_KEY,
 "Authorization": `Bearer ${SUPABASE_KEY}`,
 "Prefer": method === "POST" ? "resolution=merge-duplicates" : "",
 },
 body: body ? JSON.stringify(body) : undefined,
 });
 if (!res.ok) throw new Error(`Supabase ${method} ${table} 실패: ${res.status}`);
 return res.json().catch(() => null);
};

const _memStore = new Map();
// 원문 인메모리 스토어: { docId -> { type, b64?, text?, mediaType?, fileName, docType } }
const _rawDocStore = new Map();
// 조항 전문번역 인메모리 캐시: { clauseId -> fullTranslation }
const _fullTranslationCache = new Map();
const FULL_TRANSLATION_BANK_KEY = "clause_full_translation_bank_v1";

const storage = {
 get: async (key) => {
 if (USE_SUPABASE) {
 try {
 const rows = await sbFetch('GET', `kv_store?session_id=eq.${SESSION_ID}&key=eq.${encodeURIComponent(key)}&select=value`, null);
 return rows?.[0]?.value ?? null;
 } catch(e) {}
 }
 if (_memStore.has(key)) return _memStore.get(key);
 try { return localStorage.getItem(key); } catch { return null; }
 },
 set: async (key, value) => {
 _memStore.set(key, value);
 if (USE_SUPABASE) {
 try { await sbFetch('POST', 'kv_store', { session_id: SESSION_ID, key, value }); return; } catch(e) {}
 }
 try { localStorage.setItem(key, value); } catch {}
 },
 remove: async (key) => {
 _memStore.delete(key);
 if (USE_SUPABASE) {
 try { await sbFetch('DELETE', `kv_store?session_id=eq.${SESSION_ID}&key=eq.${encodeURIComponent(key)}`, null); return; } catch(e) {}
 }
 try { localStorage.removeItem(key); } catch {}
 },
};

const ISSUE_TEMPLATES = [
 {
  label: "계약 위반",
  emoji: "⚠",
  text: `Palantir가 [언제부터] [어떤 의무]를 이행하지 않고 있다.\nKT는 [원하는 결과: 예) 즉시 이행 요구 / 손해배상 청구]를 원한다.`,
 },
 {
  label: "대금·이행",
  emoji: "💰",
  text: `Palantir가 [금액 또는 조건]을 요구하고 있다.\nKT는 이 요구가 [이유]로 부당하다고 생각하며, [원하는 결과]를 원한다.`,
 },
 {
  label: "해지·종료",
  emoji: "🔚",
  text: `[KT / Palantir]가 계약 해지를 [통보했다 / 검토 중이다].\n배경은 [상황 설명]이며, KT는 [원하는 결과: 예) 해지 무효 / 위약금 청구]를 원한다.`,
 },
 {
  label: "IP·데이터",
  emoji: "🔒",
  text: `[데이터 / 소프트웨어 / IP] 관련 분쟁이 발생했다.\nPalantir가 [상황: 예) 무단 사용 / 접근 거부]하고 있으며, KT는 [원하는 결과]를 원한다.`,
 },
 {
  label: "손해배상",
  emoji: "⚖",
  text: `Palantir의 [행위 또는 불이행]으로 KT에 [피해 내용]이 발생했다.\n배상 청구 또는 협의 방안을 검토하고 싶다.`,
 },
];

export default function IssueAnalyzer() {
 const [sessionCode, setSessionCode] = useState(SESSION_ID);
 const [sessionReady, setSessionReady] = useState(!!SESSION_ID);
 const [appTab, setAppTab] = useState("analyze"); // "docs" | "analyze"
 const [globalViewingClause, setGlobalViewingClause] = useState(null);
 const [mode, setMode] = useState("auto");
 const [input, setInput] = useState("");
 const [history, setHistory] = useState([]);
 const [loading, setLoading] = useState(false);
 const [loadingMsg, setLoadingMsg] = useState("ANALYZING...");
 const [rawDocCount, setRawDocCount] = useState(0);
 const abortRef = useRef(null);
 const cancelAnalysis = () => { if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; } };
 const [error, setError] = useState(null);
 const [activeHistory, setActiveHistory] = useState(null);
 const [amendments, setAmendments] = useState([]);
 const [kbSummary, setKbSummary] = useState({ clauses: CONTRACT_KB.clauses.length, conflicts: CONTRACT_KB.conflicts.length });
 const [translationSync, setTranslationSync] = useState({ running:false, total:0, done:0, failed:0 });

 useEffect(()=>{
 if (!sessionReady) return;
 (async()=>{
 try {
 const patchHistory = await loadAndApplyStoredPatches();
 if (patchHistory && patchHistory.length > 0) {
 setAmendments(patchHistory.map(h => ({
 id: h.id,
 fileName: h.fileName,
 docType: h.docType,
 effectiveDate: h.effectiveDate,
 summary: h.summary,
 uploadedAt: h.uploadedAt,
 changes: (h.patches || []).map(p => ({
 clauseId: p.clauseId,
 changeType: p.changeType,
 newText: p.newCore,
 prevCore: p.prevCore,
 topic: p.topic,
 }))
 })));
 }
 await loadDynamicKB();
 await loadStoredFullTranslations();
 setKbSummary({ clauses: CONTRACT_KB.clauses.length, conflicts: CONTRACT_KB.conflicts.length });
 const s = await storage.get("issue_history");
 if (s) {
  const h = JSON.parse(s);
  // 구버전 히스토리 마이그레이션: _issueType 없으면 추론
  h.forEach(entry => {
   if (entry.result && !entry.result._issueType) {
    entry.result._issueType = classifyIssueLocally(entry.query);
   }
  });
  setHistory(h);
 }

 const pending = getClausesNeedingFullTranslation().length;
 if (pending > 0) {
 setTranslationSync({ running:true, total:pending, done:0, failed:0 });
 await buildAndPersistFullTranslationBank({
 onProgress: ({ done, failed, total }) => setTranslationSync({ running:true, total, done, failed }),
 });
 setTranslationSync((prev) => ({ ...prev, running:false }));
 }
 } catch(e){}
 })();
 },[sessionReady]);

 const handleSessionStart = () => {
  const next = (sessionCode || "").toLowerCase().trim();
  if (!next) return;
  SESSION_ID = next;
  setSessionId(SESSION_ID);
  setSessionCode(SESSION_ID);
  setSessionReady(true);
 };

 const handleSessionChange = () => {
  setSessionCode(SESSION_ID || "");
  setSessionReady(false);
 };

 const handleAmendmentsChange = (list) => { setAmendments(list); };
 const handleKBUpdated = ({ clauses, conflicts }) => {
 setKbSummary({ clauses: clauses.length, conflicts: conflicts.length });
 };

 const saveHistory = async (h) => {
 try { await storage.set("issue_history", JSON.stringify(h.slice(-50))); } catch(e){}
 };

 const deleteHistory = async (id) => {
 const nh = history.filter(h => h.id !== id);
 setHistory(nh);
 if (activeHistory === id) setActiveHistory(null);
 await saveHistory(nh);
 };

 const updateMemo = async (id, memo) => {
 const nh = history.map(h => h.id === id ? {...h, memo} : h);
 setHistory(nh);
 await saveHistory(nh);
 };

 const clearHistory = async () => {
 setHistory([]); setActiveHistory(null);
 try { await storage.remove("issue_history"); } catch(e){}
 };

 const analyze = async () => {
 if (!input.trim()||loading) return;
 const query = input.trim();
 // 자동 모드: 이슈 내용 기반으로 기본/확장 결정
 const effectiveMode = mode === "auto" ? detectMode(query) : mode;
 const abortCtrl = new AbortController();
 abortRef.current = abortCtrl;
 setInput(""); setLoading(true); setError(null); setActiveHistory(null);
 try {
 // 업로드된 원문 문서 로드
 const currentDocs = await DocDB.load().then(r => r.docs || []);
 const rawItems = await DocDB.loadAllRaw(currentDocs);
 setRawDocCount(rawItems.length);
 // 이슈 유형 분류 (로컬 키워드 기반)
 const issueType = classifyIssueLocally(query);
 // messages content 구성: [문서들..., 이슈 질문]
 const userContent = [];
 for (const { doc, raw } of rawItems) {
  if (raw.type === "pdf") {
   userContent.push({ type: "document", source: { type: "base64", media_type: raw.mediaType||"application/pdf", data: raw.b64 }, title: doc.fileName });
  } else if (raw.type === "text" && raw.text) {
   userContent.push({ type: "document", source: { type: "text", data: raw.text }, title: doc.fileName });
  }
 }
 // URL이 포함된 경우 내용 fetch
 const urlMatch = query.match(/https?:\/\/[^\s]+/);
 let finalQuery = query;
 if (urlMatch) {
  try {
   const fetchRes = await fetch("/api/fetch-url", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ url: urlMatch[0] }) });
   const fetchData = await fetchRes.json();
   if (fetchData.content) {
    finalQuery = query + "\n\n[URL 내용: " + urlMatch[0] + "]\n" + fetchData.content;
   }
  } catch(e) { /* URL fetch 실패 시 원본 쿼리 사용 */ }
 }
 userContent[userContent.length - 1] = { type: "text", text: finalQuery };
// ── Stage 1: 병렬 — KT 변호인(TOS 제외) + Palantir 변호인 + TOS 분석 ──
 setLoadingMsg("ANALYZING...");
 const ktContent = userContent.length > 1 ? userContent : finalQuery;
 const signal = abortCtrl.signal;
 const [ktRes, palantirRes, tosRes] = await Promise.all([
  fetch("/api/chat", {
   method: "POST", headers: {"Content-Type": "application/json"}, signal,
   body: JSON.stringify({
    max_tokens: 2000,
    system: buildKTLawyerPrompt(effectiveMode, amendments, rawItems.length > 0, issueType, ["TOS"]),
    messages: [{role: "user", content: ktContent}]
   })
  }),
  fetch("/api/chat", {
   method: "POST", headers: {"Content-Type": "application/json"}, signal,
   body: JSON.stringify({
    max_tokens: 1200,
    messages: [{role: "user", content: buildPalantirLawyerPrompt(finalQuery, issueType)}]
   })
  }),
  fetch("/api/chat", {
   method: "POST", headers: {"Content-Type": "application/json"}, signal,
   body: JSON.stringify({
    max_tokens: 1000,
    messages: [{role: "user", content: buildTOSPrompt(finalQuery, issueType)}]
   })
  })
 ]);

 const safeParseJSON = (text, fallback={}) => {
  const j = text.indexOf('{'), je = text.lastIndexOf('}');
  if (j === -1 || je === -1) return fallback;
  try { return JSON.parse(text.slice(j, je+1)); } catch(e) { return fallback; }
 };

 let ktStrategy = { defense_summary:"", leverage_points:[], favorable_interpretations:[], procedural_defenses:[], preemptive_actions:[], relevant_clauses:[], kt_core_argument:"" };
 if (ktRes.ok) {
  const ktData = await ktRes.json();
  const ktText = (ktData.content || []).map(c => c.text || "").join("").trim();
  ktStrategy = { ...ktStrategy, ...safeParseJSON(ktText) };
 }

 let palantirCase = { strongest_arguments:[], clause_basis:[], kt_weaknesses:[], counter_strategy:"" };
 if (palantirRes.ok) {
  const palantirData = await palantirRes.json();
  const palantirText = (palantirData.content || []).map(c => c.text || "").join("").trim();
  palantirCase = { ...palantirCase, ...safeParseJSON(palantirText) };
 }

 let tosAnalysis = { has_risk: false, summary: "", triggered_clauses: [], kt_tos_defense: "" };
 if (tosRes.ok) {
  const tosData = await tosRes.json();
  const tosText = (tosData.content || []).map(c => c.text || "").join("").trim();
  tosAnalysis = { ...tosAnalysis, ...safeParseJSON(tosText) };
 }

 // ── Stage 2: 판사 심의 ────────────────────────────────────────────
 setLoadingMsg("DELIBERATING...");
 const judgeRes = await fetch("/api/chat", {
  method: "POST", headers: {"Content-Type": "application/json"}, signal,
  body: JSON.stringify({
   max_tokens: 4096,
   messages: [{role: "user", content: buildJudgePrompt(finalQuery, ktStrategy, palantirCase, effectiveMode, issueType, findSimilarCases(history, issueType, null))}]
  })
 });
 if (!judgeRes.ok) { const t = await judgeRes.text(); throw new Error("API " + judgeRes.status + ": " + t); }
 const judgeData = await judgeRes.json();
 if (judgeData.error) throw new Error(judgeData.error.message || JSON.stringify(judgeData.error));
 const text = (judgeData.content || []).map(c => c.text || "").join("").trim();
 if (!text) throw new Error("빈 응답");

 const _js = text.indexOf('{'), _je = text.lastIndexOf('}');
 if (_js === -1 || _je === -1) throw new Error('JSON 응답 없음');
 const jsonStr = text.slice(_js, _je+1);
 let parsed;
 try { parsed = JSON.parse(jsonStr); }
 catch(e) {
  let fixed = jsonStr;
  const opens = (fixed.match(/[{[]/g) || []).length;
  const closes = (fixed.match(/[}]]/g) || []).length;
  const diff = opens - closes;
  const lastObj = fixed.lastIndexOf('},');
  if (lastObj > 0) fixed = fixed.slice(0, lastObj+1);
  for (let i=0; i<diff; i++) fixed += (i===diff-1 ? '}' : ']');
  if (!fixed.includes('immediate_actions')) {
   fixed = fixed.replace(/}s*$/, ', "immediate_actions": []}');
  }
  try { parsed = JSON.parse(fixed); }
  catch(e2) { throw new Error('JSON 파싱 실패: ' + e.message); }
 }

 const toStr = (v, fallback='-') => {
  if (!v) return fallback;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.join('\n');
  return String(v);
 };
 const result = {
  situation_summary: toStr(parsed.situation_summary, query),
  risk_level: ['HIGH','MEDIUM','LOW'].includes((parsed.risk_level||'').toUpperCase()) ? parsed.risk_level.toUpperCase() : 'MEDIUM',
  risk_reason: toStr(parsed.risk_reason),
  legal_analysis: toStr(parsed.legal_analysis),
  kt_defense: toStr(parsed.kt_defense),
  palantir_position: toStr(parsed.palantir_position),
  bottom_line: toStr(parsed.bottom_line),
  related_conflicts: Array.isArray(parsed.related_conflicts)
   ? parsed.related_conflicts.map(rc => typeof rc === "string"
     ? { id: rc, relevance_level: "중", relevance_reason: "" }
     : rc)
   : [],
  triggered_clauses: Array.isArray(parsed.triggered_clauses) ? parsed.triggered_clauses : [],
  immediate_actions: Array.isArray(parsed.immediate_actions) ? parsed.immediate_actions : [],
  _issueType: issueType,
  _ktStrategy: ktStrategy,
  _palantirCase: palantirCase,
  _tosAnalysis: tosAnalysis,
 };


 const entry={id:Date.now(),query,result,mode:effectiveMode,_autoMode:mode==="auto",ts:new Date().toLocaleString("ko-KR")};
 const nh=[entry,...history];
 setHistory(nh); setActiveHistory(entry.id); await saveHistory(nh);
 } catch(e) {
 if (e.name === "AbortError") { /* 사용자 중단 — 에러 표시 안 함 */ }
 else setError("오류: "+e.message);
 } finally { setLoading(false); abortRef.current = null; }
 };

 const current = history.find(h=>h.id===activeHistory);

 if (!sessionReady) {
 return (
 <div style={{fontFamily:"system-ui,-apple-system,'Segoe UI',sans-serif",background:"#020617",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:"#f1f5f9",overflow:"hidden"}}>
  <div style={{width:"min(460px,92vw)",background:"#0f172a",border:"1px solid #334155",borderRadius:10,padding:"28px 24px",boxShadow:"0 16px 48px rgba(0,0,0,0.5)"}}>
   <div style={{fontSize:16,fontWeight:700,color:"#f1f5f9",letterSpacing:"0.03em",marginBottom:4}}>Contract Intelligence</div>
   <div style={{fontSize:11,color:"#64748b",marginBottom:24,letterSpacing:"0.04em"}}>KT × Palantir Korea</div>
   <div style={{fontSize:12,color:"#94a3b8",marginBottom:8}}>팀 코드를 입력하세요</div>
   <div style={{display:"flex",gap:8}}>
    <input
     value={sessionCode}
     onChange={e=>setSessionCode(e.target.value)}
     onKeyDown={e=>e.key==="Enter" && (sessionCode || "").trim() && handleSessionStart()}
     placeholder="예: KT-SPA팀"
     style={{flex:1,background:"#1e293b",border:"1px solid #334155",borderRadius:6,padding:"9px 12px",fontSize:12,color:"#f1f5f9",fontFamily:"inherit",outline:"none"}}
    />
    <button
     onClick={handleSessionStart}
     disabled={!(sessionCode || "").trim()}
     style={{padding:"9px 18px",background:(sessionCode || "").trim()?"#1d4ed8":"#1e293b",border:`1px solid ${(sessionCode || "").trim()?"#3b82f660":"#334155"}`,borderRadius:6,fontSize:12,fontWeight:600,fontFamily:"inherit",color:(sessionCode || "").trim()?"#93c5fd":"#64748b",cursor:(sessionCode || "").trim()?"pointer":"not-allowed",transition:"all 0.15s"}}
    >
     시작
    </button>
   </div>
   <div style={{fontSize:11,color:"#475569",marginTop:12,lineHeight:1.7}}>
    같은 코드를 입력하면 어느 PC에서도 동일한 데이터를 불러옵니다
   </div>
  </div>
 </div>
 );
 }

 return (
 <div style={{fontFamily:"system-ui,-apple-system,'Segoe UI',sans-serif",background:"#020617",height:"100vh",display:"flex",flexDirection:"column",color:"#f1f5f9",overflow:"hidden"}}>

 {/* ── 헤더 ── */}
 <div style={{background:"#0f172a",borderBottom:"1px solid #334155",padding:"0 20px",display:"flex",alignItems:"center",gap:16,height:50,flexShrink:0,boxShadow:"0 1px 8px rgba(0,0,0,0.4)"}}>
  {/* 로고 */}
  <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
   <div style={{width:26,height:26,borderRadius:6,background:"linear-gradient(135deg,#1d4ed8,#0ea5e9)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:"#fff",letterSpacing:"-0.04em"}}>CI</div>
   <div>
    <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.1em",color:"#cbd5e1"}}>CONTRACT INTELLIGENCE</div>
    <div style={{fontSize:11,color:"#475569",letterSpacing:"0.04em",marginTop:1}}>KT × Palantir Korea LLC</div>
   </div>
  </div>
  <div style={{width:1,height:24,background:"#334155",flexShrink:0}}/>
  {/* 탭 */}
  <div style={{display:"flex",gap:1}}>
   {[["analyze","이슈 분석"],["hurdle","Hurdle"],["timeline","변경 이력"],["history","히스토리"],["docs","문서 관리"]].map(([tab,label])=>(
    <button key={tab} onClick={()=>setAppTab(tab)}
     style={{padding:"6px 14px",borderRadius:4,border:"none",cursor:"pointer",
      fontSize:12,fontWeight:appTab===tab?600:400,fontFamily:"inherit",
      transition:"all 0.15s",position:"relative",
      background:appTab===tab?"#1e293b":"transparent",
      color:appTab===tab?"#e2e8f0":"#64748b",
      borderBottom:appTab===tab?"2px solid #60a5fa":"2px solid transparent"}}>
     {label}
     {tab==="history" && history.length>0 && (
      <span style={{position:"absolute",top:4,right:4,fontSize:7,background:"#3b82f6",
       color:"#fff",borderRadius:"50%",width:11,height:11,
       display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>
       {history.length > 9 ? "9+" : history.length}
      </span>
     )}
    </button>
   ))}
  </div>
  {/* 우측 배지 */}
  <div style={{display:"flex",gap:6,marginLeft:"auto",alignItems:"center"}}>
   <div style={{display:"flex",alignItems:"center",gap:6}}>
    <span style={{fontSize:10,color:"#94a3b8",background:"#1e293b",padding:"2px 8px",borderRadius:4,border:"1px solid #334155"}}>
     세션: {SESSION_ID || "-"}
    </span>
    <button onClick={handleSessionChange}
     style={{padding:"2px 8px",borderRadius:4,border:"1px solid #334155",background:"#1e293b",color:"#94a3b8",fontSize:10,cursor:"pointer",fontFamily:"inherit"}}>
     변경
    </button>
   </div>
   <div style={{width:1,height:18,background:"#334155"}}/>
   <span style={{fontSize:10,color:"#64748b"}}>KB</span>
   <span style={{fontSize:10,color:"#93c5fd",background:"#1e293b",padding:"2px 8px",borderRadius:4,border:"1px solid #3b82f630"}}>
    {kbSummary.clauses} 조항
   </span>
   <span style={{fontSize:10,color:kbSummary.conflicts>0?"#f87171":"#4ade80",
    background:kbSummary.conflicts>0?"#1c0808":"#081c0e",
    padding:"2px 8px",borderRadius:4,border:`1px solid ${kbSummary.conflicts>0?"#ef444430":"#22c55e30"}`}}>
    {kbSummary.conflicts} 충돌
   </span>
   {appTab==="analyze" && <>
    <div style={{width:1,height:18,background:"#334155"}}/>
    {translationSync.running && (
     <span style={{fontSize:10,color:"#4ade80",background:"#081c0e",padding:"2px 8px",borderRadius:4,border:"1px solid #22c55e30"}}>
      번역 동기화 {translationSync.done}/{translationSync.total}
     </span>
    )}
    <div style={{display:"flex",background:"#1e293b",borderRadius:5,padding:2,border:"1px solid #334155"}}>
     {[["auto","자동"],["basic","기본"],["extended","확장"]].map(([m,label])=>(
      <button key={m} onClick={()=>setMode(m)}
       title={m==="auto"?"이슈 내용을 분석해 자동으로 기본/확장 결정":m==="extended"?"내규·법령 포함 확장 분석":"계약 문서 기반 기본 분석"}
       style={{padding:"3px 10px",borderRadius:3,border:"none",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit",transition:"all 0.15s",
       background:mode===m?(m==="extended"?"#2d1060":m==="auto"?"#0d2d20":"#0f2d60"):"transparent",
       color:mode===m?(m==="extended"?"#c084fc":m==="auto"?"#34d399":"#60a5fa"):"#64748b"}}>{label}</button>
     ))}
    </div>
   </>}
  </div>
 </div>

 {/* ── 탭 콘텐츠 ── */}
 <div style={{flex:1,overflow:"hidden"}}>

  {appTab==="docs" && (
   <DocumentManagerTab
    onKBUpdated={handleKBUpdated}
    onOpenClause={setGlobalViewingClause}
    onAmendmentsFromUpload={(list) => {
     const merged = [...list, ...amendments.filter(a => !list.find(l=>l.id===a.id))];
     setAmendments(merged);
    }}
   />
  )}

  {appTab==="timeline" && <ClauseTimelineTab onOpenClause={setGlobalViewingClause}/>}
  {appTab==="hurdle" && <HurdleTracker/>}

  {appTab==="history" && (
   <HistoryTab
    history={history}
    onSelect={h=>{ setActiveHistory(h.id); setAppTab("analyze"); }}
    onDelete={deleteHistory}
    onUpdateMemo={updateMemo}
    onClear={clearHistory}
   />
  )}

  {/* ── 이슈 분석 탭 ── */}
  {appTab==="analyze" && (
   <div style={{display:"grid",gridTemplateColumns:"280px 1fr",height:"100%"}}>

    {/* 왼쪽 사이드바 */}
    <div style={{background:"#0f172a",borderRight:"1px solid #334155",display:"flex",flexDirection:"column",overflow:"hidden"}}>

     {/* 입력 영역 */}
     <div style={{padding:"14px 16px",borderBottom:"1px solid #334155"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:7}}>
       <div style={{fontSize:10,fontWeight:600,color:"#64748b",letterSpacing:"0.1em",textTransform:"uppercase"}}>Situation Input</div>
       <div style={{fontSize:9,color:"#475569"}}>템플릿 선택</div>
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:8}}>
       {ISSUE_TEMPLATES.map(t=>(
        <button key={t.label} onClick={()=>setInput(t.text)}
         title={t.label+" 템플릿으로 채우기"}
         style={{padding:"3px 9px",background:"#1e293b",border:"1px solid #334155",borderRadius:4,
          fontSize:10,color:"#94a3b8",fontFamily:"inherit",cursor:"pointer",display:"flex",gap:4,alignItems:"center",
          transition:"all .15s"}}
         onMouseEnter={e=>{e.currentTarget.style.background="#263148";e.currentTarget.style.borderColor="#3b82f660";e.currentTarget.style.color="#e2e8f0";}}
         onMouseLeave={e=>{e.currentTarget.style.background="#1e293b";e.currentTarget.style.borderColor="#334155";e.currentTarget.style.color="#94a3b8";}}>
         <span>{t.emoji}</span><span>{t.label}</span>
        </button>
       ))}
      </div>
      <textarea value={input} onChange={e=>setInput(e.target.value)}
       onKeyDown={e=>(e.metaKey||e.ctrlKey)&&e.key==="Enter"&&analyze()}
       placeholder={"계약 관련 상황을 자유롭게 입력하세요.\n\n예) Palantir이 우리 고객에게 직접 접근했다\n 서비스가 갑자기 정지됐다"}
       style={{width:"100%",background:"#1e293b",border:"1px solid #334155",borderRadius:6,padding:"10px 12px",
        fontSize:12,color:"#e2e8f0",fontFamily:"inherit",resize:"none",height:200,outline:"none",lineHeight:1.7,
        boxSizing:"border-box"}}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8}}>
       <span style={{fontSize:10,color:"#334155"}}>⌘+Enter</span>
       {rawDocCount>0 && <span style={{fontSize:10,fontWeight:600,color:"#4ade80",background:"#081c0e",border:"1px solid #22c55e30",borderRadius:4,padding:"1px 8px"}}>원문 {rawDocCount}건 첨부</span>}
       <button onClick={analyze} disabled={!input.trim()||loading}
        style={{padding:"7px 18px",background:input.trim()&&!loading?"#1d4ed8":"#1e293b",
         border:`1px solid ${input.trim()&&!loading?"#3b82f660":"#334155"}`,borderRadius:5,fontSize:12,
         fontWeight:600,fontFamily:"inherit",
         color:input.trim()&&!loading?"#93c5fd":"#475569",cursor:input.trim()&&!loading?"pointer":"default",
         transition:"all 0.15s"}}>
        분석
       </button>
      </div>
     </div>


     {/* 샘플 이슈 */}
     <div style={{padding:"10px 16px",borderBottom:"1px solid #334155"}}>
      <div style={{fontSize:10,fontWeight:600,color:"#64748b",letterSpacing:"0.1em",marginBottom:8,textTransform:"uppercase"}}>Sample Issues</div>
      {SAMPLE_ISSUES.map((s,i)=>(
       <button key={i} onClick={()=>setInput(s)}
        style={{textAlign:"left",background:"none",border:"1px solid #334155",borderRadius:5,padding:"6px 10px",
         marginBottom:4,fontSize:11,color:"#64748b",cursor:"pointer",fontFamily:"inherit",lineHeight:1.5,width:"100%",display:"block",
         transition:"all 0.1s"}}
        onMouseEnter={e=>{e.currentTarget.style.borderColor="#475569";e.currentTarget.style.color="#cbd5e1";}}
        onMouseLeave={e=>{e.currentTarget.style.borderColor="#334155";e.currentTarget.style.color="#64748b";}}>
        {s.length>42?s.slice(0,42)+"…":s}
       </button>
      ))}
     </div>

     {/* 히스토리 미니 목록 */}
     <div style={{flex:1,overflowY:"auto",padding:"10px 16px"}}>
      {history.length>0 && <>
       <div style={{fontSize:10,fontWeight:600,color:"#64748b",letterSpacing:"0.1em",marginBottom:8,textTransform:"uppercase"}}>History ({history.length})</div>
       {history.map(h=>{
        const rc=RISK_COLOR[h.result?.risk_level]||"#94a3b8";
        return (
         <div key={h.id} onClick={()=>setActiveHistory(h.id===activeHistory?null:h.id)}
          style={{padding:"9px 10px",borderRadius:6,border:`1px solid ${activeHistory===h.id?rc+"55":"#334155"}`,
           background:activeHistory===h.id?rc+"0c":"#1e293b",cursor:"pointer",marginBottom:5,transition:"all 0.1s"}}>
          <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:3}}>
           <div style={{width:5,height:5,borderRadius:"50%",background:rc,flexShrink:0}}/>
           <span style={{fontSize:10,color:rc,fontWeight:700}}>{h.result?.risk_level}</span>
           {h.memo && <span style={{fontSize:10,color:"#a78bfa"}}>●</span>}
           <span style={{fontSize:10,color:"#475569",marginLeft:"auto"}}>{h.ts}</span>
          </div>
          <div style={{fontSize:11,color:"#94a3b8",lineHeight:1.5}}>{h.query.length>38?h.query.slice(0,38)+"…":h.query}</div>
         </div>
        );
       })}
      </>}
     </div>
    </div>

    {/* 오른쪽 결과 영역 */}
    <div style={{overflowY:"auto",padding:24,background:"#020617"}}>
     {loading && (
      <div style={{background:"#0f172a",border:"1px solid #334155",borderRadius:10,padding:40,textAlign:"center"}}>
       <div style={{fontSize:13,color:loadingMsg==="DELIBERATING..."?"#a78bfa":"#64748b",letterSpacing:"0.1em"}}>{loadingMsg}</div>
       {loadingMsg==="DELIBERATING..." && <div style={{fontSize:11,color:"#7c3aed",marginTop:4}}>판사 심의 중...</div>}
       <div style={{display:"flex",justifyContent:"center",gap:6,marginTop:14}}>
        {[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:"50%",background:loadingMsg==="DELIBERATING..."?"#a78bfa":"#3b82f6",animation:"bounce 0.8s ease-in-out infinite",animationDelay:`${i*0.2}s`}}/>)}
       </div>
       <button onClick={cancelAnalysis}
        style={{marginTop:20,padding:"6px 20px",background:"transparent",border:"1px solid #475569",borderRadius:5,
         fontSize:11,color:"#64748b",fontFamily:"inherit",cursor:"pointer",letterSpacing:".04em"}}
        onMouseEnter={e=>{e.currentTarget.style.borderColor="#ef4444";e.currentTarget.style.color="#f87171";}}
        onMouseLeave={e=>{e.currentTarget.style.borderColor="#475569";e.currentTarget.style.color="#64748b";}}>
        ✕ 분석 중단
       </button>
      </div>
     )}
     {error && (
      <div style={{background:"#1c0808",border:"1px solid #ef444430",borderRadius:8,padding:"12px 16px",fontSize:12,color:"#f87171"}}>
       {error}
      </div>
     )}
     {current && !loading && (
      <div>
       <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
        <span style={{fontSize:10,color:"#475569",letterSpacing:"0.08em",textTransform:"uppercase"}}>이슈</span>
        <span style={{fontSize:12,color:"#94a3b8",background:"#0f172a",border:"1px solid #334155",borderRadius:5,padding:"3px 10px",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{current.query}</span>
        <span style={{fontSize:11,fontWeight:600,color:current.mode==="extended"?"#c084fc":"#60a5fa",background:current.mode==="extended"?"#1e106044":"#0f2d6044",border:`1px solid ${current.mode==="extended"?"#c084fc33":"#3b82f633"}`,borderRadius:4,padding:"3px 10px"}}>{current.mode==="extended"?"확장":"기본"}</span>
        {current._autoMode && <span style={{fontSize:9,color:"#34d399",marginLeft:2}}>자동감지</span>}
       </div>
       <ErrorBoundary><AnalysisResult result={current.result} query={current.query} mode={current.mode} amendments={amendments} onOpenClause={setGlobalViewingClause}/></ErrorBoundary>
      </div>
     )}
     {!current && !loading && (
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"70%",gap:16}}>
       <div style={{width:52,height:52,borderRadius:12,background:"#0f172a",border:"1px solid #334155",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,opacity:0.4}}>⚖</div>
       <div style={{fontSize:13,color:"#475569",textAlign:"center",lineHeight:2}}>
        상황을 입력하면 관련 조항, 법적 효과, 즉각 조치를 분석합니다<br/>
        <span style={{fontSize:11,color:"#334155"}}>KB 조항 {kbSummary.clauses}개 · 충돌 {kbSummary.conflicts}건</span>
       </div>
      </div>
     )}
    </div>
   </div>
  )}
 </div>
 {globalViewingClause && <ClauseDrawer clauseId={globalViewingClause} onClose={()=>setGlobalViewingClause(null)}/>}
 <style>{`@keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}} *{box-sizing:border-box} ::-webkit-scrollbar{width:5px;height:5px} ::-webkit-scrollbar-track{background:#020617} ::-webkit-scrollbar-thumb{background:#334155;border-radius:3px} ::-webkit-scrollbar-thumb:hover{background:#475569} ::selection{background:#1d4ed844;color:#93c5fd} textarea::placeholder{color:#475569} input::placeholder{color:#475569}`}</style>
 </div>
 );
}

// --- CLAUSE FULL TEXT DB ------------------------------------------------------
let CLAUSE_FULLTEXT = {
  "SAA-1.3.1": {
    "doc": "SAA",
    "section": "1.3.1",
    "title": "KT 독점 재판매권 (Target Market)",
    "text": "1.3.1      Notwithstanding anything to the contrary in Section 1.2, Palantir grants Partner the exclusive right in the Territory during the Term to resell and distribute Palantir Products to Target End Customers in the Target Market in the Territory, subject to the terms and conditions of this Agreement and timely payment in accordance with applicable order forms between the Parties (“Palantir Order Form(s)”). For the avoidance of doubt, the right granted under this Section shall not preclude any internal use of Palantir Products by Partner or its Affiliates, in accordance with the terms and conditions of this Agreement, subject to such use being in accordance with applicable Palantir Order Forms between the Parties.",
    "translation": "[조항 ID] 1.3.1\n[조항 제목] KT 독점 재판매권 (Target Market)\n[원문]\n1.3.1 제1.2조의 내용과 상반되더라도, Palantir는 기간 동안 영토 내에서 영토의 대상 시장에 속하는 대상 최종 고객에게 Palantir Products를 재판매 및 배포할 독점권을 파트너에게 부여하되, 본 계약의 조건 및 양 당사자 간에 적용 가능한 Palantir 주문서에 따라 제때 지급되는 것을 전제로 한다(“Palantir Order Form(s)”). 의심의 여지를 없애기 위하여, 본 조에 따라 부여된 권리는 파트너 또는 그 계열사가 본 계약의 조건에 따라 Palantir Products를 내부적으로 사용하는 것을 배제하지 않으며, 다만 그러한 사용이 양 당사자 간에 적용 가능한 Palantir Order Form(s)에 따라 이루어지는 경우에 한한다.",
    "context": "KT 독점권의 범위와 한계 — Target Market 내 고객에 대한 Palantir 직접영업 금지 근거"
  },
  "SAA-1.3.2": {
    "doc": "SAA",
    "section": "1.3.2",
    "title": "Palantir 직접 판매 금지",
    "text": "1.3.2      Palantir shall not during the Term independently sell Palantir Products by itself or form a business alliance in the Territory where Palantir grants a right to resell and distribute Palantir Products in the Target Market, without the prior consent of the Partner. Additionally, Palantir shall not, without the prior consent of the Partner, establish a new wholesale distributor or make any changes to the business structure in the Territory that would conflict with Partner’s rights granted under this Agreement.",
    "translation": "[조항 ID] 1.3.2\n[조항 제목] Palantir 직접 판매 금지\n1.3.2      Palantir는 기간 동안 파트너의 사전 동의 없이, Palantir가 대상 시장에서 Palantir Products의 재판매 및 유통에 대한 권리를 부여하는 영역에서 Palantir Products를 독립적으로 자체 판매하거나 비즈니스 제휴를 형성하지 않는다. 또한 Palantir는 파트너의 사전 동의 없이, 본 계약에 따라 파트너에게 부여된 권리와 충돌하는 영역 내에서 신규 도매 유통업체를 설립하거나 사업 구조를 변경하지 않는다.",
    "context": "Palantir의 직접영업 시 KT가 원용할 수 있는 핵심 조항 — 위반 시 material breach 주장 가능"
  },
  "SAA-1.6.8": {
    "doc": "SAA",
    "section": "1.6.8",
    "title": "Other Market Co-Sell 의무",
    "text": "1.6.8      Palantir agrees that, during the Term, with respect to any proposed sale of Palantir Products to Other Market Customers in the Territory by Palantir, it shall provide the Partner with a good faith opportunity to engage in co-selling activities related to such opportunity. With respect to any proposed sale of Palantir Products to Other Market Customers (including those not listed in Appendix 7) in the Territory by the Partner, Partner shall submit the proposal in the Palantir Partner Portal and Palantir shall review opportunity to engage in co-selling with the Partner for such opportunity, with the ultimate decision being at Palantir’s absolute discretion. For the avoidance of doubt, Partner is not permitted to actively market Palantir Products or Partner being a Palantir Premium",
    "translation": "1.6.8      타 시장 공동 판매 의무\nPalantir는 계약 기간 동안 Palantir가 영토 내의 타 시장 고객에게 Palantir Products를 판매하려는 제안된 판매와 관련하여, 해당 기회와 관련된 공동 판매 활동에 파트너가 참여할 수 있는 선의의 기회를 제공해야 한다. 영토 내에서 Partner가 타 시장 고객(부록 7에 기재되지 않은 고객 포함)에게 Palantir Products의 제안된 판매를 하는 경우, Partner는 Palantir 파트너 포털에 제안을 제출해야 하며 Palantir는 해당 기회에 대해 Partner와 공동 판매에 참여할 기회를 검토하고, 최종 결정은 Palantir의 절대적 재량에 따른다. 의심의 여지를 없애기 위하여, 파트너는 Palantir Products를 적극적으로 마케팅하는 행위를 해서는 안 되며, 파트너가 Palantir Premium인 경우도 허용되지 않는다.",
    "context": "Other Market(Appendix 7) 대상 영업 시 co-sell 절차 미준수 여부 판단 기준"
  },
  "SAA-2.10": {
    "doc": "SAA",
    "section": "2.10",
    "title": "EBT (Extraordinary Bilateral Transaction)",
    "text": "2.10 Extraordinary Bilateral Transactions Attributable to Hurdle. A transaction where Partner finds, cultivates, registers, and prepares for finalizing an opportunity with a Target End Customer pursuant to this Agreement but where (a) the Target End Customer communicates that it desires to contract directly with Palantir rather than Partner for purposes of executing the specific opportunity, and (b) Palantir and such Target End Customer finally enter into a contract for such specific opportunity resulting directly from Partner's efforts pursuant to this Agreement without Partner receiving revenue that would have been defined as Net Revenue attributable to a Qualified Sale Contract that Partner would have executed but for Palantir's contracting, can be treated as an \"Extraordinary Bilateral Transaction\". In such case, the Parties will meet to discuss and evaluate Partner's activities for such Extraordinary Bilateral Transaction and determine whether to reasonably find that Partner has made and/or will continue to make contribution to Palantir's obtaining revenue from such Extraordinary Bilateral Transaction and whether to consider all or a portion of Palantir's obtained revenue to be counted as Net Revenue.\n\n2.10.1 If the Parties mutually agree that all or a portion of Palantir's obtained revenue from the Extraordinary Bilateral Transaction should be counted as Net Revenue, then it shall be applied to calculation of the Hurdle, except where the Hurdle is exhausted in which case the parties will mutually agree whether the Partner will receive any Partner Compensation for the Extraordinary Bilateral Transaction; and\n\n2.10.2 On a quarterly basis, Palantir shall report to Partner the Net Revenue arising from such Extraordinary Bilateral Transactions, and the Net Revenue arising from such Extraordinary Bilateral Transactions shall be deducted from Partner's next payment arising under Order Form #2 (or provided to Partner as credit if Partner has finished all payments arising under Order Form #2).\n\n2.10.3 The Parties shall in good faith discuss procedures and criteria regarding how to evaluate Partner's contribution for prospective Extraordinary Bilateral Transactions and use their reasonable efforts to reach agreement for this purpose.",
    "translation": "[조항 ID] 2.10\n[조항 제목] 허들에 귀속되는 예외적 쌍방 거래(Extraordinary Bilateral Transaction)\n2.10 허들에 귀속되는 예외적 쌍방 거래. 본 계약에 따라 파트너가 타깃 최종고객과의 기회를 발굴, 육성, 등록하고 최종 계약 체결을 준비하였으나, (a) 해당 타깃 최종고객이 해당 특정 기회의 수행 목적상 파트너가 아니라 Palantir와 직접 계약하기를 원한다고 통지하고, (b) 그 결과 Palantir와 해당 타깃 최종고객이 본 계약에 따른 파트너의 노력으로 직접 발생한 해당 특정 기회에 관하여 최종 계약을 체결하되, 파트너가 Palantir의 직접 계약이 없었더라면 파트너가 체결했을 적격 재판매계약(Qualified Sale Contract)에 귀속되는 순매출(Net Revenue)로 보았을 수익을 수취하지 못하는 경우, 해당 거래는 \"예외적 쌍방 거래(Extraordinary Bilateral Transaction)\"로 취급될 수 있다. 이 경우 당사자들은 회합하여 해당 예외적 쌍방 거래에 관한 파트너의 활동을 논의하고 평가하며, 파트너가 Palantir의 해당 예외적 쌍방 거래 수익 획득에 기여했거나 계속 기여할 것인지 여부를 합리적으로 판단하고, Palantir가 획득한 수익의 전부 또는 일부를 순매출(Net Revenue)로 산입할지 여부를 결정한다.\n\n2.10.1 당사자들이 예외적 쌍방 거래에서 Palantir가 획득한 수익의 전부 또는 일부를 순매출(Net Revenue)로 산입하기로 상호 합의하는 경우, 해당 금액은 허들(Hurdle) 산정에 반영한다. 단, 허들이 이미 소진된 경우에는 파트너가 해당 예외적 쌍방 거래에 대해 파트너 보상(Partner Compensation)을 수령할지 여부를 당사자들이 상호 합의한다.\n\n2.10.2 Palantir는 분기별로 해당 예외적 쌍방 거래에서 발생한 순매출(Net Revenue)을 파트너에게 보고해야 하며, 그러한 순매출은 Order Form #2에 따라 발생하는 파트너의 차기 지급액에서 공제된다(또는 파트너가 Order Form #2에 따른 모든 지급을 이미 완료한 경우에는 파트너에게 크레딧으로 제공된다).\n\n2.10.3 당사자들은 장래의 예외적 쌍방 거래에 대한 파트너 기여도를 어떻게 평가할지에 관한 절차와 기준을 성실히(good faith) 협의하고, 이를 위한 합의에 도달하도록 합리적인 노력을 다한다.",
    "context": "EBT는 Target Market 내에서만 적용 — KT가 발굴했어도 Palantir 직접 계약이 성립된 경우의 처리 기준"
  },
  "SAA-2.11": {
    "doc": "SAA",
    "section": "2.11",
    "title": "Surviving QRC 배분 (계약 종료 후)",
    "text": "2.11       Surviving Qualified Resale Contracts. Upon termination of the Agreement or this Commercial Annex, the Hurdle will become inapplicable, and all Net Revenue arising from a Surviving Qualified Resale Contract will be allocated as follows: 10% to Partner and 90% to Palantir (via Upstream Payments), respectively.",
    "translation": "2.11 생존 QRC 배분(계약 종료 후). 계약 또는 본 상업 부속서의 종료 시, 허들은 적용되지 않으며, 생존하는 QRC 계약으로부터 발생하는 모든 순매출은 다음과 같이 배분됩니다: 파트너에게 10%, Palantir에게 90% (Upstream Payments를 통해), 각각.",
    "context": "해지 후 잔여 수익 배분 — 협상 여지 없이 10/90 고정 적용"
  },
  "SAA-6.2": {
    "doc": "SAA",
    "section": "6.2",
    "title": "계약 해지 (Material Breach)",
    "text": "Termination. This Agreement, and any Schedule entered into hereunder, may be terminated (a) upon mutual agreement; or (b) by either Party for material breach (including for the avoidance of doubt where Partner promotes Palantir Products outside the scope of this Agreement) by the other Party upon twenty (20) days’ written notice identifying the material breach unless the breach is cured within such notice period. For the avoidance of doubt, any valid termination of this Agreement shall also terminate any Schedule in effect at the time of such termination unless otherwise apparent on the terms set out in any such Schedule; however, any valid termination or expiration of a Schedule shall not in and of itself terminate this Agreement.",
    "translation": "해지. 본 계약 및 본 계약에 따라 체결된 모든 부속합의는 (a) 상호 합의에 의하여; 또는 (b) 상대 당사자의 중대한 위반으로 인해, 그 위반 사실을 식별하는 서면 통지를 20일의 기간 동안 상대 당사자에게 발송한 후 그 기간 내에 위반이 시정되지 않는 경우에 해지될 수 있다(단, 이 위반에는 파트너가 Palantir Products를 본 계약의 범위를 벗어나 홍보하는 경우를 포함한다). 의심의 여지를 없애기 위하여, 본 계약의 유효한 해지는 해지 시점에 그때까지 효력이 있는 모든 부속합의도 해지시키며, 다만 해당 부속합의의 조건에 달리 명시된 경우를 제외한다; 다만, 부속합의의 유효한 해지 또는 만료가 이루어지더라도 본 계약 자체가 자동으로 해지되지는 않는다.",
    "context": "20일 치유 기간 — TOS §8.4 즉시정지권과 충돌(XC-004). KT가 위반자일 경우 역적용 주의"
  },
  "SAA-6.3": {
    "doc": "SAA",
    "section": "6.3",
    "title": "해지 효과 및 잔여 처리",
    "text": "Effect of Termination. Upon termination of this Agreement, Partner’s right of access to Palantir’s software and related products shall automatically terminate, and each Party will (a) cease holding itself out as in any way affiliated or having any business relationship with the other Party; (b) discontinue all authorized publicity or use of any Approved Marketing Materials except as otherwise expressly agreed in writing by the Parties; and (c) return or destroy the other Party’s Confidential Information in its possession. Termination is not an exclusive remedy and all other remedies at law, in",
    "translation": "해지의 효과. 본 계약이 해지될 경우 Palantir의 소프트웨어 및 관련 제품에 대한 파트너의 접근 권한은 자동으로 종료되며, 각 당사자는 (a) 상대 당사자와 어떠한 형태로든 제휴하거나 사업 관계를 가진 것으로 더 이상 표기하지 않는다; (b) 당사자들이 서면으로 달리 명시적으로 합의한 경우를 제외하고는 모든 Authorized Publicity(허가된 홍보) 또는 Approved Marketing Materials의 사용을 중단한다; (c) 보유 중인 상대 당사자의 Confidential Information을 반환하거나 파기한다. 해지는 독점적 구제책이 아니며 모든 다른 구제책은 법률에 따른...",
    "context": "해지 후 OF4 잔여 Fee 처리 방식 — SAA(협상) vs OF4(ratable) 충돌(XC-005)"
  },
  "SAA-7.1": {
    "doc": "SAA",
    "section": "7.1",
    "title": "비밀유지",
    "text": "Confidentiality. Each Party (the “Receiving Party”) shall keep strictly confidential all Confidential Information of the other Party (the “Disclosing Party”), and shall not use such Confidential Information except for the purposes of this Agreement, and shall not disclose such Confidential Information to any third party other than disclosure on a need-to-know basis to the Receiving Party’s directors, employees, agents, attorneys, accountants, subcontractors, or other representatives who are each subject to obligations of confidentiality at least as restrictive as those herein (“Authorized Repr",
    "translation": "비밀유지. 각 당사자(이하 '수령당사자')는 상대 당사자(이하 '공개당사자')의 모든 기밀 정보를 엄격하게 기밀로 유지하고, 본 계약의 목적 이외의 용도로 그러한 기밀 정보를 사용하지 않으며, 필요에 따라 알아야 할 범위로 수령당사자의 이사들, 직원들, 대리인들, 변호사들, 회계사들, 하도급자들, 또는 본 계약에 따라 기밀 유지 의무가 본 계약에 규정된 의무들보다 적어도 더 엄격한 의무를 부담하는 기타 대표자들에게 공개하는 경우를 제외하고는 어떠한 제3자에게도 그러한 기밀 정보를 공개하지 아니한다(“Authorized Representatives”).",
    "context": "기밀유지 의무 위반 시 손해배상 및 injunction 청구 가능"
  },
  "SAA-8.1": {
    "doc": "SAA",
    "section": "8.1",
    "title": "상호 면책 (Indemnification)",
    "text": "Indemnification. Each Party shall indemnify, defend, and hold harmless the other Party against any costs, attorneys’ fees, and damages or settlement amount resulting from any third party claim asserted against the indemnified Party that arises in connection with this Agreement based on: (a) misrepresentations or fraudulent statements, false or misleading advertising, or breach of Section 5 this Agreement by the indemnifying Party regarding either Party’s products or services; (b) services provided to the third party by the indemnifying Party (including any professional services that may be pro",
    "translation": "[조항 ID] 8.1\n[조항 제목] 상호 면책 (Indemnification)\n면책. 각 당사자는 본 계약과 관련하여 제3자 청구로 인해 면책당하는 당사자에 제기된 비용, 변호사 수수료, 손해배상 또는 합의금에 대해 상대방 당사자를 보상하고 방어하며 면책한다. 이는 (a) 면책당하는 당사자가 어느 당사자의 제품 또는 서비스에 관하여 한 허위 진술 또는 사기성 진술, 거짓 또는 오해의 여지가 있는 광고, 또는 본 계약의 제5조 위반으로 인한 것; (b) 면책하는 당사자가 제3자에게 제공한 서비스(여기에 면책하는 당사가 제공할 수 있는 전문 서비스가 포함될 수 있음)로 인해 발생한 것 pro",
    "context": "IP 침해, 서비스 하자 관련 클레임 시 책임 귀속 판단 기준"
  },
  "SAA-8.2": {
    "doc": "SAA",
    "section": "8.2",
    "title": "Liability Cap (SAA)",
    "text": "Limitation of Liability. TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, NEITHER PARTY SHALL BE LIABLE TO THE OTHER, WHETHER BASED ON CONTRACT, TORT (INCLUDING NEGLIGENCE), OR ANY OTHER LEGAL OR EQUITABLE THEORY, FOR ANY (A) COST OF PROCUREMENT OF ANY SUBSTITUTE PRODUCTS OR SERVICES, (B) ECONOMIC LOSSES, EXPECTED OR LOST PROFITS, REVENUE, OR ANTICIPATED SAVINGS, LOSS OF BUSINESS, LOSS OF CONTRACTS, LOSS OF OR DAMAGE TO GOODWILL OR REPUTATION, AND/OR (C) INDIRECT, SPECIAL, INCIDENTAL, PUNITIVE, OR CONSEQUENTIAL LOSS OR DAMAGE, WHETHER ARISING OUT OF PERFORMANCE OR BREACH OF THIS AGREEMENT, E",
    "translation": "[조항 ID] 8.2\n[조항 제목] 책임 한도 (SAA)\n책임의 한도. 적용 가능한 법률이 허용하는 최대한의 범위 내에서, 당사자 어느 쪽도 상대방에 대하여 계약, 불법행위(과실 포함), 또는 기타 법적 또는 형평에 관한 이론에 기초하더라도, (A) 대체 상품 또는 서비스의 조달 비용, (B) 경제적 손실, 예상되었거나 손실된 이익, 수익, 또는 예상되는 절감, 사업의 손실, 계약의 손실, 신용도 또는 평판의 상실 또는 손상, 및/또는 (C) 간접적, 특수적, 우발적, 징벌적, 또는 결과적 손실 또는 손상, 본 계약의 이행 또는 위반으로 인해 발생하였는지 여부에 관계없이, E",
    "context": "분쟁 시 KT가 청구할 수 있는 최대 금액 — SAA($10M) vs TOS($100K) 어느 Cap이 적용되는지 선결 문제"
  },
  "SAA-9.0": {
    "doc": "SAA",
    "section": "9.0",
    "title": "준거법 및 중재 (SAA)",
    "text": "Any dispute, controversy, or claim arising from or relating to this Agreement, including arbitrability, that cannot be resolved following good faith discussions within sixty (60) days after notice of a dispute shall be finally settled by arbitration. If Partner is located in the Americas, then the governing law shall be the substantive laws of the State of New York, without regard to conflicts of law provisions thereof, and arbitration shall be administered in New York, New York, United States under the Comprehensive Arbitration Rules and Procedures of the Judicial Arbitration and Mediation Se",
    "translation": "[조항 ID] 9.0\n[조항 제목] 준거법 및 중재 (SAA)\n본 계약으로부터 발생하거나 본 계약과 관련된 모든 분쟁, 논쟁 또는 청구(중재 가능성을 포함), 분쟁에 대한 통지 후 60일 이내에 선의의 협의를 통해 해결되지 않는 경우에는 최종적으로 중재에 의해 해결된다. 파트너가 미주 지역에 위치하는 경우, 준거법은 뉴욕주 실체법으로 하고, 충돌법 조항은 적용하지 아니하며, 중재는 미국 뉴욕주 뉴욕시에서 Judicial Arbitration and Mediation Services의 Comprehensive Arbitration Rules and Procedures에 따라 관리된다.",
    "context": "어느 준거법이 적용되는지 먼저 확정해야 모든 법적 분석의 기초가 성립"
  },
  "SAA-2.2": {
    "doc": "SAA",
    "section": "Section 2.2 (Commercial Annex)",
    "title": "QRC 계약 조건 및 End Customer 책임",
    "text": "Partner will independently determine the pricing at which it offers Palantir Products to End Customers. Partner will be solely responsible for collecting all fees from End Customers and making payment to Palantir. Non-payment by End Customers will not relieve Partner of its obligation to pay fees to Palantir. Palantir reserves the right to terminate this Agreement if it fails to receive payment from Partner.",
    "translation": "[조항 ID] Section 2.2 (Commercial Annex)\n[조항 제목] QRC 계약 조건 및 End Customer 책임\n파트너는 최종 고객에게 Palantir 제품을 제공하는 가격을 독립적으로 결정합니다. 파트너는 최종 고객으로부터 모든 수수료를 수집하고 Palantir에 지급하는 데 단독으로 책임을 집니다. 최종 고객의 미지급은 파트너가 Palantir에 수수료를 지급해야 할 의무를 면제하지 않습니다. Palantir는 파트너로부터 대금을 받지 못하는 경우 본 계약을 해지할 권리를 보유합니다.",
    "kt_risk": "End Customer가 KT에 대금을 미지급해도 KT는 Palantir에 지급해야 함. KT가 End Customer 신용 위험을 전부 부담. 대손 리스크 관리 필수."
  },
  "SAA-2.8": {
    "doc": "SAA",
    "section": "Section 2.8 (Commercial Annex)",
    "title": "Upstream Payment 의무 및 환율 기준",
    "text": "Only in the case that aggregate Net Revenue is equal to or greater than the Hurdle, Partner shall forward to Palantir the full payment amount of the Net Revenue minus any applicable Partner Compensation (the Upstream Payment) within 30 days of Partner receiving an invoice. All USD conversions shall use the OANDA spot rate on the date of payment to Palantir. Partner shall be responsible for the payment of any and all taxes on payments received from an End Customer.",
    "translation": "[조항 ID] Section 2.8 (Commercial Annex)\n[조항 제목] Upstream Payment 의무 및 환율 기준\n[본문]\n집계된 Net Revenue가 허들(Hurdle)에 해당되거나 그 이상인 경우에 한하여, Partner는 Net Revenue에서 적용 가능한 Partner Compensation를 차감한 전체 지급 금액(Upstream Payment)을 Palantir에게 청구서를 수령한 날로부터 30일 이내에 송부해야 한다. 모든 USD 환산은 Palantir에 대한 지급일의 OANDA 현물환율을 사용한다. Partner는 End Customer로부터 받는 지급에 대한 모든 세금의 납부에 책임을 진다.",
    "kt_risk": "Hurdle 달성 후 End Customer 수금 30일 내 Upstream Payment 의무. 환율 변동(OANDA 기준)에 따른 환차손 KT 부담. 세금 공제 불가."
  },
  "SAA-2.9": {
    "doc": "SAA",
    "section": "Section 2.9 (Commercial Annex)",
    "title": "분기 보고 의무 및 감사 권한",
    "text": "By the first business day of every quarter, Partner shall submit a report of all Qualified Resale Contracts executed in such quarter and for which payments are ongoing. Partner will maintain complete, clear and accurate records of its transactions and performance under this Agreement. Upon 10 days advance written notice, Partner will permit Palantir or its representative to audit Partner records. Partner will maintain all records for at least 3 years following expiration or termination.",
    "translation": "[조항 ID] Section 2.9 (Commercial Annex)\n[조항 제목] 분기 보고 의무 및 감사 권한\n[원문]\n매 분기의 첫 영업일까지, 파트너는 해당 분기에 체결되었고 지급이 진행 중인 모든 적격 재판매 계약에 관한 보고서를 제출해야 한다. 파트너는 본 계약에 따라 거래 및 이행에 관한 완전하고 명확하며 정확한 기록을 유지할 것이다. 파트너는 10일의 사전 서면 통지에 따라 Palantir 또는 그 대리인이 파트너의 기록을 감사하는 것을 허용할 것이다. 파트너는 만료 또는 종료 후 최소 3년간 모든 기록을 보관할 것이다.",
    "kt_risk": "분기 보고 미제출 시 계약 위반. Palantir의 감사 요청 시 협조 의무. 3년치 거래 기록 보관 필수."
  },
  "SAA-10.4": {
    "doc": "SAA",
    "section": "10.4",
    "title": "독립 개발권",
    "text": "10.4 Right to Independently Develop. Subject to any obligations of confidentiality and to the Parties' respective intellectual property rights, in no event shall either Party be precluded or restricted from developing, using, marketing, or providing for itself or for others, materials that are competitive with the products and services of the other Party, irrespective of their similarity to any products or services offered by the other Party in connection with this Agreement, provided that the materials are independently developed without use of any Confidential Information of the other Party, by employees of the first Party who have had no access to any such Confidential Information. Each Party acknowledges that the other may already possess or have developed such materials independently. In addition, each Party shall be free to use its general knowledge, skills, experience, ideas, concepts, know-how, and techniques within the scope of its business that are used or developed in connection with the Agreement.",
    "translation": "[조항 ID] 10.4\n[조항 제목] 독립 개발권\n10.4 독립적으로 개발할 권리(Right to Independently Develop). 비밀유지에 관한 의무 및 당사자 각자의 지식재산권을 전제로 하는 한, 어느 당사자도 상대방의 제품 및 서비스와 경쟁되는 자료를 자신을 위하여 또는 타인을 위하여 개발, 사용, 마케팅 또는 제공하는 행위로부터 어떠한 경우에도 배제되거나 제한되지 아니한다. 이 원칙은 해당 자료가 본 계약과 관련하여 상대방이 제공하는 제품 또는 서비스와 유사한지 여부와 관계없이 동일하게 적용된다. 다만 이러한 자료는, 상대방의 어떠한 기밀정보도 사용하지 않고, 또한 그러한 기밀정보에 접근한 바 없는 제1당사자의 직원들에 의해 독립적으로 개발된 것이어야 한다. 각 당사자는 상대방이 이미 그러한 자료를 보유하고 있거나, 또는 독립적으로 개발해 왔거나 개발했을 수 있음을 인정한다. 또한 각 당사자는 본 계약과 관련하여 사용되거나 개발된 범위 내에서, 자신의 일반적 지식, 기술, 경험, 아이디어, 개념, 노하우 및 기법을 자유롭게 사용할 수 있다.",
    "context": "Palantir의 유사 솔루션 독립 개발 시 기밀 사용 여부가 핵심 쟁점"
  },
  "TOS-7": {
    "doc": "TOS",
    "section": "7",
    "title": "Fees, Payment, 연체이자",
    "text": "7. Fees and Payment; Taxes. The Service is deemed delivered upon the provision of access to Customer or for Customer’s benefit. If there are fixed fees set forth in an Order Form, such fees will be invoiced and payable on an upfront basis, or as otherwise set forth in the Order Form. Any usage-based fees set forth in an Order Form, including if payable in excess of any applicable included usage specified in an Order Form, will be calculated in accordance with the usage rates set forth in the Order Form (as applicable) and invoiced and payable quarterly in arrears, or as otherwise set forth in ",
    "translation": "[조항 ID] 7\n[조항 제목] 수수료 및 결제; 연체이자\n[원문]\n7. Fees and Payment; Taxes. 서비스는 고객에 대한 접속 권한의 제공 또는 고객의 이익을 위한 접속이 제공되는 시점에 인도된 것으로 간주된다. 주문서에 고정 수수료가 명시된 경우, 해당 수수료는 선지급 방식으로 청구 및 지급되거나 주문서에 달리 규정된 방식으로 지급된다. 주문서에 명시된 이용 기반 수수료가 있는 경우, 그리고 주문서에 명시된 포함 사용량을 초과하여 지급해야 하는 경우를 포함하여, 이 수수료는 주문서에 명시된 이용 요율에 따라 계산되고 (해당하는 경우) 분기별로 연체로 청구 및 지급되거나, 또는 주문서에 달리 규정된 바에 따라 처리된다.",
    "context": "대금 연체 시 적용 이율 — TOS 월 1.5% vs 하도급법 공정위 고시 이율"
  },
  "TOS-8.2": {
    "doc": "TOS",
    "section": "8.2",
    "title": "해지 (30일 치유 기간)",
    "text": "8.2 Termination for Cause. Without limiting either Party’s other rights, either Party may terminate this Agreement for cause (a) in the event of any material breach by the other Party of any provision of this Agreement and failure to remedy the breach (and provide reasonable written notice of such remedy to the non-breaching Party) within thirty (30) days following written notice of such breach from the non-breaching Party or (b) if the other Party seeks protection under any bankruptcy, receivership, or similar proceeding or such proceeding is instituted against that Party and not dismissed wi",
    "translation": "[조항 ID] 8.2\n[조항 제목] 해지 (30일 치유 기간)\n[원문] 사유에 의한 해지. 양 당사자의 다른 권리를 제한하지 않는 한, 어느 당사자든지 본 계약을 사유로 해지할 수 있다( (a) 상대 당사자가 본 계약의 어떠한 조항이라도 중대한 위반을 하고 그 위반을 시정하지 못하며(그리고 그러한 시정에 대한 합리적인 서면 통지서를 비위반 당사자에게 제공하는 것을 포함) 그러한 위반에 대하여 비위반 당사자가 서면으로 통지한 날로부터 삼십(30)일 이내에 시정하지 않는 경우, 또는 (b) 상대 당사자가 파산, 관리개시, 또는 유사한 절차의 보호를 구하거나 그러한 절차가 제기되고 기각되지 않는 경우)",
    "context": "치유 기간 20일(SAA) vs 30일(TOS) 충돌 — Order Form 우선 원칙상 SAA가 우선이나 분쟁 리스크 존재"
  },
  "TOS-8.4": {
    "doc": "TOS",
    "section": "8.4",
    "title": "서비스 즉시 정지권",
    "text": "8.4 Suspension of Service. If Palantir reasonably determines or suspects that: (a) Customer’s use of the Service violates applicable law (including but not limited to the Trade Compliance Requirements) or otherwise violates a material term of this Agreement (including but not limited to Section 3.2 (Data Protection), Section 4 (Acceptable Use), Section 5.3 (Restrictions), Section 6 (Confidentiality), Section 7 (Fees and Payment), and Section 11 (Customer Warranty)), or (b) Customer’s use of the Service poses a risk of material harm to Palantir or its other customers, Palantir reserves the right to disable or suspend Customer’s access to all or any part of the Palantir Technology, subject to Palantir providing Customer notice of such suspension concurrent or prior to such suspension.",
    "translation": "8.4 서비스 즉시 정지. 팔란티어가 합리적으로 판단하거나 의심하는 경우: (a) 고객의 서비스 이용이 적용 가능한 법률에 위반하거나(무역 준수 요건을 포함하되 이에 한정되지 않는 경우를 포함) 본 계약의 중요한 조항을 위반하거나(여기에 포함되며 예를 들면 제3.2조(데이터 보호), 제4조(허용 가능한 이용), 제5.3조(제한), 제6조(기밀 유지), 제7조(수수료 및 지급), 제11조(고객 보증) 등을 포함하되 이에 한정되지 않음) 또는 (b) 고객의 서비스 이용이 팔란티어 또는 그 외 고객들에게 중대한 피해를 입힐 위험을 초래하는 경우, 팔란티어는 고객의 팔란티어 테크놀로지에 대한 접근의 전부 또는 일부를 비활성화하거나 중지시킬 권리를 보유하며, 이러한 정지에 대해 팔란티어가 고객에게 그 정지의 통지를 동시 또는 사전에 제공하는 것을 조건으로 한다.",
    "context": "가장 위험한 조항 — Palantir이 일방적으로 즉시 정지할 수 있는 근거. KT 귀책 여부 사전 확인 필수"
  },
  "TOS-9.1": {
    "doc": "TOS",
    "section": "9.1",
    "title": "IP 침해 면책 (Palantir)",
    "text": "9.1 Palantir Indemnification. Palantir shall defend Customer against any claim of infringement or violation of any Intellectual Property Rights asserted against Customer by a third party based upon Customer’s use of Palantir Technology in accordance with the terms of this Agreement and indemnify and hold harmless Customer from and against reasonable costs, attorneys’ fees, and damages, if any, finally awarded against Customer pursuant to a non-appealable order by a tribunal of competent jurisdiction in such claim or settlement entered into by Palantir. If Customer’s use of any of the Palantir ",
    "translation": "[조항 ID] 9.1\n[조항 제목] IP 침해 면책 (Palantir)\n[원문]\n9.1 Palantir Indemnification. Palantir shall defend Customer against any claim of infringement or violation of any Intellectual Property Rights asserted against Customer by a third party based upon Customer’s use of Palantir Technology in accordance with the terms of this Agreement and indemnify and hold harmless Customer from and against reasonable costs, attorneys’ fees, and damages, if any, finally awarded against Customer pursuant to a non-appealable order by a tribunal of competent jurisdiction in such claim or settlement entered into by Palantir. If Customer’s use of any of the Palantir\n[번역문]\n9.1 Palantir 면책. Palantir는 본 계약의 조건에 따라 고객의 Palantir Technology 사용에 기초하여 제3자가 고객에 대해 제기한 지적 재산권 침해 또는 위반 주장으로부터 고객을 방어하고, 해당 주장에 따라 관할 구역의 재판소가 내린 항소 불가 명령에 의해 최종적으로 고객에게 배상될 합리적 비용, 변호사 수수료 및 손해배상(있을 경우)을 고객으로부터 면책하고 고객을 면책한다. Palantir가 체결한 합의로 인해 발생하는 경우를 포함하여. 만약 고객의 Palantir 기술 사용이",
    "context": "KT가 Palantir 기술 사용 중 제3자 IP 침해 클레임 받을 경우 Palantir에 방어 요청 가능"
  },
  "TOS-12": {
    "doc": "TOS",
    "section": "12",
    "title": "Liability Cap (TOS)",
    "text": "12. Limitations of Liability. TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, AND NOTWITHSTANDING ANY OTHER PROVISION OF THIS AGREEMENT, NEITHER PARTY SHALL BE LIABLE TO THE OTHER PARTY OR ITS AFFILIATES FOR ANY (A) COST OF PROCUREMENT OF ANY SUBSTITUTE PRODUCTS OR SERVICES (EXCEPT FOR PALANTIR’S OBLIGATIONS PURSUANT TO SECTION 9.1(a) HEREIN), OR COST OF REPLACEMENT OF ANY CUSTOMER DATA, (B) ECONOMIC LOSSES, EXPECTED OR LOST PROFITS, REVENUE, OR ANTICIPATED SAVINGS, LOSS OF BUSINESS, LOSS OF CONTRACTS, LOSS OF OR DAMAGE TO GOODWILL OR REPUTATION, AND/OR (C) INDIRECT, SPECIAL, INCIDENTAL, PU",
    "translation": "12. 책임의 한계. 적용 가능한 법률이 허용하는 최대 범위 내에서, 그리고 본 계약의 다른 어떤 조항에도 불구하고, 어느 당사자도 상대 당사자 또는 그 계열사에 대하여 (A) 대체 제품 또는 서비스의 조달 비용(단, 본 계약의 제9.1(a) 조에 따른 Palantir의 의무는 예외), 또는 고객 데이터의 교체 비용, (B) 경제적 손실, 기대되거나 손실된 이익, 매출, 또는 예상되는 절감, 사업 손실, 계약 손실, 영업권 또는 평판의 상실 또는 손상, 및/또는 (C) 간접적, 특별한, 우발적, 징벌적, 또는 결과적 손해에 대해 어떠한 책임도 지지 않는다.",
    "context": "TOS Cap $100K — SAA Cap $10M과 충돌. Order Form 우선 원칙상 SAA 적용이나 Palantir이 TOS 주장 가능"
  },
  "TOS-13": {
    "doc": "TOS",
    "section": "13",
    "title": "준거법 및 중재 (TOS)",
    "text": "13. Dispute Resolution. Any dispute, controversy, or claim arising from or relating to this Agreement, including arbitrability, that cannot be resolved following good faith discussions within sixty (60) days after notice of a dispute shall be finally settled by arbitration. If Customer is located in the Americas, then the governing law shall be the substantive laws of the State of New York, without regard to conflicts of law provisions thereof, and arbitration shall be administered in New York, New York, United States under the Comprehensive Arbitration Rules and Procedures of the Judicial Arb",
    "translation": "[조항 ID] 13\n[조항 제목] 준거법 및 중재 (TOS)\n[원문]\n13. 분쟁 해결. 본 계약으로부터 발생하거나 본 계약과 관련된 모든 분쟁, 논쟁 또는 청구를 포함하여, 중재 가능성을 포함한, 분쟁에 대한 통지 후 (60)일 이내에 선의의 논의를 통해 해결되지 않는 경우에는 최종적으로 중재에 의해 해결된다. 고객이 미주 지역에 위치한 경우, 준거법은 뉴욕 주의 실질법으로 하되, 그에 관한 충돌법 규정은 고려하지 아니하며, 중재는 미국 뉴욕주 뉴욕시에서 Comprehensive Arbitration Rules and Procedures of the Judicial Arb에 따라 관리된다.",
    "context": "TOS는 영국법/런던 중재 → SAA 한국법/서울 중재와 정면 충돌. 준거법 확정이 모든 분석의 선결 조건"
  },
  "OF3-FEES": {
    "doc": "OF3",
    "section": "Fees / Billing Details",
    "title": "Enablement Program $9M 및 지급 조건",
    "text": "Palantir Enablement Program for the Order Term. TOTAL: USD $9,000,000 (discounted from $12,000,000 under Order Form #2 partnership objectives). ORDER TERM: Effective Date to July 21, 2026. BILLING: Palantir shall invoice Customer on the date of signature of this Order Form #3. All payments via wire transfer within thirty (30) days after invoice issuance. Signed: KT - Woochul Byun (SVP), Palantir - Ryan Taylor, June 3 2025.",
    "translation": "[조항 ID] Fees / Billing Details\n[조항 제목] Enablement Program $9M 및 지급 조건\n[원문]\n팔란티르 Enablement Program은 주문 기간에 적용됩니다. 총액: 미화 9,000,000 달러(주문서 #2의 파트너십 목표에 따라 12,000,000 달러에서 할인). 주문 기간: 발효일로부터 2026년 7월 21일까지. 청구: 이 주문서 #3의 서명일에 고객에게 송장을 발행합니다. 모든 대금은 송장 발행일로부터 30일 이내에 전신 송금으로 지급됩니다. 서명: KT - Woochul Byun (SVP), Palantir - Ryan Taylor, 2025년 6월 3일.",
    "kt_risk": "서명과 동시에 인보이스 발행. 30일 내 미지급 시 TOS §7 연체이자(월 1.5%) 적용. 이행 기간 종료(2026.7.21) 후 미완료 시 분쟁 가능."
  },
  "OF3-T2": {
    "doc": "OF3",
    "section": "Terms §2",
    "title": "Non-Solicitation 4년 (Palantir Certified)",
    "text": "Palantir agrees not to solicit any Partner employees who have completed the three (3) phases of the Enablement Program in accordance with Appendix A for four (4) years from the Effective Date. For the avoidance of doubt, where Partner employees have completed the three (3) phases of the Enablement Program, such employees will be considered Palantir Certified.",
    "translation": "Palantir는 부록 A에 따라 Enablement Program의 세(3) 단계를 이수한 어떠한 파트너 직원도 발효일로부터 4년 동안 모집하지 않기로 합의한다. 의심의 여지를 없애기 위하여, 파트너 직원이 Enablement Program의 세(3) 단계를 이수한 경우, 그러한 직원은 Palantir 인증으로 간주된다.",
    "kt_risk": "보호 대상은 3단계 전부 수료자만. Phase 1·2만 완료한 직원은 미보호. 이직 권유 vs 자발적 지원 구분 필요. 위반 시 손해배상 청구 가능."
  },
  "OF3-PROG": {
    "doc": "OF3",
    "section": "Exhibit B",
    "title": "Enablement Program 구조 (3단계)",
    "text": "Phase 1 - Fundamental Training (2 months): classroom sessions, hands-on exercises, simulation projects. Phase 2 - Hands-On Experience (7 months): KT engineers embedded alongside Palantir teams for internal use cases and customer-facing engagements, progressive responsibility under Palantir guidance. Phase 3 - Autonomous Practice (3 months): KT teams operate independently, autonomous bootcamp delivery, pilot execution with Palantir in support role. Total 3 Palantir teams, 6 individuals (deployment strategists + FDEs). Two target groups: Internal teams (operations/governance) and Reseller teams (sales reps, implementation strategists, solution engineers).",
    "translation": "Phase 1 - 기본 교육 (2개월): 교실 수업, 실습 활동, 시뮬레이션 프로젝트.\nPhase 2 - Hands-On Experience (7개월): KT 엔지니어가 팔란티어 팀과 함께 내부 활용 사례 및 고객 대면 참여에 배치되며, 팔란티어의 지침 하에 점진적 책임을 수행한다.\nPhase 3 - Autonomous Practice (3개월): KT 팀이 독립적으로 운영되며, 자율 부트캠프를 제공하고 팔란티어의 지원 역할로 파일럿을 실행한다.\n총 3개의 팔란티어 팀, 6명(배포 전략가들 + FDE들).\n두 대상 그룹: 내부 팀(운영/거버넌스) 및 리셀러 팀(영업 담당자, 구현 전략가, 솔루션 엔지니어).",
    "kt_risk": "3단계 완료 기준이 Non-Solicitation 보호의 전제조건. 프로그램 미완료 시 KT 인력 보호 불가. 이행 기간 2026.7.21 종료 후 미완료 분쟁 가능성."
  },
  "OF4-FEES": {
    "doc": "OF4",
    "section": "Fees",
    "title": "Platform License 지급 (OF4)",
    "text": "Total USD $27,000,000 (discounted from $40M). Payment schedule: Execution $4M, Mar 2026 $5M, Mar 2027 $6M, Mar 2028 $6M, Mar 2029 $6M. For the avoidance of doubt, Customer shall have NO RIGHT TO TERMINATE this Order Form #4 for convenience. Upon SAA termination, remainder Fees are ratable based on total $27M.",
    "translation": "[조항 ID] Fees\n[조항 제목] Platform License 지급 (OF4)\n[원문]\n총 USD $27,000,000(4천만 달러에서 할인됨). 지급 일정: 체결 시 $4M, 2026년 3월 $5M, 2027년 3월 $6M, 2028년 3월 $6M, 2029년 3월 $6M. 오해의 소지를 방지하기 위하여, 고객은 본 주문서 #4를 편의상 해지할 권리가 없다. SAA 종료 시 잔여 수수료는 총 $27M를 기준으로 비례하여 산정된다.",
    "context": "편의해지 절대 불가 — 해지 논거 전개 전 반드시 확인. SAA 해지 시 잔여 Fee 자동 발생"
  },
  "OF4-CLOUD": {
    "doc": "OF4",
    "section": "Cloud",
    "title": "Azure Cloud 사용 및 초과요금",
    "text": "PoC Azure environment: Included Usage per year — Y1 $5M, Y2 $5M, Y3 $5M, Y4 $5M, Y5 $7M. Overage rates: Foundry Compute $0.00093/compute-second, Ontology $4.310/GB-month, Storage $0.028/GB-month. Upon migration to Palantir SPC Azure, usage rates and included usage no longer apply — parties will mutually agree cloud fees.",
    "translation": "[조항 ID] Cloud\n[조항 제목] Azure Cloud 사용 및 초과요금\n[원문]\nPoC Azure 환경: 연간 포함 사용량 — Y1 $5M, Y2 $5M, Y3 $5M, Y4 $5M, Y5 $7M. 초과 요금: Foundry Compute $0.00093/compute-second, Ontology $4.310/GB-month, Storage $0.028/GB-month. Palantir SPC Azure로의 마이그레이션 시, 사용 요금 및 포함 사용량은 더 이상 적용되지 않으며 — 당사자 간에 클라우드 요금을 상호 합의합니다.",
    "context": "Azure 초과 사용 시 추가 비용 발생 — 사용량 모니터링 필수. SPC 이전 전까지만 적용"
  },
  "REG-하도급-8조": {
    "doc": "하도급지침",
    "section": "제8조 (계약체결 시 준수사항)",
    "title": "하도급 계약 준수사항",
    "text": "계약체결에 있어 하도급대금과 그 지급방법 등 하도급계약의 내용을 계약서에 포함하며, 단가결정 지연 시 임시단가 적용 후 소급 정산한다. 단가 조정 요청 시 30일 이내 협의 의무.",
    "translation": "계약 체결 시 하도급대금·지급방법을 계약서에 명기. 단가 조정 요청 시 30일 이내 협의.",
    "kt_risk": "TOS §7 월 1.5% 이자율과 하도급법 기준 이율 충돌 시 내규 우선 적용 가능성."
  },
  "REG-하도급-8조⑦": {
    "doc": "하도급지침",
    "section": "제8조⑦ / 제10조④",
    "title": "계약 해지 최고 기간 (1개월)",
    "text": "최고가 필요한 경우 계약상대방에게 1개월 이상의 기간을 정하여 그 이행을 최고하고, 그 기간 내에 이행하지 아니한 때에 해제·해지할 수 있다. 계약 해제·해지 이유에 해당하지 않는 거래정지는 가급적 2~3개월 이전에 서면으로 통보한다.",
    "translation": "하도급법 적용 계약 해지 시 1개월 이상 최고 후 해지 가능. 일방적 거래정지는 2~3개월 전 서면 통보 권장.",
    "kt_risk": "SAA §6.2(20일), TOS §8.2(30일)보다 긴 1개월 최고 기간. 하도급법 적용 거래에서 우선 적용 가능(EC-002)."
  },
  "REG-정보보호-43조": {
    "doc": "정보보호지침",
    "section": "제43조 (보안성 승인)",
    "title": "신규 정보시스템 CISO 보안성 승인",
    "text": "신규 서비스 및 사업을 주관하거나 정보시스템의 구축 또는 변경을 하고자 하는 부서의 장은 반드시 CISO에게 보안성 승인을 요청하고, 검토 결과에 대한 보호조치를 취하여야 한다. CISO는 이행 미흡 시 서비스 중단을 요구할 수 있다.",
    "translation": "신규 정보시스템 구축·변경 전 CISO 보안성 승인 필수. 미이행 시 CISO가 서비스 중단 요구 가능.",
    "kt_risk": "Azure 클라우드 도입(OF4-CLOUD) 전 CISO 승인 없이 진행 시 내규 위반(EC-003). 분쟁 시 내부 감사 리스크 병존."
  },
  "REG-정보보호-44조": {
    "doc": "정보보호지침",
    "section": "제44조 (정보자산의 분류 및 통제)",
    "title": "가급 자산 외부 제공 사전승인",
    "text": "'가'급으로 분류된 정보자산(개인정보·회사재산권·신뢰성에 커다란 손상·전사 업무수행 영향·복구에 많은 예산 요구)은 부문정보보안관리자의 사전승인 없이는 외부로 유출 또는 공개할 수 없다.",
    "translation": "가급 정보자산은 부문정보보안관리자 사전승인 없이 외부 유출·공개 불가.",
    "kt_risk": "고객 데이터를 Azure(OF4-CLOUD)에서 처리 시 사전승인 의무(EC-004). 미이행 시 내부 징계 및 법적 책임."
  },
  "REG-계약-36조": {
    "doc": "계약규정",
    "section": "제36조 (계약서의 작성)",
    "title": "계약서 필수 기재사항",
    "text": "계약서에는 계약목적, 계약금액, 이행기간, 계약보증금, 위험부담, 지체상금, 기타 필요사항을 명기하여야 한다.",
    "translation": "계약목적·금액·이행기간·지체상금 등 필수 기재.",
    "kt_risk": "Palantir과의 계약에 KT 계약규정 필수 기재사항 누락 시 내부 감사에서 지적 가능."
  },
  "REG-계약-18조": {
    "doc": "계약규정",
    "section": "제18조 (수의계약 집행기준)",
    "title": "수의계약 집행기준",
    "text": "수의계약이 가능한 경우: 특허품·실용신안등록품 제조·구매, 특정인의 기술이 필요하거나 해당 물품 생산자가 1인뿐인 경우, 기타 경쟁입찰이 불가능하거나 현저히 부적절한 경우.",
    "translation": "특허품·단독 공급자·경쟁 불가 사유 시 수의계약 허용.",
    "kt_risk": "Palantir과의 수의계약 요건 충족 여부 확인 필요. 요건 미충족 시 계약 절차 위반으로 감사 지적 가능."
  },
  "REG-회계-30조": {
    "doc": "회계규정",
    "section": "제30조~제32조 (지출 원칙)",
    "title": "예산 범위 내 지출 원칙",
    "text": "제32조: 지출은 성립된 예산의 범위 내에서 하여야 한다. 다만, 사업의 특수성 및 긴급한 사정 등으로 본조의 규정에 의하지 못할 경우에는 재무실 예산주무부서의 장과 사전 협의한 후 집행할 수 있다.",
    "translation": "모든 지출은 성립된 예산 범위 내에서만 가능. 예산 초과 시 재무실 사전 협의 필수.",
    "kt_risk": "OF4 서명 즉시 $4M 지급 의무가 예산 편성 없이 발생한 경우 회계규정 위반(EC-005). 재무실 사전 협의 여부 확인 필요."
  },
  "LAW-하도급-13조": {
    "doc": "하도급법",
    "section": "하도급거래 공정화에 관한 법률 제13조",
    "title": "하도급대금 지급 의무",
    "text": "원사업자는 수급사업자에게 제조 등의 위탁을 한 경우 목적물 등의 수령일(건설위탁의 경우에는 인수일)부터 60일 이내의 기간으로 정한 지급기일까지 하도급대금을 지급하여야 한다. 원사업자가 발주자로부터 준공금을 받은 경우 그 날부터 15일 이내에 하도급대금을 지급하여야 한다. 원사업자가 정당한 사유 없이 지급기일 내에 하도급대금을 지급하지 아니한 경우 지연일수에 공정거래위원회가 고시하는 이율(현행 연 15.5%)을 곱한 금액을 지급하여야 한다.",
    "translation": "수령일로부터 60일 이내 하도급대금 지급. 준공금 수령 후 15일 이내 지급. 연체 시 공정위 고시 이율(연 15.5%) 적용.",
    "kt_risk": "TOS §7 월 1.5%(연 18%)보다 하도급법 고시 이율(연 15.5%)이 낮음. 하도급법 적용 거래 시 KT에 유리한 이율. 하도급법 적용 여부가 핵심 선결 쟁점(EC-001)."
  },
  "LAW-하도급-16조": {
    "doc": "하도급법",
    "section": "하도급거래 공정화에 관한 법률 제16조",
    "title": "부당한 계약해지 금지",
    "text": "원사업자는 수급사업자에게 책임을 돌릴 사유가 없는 데도 불구하고 계약을 해제·해지하여서는 아니 된다. 원사업자가 계약을 해제·해지할 경우 수급사업자에게 해제·해지 사유, 손해배상 내용 등을 서면으로 알려야 한다. 수급사업자에게 책임이 있는 경우에도 1개월 이상의 기간을 정하여 서면으로 최고하고 그 기간 내에 이행하지 아니한 때에 해제·해지할 수 있다.",
    "translation": "하도급법 적용 시 계약 해지는 1개월 서면 최고 후 가능. 귀책 없는 해지 금지.",
    "kt_risk": "Palantir이 SAA §6.2의 20일 기준으로 해지 통보 시, KT가 하도급법 제16조 1개월 최고 기간을 주장할 수 있음(EC-002). 하도급법 적용 여부가 방어 전략의 핵심."
  },
  "LAW-민법-544조": {
    "doc": "민법",
    "section": "민법 제544조 (이행지체와 해제)",
    "title": "계약 해지 및 최고 절차",
    "text": "당사자 일방이 그 채무를 이행하지 아니하는 때에는 상대방은 상당한 기간을 정하여 그 이행을 최고하고 그 기간 내에 이행하지 아니한 때에는 계약을 해제할 수 있다. 그러나 채무자가 미리 이행하지 아니할 의사를 표시한 경우에는 최고를 요하지 아니한다.",
    "translation": "채무불이행 시 상당 기간 최고 후 계약 해제 가능. 이행 거절 명시 시 최고 불필요.",
    "kt_risk": "SAA §6.2 20일 치유 기간과 민법 상당 기간 개념 중첩. 한국법 준거 시(SAA §9.0) 민법 적용. 치유 기간 충족 없이 해지 주장 시 위법 가능성."
  },
  "REG-협력사-4조": {
    "doc": "협력사선정지침",
    "section": "제4조 (협력사 선정기준)",
    "title": "협력사 등록 요건",
    "text": "협력사 선정기준: 신용평가등급 B- 이상, 품질인증(TL9000 또는 ISO9001), 재무건전성 요건 충족, 기술·인력·설비 요건 충족. 협력사 등록취소 기준: 부도·파산, 계약 중대 위반 등.",
    "translation": "신용등급 B- 이상 및 품질인증 보유 업체만 협력사 등록 가능.",
    "kt_risk": "Palantir Korea LLC의 협력사 등록 요건 충족 여부 확인 필요. 미등록 상태에서 계약 집행 시 내부 절차 위반."
  },
  "LAW-하도급-25조의3": {
    "doc": "하도급법",
    "section": "하도급거래 공정화에 관한 법률 제25조의3",
    "title": "하도급법 적용 범위 및 원사업자 정의",
    "text": "이 법은 원사업자가 수급사업자에게 제조·수리·건설·용역의 위탁을 하는 경우에 적용한다. 원사업자란 중소기업자가 아닌 사업자, 또는 중소기업자 중 직전 사업연도의 연간매출액이 수급사업자의 연간매출액보다 많은 사업자를 말한다. 소프트웨어 라이선스 공급 거래가 제조·용역 위탁에 해당하는지는 거래의 실질에 따라 판단.",
    "translation": "하도급법은 원사업자→수급사업자 위탁 거래에 적용. KT-Palantir 거래에서 어느 쪽이 원사업자인지에 따라 적용 여부 결정.",
    "kt_risk": "KT가 Palantir에 대금 지급 시 KT가 원사업자이면 하도급법 적용 가능. 반대의 경우 적용 불가. 소프트웨어 라이선스가 용역 위탁에 해당하는지 법무 검토 필요."
  },
  "LAW-공정거래-45조": {
    "doc": "공정거래법",
    "section": "독점규제 및 공정거래에 관한 법률 제45조",
    "title": "불공정거래행위 금지",
    "text": "사업자는 불공정한 거래방법으로 경쟁을 저해하거나 상대방의 불이익을 초래하는 행위를 하여서는 아니 된다. 거래상 지위의 남용, 부당한 계약조건 강요, 불이익 제공이 포함된다. 소프트웨어 독점 공급 계약에서 일방적 서비스 정지권(TOS §8.4)이 불공정거래행위에 해당하는지 검토 가능.",
    "translation": "불공정한 거래 방법으로 경쟁 저해·상대방 불이익 초래 금지. TOS §8.4 즉시 정지권의 불공정거래행위 해당 여부 검토 가능.",
    "kt_risk": "Palantir의 TOS §8.4 일방적 즉시 정지권이 거래상 지위 남용에 해당할 수 있음. 공정위 신고 또는 불공정거래행위 주장 가능성. 다만 입증 부담은 KT에 있음."
  },
  "XC-001": {
    "doc": "충돌",
    "section": "SAA §6.2 vs TOS §8.2",
    "title": "치유 기간 충돌 (20일 vs 30일)",
    "text": "SAA §6.2: material breach 통보 후 20일 이내 치유 없으면 해지 가능.\nTOS §8.2: material breach 통보 후 30일 이내 치유 없으면 해지 가능.\n\n문서 우선순위(Order Form > SAA > TOS)상 SAA 20일이 원칙. 그러나 TOS §8.4 즉시 정지권이 치유 기간을 무력화할 수 있어 실질 치유 기간이 0일이 될 수 있음.",
    "translation": "해지 통보 후 치유 기간: SAA 20일 vs TOS 30일. 원칙상 SAA 우선이나 TOS §8.4로 우회 가능.",
    "kt_risk": "Palantir이 TOS §8.4 즉시 정지 시 KT는 치유 기회 없이 서비스 중단. SAA 20일 치유 기간 주장의 실효성 문제."
  },
  "XC-002": {
    "doc": "충돌",
    "section": "SAA §8.2 vs TOS §12",
    "title": "Liability Cap 충돌 ($10M vs $100K)",
    "text": "SAA §8.2: 최대 책임 한도 = max(직전 12개월 Partner Compensation, USD $10,000,000).\nTOS §12: 최대 책임 한도 = max(직전 12개월 지급 비용, USD $100,000).\n\nTOS Cap($100K)은 SAA Cap($10M)의 1/100 수준. SAA 우선 적용 원칙이나 Palantir이 TOS를 주장하면 KT 손해배상 수령 한도가 100배 줄어듦.",
    "translation": "손해배상 한도: SAA $10M vs TOS $100K. SAA 우선이나 Palantir의 TOS 주장 시 배상 1/100로 축소.",
    "kt_risk": "분쟁 시 Palantir이 TOS §12 적용 주장 시 KT 실질 손해배상 대폭 축소. SAA Cap 적용 명시 필요."
  },
  "XC-003": {
    "doc": "충돌",
    "section": "SAA §9.0 vs TOS §13",
    "title": "준거법·중재지 충돌 (한국법/서울 vs 영국법/런던)",
    "text": "SAA §9.0: KT(미주 외 소재)에 대해 한국법 적용, 서울 ICC 중재.\nTOS §13: 영국법 적용, 런던 ICC 중재.\n\nSAA 우선 원칙상 한국법/서울 ICC가 맞으나 Palantir이 TOS 근거로 영국법/런던 중재 주장 시 분쟁. 런던 중재 시 KT 비용·시간 부담 급증.",
    "translation": "준거법·중재지: SAA 한국법/서울 ICC vs TOS 영국법/런던 ICC. SAA 우선이나 분쟁 시 혼란 가능.",
    "kt_risk": "분쟁 시 준거법 확정 자체가 선결 쟁점. 런던 중재 주장 시 KT 비용 증가 및 한국법 보호 미적용 리스크."
  },
  "XC-004": {
    "doc": "충돌",
    "section": "TOS §8.4 vs SAA §6.2",
    "title": "서비스 즉시 정지권 (치유 기간 우회)",
    "text": "TOS §8.4: Palantir이 합리적으로 판단·의심할 경우 사전 통보와 동시에 또는 이전에 서비스 즉시 정지 가능. 트리거: 계약 위반 의심, 법령 위반, Palantir 또는 타 고객에 대한 중대한 위험.\nSAA §6.2: material breach 시 20일 서면 통보 후 치유 기간 보장.\n\n핵심 충돌: TOS §8.4는 의심만으로 즉시 정지 가능하여 SAA §6.2의 20일 치유 기간을 완전히 무력화.",
    "translation": "Palantir의 즉시 정지권(TOS §8.4)이 SAA의 20일 치유 기간(§6.2)을 우회. 가장 위험한 충돌.",
    "kt_risk": "대금 미지급·보안 이슈·계약 위반 의심 시 치유 기회 없이 서비스 즉시 중단. 합리적 의심이라는 낮은 기준 적용."
  },
  "XC-005": {
    "doc": "충돌",
    "section": "SAA §6.3 vs OF4 Billing",
    "title": "해지 후 잔여 Fee 처리 충돌",
    "text": "SAA §6.3: Hurdle 미달성 해지 시 잔여 수익 배분은 good faith 협상.\nOF4 Billing: SAA 해지 시 OF4 잔여 Fee는 ratable 기준(비례 계산)으로 처리.\n\n충돌 포인트: 협상(SAA)과 고정 ratable(OF4) 중 어느 기준이 적용되는지. OF4는 Order Form으로 SAA보다 우선 적용 원칙.",
    "translation": "해지 후 잔여 Fee: SAA는 협상, OF4는 ratable 고정. Order Form 우선 원칙상 OF4 기준 적용 가능성 높음.",
    "kt_risk": "해지 시 KT가 협상 주장해도 Palantir이 OF4 ratable 기준 주장 가능. 편의해지 불가 조항과 결합 시 KT 레버리지 급감."
  },
  "IC-001": {
    "doc": "충돌",
    "section": "SAA §1.3.2 vs SAA §2.10",
    "title": "독점 판매 금지 vs EBT 협의 권한",
    "text": "SAA §1.3.2: Palantir은 KT 동의 없이 Target Market에 직접 판매 금지.\nSAA §2.10(EBT): KT가 발굴했으나 고객이 Palantir 직접 계약을 원하는 경우, 양사 협의로 Palantir 수익을 Hurdle에 산입 가능.\n\n충돌 포인트: Palantir의 직접 접촉이 §1.3.2 위반인지 §2.10 EBT 절차의 일부인지 구분 필요. EBT는 KT의 사전 발굴·등록이 전제조건.",
    "translation": "Palantir 직접 판매 금지(§1.3.2)와 EBT 예외(§2.10)의 경계. KT 사전 등록 여부가 핵심 판단 기준.",
    "kt_risk": "Palantir이 KT 미등록 고객에 접촉 후 EBT를 주장하면 §1.3.2 위반. KT의 Opportunity Registration 선행 여부 반드시 확인."
  },
  "IC-002": {
    "doc": "충돌",
    "section": "SAA §6.3 vs SAA §2.11",
    "title": "Surviving QRC 배분 방식 충돌",
    "text": "SAA §6.3(Effect of Termination): 해지 후 Surviving QRC 수익 배분은 good faith 협상.\nSAA §2.11(Commercial Annex): 해지 후 Surviving QRC 수익 = KT 10% / Palantir 90% 고정.\n\n충돌 포인트: §6.3(협상)과 §2.11(고정) 중 어느 조항 우선인가. Commercial Annex(Schedule A)는 SAA 본문보다 우선 적용됨.",
    "translation": "해지 후 수익 배분: SAA 본문은 협상, Commercial Annex는 KT 10%/Palantir 90% 고정. Annex 우선 적용.",
    "kt_risk": "Hurdle 미달성 해지 시 KT 수익이 10%로 고정될 가능성 높음. 협상 가능성이 매우 제한됨."
  },
  "EC-001": {
    "doc": "충돌",
    "section": "TOS §7 vs 하도급지침",
    "title": "연체이자율 충돌 (월 1.5% vs 하도급법 고시 이율)",
    "text": "TOS §7: 연체 시 월 1.5%(연 18%) 또는 법적 최고 이율 중 낮은 쪽.\n하도급지침 제8조: 하도급대금 지급 지연 시 공정위 고시 이율 적용(현재 연 15.5% 수준).\n\n충돌 포인트: TOS 월 1.5%(연 18%)는 하도급법 고시 이율(연 15.5%)보다 높음. 하도급법 적용 거래라면 하도급법이 강행규정으로 우선.",
    "translation": "연체이자: TOS 월 1.5%(연 18%) vs 하도급법 고시 이율(연 15.5%). 하도급법 적용 시 법령 우선.",
    "kt_risk": "하도급법 적용 여부에 따라 이율 결정. KT가 하도급법 적용을 주장하면 TOS보다 낮은 이율 적용 가능."
  },
  "EC-002": {
    "doc": "충돌",
    "section": "하도급지침 제8조7 vs SAA §6.2 vs TOS §8.2",
    "title": "해지 최고 기간 3중 충돌",
    "text": "하도급지침 제8조7: 1개월 이상 최고 후 해지.\nSAA §6.2: 20일 서면 통보 후 해지.\nTOS §8.2: 30일 서면 통보 후 해지.\n\n하도급법 적용 거래라면 1개월 기준이 강행규정으로 우선. KT-Palantir 관계에서 하도급법 적용 여부(원사업자/수급사업자 해당 여부)가 핵심 선결 쟁점.",
    "translation": "해지 최고 기간: 하도급지침 1개월 vs SAA 20일 vs TOS 30일. 하도급법 적용 시 1개월 강행.",
    "kt_risk": "Palantir이 SAA 20일 기준 해지 통보 시 KT가 하도급법 1개월 기준 주장 가능. 하도급법 적용 여부 법무 검토 필요."
  },
  "EC-003": {
    "doc": "충돌",
    "section": "정보보호지침 제43조 vs OF4",
    "title": "CISO 보안성 승인 vs OF4 즉시 사용",
    "text": "정보보호지침 제43조: 신규 정보시스템 구축·변경 전 CISO 보안성 승인 필수.\nOF4 Cloud: 계약 즉시 PoC Azure 환경 사용 가능, 2025년 3월부터 과금 시작.\n\n충돌 포인트: OF4 서명 즉시 Azure 사용 의무 발생하나 내규상 CISO 승인이 선행되어야 함. 승인 전 사용 시 내규 위반 상태 발생.",
    "translation": "CISO 승인 전 Azure 사용 불가(내규) vs 계약 즉시 사용 개시(OF4). 내규 위반 상태에서 계약 이행 중일 가능성.",
    "kt_risk": "CISO 승인 미취득 상태에서 Azure 사용 중이면 내부 감사 지적 및 정보보호법 위반 가능. 소급 승인 취득 여부 확인 필요."
  },
  "EC-004": {
    "doc": "충돌",
    "section": "정보보호지침 제44조 vs TOS §3",
    "title": "가급 자산 외부 제공 vs TOS 데이터 처리 허용",
    "text": "정보보호지침 제44조: 가급 정보자산은 부문정보보안관리자 사전승인 없이 외부 유출·공개 불가.\nTOS §3: KT는 Palantir 플랫폼에 데이터 업로드·처리 가능. Palantir은 서비스 제공 목적으로만 사용.\n\n충돌 포인트: KT 내부 데이터(특히 가급 자산)를 Palantir 플랫폼에 업로드할 때 내규상 사전승인 절차 이행 여부.",
    "translation": "가급 자산 외부 제공 사전승인(내규) vs TOS의 데이터 업로드·처리 허용. 내규 절차 준수 여부가 핵심.",
    "kt_risk": "사전승인 없이 고객 데이터·핵심 자산을 Azure에 업로드 시 내규 위반. 데이터 침해 시 KT 책임 가중."
  },
  "EC-005": {
    "doc": "충돌",
    "section": "회계규정 제32조 vs OF4 Billing",
    "title": "예산 범위 내 지출 원칙 vs OF4 즉시 $4M 지급",
    "text": "회계규정 제32조: 지출은 성립된 예산의 범위 내에서만 가능. 예외 시 재무실 예산주무부서 장과 사전 협의 필수.\nOF4: 서명 즉시(Upon execution) USD $4,000,000 지급 의무 발생.\n\n충돌 포인트: 2025년 3월 계약 서명 시 $4M 예산이 사전 편성되어 있었는지, 재무실 사전 협의가 이루어졌는지 여부.",
    "translation": "예산 범위 내 지출 원칙(내규) vs 서명 즉시 $4M 지급 의무(OF4). 사전 예산 편성·재무실 협의 여부가 핵심.",
    "kt_risk": "예산 미편성 상태에서 $4M 집행 시 회계규정 위반. 내부 감사 지적 가능. 재무실 사전 협의 문서 확보 필요."
  }
};

// --- KNOWLEDGE BASE -----------------------------------------------------------
const KB_VERSION = "2026-03-17-kb-v1";
let CONTRACT_KB = {
 clauses: [
 { id:"SAA-1.1", doc:"SAA", topic:"계약 목적", core:"Palantir이 KT를 'Palantir Strategic Alliance Partner'로 임명하여 제품/서비스 공동 프로모션 및 GTM 협력", text:"This Agreement sets forth the terms and conditions upon which Palantir appoints Partner as a 'Palantir Strategic Alliance Partner' in order to collaborate on promotion and go-to-market efforts of the Parties' respective products and/or services.", translation:"이 계약은 Palantir이 KT를 'Palantir 전략적 제휴 파트너'로 임명하고, 양사 제품 및 서비스의 홍보와 시장 진출 협력에 관한 조건을 규정한다.", kt_risk:"계약 목적상 KT는 독립 사업자로서 행동해야 하며, Palantir의 대리인이나 대표자로 행동할 권한이 없음.", section:"Section 1.1 (Purpose)", title:"계약 목적" },
 { id:"SAA-1.2", doc:"SAA", topic:"비독점 원칙", core:"양사 관계는 비독점. 단 §1.3 Target Market 독점 조항은 예외. 발효일 기준 한국에 Palantir의 Target Market 재판매 파트너 없음 확인", text:"The Parties agree that the strategic alliance relationship created by this Agreement is non-exclusive. As of the Effective Date, Palantir confirms that there is no business alliance partner in Korea with which Palantir has a contractual relationship who possesses rights to resell and distribute Palantir Products in the Target Market in the Territory.", translation:"전략적 제휴 관계는 비독점이나, §1.3의 Target Market 독점권은 예외. 발효일 기준 Palantir은 한국 내 Target Market 재판매 권리를 가진 다른 파트너가 없음을 확인한다.", kt_risk:"비독점 원칙으로 Palantir은 Target Market 외에서는 자유롭게 다른 파트너와 협력 가능. §1.3 독점권 범위 엄격 준수 필요.", section:"Section 1.2 (Non-Exclusivity)", title:"비독점 원칙" },
 { id:"SAA-1.3.1", doc:"SAA", topic:"독점권 (Target Market)", core:"KT는 Territory(한국) 내 Target Market에서 Palantir Products를 Target End Customer에게 독점 재판매·배포 권리 보유", text:"Palantir grants Partner the exclusive right in the Territory during the Term to resell and distribute Palantir Products to Target End Customers in the Target Market in the Territory, subject to the terms and conditions of this Agreement and timely payment in accordance with applicable order forms.", translation:"Palantir은 계약 기간 중 KT에게 Territory(한국) 내 Target Market의 Target End Customer에 대한 독점적 재판매·배포 권리를 부여한다. 단 계약 조건 준수 및 적시 지급이 전제조건.", kt_risk:"독점권은 Target Market(금융·보험) 및 Territory(한국)에 한정. 범위 외 영업 시 독점권 주장 불가. 적시 지급 미이행 시 독점권 상실 위험.", section:"Section 1.3.1", title:"Target Market 독점 재판매권" },
 { id:"SAA-1.3.2", doc:"SAA", topic:"Palantir 직접 판매 금지", core:"Palantir은 KT 사전 동의 없이 Territory 내 Target Market에 직접 판매하거나 재판매 권한 부여 제휴 불가", text:"Palantir shall not during the Term independently sell Palantir Products by itself or form a business alliance in the Territory where Palantir grants a right to resell and distribute Palantir Products in the Target Market, without the prior consent of the Partner. Additionally, Palantir shall not, without the prior consent of the Partner, establish a new wholesale distributor or make any changes to the business structure in the Territory that would conflict with Partner's rights.", translation:"Palantir은 계약 기간 중 KT 사전 동의 없이 Territory 내 Target Market에서 단독으로 판매하거나, 재판매 권한을 부여하는 비즈니스 제휴를 체결할 수 없다. 또한 KT의 권리와 충돌하는 신규 도매 유통업체 설립이나 사업 구조 변경도 불가.", kt_risk:"Palantir이 무단으로 직접 영업 시 즉각적인 §1.3.1 위반. 위반 발생 시 서면 통보 및 20일 치유 기간 요구 가능.", section:"Section 1.3.2", title:"Palantir 직접 판매 금지" },
 { id:"SAA-1.4", doc:"SAA", topic:"Palantir Premium Partner 지위", core:"KT는 발효일부터 Palantir Worldwide Partner Ecosystem의 'Palantir Premium Partner' 자격 보유. Target Market 및 합의된 Other Market에서 Premium Partner로 홍보 가능", text:"From the Effective Date, Partner shall be considered a member of Palantir's Worldwide Partner Ecosystem. As a Palantir Premium Partner, Partner will have the right to promote Partner as a Palantir Premium Partner to (a) Target End Customers within the Target Market; and (b) Other Market Customers to be mutually agreed in writing.", translation:"발효일부터 KT는 Palantir의 글로벌 파트너 생태계에서 'Palantir Premium Partner' 자격을 보유하며, Target Market 내 고객 및 서면으로 합의된 Other Market 고객에게 Premium Partner로 홍보할 수 있다.", kt_risk:"Premium Partner 지위는 Palantir 마케팅 가이드라인 준수 전제. 가이드라인 위반 시 지위 박탈 위험.", section:"Section 1.4", title:"Palantir Premium Partner 지위" },
 { id:"SAA-1.5", doc:"SAA", topic:"공동 제안 (Joint GTM)", core:"양사는 공동 제안서 작성 및 고객 영업 협력 가능. 어느 Party도 상대방 제품에 대해 사전 서면 승인 없이 가격 견적·보증·확약 불가", text:"The Parties may collaborate on joint proposals. Neither Party shall provide a prospective customer with any price quotes, Confidential Information, representations, warranties, or other commitments on behalf of the other Party without the prior written approval of the other Party, or agree to joint and several liability.", translation:"양사는 공동 제안서를 통해 제품·서비스를 묶어 고객에게 제안할 수 있다. 단 어느 Party도 상대방의 사전 서면 승인 없이 상대방을 위한 가격 견적, 기밀 정보 공유, 진술, 보증, 확약을 할 수 없으며, 연대 책임에도 동의할 수 없다.", kt_risk:"KT가 Palantir 제품에 대해 무단으로 가격 제시 시 계약 위반. 고객과의 연대 책임 동의 금지.", section:"Section 1.5 (Joint Proposals)", title:"공동 제안 및 GTM" },
 { id:"SAA-1.6.1", doc:"SAA", topic:"Co-Sell (Other Market 10개사)", core:"양사는 Appendix 7의 Other Market 고객에 대해 공동 Co-Sell 협력", text:"The parties agree to collaborate on Proposals and to jointly co-sell Palantir Products to a selection of ten (10) Other Market Customers as set out in Appendix 7 to this Agreement.", translation:"양사는 Appendix 7에 등재된 Other Market 고객에게 Palantir Products를 공동으로 Co-Sell하기로 합의한다.", kt_risk:"Co-Sell 수익은 Hurdle 미산입(§1.6.5). Co-Sell 대상은 Appendix 7 목록으로 한정.", section:"Section 1.6.1", title:"Other Market Co-Sell" },
 { id:"SAA-1.6.2-1.6.3", doc:"SAA", topic:"운영 Steering Committee", core:"양사 각 2명 경영진으로 구성된 Steering Committee 운영. 연 2회 이상 회의, Appendix 7 목록 검토 및 개정 논의", text:"The parties will establish a steering committee made up of two (2) executive members from each of Palantir and Partner. The Steering Committee must meet twice per calendar year to review the Other Market Customers and mutually agree whether any amendments need to be made to the list at Appendix 7.", translation:"양사 각 2명의 임원급으로 Steering Committee를 구성한다. 연 2회 이상 회의(비대면 허용)를 열어 Other Market 고객 목록을 검토하고 Appendix 7 수정 여부를 합의한다.", kt_risk:"Steering Committee 미운영 시 Appendix 7 목록 변경 권한 제한. 회의록 관리 필수.", section:"Section 1.6.2-1.6.3", title:"Steering Committee 운영" },
 { id:"SAA-1.6.5", doc:"SAA", topic:"Co-Sell 수익 Hurdle 미산입", core:"Other Market 고객과의 계약 라이선스 비용은 Hurdle에 미산입. 단 Co-Sell Partner Referral Fee는 지급", text:"The parties agree that any license fees included in an Other Market Customer Agreement will not be counted against the Hurdle, however the Partner will be entitled to Co-Sell Partner Referral Fee in accordance with the terms of this Agreement.", translation:"Other Market 고객 계약의 라이선스 비용은 Hurdle($55M) 달성에 산입되지 않는다. 단 KT는 Co-Sell Partner Referral Fee(순수익의 10%)를 받을 수 있다.", kt_risk:"Co-Sell 매출이 아무리 커도 Hurdle 달성에 기여 안 됨. Hurdle 달성 전략 수립 시 Target Market 영업 집중 필요.", section:"Section 1.6.5", title:"Co-Sell 수익 Hurdle 미산입" },
 { id:"SAA-1.6.7", doc:"SAA", topic:"Co-Sell 참여 요건", core:"Co-Sell 참여 인력은 Enablement Program(OF3) 이수 및 인증 취득 필수. Palantir이 라이선스 비용 제안 독점권 보유", text:"Partner will follow Palantir's process for selling to Other Market Customers and Palantir will be the sole party eligible to propose license fees. Only those Partner team members who have been trained as part of the Enablement Program and received certification shall be permitted to engage in the co-selling.", translation:"KT는 Other Market 고객 영업 시 Palantir의 절차를 따라야 하며, 라이선스 비용 제안 권한은 Palantir이 독점한다. Co-Sell에 참여하는 KT 인력은 반드시 Enablement Program 이수 후 인증을 받아야 한다.", kt_risk:"인증 미취득 KT 직원의 Co-Sell 참여 불가. 가격 제안권이 Palantir에 있어 KT의 협상력 제한.", section:"Section 1.6.7", title:"Co-Sell 참여 요건" },
 { id:"SAA-1.6.8", doc:"SAA", topic:"Other Market 마케팅 제한", core:"KT는 Target Market 외 고객 또는 Appendix 7 미등재 고객에게 Palantir Products 또는 Premium Partner 지위를 적극 마케팅 불가. 위반 시 material breach", text:"For the avoidance of doubt, Partner is not permitted to actively market Palantir Products or Partner being a Palantir Premium Partner to customers outside of the Target Market or not expressly listed in Appendix 7, unless agreed by mutual written agreement.", translation:"KT는 Target Market 외부 고객이나 Appendix 7 미등재 고객에게 Palantir Products 또는 Premium Partner 지위를 적극적으로 마케팅하는 것이 금지된다. 단 양사 서면 합의 시 예외 가능.", kt_risk:"§6.2에서 범위 외 영업을 material breach로 명시. 위반 시 20일 치유 기간 후 계약 해지 가능.", section:"Section 1.6.8", title:"Target Market 외 마케팅 제한" },
 { id:"SAA-3.2.4", doc:"SAA", topic:"엔지니어링 서비스 요청 조건", core:"연간 $2M 초과 QRC에 한해 Palantir 엔지니어링 서비스 요청 가능. 60일 사전 서면 통보 필수", text:"Subject to a Qualified Resale Contract exceeding US$2 million per annum, Partner will provide Palantir with 60 days written notice of its engineering services requirements, to be mutually discussed and agreed via a Palantir Order Form.", translation:"연간 $200만 초과 QRC가 체결된 경우 KT는 Palantir 엔지니어링 서비스 필요 시 60일 전 서면 통보 후 별도 Order Form으로 협의·합의한다.", kt_risk:"$2M 미만 QRC에서는 엔지니어링 지원 보장 없음. 60일 사전 통보 미이행 시 서비스 제공 거부 가능.", section:"Section 3.2.4", title:"엔지니어링 서비스 요청 조건" },
 { id:"SAA-3.2.5", doc:"SAA", topic:"Pilot 제공 조건", core:"2025.6.1~2026.12.31 기간 중 End Customer당 최대 1회, 1~3개월 PoC Pilot. Palantir 최대 2명 엔지니어 지원. 최소 Pilot Fee: 1개월 $200K, 2개월 $350K, 3개월 $500K. Pilot Fee는 Hurdle 미산입", text:"From 1 June 2025 to 31 December 2026, Partner may offer one (1) proof of concept Pilot spanning 1-3 months. Palantir agrees to provide maximum two (2) engineers per Pilot, subject to: 60 days written notice; separate Order Form; End Customer executing Software Access Terms; Pilot fees: 1 month=$200K, 2 months=$350K, 3 months=$500K. Pilot Fees will not be attributable to the Hurdle.", translation:"2025년 6월 1일~2026년 12월 31일 기간 동안 KT는 End Customer당 1회, 1~3개월 PoC Pilot을 제공할 수 있으며, Palantir은 최대 2명의 엔지니어를 지원한다. 최소 Pilot Fee 준수. Pilot Fee는 Hurdle 산입 불가.", kt_risk:"60일 사전 통보 미이행 시 Pilot 지원 거부 가능. Pilot Fee는 Hurdle에 산입 안 됨. 2026년 12월 31일 이후 Pilot 제도 없음.", section:"Section 3.2.5", title:"Pilot PoC 제공 조건" },
 { id:"SAA-3.2.5.2", doc:"SAA", topic:"Pilot 대금 지급 기한 (Amendment No.1 수정)", core:"Amendment No.1에 의해 수정된 조항. Pilot Fee 지급 기한 60일로 변경. KT는 Palantir 인보이스 수령 후 60일 이내 Pilot Fee 지급 의무.", text:"Sub-clause 3.2.5.2 (as amended by Amendment No. 1): Partner shall pay Palantir the applicable Pilot Fee within sixty (60) days of receiving Palantir's invoice.", translation:"Sub-clause 3.2.5.2 (Amendment No.1 수정): KT는 Palantir의 인보이스 수령 후 60일 이내에 해당 Pilot Fee를 Palantir에게 지급하여야 한다.", kt_risk:"Amendment No.1로 지급 기한이 60일로 명시됨. 60일 초과 시 미결제로 처리되어 TOS §8.4에 따른 서비스 즉시 정지 위험.", section:"Sub-clause 3.2.5.2", title:"Pilot 대금 지급 기한 (60일, Amendment No.1)" },
 { id:"SAA-3.3", doc:"SAA", topic:"KT 의무사항", core:"Palantir 행동강령 준수, Palantir 대리인 역할 금지, Palantir 대신 가격·보증·확약 불가, 사전 서면 동의 없이 On-premise 배포 제안 불가", text:"Partner shall comply with good business practices and applicable Palantir codes of conduct. Partner shall not hold itself out as an agent or representative of Palantir. Unless agreed in writing with Palantir, Partner shall not offer on-premise deployment of Palantir Products.", translation:"KT는 Palantir 행동강령 등 정책을 준수하고, Palantir의 대리인으로 행동하거나 Palantir을 대신해 가격·진술·보증을 제공해서는 안 된다. Palantir 서면 동의 없이 On-premise 배포를 고객에게 제안할 수 없다.", kt_risk:"KT가 Palantir의 대리인으로 오인될 만한 행동 시 계약 위반. On-premise 배포 제안 전 반드시 Palantir 사전 동의 필요.", section:"Section 3.3", title:"KT 의무사항" },
 { id:"SAA-3.4", doc:"SAA", topic:"Reseller 사용 조건", core:"KT는 구매한 Palantir Products를 계열사 또는 Target End Customer에 재판매 가능. Hurdle 달성 후 Partner Compensation 지급. $45M 도달 시 추가 구매 논의", text:"Palantir Products purchased by Partner may be resold to Partner's Affiliates or to Target End Customers. Where aggregate Net Revenue is equal to US$45,000,000, the parties will meet to discuss any additional purchase of Palantir Products.", translation:"KT는 구매한 Palantir Products를 계열사 또는 Target End Customer에게 재판매할 수 있다. 누적 Net Revenue가 $45M에 도달하면 양사는 추가 구매를 논의한다.", kt_risk:"End Customer Ordering Document 미체결 시 재판매 불가. $45M 도달 시 추가 구매 논의 의무 발생.", section:"Section 3.4", title:"Reseller 재판매 조건" },
 { id:"SAA-6.1", doc:"SAA", topic:"계약 기간", core:"계약 발효일: 2025년 3월 12일. 종료: Order Form #2 종료 시(2030년 5월 30일)", text:"This Agreement shall commence on March 12, 2025 and terminate on the termination of Order Form #2.", translation:"이 계약은 2025년 3월 12일 발효되며, Order Form #2 종료 시 함께 종료된다.", kt_risk:"계약 기간이 OF2에 연동. OF2 조기 종료 시 SAA도 종료됨.", section:"Section 6.1", title:"계약 기간" },
 { id:"SAA-6.2", doc:"SAA", topic:"계약 해지 (Material Breach)", core:"material breach 발생 시 20일 서면 통보 후 치유 없으면 해지 가능. Target Market 외 영업도 material breach로 명시", text:"This Agreement may be terminated by either Party for material breach (including where Partner promotes Palantir Products outside the scope of this Agreement) upon twenty (20) days written notice identifying the material breach unless the breach is cured within such notice period.", translation:"어느 당사자도 상대방의 material breach(계약 범위 외 영업 포함) 발생 시, 위반 내용을 명시한 20일 서면 통보 후 치유되지 않으면 계약을 해지할 수 있다.", kt_risk:"SAA §6.2의 20일 치유 기간은 TOS §8.4 즉시 정지권과 충돌. TOS §8.4로 치유 기회 없이 서비스 정지 가능.", section:"Section 6.2", title:"계약 해지 (Material Breach)" },
 { id:"SAA-6.3", doc:"SAA", topic:"해지 효과 및 잔여 수익", core:"해지 시 Palantir 소프트웨어 접근권 즉시 종료. Surviving QRC는 계속 유효. Hurdle 미달성 해지 시 잔여 수익 배분은 good faith 협상. 미사용 License 비례 환불 또는 추가 지급", text:"Upon termination, Partner's right of access to Palantir's software shall automatically terminate. Any QRC entered into prior to termination will survive. If terminated before Partner has met the Hurdle, the revenue allocation for Surviving QRCs shall be subject to good faith negotiation. Fees due are ratable based on the total Fees under Order Form #2.", translation:"해지 시 Palantir 소프트웨어 접근권은 자동 종료. 해지 전 체결된 QRC는 계속 유효(Surviving QRC). Hurdle 미달성 상태에서 해지 시 잔여 수익 배분은 good faith 협상. 미사용 License Subscription은 ratable 기준으로 환불 또는 추가 지급.", kt_risk:"Hurdle 미달성 해지 시 잔여 QRC 수익 배분을 협상해야 하는 불확실성. OF4에서는 편의해지 불가이므로 해지 옵션 제한.", section:"Section 6.3", title:"해지 효과 및 잔여 수익" },
 { id:"SAA-6.4", doc:"SAA", topic:"존속 조항", core:"§6~10, Commercial Annex(Partner/Palantir Compensation, Upstream Payments)는 해지 후에도 존속", text:"Sections 6.0, 7.0, 8.0, 9.0 and 10.0, and solely with respect to Surviving QRCs the Commercial Annex including Partner Compensation, Palantir Compensation, and Upstream Payments shall survive any termination of this Agreement.", translation:"§6~10조 및 Surviving QRC에 한한 Commercial Annex(Partner/Palantir 보상, Upstream Payment)는 계약 해지 후에도 계속 유효하다.", kt_risk:"해지 후에도 Surviving QRC에 대한 수익 배분 의무 존속. Commercial Annex의 10/90 배분 조항 계속 적용.", section:"Section 6.4", title:"존속 조항" },
 { id:"SAA-7.1", doc:"SAA", topic:"비밀유지", core:"상대방 기밀정보 엄격 비밀 유지. 해지 후 5년간 의무 존속. 영업비밀은 영구 보호. 법원·정부 명령 시 사전 통보 의무", text:"Each Party shall keep strictly confidential all Confidential Information of the other Party. The Receiving Party's obligations shall survive termination for five (5) years; provided that obligations shall survive termination and continue in perpetuity with respect to any Confidential Information that is a trade secret.", translation:"수령 당사자는 상대방의 모든 기밀정보를 엄격히 비밀로 유지해야 한다. 비밀유지 의무는 계약 해지 후 5년간 존속하며, 영업비밀은 영구적으로 보호된다. 법원·정부 명령에 따른 공개 시 사전 서면 통보 의무.", kt_risk:"KT가 취득한 Palantir의 기술·사업 기밀을 해지 후 5년간 보호해야 함. 위반 시 손해배상 책임.", section:"Section 7.0", title:"비밀유지" },
 { id:"SAA-7.2", doc:"SAA", topic:"개인정보 처리", core:"Business Contact Information 상호 이전 가능. 수령 Party는 데이터 컨트롤러로서 PIPA, CCPA, GDPR 등 관련 법규 준수", text:"Each Party may transfer to the other Party Business Contact Information as reasonably necessary. The receiving Party shall be the data controller and shall be responsible for compliance with applicable law relating to data security, data protection, and privacy, including the Personal Information Protection Act of South Korea, CCPA, and GDPR.", translation:"양사는 필요 범위 내에서 Business Contact Information을 상호 이전할 수 있다. 수령 Party는 데이터 컨트롤러로서 한국 개인정보보호법, 신용정보법, CCPA, GDPR 등 모든 관련 법규를 준수해야 한다.", kt_risk:"KT는 Palantir로부터 받은 개인정보에 대해 데이터 컨트롤러 책임 부담. 개인정보보호법 위반 시 KT 단독 제재 가능.", section:"Section 7.2", title:"개인정보 처리" },
 { id:"SAA-7.3", doc:"SAA", topic:"Partner 독자 개발 자산 보호", core:"KT가 Palantir 기술로 독자 개발한 Partner Custom Assets에 대해 Palantir은 계약 기간 중 및 이후 2년간 타 한국 통신사에 동일·유사 형태로 라이선스 불가", text:"Where Partner independently develops, using Palantir Technology, Partner Custom Assets, Palantir shall not be permitted to license Partner Custom Assets in the same or substantially similar project format for any other Korean telecommunications carriers during the Term and for a period of two (2) years thereafter.", translation:"KT가 Palantir 기술을 활용해 독자 개발한 Partner Custom Assets에 대해 Palantir은 계약 기간 및 종료 후 2년간 다른 한국 통신사에 동일·유사한 프로젝트 형태로 라이선스를 부여할 수 없다.", kt_risk:"KT Custom Assets 보호는 동일·유사한 프로젝트 형태에 한정. 변형된 형태로는 타 통신사에 제공 가능. 2년 이후 보호 소멸.", section:"Section 7.3", title:"Partner 독자 개발 자산 보호" },
 { id:"SAA-8.1", doc:"SAA", topic:"상호 면책", core:"각 Party는 허위 진술·서비스 제공 행위·중과실·고의로 인한 제3자 클레임에 대해 상대방을 면책·방어", text:"Each Party shall indemnify, defend, and hold harmless the other Party against costs, attorneys fees, and damages resulting from any third party claim arising in connection with this Agreement based on: (a) misrepresentations or fraudulent statements; (b) services provided to the third party; or (d) gross negligence or willful misconduct of the indemnifying Party.", translation:"각 Party는 계약과 관련하여 (a) 허위 진술·사기성 광고, (b) 제3자에게 제공한 서비스, (c) 중과실 또는 고의적 위법행위로 발생한 제3자 클레임에 대해 상대방을 면책하고 방어해야 한다.", kt_risk:"KT의 중과실이나 허위 광고로 Palantir이 제3자 클레임을 받을 경우 KT가 모든 비용 부담. 면책 요건(즉시 통보, 방어권 이양, 협조) 미이행 시 면책 의무 소멸.", section:"Section 8.1", title:"상호 면책" },
 { id:"SAA-8.2", doc:"SAA", topic:"Liability Cap ($10M)", core:"최대 책임 한도: max(직전 12개월 Partner Compensation, USD $10M). 간접손해·결과적 손해 면책", text:"Each Party agrees that the maximum aggregate liability of either Party on all claims in connection with this Agreement shall not exceed the greater of (i) the Partner Compensation in the twelve (12) months prior to the date on which the claim arose or (ii) TEN MILLION DOLLARS (USD 10,000,000).", translation:"계약과 관련한 모든 청구에 대한 각 Party의 최대 총 책임 한도는 (i) 청구 발생일 기준 직전 12개월 Partner Compensation과 (ii) USD 1,000만 달러 중 더 큰 금액을 초과할 수 없다.", kt_risk:"TOS §12의 $100K Cap과 충돌(XC-002). SAA Cap($10M)이 TOS Cap($100K)보다 KT에 유리. 분쟁 시 SAA 우선 적용 주장 필요.", section:"Section 8.2", title:"SAA Liability Cap ($10M)" },
 { id:"SAA-9.0", doc:"SAA", topic:"준거법·중재지", core:"KT(미주 외 소재)에 대해 한국법 적용, 서울 ICC 중재. 60일 good faith 협의 후 분쟁 미해결 시 중재", text:"If Partner is located outside of the Americas, then the governing law shall be the substantive laws of Korea, and arbitration shall be administered in Seoul, South Korea under the Rules of Arbitration of the International Chamber of Commerce.", translation:"KT(미주 외 소재)에 대해서는 한국 실질법이 적용되며, 분쟁은 서울에서 ICC 중재 규칙에 따라 중재된다. 60일 good faith 협의 후에도 해결 안 되면 중재 회부.", kt_risk:"TOS §13(영국법/런던 ICC)과 충돌(XC-003). SAA 우선 원칙상 한국법/서울 ICC 적용이나 Palantir의 TOS 주장 시 분쟁 발생 가능.", section:"Section 9.0", title:"준거법·중재지" },
 { id:"SAA-10.4", doc:"SAA", topic:"독립 개발권", core:"상대방 기밀 미사용 시 경쟁 제품 독자 개발 가능. Palantir의 경쟁 제품 개발에 KT 기밀 미사용 확인 어려움", text:"Neither Party shall be precluded from developing, using, marketing, or providing materials competitive with the products of the other Party, provided that the materials are independently developed without use of any Confidential Information of the other Party.", translation:"비밀유지 의무를 전제로, 어느 Party도 상대방의 기밀정보를 사용하지 않고 독자 개발한 경쟁 제품·서비스를 개발·판매·마케팅하는 것이 금지되지 않는다.", kt_risk:"Palantir이 KT 기밀을 활용하여 경쟁 제품을 개발해도 독자 개발 입증이 어려움. KT Custom Assets 보호(§7.3)와 함께 검토 필요.", section:"Section 10.4", title:"독립 개발권" },
 { id:"SAA-10.7", doc:"SAA", topic:"반부패·반뇌물", core:"미국 FCPA, 영국 Bribery Act 및 적용 가능한 반부패법 준수 의무. 직간접 금품 제공·약속 금지", text:"Both Parties agree that they shall not take any action that would result in a violation of the U.S. Foreign Corrupt Practices Act, U.K. Bribery Act, and any applicable anti-bribery or anti-corruption law, including making, offering, or promising any payment, contribution, gift, entertainment, bribe, or kickback.", translation:"양사는 미국 FCPA, 영국 Bribery Act 및 관련 반부패법을 준수하며, 경쟁우위 획득 또는 유리한 대우를 위해 직간접적으로 금품·향응·리베이트 등을 제공하거나 약속해서는 안 된다.", kt_risk:"KT 임직원의 반부패법 위반 시 계약 해지 사유. 제3자를 통한 간접 제공도 위반.", section:"Section 10.7", title:"반부패·반뇌물" },
 { id:"SAA-RESA-1", doc:"SAA", topic:"주요 정의 (Resale Terms)", core:"Target Market: 금융서비스(투자은행·자산관리·회계법인(내부사용)·개인자산관리) + Appendix 6 보험사. Territory: 대한민국", text:"Target Market means the financial services sector, including accountancy (internal use), investment banking, investment management, and personal asset management, as well as an approved list of insurance companies at Appendix 6. Territory means the Republic of South Korea.", translation:"Target Market: 금융서비스(회계법인 내부사용·투자은행·자산관리·개인자산관리) + Appendix 6 보험사. Territory: 대한민국.", kt_risk:"삼성 그룹 계열사는 Amendment No.1에 의해 Target Market에서 명시적 제외. 고객 분류 오류 시 계약 위반.", section:"Schedule A §1.6-1.9", title:"Resale Terms 주요 정의" },
 { id:"SAA-RESA-3", doc:"SAA", topic:"Opportunity Registration 의무", core:"Target End Customer 영업 전 반드시 Palantir Portal에 등록 필수. 미등록 고객은 QRC 체결 불가. Palantir은 등록 거부권 보유", text:"Partner shall register each Target End Customer through the online portal including: (a) legal name and address, (b) description of the proposed opportunity, and (c) any additional information relevant to Palantir's assessment. Only registered Target End Customers shall be eligible for approval.", translation:"KT는 각 Target End Customer에 대해 Palantir Portal에 사전 등록해야 한다. 등록 내용: 고객 법인명·주소, 제안 기회 설명, 기타 관련 정보. 등록된 고객만 Palantir 승인 대상이 됨.", kt_risk:"Opportunity Registration 없이 고객 영업 진행 시 QRC 체결 불가. Palantir은 여러 사유로 등록을 거부할 수 있으며, 거부 시 KT는 즉시 해당 고객 영업 중단 의무.", section:"Schedule A §3.0-3.2", title:"Opportunity Registration 의무" },
 { id:"SAA-RESA-QRC", doc:"SAA", topic:"QRC 체결 기간 및 갱신", core:"등록 승인 후 90일 내 QRC 체결 필수. 기간 내 미체결 시 승인 자동 소멸. QRC 갱신·연장은 Palantir 사전 서면 동의 필수", text:"Partner will execute a QRC within ninety (90) days after Palantir's written acceptance (Active Resale Opportunity Term), or otherwise such approval shall automatically terminate. QRCs may not be extended or renewed without Palantir's prior written consent.", translation:"Palantir 승인 후 90일 내 QRC를 체결해야 하며, 기간 내 체결하지 못하면 승인이 자동 소멸된다. QRC 갱신·연장은 반드시 Palantir 사전 서면 동의 필요.", kt_risk:"90일 기간 엄수 필요. 기간 내 미체결 시 재등록·재승인 절차 필요. 갱신 시마다 Palantir 동의 의존.", section:"Schedule A §3.3", title:"QRC 체결 기간 및 갱신 조건" },
 { id:"SAA-2.1", doc:"SAA", topic:"QRC 기본 조건", core:"QRC: 무제한 User 접근, 플랫폼 지원·유지보수·업데이트 포함. 최소 계약 기간 1년, 최소 연간 계약액 $100만", text:"Each QRC will provide: (i) access to Palantir Products by unlimited number of Users; (ii) documentation and learning resources; (iii) platform support, maintenance, error resolution; (iv) continued platform updates. Minimum Contract: 1 year. Minimum Annual Contract Value: $1,000,000.", translation:"각 QRC는 무제한 User의 Palantir Products 접근권, 문서·학습 자료, 플랫폼 지원·유지보수·오류 해결, 지속적인 업데이트를 포함한다. 최소 계약 기간 1년, 최소 연간 계약액 $100만.", kt_risk:"$100만 미만 계약은 QRC로 인정 안 됨. 고객과의 계약 최소 조건 준수 필요.", section:"Commercial Annex §2.1-2.2", title:"QRC 기본 조건" },
 { id:"SAA-2.2", doc:"SAA", topic:"End Customer 대금 수금 책임", core:"KT가 독립적으로 End Customer 가격 결정. KT가 End Customer로부터 전액 수금 책임. End Customer 미지급과 무관하게 KT의 Palantir 지급 의무 존속", text:"Partner will independently determine the pricing for Palantir Products to End Customers. Partner will be solely responsible for collecting all fees from End Customers and making payment to Palantir. Non-payment by End Customers will not relieve Partner of its obligation to pay fees to Palantir. Palantir reserves the right to terminate if it fails to receive payment from Partner.", translation:"KT는 독립적으로 End Customer 가격을 결정하고, End Customer로부터 모든 비용을 수금할 단독 책임을 진다. End Customer가 KT에게 미지급하더라도 KT의 Palantir에 대한 지급 의무는 소멸하지 않는다.", kt_risk:"End Customer의 채무불이행 위험을 KT가 전부 부담. End Customer 신용 검토 필수. 미지급 시 KT가 자체 자금으로 Palantir에 지급해야 함.", section:"Commercial Annex §2.5", title:"End Customer 수금 책임" },
 { id:"SAA-2.8", doc:"SAA", topic:"Upstream Payment 의무", core:"Hurdle 달성 후 QRC 수령액에서 Partner Compensation 차감 후 30일 내 Upstream Payment. 환율은 OANDA 기준. 세금 KT 부담", text:"Only in the case that aggregate Net Revenue is equal to or greater than the Hurdle, Partner shall forward to Palantir the Net Revenue minus any applicable Partner Compensation (Upstream Payment) within 30 days of Partner receiving an invoice. All USD conversions shall use the OANDA spot rate on the date of payment to Palantir.", translation:"Hurdle 달성 후에만 KT는 각 QRC의 수령액에서 Partner Compensation을 차감한 금액을 Palantir에게 인보이스 수령 후 30일 내 지급해야 한다. 환율 전환은 지급일의 OANDA 현물환율 적용.", kt_risk:"Hurdle 달성 후 30일 기한 엄수. 환율 변동에 따른 환차손 KT 부담. 세금 처리 실수 시 Palantir 수취액 감소로 분쟁 발생 가능.", section:"Commercial Annex §2.8", title:"Upstream Payment 의무" },
 { id:"SAA-2.9", doc:"SAA", topic:"분기 보고 의무", core:"매 분기 첫 영업일에 QRC 현황 보고 필수. Palantir은 10일 사전 통보 후 감사 가능. 계약 종료 후 3년간 거래 기록 보관 의무", text:"By the first business day of every quarter, Partner shall submit a report of all QRCs executed and ongoing. Upon 10 days advance written notice, Partner will permit Palantir to audit Partner's records. Partner will maintain all records for at least 3 years following expiration or termination.", translation:"KT는 매 분기 첫 영업일에 해당 분기 체결 QRC 및 진행 중인 QRC 전체를 Palantir이 제공하는 형식으로 보고해야 한다. Palantir은 10일 사전 서면 통보 후 감사 실시 가능. 모든 거래 기록은 계약 종료 후 3년간 보관.", kt_risk:"분기 보고 지연·누락 시 계약 위반. 감사 협조 의무. 3년 기록 보관 미이행 시 감사 대응 불가.", section:"Commercial Annex §2.9", title:"분기 보고 의무" },
 { id:"SAA-2.10", doc:"SAA", topic:"Extraordinary Bilateral Transaction (EBT)", core:"KT가 발굴한 Target Market 고객이 Palantir과 직접 계약하는 경우, 양사 협의로 Palantir 수익의 전부 또는 일부를 Net Revenue로 인정하여 Hurdle 산입 가능", text:"A transaction where Partner finds, cultivates, registers, and prepares an opportunity with a Target End Customer but where the Target End Customer desires to contract directly with Palantir rather than Partner, can be treated as an Extraordinary Bilateral Transaction. The Parties will meet to discuss whether to consider all or a portion of Palantir's obtained revenue to be counted as Net Revenue.", translation:"KT가 발굴·등록·준비한 Target Market 고객이 KT 대신 Palantir과 직접 계약하기를 원하는 경우 EBT로 처리 가능. 양사 협의로 Palantir 수익의 전부 또는 일부를 KT의 Net Revenue로 인정하여 Hurdle에 산입할 수 있다.", kt_risk:"EBT 인정 여부는 양사 협의 사항으로 Palantir이 거부 가능. KT는 영업 기여도 입증 부담. EBT는 반드시 KT가 사전 등록한 Target Market 고객에만 적용.", section:"Commercial Annex §2.10", title:"EBT (Extraordinary Bilateral Transaction)" },
 { id:"SAA-2.11", doc:"SAA", topic:"Surviving QRC 수익 배분 (10/90)", core:"계약 해지 후 Surviving QRC 수익: KT 10% / Palantir 90% 고정 배분", text:"Upon termination of the Agreement or this Commercial Annex, the Hurdle will become inapplicable, and all Net Revenue arising from a Surviving QRC will be allocated as follows: 10% to Partner and 90% to Palantir (via Upstream Payments), respectively.", translation:"계약 또는 Commercial Annex 해지 시 Hurdle은 적용 불가가 되며, Surviving QRC의 모든 Net Revenue는 KT 10%, Palantir 90%로 배분된다.", kt_risk:"Hurdle 미달성 해지 시 수익 배분이 10%로 고정됨. SAA §6.3의 good faith 협상과 충돌 가능(IC-002). Commercial Annex가 SAA 본문보다 우선 적용.", section:"Commercial Annex §2.11", title:"Surviving QRC 수익 배분 (10/90)" },
 { id:"SAA-HURDLE", doc:"SAA", topic:"Hurdle 및 Partner Compensation", core:"Hurdle: 누적 Net Revenue USD $55M. 달성 시 Partner Compensation 10%, Palantir Compensation 90%. 최소 QRC 기간 1년, 최소 연간 계약액 $100만", text:"Partner Compensation: 10% of the Net Revenue but only if aggregate Net Revenue during the Term is equal to or greater than USD$55 million (Hurdle). Palantir Compensation: 90% of Net Revenue but only if aggregate Net Revenue is equal to or greater than the Hurdle.", translation:"Partner Compensation: 계약 기간 중 누적 Net Revenue가 USD $5,500만(Hurdle) 이상인 경우에만 Net Revenue의 10%. Palantir Compensation: Hurdle 달성 시 Net Revenue의 90%.", kt_risk:"Hurdle 미달성 시 KT는 Partner Compensation을 전혀 받지 못함. Hurdle 달성이 KT 수익 구조의 핵심 전제조건.", section:"Commercial Annex Exhibit A", title:"Hurdle 및 Partner Compensation" },
 { id:"SAA-APP5", doc:"SAA", topic:"KT 계열사 목록 (Appendix 5)", core:"KT 계열사로 재판매 가능한 40개 계열사 목록. KT Skylife, KTCS, KTIS, KT Alpha, Nasmedia, K Bank, KT Cloud 등 포함", text:"Partner Affiliates include: KT Skylife, KTCS, KTIS, KT Alpha, Nasmedia, Play D, Genie Music, KT Initech, KT Engineering, KT Linkus, KT Commerce, KT Telecop, KT M&S, KT DS, Skylife TV, The Sky K, KT Estate, KT NexR, BC Card, HCN Networks, VP Co., Smartro, KT Investment Mgmt, KT Gimhae Data Hub, KT SAT, KT living, KT Sports, KT Service(East/South), KT Investment, KT MOS(North/South), KHS, NextConnect PFV, KT Hope Connect, KT Real Estate Trusts, Storywiz, K Bank, KT Studio Genie, Alti Media, KT Cloud, Open Cloudlab, K-logis Hwaseong.", translation:"KT 계열사로서 Palantir Products 재판매 대상이 되는 40여개 계열사 목록. KT Skylife, KTCS, K Bank, KT Cloud 등 포함.", kt_risk:"Appendix 5 미등재 KT 계열사에 대한 재판매는 별도 승인 필요. 계열사 구조 변경 시 목록 업데이트 필요.", section:"Schedule A Appendix 5", title:"KT 계열사 목록" },
 { id:"SAA-APP6", doc:"SAA", topic:"Target Market 보험사 목록 (Appendix 6)", core:"Amendment No.1 반영 보험사 22개사. DB손해보험 기존 Pilot은 계약 적용 제외. 삼성생명·화재, 동양생명 포함", text:"Approved Insurance Companies (Amendment No.1 반영): 신한라이프(Shinhan Life), DB손해보험(DB Insurance, pilot 제외), DB생명(DB Life), 현대해상화재보험(Hyundai Marine & Fire), 서울보증보험(Seoul Guarantee), 한화생명(Hanwha Life), 한화손해보험(Hanwha General), ABL생명(ABL Life), 캐롯손해보험(Carrot General), 메리츠화재(Meritz Fire), KB손해보험(KB Insurance), KDB생명(KDB Life), KB생명(KB Life), 삼성생명(Samsung Life), 삼성화재(Samsung Fire & Marine), 하나생명(Hana Life), 하나손해보험(Hana General), 미래에셋생명(Mirae Asset Life), 농협손해보험(NongHyup General), 농협생명(NongHyup Life), 교보생명(Kyobo Life), 동양생명(Tongyang Life).", translation:"Amendment No.1에 의해 교체된 Target Market 승인 보험사 22개사. DB손해보험의 기존 Palantir 주도 Pilot은 이 계약 적용 제외. 삼성생명·화재 추가. DB Insurance는 Pilot 외 다른 기회는 계약에 따라 KT가 추진 가능.", kt_risk:"목록 외 보험사 영업 시 §1.6.8 위반(material breach). DB손해보험 Pilot 전환 시 EBT로 처리 가능.", section:"Schedule A Appendix 6", title:"Target Market 보험사 목록 (22개사, Amendment 반영)" },
 { id:"SAA-APP7", doc:"SAA", topic:"Other Market Co-Sell 목록 (Appendix 7, Amendment 반영)", core:"Amendment No.1에 의해 교체된 Co-Sell 대상 13개사. 포스코 계열 다수 포함. 기존 현대자동차·기아 등 제외", text:"Approved Co-Sell Companies (Amendment No.1): 포스코인터내셔널(POSCO International), 포스코퓨처엠(POSCO Future M), 포스코(Posco), 대한항공(Korean Air), 한화시스템(Hanwha Systems), GS리테일(GS Retail), 지에스칼텍스(GS Caltex), 현대글로비스(Hyundai Glovis), LS일렉트릭(LS Electric), 셀트리온(Celltrion), 포스코이앤씨(Posco E&C), 포스코DX(Posco DX), 포스코플로우(Posco Flow).", translation:"Amendment No.1에 의해 교체된 Other Market Co-Sell 대상 13개사. 기존 현대자동차·기아·산업통상자원부·서울아산병원·한국해양진흥공사·현대로템·CJ제일제당은 제외되고 포스코 계열 및 대한항공·GS 계열 등 신규 포함.", kt_risk:"Amendment No.1로 Co-Sell 목록이 변경됨. 기존 목록 기반 영업 진행 시 계약 위반. Co-Sell 수익은 Hurdle 미산입.", section:"Schedule A Appendix 7", title:"Other Market Co-Sell 목록 (13개사, Amendment 반영)" },
 { id:"SAA-2.2-SUPPORT", doc:"SAA", topic:"고객 지원 서비스 기준", core:"End Customer 지원 문의는 KT가 1차 접수·분류. 긴급·중요 기술 이슈는 30분 내 Palantir 에스컬레이션. KT가 해결 불가한 비긴급 기술 이슈도 에스컬레이션 가능.", text:"Partner shall establish and maintain a support policy stating that End Customers shall submit any support inquiries to Partner in the first instance. Partner shall provide an initial response where they can be resolved by Partner and shall route to Palantir any urgent or critical technical issues within thirty (30) minutes. Partner may otherwise escalate to Palantir any non-urgent technical issues that are unresolvable by Partner.", translation:"End Customer의 모든 지원 문의는 KT가 1차 접수·분류·해결 책임. 긴급·중요 기술 이슈는 30분 내 Palantir에 에스컬레이션. KT가 해결 불가한 비긴급 기술 이슈도 Palantir에 에스컬레이션 가능. Palantir의 직접 지원은 별도 합의 시에만 End Customer에게 직접 청구.", kt_risk:"KT가 1차 지원 책임을 지므로 지원 조직·정책 수립 필수. 30분 에스컬레이션 기준 미준수 시 계약 위반. Palantir 직접 지원 비용은 별도 청구될 수 있음.", section:"Schedule A Appendix 3", title:"고객 지원 서비스 기준" },
 { id:"SAA-2.3-COSELL", doc:"SAA", topic:"Co-Sell 수익 배분 세부", core:"Co-Sell QRC의 KT Referral Fee 10%, Palantir 90%. Co-Sell 수익은 Hurdle 미산입. 최소 계약 기간 1년, 최소 연간 계약액 $100만.", text:"Qualified Resale Contract - Commercial Terms for Co-Sell: Co-Sell Partner Referral Fee: 10% of the Net Revenue. Co-Sell Palantir Compensation: 90% of Net Revenue. Minimum Qualified Sale Contract: 1 year. Minimum Annual Contract Value: $1,000,000. Co-Sell revenues are not subject to the Hurdle.", translation:"Co-Sell QRC의 수익 배분: KT Co-Sell Partner Referral Fee 10%, Palantir 90%. 최소 계약 기간 1년, 최소 연간 계약액 $100만. Co-Sell 수익은 Hurdle에 산입되지 않음.", kt_risk:"Co-Sell 수익은 Hurdle 미산입이므로 Hurdle 달성 전략에 포함 불가. 최소 계약액 $100만 미만 계약은 QRC로 인정 안 됨.", section:"Commercial Annex §2.3", title:"Co-Sell 수익 배분 세부" },
 { id:"SAA-2.4-COMPLIANCE", doc:"SAA", topic:"QRC 체결 전 KT 준수 의무", core:"QRC 체결 전 KT가 모든 계약 조건 준수 중이어야 함. KT의 모든 진술·보증이 계속 유효해야 함. 둘 중 하나라도 미충족 시 QRC 체결 불가.", text:"As a condition precedent to any approved resale of subscriptions to Palantir Products to an End Customer by Partner, (a) Partner shall be in compliance with all terms, conditions, and obligations set forth in this Agreement, the Resale Terms (including approval of such End Customer in an Opportunity Registration), and all applicable laws and (b) all representations, warranties, and certifications of Partner shall be true, correct, and complete at all times during the Schedule Term and as of the payment date.", translation:"End Customer에 대한 Palantir Products 재판매 승인의 전제조건으로: (a) KT는 이 계약, Resale Terms(Opportunity Registration 포함), 모든 관련 법률을 준수하고 있어야 하며, (b) KT의 모든 진술·보증·인증이 Schedule 기간 전체 및 지급일 기준으로 사실이고 정확하며 완전해야 한다.", kt_risk:"KT가 계약 위반 상태이면 신규 QRC 체결 자체가 불가. 법률 위반이나 Opportunity Registration 미이행 상태에서 영업 진행 시 QRC 전체가 무효화될 수 있음.", section:"Commercial Annex §2.4", title:"QRC 체결 전 KT 준수 의무" },
 { id:"SAA-2.6-DELIVERY", doc:"SAA", topic:"제품 접근 전달 방식", core:"Palantir이 End Customer에게 직접 접근 전달. KT에게는 전달 안 함. KT가 End Customer 계약자 자격으로 접근 시 End Customer Software Access Terms 준수 의무.", text:"Palantir will deliver instructions for access to the Palantir Products directly to the End Customer contact specified in the Qualified Resale Contract in accordance with Palantir's standard delivery procedures. Palantir will not deliver any Palantir Products covered by a Qualified Sales Contract to Partner.", translation:"Palantir은 QRC에 명시된 End Customer 담당자에게 Palantir Products 접근 지침을 직접 전달한다. KT에게는 QRC에 포함된 Palantir Products를 전달하지 않는다.", kt_risk:"KT는 End Customer를 위해 재판매하지만 실제 제품 접근은 Palantir이 End Customer에 직접 전달. KT가 End Customer의 계약자 자격으로 접근 시 별도 End Customer Software Access Terms 준수 필요.", section:"Commercial Annex §2.6", title:"제품 접근 전달 방식" },
 { id:"SAA-2.10-EBT-DETAIL", doc:"SAA", topic:"EBT 처리 세부 절차", core:"EBT 인정 시 해당 수익은 Hurdle에 산입 또는 Partner Compensation 협의. Palantir은 분기별 EBT 수익을 KT에 보고 의무. 해당 수익은 KT의 다음 OF2 지급에서 차감.", text:"2.10.1: If EBT revenue counted as Net Revenue, it shall be applied to Hurdle calculation, except where Hurdle is exhausted the parties will mutually agree whether Partner will receive Partner Compensation. 2.10.2: On a quarterly basis, Palantir shall report EBT Net Revenue to Partner, and such Net Revenue shall be deducted from Partner's next payment under Order Form #2. 2.10.3: The Parties shall in good faith discuss procedures and criteria for evaluating Partner's contribution for prospective EBTs.", translation:"2.10.1: EBT 수익이 Net Revenue로 인정되면 Hurdle에 산입. Hurdle 달성 후에는 Partner Compensation 지급 여부 협의. 2.10.2: Palantir은 분기별로 EBT 수익을 KT에 보고하고, 해당 수익은 KT의 다음 OF2 지급액에서 차감(또는 크레딧으로 제공). 2.10.3: 향후 EBT에 대한 KT 기여도 평가 기준·절차를 양사가 good faith로 논의.", kt_risk:"EBT 수익이 OF2 지급에서 차감되므로 실질적 현금 흐름 영향. 분기 보고 미이행 시 EBT 정산 지연. 평가 기준 미합의 상태에서는 EBT 인정 여부 분쟁 가능.", section:"Commercial Annex §2.10.1-2.10.3", title:"EBT 처리 세부 절차" },
 { id:"SAA-2.1.2-ENDCUSTOMER", doc:"SAA", topic:"End Customer 의무 이행 보장", core:"KT는 End Customer Software Access Terms를 End Customer에게 구속력 있게 적용할 책임. 이에 위배되는 다른 조건(Other Terms) 적용 금지. 위반 시 Palantir은 해당 End Customer 접근 차단 가능.", text:"Partner shall be responsible for making the End Customer Software Access Terms binding and enforceable on End Customers via the End Customer Ordering Document. Partner is expressly prohibited from reselling subscriptions subject to terms that supersede, override, or are inconsistent with the End Customer Software Access Terms. Partner shall not market, resell, or provide access to Palantir Products to any individual that is a competitor of Palantir or adverse to Palantir, as determined by Palantir in its sole discretion.", translation:"KT는 End Customer Ordering Document를 통해 End Customer Software Access Terms를 End Customer에게 구속력 있게 적용할 책임을 진다. End Customer Software Access Terms를 대체하거나 충돌하는 다른 조건(Other Terms) 적용이 명시적으로 금지된다. Palantir의 경쟁사나 Palantir에 적대적인 개인·단체에게 재판매 또는 접근 제공 불가.", kt_risk:"End Customer가 다른 계약 조건을 주장할 경우 KT 책임. Palantir 경쟁사에 재판매 시 즉시 계약 위반. Palantir이 단독 재량으로 경쟁사 여부 결정.", section:"Schedule A §2.1.2", title:"End Customer 의무 이행 보장" },
 { id:"SAA-4.0-EXPORT", doc:"SAA", topic:"수출통제 준수 인증", core:"KT는 Palantir의 수출통제 준수 인증서(Global Trade Compliance Certification)에 서명 의무. 미국 수출관리법·제재 준수, 제3자 스크리닝, 금지 국가 재수출 금지 포함.", text:"Partner is required to complete and sign Palantir's Global Trade Compliance Certification. Partner certifies: maintaining comprehensive export and sanctions compliance program; training for employees; screening and monitoring of Third Parties against USG Sanctions Lists (BIS Denied Persons, Entity List, OFAC SDN List, etc.); not reselling to countries in violation of UN/US/EU embargoes; immediate notification to Palantir if Partner becomes designated on a USG Sanctions List.", translation:"KT는 Palantir의 Global Trade Compliance Certification을 작성하고 서명해야 한다. 인증 내용: 수출·제재 준수 프로그램 운영, 직원 교육, 제3자에 대한 미국 정부 제재 목록(BIS Denied Persons, Entity List, OFAC SDN 등) 스크리닝, UN/US/EU 금수 조치 국가에 대한 재수출 금지, 제재 목록 등재 즉시 Palantir 통보.", kt_risk:"수출통제 인증 미이행 시 계약 위반. KT 또는 KT 고객이 미국 제재 목록에 등재되면 즉시 Palantir 통보 의무. 위반 시 Palantir Products 접근 차단 가능.", section:"Schedule A §4.0 / Appendix 4", title:"수출통제 준수 인증" },
 { id:"TOS-1", doc:"TOS", topic:"주요 정의", core:"Customer Data, Palantir Technology, Service, Order Form, Users, Taxes 등 핵심 용어 정의", text:"Customer Data: data provided by or created by Customer/Users using Service. Palantir Technology: Service, Documentation, Data Connection Software, Sample Materials and improvements. Service: proprietary SaaS offerings in Order Form. Users: employees/contractors/other users specified in Order Form.", translation:"Customer Data: 고객이 제공하거나 고객·Users가 서비스 이용 중 생성한 데이터. Palantir Technology: 서비스, 문서, Data Connection Software, Sample Materials 및 개선 사항 전체. Service: Order Form에 명시된 독점 SaaS 서비스. Users: 직원·계약직·Order Form에 명시된 기타 사용자.", kt_risk:"Customer Data 소유권은 고객(KT)에 있으나 서비스 제공 목적으로 Palantir에 라이선스 부여. Palantir Technology 소유권은 Palantir에 귀속.", section:"Section 1", title:"주요 정의" },
 { id:"TOS-2.1", doc:"TOS", topic:"서비스 접근 권한", core:"Palantir은 Order Term 동안 고객의 내부 사업 목적으로만 서비스 접근 권한 부여", text:"Palantir shall make available the Service to Customer during the applicable Order Term solely for use by Customer and its Users for Customer's internal business purposes, or as otherwise set forth in an Order Form.", translation:"Palantir은 Order Term 동안 고객이 내부 사업 목적으로만 서비스를 이용할 수 있도록 접근권을 제공한다.", kt_risk:"서비스는 내부 사업 목적에 한정. KT가 Palantir 서비스를 외부 고객에게 직접 제공하려면 Order Form에 별도 명시 필요.", section:"Section 2.1", title:"서비스 접근 권한" },
 { id:"TOS-3.1", doc:"TOS", topic:"계정 관리 및 보안", core:"고객이 User 계정 관리 및 MFA 적용 책임. 계정 침해 즉시 비활성화 및 Palantir 통보 의무", text:"Customer shall be responsible for (i) administering Accounts; (ii) using industry standard security measures including multi-factor authentication; (iii) any activity on Accounts; (iv) any breach by any Users. Customer shall immediately de-activate any Account upon becoming aware of the compromise.", translation:"고객은 (i) 계정 관리, (ii) MFA 포함 산업 표준 보안 조치, (iii) 계정 활동 전체, (iv) Users의 계약 위반에 대해 책임을 진다. 계정 침해 인지 즉시 비활성화 및 Palantir 통보.", kt_risk:"KT Users의 계정 침해·위반에 대해 KT가 전 책임. MFA 미적용 시 계약 위반.", section:"Section 3.1", title:"계정 관리 및 보안" },
 { id:"TOS-4", doc:"TOS", topic:"허용 사용 제한 (Acceptable Use)", core:"적용 법률 준수, 수출통제 준수, PII·PHI 사용 시 가이드라인 준수, Use Case Restrictions 준수 의무", text:"Customer's use of the Service will not violate applicable laws. Customer may not use Palantir Technology in violation of Trade Compliance Requirements. If Customer uses PII or PHI, Customer will follow relevant guidance. Customer will comply with Use Case Restrictions.", translation:"고객의 서비스 접근·사용은 적용 법률을 위반하지 않아야 한다. 수출통제법령 준수 의무. PII·PHI 사용 시 Palantir 가이드라인 준수. Use Case Restrictions 준수 필수.", kt_risk:"Use Case Restrictions 위반 시 서비스 접근 즉시 차단 가능. ITAR 관련 데이터 처리 원칙적 금지.", section:"Section 4", title:"허용 사용 제한" },
 { id:"TOS-5.1", doc:"TOS", topic:"Customer Data 소유권", core:"Customer Data 소유권은 KT. Palantir에게 서비스 제공 목적 한정 라이선스 부여. 피드백은 영구·취소불가 라이선스 부여", text:"As between the Parties, Customer owns all rights in Customer Data. Customer grants to Palantir a non-exclusive, worldwide, royalty-free license during the Term to process Customer Data solely to provide the Service. Customer grants a worldwide, perpetual, irrevocable, royalty-free license to use any suggestions or feedback.", translation:"Customer Data의 모든 권리는 KT에 귀속. KT는 Palantir에게 서비스 제공 목적에 한정하여 Term 동안 비독점·전세계·무상 처리 라이선스를 부여한다. 피드백·개선 제안에 대해서는 영구·취소불가·무상 라이선스 부여.", kt_risk:"피드백에 대한 영구·취소불가 라이선스 부여로 KT 개선 아이디어가 Palantir 기술에 흡수될 수 있음.", section:"Section 5.1", title:"Customer Data 소유권" },
 { id:"TOS-5.3", doc:"TOS", topic:"서비스 사용 제한 (Restrictions)", core:"역설계·경쟁 서비스 개발·무단 접근·제3자 사용 제공 등 광범위한 사용 제한. 위반 시 즉시 서비스 정지 가능", text:"Customer will not: (a) gain unauthorized access to Service; (b) interfere with Service integrity; (f) decompile or reverse engineer Palantir Technology; (g) provide Service for third party benefit; (m) use for developing competing services; (n) remove copyright notices.", translation:"고객은 서비스에 무단 접근, 무결성 방해, 역설계·리버스 엔지니어링, 제3자 이익을 위한 서비스 제공, 경쟁 서비스 개발·정보 수집 목적 사용, 저작권 고지 제거 등을 해서는 안 된다.", kt_risk:"Restrictions 위반 시 TOS §8.4에 따라 즉각적인 서비스 정지 가능. 경쟁 서비스 개발 목적의 사용이 특히 광범위하게 금지됨.", section:"Section 5.3", title:"서비스 사용 제한" },
 { id:"TOS-6", doc:"TOS", topic:"비밀유지 (TOS)", core:"Palantir Technology는 Palantir의 기밀. Customer Data는 KT의 기밀. 해지 후 5년간 의무 존속. 영업비밀은 영구 보호", text:"Confidential Information: Palantir Technology for Palantir; Customer Data for Customer. Obligations survive termination for five (5) years; trade secrets survive in perpetuity.", translation:"Palantir의 기밀정보: Palantir Technology 및 관련 일체 정보. KT의 기밀정보: Customer Data. 비밀유지 의무는 해지 후 5년간 존속하며, 영업비밀은 영구 보호.", kt_risk:"Palantir Technology에 관한 모든 정보가 기밀정보로 분류됨. 서비스 관련 기술적 정보를 제3자에게 공유 시 위반.", section:"Section 6", title:"비밀유지 (TOS)" },
 { id:"TOS-7", doc:"TOS", topic:"비용·지급·연체이자", core:"고정 비용은 선불. 사용 기반 비용은 분기 후납. 30일 내 전신 송금. 연체 시 월 1.5% 또는 법적 최고 이율 중 낮은 쪽", text:"Fixed fees are invoiced and payable on an upfront basis. Usage-based fees are invoiced quarterly in arrears. All payments via wire transfer within thirty (30) days after invoice issuance. Late payments subject to service charge equal to the lesser of 1.5% per month or maximum interest allowed by applicable law.", translation:"고정 비용은 선불 청구·지급. 사용 기반 비용은 분기 후납. 인보이스 발행 후 30일 내 전신 송금. 연체 시 월 1.5% 또는 법적 최고 이율 중 낮은 쪽 서비스 요금 부과.", kt_risk:"월 1.5%(연 18%) 연체이자는 하도급법 고시 이율(연 15.5%)보다 높음(EC-001). 30일 지급 기한 엄수 필요.", section:"Section 7", title:"비용·지급·연체이자" },
 { id:"TOS-8.1", doc:"TOS", topic:"계약 기간 (TOS)", core:"TOS는 마지막 Order Form 만료 후 6개월까지 유효. 각 Order Form은 명시된 Order Term 동안 유효", text:"This Agreement is effective as of the Effective Date and shall continue in effect for six (6) months from the date of expiration of the last to expire Order Form, unless otherwise terminated.", translation:"이 TOS는 발효일부터 마지막 Order Form 만료일 후 6개월까지 유효하며, 별도 종료 조항에 따라 먼저 종료될 수 있다.", kt_risk:"모든 Order Form 종료 후에도 6개월간 TOS 잔존. 이 기간 동안 비밀유지·분쟁해결 등 의무 계속.", section:"Section 8.1", title:"계약 기간 (TOS)" },
 { id:"TOS-8.2", doc:"TOS", topic:"사유 해지 (30일 치유)", core:"material breach 시 30일 치유 기간 부여. 고객의 사유 해지 시 선불 비용 비례 환불", text:"Either Party may terminate for cause in the event of any material breach and failure to remedy the breach within thirty (30) days following written notice. In the event of termination by Customer for cause, Palantir shall provide a pro-rated refund of any fees pre-paid after the effective date of termination.", translation:"어느 당사자도 상대방의 material breach 발생 시 서면 통보 후 30일 치유 기간을 부여하고, 치유 안 되면 해지 가능. KT의 사유 해지 시 선불 비용 비례 환불.", kt_risk:"SAA §6.2(20일 치유)와 충돌(XC-001). 문서 우선순위상 SAA 20일 적용이 원칙이나 TOS §8.4 즉시 정지가 모두 우회 가능.", section:"Section 8.2", title:"사유 해지 (30일 치유 기간)" },
 { id:"TOS-8.3", doc:"TOS", topic:"해지 효과 (TOS)", core:"해지 시 모든 접근권 즉시 종료. 30일간 Customer Data 추출 접근 권한 부여. 이후 Palantir이 Customer Data 삭제", text:"Upon termination, all of Customer's rights, access, and licenses shall immediately cease. If requested by Customer, Customer shall have access to the Service for thirty (30) days solely for retrieving Customer Data. Palantir shall thereafter delete or render inaccessible all Customer Data.", translation:"해지·만료 시 모든 접근권 즉시 종료. KT 요청 시 30일간 Customer Data 추출 목적 접근 허용. 이후 Palantir은 Customer Data를 삭제·접근 불가 처리.", kt_risk:"30일 내 Customer Data 추출하지 못하면 Palantir이 삭제. 데이터 추출 계획 사전 수립 필요.", section:"Section 8.3", title:"해지 효과 (TOS)" },
 { id:"TOS-8.4", doc:"TOS", topic:"서비스 즉시 정지권", core:"Palantir이 합리적으로 판단·의심할 경우 사전 통보와 동시에 또는 이전에 서비스 즉시 정지 가능. 트리거: 계약 위반, 법령 위반, Palantir·타 고객에 대한 중대 위험", text:"If Palantir reasonably determines or suspects that: (a) Customer's use violates applicable law or violates a material term of this Agreement (including Sections 3.2, 4, 5.3, 6, 7, and 11), or (b) Customer's use poses a risk of material harm to Palantir or its other customers, Palantir reserves the right to disable or suspend Customer's access, subject to Palantir providing Customer notice concurrent or prior to such suspension.", translation:"Palantir이 합리적으로 (a) 법령 위반 또는 계약 material term 위반, 또는 (b) Palantir·타 고객에 대한 중대한 위험을 판단하거나 의심하는 경우, 통보와 동시 또는 이전에 서비스 전부 또는 일부를 즉시 정지할 수 있다.", kt_risk:"SAA §6.2의 20일 치유 기간을 완전히 우회하는 가장 위험한 조항. 합리적 의심이라는 낮은 기준으로 즉시 정지 가능. 대금 미지급, 보안 이슈, 계약 위반 의심 시 치유 기회 없이 서비스 중단.", section:"Section 8.4", title:"서비스 즉시 정지권" },
 { id:"TOS-9.1", doc:"TOS", topic:"Palantir IP 면책", core:"Palantir은 Palantir Technology의 지식재산권 침해 제3자 클레임에 대해 KT를 면책·방어. 단 KT의 무단 사용·수정·Acceptable Use 위반이 원인인 경우 제외", text:"Palantir shall defend Customer against any claim of IP Rights infringement based upon Customer's use of Palantir Technology in accordance with this Agreement. Obligations do not apply if Technology modified by Customer, combined with non-Palantir products, used without authorization, or in violation of Section 4.", translation:"Palantir은 KT가 계약에 따라 Palantir Technology를 사용하여 발생한 제3자의 지식재산권 침해 클레임에 대해 KT를 방어하고 면책한다. 단 KT의 무단 수정, 비Palantir 제품과의 결합, 무단 사용이 원인인 경우 제외.", kt_risk:"계약 범위 내 사용이 면책의 전제조건. KT가 서비스를 무단으로 수정하거나 Acceptable Use를 위반하면 면책 불가.", section:"Section 9.1", title:"Palantir IP 면책" },
 { id:"TOS-9.2", doc:"TOS", topic:"KT 면책 의무", core:"KT는 법률 위반·Customer Data·Acceptable Use 위반·Restrictions 위반·KT 제공 서비스로 인한 제3자 클레임에 대해 Palantir 면책", text:"Customer shall defend Palantir against any third party claim arising from: (a) Customer's violation of applicable law, (b) Customer Data, (c) breach of Section 4, (d) breach of Section 5.3, or (e) any Customer-offered product or service.", translation:"KT는 (a) 법률 위반, (b) Customer Data, (c) Acceptable Use 위반, (d) Restrictions 위반, (e) KT 제공 서비스로 인해 발생한 Palantir에 대한 제3자 클레임을 방어하고 면책해야 한다.", kt_risk:"KT의 Customer Data 관련 모든 제3자 클레임은 KT가 단독 방어. 개인정보 침해 사고 발생 시 KT가 Palantir 방어 비용까지 부담.", section:"Section 9.2", title:"KT 면책 의무" },
 { id:"TOS-10.1", doc:"TOS", topic:"Palantir 서비스 보증", core:"서비스는 문서에 따라 실질적으로 제공될 것. 전문서비스는 전문적으로 제공. 위반 시 30일 통보 후 치유 또는 해지", text:"Palantir warrants that during the Order Term, (a) the Service will be provided substantially in accordance with the applicable Documentation and (b) the Professional Services will be provided in a professional and workmanlike manner. In case of breach, Customer may give 30 days written notice of termination.", translation:"Palantir은 Order Term 동안 (a) 서비스를 문서에 따라 실질적으로 제공하고, (b) 전문서비스를 전문적·장인정신에 따라 제공할 것을 보증한다. 위반 시 KT는 30일 서면 통보 후 해지 가능.", kt_risk:"보증 위반 시 KT의 구제 수단은 해지 및 선불 비용 환불로 제한됨. 별도 손해배상 청구는 Liability Cap 적용.", section:"Section 10.1", title:"Palantir 서비스 보증" },
 { id:"TOS-12", doc:"TOS", topic:"Liability Cap (TOS, $100K)", core:"최대 책임 한도: max(Order Form 직전 12개월 지급 비용, USD $100K). 간접손해·결과적 손해 면책. SAA §8.2($10M)와 충돌", text:"Each Party's maximum aggregate liability for all claims shall not exceed the greater of (A) the fees paid in the twelve (12) months preceding the claim and (B) ONE HUNDRED THOUSAND DOLLARS (USD 100,000). If no fees are payable, maximum liability is FIFTY THOUSAND DOLLARS (USD 50,000).", translation:"각 Party의 모든 청구에 대한 최대 총 책임은 (A) 해당 Order Form의 청구 발생 전 12개월 지급 비용과 (B) USD 10만 달러 중 더 큰 금액을 초과할 수 없다. 무상 서비스의 경우 최대 USD 5만 달러.", kt_risk:"SAA §8.2($10M Cap)와 충돌(XC-002). TOS Cap이 SAA Cap의 1/100 수준. Palantir이 TOS 적용 주장 시 KT 손해배상 수령 한도 대폭 축소.", section:"Section 12", title:"TOS Liability Cap ($100K)" },
 { id:"TOS-13", doc:"TOS", topic:"준거법·중재지 (TOS)", core:"미주 외 고객은 영국법 적용, 런던 ICC 중재. SAA §9.0(한국법/서울 ICC)과 충돌", text:"If Customer is located outside of the Americas, the governing law shall be the substantive laws of England and Wales, and arbitration shall be administered in London, United Kingdom under the Rules of Arbitration of the International Chamber of Commerce.", translation:"미주 외 지역 고객(KT 포함)에 대해서는 영국 잉글랜드·웨일스 실질법이 적용되며, 런던에서 ICC 중재 규칙에 따라 중재된다.", kt_risk:"SAA §9.0(한국법/서울 ICC)과 직접 충돌(XC-003). SAA 우선 원칙상 한국법/서울 ICC가 맞으나, 분쟁 발생 시 준거법 자체가 쟁점이 될 수 있음.", section:"Section 13", title:"TOS 준거법·중재지 (영국법/런던 ICC)" },
 { id:"OF3-FEES", doc:"OF3", topic:"Enablement Program 비용", core:"총액 USD $9M (원래 $12M에서 $3M 할인). 발효일(서명일) 인보이스 발행. 30일 내 전신 송금. 이행 기간: 발효일~2026.7.21", text:"Palantir Enablement Program Total: USD $9,000,000 (discounted from $12,000,000 under OF#2). Invoice on date of signature. Payment via wire transfer within thirty (30) days after invoice issuance. Order Term: Effective Date to July 21, 2026.", translation:"Enablement Program 총액: USD $900만 (Order Form #2 파트너십 목표에 따라 $1,200만에서 $300만 할인). 서명일에 인보이스 발행. 인보이스 발행 후 30일 내 전신 송금. 이행 기간: 발효일~2026년 7월 21일.", kt_risk:"서명과 동시에 인보이스 발행. 30일 내 미지급 시 TOS §7 연체이자 적용. 할인($3M)은 OF2 파트너십 목표 달성 전제.", section:"OF3 Fees / Billing Details", title:"Enablement Program 비용 및 지급" },
 { id:"OF3-NONSOLICITATION", doc:"OF3", topic:"Non-Solicitation (4년)", core:"Palantir은 Enablement Program 3단계 이수·인증 취득 KT 직원에 대해 발효일로부터 4년간 채용 권유 금지", text:"Palantir agrees not to solicit any Partner employees who have completed the three (3) phases of the Enablement Program for four (4) years from the Effective Date. Employees who complete all three phases are considered 'Palantir Certified'.", translation:"Palantir은 Enablement Program 3단계를 이수·인증 취득한 KT 직원을 발효일로부터 4년간 채용 권유(solicitation)할 수 없다. 3단계 완료 직원은 'Palantir Certified'로 인정.", kt_risk:"Non-solicitation은 Palantir의 의무. KT→Palantir 방향 제한 없음. 인증 취득 전 퇴직 직원에는 미적용.", section:"OF3 Terms §2", title:"Non-Solicitation (4년)" },
 { id:"OF3-PROGRAM", doc:"OF3", topic:"Enablement Program 3단계 구조", core:"Phase 1 기초 훈련(2개월), Phase 2 실전 경험(7개월), Phase 3 자율 실습(3개월). Palantir 3개 팀 6명 지원", text:"Phase 1 Fundamental Training (2 months): classroom sessions, hands-on exercises, simulation projects. Phase 2 Hands-On Experience (7 months): KT engineers embedded with Palantir teams, joint delivery. Phase 3 Autonomous Practice (3 months): KT teams operate independently with Palantir in support role. Total Palantir support: 3 teams of 6 individuals.", translation:"Phase 1 기초 훈련(2개월): 강의·실습·시뮬레이션. Phase 2 실전 경험(7개월): KT 엔지니어가 Palantir 팀에 임베드되어 공동 수행. Phase 3 자율 실습(3개월): KT 팀 독립 운영, Palantir 지원 역할. Palantir 팀 3개 총 6명 지원.", kt_risk:"프로그램 구조는 high-level 개요로 변경 가능. 2026년 7월 21일 이후 지원 없음. Phase별 목표 미달성 시 다음 단계 진행 불확실.", section:"OF3 Exhibit B", title:"Enablement Program 3단계 구조" },
 { id:"OF3-HOSTING", doc:"OF3", topic:"호스팅 조건", core:"호스팅 제공자: 양사 협의로 결정. 호스팅 지역: 한국", text:"Hosting Provider: To be mutually agreed. Hosting Region: South Korea.", translation:"호스팅 제공자는 양사 합의로 결정. 호스팅 지역은 한국.", kt_risk:"호스팅 제공자 미결정 상태. 추후 합의 필요. 지역은 한국으로 확정.", section:"OF3 Terms §3-4", title:"호스팅 조건" },
 { id:"OF4-FEES", doc:"OF4", topic:"Platform License $27M / 편의해지 불가", core:"총액 USD $27M(원래 $40M). 서명 즉시 $4M, 이후 연도별 지급. 편의해지 완전 불가. SAA 해지 시 잔여 비용 ratable 지급", text:"Palantir Platform Customer License Subscription: USD $27,000,000 (discounted from $40,000,000). Payment: Upon execution $4,000,000; 12 March 2026 $5,000,000; 12 March 2027 $6,000,000; 12 March 2028 $6,000,000; 12 March 2029 $6,000,000. Customer shall have no right to terminate this Order Form #4 for convenience. In the event of termination of the SAA, remainder of Fees are ratable based on total Fee.", translation:"Customer Platform License Subscription 총액: USD $2,700만 ($4,000만에서 할인). 지급 일정: 서명 즉시 $400만, 2026.3.12 $500만, 2027 $600만, 2028 $600만, 2029 $600만. KT는 편의해지 권리 없음. SAA 해지 시 잔여 비용은 총 비용 기준 비례 지급.", kt_risk:"편의해지 완전 불가로 KT 유연성 극히 제한. SAA 해지 시에도 OF4 잔여 비용 지급 의무 존속. 즉시 $4M 지급은 예산 편성 사전 필요(EC-005).", section:"OF4 Fees / Billing Details", title:"Platform License $27M / 편의해지 불가" },
 { id:"OF4-HURDLE", doc:"OF4", topic:"Hurdle 산입 및 SAA 연동", core:"OF4 라이선스 비용 전액은 SAA Hurdle($55M)에 산입. SAA를 통해 지급. 서명 즉시 총 $27M이 Hurdle에 산입", text:"License Fees shall be attributable to the Hurdle as defined in Order Form 2 and Strategic Alliance Agreement. Upon execution of this Order Form #4, the total Fees payable will be drawn down against the Hurdle. Fee payment will be paid via the SAA.", translation:"OF4 라이선스 비용은 SAA의 Hurdle($55M) 산입 대상. 서명 즉시 OF4 총 $27M이 Hurdle에 전액 계상. 지급은 SAA를 통해 이루어짐.", kt_risk:"OF4 서명으로 Hurdle $27M이 즉시 산입되어 잔여 Hurdle 달성 목표는 $28M($55M-$27M). Hurdle 조기 달성 가능성 증가.", section:"OF4 Billing Details", title:"OF4 라이선스 Hurdle 산입" },
 { id:"OF4-CLOUD", doc:"OF4", topic:"Azure 클라우드 사용 및 초과요금", core:"PoC Azure 환경 사용. 연간 Included Usage: Y1~Y4 $5M, Y5 $7M. 초과 시 Compute/Ontology/Storage별 과금. SPC 이전 후 요율 재협의", text:"During initial usage on PoC Azure environment, Customer entitled to Included Usage per year: Y1-Y4 $5,000,000 each, Y5 $7,000,000 (14.5 months). Overage rates (Azure Seoul Region): Foundry Compute $0.00093/Compute-second, Foundry Ontology $4.310/GB-month, Foundry Storage $0.028/GB-month. Upon migration to Palantir SPC Azure, rates no longer apply and parties will mutually agree new fees.", translation:"PoC Azure 환경에서의 연간 Included Usage: 1~4년 각 $500만, 5년 $700만(14.5개월). 초과 사용 시 Seoul Region 기준: Foundry Compute $0.00093/Compute-초, Ontology $4.310/GB-월, Storage $0.028/GB-월. SPC 이전 후 요율은 양사 재협의.", kt_risk:"Included Usage 초과 시 급격한 추가 비용 발생. 사용량 모니터링 필수. SPC 이전 전까지만 현 요율 적용. CISO 보안성 승인 취득 여부 확인 필요(EC-003).", section:"OF4 Cloud Infrastructure", title:"Azure 클라우드 사용 및 초과요금" },
 { id:"OF4-SCOPE", doc:"OF4", topic:"사용 범위 및 기간", core:"KT 내부 enterprise-wide 라이선스. KT 본사만 적용(계열사·자회사 제외). Use Case 제한 없음. 기간: 2025.3.12~2030.6.30", text:"Access Scope: For Customer's internal enterprise-wide license, not restricted by use cases, for Customer only (not subsidiaries or affiliates). Order Term: 12 March 2025 to June 30, 2030.", translation:"OF4 라이선스는 KT 내부 enterprise-wide 사용에 한정. Use Case 제한 없음. KT 본사만 해당(계열사·자회사 미포함). 이행 기간: 2025년 3월 12일~2030년 6월 30일.", kt_risk:"계열사·자회사는 OF4 라이선스 미포함. 계열사 사용 시 별도 라이선스 필요. 2030년 6월 30일 만료 후 갱신 필요.", section:"OF4 Access Scope", title:"OF4 사용 범위 및 기간" },
 { id:"OF4-PRECEDENCE", doc:"OF4", topic:"OF4 우선순위", core:"OF4와 Agreement(TOS) 간 충돌 시 OF4가 우선", text:"This Order Form #4 is issued pursuant to the Palantir Terms of Service. In the event of a conflict between this Order Form and the Agreement, this Order Form shall take precedence.", translation:"OF4와 Agreement(TOS) 간 충돌 시 OF4가 우선한다.", kt_risk:"OF4가 TOS보다 우선하므로 OF4의 편의해지 불가 조항이 TOS의 해지 조항보다 강제력 높음.", section:"OF4 Terms §1", title:"OF4 우선순위" },
 { id:"REG-하도급-8조", doc:"하도급지침", topic:"대금 지급기한 (하도급)", core:"수령일로부터 60일 이내. 초과 시 공정위 고시 이율", text:"계약체결에 있어 하도급대금과 그 지급방법 등 하도급계약의 내용을 계약서에 포함하며, 단가결정 지연 시 임시단가 적용 후 소급 정산한다. 단가 조정 요청 시 30일 이내 협의 의무.", translation:"계약 체결 시 하도급대금·지급방법을 계약서에 명기. 단가 조정 요청 시 30일 이내 협의.", kt_risk:"TOS §7 월 1.5% 이자율과 하도급법 기준 이율 충돌 시 내규 우선 적용 가능성.", section:"제8조 (계약체결 시 준수사항)", title:"하도급 계약 준수사항" },
 { id:"REG-하도급-8조⑦", doc:"하도급지침", topic:"계약 해지 최고 기간", core:"중요 내용 위반 시 1개월 이상 최고 후 해지", text:"최고가 필요한 경우 계약상대방에게 1개월 이상의 기간을 정하여 그 이행을 최고하고, 그 기간 내에 이행하지 아니한 때에 해제·해지할 수 있다. 계약 해제·해지 이유에 해당하지 않는 거래정지는 가급적 2~3개월 이전에 서면으로 통보한다.", translation:"하도급법 적용 계약 해지 시 1개월 이상 최고 후 해지 가능. 일방적 거래정지는 2~3개월 전 서면 통보 권장.", kt_risk:"SAA §6.2(20일), TOS §8.2(30일)보다 긴 1개월 최고 기간. 하도급법 적용 거래에서 우선 적용 가능(EC-002).", section:"제8조⑦ / 제10조④", title:"계약 해지 최고 기간 (1개월)" },
 { id:"REG-정보보호-43조", doc:"정보보호지침", topic:"CISO 보안성 승인", core:"신규 정보시스템 구축 전 CISO 보안성 승인 필수", text:"신규 서비스 및 사업을 주관하거나 정보시스템의 구축 또는 변경을 하고자 하는 부서의 장은 반드시 CISO에게 보안성 승인을 요청하고, 검토 결과에 대한 보호조치를 취하여야 한다. CISO는 이행 미흡 시 서비스 중단을 요구할 수 있다.", translation:"신규 정보시스템 구축·변경 전 CISO 보안성 승인 필수. 미이행 시 CISO가 서비스 중단 요구 가능.", kt_risk:"Azure 클라우드 도입(OF4-CLOUD) 전 CISO 승인 없이 진행 시 내규 위반(EC-003). 분쟁 시 내부 감사 리스크 병존.", section:"제43조 (보안성 승인)", title:"신규 정보시스템 CISO 보안성 승인" },
 { id:"REG-정보보호-44조", doc:"정보보호지침", topic:"가급 정보자산 통제", core:"가급 자산 외부 유출 시 부문정보보안관리자 사전승인 필수", text:"'가'급으로 분류된 정보자산(개인정보·회사재산권·신뢰성에 커다란 손상·전사 업무수행 영향·복구에 많은 예산 요구)은 부문정보보안관리자의 사전승인 없이는 외부로 유출 또는 공개할 수 없다.", translation:"가급 정보자산은 부문정보보안관리자 사전승인 없이 외부 유출·공개 불가.", kt_risk:"고객 데이터를 Azure(OF4-CLOUD)에서 처리 시 사전승인 의무(EC-004). 미이행 시 내부 징계 및 법적 책임.", section:"제44조 (정보자산의 분류 및 통제)", title:"가급 자산 외부 제공 사전승인" },
 { id:"REG-계약-36조", doc:"계약규정", topic:"계약서 필수 기재사항", core:"계약목적·금액·이행기간·지체상금 필수 기재", text:"계약서에는 계약목적, 계약금액, 이행기간, 계약보증금, 위험부담, 지체상금, 기타 필요사항을 명기하여야 한다.", translation:"계약목적·금액·이행기간·지체상금 등 필수 기재.", kt_risk:"Palantir과의 계약에 KT 계약규정 필수 기재사항 누락 시 내부 감사에서 지적 가능.", section:"제36조 (계약서의 작성)", title:"계약서 필수 기재사항" },
 { id:"REG-계약-18조", doc:"계약규정", topic:"수의계약 집행기준", core:"특정 기술·특허·단일 공급자 해당 시 수의계약 가능", text:"수의계약이 가능한 경우: 특허품·실용신안등록품 제조·구매, 특정인의 기술이 필요하거나 해당 물품 생산자가 1인뿐인 경우, 기타 경쟁입찰이 불가능하거나 현저히 부적절한 경우.", translation:"특허품·단독 공급자·경쟁 불가 사유 시 수의계약 허용.", kt_risk:"Palantir과의 수의계약 요건 충족 여부 확인 필요. 요건 미충족 시 계약 절차 위반으로 감사 지적 가능.", section:"제18조 (수의계약 집행기준)", title:"수의계약 집행기준" },
 { id:"REG-회계-30조", doc:"회계규정", topic:"예산 집행 원칙", core:"지출은 성립된 예산 범위 내. 초과 시 재무실 사전 협의", text:"제32조: 지출은 성립된 예산의 범위 내에서 하여야 한다. 다만, 사업의 특수성 및 긴급한 사정 등으로 본조의 규정에 의하지 못할 경우에는 재무실 예산주무부서의 장과 사전 협의한 후 집행할 수 있다.", translation:"모든 지출은 성립된 예산 범위 내에서만 가능. 예산 초과 시 재무실 사전 협의 필수.", kt_risk:"OF4 서명 즉시 $4M 지급 의무가 예산 편성 없이 발생한 경우 회계규정 위반(EC-005). 재무실 사전 협의 여부 확인 필요.", section:"제30조~제32조 (지출 원칙)", title:"예산 범위 내 지출 원칙" },
 { id:"REG-협력사-4조", doc:"협력사선정지침", topic:"협력사 등록 요건", core:"신용등급 B- 이상, TL9000/ISO9001 인증 필요", text:"협력사 선정기준: 신용평가등급 B- 이상, 품질인증(TL9000 또는 ISO9001), 재무건전성 요건 충족, 기술·인력·설비 요건 충족. 협력사 등록취소 기준: 부도·파산, 계약 중대 위반 등.", translation:"신용등급 B- 이상 및 품질인증 보유 업체만 협력사 등록 가능.", kt_risk:"Palantir Korea LLC의 협력사 등록 요건 충족 여부 확인 필요. 미등록 상태에서 계약 집행 시 내부 절차 위반.", section:"제4조 (협력사 선정기준)", title:"협력사 등록 요건" },
 { id:"LAW-하도급-13조", doc:"하도급법", topic:"하도급대금 지급 의무", core:"수령일 60일 이내 지급. 연체 시 공정위 고시 이율(현행 연 15.5%) 적용", text:"원사업자는 수급사업자에게 제조 등의 위탁을 한 경우 목적물 등의 수령일(건설위탁의 경우에는 인수일)부터 60일 이내의 기간으로 정한 지급기일까지 하도급대금을 지급하여야 한다. 원사업자가 발주자로부터 준공금을 받은 경우 그 날부터 15일 이내에 하도급대금을 지급하여야 한다. 원사업자가 정당한 사유 없이 지급기일 내에 하도급대금을 지급하지 아니한 경우 지연일수에 공정거래위원회가 고시하는 이율(현행 연 15.5%)을 곱한 금액을 지급하여야 한다.", translation:"수령일로부터 60일 이내 하도급대금 지급. 준공금 수령 후 15일 이내 지급. 연체 시 공정위 고시 이율(연 15.5%) 적용.", kt_risk:"TOS §7 월 1.5%(연 18%)보다 하도급법 고시 이율(연 15.5%)이 낮음. 하도급법 적용 거래 시 KT에 유리한 이율. 하도급법 적용 여부가 핵심 선결 쟁점(EC-001).", section:"하도급거래 공정화에 관한 법률 제13조", title:"하도급대금 지급 의무" },
 { id:"LAW-하도급-16조", doc:"하도급법", topic:"부당한 계약해지 금지", core:"귀책 없는 해지 금지. 귀책 있어도 1개월 이상 서면 최고 후 해지", text:"원사업자는 수급사업자에게 책임을 돌릴 사유가 없는 데도 불구하고 계약을 해제·해지하여서는 아니 된다. 원사업자가 계약을 해제·해지할 경우 수급사업자에게 해제·해지 사유, 손해배상 내용 등을 서면으로 알려야 한다. 수급사업자에게 책임이 있는 경우에도 1개월 이상의 기간을 정하여 서면으로 최고하고 그 기간 내에 이행하지 아니한 때에 해제·해지할 수 있다.", translation:"하도급법 적용 시 계약 해지는 1개월 서면 최고 후 가능. 귀책 없는 해지 금지.", kt_risk:"Palantir이 SAA §6.2의 20일 기준으로 해지 통보 시, KT가 하도급법 제16조 1개월 최고 기간을 주장할 수 있음(EC-002). 하도급법 적용 여부가 방어 전략의 핵심.", section:"하도급거래 공정화에 관한 법률 제16조", title:"부당한 계약해지 금지" },
 { id:"LAW-하도급-25조의3", doc:"하도급법", topic:"하도급법 적용 범위", core:"원사업자→수급사업자 위탁 거래에 적용. KT-Palantir 거래 적용 여부는 법무 검토 필요", text:"이 법은 원사업자가 수급사업자에게 제조·수리·건설·용역의 위탁을 하는 경우에 적용한다. 원사업자란 중소기업자가 아닌 사업자, 또는 중소기업자 중 직전 사업연도의 연간매출액이 수급사업자의 연간매출액보다 많은 사업자를 말한다. 소프트웨어 라이선스 공급 거래가 제조·용역 위탁에 해당하는지는 거래의 실질에 따라 판단.", translation:"하도급법은 원사업자→수급사업자 위탁 거래에 적용. KT-Palantir 거래에서 어느 쪽이 원사업자인지에 따라 적용 여부 결정.", kt_risk:"KT가 Palantir에 대금 지급 시 KT가 원사업자이면 하도급법 적용 가능. 반대의 경우 적용 불가. 소프트웨어 라이선스가 용역 위탁에 해당하는지 법무 검토 필요.", section:"하도급거래 공정화에 관한 법률 제25조의3", title:"하도급법 적용 범위 및 원사업자 정의" },
 { id:"LAW-공정거래-45조", doc:"공정거래법", topic:"불공정거래행위 금지", core:"거래상 지위 남용·불이익 제공 금지. TOS §8.4 즉시 정지권의 불공정성 주장 가능", text:"사업자는 불공정한 거래방법으로 경쟁을 저해하거나 상대방의 불이익을 초래하는 행위를 하여서는 아니 된다. 거래상 지위의 남용, 부당한 계약조건 강요, 불이익 제공이 포함된다. 소프트웨어 독점 공급 계약에서 일방적 서비스 정지권(TOS §8.4)이 불공정거래행위에 해당하는지 검토 가능.", translation:"불공정한 거래 방법으로 경쟁 저해·상대방 불이익 초래 금지. TOS §8.4 즉시 정지권의 불공정거래행위 해당 여부 검토 가능.", kt_risk:"Palantir의 TOS §8.4 일방적 즉시 정지권이 거래상 지위 남용에 해당할 수 있음. 공정위 신고 또는 불공정거래행위 주장 가능성. 다만 입증 부담은 KT에 있음.", section:"독점규제 및 공정거래에 관한 법률 제45조", title:"불공정거래행위 금지" },
 { id:"LAW-민법-544조", doc:"민법", topic:"계약 해지 및 최고 절차", core:"채무불이행 시 상당 기간 최고 후 해제 가능. 이행 거절 명시 시 최고 불필요", text:"당사자 일방이 그 채무를 이행하지 아니하는 때에는 상대방은 상당한 기간을 정하여 그 이행을 최고하고 그 기간 내에 이행하지 아니한 때에는 계약을 해제할 수 있다. 그러나 채무자가 미리 이행하지 아니할 의사를 표시한 경우에는 최고를 요하지 아니한다.", translation:"채무불이행 시 상당 기간 최고 후 계약 해제 가능. 이행 거절 명시 시 최고 불필요.", kt_risk:"SAA §6.2 20일 치유 기간과 민법 상당 기간 개념 중첩. 한국법 준거 시(SAA §9.0) 민법 적용. 치유 기간 충족 없이 해지 주장 시 위법 가능성.", section:"민법 제544조 (이행지체와 해제)", title:"계약 해지 및 최고 절차" },
 ],
 conflicts: [
 { id:"XC-001", risk:"HIGH", topic:"치유 기간", summary:"SAA §6.2 (20일) vs TOS §8.2 (30일)", docs:["SAA","TOS"] },
 { id:"XC-002", risk:"HIGH", topic:"Liability Cap", summary:"SAA §8.2 ($10M) vs TOS §12 ($100K)", docs:["SAA","TOS"] },
 { id:"XC-003", risk:"HIGH", topic:"준거법·중재지", summary:"SAA §9.0 (한국법/서울) vs TOS §13 (영국법/런던)", docs:["SAA","TOS"] },
 { id:"XC-004", risk:"HIGH", topic:"서비스 즉시 정지", summary:"TOS §8.4 즉시 정지로 SAA 20일 치유 기간 우회 가능", docs:["SAA","TOS"] },
 { id:"XC-005", risk:"HIGH", topic:"해지 후 잔여 Fee", summary:"SAA §6.3 (협상) vs OF4 (ratable 기준)", docs:["SAA","OF4"] },
 { id:"IC-001", risk:"HIGH", topic:"독점 vs EBT", summary:"SAA §1.3.2 직접 판매 금지 vs §2.10 EBT 협의", docs:["SAA"] },
 { id:"IC-002", risk:"HIGH", topic:"Surviving QRC 배분", summary:"SAA §6.3 (협상) vs §2.11 (10%/90% 고정)", docs:["SAA"] },
 { id:"EC-001", risk:"HIGH", topic:"연체이자율 충돌", summary:"TOS §7 월 1.5%(연18%) vs 하도급법 제13조 공정위 고시 이율(연15.5%). 하도급법 적용 시 법령 우선.", docs:["TOS","하도급지침"] },
 { id:"EC-002", risk:"HIGH", topic:"해지 최고 기간", summary:"하도급법 제16조 1개월 vs SAA §6.2 20일 vs TOS §8.2 30일. 강행규정 적용 시 1개월 기준 우선.", docs:["SAA","TOS","하도급지침"] },
 { id:"EC-003", risk:"HIGH", topic:"CISO 보안성 승인", summary:"Azure 도입 전 CISO 승인 의무 vs OF4 즉시 사용", docs:["OF4","정보보호지침"] },
 { id:"EC-004", risk:"HIGH", topic:"가급 자산 외부 제공", summary:"정보보호지침 사전승인 vs TOS §3 데이터 처리 허용", docs:["TOS","정보보호지침"] },
 { id:"EC-005", risk:"HIGH", topic:"예산 집행 원칙", summary:"회계규정 예산 범위 내 집행 vs OF4 즉시 $4M 지급", docs:["OF4","회계규정"] },
 ],
 appendix7: ["현대자동차","기아","포스코","한화시스템","현대로템","현대글로비스","CJ제일제당","한국해양진흥공사","서울아산병원","산업통상자원부"],
};

// --- KB PATCH ENGINE ----------------------------------------------------------
function normalizeClauseKey(v) {
 return (v || "")
  .toString()
  .toLowerCase()
  .replace(/\bthe\b/g, " ")
  .replace(/\bsaa\b/g, "saa")
  .replace(/resale\s*terms?/g, "resale terms")
  .replace(/[^a-z0-9가-힣]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();
}

function buildClauseAliasMap() {
 const map = new Map();
 const add = (alias, id) => {
  const key = normalizeClauseKey(alias);
  if (!key || key.length < 4) return;
  if (!map.has(key)) map.set(key, id);
 };

 for (const c of CONTRACT_KB.clauses) {
  add(c.id, c.id);
  if (c.section) add(c.section, c.id);
  if (c.title) add(c.title, c.id);
  if (c.topic) add(c.topic, c.id);
  if (c.doc && c.section) add(`${c.doc} ${c.section}`, c.id);
  if (c.doc && c.title) add(`${c.doc} ${c.title}`, c.id);
 }

 for (const [id, ft] of Object.entries(CLAUSE_FULLTEXT || {})) {
  add(id, id);
  if (ft?.section) add(ft.section, id);
  if (ft?.title) add(ft.title, id);
  if (ft?.doc && ft?.section) add(`${ft.doc} ${ft.section}`, id);
  if (ft?.doc && ft?.title) add(`${ft.doc} ${ft.title}`, id);
 }

 // Frequent title-style aliases that do not look like numeric clause IDs.
 add("Schedule A", "SAA-APP6");
 add("Schedule A Resale Terms", "SAA-APP6");
 add("Resale Terms Appendix 6", "SAA-APP6");
 add("Resale Terms - Appendix 6", "SAA-APP6");
 add("Schedule A Resale Terms of the SAA", "SAA-APP6");
 add("Appendix 6", "SAA-APP6");
 add("Appendix 7", "SAA-APP7");
 add("Resale Terms Appendix 7", "SAA-APP7");
 add("Target Market definition", "SAA-RESA-1");
 add("Target Market means", "SAA-RESA-1");
 add("Target Market revised", "SAA-RESA-1");
 add("definition of Target Market", "SAA-RESA-1");

 return map;
}

function resolveClauseId(rawId, docHint) {
 if (!rawId) return rawId;
 const exact = CONTRACT_KB.clauses.find(c => c.id === rawId) || CLAUSE_FULLTEXT[rawId];
 if (exact) return rawId;

 const aliasMap = buildClauseAliasMap();
 const normalized = normalizeClauseKey(rawId);
 if (aliasMap.has(normalized)) return aliasMap.get(normalized);

 // Try with doc hint prepended (useful for short section titles).
 if (docHint) {
  const hinted = normalizeClauseKey(`${docHint} ${rawId}`);
  if (aliasMap.has(hinted)) return aliasMap.get(hinted);
 }

 return rawId;
}

function shouldPreserveExistingTranslation(existingText, existingTranslation, incomingTranslation, incomingFullText) {
 if (!incomingTranslation) return true;
 const current = (existingTranslation || "").trim();
 if (!current) return false;
 const original = (incomingFullText || existingText || "").trim();
 const incomingLooksSummary = isLikelySummaryTranslation(original, incomingTranslation);
 const currentLooksDetailed = !isLikelySummaryTranslation(existingText || original, current);
 return incomingLooksSummary && currentLooksDetailed;
}

function applyPatchesToKB(patches) {
 for (const p0 of patches) {
 const p = { ...p0, clauseId: resolveClauseId(p0.clauseId, p0.doc) };
 const clause = CONTRACT_KB.clauses.find(c => c.id === p.clauseId);
 if (clause) {
 if (p.changeType === "삭제") {
 clause.core = "[삭제됨] " + (p.deletionReason || clause.core);
 clause._deleted = true;
 } else {
 clause.core = p.newCore || clause.core;
 clause.topic = p.newTopic || clause.topic;
 clause._amended = true;
 clause._amendedBy = p.amendedBy;
 }
 } else if (p.changeType === "추가") {
 CONTRACT_KB.clauses.push({
 id: p.clauseId,
 doc: p.doc || "AMD",
 topic: p.newTopic || "신규 조항",
 core: p.newCore || "",
 _new: true,
 _amendedBy: p.amendedBy,
 });
 }
 if (CLAUSE_FULLTEXT[p.clauseId]) {
 const currentClauseText = CLAUSE_FULLTEXT[p.clauseId].text;
 const currentTranslation = CLAUSE_FULLTEXT[p.clauseId].translation;
 if (p.newFullText) CLAUSE_FULLTEXT[p.clauseId].text = p.newFullText;
 if (p.newTranslation && !shouldPreserveExistingTranslation(currentClauseText, currentTranslation, p.newTranslation, p.newFullText)) {
 CLAUSE_FULLTEXT[p.clauseId].translation = p.newTranslation;
 }
 if (p.newContext) CLAUSE_FULLTEXT[p.clauseId].context = p.newContext;
 CLAUSE_FULLTEXT[p.clauseId]._amended = true;
 CLAUSE_FULLTEXT[p.clauseId]._amendedBy = p.amendedBy;
 } else if (p.newFullText && p.changeType === "추가") {
 CLAUSE_FULLTEXT[p.clauseId] = {
 doc: p.doc || "AMD",
 section: p.clauseId,
 title: p.newTopic || "신규 조항",
 text: p.newFullText,
 translation: p.newTranslation || "",
 context: p.newContext || "",
 _new: true,
 _amendedBy: p.amendedBy,
 };
 }
 if (p.newConflicts) {
 for (const nc of p.newConflicts) {
 const exists = CONTRACT_KB.conflicts.find(c => c.id === nc.id);
 if (!exists) CONTRACT_KB.conflicts.push({ ...nc, _amendedBy: p.amendedBy });
 }
 }
 }
}

async function loadAndApplyStoredPatches() {
 try {
 const s = await storage.get("kb_patches_v1");
 if (s) {
 const patchHistory = JSON.parse(s);
 const allPatches = patchHistory.flatMap(h => h.patches);
 applyPatchesToKB(allPatches);
 return patchHistory;
 }
 } catch(e) { console.error("KB patch load error:", e); }
 return [];
}

// --- 이슈 유형 분류기 ----------------------------------------------------------
const ISSUE_TYPES = {
 EXCLUSIVITY: {
  label: "독점권·영업범위",
  color: "#60a5fa",
  clauses: ["SAA-1.3.1","SAA-1.3.2","SAA-1.6.8","SAA-2.10","SAA-APP6","SAA-APP7"],
  conflicts: ["XC-001","IC-001"],
  focus: `【독점권 이슈 집중 체크】
- 해당 고객이 Appendix 6(보험사) 또는 Appendix 7(Co-sell 10개사) 소속인가?
- KT가 Palantir Portal에 Opportunity Registration을 했는가?
- Palantir의 행위가 §1.3.2 직접 판매 금지 위반인가, 아니면 §2.10 EBT 범주인가?
- KT가 Target Market 외 고객에게 적극 마케팅을 했는가(§1.6.8 위반 위험)?`
 },
 PAYMENT: {
  label: "대금·Hurdle·수익배분",
  color: "#34d399",
  clauses: ["SAA-2.2","SAA-2.8","SAA-2.9","SAA-2.11","OF3-FEES","OF4-FEES","TOS-7","LAW-하도급-13조"],
  conflicts: ["XC-005","IC-002","EC-005"],
  focus: `【대금·Hurdle 이슈 집중 체크】
- 현재 누적 Net Revenue가 Hurdle($55M)을 달성했는가?
- OF4 지급 스케줄 중 미지급 항목이 있는가? 연체 기산일은?
- TOS §7 연체이자(월 1.5%)와 하도급법 고시 이율 중 어느 것이 적용되는가?
- Upstream Payment 30일 기한을 준수했는가?
- 예산 편성·재무실 사전 협의 여부(EC-005)를 확인했는가?`
 },
 SERVICE: {
  label: "서비스 정지·장애",
  color: "#f87171",
  clauses: ["TOS-8.4","SAA-6.2","TOS-8.2","OF4-CLOUD","LAW-공정거래-45조"],
  conflicts: ["XC-004","XC-001","EC-003"],
  focus: `【서비스 정지 이슈 집중 체크】
- Palantir이 TOS §8.4를 근거로 정지했는가? 정지 트리거(위반 의심/법령위반/위험)는 무엇인가?
- 정지 사전 통보가 있었는가, 동시 통보인가?
- SAA §6.2의 20일 치유 기간을 주장할 수 있는가(TOS §8.4에 의해 우회 가능)?
- 정지 원인이 KT 귀책(대금 미지급, 보안 위반)인가 Palantir 귀책인가?
- Azure 사용 관련 CISO 승인 취득 여부(EC-003)?`
 },
 TERMINATION: {
  label: "해지·계약위반",
  color: "#f59e0b",
  clauses: ["SAA-6.2","SAA-6.3","TOS-8.2","SAA-2.11","OF4-FEES"],
  conflicts: ["XC-001","XC-005","IC-002","EC-002"],
  focus: `【해지·위반 이슈 집중 체크】
- 위반 행위가 material breach에 해당하는가?
- 해지 통보 절차(서면, 기간)를 준수했는가? SAA 20일 vs TOS 30일 vs 하도급법 1개월?
- OF4 편의해지 불가 조항 — 해지 시 잔여 $27M 처리 방식은?
- Hurdle 달성 여부에 따른 SAA §6.3 적용 분기?
- Surviving QRC 수익 배분: SAA §6.3 협상 vs §2.11 고정(10/90)?`
 },
 COMPLIANCE: {
  label: "내규·승인·보안",
  color: "#c084fc",
  clauses: ["REG-정보보호-43조","REG-정보보호-44조","REG-회계-30조","REG-계약-36조","REG-하도급-8조","OF4-CLOUD","LAW-하도급-13조","LAW-하도급-16조"],
  conflicts: ["EC-001","EC-002","EC-003","EC-004","EC-005"],
  focus: `【내규 준수 이슈 집중 체크】
- 신규 정보시스템(Azure) 구축 전 CISO 보안성 승인 취득 여부(EC-003)?
- 가급 정보자산의 외부 제공 시 부문정보보안관리자 사전승인 여부(EC-004)?
- 계약 체결 시 예산 편성·재무실 사전 협의 여부(EC-005)?
- 하도급법 적용 여부 — 대금 지급 기한·이율·해지 최고 기간 준수 여부(EC-001/002)?
- 계약서 필수 기재사항 충족 여부(REG-계약-36조)?`
 },
};

// 이슈 내용 기반 기본/확장 모드 자동 감지
function detectMode(text) {
 const t = (text||"").toLowerCase();
 // 확장 모드 트리거: 내규·법령·공정거래·하도급·정보보호 관련 키워드
 const extendedKeywords = [
  "하도급", "재위탁", "재하도급",
  "개인정보", "정보보호", "정보통신망", "gdpr", "보안규정",
  "공정거래", "불공정", "공정위", "갑질", "담합",
  "하도급법", "민법", "소송", "법원", "분쟁조정",
  "내규", "사규", "계약규정", "회계규정", "협력사선정",
  "협력사 선정", "벤더 선정", "구매규정",
 ];
 return extendedKeywords.some(kw => t.includes(kw)) ? "extended" : "basic";
}

// 이슈 텍스트로 유형 추론 (키워드 기반 1차, API 2차)
function classifyIssueLocally(text) {
 const t = text;
 const scores = { EXCLUSIVITY:0, PAYMENT:0, SERVICE:0, TERMINATION:0, COMPLIANCE:0 };
 // 독점권
 if (/독점|영업|Target Market|직접.*계약|직접.*판매|Appendix|Co.sell|EBT|삼성|현대|보험/.test(t)) scores.EXCLUSIVITY += 3;
 if (/1\.3\.|1\.6\.|Opportunity|등록/.test(t)) scores.EXCLUSIVITY += 2;
 // 대금
 if (/대금|지급|Hurdle|수익|배분|Fee|청구|미납|연체|이자|예산/.test(t)) scores.PAYMENT += 3;
 if (/2\.8|2\.9|2\.11|Upstream|QRC|Net Revenue/.test(t)) scores.PAYMENT += 2;
 // 서비스 정지
 if (/정지|중단|서비스.*중단|suspend|8\.4|즉시/.test(t)) scores.SERVICE += 3;
 if (/Azure|클라우드|접근|차단/.test(t)) scores.SERVICE += 1;
 // 해지
 if (/해지|해제|termination|위반|breach|치유|20일|30일/.test(t)) scores.TERMINATION += 3;
 if (/6\.2|6\.3|편의해지|잔여/.test(t)) scores.TERMINATION += 2;
 // 내규
 if (/내규|규정|CISO|보안|승인|감사|예산|하도급|정보보호/.test(t)) scores.COMPLIANCE += 3;
 if (/EC-|제43조|제44조|제32조/.test(t)) scores.COMPLIANCE += 2;
 // 최고점 유형 반환 (동점이면 TERMINATION 우선)
 const best = Object.entries(scores).sort((a,b) => b[1]-a[1])[0];
 return best[1] > 0 ? best[0] : null;
}


// --- 유사 케이스 검색 --------------------------------------------------------
function findSimilarCases(query, issueType, history, maxCount=2) {
 if (!history || history.length === 0) return [];
 const scored = history
  .filter(h => h.result && !h.result.error)
  .map(h => {
   let score = 0;
   // 같은 이슈 유형이면 +3
   if (h.result._issueType && h.result._issueType === issueType) score += 3;
   // 쿼리 키워드 겹침
   const qWords = query.replace(/[^\w가-힣]/g, ' ').split(/\s+/).filter(w => w.length > 1);
   const hWords = (h.query||'').replace(/[^\w가-힣]/g, ' ').split(/\s+/).filter(w => w.length > 1);
   const overlap = qWords.filter(w => hWords.includes(w)).length;
   score += overlap;
   // 같은 위험도 +1
   if (h.result.risk_level === 'HIGH') score += 0.5;
   return { h, score };
  })
  .filter(x => x.score > 1)
  .sort((a, b) => b.score - a.score)
  .slice(0, maxCount);
 return scored.map(x => x.h);
}

function buildSimilarCaseContext(cases) {
 if (!cases || cases.length === 0) return '';
 return '\n\n【유사 과거 이슈 참고 — 일관된 판단 유지】\n' +
  cases.map((c, i) =>
   `[케이스 ${i+1}] ${c.ts||''} | 위험도: ${c.result.risk_level}\n` +
   `질문: ${c.query}\n` +
   `결론: ${c.result.bottom_line}\n` +
   `KT 방어: ${(c.result.kt_defense||'').slice(0,120)}...`
  ).join('\n---\n');
}


'\n'
'// 유사 케이스 검색 — 같은 issueType의 최근 3건 반환\n'
'function findSimilarCases(history, currentType, currentId) {\n'
' if (!currentType || !history || history.length === 0) return [];\n'
' return history\n'
'  .filter(h => h.id !== currentId && h.result?._issueType === currentType)\n'
'  .slice(0, 3)\n'
'  .map(h => ({\n'
'   query: h.query,\n'
'   risk_level: h.result.risk_level,\n'
'   bottom_line: h.result.bottom_line,\n'
'   ts: h.ts,\n'
'  }));\n'
'}\n'
'\n'

// --- HURDLE SNAPSHOT (storage → 프롬프트 주입용) -------------------------
function readHurdleSnapshot() {
 try {
  // _memStore는 storage.set 시 항상 동기 업데이트 → Supabase 로드 후에도 최신값 반영
  const s1 = _memStore.get("hurdle_data_v3") || localStorage.getItem("hurdle_data_v3");
  const s2 = _memStore.get("hurdle_purchase_v1") || localStorage.getItem("hurdle_purchase_v1");
  const { records = [], startYear = 2025 } = s1 ? JSON.parse(s1) : {};
  const purchased = s2 ? JSON.parse(s2) : {};
  if (records.length === 0 && !Object.values(purchased).some(Boolean)) return null;
  const fmtM = (n) => n >= 1000000 ? `$${(n/1000000).toFixed(1)}M` : `$${n.toLocaleString()}`;
  const totalRevenue = records.reduce((s, r) => s + (r.amount || 0), 0);
  const HURDLE = 55000000;
  const SCHED = [
   { year:1, amount:8000000,  bonus:0,       label:"Y1" },
   { year:2, amount:10000000, bonus:0,       label:"Y2" },
   { year:3, amount:10000000, bonus:0,       label:"Y3" },
   { year:4, amount:11000000, bonus:0,       label:"Y4" },
   { year:5, amount:11000000, bonus:5000000, label:"Y5" },
  ];
  const remaining = Math.max(0, HURDLE - totalRevenue);
  const pct = Math.min(100, (totalRevenue / HURDLE) * 100);
  const purchasedList = SCHED.filter(p => purchased[p.year]);
  const unpurchasedList = SCHED.filter(p => !purchased[p.year]);
  const CONTRACT_END = new Date("2030-05-30");
  const today = new Date();
  const monthsToEnd = Math.max(1,
   (CONTRACT_END.getFullYear()-today.getFullYear())*12+(CONTRACT_END.getMonth()-today.getMonth()));
  const requiredMonthly = remaining > 0 ? remaining / monthsToEnd : 0;
  const sorted = [...records].sort((a,b)=>a.date.localeCompare(b.date));
  const firstDate = sorted.length > 0 ? new Date(sorted[0].date) : null;
  const monthsElapsed = firstDate
   ? Math.max(1,(today.getFullYear()-firstDate.getFullYear())*12+(today.getMonth()-firstDate.getMonth())+1)
   : 0;
  const currentPace = monthsElapsed > 0 && totalRevenue > 0 ? totalRevenue / monthsElapsed : 0;

  let note = `\n\n【Hurdle 달성 현황 — 실시간 실적 데이터 (허들 탭 입력 기준)】\n`;
  note += `총 실적: ${fmtM(totalRevenue)} / Hurdle $55M의 ${pct.toFixed(1)}% 달성\n`;
  note += `잔여 목표: ${fmtM(remaining)} / 잔여 기간: ${monthsToEnd}개월 (2030.05.30 만료)\n`;
  note += `필요 월 Revenue: ${fmtM(Math.ceil(requiredMonthly))}/월`;
  if (currentPace > 0) note += ` | 현재 페이스: ${fmtM(Math.ceil(currentPace))}/월 (${currentPace >= requiredMonthly ? "목표 달성 가능" : "페이스 부족"})`;
  note += `\n`;
  if (purchasedList.length > 0) {
   note += `선구매 완료(${startYear}년 기준): `+purchasedList.map(p=>`${p.label}(${startYear+p.year-1}년 ${fmtM(p.amount)})`).join("·")+`\n`;
  }
  if (unpurchasedList.length > 0) {
   note += `선구매 미완료: `+unpurchasedList.map(p=>`${p.label}(${startYear+p.year-1}년 ${fmtM(p.amount)})`).join("·")+`\n`;
  }
  if (records.length > 0) {
   note += `개별 Revenue 실적 (${records.length}건):\n`;
   for (const r of sorted.slice(0,15)) {
    note += `  · ${r.date} ${r.customer||"미상"} [${r.customerType||""}] ${fmtM(r.amount)}`;
    if (r.note) note += ` — ${r.note}`;
    note += `\n`;
   }
   if (records.length > 15) note += `  ... 외 ${records.length-15}건\n`;
  }
  note += `▶ Hurdle 달성 여부·수익 배분·연체·해지 관련 이슈 분석 시 위 수치를 반드시 인용하여 답변하시오.\n`;
  return note;
 } catch(e) { return null; }
}

// --- PROMPT BUILDER -----------------------------------------------------------
function buildSystemPrompt(mode, amendments=[], hasRawDocs=false, issueType=null, similarCases=[]) {
 const contractDocs = ["SAA","TOS","OF3","OF4"];
 const filteredClauses = mode==="extended"
  ? CONTRACT_KB.clauses
  : CONTRACT_KB.clauses.filter(c => contractDocs.includes(c.doc));
 const clauseLines = filteredClauses.map(c => {
  const base = c.id+" / "+c.doc+" / "+c.topic+" / "+c.core;
  const detail = c.text ? " | "+c.text : "";
  const risk = c.kt_risk ? " [KT리스크: "+c.kt_risk+"]" : "";
  return base+detail+risk;
 }).join("\n");
 const filteredConflicts = mode==="extended"
  ? CONTRACT_KB.conflicts
  : CONTRACT_KB.conflicts.filter(c => !c.id.startsWith('EC-'));
 const conflictLines = filteredConflicts.map(c => c.id+" / "+c.risk+" / "+c.topic+" / "+c.summary).join("\n");
 const extNote = mode==="extended"
  ? `분석 모드: 확장. 계약+내규 전체 ${filteredClauses.length}개 조항 참조.`
  : `분석 모드: 기본. SAA/OF3/OF4/TOS ${filteredClauses.length}개 조항 참조 (내규 제외).`;
 const typeInfo = issueType && ISSUE_TYPES[issueType] ? ISSUE_TYPES[issueType] : null;
 const similarCasesText = similarCases && similarCases.length > 0
  ? `\n【유사 케이스 참고 (동일 유형 과거 이슈)】\n` + similarCases.map((c,i) => `[${i+1}] ${c.ts} | ${c.risk_level} | Q: ${c.query.slice(0,60)} | 결론: ${c.bottom_line?.slice(0,80)}`).join("\n") + `\n위 유사 케이스를 참고하여 일관된 판단 기준을 적용하시오. 단 이번 이슈의 사실관계를 독립적으로 검토할 것.`
  : "";
 // 이슈 유형별 관련 조항만 우선 추출
 const priorityClauses = typeInfo
  ? filteredClauses.filter(c => typeInfo.clauses.includes(c.id))
  : filteredClauses;
 const otherClauses = typeInfo
  ? filteredClauses.filter(c => !typeInfo.clauses.includes(c.id))
  : [];
 const priorityLines = priorityClauses.map(c => {
  const base = c.id+" / "+c.doc+" / "+c.topic+" / "+c.core;
  const detail = c.text ? " | "+c.text : "";
  const risk = c.kt_risk ? " [KT리스크: "+c.kt_risk+"]" : "";
  return base+detail+risk;
 }).join("\n");
 const otherLines = otherClauses.map(c => c.id+" / "+c.doc+" / "+c.topic+" / "+c.core).join("\n");
 const priorityConflicts = typeInfo
  ? filteredConflicts.filter(c => typeInfo.conflicts.includes(c.id))
  : filteredConflicts;
 const otherConflicts = typeInfo
  ? filteredConflicts.filter(c => !typeInfo.conflicts.includes(c.id))
  : [];
 const priorityConflictLines = priorityConflicts.map(c => c.id+" / "+c.risk+" / "+c.topic+" / "+c.summary).join("\n");
 const otherConflictLines = otherConflicts.map(c => c.id+" / "+c.risk+" / "+c.topic).join(", ");
 return `당신은 KT와 Palantir Korea LLC 간의 계약 리스크 분석 전문가입니다.
${extNote}
${hasRawDocs ? "【원문 첨부】위 messages에 계약서 원문이 첨부되어 있습니다. 조항 분석 시 반드시 원문을 직접 참조하십시오. 아래 조항 요약은 참고용입니다." : ""}
문서 우선순위: Order Form > SAA > TOS
Hurdle: USD 55,000,000 / OF3: USD 9,000,000 / OF4: USD 27,000,000 (편의해지 불가)
${readHurdleSnapshot()||""}

--------------------------------------------------
분석 전 의무 체크리스트 — 조항 적용 전 반드시 4가지 확인
--------------------------------------------------

【체크 1】 고객 범위 — 이 고객은 누구인가?
 - Target Market (Appendix 6 — 보험사 전체): 신한라이프, DB손해보험, DB생명, 현대해상화재보험, 서울보증보험,
   한화생명보험, 한화손해보험, ABL생명, 캐롯손해보험, 메리츠화재, KB손해보험, KDB생명보험, KB생명보험,
   삼성생명보험, 삼성화재보험, 하나생명보험, 하나손해보험, 미래에셋생명보험, 농협손해보험, 농협생명보험, 교보생명보험
 - Target Market (금융서비스 일반): 투자은행, 자산관리, 회계법인(내부 사용) — SAA Schedule A §1.6 정의
 - → SAA-1.3.1/1.3.2 독점권 유효. Palantir 직접 판매·파트너 선임 금지.
 - ※ DB손해보험: Palantir 기존 Pilot(장기보험 의료비 심사 자동화) 진행 중 → 해당 Pilot은 본 계약 적용 제외.
   단 KT가 Pilot 전환에 참여 시 EBT 처리 가능 (SAA Schedule A §2.9).
 - Other Market (Appendix 7 — 10개사 전체): 현대자동차, 기아, 포스코, 한화시스템, 현대로템, 현대글로비스,
   CJ제일제당, 한국해양진흥공사(KOBC), 서울아산병원, 산업통상자원부
 - → KT 영업 가능하나 SAA-1.6.1~1.6.8 Co-Sell 조건 준수 필요. 라이선스 비용은 Hurdle 미산입.
 - 계약 범위 외: 위 두 범위 모두 아닌 고객
 → Palantir 자유롭게 직접 접촉·계약 가능. SAA 위반 아님.
 → KT가 이 고객에 영업했다면 오히려 KT가 SAA-6.2 material breach

【체크 2】 행위 주체 — 누가 무엇을 했는가?
 - Palantir이 한 행위인가, KT가 한 행위인가, 아니면 제3자인가?
 - 서비스 정지: Palantir이 일방적으로 한 것인지(TOS-8.4), KT 귀책으로 정지된 것인지 먼저 확인
 - "KT가 피해자"로 결론 내리기 전에 KT에게도 책임 있는 행위가 없었는지 검토

【체크 3】 선후관계·조건 — 조항 적용 조건이 충족되었는가?
 - Hurdle ($55M) 달성 여부 확인 후 수익 배분 조항(SAA-2.11) 적용
 - OF4 편의해지 불가 조건 — 해지 논거 전개 전 반드시 확인
 - SAA-6.2 material breach 주장 시 20일 서면 통보 선행 여부 확인
 - EBT(SAA-2.10)는 Target Market 내 고객에게만 적용.

【체크 4】 문서 우선순위 — 충돌 시 어느 조항이 이기는가?
 - 일반 원칙: Order Form > SAA > TOS
 - XC-001/XC-002/XC-003/XC-004 충돌 항목 해당 시 "원칙상 SAA 우선이나 분쟁 리스크 존재"로 서술

${typeInfo ? `【${typeInfo.label} 이슈 — 핵심 조항 (전문 포함)】\n${priorityLines}` : `주요 조항 (ID/문서/주제/내용):\n${clauseLines}`}
${otherLines ? `\n참고 조항 (요약만):\n${otherLines}` : ""}

${typeInfo ? `【${typeInfo.label} 이슈 — 핵심 충돌】\n${priorityConflictLines}` : `기식별 충돌:\n${conflictLines}`}
${otherConflictLines ? `\n기타 충돌 (참고): ${otherConflictLines}` : ""}

${typeInfo ? typeInfo.focus : ""}


--------------------------------------------------
분석 품질 강화 지침 — 반드시 준수
--------------------------------------------------

【반론 선검토 원칙】
결론을 내리기 전에 반드시 KT에 불리한 논거를 먼저 검토하라.
 - KT의 행위가 계약 위반은 아닌가?
 - Palantir의 행위가 계약상 허용된 것은 아닌가?
 - 이 조항이 KT에 적용되는 조건이 충족됐는가?
반론을 먼저 확인한 후 KT 방어 논거를 구성하라.

【오류 방지 패턴 — 실제 잘못 판단된 사례】
❌ 오류 1: 계약 범위 외 고객(Appendix 6/7 미해당)에 SAA-1.3.1/1.3.2 독점권 적용
   → 독점권은 Target Market(금융·보험)과 Other Market(Appendix 7 10개사)에만 유효
   → 범위 외 고객이면 Palantir 직접 영업은 계약 위반 아님. 오히려 KT 영업이 위반 가능성
❌ 오류 2: EBT(SAA-2.10) 주장을 Target Market 외 고객에게 적용
   → EBT는 Target Market 내 고객에게만 적용. Other Market 고객에게는 적용 안 됨
❌ 오류 3: 해지 분쟁에서 OF4 잔여 Fee 충돌(XC-005)을 무조건 포함
   → OF4는 KT 내부 라이선스. 영업 범위 위반이나 서비스 정지 이슈와 직접 관련 없을 수 있음
   → 해지 원인이 OF4와 직접 연관될 때만 포함할 것
❌ 오류 4: Target Market 독점권·EBT 충돌(IC-001)을 범위 외 고객 케이스에 포함
   → EBT는 Target Market 내에서만 의미 있음. 범위 외 케이스에서 IC-001은 무관
❌ 오류 5: TOS §8.4 즉시 정지와 SAA §6.2 20일 치유 기간을 동시에 KT 방어 논거로 사용
   → 두 조항은 충돌 관계(XC-004). SAA 우선 적용 원칙이 있으나 Palantir이 TOS를 근거로
   → 즉시 정지할 경우 치유 기간 주장이 사후적으로만 가능함을 명시할 것

【충돌 조항 선별 기준】
related_conflicts에 포함하려면: 이 이슈에서 해당 충돌이 실제 결과를 바꿀 수 있는가?
 - 바꿀 수 있으면 포함, 이론적으로만 관련되면 제외
 - 관련 없는 충돌을 포함하는 것은 분석 신뢰도를 낮춤

--------------------------------------------------
위험도(risk_level) 분류 기준 — 반드시 아래 기준을 적용
--------------------------------------------------

HIGH (고위험): 다음 중 하나 이상 해당 시
- 계약 해지 사유(material breach)가 될 수 있는 행위
- 즉각적이거나 확정적인 금전 손실 발생 가능 (미지급, 위약금, 손해배상 등)
- 강행법규(하도급법, 개인정보보호법 등) 위반 리스크
- TOS §8.4 즉시 서비스 정지 트리거에 해당
- 계약 문서 간 충돌(XC/IC)이 직접 결과에 영향을 미치는 경우

MEDIUM (중위험): 다음 중 하나 이상 해당 시
- 계약 위반 리스크가 있으나 치유 가능성 존재 (20일/30일 내 시정)
- 분쟁 가능성이 있으나 협상·합의로 해결 여지 있음
- 조건부 의무사항으로 현 시점 미충족이나 즉각적 피해 없음
- 절차 위반이나 실질적 손해로 이어질 가능성이 50% 미만

LOW (저위험): 다음에 해당 시
- 직접적 계약 위반 아님 (예방적 검토, 절차 확인 수준)
- 리스크가 있으나 현재 조건 미충족으로 발동 안 됨
- KT에 명백히 유리한 상황이거나 Palantir 귀책이 명확한 경우
- 정보 확인·내부 공유 등 행정적 조치로 충분한 경우

--------------------------------------------------
출력 형식 — 아래 JSON만 출력. 다른 텍스트 절대 금지.
--------------------------------------------------

{
 "situation_summary": "한 문장 상황 요약",
 "risk_level": "HIGH 또는 MEDIUM 또는 LOW",
 "risk_reason": "위험도 판단 이유 (위 분류 기준 중 어디에 해당하는지 명시)",
 "legal_analysis": "법적 효과 분석",
 "kt_defense": "KT 방어 논거",
 "palantir_position": "Palantir 측 주장",
 "bottom_line": "핵심 결론 한 문장",
 "related_conflicts": [
  {"id": "XC-001", "relevance_level": "상", "relevance_reason": "이 이슈에서 이 충돌이 왜 직접 문제가 되는지 한 문장"}
 ],
 "triggered_clauses": [
 {"clause_id": "SAA-6.2", "doc": "SAA", "topic": "조항주제", "relevance": "관련성", "kt_position": "KT입장", "urgency": "즉시"}
 ],
 "immediate_actions": [
 {"step": "STEP 1", "timeframe": "오늘중", "action": "구체적 조치 내용", "clauses": "SAA-6.2"},
 {"step": "STEP 2", "timeframe": "3일내", "action": "구체적 조치 내용", "clauses": "SAA-6.3"},
 {"step": "STEP 3", "timeframe": "1주내", "action": "구체적 조치 내용", "clauses": "없음"}
 ]
}

【related_conflicts 선별 규칙】
- 기식별 충돌 목록 전체를 검토하여 이 이슈와 실제로 관련 있는 것만 포함. 관련 없으면 [] 출력.
- ⚠ id 필드에는 반드시 위 목록의 충돌 ID만 사용: XC-001~XC-005, IC-001~IC-002, EC-001~EC-005.
  SAA-*, TOS-*, OF-* 형식의 조항 ID를 id에 넣으면 데이터 조회 불가. 조항은 triggered_clauses에만 기입.
- relevance_level: 상(이슈 해결에 직접 영향) / 중(간접적으로 고려 필요) / 하(참고 수준)
- relevance_reason: 이 충돌이 이 이슈에서 구체적으로 어떤 문제를 일으키는지 한 문장. 일반론 금지.
- 단순히 "해지 가능성이 있으니 포함" 식의 기계적 포함 금지.

${similarCases}
【immediate_actions 필수 규칙】
- KT 유리/불리 상황 무관하게 반드시 3개 이상 출력.
- KT가 위반자인 경우: 영업 즉시 중단·증거 보전, 법무팀 보고·대응전략 수립, Palantir과 협상 또는 치유 방안 마련 등을 구체적으로 기술.
- "조치 없음" 또는 immediate_actions 빈 배열 [] 출력 금지.
'- \"조치 없음\" 또는 immediate_actions 빈 배열 [] 출력 금지.\n'
'${similarCasesText}\n'
'`;
}

// --- KT 변호인 프롬프트 -------------------------------------------------------
function buildKTLawyerPrompt(mode, amendments=[], hasRawDocs=false, issueType=null, excludeDocs=[]) {
 const contractDocs = ["SAA","TOS","OF3","OF4"];
 const filteredClauses = (mode==="extended"
  ? CONTRACT_KB.clauses
  : CONTRACT_KB.clauses.filter(c => contractDocs.includes(c.doc))
 ).filter(c => !excludeDocs.includes(c.doc));
 const filteredConflicts = mode==="extended"
  ? CONTRACT_KB.conflicts
  : CONTRACT_KB.conflicts.filter(c => !c.id.startsWith('EC-'));
 // excludeDocs 안내 (TOS 제외 시 명시)
 const excludeNote = excludeDocs.length > 0 ? `\n※ 이 분석은 ${excludeDocs.join("/")} 제외. 해당 문서는 별도 TOS 분석에서 다룸.` : "";
 const typeInfo = issueType && ISSUE_TYPES[issueType] ? ISSUE_TYPES[issueType] : null;
 const priorityClauses = typeInfo ? filteredClauses.filter(c => typeInfo.clauses.includes(c.id)) : filteredClauses;
 const otherClauses = typeInfo ? filteredClauses.filter(c => !typeInfo.clauses.includes(c.id)) : [];
 const priorityLines = priorityClauses.map(c => {
  const base = c.id+" / "+c.doc+" / "+c.topic+" / "+c.core;
  const detail = c.text ? " | "+c.text : "";
  const risk = c.kt_risk ? " [KT리스크: "+c.kt_risk+"]" : "";
  return base+detail+risk;
 }).join("\n");
 const otherLines = otherClauses.map(c => c.id+" / "+c.doc+" / "+c.topic+" / "+c.core).join("\n");
 const priorityConflicts = typeInfo ? filteredConflicts.filter(c => typeInfo.conflicts.includes(c.id)) : filteredConflicts;
 const otherConflicts = typeInfo ? filteredConflicts.filter(c => !typeInfo.conflicts.includes(c.id)) : [];
 const priorityConflictLines = priorityConflicts.map(c => c.id+" / "+c.risk+" / "+c.topic+" / "+c.summary).join("\n");
 const otherConflictLines = otherConflicts.map(c => c.id+" / "+c.risk+" / "+c.topic).join(", ");
 const amendNote = amendments.length > 0
  ? "\n【Amendment 반영】\n" + amendments.map(a => `${a.amendedBy}: ${(a.patches||[]).map(p=>p.clauseId).join(", ")} 수정`).join("\n")
  : "";
 return `당신은 KT 법무팀 전속 변호인입니다. 아래 이슈에서 KT에게 최대한 유리한 법적 전략과 논거를 구성하시오.
목표: KT의 권리를 최대화하고, 법적 리스크를 최소화하며, 협상에서 유리한 포지션을 확보할 것.${excludeNote}
${hasRawDocs ? "【원문 첨부】계약서 원문이 첨부되어 있습니다. 조항 해석 시 원문을 우선 참조하십시오." : ""}
문서 우선순위: Order Form > SAA > TOS
Hurdle: USD 55,000,000 / OF3: USD 9,000,000 / OF4: USD 27,000,000 (편의해지 불가)
${readHurdleSnapshot()||""}${amendNote}

【계약 문서 구조 (필수 이해 — 분석 전 반드시 확인)】
■ SAA: KT-Palantir 파트너십 계약 본체이자 리셀러 계약(OF2, 라이선스 선구매)의 근거 계약.
  KT가 Palantir 라이선스를 Target Market 고객에게 재판매할 독점권 및 Hurdle($55M) 달성 의무의 기준.
■ OF2(리셀 라이선스, SAA 내 포함): KT→고객 재판매용 라이선스 선구매 계약. Hurdle 달성의 기준이 되는 물량.
■ OF3($9M, 용역계약): Palantir 엔지니어를 KT가 직접 활용하는 엔지니어링 서비스 계약.
  Hurdle($55M) 산입 대상 아님. 서비스 제공·사용 이슈는 이 계약 기준으로 판단.
■ OF4($27M, 내부 라이선스): KT가 Palantir 라이선스를 KT 내부 업무에 사용하기 위한 계약. 편의해지 불가.
  ★ 핵심: OF4 구매 물량은 SAA 내 리셀 라이선스(OF2)에서 차감 가능.
  즉 KT가 OF4로 내부 사용한 만큼 재판매 가능한 라이선스 물량이 감소함. 이슈 분석 시 이 차감 관계를 반드시 고려할 것.

【계약 구조 파악 (필수 확인)】
① 이슈 관련 문서 식별: 이슈가 SAA(리셀·파트너십), OF3(엔지니어 용역), OF4(내부 라이선스) 중 어디에 해당하는지 먼저 판단
② 고객 범위:
 - Target Market (Appendix 6 — 보험·금융): 신한라이프, DB손해보험, DB생명, 현대해상화재보험, 서울보증보험, 한화생명, 한화손해보험, ABL생명, 캐롯손해보험, 메리츠화재, KB손해보험, KDB생명, KB생명, 삼성생명, 삼성화재, 하나생명, 하나손해보험, 미래에셋생명, 농협손해보험, 농협생명, 교보생명 (삼성 그룹사 제외) → SAA-1.3.1/1.3.2 독점권 유효
 - Other Market (Appendix 7, AMD No.1 반영): 포스코인터내셔널, 포스코퓨처엠, 포스코, 대한항공, 한화시스템, GS리테일, GS칼텍스, 현대글로비스, LS일렉트릭, 셀트리온, 포스코이앤씨, 포스코DX, 포스코플로우 → Co-Sell 조건 준수, Hurdle 미산입
 - 범위 외: Palantir 자유 영업 가능. SAA 위반 아님.
③ 행위 주체: KT 귀책인지 Palantir 귀책인지 확인
④ 조건 충족: Hurdle 달성 여부, 20일 치유기간 선행 여부, EBT Target Market 적용 여부
⑤ OF4 차감 여부: OF4 내부 사용 물량이 리셀 가용 물량에 영향을 미치는지 확인
⑥ 문서 우선순위: Order Form > SAA > TOS

${typeInfo ? `【${typeInfo.label} 이슈 — 핵심 조항】\n${priorityLines}` : `주요 조항:\n${priorityLines}`}
${otherLines ? `\n참고 조항:\n${otherLines}` : ""}
${typeInfo ? `\n【핵심 충돌】\n${priorityConflictLines}` : `\n기식별 충돌:\n${priorityConflictLines}`}
${otherConflictLines ? `기타 충돌: ${otherConflictLines}` : ""}

【KT 변호인 전략 수립 지침】
1) 유리한 조항 해석: 동일 조항도 KT에 유리하게 해석할 수 있는 각도를 발굴하라
2) 절차적 하자 확인: Palantir이 절차(서면통보, 치유기간 등)를 위반했는지 확인
3) 협상 레버리지: KT가 협상에서 쓸 수 있는 카드(OF4 편의해지 불가, Hurdle 조건, 독점권 등)를 발굴하라
4) 선제적 행동: 수동적 방어가 아닌 KT가 먼저 취할 수 있는 행동
5) 법적 근거 강화: 가장 강력한 조항 근거 2-3개 중심으로 논거 구성
6) Palantir 절차 하자: Palantir이 SAA/TOS 절차를 위반했다면 반격 포인트로 활용

출력 형식 — 아래 JSON만 출력. 다른 텍스트 절대 금지.
{
 "defense_summary": "KT 핵심 방어 논거 (2-3문장, 구체적 조항 인용 필수)",
 "leverage_points": ["협상 레버리지 1 (근거 조항 포함)", "레버리지 2", "레버리지 3"],
 "favorable_interpretations": ["KT에 유리한 조항 해석 각도 1", "해석 2"],
 "procedural_defenses": ["Palantir 절차 하자 또는 KT 절차 준수 논거 1", "논거 2"],
 "preemptive_actions": ["KT가 선제적으로 취할 수 있는 행동 1", "행동 2"],
 "relevant_clauses": ["SAA-6.2", "SAA-2.11"],
 "kt_core_argument": "KT 핵심 주장 한 문장 (가장 강력한 논거)"
}`;
}

// --- Palantir 변호인 프롬프트 -------------------------------------------------
function buildPalantirLawyerPrompt(query, issueType=null) {
 return `당신은 Palantir Korea LLC 법무팀 변호인입니다. 아래 KT-Palantir 계약 이슈에서 Palantir 측에 가장 유리한 법적 논거와 대응 전략을 구성하시오.

【계약 문서 구조 (필수 이해)】
- SAA: KT-Palantir 파트너십 계약 본체. 리셀러 계약(OF2, 라이선스 선구매)이 SAA 내에 포함됨. TOS가 SAA에 통합됨.
- OF2(리셀 라이선스, SAA 내): KT→고객 재판매용 라이선스. Hurdle($55M) 달성의 기준 물량.
- OF3($9M, 용역): Palantir 엔지니어를 KT가 사용하는 용역계약. Hurdle 산입 대상 아님.
- OF4($27M, 내부 라이선스): KT 내부 업무용 Palantir 라이선스. 편의해지 불가.
  ★ OF4 구매 물량은 SAA 리셀 라이선스(OF2)에서 차감 가능 — KT 내부 사용분만큼 재판매 가능 물량 감소.
- Hurdle $55M: KT가 고객에게 $55M 이상 판매(OF2 기준)해야 수익배분 조건 발동. 미달 시 Palantir 수익배분 의무 없음.
- TOS §8.4: Palantir은 미결제 30일 초과·AUP 위반·법령 위반 시 서비스 즉시 정지 가능 (치유기간 불필요).
- SAA §6.2: Material breach 시 20일 서면통보 후 해지 가능. 단 TOS §8.4는 즉시 발동.
- SAA §2.11: Hurdle 달성 시 수익배분 — KT 10% / Palantir 90% (고정). 달성 전 배분 의무 없음.
- SAA §1.3.1/1.3.2: KT 독점권은 Target Market(보험·금융, AMD No.1 반영)에만 적용. Other Market(Appendix 7, AMD No.1: 포스코계열·대한항공·GS계열 등 13개사) 및 범위 외 고객은 Palantir 자유 영업.
- 문서 우선순위: Order Form > SAA > TOS

【이슈】
${query}

【Palantir 변호인 전략 지침】
1) Palantir에 가장 유리한 계약 해석을 찾아라
2) KT 논거의 가장 취약한 부분을 공략하라 (적용 조건 미충족, 범위 오류, 절차 하자 등)
3) 실제 법정/협상에서 Palantir이 제기할 수 있는 가장 강력한 주장에만 집중하라
4) KT의 절차적 위반·의무 불이행도 포함하라

출력 형식 — 아래 JSON만 출력. 다른 텍스트 절대 금지.
{
 "strongest_arguments": ["Palantir 가장 강력한 논거 1 (구체적 조항 근거 포함)", "논거 2", "논거 3"],
 "clause_basis": ["TOS-8.4", "SAA-6.2"],
 "kt_weaknesses": ["KT 논거의 가장 취약한 부분 1", "약점 2"],
 "counter_strategy": "Palantir 예상 대응 전략 요약 (2-3문장, 구체적 행동 포함)"
}`;
}

// --- 판사 프롬프트 -------------------------------------------------------------
function buildJudgePrompt(query, ktStrategy, palantirCase, mode, issueType=null, similarCases=[]) {
 const toA = (arr) => Array.isArray(arr) && arr.length > 0 ? "- " + arr.join("\n- ") : "- (없음)";
 const conflictList = CONTRACT_KB.conflicts.map(c => c.id+" / "+c.risk+" / "+c.topic+" / "+c.summary).join("\n");
 const similarCasesText = similarCases && similarCases.length > 0
  ? `\n【유사 케이스 참고】\n` + similarCases.map((c,i) => `[${i+1}] ${c.ts} | ${c.risk_level} | Q: ${c.query.slice(0,60)} | 결론: ${c.bottom_line?.slice(0,80)}`).join("\n") + `\n위 케이스를 참고하되 이번 이슈를 독립적으로 검토할 것.`
  : "";
 return `당신은 KT-Palantir Korea LLC 계약 분쟁 최종 심의 전문가입니다.
양측 변호인의 논거를 모두 검토하고 최종 확정 분석을 도출하시오.

【계약 문서 구조 (판단 전 반드시 확인)】
- SAA: KT-Palantir 파트너십 및 리셀러 계약(OF2) 본체. KT의 Target Market 독점 재판매권 근거.
- OF2(SAA 내 포함): KT→고객 재판매용 라이선스 선구매. Hurdle($55M) 산정 기준.
- OF3($9M): Palantir 엔지니어 용역계약. KT가 Palantir 인력을 사용. Hurdle 산입 대상 아님.
- OF4($27M): KT 내부 업무용 라이선스. 편의해지 불가. OF4 사용 물량은 OF2 리셀 가용 물량에서 차감 가능.
  → 이슈가 어느 계약에 해당하는지 먼저 식별한 후 판단할 것. OF3과 OF4는 목적과 구조가 근본적으로 다름.
- 문서 우선순위: Order Form(OF3·OF4) > SAA > TOS

【이슈】
${query}
${readHurdleSnapshot()||""}

【KT 측 논거】
핵심 방어: ${ktStrategy.defense_summary||"-"}
협상 레버리지:
${toA(ktStrategy.leverage_points)}
유리한 조항 해석:
${toA(ktStrategy.favorable_interpretations)}
절차적 방어:
${toA(ktStrategy.procedural_defenses)}
선제 행동:
${toA(ktStrategy.preemptive_actions)}
핵심 주장: ${ktStrategy.kt_core_argument||"-"}

【Palantir 측 논거】
가장 강력한 반론:
${toA(palantirCase.strongest_arguments)}
KT 논거 약점:
${toA(palantirCase.kt_weaknesses)}
Palantir 대응 전략: ${palantirCase.counter_strategy||"-"}

【판단 원칙】
- 양측 논거를 균형 있게 검토하되 KT 실무팀이 즉시 활용할 수 있는 방향으로 판단할 것
- KT 변호인의 유리한 해석 중 법적으로 타당한 것은 kt_defense에 충실히 반영할 것
- Palantir 논거 중 실제 위협이 되는 것은 위험도 판단과 palantir_position에 반영할 것
- ⚠ 출력 필드에 "변호인", "판사", "1차", "2차", "단계" 등 내부 프로세스 용어 절대 금지

【기식별 충돌 목록 (related_conflicts 선별용)】
${conflictList}
⚠ related_conflicts.id는 위 XC-*/IC-*/EC-* ID만 사용. SAA-*, TOS-* 등 조항 ID 사용 금지.

【위험도 분류 기준】
HIGH: material breach 가능 / 즉각 금전손실 / 강행법규 위반 / 서비스 즉시 정지 트리거
MEDIUM: 치유 가능 / 협상 여지 / 조건 미충족으로 즉각 피해 없음
LOW: 직접 위반 아님 / 예방적 수준 / KT에 명백히 유리
${similarCasesText}

출력 형식 — 아래 JSON만 출력. 다른 텍스트 절대 금지.
{
 "situation_summary": "한 문장 상황 요약",
 "risk_level": "HIGH 또는 MEDIUM 또는 LOW",
 "risk_reason": "위험도 판단 이유 (위 분류 기준 중 해당 항목 명시)",
 "legal_analysis": "법적 효과 분석",
 "kt_defense": "KT 방어 논거 (KT 변호인 논거 기반 정제, 구체적 조항 인용 필수)",
 "palantir_position": "Palantir 측 주장 (Palantir 변호인 논거 기반)",
 "bottom_line": "핵심 결론 한 문장",
 "related_conflicts": [
  {"id": "XC-001", "relevance_level": "상", "relevance_reason": "이 충돌이 이슈에서 왜 직접 문제인지 한 문장"}
 ],
 "triggered_clauses": [
  {"clause_id": "SAA-6.2", "doc": "SAA", "topic": "조항주제", "relevance": "관련성", "kt_position": "KT입장", "urgency": "즉시"}
 ],
 "immediate_actions": [
  {"step": "STEP 1", "timeframe": "오늘중", "action": "구체적 조치 내용", "clauses": "SAA-6.2"},
  {"step": "STEP 2", "timeframe": "3일내", "action": "구체적 조치 내용", "clauses": "SAA-6.3"},
  {"step": "STEP 3", "timeframe": "1주내", "action": "구체적 조치 내용", "clauses": "없음"}
 ]
}
【immediate_actions 규칙】 반드시 3개 이상 출력. "조치 없음" 또는 빈 배열 [] 출력 금지.`;
}

// --- TOS 전용 분석 프롬프트 ---------------------------------------------------
function buildTOSPrompt(query, issueType=null) {
 const tosClauses = CONTRACT_KB.clauses.filter(c => c.doc === "TOS");
 const clauseLines = tosClauses.map(c => {
  const base = c.id + " / " + c.topic + " / " + c.core;
  const detail = c.text ? " | " + c.text : "";
  const risk = c.kt_risk ? " [KT리스크: " + c.kt_risk + "]" : "";
  return base + detail + risk;
 }).join("\n");
 return `당신은 KT-Palantir 계약 전문가입니다.
SAA+OF3+OF4 기반 핵심 분석은 이미 완료됐습니다. TOS(Terms of Service)가 이 이슈에 추가적으로 미치는 영향만 분석하시오.

【이슈】
${query}

【TOS 조항 전체】
${clauseLines}

【분석 지침】
- SAA/OF3/OF4와 중복되는 내용은 제외하고 TOS에서만 발생하는 추가 리스크에 집중
- TOS가 이슈에 영향을 미치지 않으면 has_risk: false로 명시
- KT에 유리한 TOS 조항 해석도 포함할 것
- triggered_clauses는 실제 이슈와 관련 있는 TOS 조항만 포함 (관련 없으면 빈 배열)

출력 형식 — JSON만. 다른 텍스트 절대 금지.
{
 "has_risk": true,
 "summary": "TOS 추가 리스크 한 줄 요약 (없으면 '이슈에 TOS 추가 리스크 없음')",
 "triggered_clauses": [
  {"clause_id": "TOS-X.X", "topic": "조항 주제", "additional_risk": "추가 리스크 설명", "kt_position": "KT 방어/유리한 해석"}
 ],
 "kt_tos_defense": "TOS 조항 전반에 대한 KT 핵심 방어 포인트 (없으면 빈문자열)"
}`;
}

// --- REPORT -------------------------------------------------------------------
// 리포트 HTML용 텍스트 포맷터: 1)/2) → 줄바꿈, \n → <br>
function fmtArgHTML(text) {
 if (!text) return "";
 return text
  .replace(/(^|\n)\s*([0-9]+)\)\s+/g, (_, nl, n) => `${nl ? "<br>" : ""}<b>${n})</b> `)
  .replace(/\n/g, "<br>");
}

function buildReportHTML(query, result, mode) {
 const RC = { HIGH:"#C0392B", MEDIUM:"#E67E22", LOW:"#1E7E34", NONE:"#2980B9" };
 const RB = { HIGH:"#FDF2F2", MEDIUM:"#FFFBF0", LOW:"#F0FAF4", NONE:"#EEF4FB" };
 const RL = { HIGH:"위험", MEDIUM:"주의", LOW:"양호", NONE:"검토" };
 const rl = (result.risk_level||"NONE").toUpperCase();
 const rc = RC[rl]||RC.NONE;
 const rb = RB[rl]||RB.NONE;
 const ts = new Date().toLocaleString("ko-KR");
 const STEP_COLORS = ["#C0392B","#E67E22","#2980B9","#27AE60","#8E44AD"];
 const kts = result._ktStrategy||{};
 const pal = result._palantirCase||{};

 // ── helpers ──────────────────────────────────────────────────
 function appHeader(label, desc) {
  return '<div style="background:#0f172a;color:#fff;padding:18px 40px;margin:0 -40px 24px">'
   +'<div style="font-size:14px;font-weight:800;letter-spacing:.04em">'+label+'</div>'
   +(desc?'<div style="font-size:11px;color:#94a3b8;margin-top:4px">'+desc+'</div>':'')
   +'</div>';
 }
 function bulletList(items, color) {
  if (!items||!items.length) return '<div style="font-size:12px;color:#94a3b8">해당 없음</div>';
  return items.map(function(p,i){
   return '<div style="display:flex;gap:10px;align-items:flex-start;padding:9px 0;'+(i>0?'border-top:1px solid #f1f5f9':'')+'">'
    +'<span style="min-width:20px;height:20px;border-radius:50%;background:'+color+'18;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:'+color+';flex-shrink:0;margin-top:1px">'+(i+1)+'</span>'
    +'<span style="font-size:12px;color:#334155;line-height:1.7">'+p+'</span>'
    +'</div>';
  }).join("");
 }
 function pageBreak() { return '<div style="page-break-before:always;padding-top:32px;margin-top:0"></div>'; }
 function footer(label) {
  return '<div style="margin-top:40px;padding-top:12px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;font-size:10px;color:#94a3b8;font-family:JetBrains Mono,monospace">'
   +'<span>'+label+'</span><span>'+ts+'</span></div>';
 }

 // ── 별첨 A: KT 방어 전략 ──────────────────────────────────────
 let appA = "";
 appA += '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-left:4px solid #2563eb;border-radius:8px;padding:14px 18px;margin-bottom:18px">'
  +'<div style="font-size:10px;font-weight:700;color:#1d4ed8;letter-spacing:.08em;margin-bottom:6px">KT 핵심 방어 논거</div>'
  +'<div style="font-size:13px;color:#1e3a8a;line-height:1.8">'+fmtArgHTML(kts.defense_summary||result.kt_defense||"—")+'</div>'
  +'</div>';
 if ((kts.leverage_points||[]).length) {
  appA += '<div style="margin-bottom:18px"><div style="font-size:10px;font-weight:800;color:#64748b;letter-spacing:.1em;margin-bottom:10px;padding-bottom:5px;border-bottom:1px solid #e2e8f0">협상 레버리지 포인트</div>'
   +bulletList(kts.leverage_points,"#2563eb")+'</div>';
 }
 if ((kts.favorable_interpretations||[]).length) {
  appA += '<div style="margin-bottom:18px"><div style="font-size:10px;font-weight:800;color:#64748b;letter-spacing:.1em;margin-bottom:10px;padding-bottom:5px;border-bottom:1px solid #e2e8f0">유리한 조항 해석 각도</div>'
   +bulletList(kts.favorable_interpretations,"#10b981")+'</div>';
 }
 if ((kts.procedural_defenses||[]).length) {
  appA += '<div style="margin-bottom:18px"><div style="font-size:10px;font-weight:800;color:#64748b;letter-spacing:.1em;margin-bottom:10px;padding-bottom:5px;border-bottom:1px solid #e2e8f0">절차적 방어 / Palantir 하자</div>'
   +bulletList(kts.procedural_defenses,"#f59e0b")+'</div>';
 }
 if ((kts.preemptive_actions||[]).length) {
  appA += '<div style="margin-bottom:18px"><div style="font-size:10px;font-weight:800;color:#64748b;letter-spacing:.1em;margin-bottom:10px;padding-bottom:5px;border-bottom:1px solid #e2e8f0">KT 선제적 행동</div>'
   +bulletList(kts.preemptive_actions,"#f59e0b")+'</div>';
 }

 // ── 별첨 B: Palantir 예상 반론 ────────────────────────────────
 let appB = "";
 appB += '<div style="background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #dc2626;border-radius:8px;padding:14px 18px;margin-bottom:18px">'
  +'<div style="font-size:10px;font-weight:700;color:#991b1b;letter-spacing:.08em;margin-bottom:6px">Palantir 측 논거 (판사 정제)</div>'
  +'<div style="font-size:13px;color:#7f1d1d;line-height:1.8">'+fmtArgHTML(result.palantir_position||"—")+'</div>'
  +'</div>';
 if ((pal.strongest_arguments||[]).length) {
  appB += '<div style="margin-bottom:18px"><div style="font-size:10px;font-weight:800;color:#64748b;letter-spacing:.1em;margin-bottom:10px;padding-bottom:5px;border-bottom:1px solid #e2e8f0">가장 강력한 반론</div>'
   +bulletList(pal.strongest_arguments,"#dc2626")+'</div>';
 }
 if ((pal.kt_weaknesses||[]).length) {
  appB += '<div style="margin-bottom:18px"><div style="font-size:10px;font-weight:800;color:#64748b;letter-spacing:.1em;margin-bottom:10px;padding-bottom:5px;border-bottom:1px solid #e2e8f0">KT 논거 취약점</div>'
   +bulletList(pal.kt_weaknesses,"#f59e0b")+'</div>';
 }
 if (pal.counter_strategy) {
  appB += '<div style="margin-bottom:18px"><div style="font-size:10px;font-weight:800;color:#64748b;letter-spacing:.1em;margin-bottom:10px;padding-bottom:5px;border-bottom:1px solid #e2e8f0">Palantir 예상 대응 전략</div>'
   +'<div style="font-size:12px;color:#334155;line-height:1.75">'+fmtArgHTML(pal.counter_strategy)+'</div>'
   +'</div>';
 }

 // ── 별첨 C: 즉시 조치사항 ─────────────────────────────────────
 let appC = "";
 (result.immediate_actions||[]).forEach(function(a, i) {
  const col = STEP_COLORS[i % STEP_COLORS.length];
  const clauses = (a.clauses||"").split(",").map(function(s){return s.trim();}).filter(Boolean);
  const clauseTags = clauses.map(function(c){
   return '<span style="font-size:9px;font-weight:700;color:'+col+';background:'+col+'18;border:1px solid '+col+'44;border-radius:3px;padding:1px 7px;margin-right:4px">'+c+'</span>';
  }).join("");
  appC += '<div style="display:flex;gap:12px;padding:14px 16px;background:#fff;border:1px solid #e9ecef;border-radius:8px;margin-bottom:10px;border-left:4px solid '+col+'">'
   +'<div style="min-width:52px;text-align:center;flex-shrink:0">'
   +'<div style="font-size:9px;font-weight:800;color:'+col+';background:'+col+'18;border-radius:4px;padding:3px 6px;margin-bottom:4px">'+(a.step||("STEP "+(i+1)))+'</div>'
   +'<div style="font-size:9px;color:#64748b;line-height:1.3">'+(a.timeframe||"")+'</div>'
   +'</div>'
   +'<div style="flex:1">'
   +'<div style="font-size:13px;color:#1e293b;line-height:1.75">'+(a.action||"")+'</div>'
   +(clauses.length?'<div style="margin-top:8px">'+clauseTags+'</div>':"")
   +'</div></div>';
 });

 // ── 별첨 D: 관련 조항 요약 ───────────────────────────────────
 let appD = "";
 (result.triggered_clauses||[]).forEach(function(c) {
  const urgColor = c.urgency==="즉시"?"#C0392B":c.urgency==="단기"?"#E67E22":"#2980B9";
  appD += '<div style="border:1px solid #e2e8f0;border-radius:8px;margin-bottom:12px;overflow:hidden">'
   +'<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0">'
   +'<span style="font-size:12px;font-weight:800;color:#1e293b;font-family:monospace">'+(c.clause_id||c.id||"")+'</span>'
   +'<span style="font-size:10px;color:#64748b">'+(c.doc||"")+'</span>'
   +'<span style="margin-left:auto;font-size:9px;font-weight:700;color:'+urgColor+';background:'+urgColor+'18;border-radius:3px;padding:2px 7px;border:1px solid '+urgColor+'44">'+(c.urgency||"")+'</span>'
   +'</div>'
   +'<div style="padding:10px 14px">'
   +'<div style="font-size:12px;font-weight:600;color:#334155;margin-bottom:6px">'+(c.topic||"")+'</div>'
   +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
   +'<div><div style="font-size:9px;font-weight:700;color:#94a3b8;margin-bottom:3px">관련성</div><div style="font-size:12px;color:#475569;line-height:1.6">'+(c.relevance||"")+'</div></div>'
   +'<div><div style="font-size:9px;font-weight:700;color:#94a3b8;margin-bottom:3px">KT 입장</div><div style="font-size:12px;color:#475569;line-height:1.6">'+(c.kt_position||"")+'</div></div>'
   +'</div></div></div>';
 });

 // ── 별첨 E: 조항 원문 전문 ───────────────────────────────────
 let appE = "";
 (result.triggered_clauses||[]).forEach(function(c) {
  const cid = c.clause_id||c.id||"";
  const ft = (typeof CLAUSE_FULLTEXT !== "undefined") ? CLAUSE_FULLTEXT[cid] : null;
  appE += '<div style="margin-bottom:32px;break-inside:avoid">'
   +'<div style="display:flex;align-items:baseline;gap:10px;border-bottom:2px solid '+rc+';padding-bottom:6px;margin-bottom:12px">'
   +'<span style="font-size:15px;font-weight:800;color:#1e293b;font-family:monospace">'+cid+'</span>'
   +'<span style="font-size:11px;color:#64748b">'+(c.doc||"")+" · "+(c.topic||"")+'</span>'
   +'</div>';
  if (ft) {
   appE += '<div style="background:#fffdf5;border:1px solid #fde68a;border-radius:6px;padding:14px 16px;margin-bottom:12px">'
    +'<div style="font-size:9px;font-weight:700;color:#92400e;letter-spacing:.08em;margin-bottom:6px">원문 (ORIGINAL)</div>'
    +'<div style="font-size:12px;color:#1e293b;line-height:1.9;white-space:pre-wrap;font-family:monospace">'+(ft.text||"")+'</div>'
    +'</div>';
   if (ft.translation) appE += '<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:14px 16px;margin-bottom:12px">'
    +'<div style="font-size:9px;font-weight:700;color:#075985;letter-spacing:.08em;margin-bottom:6px">한국어 번역</div>'
    +'<div style="font-size:12px;color:#1e293b;line-height:1.9">'+ft.translation+'</div>'
    +'</div>';
   if (ft.context) appE += '<div style="background:#fafafa;border:1px solid #e5e7eb;border-radius:6px;padding:12px 14px">'
    +'<div style="font-size:9px;font-weight:700;color:#6b7280;letter-spacing:.08em;margin-bottom:4px">실무 해석</div>'
    +'<div style="font-size:12px;color:#374151;line-height:1.7">'+ft.context+'</div>'
    +'</div>';
  } else {
   appE += '<div style="padding:12px 14px;background:#f8f9fa;border-radius:6px;font-size:12px;color:#64748b">'
    +'<div style="margin-bottom:6px"><strong>관련성:</strong> '+(c.relevance||"")+'</div>'
    +'<div><strong>KT 입장:</strong> '+(c.kt_position||"")+'</div>'
    +'</div>';
  }
  appE += '</div>';
 });

 // ── 충돌 태그 ────────────────────────────────────────────────
 let conflictsHTML = "";
 (result.related_conflicts||[]).forEach(function(c) {
  const cid2 = c.id||c;
  const lvl2 = c.relevance_level?' ('+c.relevance_level+')':'';
  conflictsHTML += '<span style="font-size:10px;font-weight:700;color:#7c3aed;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:4px;padding:2px 9px;margin-right:5px;margin-bottom:4px;display:inline-block">'+cid2+lvl2+'</span>';
 });

 // ── 별첨 목차 ────────────────────────────────────────────────
 const appendixTOC = [
  {label:"별첨 A", title:"KT 방어 전략", has:true},
  {label:"별첨 B", title:"Palantir 예상 반론", has:true},
  {label:"별첨 C", title:"즉시 조치사항", has:(result.immediate_actions||[]).length>0},
  {label:"별첨 D", title:"관련 조항 요약", has:(result.triggered_clauses||[]).length>0},
  {label:"별첨 E", title:"조항 원문 전문", has:appE.length>0},
 ].filter(function(x){return x.has;});
 const tocHTML = appendixTOC.map(function(x){
  return '<div style="display:flex;align-items:center;gap:12px;padding:7px 0;border-bottom:1px dotted #e2e8f0">'
   +'<span style="font-size:10px;font-weight:800;color:'+rc+';min-width:60px;font-family:JetBrains Mono,monospace">'+x.label+'</span>'
   +'<span style="font-size:12px;color:#334155">'+x.title+'</span>'
   +'</div>';
 }).join("");

 // ── CSS ──────────────────────────────────────────────────────
 const css = '*{box-sizing:border-box}'
  +'body{font-family:"Noto Serif KR","Malgun Gothic",serif;margin:0;padding:0;color:#1e293b;background:#fff;font-size:14px}'
  +'.cover{background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);color:#fff;padding:48px 40px 36px}'
  +'.cover-sub{font-size:11px;font-weight:700;letter-spacing:.15em;color:#94a3b8;margin-bottom:12px;text-transform:uppercase;font-family:"JetBrains Mono",monospace}'
  +'.cover-h1{font-size:26px;font-weight:800;line-height:1.3;margin-bottom:20px}'
  +'.risk-badge{display:inline-flex;align-items:center;gap:8px;padding:8px 20px;border-radius:30px;font-weight:800;font-size:14px;background:'+rb+';color:'+rc+';border:2px solid '+rc+'}'
  +'.cover-meta{margin-top:28px;font-size:11px;color:#94a3b8;display:flex;gap:24px;flex-wrap:wrap;font-family:"JetBrains Mono",monospace}'
  +'.main{padding:32px 40px;max-width:900px;margin:0 auto}'
  +'.sec-title{font-size:10px;font-weight:800;color:#64748b;letter-spacing:.12em;text-transform:uppercase;padding-bottom:5px;border-bottom:1px solid #e2e8f0;margin-bottom:12px;font-family:"JetBrains Mono",monospace}'
  +'.bottom-line{background:'+rb+';border:1px solid '+rc+'44;border-left:4px solid '+rc+';border-radius:8px;padding:14px 18px;font-size:14px;font-weight:600;color:'+rc+';line-height:1.6;margin-bottom:18px}'
  +'.card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:13px 15px}'
  +'.card-label{font-size:9px;font-weight:700;color:#64748b;letter-spacing:.08em;margin-bottom:5px;text-transform:uppercase;font-family:"JetBrains Mono",monospace}'
  +'@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}'
  +'.app-section{padding:32px 40px;max-width:900px;margin:0 auto}';

 // ── 본문 조립 (1장 목표) ──────────────────────────────────────
 let html = '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>계약 리스크 분석 리포트</title>'
  +'<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">'
  +'<style>'+css+'</style></head><body>';

 // 표지
 html += '<div class="cover">'
  +'<div class="cover-sub">Contract Intelligence Report</div>'
  +'<div class="cover-h1">계약 리스크 분석 리포트</div>'
  +'<div class="risk-badge">&#9651; '+rl+' RISK &nbsp;&mdash;&nbsp; '+(RL[rl]||rl)+'</div>'
  +'<div class="cover-meta">'
  +'<span>&#128197; '+ts+'</span>'
  +'<span>&#128269; '+(mode==="extended"?"확장 (계약+내규)":"기본 (계약 문서)")+'</span>'
  +'<span>&#128203; 관련 조항 '+(result.triggered_clauses||[]).length+'건</span>'
  +'<span>&#9889; 조치사항 '+(result.immediate_actions||[]).length+'건</span>'
  +'</div></div>';

 // 본문
 html += '<div class="main">';

 // 이슈
 html += '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;margin-bottom:16px">'
  +'<div style="font-size:9px;font-weight:700;color:#64748b;letter-spacing:.1em;margin-bottom:5px;font-family:JetBrains Mono,monospace">ISSUE</div>'
  +'<div style="font-size:13px;color:#1e293b;line-height:1.65;font-weight:500">'+(query||"")+'</div>'
  +'</div>';

 // 판사 결론
 html += '<div class="bottom-line">&#9878; '+(result.bottom_line||result.situation_summary||"")+'</div>';

 // 상황 요약 + 법적 분석 (2-col)
 html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px">'
  +'<div class="card"><div class="card-label">상황 요약</div><div style="font-size:12px;color:#1e293b;line-height:1.7">'+(result.situation_summary||"")+'</div></div>'
  +'<div class="card"><div class="card-label">법적 분석</div><div style="font-size:12px;color:#334155;line-height:1.7">'+(result.legal_analysis||"")+'</div></div>'
  +'</div>';

 // 위험도 근거
 html += '<div style="margin-bottom:16px"><div class="sec-title">위험도 판단 근거</div>'
  +'<div style="font-size:12px;color:#334155;line-height:1.8">'+(result.risk_reason||"")+'</div></div>';

 // 충돌 조항 태그
 if (conflictsHTML) {
  html += '<div style="margin-bottom:14px"><div class="sec-title">식별된 충돌 조항</div>'
   +'<div style="display:flex;flex-wrap:wrap;gap:4px">'+conflictsHTML+'</div></div>';
 }

 // 별첨 안내
 html += '<div style="margin-top:20px;padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">'
  +'<div class="sec-title" style="margin-bottom:8px">별첨 목차</div>'
  +tocHTML
  +'</div>';

 html += footer("KT · Palantir Korea LLC 계약 인텔리전스 시스템");
 html += '</div>'; // .main

 // ── 별첨 A ─────────────────────────────────────────────────
 html += '<div style="page-break-before:always"></div>'
  +'<div class="app-section">'
  +appHeader("별첨 A &mdash; KT 방어 전략","KT 측 방어 논거 · 협상 레버리지 · 유리한 조항 해석 · 절차적 방어 · 선제적 행동")
  +appA
  +footer("[별첨 A] KT 방어 전략 · KT × Palantir 계약 인텔리전스")
  +'</div>';

 // ── 별첨 B ─────────────────────────────────────────────────
 html += '<div style="page-break-before:always"></div>'
  +'<div class="app-section">'
  +appHeader("별첨 B &mdash; Palantir 예상 반론","Palantir 측 논거 · 강력한 반론 · KT 취약점 · 예상 대응 전략")
  +appB
  +footer("[별첨 B] Palantir 예상 반론 · KT × Palantir 계약 인텔리전스")
  +'</div>';

 // ── 별첨 C ─────────────────────────────────────────────────
 if (appC) {
  html += '<div style="page-break-before:always"></div>'
   +'<div class="app-section">'
   +appHeader("별첨 C &mdash; 즉시 조치사항","우선순위 · 기한 · 담당 조항 기준 조치 목록")
   +appC
   +footer("[별첨 C] 즉시 조치사항 · KT × Palantir 계약 인텔리전스")
   +'</div>';
 }

 // ── 별첨 D ─────────────────────────────────────────────────
 if (appD) {
  html += '<div style="page-break-before:always"></div>'
   +'<div class="app-section">'
   +appHeader("별첨 D &mdash; 관련 조항 요약","본 분석에 인용된 계약 조항의 관련성 · KT 입장 요약")
   +appD
   +footer("[별첨 D] 관련 조항 요약 · KT × Palantir 계약 인텔리전스")
   +'</div>';
 }

 // ── 별첨 E ─────────────────────────────────────────────────
 if (appE) {
  html += '<div style="page-break-before:always"></div>'
   +'<div class="app-section">'
   +appHeader("별첨 E &mdash; 조항 원문 전문","본 분석에 인용된 계약 조항의 원문 · 번역 · 실무 해석")
   +appE
   +footer("[별첨 E] 조항 원문 전문 · KT × Palantir 계약 인텔리전스")
   +'</div>';
 }

 // ── 고정 버튼 ───────────────────────────────────────────────
 html += '<div style="position:fixed;bottom:24px;right:24px;display:flex;gap:8px;z-index:9999">'
  +'<button onclick="window.print()" style="padding:10px 22px;background:#1e3a6e;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.25)">출력</button>'
  +'<button onclick="window.parent.postMessage(\'closeReport\',\'*\')" style="padding:10px 18px;background:#f1f5f9;color:#475569;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer">닫기</button>'
  +'</div></body></html>';

 return html;
}

function ReportButton({ result, query, mode }) {
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    const handler = (e) => { if (e.data === "closeReport") setShowModal(false); };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  if (!result) return null;

  const reportHtml = buildReportHTML(query || "", result, mode || "basic");

  const handleDownload = () => {
    const blob = new Blob([reportHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "contract-report.html";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  };

  const btnBase = {
    display: "flex", alignItems: "center", gap: 6,
    padding: "7px 16px", borderRadius: 5, fontSize: 11,
    fontWeight: 600, cursor: "pointer", border: "none"
  };

  return (
    <>
      <div style={{display:"flex", gap:8, justifyContent:"flex-end", marginTop:12}}>
        <button onClick={() => setShowModal(true)}
          style={{...btnBase, background:"#1e293b", border:"1px solid #334155", color:"#94a3b8", fontFamily:"inherit"}}>
          리포트 보기
        </button>
        <button onClick={handleDownload}
          style={{...btnBase, background:"#1e3a6e", border:"1px solid #3b82f640", color:"#93c5fd", fontFamily:"inherit"}}>
          HTML 저장 후 출력
        </button>
      </div>

      {showModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(2,6,23,0.95)",zIndex:9999,display:"flex",flexDirection:"column"}}>
          <iframe
            srcDoc={reportHtml}
            style={{flex:1, border:"none", background:"#fff"}}
            title="리포트 미리보기"
          />
        </div>
      )}
    </>
  );
}

function buildFollowupPrompt(mode, analysisResult, chatHistory, amendments=[], issueType=null) {
 const contractDocs = ["SAA","TOS","OF3","OF4"];
 const filteredClauses = mode==="extended"
  ? CONTRACT_KB.clauses
  : CONTRACT_KB.clauses.filter(c => contractDocs.includes(c.doc));
 const clauseLines = filteredClauses.map(c => {
  const base = c.id+" / "+c.doc+" / "+c.topic+" / "+c.core;
  const detail = c.text ? " | "+c.text : "";
  const risk = c.kt_risk ? " [KT리스크: "+c.kt_risk+"]" : "";
  return base+detail+risk;
 }).join("\n");
 const filteredConflicts = mode==="extended"
  ? CONTRACT_KB.conflicts
  : CONTRACT_KB.conflicts.filter(c => !c.id.startsWith('EC-'));
 const conflictLines = filteredConflicts.map(c => c.id+" / "+c.risk+" / "+c.topic+" / "+c.summary).join("\n");
 const extNote = mode==="extended" ? "확장 모드 (계약+내규)" : "기본 모드 (계약 문서)";
 const typeInfo = issueType && ISSUE_TYPES[issueType] ? ISSUE_TYPES[issueType] : null;
 const focusNote = typeInfo ? `\n\n【${typeInfo.label} 이슈 집중 체크】\n${typeInfo.focus}` : "";
 const historyText = chatHistory.map(m => (m.role==="user" ? "사용자: " : "AI: ") + m.content).join("\n");
 const amendNote = amendments.length > 0
  ? "\n\n현재 적용 중인 Amendment:\n" + amendments.map(a => "["+a.docType+"] "+a.fileName+": "+a.changes.map(c=>c.clauseId+" "+c.changeType).join(", ")).join("\n")
  : "";
 return `당신은 KT와 Palantir Korea LLC 간의 계약 리스크 분석 전문가입니다. ${extNote}${amendNote}${focusNote}
${readHurdleSnapshot()||""}




체크1 고객 범위:
 [Target Market-보험 Appendix 6] 신한라이프/DB손해·생명/현대해상/서울보증/한화생명·손해/ABL생명/캐롯손해/메리츠화재/KB손해·생명/KDB생명/삼성생명·화재/하나생명·손해/미래에셋생명/농협손해·생명/교보생명 (총 21개사)
 [Target Market-금융서비스] 투자은행, 자산관리, 회계법인(내부사용) → SAA-1.3.1/1.3.2 독점권 적용, Palantir 직접 판매 금지
 [Other Market Appendix 7] 현대자동차/기아/포스코/한화시스템/현대로템/현대글로비스/CJ제일제당/한국해양진흥공사/서울아산병원/산업통상자원부 (10개사) → Co-Sell 조건 준수 필요
 [계약 범위 외] 위 어디에도 해당 없는 고객 → Palantir 자유 영업 가능, KT가 영업했으면 오히려 KT가 SAA-6.2 위반
체크2 행위 주체: 위반 행위가 Palantir인지 KT인지 제3자인지 확인 후 책임 귀속
체크3 조건 충족: Hurdle($55M) 달성 여부, OF4 편의해지 불가, 20일/30일 치유 기간, EBT는 Target Market 내에서만
체크4 문서 우선순위: 일반 원칙은 Order Form > SAA > TOS. 단 XC-001/XC-002/XC-003/XC-004 등 이미 식별된 충돌 항목은 우선순위 원칙이 그대로 적용되지 않으므로 "원칙상 SAA 우선이나 분쟁 리스크 존재"로 서술. 내규는 KT 내부 의무로 계약 위반과 독립.
⚠️ 조건 미확인·범위 밖 조항 적용·KT 권리 없는 상황에서 KT 방어 논거 구성 금지

【판단 오류 방지 — 자주 틀리는 패턴】
- XC-005(해지 후 잔여 Fee): 해지 논의가 아닌 이슈에서 포함 금지.
- IC-001(독점 vs EBT): EBT는 KT가 발굴한 Target Market 고객에만 적용. 범위 외 고객 이슈에서 포함 금지.
- SAA-1.3.1/1.3.2: 계약 범위 외 고객에는 독점권 없음. KT가 해당 고객에 영업했다면 KT가 위반자.
- TOS-8.4: Palantir의 권리. KT 방어 수단으로 사용 금지.
- 치유 기간: SAA 20일 원칙, TOS §8.4 즉시 정지로 우회 가능성 항상 병기.

【판단 오류 방지 — 자주 틀리는 패턴】
- XC-005(해지 후 잔여 Fee): OF4는 편의해지 불가 계약. 해지 논의가 아닌 이슈에서 이 충돌을 포함하지 말 것.
- IC-001(독점 vs EBT): EBT는 KT가 발굴한 Target Market 고객에만 적용. 계약 범위 외 고객 이슈에서 포함 금지.
- SAA-1.3.1/1.3.2 독점권: Appendix 6/7 외 고객(계약 범위 외)에는 독점권 자체가 없음. KT가 해당 고객에 영업했다면 오히려 KT가 위반자.
- TOS-8.4 즉시 정지: Palantir 귀책 이슈에서 이 조항을 KT 방어 수단으로 사용하지 말 것. 이 조항은 Palantir의 권리임.
- 치유 기간 계산: SAA §6.2(20일)와 TOS §8.2(30일) 충돌 시 Order Form > SAA > TOS 우선순위상 SAA 20일 적용이 원칙이나, TOS §8.4에 의한 즉시 정지가 이를 우회할 수 있음을 항상 병기.

주요 조항 (ID/문서/주제/내용):
${clauseLines}

기식별 충돌 (ID/위험도/주제/요약):
${conflictLines}

=== 이전 분석 결과 ===
상황: ${analysisResult.situation_summary}
위험도: ${analysisResult.risk_level}
법적 분석: ${analysisResult.legal_analysis}
KT 방어 논거: ${analysisResult.kt_defense}
Palantir 측 논거: ${analysisResult.palantir_position}
결론: ${analysisResult.bottom_line}

=== 대화 기록 ===
${historyText}

위 분석 결과를 바탕으로 사용자의 추가 질문에 답변하세요. 한국어로 답변하며, 관련 조항이 있으면 조항 ID를 명시하세요. 마크다운은 사용하지 마세요.`;
}

function buildDocManagerFollowupPrompt(docs, clauses, conflicts, selectedDoc, chatHistory=[]) {
 const scopedClauses = selectedDoc
  ? selectedDoc._builtin
   ? CONTRACT_KB.clauses.filter(c => c.doc === selectedDoc.docType)
   : clauses.filter(c => c._docId === selectedDoc.id || c._amendedBy === selectedDoc.fileName)
  : clauses;
 const clauseLines = scopedClauses.slice(0, 40).map(c => `${c.id} / ${c.doc} / ${c.topic} / ${c.core}`).join("\n");
 const conflictLines = conflicts.slice(0, 25).map(c => `${c.id} / ${c.risk} / ${c.topic} / ${c.summary}`).join("\n");
 const docLines = docs.slice(0, 25).map(d => `${d.fileName} / ${d.docType} / clauses=${d.clauseCount||0}`).join("\n");
 const scopeText = selectedDoc
  ? (selectedDoc._builtin ? `현재 선택 문서: ${selectedDoc.fileName} (내장 문서)` : `현재 선택 문서: ${selectedDoc.fileName} (${selectedDoc.docType})`)
  : "현재 선택 문서: 없음 (전체 기준)";
 const historyText = chatHistory.map(m => `${m.role === "user" ? "사용자" : "AI"}: ${m.content}`).join("\n");

 return `당신은 KT 계약 문서 관리 보조 AI입니다.
문서 관리 탭에서 사용자의 질문에 답하세요. 질문이 조항/충돌/업로드 이력과 연결되면 근거 ID를 명시하세요.

${scopeText}

[업로드 문서 목록]
${docLines || "없음"}

[현재 범위 조항]
${clauseLines || "없음"}

[충돌 목록]
${conflictLines || "없음"}

[대화 이력]
${historyText || "없음"}

답변 규칙:
- 한국어로 간결하고 정확하게 답변
- 조항을 인용할 때는 반드시 조항 ID를 포함
- 정보가 부족하면 어떤 문서를 올리면 되는지 구체적으로 안내
- 마크다운 코드블록은 사용하지 말 것`;
}

function DocManagerFollowupChat({ docs, clauses, conflicts, selectedDoc, onOpenClause }) {
 const [messages, setMessages] = useState([]);
 const [input, setInput] = useState("");
 const [loading, setLoading] = useState(false);
 const bottomRef = useRef(null);

 useEffect(() => {
  bottomRef.current?.scrollIntoView({ behavior: "smooth" });
 }, [messages]);

 const send = async () => {
  if (!input.trim() || loading) return;
  const userMsg = input.trim();
  setInput("");
  const next = [...messages, { role: "user", content: userMsg }];
  setMessages(next);
  setLoading(true);
  try {
   const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
     max_tokens: 1000,
     system: buildDocManagerFollowupPrompt(docs, clauses, conflicts, selectedDoc, messages),
     messages: [{ role: "user", content: userMsg }],
    }),
   });
   if (!res.ok) throw new Error("API " + res.status);
   const data = await res.json();
   const text = data.content?.map(b => b.text || "").join("").trim() || "응답이 비어 있습니다.";
   setMessages([...next, { role: "assistant", content: text }]);
  } catch (e) {
   setMessages([...next, { role: "assistant", content: "오류가 발생했습니다: " + e.message }]);
  } finally {
   setLoading(false);
  }
 };

 return (
  <div style={{ borderTop: "1px solid #334155", background: "#020617", padding: "10px 12px" }}>
   <div style={{fontSize:10,color:"#94a3b8",marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
    <span style={{width:6,height:6,borderRadius:"50%",background:"#60a5fa",boxShadow:"0 0 6px #60a5fa"}}/>
    문서관리 추가 질문
    <span style={{color:"#475569"}}>문서·조항·충돌 상태를 기준으로 답변합니다</span>
   </div>
   {messages.length > 0 && (
    <div style={{ maxHeight: 200, overflowY: "auto", padding: "0 0 8px", display: "flex", flexDirection: "column", gap: 7 }}>
     {messages.map((m, i) => (
      <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
       <div style={{ maxWidth: "88%", padding: "7px 10px", borderRadius: 6, background: m.role === "user" ? "#0f1e35" : "#1e293b", border: `1px solid ${m.role === "user" ? "#1e3a5f" : "#334155"}`, fontSize: 11, color: "#cbd5e1", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
        {m.content.split("\n").map((line, idx) => (
         <span key={idx}>{linkifyClauses(line, onOpenClause)}{idx < m.content.split("\n").length - 1 && <br/>}</span>
        ))}
       </div>
      </div>
     ))}
     {loading && <div style={{display:"flex",justifyContent:"flex-start"}}><div style={{background:"#1e293b",border:"1px solid #334155",borderRadius:6,padding:"4px 8px"}}><TypingDots/></div></div>}
     <div ref={bottomRef} />
    </div>
   )}
   <div style={{ display: "flex", gap: 8 }}>
    <input
     value={input}
     onChange={e => setInput(e.target.value)}
     onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
     placeholder="문서관리 상태에 대해 추가 질문..."
     style={{ flex: 1, background: "#07070f", border: "1px solid #334155", borderRadius: 4, padding: "7px 10px", fontSize: 11, color: "#e2e8f0", fontFamily: "inherit", outline: "none" }}
    />
    <button onClick={send} disabled={!input.trim() || loading} style={{padding:"7px 12px",background:input.trim()&&!loading?"#1e3a6e":"#0f1525",border:`1px solid ${input.trim()&&!loading?"#60a5fa44":"#334155"}`,borderRadius:4,fontSize:11,color:input.trim()&&!loading?"#60a5fa":"#64748b",cursor:input.trim()&&!loading?"pointer":"not-allowed",fontFamily:"inherit"}}>
     전송
    </button>
   </div>
  </div>
 );
}

// --- DOCUMENT MANAGEMENT SYSTEM -----------------------------------------------

const DOC_TYPES = {
 SAA: { label:"SAA", color:"#60a5fa", desc:"Strategic Alliance Agreement" },
 TOS: { label:"TOS", color:"#f59e0b", desc:"Terms of Service" },
 OF: { label:"Order Form",color:"#a78bfa", desc:"Order Form (3, 4, ...)" },
 REG: { label:"내규", color:"#34d399", desc:"KT 내부 규정" },
 AMD: { label:"Amendment", color:"#fb923c", desc:"계약 변경서" },
 NEW: { label:"신규", color:"#e879f9", desc:"신규 계약서" },
 OTHER: { label:"기타", color:"#94a3b8", desc:"기타 문서" },
};

const CONFLICT_CHECK_PROMPT = (clauses, options = {}) => {
 const focusClauseIds = Array.isArray(options.focusClauseIds) ? options.focusClauseIds.filter(Boolean) : [];
 const clauseLines = clauses.map(c => {
 const core = (c.core || '').replace(/[\r\n\t"]/g, ' ').slice(0, 140);
 const topic = (c.topic || '').replace(/[\r\n\t"]/g, ' ').slice(0, 30);
 return '[' + c.id + '] ' + (c.doc || '') + ' | ' + topic + ' | ' + core;
 }).join('\n');
 const focusNote = focusClauseIds.length > 0
  ? ('\n중요 범위 제한:\n- 아래 변경 조항 ID가 최소 1개 포함된 충돌만 반환\n- 변경 조항끼리의 충돌은 제외\n- 즉, "변경 조항" vs "기타 조항" 충돌만 반환\n변경 조항 ID: ' + focusClauseIds.join(', ') + '\n')
  : '';
 return '당신은 KT x Palantir Korea 계약 전문가입니다.\n' +
 '아래 조항 목록에서 조항 간 충돌을 찾아내시오. 단순 나열이 아니라 왜 충돌인지 근거를 구체적으로 써라.\n' +
 'Markdown 백틱 없이 순수 JSON 배열만 출력.\n\n' +
 '조항 목록:\n' + clauseLines + '\n\n' +
 focusNote + '\n' +
 '출력 형식:\n[\n' +
 ' {\n' +
 ' "id": "XC-001",\n' +
 ' "risk": "HIGH|MEDIUM|LOW",\n' +
 ' "topic": "충돌 주제 20자 이내",\n' +
 ' "summary": "A조항 vs B조항의 충돌 요약",\n' +
 ' "why": "어느 문구가 어떻게 모순되는지 구체 설명",\n' +
 ' "impact": "실무상 영향(협상/해지/정산/위험) 한 문장",\n' +
 ' "resolution": "우선 적용 기준 또는 권고 조치",\n' +
 ' "clauseIds": ["SAA-6.2", "TOS-8.2"]\n' +
 ' }\n]\n\n' +
 '규칙: 기존 ID(XC-,IC-,EC-) 유지. 신규는 XC-NEW-001. 충돌없으면 [] 반환.\n' +
 '규칙: clauseIds는 반드시 2개 이상, summary/why/impact/resolution은 일반론 금지.';
};

const CLAUSE_EXTRACT_PROMPT = (docType, fileName) => `당신은 계약서 분석 전문가입니다.
아래 문서(${docType}: ${fileName})에서 핵심 조항을 추출하여 JSON 배열로만 반환하시오.
Markdown 백틱 없이 순수 JSON만 출력. 문자열 내 줄바꿈은 반드시 \\n으로 이스케이프할 것.

[
 {
 "id": "DOC-조항번호",
 "doc": "${docType}",
 "topic": "조항 주제 (한국어, 15자 이내)",
 "core": "핵심 내용 한 줄 요약 (한국어, 80자 이내)",
 "text": "조항 원문 또는 한국어 번역 전문 (500자 이내, 줄바꿈은 \\\\n)",
 "kt_risk": "KT 관점 리스크 및 주의사항 (100자 이내)",
 "section": "조항 번호/제목",
 "title": "조항 제목"
 }
]

'- 중요 조항만 추출 (최대 20개). 사소한 정의/서명/날짜 조항 제외.\n'
'- text 필드: 원문이 영어면 한국어 번역 전문 포함. 핵심 의무/권리/조건 빠짐없이 기술.\n'
'- kt_risk: 이 조항이 KT에 불리하게 작용하는 구체적 상황 명시.\n'
'- 각 필드값에 큰따옴표(")가 포함되면 반드시 \\"로 이스케이프.\n'
'- 응답은 반드시 [ 로 시작하고 ] 로 끝나야 함.`;
// --- 문서 DB 헬퍼 ------------------------------------------------------------
const DocDB = {
 DOCS_KEY: "docmgr_docs_v1",
 CLAUSES_KEY: "docmgr_clauses_v1",
 CONFLICTS_KEY: "docmgr_conflicts_v1",
 VERSION_KEY: "docmgr_kb_version_v1",

 async load() {
  const results = {};
  for (const [key, prop] of [
   [this.DOCS_KEY, 'docs'],
   [this.CLAUSES_KEY, 'clauses'],
   [this.CONFLICTS_KEY, 'conflicts'],
  ]) {
   try {
    const s = await storage.get(key);
    results[prop] = s ? JSON.parse(s) : null;
   } catch(e) { results[prop] = null; }
  }
  return results;
 },

 async saveDocs(docs) {
  try { await storage.set(this.DOCS_KEY, JSON.stringify(docs)); } catch(e) {}
 },
 async saveClauses(clauses) {
  try { await storage.set(this.CLAUSES_KEY, JSON.stringify(clauses)); } catch(e) {}
 },
 async saveConflicts(conflicts) {
  try { await storage.set(this.CONFLICTS_KEY, JSON.stringify(conflicts)); } catch(e) {}
 },
 async loadVersion() {
  try { return await storage.get(this.VERSION_KEY); } catch(e) { return null; }
 },
 async saveVersion(version) {
  try { await storage.set(this.VERSION_KEY, version); } catch(e) {}
 },

 // 원문 저장: _rawDocStore(메모리) 우선 + storage 백업
 async saveRaw(docId, data) {
  _rawDocStore.set(docId, data);
  try {
   const json = JSON.stringify(data);
   if (json.length < 4 * 1024 * 1024) await storage.set('raw_' + docId, json);
  } catch(e) {}
 },
 async loadRaw(docId) {
  if (_rawDocStore.has(docId)) return _rawDocStore.get(docId);
  try {
   const s = await storage.get('raw_' + docId);
   if (s) { const d = JSON.parse(s); _rawDocStore.set(docId, d); return d; }
  } catch(e) {}
  return null;
 },
 async deleteRaw(docId) {
  _rawDocStore.delete(docId);
  try { await storage.remove('raw_' + docId); } catch(e) {}
 },
 async loadAllRaw(docList) {
  const results = [];
  for (const doc of (docList || [])) {
   const raw = await this.loadRaw(doc.id);
   if (raw) results.push({ doc, raw });
  }
  return results;
 },

 async clear() {
  const { docs } = await this.load();
  if (docs) for (const d of docs) await this.deleteRaw(d.id);
  for (const k of [this.DOCS_KEY, this.CLAUSES_KEY, this.CONFLICTS_KEY, this.VERSION_KEY])
   try { await storage.remove(k); } catch(e) {}
 }
};

async function extractPdfText(file, onProgress) {
 try {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const ab = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: ab, disableWorker: true });
  const pdf = await loadingTask.promise;
  const pages = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
   const page = await pdf.getPage(pageNum);
   const content = await page.getTextContent();
   const text = (content.items || []).map(i => i.str || "").join(" ");
   if (text.trim()) pages.push(text.trim());
   if (onProgress) onProgress({ phase: "text", page: pageNum, total: pdf.numPages });
  }
  const merged = pages.join("\n\n").trim();
  if (merged.length >= 300) return merged;

  // OCR fallback for scanned/image-only PDFs
  if (onProgress) onProgress({ phase: "ocr-init", page: 0, total: Math.min(pdf.numPages, 8) });
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  const ocrPages = [];
  const maxPages = Math.min(pdf.numPages, 8);
  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
   const page = await pdf.getPage(pageNum);
   const viewport = page.getViewport({ scale: 1.8 });
   const canvas = document.createElement("canvas");
   const ctx = canvas.getContext("2d");
   canvas.width = Math.floor(viewport.width);
   canvas.height = Math.floor(viewport.height);
   await page.render({ canvasContext: ctx, viewport }).promise;
   const imageData = canvas.toDataURL("image/png");
   const out = await worker.recognize(imageData);
   const t = out?.data?.text || "";
   if (t.trim()) ocrPages.push(t.trim());
   if (onProgress) onProgress({ phase: "ocr", page: pageNum, total: maxPages });
  }
  await worker.terminate();

  const ocrMerged = ocrPages.join("\n\n").trim();
  return ocrMerged || merged;
 } catch (e) {
  return "";
 }
}

function mergeFulltextToKB() {
 for (const c of CONTRACT_KB.clauses) {
  const ft = CLAUSE_FULLTEXT[c.id];
  if (ft) {
   if (!c.text) c.text = ft.text;
   if (!c.kt_risk) c.kt_risk = ft.kt_risk;
  }
 }
}
mergeFulltextToKB();

async function loadDynamicKB() {
 const savedVersion = await DocDB.loadVersion();
 if (savedVersion !== KB_VERSION) {
  await DocDB.saveClauses(CONTRACT_KB.clauses);
  await DocDB.saveConflicts(CONTRACT_KB.conflicts);
  await DocDB.saveVersion(KB_VERSION);
  return;
 }

 const { clauses, conflicts } = await DocDB.load();
 if (clauses && clauses.length > 0) {
 CONTRACT_KB.clauses = clauses;
 for (const c of clauses) {
 if (c.text) {
 CLAUSE_FULLTEXT[c.id] = {
 doc: c.doc, section: c.section||c.id, title: c.title||c.topic,
 text: c.text, translation: c.translation||"", context: c.context||"",
 _dynamic: true,
 };
 }
 }
 }
 if (conflicts && conflicts.length > 0) {
 CONTRACT_KB.conflicts = conflicts;
 }
}

// --- COMPONENTS --------------------------------------------------------------
const RISK_COLOR = { HIGH:"#ff2d20", MEDIUM:"#f59e0b", LOW:"#10b981" };
const RISK_BG = { HIGH:"#2a0808", MEDIUM:"#2a1f08", LOW:"#082a14" };
const URGENCY_COL = { "즉시":"#ff2d20", "단기":"#f59e0b", "장기":"#10b981" };
const DOC_COLOR = { SAA:"#60a5fa", OF3:"#34d399", OF4:"#a78bfa", TOS:"#f59e0b", "하도급지침":"#fb923c", "정보보호지침":"#0ea5e9", "회계규정":"#e879f9", "계약규정":"#f43f5e", "협력사선정지침":"#84cc16" };

const SAMPLE_ISSUES = [
 "Palantir이 Appendix 7에 없는 고객에게 우리가 영업했다고 경고를 보냈다",
 "Palantir이 우리가 6개월 공들인 삼성전자에 직접 접촉해서 계약을 논의 중이다",
 "OF4 계약 즉시 지급 $4M을 예산 편성 없이 집행한 것 같다",
 "Azure 클라우드에 고객 데이터를 올리기 전에 CISO 승인을 받았는지 모르겠다",
 "Palantir이 TOS §8.4를 근거로 서비스를 즉시 정지시켰다",
 "계약 만료 전 Hurdle 달성이 어려울 것 같다. 어떻게 해야 하나",
];

function TypingDots() {
 return (
 <div style={{display:"flex",alignItems:"center",gap:5,padding:"10px 14px"}}>
 {[0,1,2].map(i=>(
 <div key={i} style={{width:5,height:5,borderRadius:"50%",background:"#60a5fa",animation:`bounce 1.2s ${i*0.2}s infinite`}}/>
 ))}
 <span style={{fontSize:11,color:"#94a3b8",marginLeft:4}}>분석 중...</span>
 </div>
 );
}


function ClauseInlinePopup({ clauseId, children, onOpen }) {
 const [show, setShow] = useState(false);
 const data = CLAUSE_FULLTEXT[clauseId];
 const kb = CONTRACT_KB.clauses.find(c=>c.id===clauseId);
 const docColor = DOC_COLOR[data?.doc || kb?.doc] || "#60a5fa";
 const info = data || (kb ? {doc:kb.doc, section:kb.id, title:kb.topic, text:kb.core, context:null} : null);
 if (!info) return <span style={{color:docColor,fontWeight:700,cursor:"pointer"}} onClick={()=>onOpen&&onOpen(clauseId)}>{children}</span>;
 return (
 <span style={{position:"relative",display:"inline"}}
 onMouseEnter={()=>setShow(true)}
 onMouseLeave={()=>setShow(false)}
 >
 <span style={{color:docColor,fontWeight:700,borderBottom:"1px dashed "+docColor+"88",cursor:"pointer",paddingBottom:1}}
 onClick={()=>onOpen&&onOpen(clauseId)}>
 {children}
 </span>
 {show && (
 <span style={{position:"absolute",bottom:"calc(100% + 6px)",left:0,zIndex:200,minWidth:260,maxWidth:320,background:"#0d1220",border:`1px solid ${docColor}44`,borderRadius:6,padding:"8px 12px",boxShadow:"0 4px 20px #00000088",pointerEvents:"none"}}>
 <span style={{display:"block",fontSize:10,fontWeight:700,color:docColor,marginBottom:4}}>{info.doc} · {info.section}</span>
 <span style={{display:"block",fontSize:11,fontWeight:600,color:"#e2e8f0",marginBottom:4}}>{info.title}</span>
 <span style={{display:"block",fontSize:10,color:"#cbd5e1",lineHeight:1.6}}>{info.text?.slice(0,140)}{info.text?.length>140?"…":""}</span>
 {info.context && <span style={{display:"block",fontSize:10,color:docColor+"cc",marginTop:4,lineHeight:1.5}}>{info.context.slice(0,100)}{info.context.length>100?"…":""}</span>}
 <span style={{display:"block",fontSize:11,color:"#64748b",marginTop:6}}>{"클릭하면 전체 원문 보기"}</span>
 </span>
 )}
 </span>
 );
}

function linkifyClauses(text, onOpen) {
 if (!text || typeof text !== "string") return text;

 const allIds = [
 ...Object.keys(CLAUSE_FULLTEXT),
 ...CONTRACT_KB.clauses.map(c => c.id),
 ].filter((v,i,a) => a.indexOf(v) === i);

 const patterns = [];
 const appendixAlias = {
 "SAA-APP6": ["Appendix 6", "Appendix6", "APPENDIX 6", "Appendix VI"],
 "SAA-APP7": ["Appendix 7", "Appendix7", "APPENDIX 7", "Appendix VII"],
 };
 for (const id of allIds) {
 patterns.push({ pat: id, id });
  const m = id.match(/^(SAA|TOS|OF3|OF4|REG|LAW|XC|IC|EC)-(.+)$/);
 if (m) {
 patterns.push({ pat: m[1] + " §" + m[2], id });
 patterns.push({ pat: m[1] + "§" + m[2], id });
 patterns.push({ pat: m[1] + " " + m[2], id });
 patterns.push({ pat: "§" + m[2], id });
 if (/^[0-9]+(\.[0-9]+)+$/.test(m[2])) {
 patterns.push({ pat: m[2], id, bare: true });
 }
 }
 if (appendixAlias[id]) {
 for (const alias of appendixAlias[id]) patterns.push({ pat: alias, id });
 }
 }

 const titleAliases = [
  { pat: "Schedule A", id: "SAA-APP6" },
  { pat: "SCHEDULE A", id: "SAA-APP6" },
  { pat: "Schedule A, Resale Terms", id: "SAA-APP6" },
  { pat: "Schedule A, Resale Terms of the SAA", id: "SAA-APP6" },
  { pat: "Resale Terms - Appendix 6", id: "SAA-APP6" },
  { pat: "Resale Terms Appendix 6", id: "SAA-APP6" },
  { pat: "Resale Terms - Appendix 7", id: "SAA-APP7" },
  { pat: "Resale Terms Appendix 7", id: "SAA-APP7" },
  { pat: "Sub-clause 3.2.5.2", id: "SAA-3.2.5.2" },
  { pat: "sub-clause 3.2.5.2", id: "SAA-3.2.5.2" },
  { pat: "Section 3.2.5.2", id: "SAA-3.2.5.2" },
 ];
 patterns.push(...titleAliases);
 patterns.sort((a,b) => b.pat.length - a.pat.length);

 // 숫자만으로 된 bare 패턴 뒤에 올 수 없는 문자 (한국어, 알파벳, 숫자, 점)
 const BARE_AFTER_BLOCK = /[\d.\uAC00-\uD7A3a-zA-Z]/;
 const BARE_BEFORE_BLOCK = /[\d.]/;

 let segs = [{ text, matched: false }];
 for (const { pat, id, bare } of patterns) {
 const next = [];
 for (const seg of segs) {
 if (seg.matched) { next.push(seg); continue; }
 let rest = seg.text;
 let foundAny = false;
 let searchFrom = 0;
 while (true) {
 const idx = rest.indexOf(pat, searchFrom);
 if (idx === -1) break;
 // bare 패턴(숫자만): 앞뒤 문자 검사 — 금액/숫자 문맥이면 건너뜀
 if (bare) {
  const charBefore = idx > 0 ? rest[idx - 1] : '';
  const charAfter = rest[idx + pat.length] || '';
  if (BARE_BEFORE_BLOCK.test(charBefore) || BARE_AFTER_BLOCK.test(charAfter)) {
   searchFrom = idx + 1;
   continue;
  }
 }
 foundAny = true;
 if (idx > 0) next.push({ text: rest.slice(0, idx), matched: false });
 next.push({ text: pat, matched: true, id });
 rest = rest.slice(idx + pat.length);
 searchFrom = 0;
 }
 if (rest) next.push({ text: rest, matched: false });
 if (!foundAny && !rest) next.push({ text: seg.text, matched: false });
 }
 segs = next;
 }

 // 슬래시 연결 표기 처리: "SAA-1.3.1/1.3.2" 에서 "/1.3.2" 부분 후처리
 // matched 세그먼트 뒤에 오는 "/숫자..." 텍스트를 같은 문서 접두어로 해석
 const expanded = [];
 for (let i = 0; i < segs.length; i++) {
 const seg = segs[i];
 expanded.push(seg);
 if (seg.matched && i + 1 < segs.length && !segs[i+1].matched) {
 const prefix = seg.id.match(/^(SAA|TOS|OF3|OF4|REG|LAW|XC|IC|EC)/)?.[1];
 if (!prefix) continue;
 let rest = segs[i+1].text;
  const slashPat = /^([\/-])([\d.]+)/;
 let m2;
 let consumed = "";
 let extraSegs = [];
 while ((m2 = slashPat.exec(rest)) !== null) {
 const candidateId = prefix + "-" + m2[2];
 const found = allIds.find(id => id === candidateId);
 if (!found) break;
 consumed += m2[1]; // "/"
 extraSegs.push({ text: m2[1], matched: false });
 extraSegs.push({ text: m2[2], matched: true, id: found });
 rest = rest.slice(m2[0].length);
 }
 if (extraSegs.length > 0) {
 expanded.push(...extraSegs);
 segs[i+1] = { text: rest, matched: false };
 }
 }
 }

 const out = expanded.filter(s => s.text).map((seg, i) => {
 if (!seg.matched) return seg.text || null;
 return <ClauseInlinePopup key={i} clauseId={seg.id} onOpen={onOpen}>{seg.text}</ClauseInlinePopup>;
 }).filter(v => v !== null && v !== "");

 return out.some(v => typeof v !== "string") ? out : text;
}

function formatArgument(text, onOpen) {
 if (!text) return null;
 if (typeof text !== "string") text = Array.isArray(text) ? text.join("\n") : String(text);
 // 1) / 2) 형식을 (1) / (2) 로 정규화
 text = text.replace(/(^|\n)\s*([0-9]+)\)\s+/g, (_, nl, n) => `${nl}(${n}) `);
 const parts = text.split(/(?=\([0-9]+\))/);
 if (parts.length <= 1) {
 return text.split("\n").map((l,i)=>(
 <span key={i}>{linkifyClauses(l, onOpen)}{i<text.split("\n").length-1&&<br/>}</span>
 ));
 }
 return parts.filter(p=>p.trim()).map((part, i) => {
 const m = part.match(/^\(([0-9]+)\)\s*([\s\S]*)/);
 if (!m) return <div key={i} style={{marginBottom:4}}>{linkifyClauses(part, onOpen)}</div>;
 return (
 <div key={i} style={{display:"flex",gap:6,marginBottom:6,alignItems:"flex-start"}}>
 <span style={{minWidth:20,height:20,borderRadius:"50%",background:"#1e3a6e",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#60a5fa",flexShrink:0,marginTop:1}}>{m[1]}</span>
 <span style={{lineHeight:1.7}}>{linkifyClauses(m[2].trim(), onOpen)}</span>
 </div>
 );
 });
}

function renderBold(text) {
 if (!text) return null;
 return text.split(/(\*\*[^*]+\*\*)/).map((part, i) => {
 if (part.startsWith("**") && part.endsWith("**")) {
 return <strong key={i} style={{color:"#e2e8f0",fontWeight:700}}>{part.slice(2,-2)}</strong>;
 }
 return <span key={i}>{part}</span>;
 });
}

function renderBoldLines(text) {
 if (!text) return null;
 if (typeof text !== "string") text = Array.isArray(text) ? text.join("\n") : String(text);
 return text.split("\n").map((line, i) => (
 <span key={i}>{renderBold(line)}{i < text.split("\n").length-1 && <br/>}</span>
 ));
}

function hasEnglishBody(text) {
 if (!text) return false;
 const letters = (text.match(/[A-Za-z]/g) || []).length;
 return letters >= 40;
}

function isLikelySummaryTranslation(originalText, translationText) {
 if (!hasEnglishBody(originalText)) return false;
 if (!translationText) return true;
 const oLen = (originalText || "").replace(/\s+/g, "").length;
 const tLen = (translationText || "").replace(/\s+/g, "").length;
 if (!oLen) return false;
 return tLen < Math.max(120, Math.floor(oLen * 0.45));
}

async function loadStoredFullTranslations() {
 let bank = {};
 try {
 const raw = await storage.get(FULL_TRANSLATION_BANK_KEY);
 bank = raw ? JSON.parse(raw) : {};
 } catch (e) {
 bank = {};
 }

 for (const [clauseId, tr] of Object.entries(bank)) {
 if (!tr || !CLAUSE_FULLTEXT[clauseId]) continue;
 _fullTranslationCache.set(clauseId, tr);
 CLAUSE_FULLTEXT[clauseId].translation = tr;
 }
 return bank;
}

async function saveStoredFullTranslations(bank) {
 try {
 await storage.set(FULL_TRANSLATION_BANK_KEY, JSON.stringify(bank));
 } catch (e) {}
}

function getClausesNeedingFullTranslation() {
 return Object.entries(CLAUSE_FULLTEXT)
 .filter(([_, data]) => hasEnglishBody(data?.text))
 .filter(([id, data]) => {
 const current = _fullTranslationCache.get(id) || data?.translation || "";
 return isLikelySummaryTranslation(data?.text, current);
 })
 .map(([id, data]) => ({ id, data }));
}

async function buildAndPersistFullTranslationBank({ onProgress } = {}) {
 const bank = await loadStoredFullTranslations();
 const targets = getClausesNeedingFullTranslation();
 const total = targets.length;
 let done = 0;
 let failed = 0;

 for (const { id, data } of targets) {
 try {
 const translated = await requestFullClauseTranslation(data);
 if (translated) {
 bank[id] = translated;
 _fullTranslationCache.set(id, translated);
 CLAUSE_FULLTEXT[id].translation = translated;
 }
 } catch (e) {
 failed += 1;
 }
 done += 1;
 if (done % 3 === 0 || done === total) {
 await saveStoredFullTranslations(bank);
 }
 if (onProgress) onProgress({ done, failed, total });
 }
 return { done, failed, total };
}

async function requestFullClauseTranslation(data) {
 const original = (data?.text || "").trim();
 if (!original) return "";
 const prompt = [
  "다음 계약 조항을 한국어로 전문 완역하시오.",
  "요약 금지, 생략 금지, 항목/번호/단서를 모두 유지하시오.",
  "의미를 바꾸지 말고 원문 구조를 최대한 보존하시오.",
  "응답은 번역문 본문만 출력하고, 설명/주석/머리말을 붙이지 마시오.",
  "",
  `[조항 ID] ${data?.section || ""}`,
  `[조항 제목] ${data?.title || ""}`,
  "[원문]",
  original,
 ].join("\n");

 const resp = await fetch("/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
   max_tokens: 3000,
   messages: [{ role: "user", content: prompt }],
  }),
 });
 const payload = await resp.json();
 if (!resp.ok) {
  const errText = payload?.error?.message || payload?.error || JSON.stringify(payload);
  throw new Error(typeof errText === "string" ? errText : "전문 번역 생성 실패");
 }
 const text = (payload?.content || []).map((c) => c?.text || "").join("\n").trim();
 if (!text) throw new Error("전문 번역 생성 결과가 비어 있습니다.");
 return text;
}

function ClauseDrawer({ clauseId, onClose }) {
 const data = CLAUSE_FULLTEXT[clauseId];
 const kbClause = CONTRACT_KB.clauses.find(c => c.id === clauseId);
 const [fullTranslation, setFullTranslation] = useState(data?.translation || kbClause?.translation || "");
 const [translationBusy, setTranslationBusy] = useState(false);
 const [translationErr, setTranslationErr] = useState(null);
 if (!clauseId) return null;
 const docColor = DOC_COLOR[data?.doc || kbClause?.doc] || "#cbd5e1";
 const ktRisk = data?.kt_risk || kbClause?.kt_risk || data?.context || "";

 useEffect(() => {
  setTranslationErr(null);
  const cached = _fullTranslationCache.get(clauseId);
  const base = cached || data?.translation || kbClause?.translation || "";
  setFullTranslation(base);
  return undefined;
 }, [clauseId, data, kbClause]);

 const hasTranslation = !!fullTranslation;

 const handleRegenerateTranslation = async () => {
  setTranslationErr(null);
  setTranslationBusy(true);
  try {
   const translated = await requestFullClauseTranslation(data || kbClause);
   _fullTranslationCache.set(clauseId, translated);
   if (CLAUSE_FULLTEXT[clauseId]) CLAUSE_FULLTEXT[clauseId].translation = translated;
   const bank = Object.fromEntries(_fullTranslationCache);
   await saveStoredFullTranslations(bank);
   setFullTranslation(translated);
  } catch (e) {
   const msg = e.message || "전문 번역 생성 실패";
   const friendly = msg.includes("환경변수 미설정")
    ? "서버 환경변수 미설정 (Vercel: AZURE_OPENAI_ENDPOINT / API_KEY / DEPLOYMENT_NAME 확인 필요)"
    : msg;
   setTranslationErr(friendly);
  } finally {
   setTranslationBusy(false);
  }
 };

 const displayData = data || kbClause;

 return (
 <div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:100,background:"#0f172a",borderTop:`2px solid ${docColor}55`,boxShadow:"0 -8px 32px rgba(0,0,0,0.6)",maxHeight:"75vh",display:"flex",flexDirection:"column"}}>
  <div style={{display:"flex",alignItems:"center",gap:10,padding:"11px 20px",borderBottom:"1px solid #334155",flexShrink:0}}>
   <span style={{fontSize:10,fontWeight:700,color:docColor,background:docColor+"18",padding:"3px 9px",borderRadius:4,border:`1px solid ${docColor}33`}}>{displayData?.doc}</span>
   <span style={{fontSize:11,fontWeight:600,color:"#94a3b8"}}>{displayData?.section}</span>
   <span style={{fontSize:13,color:"#e2e8f0",fontWeight:500}}>{displayData?.title}</span>
   <button onClick={onClose}
    style={{marginLeft:"auto",background:"none",border:"1px solid #334155",borderRadius:5,padding:"4px 12px",fontSize:12,color:"#64748b",cursor:"pointer",fontFamily:"inherit"}}
    onMouseEnter={e=>e.currentTarget.style.color="#e2e8f0"} onMouseLeave={e=>e.currentTarget.style.color="#64748b"}>닫기 ×</button>
  </div>
  <div style={{overflowY:"auto",padding:"16px 20px",display:"grid",gridTemplateColumns:hasTranslation?"1fr 1fr 1fr":"1fr 1fr",gap:16,width:"100%"}}>
   <div>
    <div style={{fontSize:10,fontWeight:600,color:"#64748b",letterSpacing:"0.08em",marginBottom:8,textTransform:"uppercase"}}>조항 원문 (English)</div>
    <pre style={{fontSize:12,color:"#cbd5e1",lineHeight:1.8,whiteSpace:"pre-wrap",fontFamily:"ui-monospace,'Cascadia Code','Fira Code',monospace",margin:0,background:"#1e293b",padding:"12px 14px",borderRadius:6,border:"1px solid #334155"}}>{displayData?.text || "원문 데이터 없음"}</pre>
   </div>
   {hasTranslation ? (
    <div>
     <div style={{fontSize:10,fontWeight:600,color:"#64748b",letterSpacing:"0.08em",marginBottom:8,textTransform:"uppercase"}}>한국어 번역</div>
     <div style={{fontSize:12,color:"#cbd5e1",lineHeight:1.9,background:"#1e293b",padding:"12px 14px",borderRadius:6,border:`1px solid ${docColor}33`}}>
      {renderBoldLines(fullTranslation)}
     </div>
     {translationBusy && <div style={{marginTop:7,fontSize:11,color:"#60a5fa"}}>전문 번역 생성 중...</div>}
     {translationErr && <div style={{marginTop:7,fontSize:11,color:"#f87171"}}>{translationErr}</div>}
     <button onClick={handleRegenerateTranslation} disabled={translationBusy || !displayData?.text}
      style={{marginTop:8,fontSize:11,color:docColor,background:docColor+"12",border:`1px solid ${docColor}33`,borderRadius:5,padding:"5px 12px",cursor:(translationBusy||!displayData?.text)?"not-allowed":"pointer",fontFamily:"inherit",opacity:(translationBusy||!displayData?.text)?0.5:1}}>
      전문완역 다시 생성
     </button>
    </div>
   ) : (
    <div>
     <div style={{fontSize:10,fontWeight:600,color:"#64748b",letterSpacing:"0.08em",marginBottom:8,textTransform:"uppercase"}}>한국어 번역</div>
     <div style={{fontSize:12,color:"#94a3b8",lineHeight:1.8,background:"#1e293b",padding:"12px 14px",borderRadius:6,border:`1px solid ${docColor}33`}}>
      {translationBusy ? "전문 번역 생성 중..." : "번역 데이터 없음"}
     </div>
     {translationErr && <div style={{marginTop:7,fontSize:11,color:"#f87171"}}>{translationErr}</div>}
     {!translationBusy && (
      <button onClick={handleRegenerateTranslation} disabled={!displayData?.text}
       style={{marginTop:8,fontSize:11,color:docColor,background:docColor+"12",border:`1px solid ${docColor}33`,borderRadius:5,padding:"5px 12px",cursor:!displayData?.text?"not-allowed":"pointer",fontFamily:"inherit",opacity:!displayData?.text?0.5:1}}>
       전문완역 생성
      </button>
     )}
    </div>
   )}
   <div>
    <div style={{fontSize:10,fontWeight:600,color:"#64748b",letterSpacing:"0.08em",marginBottom:8,textTransform:"uppercase"}}>KT 리스크</div>
    <div style={{fontSize:12,color:"#fca5a5",lineHeight:1.8,background:"#1e293b",padding:"12px 14px",borderRadius:6,border:"1px solid #334155"}}>{ktRisk || "-"}</div>
   </div>
  </div>
 </div>
 );
}

function ClauseCard({ clause, onViewFull }) {
 const urg = clause.urgency || "단기";
 const docColor = DOC_COLOR[clause.doc] || "#7db8f7";
 const hasFullText = !!CLAUSE_FULLTEXT[clause.clause_id];
 const urgColor = URGENCY_COL[urg] || "#7db8f7";
 return (
 <div style={{background:"#0f172a",border:"1px solid #334155",borderRadius:8,padding:"14px 16px",marginBottom:8}}>
  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
   <span style={{fontSize:11,fontWeight:700,color:docColor,background:docColor+"18",padding:"3px 9px",borderRadius:4,border:`1px solid ${docColor}33`}}>{clause.clause_id||clause.id}</span>
   <span style={{fontSize:13,fontWeight:600,color:"#e2e8f0"}}>{clause.topic}</span>
   {(()=>{const kb=CONTRACT_KB.clauses.find(c=>c.id===clause.clause_id);return kb?._amended?<span style={{fontSize:10,color:"#fbbf24",background:"rgba(245,158,11,0.12)",padding:"2px 7px",borderRadius:4,border:"1px solid #f59e0b33"}}>AMD</span>:null;})()}
   <span style={{marginLeft:"auto",fontSize:10,fontWeight:600,color:urgColor,background:urgColor+"18",padding:"3px 8px",borderRadius:4,border:`1px solid ${urgColor}33`}}>{urg}</span>
  </div>
  <div style={{fontSize:12,color:"#94a3b8",marginBottom:8,lineHeight:1.7}}>{clause.relevance}</div>
  {clause.kt_position && <div style={{fontSize:12,color:"#93c5fd",background:"#1e293b",padding:"8px 12px",borderRadius:6,borderLeft:"2px solid #3b82f6",lineHeight:1.7}}>{clause.kt_position}</div>}
  {hasFullText && (
   <button onClick={()=>onViewFull(clause.clause_id)} style={{marginTop:10,fontSize:11,color:docColor,background:docColor+"12",border:`1px solid ${docColor}33`,borderRadius:5,padding:"4px 12px",cursor:"pointer",fontFamily:"inherit",fontWeight:600,transition:"opacity 0.15s"}}>
    원문 보기 →
   </button>
  )}
 </div>
 );
}

function ActionCard({ action, index, onOpen }) {
 const STEP_COLORS = ["#ef4444","#f59e0b","#3b82f6","#22c55e","#a78bfa"];
 const color = STEP_COLORS[index % STEP_COLORS.length];
 const clauseIds = (action.clauses||"").split(",").map(s=>s.trim()).filter(s=>s && s!=="없음");
 return (
 <div style={{display:"flex",gap:12,padding:"14px 16px",background:"#0f172a",borderRadius:8,border:`1px solid #334155`,marginBottom:8,borderLeft:`3px solid ${color}`}}>
  <div style={{minWidth:60,textAlign:"center",flexShrink:0}}>
   <div style={{fontSize:10,fontWeight:700,color,background:color+"18",padding:"3px 8px",borderRadius:4,marginBottom:4,border:`1px solid ${color}33`}}>{action.step||`STEP ${index+1}`}</div>
   <div style={{fontSize:10,color:"#64748b",lineHeight:1.4}}>{action.timeframe}</div>
  </div>
  <div style={{flex:1}}>
   <div style={{fontSize:13,color:"#cbd5e1",lineHeight:1.8,marginBottom:clauseIds.length>0?10:0}}>
    {linkifyClauses(action.action, onOpen)}
   </div>
   {clauseIds.length>0 && (
    <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
     {clauseIds.map(cid=>{
      const kb = CONTRACT_KB.clauses.find(c=>c.id===cid);
      const dc = DOC_COLOR[kb?.doc] || "#60a5fa";
      return (
       <span key={cid} onClick={()=>onOpen&&onOpen(cid)}
        style={{fontSize:10,fontWeight:600,color:dc,background:dc+"14",border:`1px solid ${dc}40`,borderRadius:4,padding:"2px 8px",cursor:"pointer"}}
        title={kb ? kb.topic : cid}>
        {cid}
       </span>
      );
     })}
    </div>
   )}
  </div>
 </div>
 );
}

// --- DOCUMENT UPLOADER --------------------------------------------------------

// --- DOCUMENT MANAGER TAB -----------------------------------------------------
function DocumentManagerTab({ onKBUpdated, onAmendmentsFromUpload, onOpenClause }) {
 const [docs, setDocs] = useState([]); // 등록된 문서 목록
 const [clauses, setClauses] = useState(CONTRACT_KB.clauses); // 전체 조항 (기본값: 하드코딩 KB)
 const [conflicts, setConflicts] = useState(CONTRACT_KB.conflicts); // 전체 충돌 (기본값: 하드코딩 KB)
 const [uploading, setUploading] = useState(false);
 const [checking, setChecking] = useState(false);
 const [uploadStatus, setUploadStatus] = useState(null);
 const [conflictStatus, setConflictStatus] = useState(null);
 const [selectedDoc, setSelectedDoc] = useState(null); // 조항 보기 패널
 const [showClauses, setShowClauses] = useState(false);
 const fileRef = useRef(null);
 const [newDocType, setNewDocType] = useState("SAA");
 const [pendingAmendment, setPendingAmendment] = useState(null);
const [applyGuardChecked, setApplyGuardChecked] = useState(false);
const [expandedPendingRows, setExpandedPendingRows] = useState({});
 const [conflictScope, setConflictScope] = useState('all');

 useEffect(() => {
 (async () => {
 const savedVersion = await DocDB.loadVersion();
 if (savedVersion !== KB_VERSION) {
  await DocDB.saveClauses(CONTRACT_KB.clauses);
  await DocDB.saveConflicts(CONTRACT_KB.conflicts);
  await DocDB.saveVersion(KB_VERSION);
 }
 const { docs: d, clauses: c, conflicts: cf } = await DocDB.load();
 if (d) setDocs(d);
 if (c) { setClauses(c); CONTRACT_KB.clauses = c; }
 if (cf) { setConflicts(cf); CONTRACT_KB.conflicts = cf; }
 if (c) for (const cl of c) {
 if (cl.text) CLAUSE_FULLTEXT[cl.id] = {
 doc: cl.doc, section: cl.section||cl.id, title: cl.title||cl.topic,
 text: cl.text, translation: cl.translation||"", context: cl.context||""
 };
 }
 })();
 }, []);

 const syncKB = async (newClauses, newConflicts, newDocs) => {
 const c = newClauses ?? clauses;
 const cf = newConflicts ?? conflicts;
 const d = newDocs ?? docs;
 CONTRACT_KB.clauses = c;
 CONTRACT_KB.conflicts = cf;
 for (const cl of c) {
 if (cl.text) CLAUSE_FULLTEXT[cl.id] = {
 doc: cl.doc, section: cl.section||cl.id, title: cl.title||cl.topic,
 text: cl.text, translation: cl.translation||"", context: cl.context||""
 };
 }
 await DocDB.saveDocs(d);
 await DocDB.saveClauses(c);
 await DocDB.saveConflicts(cf);
 if (onKBUpdated) onKBUpdated({ docs: d, clauses: c, conflicts: cf });
 };

 // -- 파일 업로드 & 조항 추출 -------------------------------------------------
 const handleUpload = async (files) => {
 if (!files || files.length === 0 || uploading) return;
 for (const file of Array.from(files)) {
 await processFile(file);
 }
 };

 const processFile = async (file) => {
 const ext = file.name.split('.').pop().toLowerCase();
 if (!['pdf','docx','doc','txt'].includes(ext)) return;
 setUploading(true);
 setChecking(false);
 setConflictStatus(null);
 setRightView('clauses');
 setUploadStatus({ name: file.name, status: 'extracting', msg: 'AI가 조항 추출 중...' });

 const extractBalancedJson = (text, openChar) => {
  const closeChar = openChar === '{' ? '}' : ']';
  const start = text.indexOf(openChar);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let quote = '';
  let esc = false;
  for (let i = start; i < text.length; i++) {
   const ch = text[i];
   if (inStr) {
    if (esc) esc = false;
    else if (ch === '\\') esc = true;
    else if (ch === quote) { inStr = false; quote = ''; }
    continue;
   }
   if (ch === '"' || ch === "'" || ch === '`') { inStr = true; quote = ch; continue; }
   if (ch === openChar) depth++;
   else if (ch === closeChar) {
    depth--;
    if (depth === 0) return text.slice(start, i + 1);
   }
  }
  return null;
 };

 const parseAmendmentPayload = (text) => {
  const cleaned = (text || '').replace(/[\x60]{3}json|[\x60]{3}/g, '').trim();
  const candidates = [cleaned, extractBalancedJson(cleaned, '{')].filter(Boolean);
  for (const c of candidates) {
   try {
    const parsed = JSON.parse(c);
    if (parsed && Array.isArray(parsed.patches)) return parsed;
    if (parsed?.result && Array.isArray(parsed.result.patches)) return parsed.result;
    if (parsed?.data && Array.isArray(parsed.data.patches)) return parsed.data;
   } catch (e) {}
  }
  return null;
 };

 const parseClauseArrayPayload = (text) => {
  const cleaned = (text || '').replace(/[\x60]{3}json|[\x60]{3}/g, '').trim();
  const arr = extractBalancedJson(cleaned, '[');
  if (arr) {
   try { return JSON.parse(arr); } catch (e) {}
  }
  const obj = extractBalancedJson(cleaned, '{');
  if (obj) {
   try {
    const parsed = JSON.parse(obj);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.clauses)) return parsed.clauses;
   } catch (e) {}
  }
  return null;
 };

   const splitAmendmentChunks = (text, size = 2000, overlap = 250) => {
    const src = (text || "").replace(/\r\n/g, "\n").trim();
    if (!src) return [];
    if (src.length <= size) return [src];
    const chunks = [];
    let start = 0;
    while (start < src.length) {
     let end = Math.min(src.length, start + size);
     const windowText = src.slice(start, end);
     const paraBreak = windowText.lastIndexOf("\n\n");
     const lineBreak = windowText.lastIndexOf("\n");
     if (paraBreak > Math.floor(size * 0.55)) end = start + paraBreak;
     else if (lineBreak > Math.floor(size * 0.7)) end = start + lineBreak;
     const piece = src.slice(start, end).trim();
     if (piece) chunks.push(piece);
     if (end >= src.length) break;
     start = Math.max(0, end - overlap);
    }
    return chunks;
   };

   const mergeExtractedClauses = (rows) => {
    const byId = new Map();
    for (const r of rows) {
     const id = r.id;
     if (!id) continue;
     if (!byId.has(id)) {
      byId.set(id, r);
      continue;
     }
     const prev = byId.get(id);
     const pickLonger = (a, b) => ((b || "").length > (a || "").length ? b : a);
     byId.set(id, {
      ...prev,
      topic: pickLonger(prev.topic, r.topic),
      core: pickLonger(prev.core, r.core),
      text: pickLonger(prev.text, r.text),
      translation: pickLonger(prev.translation, r.translation),
      context: pickLonger(prev.context, r.context),
      doc: prev.doc || r.doc,
      _changeType: prev._changeType || r._changeType,
     });
    }
    return Array.from(byId.values());
   };

 try {
 let textContent = null, b64 = null, isPDF = false;
 if (ext === 'pdf') {
 b64 = await new Promise((res, rej) => {
 const r = new FileReader();
 r.onload = () => res(r.result.split(',')[1]);
 r.onerror = rej;
 r.readAsDataURL(file);
 });
 textContent = await extractPdfText(file, ({ phase, page, total }) => {
  if (phase === 'text') {
   setUploadStatus({ name: file.name, status: 'extracting', msg: `PDF 텍스트 추출 중... (${page}/${total})` });
  } else if (phase === 'ocr-init') {
   setUploadStatus({ name: file.name, status: 'extracting', msg: '스캔 PDF 감지 — OCR 추출 시작...' });
  } else if (phase === 'ocr') {
   setUploadStatus({ name: file.name, status: 'extracting', msg: `OCR 추출 중... (${page}/${total})` });
  }
 });
 isPDF = true;
 } else if (ext === 'docx' || ext === 'doc') {
 try {
 const mammoth = await import('mammoth');
 const ab = await file.arrayBuffer();
 const res = await mammoth.extractRawText({ arrayBuffer: ab });
 textContent = res.value;
 } catch(e) { textContent = '[DOCX 파싱 실패]'; }
 } else {
 textContent = await file.text();
 }

 let amendmentMeta = null;
 let extracted = null;
 const hasPdfText = isPDF && (textContent || '').trim().length > 120;

 if (newDocType === 'AMD' && (textContent || '').trim().length > 0) {
  const kbRefs = CONTRACT_KB.clauses
  .filter(c => c.doc === 'SAA')
  .slice(0, 60)
  .map(c => `${c.id} | ${c.topic}`)
  .join('\n');
  const chunks = splitAmendmentChunks((textContent || '').slice(0, 50000), 2500, 300);
  const chunkRows = [];

  for (let i = 0; i < chunks.length; i++) {
  const chunk = chunks[i];
  setUploadStatus({ name: file.name, status: 'extracting', msg: `Amendment 청크 추출 중... (${i + 1}/${chunks.length})` });
  const chunkPrompt = `다음 Amendment 텍스트 청크를 분석해 JSON 객체 하나만 출력하시오.

조항 ID 매핑 규칙 (반드시 준수):
- "Sub-clause X.Y.Z" / "Section X.Y.Z" → "SAA-X.Y.Z" (예: Sub-clause 3.2.5.2 → SAA-3.2.5.2)
- "Appendix 6" / "Schedule A Appendix 6" → "SAA-APP6"
- "Appendix 7" / "Schedule A Appendix 7" → "SAA-APP7"
- "Target Market" 정의 변경 → "SAA-RESA-1"
- 그 외 신규 조항 → "SAA-NEW-{번호}"

기존 SAA 조항 목록 (수정이면 이 ID 사용):
${kbRefs}

출력 JSON 스키마:
{
 "docType": "Amendment",
 "effectiveDate": null,
 "summary": "청크 요약",
 "patches": [
  {
  "clauseId": "위 규칙에 따른 조항 ID",
  "changeType": "수정|신규",
  "doc": "SAA",
  "newTopic": "변경 주제 (한국어)",
  "newCore": "변경 핵심 내용 요약 (한국어 1-3문장, 반드시 작성)",
  "newFullText": "변경된 조항 원문 전체",
  "newTranslation": "변경 조항 한국어 전문 번역",
  "newContext": "변경 맥락 및 KT 영향"
  }
 ]
}

중요:
- 순수 JSON만 출력, 설명 금지
- newCore는 반드시 내용 요약을 한국어로 작성 (null/빈 문자열 금지)
- Appendix 전체 교체인 경우 newFullText에 목록 전체 포함
- 이 청크에 변경 조항이 없으면 patches를 빈 배열로 반환

=== Amendment 청크 (${i + 1}/${chunks.length}) ===
${chunk}`;

  const cResp = await fetch('/api/chat', {
   method:'POST', headers:{'Content-Type':'application/json'},
   body: JSON.stringify({ max_tokens: 3500, messages:[{ role:'user', content: chunkPrompt }] })
  });
  const cData = await cResp.json();
  const cRaw = cData.content?.map(c => c.text || '').join('') || '';
  const parsed = parseAmendmentPayload(cRaw);
  if (!parsed || !Array.isArray(parsed.patches)) continue;

  for (const p of parsed.patches) {
   if (!p.clauseId) continue;
   const resolvedId = resolveClauseId(p.clauseId || '', p.doc || 'SAA');
   const prev = clauses.find(c => c.id === resolvedId) || CONTRACT_KB.clauses.find(c => c.id === resolvedId);
   const normalizedChange = prev ? '수정' : '신규';
   const coreVal = p.newCore || p.newText || prev?.core || (p.newFullText || '').slice(0, 200) || p.newTopic || '';
   const textVal = p.newFullText || p.newText || prev?.text || p.newCore || '';
   if (!coreVal && !textVal) continue;
   chunkRows.push({
    id: resolvedId || p.clauseId,
    doc: p.doc || prev?.doc || 'SAA',
    topic: p.newTopic || p.topic || prev?.topic || '변경 조항',
    core: coreVal,
    text: textVal,
    translation: p.newTranslation || prev?.translation || '',
    context: p.newContext || prev?.context || '',
    section: prev?.section || resolvedId || p.clauseId,
    title: prev?.title || p.newTopic || p.topic || 'Amendment',
    kt_risk: prev?.kt_risk || '',
    _changeType: normalizedChange,
   });
  }
  }

  const merged = mergeExtractedClauses(chunkRows);
  if (merged.length > 0) {
  extracted = merged;
  amendmentMeta = {
   docType: 'Amendment',
   effectiveDate: null,
   summary: `${file.name} 청크 추출 완료 (${chunks.length}개 청크, ${merged.length}개 조항)`,
  };
  }
 }

 if (!Array.isArray(extracted) || extracted.length === 0) {
  const prompt = newDocType === 'AMD' ? AMENDMENT_PARSE_PROMPT : CLAUSE_EXTRACT_PROMPT(newDocType, file.name);
  const msgContent = hasPdfText
   ? prompt + '\n\n===문서 내용===\n' + (textContent||'').slice(0, 50000)
  : isPDF
  ? [{ type:'document', source:{ type:'base64', media_type:'application/pdf', data:b64 }},
    { type:'text', text: prompt }]
    : prompt + '\n\n===문서 내용===\n' + (textContent||'').slice(0, 50000);

  const resp = await fetch('/api/chat', {
  method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ max_tokens:8000,
  messages:[{ role:'user', content: msgContent }] })
  });
  const data = await resp.json();
  const raw = data.content?.map(c => c.text||'').join('') || '';

 if (newDocType === 'AMD') {
  amendmentMeta = parseAmendmentPayload(raw);
  if (amendmentMeta && Array.isArray(amendmentMeta.patches) && amendmentMeta.patches.length > 0) {
   extracted = amendmentMeta.patches.map((p, idx) => {
    const clauseId = resolveClauseId(p.clauseId || `AMD-${Date.now()}-${idx+1}`, p.doc || 'SAA');
    const prev = clauses.find(c => c.id === clauseId) || CONTRACT_KB.clauses.find(c => c.id === clauseId);
    const normalizedChange = prev ? '수정' : '신규';
    const coreVal = p.newCore || p.newText || prev?.core || (p.newFullText || '').slice(0, 200) || p.newTopic || '';
    return {
     id: clauseId,
     doc: p.doc || prev?.doc || 'SAA',
     topic: p.newTopic || p.topic || prev?.topic || '변경 조항',
     core: coreVal,
     text: p.newFullText || p.newText || prev?.text || p.newCore || '',
     kt_risk: prev?.kt_risk || '',
     section: prev?.section || clauseId,
     title: prev?.title || p.newTopic || p.topic || 'Amendment',
     translation: p.newTranslation || prev?.translation || '',
     context: p.newContext || prev?.context || '',
    _changeType: normalizedChange,
    };
   }).filter(e => e.id && e.id !== 'undefined' && (e.core || e.text));
  }
 }

 if (!Array.isArray(extracted)) {
  extracted = parseClauseArrayPayload(raw);
  if (!Array.isArray(extracted)) extracted = [];
 }

 // 모델이 { clauses:[...] } 형태를 반환한 경우도 허용
 if (!Array.isArray(extracted) && extracted && Array.isArray(extracted.clauses)) {
 extracted = extracted.clauses;
 }

 // Amendment 업로드 시, 일반 조항 추출이 비어 있으면 전용 패치 파서를 한 번 더 시도
 if (newDocType === 'AMD' && (!Array.isArray(extracted) || extracted.length === 0)) {
 const strictRetryPrompt = AMENDMENT_PARSE_PROMPT + "\n\n중요: 반드시 JSON 객체 하나만 출력하고 patches 배열에 변경 조항을 가능한 한 모두 포함하시오. 설명문/마크다운 금지.";
 const amdMsgContent = hasPdfText
  ? strictRetryPrompt + '\n\n===문서 내용===\n' + (textContent||'').slice(0, 12000)
  : isPDF
   ? [
      { type:'document', source:{ type:'base64', media_type:'application/pdf', data:b64 } },
      { type:'text', text: strictRetryPrompt }
     ]
   : strictRetryPrompt + '\n\n===문서 내용===\n' + (textContent||'').slice(0, 12000);

 const amdResp = await fetch('/api/chat', {
  method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ max_tokens:8000, messages:[{ role:'user', content: amdMsgContent }] })
 });
 const amdData = await amdResp.json();
 const amdRaw = amdData.content?.map(c => c.text||'').join('') || '';
 const amdParsed = parseAmendmentPayload(amdRaw);

 if (amdParsed && Array.isArray(amdParsed.patches) && amdParsed.patches.length > 0) {
  amendmentMeta = amdParsed;
  extracted = amdParsed.patches.map((p, idx) => {
  const clauseId = resolveClauseId(p.clauseId || `AMD-${Date.now()}-${idx+1}`, p.doc || 'SAA');
   const prev = clauses.find(c => c.id === clauseId) || CONTRACT_KB.clauses.find(c => c.id === clauseId);
    const normalizedChange = prev ? '수정' : '신규';
   const coreVal = p.newCore || p.newText || prev?.core || (p.newFullText || '').slice(0, 200) || p.newTopic || p.topic || '';
   return {
    id: clauseId,
    doc: p.doc || prev?.doc || 'SAA',
    topic: p.newTopic || p.topic || prev?.topic || '변경 조항',
    core: coreVal,
    text: p.newFullText || p.newText || prev?.text || p.newCore || '',
    kt_risk: prev?.kt_risk || '',
    section: prev?.section || clauseId,
    title: prev?.title || p.newTopic || p.topic || 'Amendment',
    translation: p.newTranslation || prev?.translation || '',
    context: p.newContext || prev?.context || '',
    _changeType: normalizedChange,
   };
  }).filter(e => e.id && e.id !== 'undefined' && (e.core || e.text));
 }

 // 마지막 안전장치: JSON이 계속 실패하면 라인 포맷으로 강제 추출
 if (!Array.isArray(extracted) || extracted.length === 0) {
  const linePrompt = `다음 문서에서 Amendment 변경 조항을 가능한 많이 추출하시오.
출력은 반드시 아래 라인 포맷만 사용:
clauseId||changeType||doc||topic||newCore

규칙:
- 한 줄에 한 조항
- changeType은 수정|추가|삭제|대체 중 하나
- clauseId를 모르면 AMD-임시-번호 사용
- 다른 설명 문장 금지`;

  const lineMsgContent = hasPdfText
   ? linePrompt + '\n\n===문서 내용===\n' + (textContent||'').slice(0, 14000)
   : isPDF
    ? [
       { type:'document', source:{ type:'base64', media_type:'application/pdf', data:b64 } },
       { type:'text', text: linePrompt }
      ]
    : linePrompt + '\n\n===문서 내용===\n' + (textContent||'').slice(0, 14000);

  const lineResp = await fetch('/api/chat', {
   method:'POST', headers:{'Content-Type':'application/json'},
   body: JSON.stringify({ max_tokens:3000, messages:[{ role:'user', content: lineMsgContent }] })
  });
  const lineData = await lineResp.json();
  const lineRaw = lineData.content?.map(c => c.text||'').join('') || '';
  const lines = lineRaw
   .split(/\r?\n/)
   .map(s => s.trim())
   .filter(s => s && s.includes('||') && !s.startsWith('```'));

  const ERROR_KEYWORDS = /파싱\s*실패|분석\s*불가|추출\s*불가|오류|error|failed|cannot/i;
  const parsedLines = lines.map((line, idx) => {
   const parts = line.split('||').map(s => (s || '').trim());
   if (parts.length < 4) return null;
   const [clauseIdRaw, changeTypeRaw, docRaw, topicRaw, coreRaw] = parts;
   // 오류 메시지가 포함된 라인은 무시
   if (ERROR_KEYWORDS.test(topicRaw) || ERROR_KEYWORDS.test(coreRaw || '')) return null;
   if (!clauseIdRaw || clauseIdRaw.length < 2) return null;
   const clauseId = resolveClauseId(clauseIdRaw, docRaw || 'SAA');
   const prev = clauses.find(c => c.id === clauseId) || CONTRACT_KB.clauses.find(c => c.id === clauseId);
   const changeType = /수정|추가|삭제|대체/.test(changeTypeRaw) ? changeTypeRaw.match(/수정|추가|삭제|대체/)[0] : (prev ? '수정' : '추가');
   const coreVal = coreRaw || prev?.core || '';
   if (!coreVal && !prev?.text) return null;
   return {
    id: clauseId,
    doc: docRaw || prev?.doc || 'SAA',
    topic: topicRaw || prev?.topic || '변경 조항',
    core: coreVal,
    text: prev?.text || coreRaw || '',
    kt_risk: prev?.kt_risk || '',
    section: prev?.section || clauseId,
    title: prev?.title || topicRaw || 'Amendment',
    translation: prev?.translation || '',
    context: prev?.context || '',
    _lineExtracted: true,
    _lineChangeType: changeType,
    _changeType: changeType === '추가' ? '신규' : changeType,
   };
  }).filter(Boolean);

  if (parsedLines.length > 0) {
   extracted = parsedLines;
   amendmentMeta = amendmentMeta || {
    docType: 'Amendment',
    effectiveDate: null,
    summary: `${file.name} 업로드 — 라인 파서로 ${parsedLines.length}개 조항 추출`,
   };
  }
 }
 }
 }

 if (!Array.isArray(extracted) || extracted.length === 0) {
 setUploadStatus({ name: file.name, status:'warn', msg: hasPdfText ? '추출된 조항 없음 (파싱 규칙 불일치)' : '추출된 조항 없음 (PDF 본문 인식 실패 가능)' });
 setUploading(false); return;
 }

 const rawData = isPDF
  ? { type: "pdf", b64, mediaType: "application/pdf" }
  : { type: "text", text: (textContent||"").slice(0, 80000) };

 if (newDocType === 'AMD') {
  setShowUploadPanel(true);
  setPendingAmendment({
   fileName: file.name,
   fileSize: file.size,
   extracted: extracted.map((ec, idx) => {
    const prev = clauses.find(c => c.id === ec.id) || CONTRACT_KB.clauses.find(c => c.id === ec.id);
    const nextType = ec._changeType || ec._lineChangeType || (prev ? '수정' : '신규');
    const suspicious = !ec.id || ec.id.startsWith('AMD-') || (ec.core || '').trim().length < 16;
    return {
     ...ec,
     _reviewId: `${ec.id || 'NOID'}-${idx}`,
     _selected: true,
     _prevCore: prev?.core || '',
     _prevTopic: prev?.topic || '',
     _prevExists: !!prev,
     _changeType: nextType,
     _suspicious: suspicious,
    };
   }),
   amendmentMeta,
   rawData,
  });
  setExpandedPendingRows({});
  setApplyGuardChecked(false);
  setUploadStatus({ name: file.name, status:'ok', msg: `${extracted.length}개 조항 추출 완료 — 검토 후 반영하세요` });
  setUploading(false);
  return;
 }

 const docEntry = {
 id: `doc_${Date.now()}`,
 fileName: file.name,
 docType: newDocType,
 uploadedAt: new Date().toLocaleString('ko-KR'),
 clauseCount: extracted.length,
 fileSize: file.size,
 isAmendment: false,
 amendedDocId: null,
 };
 // 원문 저장 (이슈 분석 시 직접 첨부용)
 await DocDB.saveRaw(docEntry.id, rawData);

 let newClauses;
 const sameDocIds = docs.filter(d=>d.docType===newDocType).map(d=>d.id);
 const docsToRemove = docs.filter(d=>d.docType===newDocType&&d.id!==docEntry.id).map(d=>d.id);
 newClauses = clauses.filter(c => !docsToRemove.includes(c._docId)).concat(
 extracted.map(e => ({ ...e, _docId: docEntry.id }))
 );

 const newDocs = [docEntry, ...docs.filter(d => d.docType !== newDocType)];
 const newConflicts = conflicts; // 충돌은 별도로 재검토

 setClauses(newClauses);
 setDocs(newDocs);
 await syncKB(newClauses, newConflicts, newDocs);

 setUploadStatus({ name: file.name, status:'ok', msg: `${extracted.length}개 조항 추출 완료` });

 } catch(e) {
 console.error(e);
 setUploadStatus({ name: file.name, status:'error', msg:'실패: '+e.message });
 }
 setUploading(false);
 };

 const applyPendingAmendment = async () => {
  if (!pendingAmendment) return;
  const extracted = (pendingAmendment.extracted || []).filter(x => x._selected !== false);
  if (extracted.length === 0) {
   setUploadStatus({ name: pendingAmendment.fileName, status:'warn', msg:'선택된 조항이 없습니다. 반영 대상을 선택하세요' });
   return;
  }

  const suspiciousCount = extracted.filter(x => x._suspicious).length;
  const newCount = extracted.filter(x => x._changeType === '신규').length;
  const riskHeavy = suspiciousCount > 0 || (newCount > 0 && newCount / extracted.length >= 0.5);
  if (riskHeavy && !applyGuardChecked) {
   setUploadStatus({ name: pendingAmendment.fileName, status:'warn', msg:'위험 징후가 있어 추가 확인이 필요합니다' });
   return;
  }

  const fileName = pendingAmendment.fileName;
  const amendmentMeta = pendingAmendment.amendmentMeta || null;
  const ts = new Date().toLocaleString('ko-KR');

  const docEntry = {
   id: `doc_${Date.now()}`,
   fileName,
   docType: 'AMD',
   uploadedAt: ts,
   clauseCount: extracted.length,
   fileSize: pendingAmendment.fileSize || 0,
   isAmendment: true,
   amendedDocId: null,
  };

  await DocDB.saveRaw(docEntry.id, pendingAmendment.rawData);

  const newClauses = [...clauses];
  for (const ec of extracted) {
   const idx = newClauses.findIndex(c => c.id === ec.id);
   if (idx >= 0) {
    newClauses[idx] = { ...ec, _amended:true, _amendedBy: fileName, _prevCore: newClauses[idx].core };
   } else {
    newClauses.push({ ...ec, _new:true, _amendedBy: fileName, _docId: docEntry.id });
   }
  }

  const newDocs = [docEntry, ...docs];
  setClauses(newClauses);
  setDocs(newDocs);
  await syncKB(newClauses, conflicts, newDocs);

  const amdPatches = extracted.map(ec => {
   const prev = clauses.find(c => c.id === ec.id);
   return {
    clauseId: ec.id,
    changeType: ec._changeType || ec._lineChangeType || (prev ? '수정' : '신규'),
    prevCore: prev?.core || null,
    newCore: ec.core,
    topic: ec.topic,
    amendedBy: `${fileName} (${ts})`,
   };
  });

  const amdEntry = {
   id: Date.now(),
   fileName,
   uploadedAt: ts,
   docType: amendmentMeta?.docType || 'Amendment',
   effectiveDate: amendmentMeta?.effectiveDate || null,
   summary: amendmentMeta?.summary || `${fileName} 반영 — ${amdPatches.length}개 조항 변경`,
   patches: amdPatches,
  };

  try {
   const stored = await storage.get('kb_patches_v1');
   const existing = stored ? JSON.parse(stored) : [];
   const nextPatches = [amdEntry, ...existing].slice(0, 30);
   await storage.set('kb_patches_v1', JSON.stringify(nextPatches));
   if (onAmendmentsFromUpload) {
    onAmendmentsFromUpload(nextPatches.map(h => ({
     id: h.id, fileName: h.fileName, docType: h.docType,
     effectiveDate: h.effectiveDate, summary: h.summary,
     uploadedAt: h.uploadedAt,
     changes: h.patches.map(p => ({
      clauseId: p.clauseId, changeType: p.changeType,
      newText: p.newCore, prevCore: p.prevCore, topic: p.topic
     }))
    })));
   }
  } catch(e) {
   console.warn('patchHistory 저장 실패:', e);
  }

  setPendingAmendment(null);
  setExpandedPendingRows({});
  setUploadStatus({ name: fileName, status:'ok', msg: `${extracted.length}개 조항 반영 완료 — 충돌 재검토 실행` });
  await runConflictCheck(newClauses, { force: true, amendmentClauseIds: extracted.map(x => x.id).filter(Boolean) });
 };

 const discardPendingAmendment = () => {
  if (!pendingAmendment) return;
  setPendingAmendment(null);
   setExpandedPendingRows({});
  setApplyGuardChecked(false);
  setUploadStatus({ name: pendingAmendment.fileName, status:'warn', msg:'추출 결과가 반영되지 않았습니다' });
 };

const togglePendingRow = (reviewId) => {
 if (!pendingAmendment) return;
 setPendingAmendment(prev => {
  if (!prev) return prev;
  const nextRows = (prev.extracted || []).map(r => r._reviewId === reviewId ? { ...r, _selected: !r._selected } : r);
  return { ...prev, extracted: nextRows };
 });
};

const toggleAllPendingRows = (selected) => {
 if (!pendingAmendment) return;
 setPendingAmendment(prev => {
  if (!prev) return prev;
  const nextRows = (prev.extracted || []).map(r => ({ ...r, _selected: selected }));
  return { ...prev, extracted: nextRows };
 });
};

const togglePendingExpand = (reviewId) => {
 setExpandedPendingRows(prev => ({ ...prev, [reviewId]: !prev[reviewId] }));
};

 // -- 충돌 재검토 --------------------------------------------------------------
const runConflictCheck = async (clausesToCheck, options = {}) => {
const force = !!options.force;
if (!force && (uploading || pendingAmendment)) {
setConflictStatus({ status:'warn', msg:'추출/검토 중에는 충돌 재검토를 실행할 수 없습니다' });
return;
}
 const cl = clausesToCheck || clauses;
 const focusClauseIds = Array.isArray(options.amendmentClauseIds) ? options.amendmentClauseIds.filter(Boolean) : [];
 const focusSet = new Set(focusClauseIds);
 if (cl.length === 0) {
 setConflictStatus({ status:'warn', msg:'조항이 없습니다' });
 return;
 }
 setChecking(true);
 setConflictScope(focusSet.size > 0 ? 'amendment-only' : 'all');
 setConflictStatus({ status:'running', msg: focusSet.size > 0 ? `${cl.length}개 조항 중 Amendment 연관 충돌 검토 중...` : `${cl.length}개 조항 충돌 검토 중...` });

 try {
 const resp = await fetch('/api/chat', {
 method:'POST', headers:{'Content-Type':'application/json'},
 body: JSON.stringify({ max_tokens:3000,
 messages:[{ role:'user', content: CONFLICT_CHECK_PROMPT(cl, { focusClauseIds }) }] })
 });
 const data = await resp.json();
 const raw = data.content?.map(c=>c.text||'').join('') || '';
 let json = raw.replace(/[\x60]{3}json|[\x60]{3}/g,'').trim();
 if (!json.endsWith(']')) {
 const lastObj = json.lastIndexOf('}');
 json = lastObj > 0 ? json.slice(0, lastObj+1).replace(/,$/, '') + ']' : '[]';
 }
 const _cs = json.indexOf('['), _ce = json.lastIndexOf(']');
 if (_cs !== -1 && _ce > _cs) json = json.slice(_cs, _ce + 1);
 json = json.replace(/[\x00-\x1f]/g, m => (m==='\n'||m==='\t') ? ' ' : '');
 let newConflicts;
 try {
 newConflicts = JSON.parse(json);
 } catch(e) {
 const objs = json.match(/\{[^{}]+\}/g)||[];
 newConflicts = objs.map(o=>{try{return JSON.parse(o);}catch(e){return null;}}).filter(Boolean);
 if (newConflicts.length===0) throw new Error('충돌 JSON 파싱 실패: '+e.message);
 }

 const knownIds = cl.map(x => x.id).filter(Boolean);
 const extractIdsFromText = (text) => {
  const src = String(text || '');
  return knownIds.filter(id => src.includes(id));
 };
 const normalizeOne = (cf, idx) => {
  const baseIds = Array.isArray(cf?.clauseIds) ? cf.clauseIds.filter(Boolean) : [];
  const recovered = baseIds.length > 0 ? baseIds : extractIdsFromText((cf?.summary || '') + ' ' + (cf?.why || ''));
  const uniqIds = Array.from(new Set(recovered));
  return {
   id: cf?.id || `XC-NEW-${String(idx + 1).padStart(3, '0')}`,
   risk: ['HIGH','MEDIUM','LOW'].includes(String(cf?.risk || '').toUpperCase()) ? String(cf.risk).toUpperCase() : 'MEDIUM',
   topic: cf?.topic || '조항 충돌',
   summary: cf?.summary || `${uniqIds.join(' vs ')} 충돌 가능성`,
   why: cf?.why || cf?.detail || '',
   impact: cf?.impact || '',
   resolution: cf?.resolution || cf?.recommendation || '',
   clauseIds: uniqIds,
  };
 };
 newConflicts = (Array.isArray(newConflicts) ? newConflicts : []).map(normalizeOne).filter(cf => Array.isArray(cf.clauseIds) && cf.clauseIds.length >= 2);

 if (focusSet.size > 0) {
  newConflicts = newConflicts.filter(cf => {
   const ids = cf.clauseIds || [];
   const hasFocus = ids.some(id => focusSet.has(id));
   const hasOther = ids.some(id => !focusSet.has(id));
   return hasFocus && hasOther;
  });
 }

 CONTRACT_KB.conflicts = newConflicts;
 setConflicts(newConflicts);
 await DocDB.saveConflicts(newConflicts);
 if (onKBUpdated) onKBUpdated({ docs, clauses: cl, conflicts: newConflicts });

 setConflictStatus({ status:'ok',
 msg: newConflicts.length > 0
 ? `${newConflicts.length}개 충돌 발견${focusSet.size > 0 ? ' (Amendment 연관만 표시)' : ''}`
 : '충돌 없음' });
 } catch(e) {
 setConflictStatus({ status:'error', msg:'충돌 검토 실패: '+e.message });
 }
 setChecking(false);
 };

 // -- 문서 삭제 -------------------------------------------------------------
 const deleteDoc = async (docId) => {
 const doc = docs.find(d=>d.id===docId);
 if (!doc) return;
 if (!window.confirm(doc.fileName + ' 삭제 시 관련 조항도 제거됩니다. 계속?')) return;
 const newDocs = docs.filter(d=>d.id!==docId);
 const newClauses = clauses.filter(c=>c._docId!==docId && c._amendedBy!==doc.fileName);
 setDocs(newDocs);
 setClauses(newClauses);
 if (selectedDoc?.id===docId) setSelectedDoc(null);
 await syncKB(newClauses, conflicts, newDocs);
 if (newClauses.length > 0) {
 await runConflictCheck(newClauses, { force: true });
 } else {
 setConflicts([]);
 CONTRACT_KB.conflicts = [];
 await DocDB.saveConflicts([]);
 if (onKBUpdated) onKBUpdated({ docs: newDocs, clauses: [], conflicts: [] });
 }
 };

 // -- 전체 초기화 -----------------------------------------------------------
 const resetToOriginal = async () => {
 if (!confirm('모든 문서 데이터를 삭제하고 원본 하드코딩 KB로 복원합니까?')) return;
 await DocDB.clear();
 setDocs([]); setClauses([]); setConflicts([]);
 setUploadStatus(null); setConflictStatus(null);
 window.location.reload();
 };

 const fmt = b => b>1024*1024?(b/1024/1024).toFixed(1)+'MB':Math.round(b/1024)+'KB';
 const typeClauseCount = (dt) => clauses.filter(c=>c.doc===dt||c.doc?.startsWith(dt)).length;
 const statusColor = s => s==='ok'?'#10b981':s==='error'?'#ff2d20':s==='warn'?'#f59e0b':'#60a5fa';

 const docClauses = selectedDoc ? clauses.filter(c=>c._docId===selectedDoc.id || c._amendedBy===selectedDoc.fileName) : [];

 const DOC_TYPE_KO = {
 SAA: { name:"전략적 제휴 계약서", short:"SAA", color:"#60a5fa", desc:"Palantir Korea와 KT 간 기본 계약" },
 TOS: { name:"서비스 이용약관", short:"TOS", color:"#f59e0b", desc:"플랫폼 이용 조건 및 책임 규정" },
 OF: { name:"주문서 (Order Form)", short:"OF", color:"#a78bfa", desc:"OF3(인에이블먼트), OF4(플랫폼 라이선스) 등" },
 REG: { name:"사내 규정", short:"내규", color:"#34d399", desc:"KT 내부 규정 (하도급, 회계, 정보보호 등)" },
 AMD: { name:"계약 변경서", short:"Amendment", color:"#fb923c", desc:"기존 계약 조항의 수정·추가·삭제" },
 NEW: { name:"신규 계약서", short:"신규", color:"#e879f9", desc:"신규 체결 계약" },
 OTHER: { name:"기타 문서", short:"기타", color:"#94a3b8", desc:"기타 참고 문서" },
 };

 const [showUploadPanel, setShowUploadPanel] = useState(false);
 const [rightView, setRightView] = useState('conflicts'); // 'clauses' | 'conflicts'

 const totalAmended = clauses.filter(c=>c._amended).length;
 const highConflicts = conflicts.filter(c=>c.risk==='HIGH').length;

 return (
 <div style={{display:'grid', gridTemplateColumns:'300px 1fr', height:'100%', overflow:'hidden'}}>

 {/* -- 왼쪽 패널 -- */}
 <div style={{borderRight:'1px solid #1a1a2e', display:'flex', flexDirection:'column', overflow:'hidden', background:'#0a0a14'}}>

 {/* 요약 카드 */}
 <div style={{padding:'14px 16px', borderBottom:'1px solid #1a1a2e'}}>
 <div style={{fontSize:11, color:'#8899aa', marginBottom:10, fontWeight:600}}>계약서 · 규정 현황</div>
 <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6}}>
 {[
 { label:'등록 문서', value: docs.length > 0 ? docs.length+'건' : '기본', sub: docs.length > 0 ? '직접 업로드' : '하드코딩 KB', color:'#60a5fa' },
 { label:'전체 조항', value: clauses.length+'개', sub: totalAmended > 0 ? `수정됨 ${totalAmended}개` : '변경 없음', color:'#a78bfa' },
 { label:'충돌 탐지', value: conflicts.length+'건', sub: highConflicts > 0 ? `HIGH ${highConflicts}건` : '양호', color: highConflicts > 0 ? '#ff2d20' : '#10b981' },
 ].map((s,i) => (
 <div key={i} style={{background:'#0f0f1a', borderRadius:5, padding:'8px 10px', border:'1px solid #1e2030'}}>
 <div style={{fontSize:11, color:'#475569', marginBottom:3}}>{s.label}</div>
 <div style={{fontSize:13, fontWeight:700, color:s.color, marginBottom:2}}>{s.value}</div>
 <div style={{fontSize:10, color:'#6677aa'}}>{s.sub}</div>
 </div>
 ))}
 </div>
 </div>

 {/* 문서 추가 버튼 */}
 <div style={{padding:'10px 16px', borderBottom:'1px solid #1a1a2e'}}>
 <button onClick={()=>setShowUploadPanel(!showUploadPanel)}
 style={{width:'100%', padding:'8px', borderRadius:5, border:'1px dashed #1e3a6e',
 background:showUploadPanel?'#0f1e35':'transparent', color:'#60a5fa', fontSize:11,
 fontWeight:600, cursor:'pointer', fontFamily:'inherit', transition:'all 0.15s'}}>
 {showUploadPanel ? '▲ 업로드 닫기' : '＋ 문서 추가'}
 </button>

 {showUploadPanel && (
 <div style={{marginTop:10}}>
 {/* 문서 종류 선택 */}
 <div style={{fontSize:11, color:'#6677aa', marginBottom:6}}>문서 종류 선택</div>
 <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:4, marginBottom:10}}>
 {Object.entries(DOC_TYPE_KO).map(([k,v]) => (
 <button key={k} onClick={()=>setNewDocType(k)}
 style={{padding:'6px 8px', borderRadius:4, border:`1px solid ${newDocType===k?v.color+'88':'#1e2030'}`,
 background:newDocType===k?v.color+'15':'#0f0f1a', cursor:'pointer', fontFamily:'inherit', textAlign:'left'}}>
 <div style={{fontSize:10, fontWeight:700, color:newDocType===k?v.color:'#8899aa'}}>{v.short}</div>
 <div style={{fontSize:10, color:'#475569', marginTop:1, lineHeight:1.3}}>{v.desc}</div>
 </button>
 ))}
 </div>
 {/* 드롭존 */}
 <div
 onClick={()=>!uploading&&fileRef.current?.click()}
 onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor=DOC_TYPE_KO[newDocType]?.color||'#60a5fa';}}
 onDragLeave={e=>{e.currentTarget.style.borderColor='#1e2030';}}
 onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor='#1e2030';if(!uploading)handleUpload(e.dataTransfer.files);}}
 style={{border:'1px dashed #1e2030', borderRadius:5, padding:'14px', textAlign:'center',
 cursor:uploading?'not-allowed':'pointer', opacity:uploading?0.6:1, transition:'border-color 0.15s',
 background:'#07070f'}}>
 {uploading
 ? <div style={{fontSize:11,color:'#60a5fa'}}>⏳ AI가 조항을 추출하는 중...</div>
 : <>
 <div style={{fontSize:20, marginBottom:4, opacity:0.3}}>◻</div>
 <div style={{fontSize:11, color:'#8899aa', marginBottom:2}}>
 파일을 여기에 끌어다 놓거나 클릭
 </div>
 <div style={{fontSize:11, color:'#475569'}}>PDF · DOCX · TXT 지원</div>
 </>
 }
 </div>
 <input ref={fileRef} type='file' multiple accept='.pdf,.docx,.doc,.txt'
 style={{display:'none'}} onChange={e=>handleUpload(e.target.files)}/>
 {uploadStatus && (
 <div style={{marginTop:6, padding:'6px 8px', borderRadius:4,
 background:statusColor(uploadStatus.status)+'10',
 border:`1px solid ${statusColor(uploadStatus.status)}33`}}>
 <div style={{fontSize:11, color:statusColor(uploadStatus.status), fontWeight:600, marginBottom:1}}>{uploadStatus.name}</div>
 <div style={{fontSize:11, color:statusColor(uploadStatus.status)}}>{uploadStatus.msg}</div>
 </div>
 )}
 </div>
 )}
 </div>

 {/* 충돌 재검토 버튼 */}
 <div style={{padding:'8px 16px', borderBottom:'1px solid #1a1a2e'}}>
 <button onClick={()=>runConflictCheck()} disabled={checking || uploading || !!pendingAmendment}
 style={{width:'100%', padding:'6px', borderRadius:4, border:`1px solid ${(checking || uploading || !!pendingAmendment)?'#1e2030':'#a78bfa44'}`,
 background:(checking || uploading || !!pendingAmendment)?'#0f1525':'#1a1040', color:(checking || uploading || !!pendingAmendment)?'#6677aa':'#a78bfa',
 fontSize:10, fontWeight:600, cursor:(checking || uploading || !!pendingAmendment)?'not-allowed':'pointer', fontFamily:'inherit'}}>
 {(checking || uploading) ? '⏳ 충돌 검토 중...' : pendingAmendment ? '⏸ 검토 승인 후 실행 가능' : '🔍 조항 간 충돌 재검토'}
 </button>
 {conflictStatus && (
 <div style={{marginTop:4, fontSize:11, color:statusColor(conflictStatus.status), textAlign:'center'}}>
 {conflictStatus.msg}
 </div>
 )}
 </div>

 {/* 문서 목록 */}
 <div style={{flex:1, overflowY:'auto', padding:'10px 16px'}}>

 {/* 기본 제공 문서 */}
 {(() => {
 const builtinGroups = {};
 for (const c of CONTRACT_KB.clauses) {
 const docKey = c.doc || 'OTHER';
 if (!builtinGroups[docKey]) builtinGroups[docKey] = [];
 builtinGroups[docKey].push(c);
 }
 const builtinDocs = [
 { key:'SAA', label:'전략적 제휴 계약서 (SAA)', color:'#60a5fa', desc:'Palantir Korea ↔ KT 기본 계약' },
 { key:'TOS', label:'서비스 이용약관 (TOS)', color:'#f59e0b', desc:'플랫폼 이용 조건 및 책임' },
 { key:'OF3', label:'주문서 3 (인에이블먼트)', color:'#a78bfa', desc:'$9M 교육 프로그램, Non-Solicitation' },
 { key:'OF4', label:'주문서 4 (플랫폼 라이선스)', color:'#a78bfa', desc:'$27M 5년 라이선스, Azure 클라우드' },
 { key:'하도급지침', label:'하도급 지침', color:'#fb923c', desc:'KT 내규 — 대금 지급 기한 등' },
 { key:'정보보호지침',label:'정보보호 지침', color:'#0ea5e9', desc:'KT 내규 — CISO 승인, 가급 자산' },
 { key:'회계규정', label:'회계 규정', color:'#e879f9', desc:'KT 내규 — 예산 집행 원칙' },
 { key:'계약규정', label:'계약 규정', color:'#f43f5e', desc:'KT 내규 — 계약서 필수 기재사항' },
 { key:'협력사선정지침',label:'협력사 선정 지침', color:'#84cc16', desc:'KT 내규 — 협력사 등록 요건' },
 ];
 return (
 <>
 <div style={{fontSize:11, color:'#475569', marginBottom:8, display:'flex', alignItems:'center', gap:6}}>
 기본 제공 문서
 <span style={{background:'#1e2030', padding:'1px 6px', borderRadius:2}}>내장</span>
 </div>
 {builtinDocs.map(bd => {
 const groupClauses = builtinGroups[bd.key] || [];
 if (groupClauses.length === 0) return null;
 const isSelected = selectedDoc?.id === 'builtin_'+bd.key;
 const fakeDoc = { id:'builtin_'+bd.key, fileName:bd.label, docType:bd.key, _builtin:true };
 return (
 <div key={bd.key}
 onClick={()=>{ setSelectedDoc(isSelected?null:fakeDoc); }}
 style={{marginBottom:5, borderRadius:5, padding:'8px 10px', cursor:'pointer',
 border:`1px solid ${isSelected?bd.color+'55':'#1e2030'}`,
 background:isSelected?bd.color+'0a':'#0f0f1a'}}>
 <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:2}}>
 <span style={{fontSize:11, fontWeight:700, color:bd.color,
 background:bd.color+'18', padding:'1px 5px', borderRadius:2}}>내장</span>
 <span style={{fontSize:10, color:'#c8d0dc', flex:1, fontWeight:500}}>{bd.label}</span>
 <span style={{fontSize:11, color:'#475569'}}>{groupClauses.length}개</span>
 </div>
 <div style={{fontSize:11, color:'#475569'}}>{bd.desc}</div>
 </div>
 );
 })}
 </>
 );
 })()}

 {/* 업로드한 문서 */}
 {docs.length > 0 && (
 <>
 <div style={{fontSize:11, color:'#475569', margin:'14px 0 8px', display:'flex', alignItems:'center', gap:6}}>
 업로드된 문서
 <span style={{background:'#1e2030', padding:'1px 6px', borderRadius:2}}>{docs.length}건</span>
 </div>
 {docs.map(d => {
 const tc = DOC_TYPE_KO[d.docType] || { short:d.docType, color:'#8899aa' };
 const isSelected = selectedDoc?.id === d.id;
 const dClauses = clauses.filter(c=>c._docId===d.id||c._amendedBy===d.fileName);
 return (
 <div key={d.id}
 onClick={()=>{ setSelectedDoc(isSelected?null:d); setRightView('clauses'); }}
 style={{marginBottom:5, borderRadius:5, border:`1px solid ${isSelected?tc.color+'44':'#1e2030'}`,
 background:isSelected?tc.color+'08':'#0f0f1a', cursor:'pointer', padding:'8px 10px'}}>
 <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:2}}>
 <span style={{fontSize:11, fontWeight:700, color:tc.color,
 background:tc.color+'18', padding:'1px 5px', borderRadius:2}}>{tc.short}</span>
 <span style={{fontSize:10, color:'#c8d0dc', flex:1, overflow:'hidden',
 textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{d.fileName}</span>
 <button onClick={e=>{e.stopPropagation();deleteDoc(d.id);}}
 style={{background:'none',border:'none',color:'#475569',cursor:'pointer',
 fontSize:14,padding:'0 2px',fontFamily:'inherit',lineHeight:1}}>×</button>
 </div>
 <div style={{display:'flex', gap:8, fontSize:11, color:'#475569'}}>
 <span>조항 {dClauses.length}개</span>
 <span>{fmt(d.fileSize)}</span>
 {d.isAmendment && <span style={{color:'#fb923c'}}>⚡ 변경서</span>}
 </div>
 </div>
 );
 })}
 <button onClick={resetToOriginal}
 style={{width:'100%', marginTop:8, fontSize:11, color:'#475569', background:'none',
 border:'1px solid #1e2030', borderRadius:3, padding:'5px', cursor:'pointer', fontFamily:'inherit'}}>
 업로드 전체 초기화
 </button>
 </>
 )}
 </div>
 </div>

 {/* -- 오른쪽 패널 -- */}
 <div style={{display:'flex', flexDirection:'column', overflow:'hidden'}}>

 {/* 뷰 전환 탭 */}
 <div style={{display:'flex', borderBottom:'1px solid #1a1a2e', background:'#0a0a14', padding:'0 16px', gap:16}}>
 {[
 ['conflicts', `충돌 현황`, selectedDoc ? conflicts.filter(cf => !cf.docs || cf.docs.includes(selectedDoc.docType)).length : conflicts.length],
 ['clauses', selectedDoc ? selectedDoc.fileName : '전체 조항',
 selectedDoc
 ? selectedDoc._builtin
 ? CONTRACT_KB.clauses.filter(c=>c.doc===selectedDoc.docType).length
 : clauses.filter(c=>c._docId===selectedDoc.id||c._amendedBy===selectedDoc.fileName).length
 : clauses.length],
 ].map(([k, label, count]) => (
 <button key={k} onClick={()=>setRightView(k)}
 style={{padding:'10px 0', fontSize:11, fontWeight:600, border:'none',
 borderBottom:rightView===k?'2px solid #60a5fa':'2px solid transparent',
 background:'transparent', color:rightView===k?'#60a5fa':'#6677aa',
 cursor:'pointer', fontFamily:'inherit'}}>
 {label}
 <span style={{marginLeft:5, fontSize:11, color:'#475569'}}>{count}개</span>
 </button>
 ))}
 {selectedDoc && (
 <span onClick={()=>setSelectedDoc(null)}
 style={{marginLeft:'auto', alignSelf:'center', fontSize:11, color:'#6677aa', cursor:'pointer', padding:'4px 8px',
 background:'#0f0f1a', borderRadius:3, border:'1px solid #1e2030'}}>
 × 전체 보기
 </span>
 )}
 </div>

 {pendingAmendment && (
 <div style={{margin:'12px 16px 0',padding:'10px',borderRadius:6,border:'1px solid #f59e0b44',background:'#1a1408'}}>
 <div style={{fontSize:11,color:'#fbbf24',fontWeight:700,marginBottom:6}}>추출 결과 검토 필요</div>
 <div style={{fontSize:10,color:'#a0b8d0',marginBottom:8}}>
  {pendingAmendment.fileName} · {pendingAmendment.extracted.length}개 조항
  {" · 수정 "}{(pendingAmendment.extracted||[]).filter(x=>x._changeType==='수정').length}
  {" · 신규 "}{(pendingAmendment.extracted||[]).filter(x=>x._changeType==='신규').length}
 </div>
 <div style={{display:'flex',gap:6,marginBottom:8}}>
  <button onClick={()=>toggleAllPendingRows(true)} style={{padding:'4px 8px',borderRadius:4,border:'1px solid #334155',background:'#0f172a',color:'#cbd5e1',fontSize:10,cursor:'pointer',fontFamily:'inherit'}}>전체 선택</button>
  <button onClick={()=>toggleAllPendingRows(false)} style={{padding:'4px 8px',borderRadius:4,border:'1px solid #334155',background:'#0f172a',color:'#cbd5e1',fontSize:10,cursor:'pointer',fontFamily:'inherit'}}>전체 해제</button>
 </div>
 <div style={{maxHeight:200,overflowY:'auto',display:'flex',flexDirection:'column',gap:5,marginBottom:8}}>
 {(pendingAmendment.extracted || []).map((ec, idx) => (
 <div key={ec._reviewId || (ec.id+idx)} style={{padding:'6px 8px',background:'#0f0f1a',border:`1px solid ${ec._suspicious?'#ef444466':'#1e2030'}`,borderRadius:4,opacity:ec._selected===false?0.55:1}}>
 <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
  <input type='checkbox' checked={ec._selected!==false} onChange={()=>togglePendingRow(ec._reviewId || (ec.id+idx))} />
  <div style={{fontSize:10,color:'#60a5fa',fontWeight:700}}>{ec.id || 'ID 없음'} · {ec._changeType || '수정'} · {ec.topic || '주제 없음'}</div>
  {ec._suspicious && <span style={{fontSize:11,color:'#fca5a5',marginLeft:'auto'}}>검토주의</span>}
 </div>
 <div style={{fontSize:12,color:'#94a3b8',lineHeight:1.65}}>이전: {(ec._prevCore || '(기존 없음)').slice(0, 140)}</div>
 <div style={{fontSize:10,color:'#9aaabb',lineHeight:1.55,marginTop:2}}>변경: {(ec.core || '').slice(0, 180)}</div>
 <div style={{marginTop:6,display:'flex',justifyContent:'flex-end'}}>
  <button onClick={()=>togglePendingExpand(ec._reviewId || (ec.id+idx))}
  style={{padding:'3px 8px',borderRadius:4,border:'1px solid #334155',background:'#111827',color:'#cbd5e1',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
  {expandedPendingRows[ec._reviewId || (ec.id+idx)] ? '전문 비교 닫기' : '전문 비교 보기'}
  </button>
 </div>
 {expandedPendingRows[ec._reviewId || (ec.id+idx)] && (
 <div style={{marginTop:6,paddingTop:6,borderTop:'1px solid #1e2030',display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
  <div style={{background:'#0b1220',border:'1px solid #1e293b',borderRadius:4,padding:'6px 7px'}}>
  <div style={{fontSize:11,color:'#93c5fd',fontWeight:700,marginBottom:4}}>변경 전 전문</div>
  <div style={{fontSize:11,color:'#9fb2c8',lineHeight:1.55,whiteSpace:'pre-wrap',maxHeight:160,overflowY:'auto'}}>
   {CLAUSE_FULLTEXT[ec.id]?.text || ec._prevCore || '(기존 전문 없음)'}
  </div>
  </div>
  <div style={{background:'#102014',border:'1px solid #1f3b2f',borderRadius:4,padding:'6px 7px'}}>
  <div style={{fontSize:11,color:'#86efac',fontWeight:700,marginBottom:4}}>변경 후 전문</div>
  <div style={{fontSize:11,color:'#b7d5bf',lineHeight:1.55,whiteSpace:'pre-wrap',maxHeight:160,overflowY:'auto'}}>
   {ec.text || ec.core || '(변경 전문 없음)'}
  </div>
  </div>
 </div>
 )}
 </div>
 ))}
 </div>
 {((pendingAmendment.extracted||[]).filter(x => (x._selected!==false) && x._suspicious).length > 0 || (((pendingAmendment.extracted||[]).filter(x=>x._selected!==false && x._changeType==='신규').length) >= Math.max(1, Math.ceil((pendingAmendment.extracted||[]).filter(x=>x._selected!==false).length/2)))) && (
  <label style={{display:'flex',alignItems:'center',gap:8,marginBottom:8,fontSize:10,color:'#fbbf24'}}>
   <input type='checkbox' checked={applyGuardChecked} onChange={e=>setApplyGuardChecked(e.target.checked)} />
   위험 징후(신규 과다 또는 ID 불명)가 있어도 반영 진행
  </label>
 )}
 <div style={{display:'flex',gap:8}}>
 <button onClick={applyPendingAmendment} style={{padding:'7px 10px',borderRadius:4,border:'1px solid #10b98144',background:'#0a2a1a',color:'#10b981',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
 검토 완료 · KB 반영
 </button>
 <button onClick={discardPendingAmendment} style={{padding:'7px 10px',borderRadius:4,border:'1px solid #64748b44',background:'#101827',color:'#94a3b8',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
 폐기
 </button>
 </div>
 </div>
 )}

 <div style={{flex:1, overflowY:'auto', padding:16}}>

 {/* 충돌 현황 */}
 {rightView === 'conflicts' && (
 conflicts.length === 0
 ? <div style={{textAlign:'center', padding:'40px 0', fontSize:11, color:'#475569', lineHeight:1.8}}>
 탐지된 충돌 없음<br/>
 <span style={{fontSize:9}}>조항을 업로드하거나 충돌 재검토를 실행하세요</span>
 </div>
 : <>
 <div style={{fontSize:10, color:'#6677aa', marginBottom:12}}>
 {selectedDoc
  ? <>선택 문서 관련 충돌 <span style={{color:'#cbd5e1', fontWeight:600}}>{conflicts.filter(cf=>!cf.docs||cf.docs.includes(selectedDoc.docType)).length}건</span> · 전체 {conflicts.length}건</>
  : <>총 {conflicts.length}건의 조항 간 충돌이 탐지되었습니다.</>}
 {conflictScope === 'amendment-only' && <span style={{color:'#fbbf24', marginLeft:6}}>Amendment 변경 조항과 타 조항 간 충돌만 표시</span>}
 {highConflicts > 0 && <span style={{color:'#ff2d20', marginLeft:6}}>HIGH {highConflicts}건 즉시 검토 필요</span>}
 </div>
 {(selectedDoc ? conflicts.filter(cf => !cf.docs || cf.docs.includes(selectedDoc.docType)) : conflicts).map((cf,i) => {
 const rc = RISK_COLOR[cf.risk]||'#8899aa';
 const pairIds = Array.isArray(cf.clauseIds) ? cf.clauseIds.slice(0, 2) : [];
 const pairClauses = pairIds.map(id => clauses.find(c => c.id === id) || CONTRACT_KB.clauses.find(c => c.id === id)).filter(Boolean);
 return (
 <div key={cf.id||i} style={{marginBottom:8, padding:'10px 12px', borderRadius:5,
 border:`1px solid ${rc}33`, background:rc+'08'}}>
 <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:5}}>
 <span style={{fontSize:11, fontWeight:700, color:rc, background:rc+'18', padding:'1px 6px', borderRadius:2}}>{linkifyClauses(cf.id, onOpenClause)}</span>
 <span style={{fontSize:10, color:'#c8d0dc', fontWeight:600, flex:1}}>{cf.topic}</span>
 <span style={{fontSize:11, fontWeight:700, color:rc,
 background:rc+'18', padding:'2px 7px', borderRadius:3}}>{cf.risk}</span>
 </div>
 <div style={{fontSize:10, color:'#cbd5e1', lineHeight:1.6, fontWeight:600}}>{linkifyClauses(cf.summary, onOpenClause)}</div>
 {!!(cf.why || cf.detail) && (
 <div style={{marginTop:4, fontSize:10, color:'#9aaabb', lineHeight:1.6}}>
  왜 충돌? {linkifyClauses(cf.why || cf.detail, onOpenClause)}
 </div>
 )}
 {!!cf.impact && (
 <div style={{marginTop:4, fontSize:10, color:'#fbbf24', lineHeight:1.6}}>
  영향: {linkifyClauses(cf.impact, onOpenClause)}
 </div>
 )}
 {!!(cf.resolution || cf.recommendation) && (
 <div style={{marginTop:4, fontSize:10, color:'#86efac', lineHeight:1.6}}>
  판단 기준/권고: {linkifyClauses(cf.resolution || cf.recommendation, onOpenClause)}
 </div>
 )}
 {pairClauses.length > 0 && (
 <div style={{marginTop:6, display:'grid', gridTemplateColumns:'1fr 1fr', gap:6}}>
  {pairClauses.map((pc, pidx) => (
  <div key={(pc.id || pidx) + '-' + pidx} style={{background:'#0b1220', border:'1px solid #1e293b', borderRadius:4, padding:'5px 6px'}}>
   <div style={{fontSize:11, color:'#93c5fd', fontWeight:700, marginBottom:2}}>{linkifyClauses(pc.id || '', onOpenClause)} · {pc.topic || '주제 없음'}</div>
   <div style={{fontSize:11, color:'#9fb2c8', lineHeight:1.5}}>{linkifyClauses((pc.core || '').slice(0, 180), onOpenClause)}</div>
  </div>
  ))}
 </div>
 )}
 {cf.clauseIds && cf.clauseIds.length > 0 && (
 <div style={{marginTop:5, display:'flex', gap:4, flexWrap:'wrap'}}>
 {cf.clauseIds.map(id=>(
 <span key={id} style={{fontSize:10, color:'#60a5fa', background:'#60a5fa18',
 padding:'1px 5px', borderRadius:2}}>{linkifyClauses(id, onOpenClause)}</span>
 ))}
 </div>
 )}
 </div>
 );
 })}
 </>
 )}

 {/* 조항 목록 */}
 {rightView === 'clauses' && (() => {
 const displayClauses = selectedDoc
 ? selectedDoc._builtin
 ? CONTRACT_KB.clauses.filter(c => c.doc === selectedDoc.docType)
 : clauses.filter(c=>c._docId===selectedDoc.id||c._amendedBy===selectedDoc.fileName)
 : clauses;
 return displayClauses.length === 0
 ? <div style={{textAlign:'center', padding:'40px 0', fontSize:11, color:'#475569', lineHeight:1.8}}>
 {selectedDoc ? '이 문서에서 추출된 조항이 없습니다' : '등록된 조항이 없습니다'}
 </div>
 : displayClauses.map((c,i) => {
 const dc = DOC_COLOR[c.doc] || '#8899aa';
 return (
 <div key={c.id||i} style={{marginBottom:8, padding:'10px 12px', borderRadius:5,
 border:`1px solid ${c._amended?'#fb923c33':c._new?'#10b98133':'#1a1a2e'}`,
 background:c._amended?'#120a04':c._new?'#04120a':'#0a0a14'}}>
 <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:4}}>
 <span style={{fontSize:11, fontWeight:700, color:dc, background:dc+'18',
 padding:'1px 6px', borderRadius:2}}>{linkifyClauses(c.id, onOpenClause)}</span>
 <span style={{fontSize:10, color:'#c8d0dc', fontWeight:600, flex:1}}>{c.topic}</span>
 <button
 onClick={()=>onOpenClause && onOpenClause(c.id)}
 style={{fontSize:10,padding:"2px 8px",background:"#102040",border:"1px solid #3b82f644",borderRadius:3,color:"#93c5fd",cursor:"pointer",fontFamily:"inherit",fontWeight:600,minWidth:56}}
 >
 원문 보기
 </button>
 {c._amended && <span style={{fontSize:10, color:'#fb923c', background:'#fb923c18',
 padding:'1px 5px', borderRadius:2, fontWeight:700}}>수정됨</span>}
 {c._new && <span style={{fontSize:10, color:'#10b981', background:'#10b98118',
 padding:'1px 5px', borderRadius:2, fontWeight:700}}>신규</span>}
 </div>
 <div style={{fontSize:12, color:'#94a3b8', lineHeight:1.7}}>{linkifyClauses(c.core, onOpenClause)}</div>
 {c._prevCore && (
 <div style={{marginTop:5, fontSize:11, color:'#475569', textDecoration:'line-through',
 borderTop:'1px solid #1e2030', paddingTop:4}}>
 이전: {linkifyClauses(c._prevCore, onOpenClause)}
 </div>
 )}
 {c._amendedBy && (
 <div style={{marginTop:3, fontSize:10, color:'#fb923c66'}}>변경 출처: {c._amendedBy}</div>
 )}
 </div>
 );
 });
 })()}

 </div>

 <DocManagerFollowupChat
  docs={docs}
  clauses={clauses}
  conflicts={conflicts}
  selectedDoc={selectedDoc}
  onOpenClause={onOpenClause}
 />
 </div>
 </div>
 );
}

// --- AMENDMENT MANAGER -------------------------------------------------------

const AMENDMENT_PARSE_PROMPT = `다음 계약 문서(Amendment, 신규 계약서, Order Form 등)를 분석하여 아래 JSON 형식으로만 응답하시오. Markdown 백틱이나 설명 없이 순수 JSON만 출력.

{
 "docType": "Amendment|NewContract|OrderForm|Other",
 "effectiveDate": "YYYY-MM-DD 또는 null",
 "summary": "이 문서가 무엇인지 한 문장 요약",
 "patches": [
 {
 "clauseId": "SAA-6.2 형식의 기존 조항 ID (신규이면 AMD-001 등)",
 "changeType": "수정|삭제|추가|대체",
 "doc": "SAA|TOS|OF3|OF4|AMD 등",
 "newTopic": "변경된 주제명 (수정/추가 시)",
 "newCore": "변경된 핵심 내용 요약 (한국어, 1-2문장, KB core 필드에 직접 들어감)",
 "newFullText": "변경된 조항 원문 영어 전체 (없으면 null)",
 "newTranslation": "변경된 조항의 한국어 전문완역 (요약 금지, 생략 금지, 없으면 null)",
 "newContext": "변경 맥락 및 KT 영향 분석 (한국어)",
 "deletionReason": "삭제 이유 (삭제 시만)",
 "newConflicts": [{"id":"XC-NEW-001","risk":"HIGH|MEDIUM|LOW","topic":"충돌주제","summary":"충돌요약"}]
 }
 ]
}

조항 ID 매핑 규칙 (반드시 준수):
- "Sub-clause X.Y.Z" / "Section X.Y.Z" → "SAA-X.Y.Z" (예: Sub-clause 3.2.5.2 → SAA-3.2.5.2)
- "Appendix 6" / "Schedule A Appendix 6" → "SAA-APP6"
- "Appendix 7" / "Schedule A Appendix 7" → "SAA-APP7"
- "Target Market" 정의 변경 → "SAA-RESA-1"
- 기타 신규 조항 → "SAA-NEW-{번호}"

기존 조항 ID 목록(참고): SAA-1.3.1, SAA-1.3.2, SAA-1.6.8, SAA-2.10, SAA-2.11, SAA-3.2.4, SAA-3.2.5, SAA-3.2.5.2, SAA-6.2, SAA-6.3, SAA-8.2, SAA-9.0, SAA-APP6, SAA-APP7, SAA-RESA-1, OF3-FEES, OF4-FEES, OF4-CLOUD, TOS-7, TOS-8.2, TOS-8.4, TOS-12, TOS-13

번역 품질 규칙:
- newTranslation은 반드시 전문완역으로 작성. 핵심만 추려 쓴 요약문 금지.
- 항목 번호, 단서, 예외, 금액, 기간, 조건을 절대 생략하지 말 것.
- 원문이 영어인 경우에도 문장 전체를 한국어로 번역해서 제공할 것.

중요 규칙:
- Amendment는 조항 번호가 있는 수정 외에 다음 형태도 포함될 수 있음:
  (a) 정의(Definition) 변경: "X means ..." 형태로 기존 정의를 교체하는 경우
  (b) Appendix/Schedule 전체 교체: 목록 데이터(회사명, 조건 등) 형태
  (c) 전문(前文)/서명란: 법적 효력 없는 서술문 - patches에 포함하지 말 것
  (d) "except as amended, all other terms remain" 같은 일반 문구 - 포함하지 말 것
- 추출 순서:
  ① 문서 전체를 읽고 변경 대상을 유형별로 분류 (조항수정 / 정의변경 / Appendix교체)
  ② 각 유형별로 빠짐없이 patches 배열에 추가
  ③ Appendix 교체는 전체 목록 내용을 newFullText에 포함
- clauseId 결정 기준:
  - 조항 번호(3.2.5.2 등) -> 기존 KB ID 형식으로 매핑 (예: SAA-3.2.5.2)
  - 정의 변경("Target Market") -> 해당 정의가 속한 조항 ID (예: SAA-APP6-DEF)
  - Appendix 전체 교체 -> SAA-APP6, SAA-APP7 등 Appendix 번호로 ID 생성
- 내용이 목록 형태(회사명 테이블 등)인 경우 newFullText에 전체 목록을 포함
- 조항 내용이 짧거나 목록이어도 patches에 반드시 포함
- patches 배열이 비어있으면 안 됨`;

// --- KB AMENDMENT MANAGER -----------------------------------------------------
function AmendmentManager({ onAmendmentsChange }) {
 const [patchHistory, setPatchHistory] = useState([]);
 const [expanded, setExpanded] = useState(false);
 const [parsing, setParsing] = useState(false);
 const [parseStatus, setParseStatus] = useState(null);
 const fileRef = useRef(null);

 useEffect(() => {
 (async () => {
 try {
 const s = await storage.get("kb_patches_v1");
 if (s) {
 const history = JSON.parse(s);
 setPatchHistory(history);
 onAmendmentsChange(history.map(h => ({
 id: h.id, fileName: h.fileName, docType: h.docType,
 effectiveDate: h.effectiveDate, summary: h.summary,
 uploadedAt: h.uploadedAt,
 changes: h.patches.map(p => ({ clauseId: p.clauseId, changeType: p.changeType, newText: p.newCore, prevCore: p.prevCore, topic: p.topic }))
 })));
 }
 } catch(e) {}
 })();
 }, []);

 const savePatchHistory = async (history) => {
 try {
 await storage.set("kb_patches_v1", JSON.stringify(history));
 } catch(e) { console.error("patch save error", e); }
 };

 const parseAndApply = async (file) => {
 const ext = file.name.split(".").pop().toLowerCase();
 if (!["pdf","docx","doc","txt"].includes(ext)) return;
 setParsing(true);
 setParseStatus({ name: file.name, status: "parsing", msg: "AI가 조항 변경사항 추출 중..." });
 let raw = "";

 try {
 let textContent = null, b64 = null, mediaType = "text/plain";
 if (ext === "pdf") {
 b64 = await new Promise((res, rej) => {
 const r = new FileReader();
 r.onload = () => res(r.result.split(",")[1]);
 r.onerror = rej;
 r.readAsDataURL(file);
 });
 mediaType = "application/pdf";
 } else if (ext === "docx" || ext === "doc") {
 try {
 const mammoth = await import("mammoth");
 const ab = await file.arrayBuffer();
 const result = await mammoth.extractRawText({ arrayBuffer: ab });
 textContent = result.value;
 } catch(e) { textContent = "[DOCX 파싱 실패]"; }
 b64 = btoa(unescape(encodeURIComponent(textContent || "")));
 } else {
 textContent = await file.text();
 b64 = btoa(unescape(encodeURIComponent(textContent)));
 }

 const msgContent = (b64 && mediaType === "application/pdf")
 ? [
 { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
 { type: "text", text: AMENDMENT_PARSE_PROMPT }
 ]
 : AMENDMENT_PARSE_PROMPT + "\n\n===문서 내용===\n" + (textContent || "").slice(0, 50000);

 const resp = await fetch("/api/chat", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ max_tokens: 3000,
 messages: [{ role: "user", content: msgContent }] })
 });
 const data = await resp.json();
 raw = data.content?.map(c => c.text || "").join("") || "";
 const jsonStr = raw.replace(/[\x60]{3}json|[\x60]{3}/g, "").trim();
 let parsed;
 try {
 parsed = JSON.parse(jsonStr);
 } catch(e) {
 const cut = jsonStr.lastIndexOf('}');
 const fixed = cut > 0 ? jsonStr.slice(0, cut+1) + (jsonStr.trim().startsWith('{') ? '' : '') : jsonStr;
 try { parsed = JSON.parse(fixed); } catch(e2) { throw new Error('Amendment JSON 파싱 실패: ' + e.message); }
 }

 if (!parsed.patches || parsed.patches.length === 0) {
 setParseStatus({ name: file.name, status: "warn", msg: "변경된 조항 없음 — 신규 계약서로 등록" });
 setParsing(false);
 return;
 }

 const ts = new Date().toLocaleString("ko-KR");
 const amendedBy = `${file.name} (${ts})`;
 const patches = parsed.patches.map(p => ({ ...p, amendedBy }));

 applyPatchesToKB(patches);

 const entry = {
 id: Date.now(),
 fileName: file.name,
 uploadedAt: ts,
 docType: parsed.docType || "Amendment",
 effectiveDate: parsed.effectiveDate || null,
 summary: parsed.summary || "",
 patches,
 };
 const nextHistory = [entry, ...patchHistory].slice(0, 20);
 setPatchHistory(nextHistory);
 await savePatchHistory(nextHistory);

 onAmendmentsChange(nextHistory.map(h => ({
 id: h.id, fileName: h.fileName, docType: h.docType,
 effectiveDate: h.effectiveDate, summary: h.summary,
 uploadedAt: h.uploadedAt,
 changes: h.patches.map(p => ({ clauseId: p.clauseId, changeType: p.changeType, newText: p.newCore, prevCore: p.prevCore, topic: p.topic }))
 })));

 setParseStatus({
  name: file.name,
  status: "ok",
  msg: `${patches.length}개 조항 추출 완료`,
  clauseIds: patches.map(p => p.clauseId).filter(Boolean),
 });

 } catch(e) {
 console.error(e);
 setParseStatus({
  name: file.name,
  status: "error",
  msg: "파싱 실패: " + e.message,
  rawResponse: (raw || "").slice(0, 500),
 });
 }
 setParsing(false);
 };

 const removeEntry = async (id) => {
 const next = patchHistory.filter(h => h.id !== id);
 setPatchHistory(next);
 onAmendmentsChange(next.map(h => ({
 id: h.id, fileName: h.fileName, docType: h.docType,
 effectiveDate: h.effectiveDate, summary: h.summary,
 uploadedAt: h.uploadedAt,
 changes: h.patches.map(p => ({ clauseId: p.clauseId, changeType: p.changeType, newText: p.newCore, prevCore: p.prevCore, topic: p.topic }))
 })));
 await savePatchHistory(next);
 if (next.length < patchHistory.length) {
 alert("변경사항이 제거되었습니다. KB를 재적용하려면 페이지를 새로고침하세요.");
 }
 };

 const clearAll = async () => {
 setPatchHistory([]);
 onAmendmentsChange([]);
 try { await storage.remove("kb_patches_v1"); } catch(e) {}
 alert("모든 Amendment가 초기화되었습니다. 페이지를 새로고침하면 원본 KB로 복원됩니다.");
 };

 const typeColor = { Amendment:"#a78bfa", NewContract:"#60a5fa", OrderForm:"#10b981", Other:"#94a3b8" };
 const impColor = { HIGH:"#ff2d20", MEDIUM:"#f59e0b", LOW:"#10b981" };
 const chgColor = { 수정:"#60a5fa", 삭제:"#ff2d20", 추가:"#10b981", 대체:"#f59e0b" };
 const totalPatches = patchHistory.reduce((s, h) => s + (h.patches?.length||0), 0);

 return (
 <div style={{border:"1px solid #334155",borderRadius:6,overflow:"hidden",marginBottom:8}}>
 <div onClick={()=>setExpanded(!expanded)}
 style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",background:"#020617",cursor:"pointer",userSelect:"none"}}>
 <div style={{width:5,height:5,borderRadius:"50%",background:patchHistory.length>0?"#a78bfa":"#334155"}}/>
 <span style={{fontSize:11,color:patchHistory.length>0?"#cbd5e1":"#94a3b8",flex:1}}>
 {"Amendment / 계약 변경"}
 {patchHistory.length > 0 && (
 <span style={{fontSize:10,color:"#a78bfa",marginLeft:6}}>
 {patchHistory.length}건 · KB {totalPatches}개 조항 수정됨
 </span>
 )}
 </span>
 <span style={{fontSize:10,color:"#64748b"}}>{expanded?"▲":"▼"}</span>
 </div>

 {expanded && (
 <div style={{background:"#07070f",borderTop:"1px solid #334155"}}>
 {/* 업로드 영역 */}
 <div style={{padding:"10px 12px",borderBottom:"1px solid #0f0f20"}}>
 <div
 onClick={()=>!parsing&&fileRef.current?.click()}
 onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor="#a78bfa";}}
 onDragLeave={e=>{e.currentTarget.style.borderColor="#334155";}}
 onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor="#334155";if(!parsing)Array.from(e.dataTransfer.files).forEach(parseAndApply);}}
 style={{border:"1px dashed #1e2030",borderRadius:5,padding:"12px",textAlign:"center",cursor:parsing?"not-allowed":"pointer",transition:"border-color 0.15s",opacity:parsing?0.6:1}}
 >
 {parsing
 ? <div style={{fontSize:11,color:"#a78bfa"}}>{"⏳ AI가 조항 변경사항을 추출하는 중..."}</div>
 : <>
 <div style={{fontSize:11,color:"#94a3b8",marginBottom:3}}>{"PDF · DOCX · TXT"}</div>
 <div style={{fontSize:10,color:"#64748b"}}>{"업로드 시 AI가 자동으로 KB 조항을 업데이트하고 영구 저장합니다"}</div>
 </>
 }
 </div>
 <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.doc,.txt"
 style={{display:"none"}} onChange={e=>Array.from(e.target.files).forEach(parseAndApply)}/>
 {parseStatus && (
 <div style={{marginTop:6,padding:"5px 8px",borderRadius:4,
 background:parseStatus.status==="ok"?"#0a2a1a":parseStatus.status==="error"?"#2a0a0a":parseStatus.status==="warn"?"#1a1a08":"#0f1525",
 border:`1px solid ${parseStatus.status==="ok"?"#10b98133":parseStatus.status==="error"?"#ff2d2033":parseStatus.status==="warn"?"#f59e0b33":"#60a5fa33"}`}}>
 <span style={{fontSize:11,color:parseStatus.status==="ok"?"#10b981":parseStatus.status==="error"?"#ff2d20":parseStatus.status==="warn"?"#f59e0b":"#60a5fa"}}>
 {parseStatus.status==="ok"?"✓":parseStatus.status==="error"?"✗":parseStatus.status==="warn"?"⚠":"⏳"}{" "}{parseStatus.name}: {parseStatus.msg}
 </span>
 {parseStatus.status === "error" && parseStatus.rawResponse && (
 <details style={{marginTop:6}}>
  <summary style={{fontSize:11,color:"#fca5a5",cursor:"pointer"}}>LLM 원본 응답 보기</summary>
  <pre style={{marginTop:6,whiteSpace:"pre-wrap",wordBreak:"break-word",fontSize:11,color:"#fecaca",background:"#120707",border:"1px solid #7f1d1d66",borderRadius:4,padding:"6px",maxHeight:160,overflowY:"auto"}}>{parseStatus.rawResponse}</pre>
 </details>
 )}
 {parseStatus.status === "ok" && Array.isArray(parseStatus.clauseIds) && parseStatus.clauseIds.length > 0 && (
 <details style={{marginTop:6}}>
  <summary style={{fontSize:11,color:"#86efac",cursor:"pointer"}}>추출된 조항 ID 보기 ({parseStatus.clauseIds.length}개)</summary>
  <div style={{marginTop:6,display:"flex",flexWrap:"wrap",gap:4}}>
  {parseStatus.clauseIds.map((id, idx) => (
   <span key={id + "-" + idx} style={{fontSize:10,color:"#86efac",background:"#052e16",border:"1px solid #16653466",padding:"1px 5px",borderRadius:3}}>{id}</span>
  ))}
  </div>
 </details>
 )}
 </div>
 )}
 </div>

 {/* 패치 이력 */}
 {patchHistory.length === 0
 ? <div style={{padding:"14px",fontSize:10,color:"#64748b",textAlign:"center",lineHeight:1.7}}>
 {"Amendment를 업로드하면 AI가 조항 변경사항을 추출하여"}<br/>
 {"CONTRACT_KB를 직접 업데이트하고 storage에 영구 저장합니다"}
 </div>
 : <div style={{maxHeight:360,overflowY:"auto"}}>
 {patchHistory.map(h => (
 <div key={h.id} style={{padding:"10px 12px",borderBottom:"1px solid #0f0f20"}}>
 <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5}}>
 <span style={{fontSize:11,fontWeight:700,color:typeColor[h.docType]||"#94a3b8",background:(typeColor[h.docType]||"#94a3b8")+"18",padding:"1px 6px",borderRadius:2}}>{h.docType}</span>
 <span style={{fontSize:10,color:"#cbd5e1",fontWeight:600,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h.fileName}</span>
 {h.effectiveDate && <span style={{fontSize:11,color:"#64748b",whiteSpace:"nowrap"}}>{h.effectiveDate}</span>}
 <button onClick={()=>removeEntry(h.id)} style={{background:"none",border:"none",color:"#64748b",cursor:"pointer",fontSize:12,padding:"0 2px",fontFamily:"inherit"}}>{"×"}</button>
 </div>
 <div style={{fontSize:10,color:"#94a3b8",marginBottom:5,lineHeight:1.5}}>{h.summary}</div>
 {(h.patches||[]).map((p,i)=>(
 <div key={i} style={{display:"flex",gap:5,alignItems:"flex-start",marginBottom:3,padding:"4px 6px",background:"#020617",borderRadius:3,borderLeft:`2px solid ${chgColor[p.changeType]||"#94a3b8"}`}}>
 <span style={{fontSize:11,fontWeight:700,color:"#60a5fa",whiteSpace:"nowrap",minWidth:90}}>{p.clauseId}</span>
 <span style={{fontSize:11,color:chgColor[p.changeType]||"#94a3b8",whiteSpace:"nowrap",minWidth:28}}>{p.changeType}</span>
 <span style={{fontSize:12,color:"#94a3b8",lineHeight:1.65}}>{p.newCore||p.newTopic||""}</span>
 </div>
 ))}
 </div>
 ))}
 <div style={{padding:"8px 12px"}}>
 <button onClick={clearAll} style={{fontSize:10,color:"#64748b",background:"none",border:"1px solid #334155",borderRadius:3,padding:"3px 10px",cursor:"pointer",fontFamily:"inherit",width:"100%"}}>
 {"전체 초기화 (원본 KB 복원)"}
 </button>
 </div>
 </div>
 }
 </div>
 )}
 </div>
 );
}

function FollowupChat({ result, mode, amendments=[], onOpenClause }) {
 const [messages, setMessages] = useState([]);
 const [input, setInput] = useState("");
 const [loading, setLoading] = useState(false);
 const bottomRef = useRef(null);

 useEffect(()=>{
 bottomRef.current?.scrollIntoView({behavior:"smooth"});
 },[messages]);

 const send = async () => {
 if (!input.trim() || loading) return;
 const userMsg = input.trim();
 setInput("");
 const newMessages = [...messages, {role:"user",content:userMsg}];
 setMessages(newMessages);
 setLoading(true);
 try {
 const res = await fetch("/api/chat", {
 method:"POST",
 headers:{"Content-Type":"application/json"},
 body: JSON.stringify({
 
 max_tokens:1000,
 system: buildFollowupPrompt(mode, result, messages, amendments, result?._issueType),
 messages:[{role:"user",content:userMsg}]
 })
 });
 if (!res.ok) throw new Error("API "+res.status);
 const data = await res.json();
 const text = data.content?.map(b=>b.text||"").join("").trim();
 setMessages([...newMessages,{role:"assistant",content:text}]);
 } catch(e) {
 setMessages([...newMessages,{role:"assistant",content:"오류가 발생했습니다: "+e.message}]);
 } finally {
 setLoading(false);
 }
 };

 return (
 <div style={{background:"#0f172a",border:"1px solid #334155",borderRadius:8,overflow:"hidden"}}>
  <div style={{padding:"10px 16px",borderBottom:"1px solid #334155",display:"flex",alignItems:"center",gap:8}}>
   <div style={{width:6,height:6,borderRadius:"50%",background:"#60a5fa",flexShrink:0}}/>
   <span style={{fontSize:12,color:"#94a3b8",fontWeight:500}}>후속 질문</span>
   <span style={{fontSize:11,color:"#475569"}}>분석 내용에 대해 자유롭게 질문하세요</span>
  </div>
  {messages.length > 0 && (
   <div style={{maxHeight:280,overflowY:"auto",padding:"12px 16px",display:"flex",flexDirection:"column",gap:8}}>
    {messages.map((m,i)=>(
     <div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
      <div style={{maxWidth:"85%",padding:"9px 13px",borderRadius:8,
       background:m.role==="user"?"#1e3a6e":"#1e293b",
       border:`1px solid ${m.role==="user"?"#3b82f640":"#334155"}`,
       fontSize:13,color:"#e2e8f0",lineHeight:1.75,whiteSpace:"pre-wrap"}}>
       {m.content.split("\n").map((line, idx) => (
        <span key={idx}>{linkifyClauses(line, onOpenClause)}{idx < m.content.split("\n").length - 1 && <br/>}</span>
       ))}
      </div>
     </div>
    ))}
    {loading && <div style={{display:"flex",justifyContent:"flex-start"}}><div style={{background:"#1e293b",border:"1px solid #334155",borderRadius:8,padding:"6px 10px"}}><TypingDots/></div></div>}
    <div ref={bottomRef}/>
   </div>
  )}
  <div style={{padding:"10px 14px",borderTop:messages.length>0?"1px solid #334155":"none",display:"flex",gap:8}}>
   <input
    value={input}
    onChange={e=>setInput(e.target.value)}
    onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&send()}
    placeholder="이 분석에 대해 추가 질문..."
    style={{flex:1,background:"#1e293b",border:"1px solid #334155",borderRadius:6,padding:"8px 12px",fontSize:12,color:"#e2e8f0",fontFamily:"inherit",outline:"none"}}
   />
   <button onClick={send} disabled={!input.trim()||loading}
    style={{padding:"8px 16px",background:input.trim()&&!loading?"#1d4ed8":"#1e293b",border:`1px solid ${input.trim()&&!loading?"#3b82f660":"#334155"}`,borderRadius:6,fontSize:12,fontWeight:600,color:input.trim()&&!loading?"#93c5fd":"#475569",cursor:input.trim()&&!loading?"pointer":"not-allowed",fontFamily:"inherit",transition:"all 0.15s"}}>
    전송
   </button>
  </div>
 </div>
 );
}

function AnalysisResult({ result, query, mode, amendments=[], onOpenClause }) {
 const [activeSection, setActiveSection] = useState("kt_strategy");
 const [localViewingClause, setLocalViewingClause] = useState(null);
 const openClause = onOpenClause || setLocalViewingClause;

 /*
  * Design tokens — Tailwind Slate scale (dark mode)
  * slate-950:#020617  slate-900:#0f172a  slate-800:#1e293b
  * slate-700:#334155  slate-600:#475569  slate-500:#64748b
  * slate-400:#94a3b8  slate-300:#cbd5e1  slate-200:#e2e8f0  slate-100:#f1f5f9
  *
  * Risk semantic colors (Tailwind standard):
  * red-500:#ef4444  amber-500:#f59e0b  green-500:#22c55e  blue-400:#60a5fa
  */
 const S = {
  bg:      "#020617",   // slate-950 — 페이지 최하단
  card:    "#0f172a",   // slate-900 — 카드 배경
  cardIn:  "#1e293b",   // slate-800 — 중첩 카드 / 내부 행
  border:  "#334155",   // slate-700 — 테두리
  borderSub:"#1e293b",  // slate-800 — 서브 구분선
  t1:      "#f1f5f9",   // slate-100 — 주요 텍스트
  t2:      "#cbd5e1",   // slate-300 — 본문
  t3:      "#94a3b8",   // slate-400 — 보조
  t4:      "#64748b",   // slate-500 — 레이블/힌트
  font:    "system-ui, -apple-system, 'Segoe UI', sans-serif",
 };

 const RISK = {
  HIGH:   { color:"#ef4444", light:"#fca5a5", bg:"rgba(239,68,68,0.1)",  border:"rgba(239,68,68,0.3)",  label:"고위험" },
  MEDIUM: { color:"#f59e0b", light:"#fcd34d", bg:"rgba(245,158,11,0.1)", border:"rgba(245,158,11,0.3)", label:"주의"   },
  LOW:    { color:"#22c55e", light:"#86efac", bg:"rgba(34,197,94,0.1)",  border:"rgba(34,197,94,0.3)",  label:"양호"   },
  NONE:   { color:"#60a5fa", light:"#93c5fd", bg:"rgba(96,165,250,0.1)", border:"rgba(96,165,250,0.3)", label:"검토"   },
 };
 const rv = (result.risk_level||"NONE").toUpperCase();
 const R = RISK[rv] || RISK.NONE;

 const tos = result._tosAnalysis || {};
 const sections = [
  {id:"kt_strategy",   label:"KT 전략"},
  {id:"palantir_case", label:"예상 반론"},
  {id:"tos",           label: tos.has_risk ? "TOS ⚠" : "TOS"},
  {id:"clauses",       label:`조항 (${result.triggered_clauses?.length||0})`},
  {id:"actions",       label:`조치 (${result.immediate_actions?.length||0})`},
 ];

 /* 공용 컴포넌트 */
 const Label = ({children}) => (
  <div style={{fontSize:10,fontWeight:600,color:S.t4,letterSpacing:"0.1em",
   textTransform:"uppercase",marginBottom:8,fontFamily:S.font}}>{children}</div>
 );

 const Card = ({children,style={}}) => (
  <div style={{background:S.card,border:`1px solid ${S.border}`,
   borderRadius:8,padding:"14px 16px",marginBottom:12,...style}}>{children}</div>
 );

 return (
 <>
 {/* ── 결과 카드 전체 래퍼 ── */}
 <div style={{background:S.card,borderRadius:10,overflow:"hidden",marginBottom:12,
  border:`1px solid ${S.border}`,boxShadow:"0 4px 24px rgba(0,0,0,0.4)"}}>

  {/* ── 헤더 ── */}
  <div style={{background:S.bg,padding:"18px 20px 16px",borderBottom:`1px solid ${S.border}`}}>

   {/* 배지 행 */}
   <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14,flexWrap:"wrap"}}>

    {/* 위험도 pill */}
    <span style={{display:"inline-flex",alignItems:"center",gap:6,
     padding:"5px 12px",borderRadius:20,
     background:R.bg,border:`1px solid ${R.border}`,
     fontSize:12,fontWeight:700,color:R.color,fontFamily:S.font,letterSpacing:"0.02em"}}>
     <span style={{width:6,height:6,borderRadius:"50%",background:R.color,display:"inline-block",flexShrink:0}}/>
     {R.label}
    </span>

    {/* 이슈 타입 */}
    {result._issueType && ISSUE_TYPES[result._issueType] && (
     <span style={{display:"inline-flex",alignItems:"center",padding:"5px 11px",borderRadius:20,
      background:ISSUE_TYPES[result._issueType].color+"18",
      border:`1px solid ${ISSUE_TYPES[result._issueType].color}40`,
      fontSize:11,fontWeight:600,color:ISSUE_TYPES[result._issueType].color,fontFamily:S.font}}>
      {ISSUE_TYPES[result._issueType].label}
     </span>
    )}

    {/* 카운터 */}
    <span style={{marginLeft:"auto",fontSize:11,color:S.t4,fontFamily:S.font}}>
     조항 {result.triggered_clauses?.length||0} · 충돌 {result.related_conflicts?.length||0}
    </span>
   </div>

   {/* 상황 요약 */}
   <div style={{fontSize:12,color:S.t3,lineHeight:1.7,fontFamily:S.font}}>
    {linkifyClauses(result.situation_summary||"", openClause)}
   </div>
  </div>

  {/* ── 판사 결론 ── */}
  {result.bottom_line && (
   <div style={{margin:"0 0 0 0",padding:"14px 20px",
    background:R.bg, borderBottom:`1px solid ${R.border}`,
    borderLeft:`4px solid ${R.color}`}}>
    <div style={{fontSize:9,fontWeight:800,color:R.color,letterSpacing:".12em",marginBottom:6,textTransform:"uppercase",fontFamily:S.font}}>
     ⚖ 종합 의견
    </div>
    <div style={{fontSize:14,fontWeight:600,color:R.color,lineHeight:1.75,fontFamily:S.font}}>
     {linkifyClauses(result.bottom_line, openClause)}
    </div>
   </div>
  )}

  {/* ── 탭 바 ── */}
  <div style={{display:"flex",borderBottom:`1px solid ${S.border}`,background:S.bg,padding:"0 12px"}}>
   {sections.map(s=>{
    const active = activeSection === s.id;
    return (
     <button key={s.id} onClick={()=>setActiveSection(s.id)}
      style={{padding:"11px 14px",border:"none",background:"transparent",cursor:"pointer",
       fontSize:12,fontWeight:active?600:400,fontFamily:S.font,
       color:active?S.t1:S.t4,
       borderBottom:active?`2px solid #60a5fa`:"2px solid transparent",
       transition:"color 0.15s",marginBottom:-1,whiteSpace:"nowrap"}}>
      {s.label}
     </button>
    );
   })}
  </div>

  {/* ── 탭 콘텐츠 ── */}
  <div style={{padding:"20px"}}>

   {/* ── KT 전략 ── */}
   {activeSection==="kt_strategy" && (
    <div>
     <Card style={{borderLeft:"3px solid #3b82f6",marginBottom:12}}>
      <Label>KT 핵심 방어 논거</Label>
      <div style={{fontSize:13,color:S.t1,lineHeight:1.85,fontFamily:S.font,fontWeight:500}}>
       {formatArgument(result._ktStrategy?.defense_summary||result.kt_defense||"",openClause)}
      </div>
     </Card>

     {result._ktStrategy?.leverage_points?.length>0 && (
      <Card style={{marginBottom:12}}>
       <Label>협상 레버리지 포인트</Label>
       <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {result._ktStrategy.leverage_points.map((p,i)=>(
         <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start"}}>
          <span style={{minWidth:20,height:20,borderRadius:"50%",background:"rgba(59,130,246,0.15)",
           display:"inline-flex",alignItems:"center",justifyContent:"center",
           fontSize:11,fontWeight:700,color:"#60a5fa",flexShrink:0,marginTop:1}}>{i+1}</span>
          <span style={{fontSize:13,color:S.t2,lineHeight:1.75,fontFamily:S.font}}>{linkifyClauses(p,openClause)}</span>
         </div>
        ))}
       </div>
      </Card>
     )}

     {result._ktStrategy?.favorable_interpretations?.length>0 && (
      <Card style={{marginBottom:12,borderLeft:"3px solid #10b981"}}>
       <Label>유리한 조항 해석 각도</Label>
       <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {result._ktStrategy.favorable_interpretations.map((p,i)=>(
         <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start"}}>
          <span style={{fontSize:16,color:"#10b981",flexShrink:0,marginTop:0,lineHeight:1}}>{"\u2713"}</span>
          <span style={{fontSize:13,color:S.t2,lineHeight:1.75,fontFamily:S.font}}>{linkifyClauses(p,openClause)}</span>
         </div>
        ))}
       </div>
      </Card>
     )}

     {result._ktStrategy?.procedural_defenses?.length>0 && (
      <Card style={{marginBottom:12}}>
       <Label>절차적 방어 / Palantir 하자</Label>
       <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {result._ktStrategy.procedural_defenses.map((p,i)=>(
         <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start"}}>
          <span style={{fontSize:16,color:"#f59e0b",flexShrink:0,marginTop:0,lineHeight:1}}>{"\u2691"}</span>
          <span style={{fontSize:13,color:S.t2,lineHeight:1.75,fontFamily:S.font}}>{linkifyClauses(p,openClause)}</span>
         </div>
        ))}
       </div>
      </Card>
     )}

     {result._ktStrategy?.preemptive_actions?.length>0 && (
      <Card style={{marginBottom:12,borderLeft:"3px solid #f59e0b"}}>
       <Label>KT 선제적 행동</Label>
       <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {result._ktStrategy.preemptive_actions.map((p,i)=>(
         <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start"}}>
          <span style={{fontSize:16,color:"#fbbf24",flexShrink:0,marginTop:0,lineHeight:1}}>{"\u2192"}</span>
          <span style={{fontSize:13,color:S.t2,lineHeight:1.75,fontFamily:S.font}}>{linkifyClauses(p,openClause)}</span>
         </div>
        ))}
       </div>
      </Card>
     )}

     {result.related_conflicts?.length>0 && (
      <Card style={{marginBottom:12}}>
       <Label>이슈 연관 충돌 조항 ({result.related_conflicts.length}건)</Label>
       <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {result.related_conflicts.map(rc=>{
         const cid = rc.id||rc;
         const cf = CONTRACT_KB.conflicts.find(x=>x.id===cid);
         const lvl = rc.relevance_level||"중";
         const reason = rc.relevance_reason||"";
         const lvlStyle = {
          "상":{color:"#ef4444",bg:"rgba(239,68,68,0.12)",label:"관련 상"},
          "중":{color:"#f59e0b",bg:"rgba(245,158,11,0.12)",label:"관련 중"},
          "하":{color:"#94a3b8",bg:"rgba(148,163,184,0.1)",label:"관련 하"},
         }[lvl]||{color:"#f59e0b",bg:"rgba(245,158,11,0.12)",label:lvl};
         if (!cf) return (
          <div key={cid} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",
           background:S.cardIn,borderRadius:6,border:`1px solid ${S.borderSub}`}}>
           <span style={{fontSize:11,fontWeight:700,color:"#fbbf24",minWidth:62,fontFamily:S.font}}>{cid}</span>
           <span style={{fontSize:11,color:S.t4,fontFamily:S.font}}>충돌 데이터 없음</span>
          </div>
         );
         const riskCol = ({HIGH:"#ef4444",MEDIUM:"#f59e0b",LOW:"#22c55e"})[cf.risk]||"#fbbf24";
         const parts = cf.summary.split(" vs ");
         const docA = parts[0]||cf.summary;
         const docB = parts[1]||"-";
         return (
          <div key={cid} style={{background:S.cardIn,borderRadius:7,border:`1px solid ${S.borderSub}`,overflow:"hidden"}}>
           <div style={{display:"flex",alignItems:"center",gap:8,padding:"9px 12px",borderBottom:`1px solid ${S.borderSub}`}}>
            <span style={{fontSize:11,fontWeight:700,color:"#fbbf24",minWidth:62,fontFamily:S.font}}>{cf.id}</span>
            <span style={{fontSize:12,fontWeight:600,color:S.t1,flex:1,fontFamily:S.font}}>{cf.topic}</span>
            <span style={{fontSize:10,fontWeight:700,color:riskCol,background:riskCol+"18",padding:"2px 8px",borderRadius:4,fontFamily:S.font}}>{cf.risk}</span>
            <span style={{fontSize:10,fontWeight:600,color:lvlStyle.color,background:lvlStyle.bg,padding:"2px 8px",borderRadius:4,marginLeft:4,fontFamily:S.font}}>{lvlStyle.label}</span>
           </div>
           <div style={{display:"flex",padding:"10px 12px 8px"}}>
            <div style={{flex:1,paddingRight:10,borderRight:`1px solid ${S.border}`}}>
             <div style={{fontSize:10,fontWeight:600,color:"#60a5fa",marginBottom:5,fontFamily:S.font}}>문서 A</div>
             <div style={{fontSize:12,color:S.t3,lineHeight:1.65,fontFamily:S.font}}>{docA}</div>
            </div>
            <div style={{flex:1,paddingLeft:10}}>
             <div style={{fontSize:10,fontWeight:600,color:"#fb923c",marginBottom:5,fontFamily:S.font}}>문서 B</div>
             <div style={{fontSize:12,color:S.t3,lineHeight:1.65,fontFamily:S.font}}>{docB}</div>
            </div>
           </div>
           {reason && (
            <div style={{padding:"8px 12px 10px",borderTop:`1px solid ${S.borderSub}`,display:"flex",alignItems:"flex-start",gap:8}}>
             <span style={{fontSize:10,fontWeight:600,color:lvlStyle.color,fontFamily:S.font,whiteSpace:"nowrap",marginTop:2,flexShrink:0}}>이슈 연관</span>
             <span style={{fontSize:12,color:S.t2,lineHeight:1.65,fontFamily:S.font}}>{reason}</span>
            </div>
           )}
          </div>
         );
        })}
       </div>
      </Card>
     )}

     {result.immediate_actions?.length>0 && (
      <Card style={{borderLeft:"3px solid #ef4444"}}>
       <Label>즉시 조치사항 ({result.immediate_actions.length}건) — 상세는 [조치] 탭</Label>
       {result.immediate_actions.map((a,i)=>(
        <div key={i} style={{display:"flex",gap:12,padding:"9px 0",
         borderBottom:i<result.immediate_actions.length-1?`1px solid ${S.borderSub}`:"none"}}>
         <span style={{fontSize:11,fontWeight:700,color:"#f87171",minWidth:60,paddingTop:1,fontFamily:S.font,lineHeight:1.5,flexShrink:0}}>{a.timeframe}</span>
         <span style={{fontSize:12,color:S.t3,lineHeight:1.7,flex:1,fontFamily:S.font}}>{a.action}</span>
        </div>
       ))}
      </Card>
     )}
    </div>
   )}

   {/* ── 예상 반론 ── */}
   {activeSection==="palantir_case" && (
    <div>
     <Card style={{borderLeft:"3px solid #ef4444",marginBottom:12}}>
      <Label>Palantir 측 논거 (판사 정제)</Label>
      <div style={{fontSize:13,color:S.t2,lineHeight:1.85,fontFamily:S.font}}>
       {formatArgument(result.palantir_position||"",openClause)}
      </div>
     </Card>

     {result._palantirCase?.strongest_arguments?.length>0 && (
      <Card style={{marginBottom:12,borderLeft:"3px solid #ef4444"}}>
       <Label>Palantir 가장 강력한 반론</Label>
       <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {result._palantirCase.strongest_arguments.map((p,i)=>(
         <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start",
          padding:"10px 12px",background:S.cardIn,borderRadius:6,border:`1px solid ${S.borderSub}`}}>
          <span style={{minWidth:20,height:20,borderRadius:"50%",background:"rgba(239,68,68,0.15)",
           display:"inline-flex",alignItems:"center",justifyContent:"center",
           fontSize:11,fontWeight:700,color:"#f87171",flexShrink:0,marginTop:1}}>{i+1}</span>
          <span style={{fontSize:13,color:S.t2,lineHeight:1.75,fontFamily:S.font}}>{linkifyClauses(p,openClause)}</span>
         </div>
        ))}
       </div>
      </Card>
     )}

     {result._palantirCase?.kt_weaknesses?.length>0 && (
      <Card style={{marginBottom:12,borderLeft:"3px solid #f59e0b"}}>
       <Label>KT 논거 취약점 (Palantir 공략 포인트)</Label>
       <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {result._palantirCase.kt_weaknesses.map((p,i)=>(
         <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start"}}>
          <span style={{fontSize:14,color:"#f59e0b",flexShrink:0,marginTop:1}}>{"\u26a0"}</span>
          <span style={{fontSize:13,color:S.t2,lineHeight:1.75,fontFamily:S.font}}>{linkifyClauses(p,openClause)}</span>
         </div>
        ))}
       </div>
      </Card>
     )}

     {result._palantirCase?.counter_strategy && (
      <Card style={{marginBottom:12}}>
       <Label>Palantir 예상 대응 전략</Label>
       <div style={{fontSize:13,color:S.t2,lineHeight:1.85,fontFamily:S.font}}>
        {formatArgument(result._palantirCase.counter_strategy,openClause)}
       </div>
      </Card>
     )}

     <Card style={{marginBottom:12}}>
      <Label>위험도 판단 근거</Label>
      <div style={{fontSize:13,color:S.t2,lineHeight:1.9,fontFamily:S.font}}>{formatArgument(result.risk_reason,openClause)}</div>
     </Card>
     <Card>
      <Label>법적 효과 분석</Label>
      <div style={{fontSize:13,color:S.t2,lineHeight:1.9,fontFamily:S.font}}>{formatArgument(result.legal_analysis,openClause)}</div>
     </Card>
    </div>
   )}

   {/* ── TOS 추가 분석 ── */}
   {activeSection==="tos" && (
    <div>
     {/* 요약 배너 */}
     <div style={{background: tos.has_risk ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.08)",
      border:`1px solid ${tos.has_risk ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)"}`,
      borderLeft:`4px solid ${tos.has_risk ? "#ef4444" : "#22c55e"}`,
      borderRadius:8, padding:"12px 16px", marginBottom:12}}>
      <div style={{fontSize:10,fontWeight:700,color:tos.has_risk?"#ef4444":"#22c55e",letterSpacing:".08em",marginBottom:4}}>
       {tos.has_risk ? "⚠ TOS 추가 리스크 있음" : "✓ TOS 추가 리스크 없음"}
      </div>
      <div style={{fontSize:13,color:S.t1,lineHeight:1.75,fontFamily:S.font,fontWeight:500}}>
       {tos.summary || "TOS 분석 결과 없음"}
      </div>
     </div>

     {/* KT TOS 방어 */}
     {tos.kt_tos_defense && (
      <Card style={{borderLeft:"3px solid #3b82f6",marginBottom:12}}>
       <Label>KT TOS 방어 포인트</Label>
       <div style={{fontSize:13,color:S.t1,lineHeight:1.85,fontFamily:S.font}}>
        {formatArgument(tos.kt_tos_defense, openClause)}
       </div>
      </Card>
     )}

     {/* 트리거된 TOS 조항 */}
     {(tos.triggered_clauses||[]).length > 0 ? (
      <Card style={{marginBottom:12}}>
       <Label>이슈 관련 TOS 조항 ({tos.triggered_clauses.length}건)</Label>
       <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {tos.triggered_clauses.map((c,i)=>(
         <div key={i} style={{background:S.cardIn,borderRadius:7,border:`1px solid ${S.borderSub}`,overflow:"hidden"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",borderBottom:`1px solid ${S.borderSub}`}}>
           <span style={{fontSize:11,fontWeight:700,color:"#f59e0b",fontFamily:S.font,cursor:"pointer"}}
            onClick={()=>openClause(c.clause_id)}>
            {c.clause_id}
           </span>
           <span style={{fontSize:12,fontWeight:600,color:S.t1,flex:1,fontFamily:S.font}}>{c.topic}</span>
          </div>
          <div style={{padding:"10px 12px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
           <div>
            <div style={{fontSize:9,fontWeight:700,color:"#ef4444",marginBottom:4,letterSpacing:".06em"}}>추가 리스크</div>
            <div style={{fontSize:12,color:S.t2,lineHeight:1.65,fontFamily:S.font}}>{c.additional_risk}</div>
           </div>
           <div>
            <div style={{fontSize:9,fontWeight:700,color:"#60a5fa",marginBottom:4,letterSpacing:".06em"}}>KT 입장</div>
            <div style={{fontSize:12,color:S.t2,lineHeight:1.65,fontFamily:S.font}}>{c.kt_position}</div>
           </div>
          </div>
         </div>
        ))}
       </div>
      </Card>
     ) : tos.has_risk === false && (
      <Card>
       <div style={{fontSize:13,color:S.t3,lineHeight:1.7,fontFamily:S.font,textAlign:"center",padding:"12px 0"}}>
        이 이슈에 대해 TOS에서 추가로 발생하는 리스크가 없습니다.
       </div>
      </Card>
     )}

     <div style={{marginTop:14,padding:"10px 14px",background:S.cardIn,borderRadius:6,border:`1px solid ${S.borderSub}`}}>
      <div style={{fontSize:10,color:S.t4,fontFamily:S.font,lineHeight:1.65}}>
       ℹ TOS는 SAA·OF3·OF4 분석 완료 후 추가로 검토하는 문서입니다. 위 내용은 핵심 분석에서 다루지 않은 TOS 고유 조항의 영향만 표시합니다.
      </div>
     </div>
    </div>
   )}

      {/* ── CLAUSES ── */}
   {activeSection==="clauses" && (
    <div>
     {result.triggered_clauses?.length>0
      ? result.triggered_clauses.map((c,i)=><ClauseCard key={i} clause={c} onViewFull={openClause}/>)
      : <div style={{fontSize:13,color:S.t4,textAlign:"center",padding:40,fontFamily:S.font}}>관련 조항 없음</div>
     }
    </div>
   )}


      {/* ── ACTIONS ── */}
   {activeSection==="actions" && (
    <div>
     {result.immediate_actions?.length>0
      ? result.immediate_actions.map((a,i)=><ActionCard key={i} action={a} index={i} onOpen={openClause}/>)
      : <div style={{fontSize:13,color:S.t4,textAlign:"center",padding:40,fontFamily:S.font}}>조치 사항 없음</div>
     }
    </div>
   )}

  </div>
 </div>

 {!onOpenClause && localViewingClause && <ClauseDrawer clauseId={localViewingClause} onClose={()=>setLocalViewingClause(null)}/>}

 {result && <div style={{marginTop:10}}>
  <FollowupChat result={result} mode={mode} amendments={amendments} onOpenClause={openClause}/>
 </div>}

 <ReportButton result={result} query={query} mode={mode}/>
 </>
 );
}

// --- CLAUSE TIMELINE TAB ------------------------------------------------------
function ClauseTimelineTab({ onOpenClause }) {
 const [patchHistory, setPatchHistory] = useState([]);
 useEffect(() => {
 (async () => {
 try {
 const s = await storage.get('kb_patches_v1');
 if (s) setPatchHistory(JSON.parse(s));
 } catch(e) {}
 })();
 const onFocus = async () => {
 try {
 const s = await storage.get('kb_patches_v1');
 if (s) setPatchHistory(JSON.parse(s));
 } catch(e) {}
 };
 window.addEventListener('focus', onFocus);
 return () => window.removeEventListener('focus', onFocus);
 }, []);
 const [viewMode, setViewMode] = useState("timeline"); // "timeline" | "clause"
 const [selectedId, setSelectedId] = useState(null); // 조항 ID 필터
 const [search, setSearch] = useState("");
 const [expandedAmds, setExpandedAmds] = useState({});
 const [editingDateId, setEditingDateId] = useState(null);
 const [dateInput, setDateInput] = useState("");

 const deleteEntry = async (id) => {
  const next = patchHistory.filter(h => h.id !== id);
  setPatchHistory(next);
  try { await storage.set('kb_patches_v1', JSON.stringify(next)); } catch(e) {}
 };

 const saveEffectiveDate = async (id) => {
  const next = patchHistory.map(h => h.id === id ? { ...h, effectiveDate: dateInput || null } : h);
  setPatchHistory(next);
  try { await storage.set('kb_patches_v1', JSON.stringify(next)); } catch(e) {}
  setEditingDateId(null);
 };

 const allClauseIds = [...new Set(
 patchHistory.flatMap(h => (h.patches||[]).map(p => p.clauseId))
 )].sort();

 const filtered = patchHistory.filter(h => {
 if (!search.trim()) return true;
 const q = search.toLowerCase();
 return h.fileName?.toLowerCase().includes(q) ||
 h.summary?.toLowerCase().includes(q) ||
 (h.patches||[]).some(p =>
 p.clauseId?.toLowerCase().includes(q) ||
 p.newCore?.toLowerCase().includes(q) ||
 p.prevCore?.toLowerCase().includes(q)
 );
 });

 const clauseHistory = selectedId
 ? patchHistory
 .filter(h => (h.patches||[]).some(p => p.clauseId === selectedId))
 .map(h => ({
 ...h,
 patches: (h.patches||[]).filter(p => p.clauseId === selectedId)
 }))
 : [];

 const chgColor = { MODIFY:"#60a5fa", DELETE:"#ff2d20", ADD:"#10b981", REPLACE:"#f59e0b",
 수정:"#60a5fa", 삭제:"#ff2d20", 추가:"#10b981", 대체:"#f59e0b" };
 const chgLabel = { MODIFY:"수정", DELETE:"삭제", ADD:"추가", REPLACE:"대체" };
 const typeColor = { Amendment:"#a78bfa", NewContract:"#60a5fa", OrderForm:"#10b981", Other:"#94a3b8" };

 const toggleAmd = (id) => setExpandedAmds(p => ({...p, [id]: !p[id]}));

 if (patchHistory.length === 0) {
 return (
 <div style={{height:"100%", display:"flex", alignItems:"center", justifyContent:"center",
 flexDirection:"column", gap:10, color:"#475569"}}>
 <div style={{fontSize:30, opacity:0.2}}>📜</div>
 <div style={{fontSize:11, textAlign:"center", lineHeight:1.8}}>
 조항 변경 이력이 없습니다<br/>
 <span style={{fontSize:9}}>이슈 분석 탭에서 Amendment를 업로드하면 변경 내역이 기록됩니다</span>
 </div>
 </div>
 );
 }

 return (
 <div style={{display:"grid", gridTemplateColumns:"260px 1fr", height:"100%", overflow:"hidden"}}>

 {/* -- 왼쪽: Amendment 목록 + 조항 필터 -- */}
 <div style={{borderRight:"1px solid #334155", display:"flex", flexDirection:"column",
 overflow:"hidden", background:"#020617"}}>

 {/* 검색 */}
 <div style={{padding:"12px 14px", borderBottom:"1px solid #334155"}}>
 <input value={search} onChange={e=>setSearch(e.target.value)}
 placeholder="문서명·조항 ID·내용 검색..."
 style={{width:"100%", background:"#1e293b", border:"1px solid #334155", borderRadius:4,
 padding:"6px 9px", fontSize:10, color:"#e2e8f0", fontFamily:"inherit",
 outline:"none", boxSizing:"border-box"}}/>
 </div>

 {/* 뷰 전환 */}
 <div style={{display:"flex", borderBottom:"1px solid #334155"}}>
 {[["timeline","타임라인"],["clause","조항별"]].map(([k,label])=>(
 <button key={k} onClick={()=>{ setViewMode(k); setSelectedId(null); }}
 style={{flex:1, padding:"8px", fontSize:10, fontWeight:600, border:"none",
 background:"transparent", cursor:"pointer", fontFamily:"inherit",
 borderBottom:viewMode===k?"2px solid #60a5fa":"2px solid transparent",
 color:viewMode===k?"#60a5fa":"#64748b"}}>
 {label}
 </button>
 ))}
 </div>

 <div style={{flex:1, overflowY:"auto", padding:"8px 10px"}}>

 {/* 타임라인 모드: Amendment 목록 */}
 {viewMode==="timeline" && filtered.map(h => {
 const tc = typeColor[h.docType]||"#94a3b8";
 const isExp = expandedAmds[h.id];
 const patchCount = h.patches?.length||0;
 return (
 <div key={h.id} style={{marginBottom:6, borderRadius:5,
 border:`1px solid ${isExp?tc+"44":"#334155"}`,
 background:isExp?tc+"06":"#1e293b"}}>
 <div onClick={()=>toggleAmd(h.id)}
 style={{padding:"9px 10px", cursor:"pointer"}}>
 <div style={{display:"flex", alignItems:"center", gap:5, marginBottom:3}}>
 <span style={{fontSize:11, fontWeight:700, color:tc,
 background:tc+"18", padding:"1px 5px", borderRadius:2}}>
 {h.docType}
 </span>
 <span style={{fontSize:10, color:"#475569", marginLeft:"auto"}}>
 {h.effectiveDate || h.uploadedAt?.slice(0,10) || "날짜 미상"}
 </span>
 <button onClick={e=>{ e.stopPropagation(); if(window.confirm(`"${h.fileName}" 이력을 삭제하시겠습니까?`)) deleteEntry(h.id); }}
  style={{background:"none", border:"none", cursor:"pointer", color:"#64748b", fontSize:13,
  padding:"0 2px", lineHeight:1, marginLeft:2}} title="이력 삭제">✕</button>
 </div>
 <div style={{fontSize:10, color:"#cbd5e1", marginBottom:3,
 overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
 {h.fileName}
 </div>
 <div style={{display:"flex", gap:6, fontSize:10, color:"#475569"}}>
 <span>조항 {patchCount}개 변경</span>
 {isExp ? <span style={{marginLeft:"auto"}}>▲</span> : <span style={{marginLeft:"auto"}}>▼</span>}
 </div>
 </div>
 {isExp && (
 <div style={{borderTop:"1px solid #334155", padding:"6px 10px"}}>
 {(h.patches||[]).map((p,i)=>{
 const cc = chgColor[p.changeType]||"#94a3b8";
 return (
 <div key={i} style={{display:"flex", alignItems:"center", gap:5,
 padding:"3px 0", borderBottom:"1px solid #0f0f1a"}}>
 <span style={{fontSize:10, color:cc, background:cc+"15",
 padding:"1px 4px", borderRadius:2, whiteSpace:"nowrap"}}>
 {chgLabel[p.changeType]||p.changeType}
 </span>
 <span style={{fontSize:11, color:"#94a3b8"}}>{linkifyClauses(p.clauseId, onOpenClause)}</span>
 </div>
 );
 })}
 </div>
 )}
 </div>
 );
 })}

 {/* 조항별 모드: 조항 ID 목록 */}
 {viewMode==="clause" && (
 <>
 <div style={{fontSize:11, color:"#475569", marginBottom:8, padding:"2px 2px"}}>
 변경 이력이 있는 조항 ({allClauseIds.length}개)
 </div>
 {allClauseIds.filter(id=>!search.trim()||id.toLowerCase().includes(search.toLowerCase())).map(id => {
 const changes = patchHistory.filter(h=>(h.patches||[]).some(p=>p.clauseId===id));
 const lastChange = changes[0];
 const lastPatch = (lastChange?.patches||[]).find(p=>p.clauseId===id);
 const cc = chgColor[lastPatch?.changeType]||"#94a3b8";
 return (
 <div key={id} onClick={()=>setSelectedId(selectedId===id?null:id)}
 style={{marginBottom:4, padding:"8px 10px", borderRadius:5, cursor:"pointer",
 border:`1px solid ${selectedId===id?"#60a5fa44":"#334155"}`,
 background:selectedId===id?"#0f1e35":"#1e293b"}}>
 <div style={{display:"flex", alignItems:"center", gap:6}}>
 <span style={{fontSize:10, fontWeight:700,
 color:selectedId===id?"#60a5fa":"#94a3b8"}}>{linkifyClauses(id, onOpenClause)}</span>
 <span style={{fontSize:10, color:cc, background:cc+"15",
 padding:"1px 4px", borderRadius:2, marginLeft:"auto"}}>
 {chgLabel[lastPatch?.changeType]||lastPatch?.changeType}
 </span>
 </div>
 <div style={{fontSize:10, color:"#475569", marginTop:2}}>
 변경 {changes.length}회 · 최종 {lastChange?.effectiveDate||lastChange?.uploadedAt?.slice(0,10)}
 </div>
 </div>
 );
 })}
 </>
 )}
 </div>
 </div>

 {/* -- 오른쪽: 상세 타임라인 -- */}
 <div style={{overflowY:"auto", padding:20}}>

 {/* 타임라인 모드 */}
 {viewMode==="timeline" && (
 <>
 <div style={{fontSize:11, color:"#64748b", marginBottom:16, fontWeight:600}}>
 전체 변경 타임라인 &nbsp;
 <span style={{fontSize:11, color:"#475569", fontWeight:400}}>
 {patchHistory.length}건의 문서 · 총 {patchHistory.reduce((s,h)=>s+(h.patches?.length||0),0)}개 조항 변경
 </span>
 </div>

 {/* 타임라인 */}
 <div style={{position:"relative", paddingLeft:24}}>
 {/* 수직선 */}
 <div style={{position:"absolute", left:8, top:0, bottom:0, width:1,
 background:"linear-gradient(#334155, #33415500)"}}/>

 {filtered.map((h, hi) => {
 const tc = typeColor[h.docType]||"#94a3b8";
 return (
 <div key={h.id} style={{marginBottom:24, position:"relative"}}>
 {/* 노드 */}
 <div style={{position:"absolute", left:-20, top:4, width:10, height:10,
 borderRadius:"50%", background:tc, border:"2px solid #020617",
 boxShadow:`0 0 6px ${tc}88`}}/>

 {/* 헤더 */}
 <div style={{marginBottom:8}}>
 <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:3}}>
 <span style={{fontSize:10, fontWeight:700, color:tc,
 background:tc+"18", padding:"2px 7px", borderRadius:3}}>
 {h.docType}
 </span>
 <span style={{fontSize:11, color:"#cbd5e1", fontWeight:600}}>{h.fileName}</span>
 <div style={{marginLeft:"auto", display:"flex", alignItems:"center", gap:6}}>
  {editingDateId === h.id ? (
   <>
   <input type="date" value={dateInput} onChange={e=>setDateInput(e.target.value)}
    style={{fontSize:11, background:"#1e293b", border:"1px solid #60a5fa",
    borderRadius:4, color:"#e2e8f0", padding:"2px 6px", fontFamily:"inherit"}}/>
   <button onClick={()=>saveEffectiveDate(h.id)}
    style={{fontSize:10, background:"#2563eb", color:"#fff", border:"none",
    borderRadius:4, padding:"2px 7px", cursor:"pointer"}}>저장</button>
   <button onClick={()=>setEditingDateId(null)}
    style={{fontSize:10, background:"#334155", color:"#94a3b8", border:"none",
    borderRadius:4, padding:"2px 7px", cursor:"pointer"}}>취소</button>
   </>
  ) : (
   <>
   <div style={{fontSize:11, color:"#475569", textAlign:"right"}}>
    {h.effectiveDate && <div style={{color:"#60a5fa"}}>공식변경일 {h.effectiveDate}</div>}
    <div>업로드 {h.uploadedAt?.slice(0,10)||""}</div>
   </div>
   <button onClick={()=>{ setEditingDateId(h.id); setDateInput(h.effectiveDate||""); }}
    style={{fontSize:10, background:"#1e293b", color:"#64748b", border:"1px solid #334155",
    borderRadius:4, padding:"2px 6px", cursor:"pointer"}} title="공식 변경일 편집">✎</button>
   </>
  )}
 </div>
 </div>
 {h.summary && (
 <div style={{fontSize:12, color:"#94a3b8", lineHeight:1.65,
 padding:"8px 12px", background:"#1e293b",
 borderLeft:`2px solid ${tc}55`, borderRadius:"0 5px 5px 0"}}>
 {linkifyClauses(h.summary, onOpenClause)}
 </div>
 )}
 </div>

 {/* 조항별 변경 카드 */}
 <div style={{display:"flex", flexDirection:"column", gap:8}}>
 {(h.patches||[]).map((p, pi) => {
 const cc = chgColor[p.changeType]||"#94a3b8";
 return (
 <div key={pi} style={{padding:"12px 14px", borderRadius:6,
 border:`1px solid ${cc}28`, background:cc+"06"}}>
 <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:p.prevCore||p.newCore?8:0}}>
 <span style={{fontSize:11, fontWeight:700, color:cc,
 background:cc+"18", padding:"2px 8px", borderRadius:4}}>
 {chgLabel[p.changeType]||p.changeType}
 </span>
 <span style={{fontSize:12, fontWeight:700, color:"#e2e8f0"}}>{linkifyClauses(p.clauseId, onOpenClause)}</span>
 {p.topic && <span style={{fontSize:12, color:"#64748b"}}>{p.topic}</span>}
 </div>
 {p.prevCore && (
 <div style={{fontSize:12, color:"#64748b", lineHeight:1.65,
 textDecoration:"line-through", marginBottom:6,
 padding:"6px 10px", background:"rgba(30,8,8,0.6)", borderRadius:4}}>
 이전: {linkifyClauses(p.prevCore, onOpenClause)}
 </div>
 )}
 {p.newCore && (
 <div style={{fontSize:12, color:"#cbd5e1", lineHeight:1.65,
 padding:"6px 10px", background:"#1e293b", borderRadius:4}}>
 변경: {linkifyClauses(p.newCore, onOpenClause)}
 </div>
 )}
 </div>
 );
 })}
 </div>
 </div>
 );
 })}
 </div>
 </>
 )}

 {/* 조항별 모드 */}
 {viewMode==="clause" && (
 selectedId ? (
 <>
 <div style={{marginBottom:16}}>
 <div style={{fontSize:13, fontWeight:700, color:"#cbd5e1", marginBottom:4}}>{linkifyClauses(selectedId, onOpenClause)}</div>
 <div style={{fontSize:10, color:"#64748b"}}>
 {clauseHistory.length}건의 문서에서 변경됨
 </div>
 </div>

 {/* 현재 상태 */}
 {(() => {
 const cur = CONTRACT_KB.clauses.find(c=>c.id===selectedId);
 return cur ? (
 <div style={{marginBottom:16, padding:"10px 12px",
 background:"#0a1a0a", border:"1px solid #10b98133", borderRadius:6}}>
 <div style={{fontSize:11, color:"#10b981", fontWeight:700, marginBottom:4}}>현재 상태</div>
 <div style={{fontSize:12, color:"#94a3b8", lineHeight:1.7}}>{linkifyClauses(cur.core, onOpenClause)}</div>
 {cur._amended && (
 <div style={{fontSize:10, color:"#fb923c", marginTop:3}}>⚡ 수정된 조항</div>
 )}
 </div>
 ) : null;
 })()}

 {/* 변경 타임라인 (최신 → 과거) */}
 <div style={{position:"relative", paddingLeft:20}}>
 <div style={{position:"absolute", left:6, top:0, bottom:0, width:1, background:"#334155"}}/>
 {clauseHistory.map((h, hi) => {
 const p = (h.patches||[])[0];
 if (!p) return null;
 const cc = chgColor[p.changeType]||"#94a3b8";
 const tc = typeColor[h.docType]||"#94a3b8";
 return (
 <div key={h.id} style={{marginBottom:16, position:"relative"}}>
 <div style={{position:"absolute", left:-16, top:3, width:8, height:8,
 borderRadius:"50%", background:cc, border:"2px solid #020617"}}/>
 <div style={{marginBottom:4, display:"flex", alignItems:"center", gap:6}}>
 <span style={{fontSize:10, fontWeight:700, color:cc,
 background:cc+"18", padding:"1px 5px", borderRadius:2}}>
 {chgLabel[p.changeType]||p.changeType}
 </span>
 <span style={{fontSize:11, color:tc}}>{h.fileName}</span>
 <span style={{fontSize:10, color:"#475569", marginLeft:"auto"}}>
 {h.effectiveDate||h.uploadedAt?.slice(0,10)}
 </span>
 </div>
 {p.prevCore && (
 <div style={{fontSize:12, color:"#64748b", lineHeight:1.65,
 textDecoration:"line-through", padding:"6px 10px",
 background:"rgba(30,8,8,0.6)", borderRadius:4, marginBottom:4}}>
 {linkifyClauses(p.prevCore, onOpenClause)}
 </div>
 )}
 {p.newCore && (
 <div style={{fontSize:12, color:"#cbd5e1", lineHeight:1.65,
 padding:"6px 10px", background:"#1e293b", borderRadius:4}}>
 {linkifyClauses(p.newCore, onOpenClause)}
 </div>
 )}
 </div>
 );
 })}
 </div>
 </>
 ) : (
 <div style={{display:"flex", flexDirection:"column", alignItems:"center",
 justifyContent:"center", height:"60%", gap:8}}>
 <div style={{fontSize:24, opacity:0.2}}>📋</div>
 <div style={{fontSize:10, color:"#475569", textAlign:"center", lineHeight:1.8}}>
 왼쪽에서 조항을 선택하면<br/>해당 조항의 전체 변경 이력을 볼 수 있습니다
 </div>
 </div>
 )
 )}
 </div>
 </div>
 );
}

// --- CLAUSE HOVER LINK --------------------------------------------------------
function ClauseHoverLink({ clauseId, children }) {
 const [hover, setHover] = useState(false);
 const d = CLAUSE_FULLTEXT[clauseId] || CONTRACT_KB.clauses.find(c => c.id === clauseId);
 return (
  <span style={{position:"relative", display:"inline"}}>
   <span
    onMouseEnter={()=>setHover(true)}
    onMouseLeave={()=>setHover(false)}
    style={{color:"#60a5fa", cursor:"pointer", borderBottom:"1px dashed #60a5fa55", fontWeight:600}}
   >{children}</span>
   {hover && d && (
    <span style={{position:"absolute", bottom:"calc(100% + 8px)", left:"50%", transform:"translateX(-50%)",
     width:300, background:"#0f172a", border:"1px solid #334155", borderRadius:8, padding:12,
     zIndex:200, boxShadow:"0 4px 24px rgba(0,0,0,0.6)", display:"block", pointerEvents:"none"}}>
     <span style={{display:"block", fontSize:10, fontWeight:700, color:"#60a5fa", marginBottom:3}}>{clauseId}</span>
     {d.title && <span style={{display:"block", fontSize:11, fontWeight:600, color:"#e2e8f0", marginBottom:5}}>{d.title}</span>}
     <span style={{display:"block", fontSize:11, color:"#94a3b8", lineHeight:1.6}}>{d.core || d.translation || ""}</span>
     {d.kt_risk && <span style={{display:"block", marginTop:7, paddingTop:7, borderTop:"1px solid #1e293b", fontSize:10, color:"#fcd34d", lineHeight:1.5}}>⚠ {d.kt_risk}</span>}
    </span>
   )}
  </span>
 );
}

// --- HURDLE TRACKER -----------------------------------------------------------
const HURDLE_TARGET = 55000000; // KT가 보유한 라이선스 총량 ($50M 선구매 + $5M 추가)
const PURCHASE_SCHEDULE = [ // KT → Palantir 연간 선구매 (SAA 고정 스케줄, 합계 $50M)
 { year: 1, amount: 8000000, bonus: 0, label: "Y1" },
 { year: 2, amount: 10000000, bonus: 0, label: "Y2" },
 { year: 3, amount: 10000000, bonus: 0, label: "Y3" },
 { year: 4, amount: 11000000, bonus: 0, label: "Y4" },
 { year: 5, amount: 11000000, bonus: 5000000, label: "Y5" }, // Y5: +$5M 추가 라이선스
];

function HurdleTracker() {
 const STORAGE_KEY = "hurdle_data_v3";
 const PURCHASE_KEY = "hurdle_purchase_v1";

 const [records, setRecords] = useState([]);
 const [purchased, setPurchased] = useState({}); // { "1": true, "2": false, ... }
 const [startYear, setStartYear] = useState(2025);
 const [showForm, setShowForm] = useState(false);
 const [activeTab, setActiveTab] = useState("revenue"); // "revenue" | "purchase"
 const EMPTY_FORM = { date:"", years:"1", yearlyAmounts:[""], customer:"", customerType:"Target Market", note:"" };
 const [form, setForm] = useState(EMPTY_FORM);
 const [editId, setEditId] = useState(null);

 useEffect(() => {
  (async () => {
   try {
    const s1 = await storage.get(STORAGE_KEY);
    if (s1) {
     const parsed = typeof s1 === "string" ? JSON.parse(s1) : s1;
     setRecords(parsed.records || []);
     setStartYear(parsed.startYear || 2025);
    }
    const s2 = await storage.get(PURCHASE_KEY);
    if (s2) setPurchased(typeof s2 === "string" ? JSON.parse(s2) : s2);
   } catch(e) {}
  })();
 }, []);

 const saveRecords = async (recs, sy) => {
  try { await storage.set(STORAGE_KEY, JSON.stringify({ records: recs, startYear: sy })); } catch(e) {}
 };
 const savePurchased = async (p) => {
  try { await storage.set(PURCHASE_KEY, JSON.stringify(p)); } catch(e) {}
 };

 // -- Revenue 실적 계산 ------------------------------------------------------
 const totalRevenue = records.reduce((s, r) => s + (r.amount || 0), 0);
 const remaining = Math.max(0, HURDLE_TARGET - totalRevenue);
 const pct = Math.min(100, (totalRevenue / HURDLE_TARGET) * 100);
 const riskLevel = pct >= 100 ? "달성" : pct >= 70 ? "LOW" : pct >= 40 ? "MEDIUM" : "HIGH";
 const riskColor = { 달성:"#10b981", LOW:"#10b981", MEDIUM:"#f59e0b", HIGH:"#ff2d20" }[riskLevel];

 // -- 선구매 계산 ------------------------------------------------------------
 const totalPurchased = PURCHASE_SCHEDULE.reduce((s, p) => purchased[p.year] ? s + p.amount : s, 0);
 const totalLicense = PURCHASE_SCHEDULE.reduce((s, p) => purchased[p.year] ? s + p.amount + p.bonus : s, 0);
 const unusedLicense = Math.max(0, totalLicense - totalRevenue);

 const fmt = (n) => n >= 1000000 ? `$${(n/1000000).toFixed(1)}M` : `$${n.toLocaleString()}`;

 // -- Hurdle 달성 페이스 계산 --------------------------------------------------
 const CONTRACT_END = new Date("2030-05-30");
 const today = new Date();
 const monthsToEnd = Math.max(1,
  (CONTRACT_END.getFullYear() - today.getFullYear()) * 12 +
  (CONTRACT_END.getMonth() - today.getMonth()));
 const requiredMonthly = remaining > 0 ? remaining / monthsToEnd : 0;
 const sortedRecs = [...records].sort((a,b) => a.date.localeCompare(b.date));
 const firstDate = sortedRecs.length > 0 ? new Date(sortedRecs[0].date) : null;
 const monthsElapsed = firstDate
  ? Math.max(1, (today.getFullYear()-firstDate.getFullYear())*12+(today.getMonth()-firstDate.getMonth())+1)
  : 0;
 const currentPace = monthsElapsed > 0 && totalRevenue > 0 ? totalRevenue / monthsElapsed : 0;
 const projectedDate = currentPace > 0 && remaining > 0
  ? new Date(today.getFullYear(), today.getMonth() + Math.ceil(remaining / currentPace), 1)
  : remaining <= 0 ? today : null;
 const projectedStr = projectedDate
  ? `${projectedDate.getFullYear()}.${String(projectedDate.getMonth()+1).padStart(2,"0")}`
  : "–";
 const onTrack = projectedDate && projectedDate <= CONTRACT_END;

 const addOrUpdate = async () => {
 if (!form.date || !form.yearlyAmounts.length) return;
 const yearlyParsed = form.yearlyAmounts.map(a => parseFloat(String(a).replace(/,/g,'')) || 0);
 const amount = yearlyParsed.reduce((s,v)=>s+v, 0);
 if (amount <= 0) return;
 const record = { ...form, amount, yearlyAmounts: yearlyParsed, years: parseInt(form.years)||1 };
 let newRecs;
 if (editId) {
 newRecs = records.map(r => r.id === editId ? { ...r, ...record, id: r.id } : r);
 setEditId(null);
 } else {
 newRecs = [...records, { id: Date.now(), ...record }];
 }
 setRecords(newRecs);
 saveRecords(newRecs, startYear);
 setForm(EMPTY_FORM);
 setShowForm(false);
 };

 const deleteRecord = async (id) => {
 const newRecs = records.filter(r => r.id !== id);
 setRecords(newRecs);
 saveRecords(newRecs, startYear);
 };

 const startEdit = (r) => {
 const yrs = r.years || 1;
 const ya = r.yearlyAmounts && r.yearlyAmounts.length === yrs
 ? r.yearlyAmounts.map(String)
 : Array(yrs).fill(String(Math.round(r.amount / yrs)));
 setForm({ date:r.date, years:String(yrs), yearlyAmounts:ya,
 customer:r.customer||"", customerType:r.customerType||"Target Market", note:r.note||"" });
 setEditId(r.id); setShowForm(true);
 };

 const togglePurchased = async (year) => {
 const next = { ...purchased, [year]: !purchased[year] };
 setPurchased(next);
 savePurchased(next);
 };

 const ctColor = { "Target Market":"#60a5fa", "KT그룹":"#34d399" };

 return (
 <div style={{height:"100%", overflowY:"auto", padding:24, background:"#07070f"}}>
 <div style={{maxWidth:960, margin:"0 auto"}}>

 {/* 타이틀 */}
 <div style={{marginBottom:20, display:"flex", alignItems:"center", justifyContent:"space-between", gap:16}}>
 <div>
 <div style={{fontSize:14, fontWeight:700, color:"#cbd5e1", marginBottom:4}}>Hurdle 달성 트래커</div>
 <div style={{fontSize:10, color:"#475569", lineHeight:1.7}}>
 SAA §6.3 — KT 라이선스 총량: <span style={{color:"#60a5fa"}}>{fmt(HURDLE_TARGET)}</span>
 &nbsp;(선구매 $50M + Y5 추가 $5M) &nbsp;|&nbsp; 미달성 해지 시 Surviving QRC good faith 협상
 </div>
 </div>
 <div style={{display:"flex", alignItems:"center", gap:8}}>
 <span style={{fontSize:11, color:"#475569"}}>계약 시작</span>
 <input type="number" value={startYear} onChange={e=>{ setStartYear(+e.target.value); saveRecords(records,+e.target.value); }}
 style={{width:64, background:"#1e293b", border:"1px solid #334155", borderRadius:4,
 padding:"4px 6px", fontSize:11, color:"#e2e8f0", fontFamily:"inherit", outline:"none", textAlign:"center"}}/>
 </div>
 </div>

 {/* -- 요약 카드 4개 -- */}
 <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:10, marginBottom:20}}>
 {[
 { label:"선구매 누적", value:fmt(totalPurchased), sub:`${fmt(50000000)} 목표`, color:"#a78bfa" },
 { label:"확보 라이선스", value:fmt(totalLicense), sub:`미사용 ${fmt(unusedLicense)}`, color:"#34d399" },
 { label:"Revenue 달성", value:fmt(totalRevenue), sub:`${pct.toFixed(1)}% / Hurdle`, color:riskColor },
 { label:"Hurdle 상태", value:riskLevel, sub:riskLevel==="달성"?"QRC 협상력 확보":"미달 시 협상 불리", color:riskColor },
 ].map((c,i) => (
 <div key={i} style={{background:"#020617", border:`1px solid ${c.color}33`, borderRadius:8, padding:"12px 14px"}}>
 <div style={{fontSize:11, color:"#64748b", marginBottom:5}}>{c.label}</div>
 <div style={{fontSize:18, fontWeight:700, color:c.color, marginBottom:3}}>{c.value}</div>
 <div style={{fontSize:10, color:"#475569"}}>{c.sub}</div>
 </div>
 ))}
 </div>

 {/* -- 내부 탭 -- */}
 <div style={{display:"flex", borderBottom:"1px solid #334155", marginBottom:16, gap:0}}>
 {[["revenue","📈 Revenue 실적 (Hurdle)"],["purchase","💳 연간 선구매 스케줄"]].map(([k,label])=>(
 <button key={k} onClick={()=>setActiveTab(k)}
 style={{padding:"8px 18px", fontSize:11, fontWeight:600, border:"none", cursor:"pointer",
 fontFamily:"inherit", background:"transparent",
 borderBottom:activeTab===k?"2px solid #60a5fa":"2px solid transparent",
 color:activeTab===k?"#60a5fa":"#64748b"}}>
 {label}
 </button>
 ))}
 </div>

 {/* ---------- Revenue 탭 ---------- */}
 {activeTab==="revenue" && (<>

 {/* 프로그레스 바 */}
 <div style={{marginBottom:16, background:"#020617", border:"1px solid #334155", borderRadius:8, padding:16}}>
 <div style={{display:"flex", justifyContent:"space-between", marginBottom:8}}>
 <span style={{fontSize:10, color:"#94a3b8", fontWeight:600}}>Hurdle 달성률</span>
 <span style={{fontSize:10, color:riskColor, fontWeight:700}}>{fmt(totalRevenue)} / {fmt(HURDLE_TARGET)}</span>
 </div>
 <div style={{background:"#1e293b", borderRadius:4, height:14, overflow:"hidden", position:"relative"}}>
 <div style={{position:"absolute", height:"100%", borderRadius:4,
 background:`linear-gradient(90deg, ${riskColor}88, ${riskColor})`,
 width:`${pct}%`, transition:"width 0.4s"}}/>
 <div style={{position:"absolute", left:"70%", top:0, width:1, height:"100%", background:"#f59e0b66"}}/>
 </div>
 <div style={{display:"flex", justifyContent:"space-between", marginTop:4, fontSize:10, color:"#2a3a4a"}}>
 <span>$0</span>
 <span style={{color:"#f59e0b55"}}>70% ($38.5M)</span>
 <span>{fmt(HURDLE_TARGET)}</span>
 </div>
 </div>

 {/* Hurdle 달성 페이스 분석 */}
 <div style={{marginBottom:16, background:"#020617", border:"1px solid #334155", borderRadius:8, padding:16}}>
 <div style={{fontSize:10, color:"#94a3b8", fontWeight:600, marginBottom:12}}>Hurdle 달성 페이스 분석</div>

 {/* 상단 3개 지표 — 항상 표시 */}
 <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom: currentPace>0 ? 10 : 0}}>
  <div style={{background:"#1e293b", borderRadius:6, padding:"10px 12px"}}>
   <div style={{fontSize:10, color:"#64748b", marginBottom:4}}>잔여 목표</div>
   <div style={{fontSize:15, fontWeight:700, color:riskColor}}>{remaining > 0 ? fmt(remaining) : "달성 완료"}</div>
   <div style={{fontSize:10, color:"#475569", marginTop:2}}>Hurdle {fmt(HURDLE_TARGET)} 기준</div>
  </div>
  <div style={{background:"#1e293b", borderRadius:6, padding:"10px 12px"}}>
   <div style={{fontSize:10, color:"#64748b", marginBottom:4}}>잔여 기간</div>
   <div style={{fontSize:15, fontWeight:700, color:"#cbd5e1"}}>{monthsToEnd}개월</div>
   <div style={{fontSize:10, color:"#475569", marginTop:2}}>2030.05.30 만료</div>
  </div>
  <div style={{background:"#1e293b", borderRadius:6, padding:"10px 12px", border:`1px solid ${currentPace>0 && !onTrack?"#ef444422":"#334155"}`}}>
   <div style={{fontSize:10, color:"#64748b", marginBottom:4}}>필요 월 Revenue</div>
   <div style={{fontSize:15, fontWeight:700, color: currentPace>0 && currentPace<requiredMonthly?"#ef4444":"#f59e0b"}}>
    {remaining > 0 ? `${fmt(Math.ceil(requiredMonthly))}/월` : "–"}
   </div>
   <div style={{fontSize:10, color:"#475569", marginTop:2}}>잔여 ÷ 잔여기간</div>
  </div>
 </div>

 {/* 실적 있을 때 — 현재 페이스 vs 달성 예상 */}
 {currentPace > 0 && (
  <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:10}}>
   <div style={{background:"#1e293b", borderRadius:6, padding:"10px 12px"}}>
    <div style={{fontSize:10, color:"#64748b", marginBottom:4}}>현재 페이스</div>
    <div style={{fontSize:14, fontWeight:700, color:"#60a5fa"}}>{fmt(Math.ceil(currentPace))}/월</div>
    <div style={{fontSize:10, marginTop:2, color: currentPace >= requiredMonthly ? "#10b981" : "#ef4444"}}>
     {currentPace >= requiredMonthly ? "▲ 필요 페이스 초과" : `▼ ${fmt(Math.ceil(requiredMonthly - currentPace))}/월 부족`}
    </div>
   </div>
   <div style={{background:"#1e293b", borderRadius:6, padding:"10px 12px"}}>
    <div style={{fontSize:10, color:"#64748b", marginBottom:4}}>달성 예상 시점</div>
    <div style={{fontSize:14, fontWeight:700, color: remaining<=0?"#10b981": onTrack?"#10b981":"#ef4444"}}>
     {remaining<=0 ? "달성 완료" : projectedStr}
    </div>
    <div style={{fontSize:10, color:"#475569", marginTop:2}}>
     {remaining<=0 ? "Hurdle 충족" : onTrack ? "기간 내 달성 가능" : "⚠ 2030.05 초과 예상"}
    </div>
   </div>
  </div>
 )}
 </div>

 {/* 입력 폼 */}
 <div style={{marginBottom:12, display:"flex", justifyContent:"flex-end"}}>
 <button onClick={()=>{ setShowForm(!showForm); setEditId(null); setForm(EMPTY_FORM); }}
 style={{padding:"6px 16px", background:"#1e3a6e", border:"1px solid #60a5fa44",
 borderRadius:5, color:"#60a5fa", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit"}}>
 {showForm?"닫기":"+ 실적 입력"}
 </button>
 </div>
 {showForm && (
 <div style={{marginBottom:14, padding:16, background:"#020617", border:"1px solid #334155", borderRadius:8}}>
 {/* 1행: 체결일 / 고객 유형 / 고객사 / 계약기간 / 내용 */}
 <div style={{display:"grid", gridTemplateColumns:"140px 130px 1fr 100px 1fr", gap:10, marginBottom:12, alignItems:"end"}}>
 <div>
 <div style={{fontSize:11, color:"#64748b", marginBottom:4}}>계약 체결일</div>
 <input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}
 style={{width:"100%",background:"#1e293b",border:"1px solid #334155",borderRadius:4,
 padding:"6px 8px",fontSize:11,color:"#e2e8f0",fontFamily:"inherit",outline:"none",
 boxSizing:"border-box",colorScheme:"dark"}}/>
 </div>
 <div>
 <div style={{fontSize:11, color:"#64748b", marginBottom:4}}>고객 유형</div>
 <select value={form.customerType} onChange={e=>setForm({...form,customerType:e.target.value})}
 style={{width:"100%",background:"#1e293b",border:"1px solid #334155",borderRadius:4,
 padding:"6px 8px",fontSize:11,color:"#e2e8f0",fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}>
 {["Target Market","KT그룹"].map(t=><option key={t} value={t}>{t}</option>)}
 </select>
 </div>
 <div>
 <div style={{fontSize:11, color:"#64748b", marginBottom:4}}>고객사</div>
 <input value={form.customer} onChange={e=>setForm({...form,customer:e.target.value})}
 placeholder="현대자동차"
 style={{width:"100%",background:"#1e293b",border:"1px solid #334155",borderRadius:4,
 padding:"6px 8px",fontSize:11,color:"#e2e8f0",fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
 </div>
 <div>
 <div style={{fontSize:11, color:"#64748b", marginBottom:4}}>계약 기간</div>
 <select value={form.years} onChange={e=>{
 const y = parseInt(e.target.value)||1;
 const prev = form.yearlyAmounts;
 const next = Array(y).fill("").map((_,i)=>prev[i]||"");
 setForm({...form, years:String(y), yearlyAmounts:next});
 }}
 style={{width:"100%",background:"#1e293b",border:"1px solid #334155",borderRadius:4,
 padding:"6px 8px",fontSize:11,color:"#e2e8f0",fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}>
 {[1,2,3,4,5].map(y=><option key={y} value={y}>{y}년</option>)}
 </select>
 </div>
 <div>
 <div style={{fontSize:11, color:"#64748b", marginBottom:4}}>계약 내용</div>
 <input value={form.note} onChange={e=>setForm({...form,note:e.target.value})}
 placeholder="플랫폼 라이선스"
 style={{width:"100%",background:"#1e293b",border:"1px solid #334155",borderRadius:4,
 padding:"6px 8px",fontSize:11,color:"#e2e8f0",fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
 </div>
 </div>

 {/* 2행: 연도별 지급액 */}
 <div style={{marginBottom:12}}>
 <div style={{fontSize:11, color:"#64748b", marginBottom:6}}>
 연도별 지급액 (USD) &nbsp;
 <span style={{color:"#2a3a4a"}}>
 총액: ${form.yearlyAmounts.reduce((s,v)=>s+(parseFloat(String(v).replace(/,/g,''))||0),0).toLocaleString()}
 </span>
 </div>
 <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
 {form.yearlyAmounts.map((amt, i) => (
 <div key={i} style={{display:"flex", flexDirection:"column", gap:3, minWidth:100}}>
 <div style={{fontSize:10, color:"#475569"}}>{i+1}년차</div>
 <input
 value={amt}
 onChange={e=>{
 const next = [...form.yearlyAmounts];
 next[i] = e.target.value;
 setForm({...form, yearlyAmounts:next});
 }}
 placeholder="1500000"
 style={{background:"#1e293b",border:"1px solid #334155",borderRadius:4,
 padding:"6px 8px",fontSize:11,color:"#e2e8f0",fontFamily:"inherit",
 outline:"none",width:"100%",boxSizing:"border-box"}}/>
 </div>
 ))}
 </div>
 </div>

 <div style={{display:"flex", gap:8}}>
 <button onClick={addOrUpdate}
 style={{padding:"6px 20px",background:"#1e3a6e",border:"1px solid #60a5fa44",
 borderRadius:4,color:"#60a5fa",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
 {editId?"수정 완료":"저장"}
 </button>
 <button onClick={()=>{setShowForm(false);setEditId(null);setForm(EMPTY_FORM);}}
 style={{padding:"6px 14px",background:"none",border:"1px solid #334155",
 borderRadius:4,color:"#64748b",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>취소</button>
 </div>
 </div>
 )}

 {/* 실적 테이블 */}
 <div style={{background:"#020617",border:"1px solid #334155",borderRadius:8,overflow:"hidden",marginBottom:16}}>
 <div style={{padding:"10px 16px",borderBottom:"1px solid #334155",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
 <span style={{fontSize:10,color:"#94a3b8",fontWeight:600}}>Revenue 실적 ({records.length}건)</span>
 <span style={{fontSize:11,color:"#475569"}}>{records.length>0?`합계 ${fmt(totalRevenue)}`:""}</span>
 </div>
 {records.length===0 ? (
 <div style={{padding:"28px",textAlign:"center",fontSize:10,color:"#475569",lineHeight:1.8}}>
 실적 없음 — "+ 실적 입력"으로 고객 계약 체결 건을 기록하세요
 </div>
 ) : (
 <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
 <thead>
 <tr style={{borderBottom:"1px solid #334155"}}>
 {["계약일","고객사","유형","계약구조","총액","내용",""].map((h,i)=>(
 <th key={i} style={{padding:"7px 12px",textAlign:"left",fontSize:11,color:"#475569",fontWeight:600}}>{h}</th>
 ))}
 </tr>
 </thead>
 <tbody>
 {[...records].sort((a,b)=>b.date.localeCompare(a.date)).map(r=>{
 const cc = ctColor[r.customerType]||"#94a3b8";
 return (
 <tr key={r.id} style={{borderBottom:"1px solid #0f0f1a"}}>
 <td style={{padding:"7px 12px",color:"#94a3b8",whiteSpace:"nowrap"}}>{r.date}</td>
 <td style={{padding:"7px 12px",color:"#cbd5e1",fontWeight:500}}>{r.customer||"-"}</td>
 <td style={{padding:"7px 12px"}}>
 <span style={{fontSize:10,fontWeight:700,color:cc,background:cc+"18",padding:"1px 5px",borderRadius:2}}>{r.customerType}</span>
 </td>
 <td style={{padding:"7px 12px"}}>
 {r.yearlyAmounts && r.years > 1 ? (
 <div>
 <span style={{fontSize:11,color:"#94a3b8"}}>{r.years}년 계약</span>
 <div style={{display:"flex",gap:3,marginTop:2,flexWrap:"wrap"}}>
 {r.yearlyAmounts.map((a,i)=>(
 <span key={i} style={{fontSize:10,color:"#60a5fa66",background:"#60a5fa0a",
 padding:"1px 4px",borderRadius:2}}>Y{i+1}:{fmt(a)}</span>
 ))}
 </div>
 </div>
 ) : (
 <span style={{fontSize:11,color:"#94a3b8"}}>1년 계약</span>
 )}
 </td>
 <td style={{padding:"7px 12px",color:"#60a5fa",fontWeight:600,whiteSpace:"nowrap"}}>{fmt(r.amount)}</td>
 <td style={{padding:"7px 12px",color:"#64748b",fontSize:9}}>{r.note||"-"}</td>
 <td style={{padding:"7px 12px"}}>
 <div style={{display:"flex",gap:6}}>
 <button onClick={()=>startEdit(r)}
 style={{background:"none",border:"1px solid #334155",borderRadius:2,
 padding:"2px 7px",fontSize:10,color:"#64748b",cursor:"pointer",fontFamily:"inherit"}}>수정</button>
 <button onClick={()=>deleteRecord(r.id)}
 style={{background:"none",border:"none",color:"#475569",cursor:"pointer",
 fontSize:13,fontFamily:"inherit",lineHeight:1}}>×</button>
 </div>
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 )}
 </div>

 {/* 리스크 인사이트 */}
 {records.length>0 && (
 <div style={{padding:"12px 16px",
 background:riskLevel==="HIGH"?"#1a0808":riskLevel==="MEDIUM"?"#1a1208":"#081a0f",
 border:`1px solid ${riskColor}33`,borderRadius:8}}>
 <div style={{fontSize:10,color:riskColor,fontWeight:700,marginBottom:6}}>⚖️ Hurdle 리스크 분석 (SAA §6.3)</div>
 <div style={{fontSize:10,color:"#94a3b8",lineHeight:1.8}}>
 {riskLevel==="달성" ? <>
  Hurdle {fmt(HURDLE_TARGET)} 달성. 계약 해지 시에도{" "}
  <ClauseHoverLink clauseId="SAA-6.3">SAA §6.3</ClauseHoverLink>에 따라
  Surviving QRC 수익 배분 협상 권리 보유.
 </> : riskLevel==="LOW" ? <>
  {pct.toFixed(1)}% 달성 — 잔여 {fmt(remaining)} 추가 확보 시 Hurdle 충족 가능.
 </> : riskLevel==="MEDIUM" ? <>
  {pct.toFixed(1)}% 달성 — 잔여 {fmt(remaining)} 미확보 시 해지 후{" "}
  <ClauseHoverLink clauseId="SAA-6.3">SAA §6.3</ClauseHoverLink> 협상에서 KT 협상력 약화 우려.
  Surviving QRC 수익은{" "}
  <ClauseHoverLink clauseId="SAA-2.11">SAA §2.11</ClauseHoverLink>에 따라 KT 10% 고정 배분 위험.
 </> : <>
  {pct.toFixed(1)}% 달성 — 목표 대비 현저히 부족. Hurdle 미달성 해지 시{" "}
  <ClauseHoverLink clauseId="SAA-2.11">SAA §2.11</ClauseHoverLink>에 따라
  Surviving QRC 수익이 KT 10% / Palantir 90%로 고정 배분될 리스크 HIGH.
  <ClauseHoverLink clauseId="SAA-6.3">SAA §6.3</ClauseHoverLink> 협상권 선제 확보 필요.
 </>}
 </div>
 </div>
 )}
 </>)}

 {/* ---------- 선구매 스케줄 탭 ---------- */}
 {activeTab==="purchase" && (
 <div>
 <div style={{fontSize:10,color:"#64748b",marginBottom:14,lineHeight:1.7}}>
 SAA에 고정된 KT → Palantir 연간 선구매 스케줄입니다. 실제 지급 완료 시 체크하세요.<br/>
 Y5 지급 시 Palantir으로부터 추가 $5M 라이선스를 수취합니다.
 </div>

 {/* 선구매 진행 바 */}
 <div style={{marginBottom:20,background:"#020617",border:"1px solid #334155",borderRadius:8,padding:16}}>
 <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
 <span style={{fontSize:10,color:"#94a3b8",fontWeight:600}}>선구매 진행률</span>
 <span style={{fontSize:10,color:"#a78bfa",fontWeight:700}}>{fmt(totalPurchased)} / $50M</span>
 </div>
 <div style={{background:"#1e293b",borderRadius:4,height:10,overflow:"hidden"}}>
 <div style={{height:"100%",borderRadius:4,background:"linear-gradient(90deg,#a78bfa88,#a78bfa)",
 width:`${Math.min(100,(totalPurchased/50000000)*100)}%`,transition:"width 0.4s"}}/>
 </div>
 </div>

 {/* 연도별 카드 */}
 <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10}}>
 {PURCHASE_SCHEDULE.map(p=>{
 const yr = startYear + p.year - 1;
 const done = !!purchased[p.year];
 const totalWithBonus = p.amount + p.bonus;
 return (
 <div key={p.year}
 style={{background:"#020617",border:`1px solid ${done?"#a78bfa44":"#334155"}`,
 borderRadius:8,padding:14,cursor:"pointer",transition:"all 0.15s",
 opacity:done?1:0.7}}
 onClick={()=>togglePurchased(p.year)}>
 <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
 <span style={{fontSize:11,fontWeight:700,color:done?"#a78bfa":"#64748b"}}>{p.label}</span>
 <span style={{fontSize:11,color:"#475569"}}>{yr}년</span>
 </div>
 <div style={{fontSize:16,fontWeight:700,color:done?"#cbd5e1":"#475569",marginBottom:4}}>
 {fmt(p.amount)}
 </div>
 {p.bonus>0 && (
 <div style={{fontSize:11,color:"#34d399",marginBottom:6}}>
 +{fmt(p.bonus)} 라이선스 추가 수취
 </div>
 )}
 <div style={{fontSize:11,color:"#475569",marginBottom:8}}>
 확보 라이선스: {fmt(totalWithBonus)}
 </div>
 <div style={{display:"flex",alignItems:"center",gap:6}}>
 <div style={{width:12,height:12,borderRadius:"50%",border:`2px solid ${done?"#a78bfa":"#334155"}`,
 background:done?"#a78bfa":"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>
 {done && <span style={{fontSize:10,color:"#07070f",fontWeight:700}}>✓</span>}
 </div>
 <span style={{fontSize:11,color:done?"#a78bfa":"#475569"}}>{done?"지급 완료":"미지급"}</span>
 </div>
 </div>
 );
 })}
 </div>

 {/* 합계 요약 */}
 <div style={{marginTop:16,padding:"12px 16px",background:"#020617",border:"1px solid #334155",borderRadius:8}}>
 <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16,fontSize:10}}>
 <div>
 <div style={{color:"#64748b",marginBottom:3}}>총 선구매 (5년)</div>
 <div style={{color:"#a78bfa",fontWeight:700,fontSize:14}}>$50M</div>
 </div>
 <div>
 <div style={{color:"#64748b",marginBottom:3}}>총 확보 라이선스</div>
 <div style={{color:"#34d399",fontWeight:700,fontSize:14}}>$55M <span style={{fontSize:10,fontWeight:400}}>(Y5 +$5M 포함)</span></div>
 </div>
 <div>
 <div style={{color:"#64748b",marginBottom:3}}>현재 확보 라이선스</div>
 <div style={{color:"#60a5fa",fontWeight:700,fontSize:14}}>{fmt(totalLicense)}</div>
 <div style={{color:"#475569",fontSize:10,marginTop:2}}>미사용 {fmt(unusedLicense)}</div>
 </div>
 </div>
 </div>
 </div>
 )}

 </div>
 </div>
 );
}

// --- HISTORY TAB --------------------------------------------------------------
function HistoryTab({ history, onSelect, onDelete, onUpdateMemo, onClear }) {
 const [filter, setFilter] = useState("all"); // all | HIGH | MEDIUM | LOW
 const [editingId, setEditingId] = useState(null);
 const [editMemo, setEditMemo] = useState("");
 const [search, setSearch] = useState("");
 const [selectedId, setSelectedId] = useState(null);

 const filtered = history.filter(h => {
 const matchRisk = filter === "all" || h.result?.risk_level === filter;
 const matchSearch = !search.trim() ||
 h.query.toLowerCase().includes(search.toLowerCase()) ||
 (h.memo||"").toLowerCase().includes(search.toLowerCase()) ||
 (h.result?.situation_summary||"").toLowerCase().includes(search.toLowerCase());
 return matchRisk && matchSearch;
 });

 const startEdit = (h, e) => {
 e.stopPropagation();
 setEditingId(h.id);
 setEditMemo(h.memo || "");
 };

 const saveEdit = (id, e) => {
 e.stopPropagation();
 onUpdateMemo(id, editMemo);
 setEditingId(null);
 };

 const selected = history.find(h => h.id === selectedId);

 return (
 <div style={{display:"grid", gridTemplateColumns:"300px 1fr", height:"100%", overflow:"hidden"}}>

  {/* ── 왼쪽: 목록 ── */}
  <div style={{borderRight:"1px solid #334155", display:"flex", flexDirection:"column", overflow:"hidden", background:"#0f172a"}}>

   {/* 검색 + 필터 */}
   <div style={{padding:"12px 14px", borderBottom:"1px solid #334155"}}>
    <input value={search} onChange={e=>setSearch(e.target.value)}
     placeholder="이슈 내용, 메모 검색..."
     style={{width:"100%", background:"#1e293b", border:"1px solid #334155", borderRadius:5,
      padding:"7px 11px", fontSize:11, color:"#e2e8f0", fontFamily:"inherit",
      outline:"none", boxSizing:"border-box", marginBottom:8}}
    />
    <div style={{display:"flex", gap:4}}>
     {[["all","전체"], ["HIGH","HIGH"], ["MEDIUM","MED"], ["LOW","LOW"]].map(([v,label]) => {
      const c = v==="HIGH"?"#ef4444":v==="MEDIUM"?"#f59e0b":v==="LOW"?"#22c55e":"#94a3b8";
      return (
       <button key={v} onClick={()=>setFilter(v)}
        style={{flex:1, padding:"5px 0", borderRadius:4, border:`1px solid ${filter===v?c+"66":"#334155"}`,
         background:filter===v?c+"15":"#1e293b", color:filter===v?c:"#64748b",
         fontSize:10, fontWeight:600, cursor:"pointer", fontFamily:"inherit", transition:"all 0.15s"}}>
        {label}
       </button>
      );
     })}
    </div>
   </div>

   {/* 건수 + 전체삭제 */}
   <div style={{padding:"7px 14px", borderBottom:"1px solid #334155", display:"flex", alignItems:"center", justifyContent:"space-between"}}>
    <span style={{fontSize:10, color:"#64748b"}}>
     {filtered.length}건 {filter!=="all"||search?`/ 전체 ${history.length}건`:""}
    </span>
    {history.length > 0 && (
     <button onClick={()=>{if(confirm("전체 히스토리를 삭제할까요?")) onClear();}}
      style={{fontSize:10, color:"#64748b", background:"none", border:"1px solid #334155",
       borderRadius:4, padding:"2px 8px", cursor:"pointer", fontFamily:"inherit"}}>
      전체 삭제
     </button>
    )}
   </div>

   {/* 히스토리 목록 */}
   <div style={{flex:1, overflowY:"auto", padding:"8px 10px"}}>
    {filtered.length === 0 ? (
     <div style={{textAlign:"center", padding:"32px 0", fontSize:11, color:"#475569"}}>
      {history.length === 0 ? "분석 기록이 없습니다" : "검색 결과 없음"}
     </div>
    ) : filtered.map(h => {
     const rc = RISK_COLOR[h.result?.risk_level] || "#94a3b8";
     const isSelected = selectedId === h.id;
     return (
      <div key={h.id} onClick={()=>{ setSelectedId(h.id); onSelect(h); }}
       style={{marginBottom:6, borderRadius:6, padding:"10px 12px", cursor:"pointer",
        border:`1px solid ${isSelected?rc+"55":"#334155"}`,
        background:isSelected?rc+"0c":"#1e293b", transition:"all 0.1s"}}>

       <div style={{display:"flex", alignItems:"center", gap:6, marginBottom:5}}>
        <span style={{fontSize:10, fontWeight:700, color:rc, background:rc+"18", padding:"2px 7px", borderRadius:4}}>
         {h.result?.risk_level}
        </span>
        {h.memo && <span style={{fontSize:11, color:"#a78bfa", background:"#a78bfa18", padding:"1px 6px", borderRadius:3}}>메모</span>}
        <span style={{fontSize:10, color:"#475569", marginLeft:"auto"}}>{h.ts}</span>
        <button onClick={e=>{e.stopPropagation(); if(confirm("이 항목을 삭제할까요?")) onDelete(h.id);}}
         style={{background:"none", border:"none", color:"#475569", cursor:"pointer", fontSize:14, padding:"0 2px", lineHeight:1}}>×</button>
       </div>

       <div style={{fontSize:11, color:"#cbd5e1", lineHeight:1.5, marginBottom:5}}>
        {h.query.length > 60 ? h.query.slice(0,60)+"…" : h.query}
       </div>

       {editingId === h.id ? (
        <div onClick={e=>e.stopPropagation()} style={{marginTop:5}}>
         <textarea value={editMemo} onChange={e=>setEditMemo(e.target.value)} autoFocus
          style={{width:"100%", background:"#0f172a", border:"1px solid #a78bfa44", borderRadius:4,
           padding:"5px 8px", fontSize:10, color:"#e2e8f0", fontFamily:"inherit",
           resize:"none", height:56, outline:"none", boxSizing:"border-box"}}/>
         <div style={{display:"flex", gap:4, marginTop:4}}>
          <button onClick={e=>saveEdit(h.id,e)}
           style={{flex:1, fontSize:10, background:"rgba(167,139,250,0.1)", border:"1px solid #a78bfa44",
            color:"#a78bfa", borderRadius:4, padding:"4px", cursor:"pointer", fontFamily:"inherit"}}>저장</button>
          <button onClick={e=>{e.stopPropagation();setEditingId(null);}}
           style={{flex:1, fontSize:10, background:"none", border:"1px solid #334155",
            color:"#64748b", borderRadius:4, padding:"4px", cursor:"pointer", fontFamily:"inherit"}}>취소</button>
         </div>
        </div>
       ) : (
        <div style={{display:"flex", alignItems:"flex-start", gap:6}}>
         {h.memo && <div style={{fontSize:10, color:"#a78bfa", flex:1, lineHeight:1.4}}>{h.memo.length>50?h.memo.slice(0,50)+"…":h.memo}</div>}
         <button onClick={e=>startEdit(h,e)}
          style={{background:"none", border:"1px solid #334155", borderRadius:4,
           padding:"2px 8px", fontSize:11, color:"#64748b", cursor:"pointer", fontFamily:"inherit",
           whiteSpace:"nowrap", marginLeft:"auto"}}>
          {h.memo ? "메모 수정" : "메모 추가"}
         </button>
        </div>
       )}

       <div style={{display:"flex", gap:8, marginTop:5, fontSize:10, color:"#475569"}}>
        <span>조항 {h.result?.triggered_clauses?.length||0}개</span>
        <span>충돌 {h.result?.related_conflicts?.length||0}건</span>
        <span style={{marginLeft:"auto", color:h.mode==="extended"?"#a78bfa":"#60a5fa"}}>
         {h.mode==="extended"?"확장":"기본"}
        </span>
       </div>
      </div>
     );
    })}
   </div>
  </div>

  {/* ── 오른쪽: 선택된 분석 결과 ── */}
  <div style={{overflowY:"auto", padding:24, background:"#020617"}}>
   {selected ? (
    <div>
     <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:12}}>
      <span style={{fontSize:10, color:"#64748b", textTransform:"uppercase", letterSpacing:"0.08em"}}>이슈</span>
      <span style={{fontSize:12, color:"#94a3b8", background:"#0f172a", border:"1px solid #334155",
       borderRadius:5, padding:"3px 10px", flex:1}}>{selected.query}</span>
      <span style={{fontSize:10, color:"#475569"}}>{selected.ts}</span>
     </div>
     {selected.memo && (
      <div style={{marginBottom:12, padding:"9px 14px", background:"rgba(167,139,250,0.08)",
       border:"1px solid #a78bfa33", borderRadius:6, fontSize:12, color:"#a78bfa", lineHeight:1.6}}>
       📝 {selected.memo}
      </div>
     )}
     <ErrorBoundary><AnalysisResult result={selected.result} query={selected.query} mode={selected.mode} amendments={[]}/></ErrorBoundary>
    </div>
   ) : (
    <div style={{display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"60%", gap:12}}>
     <div style={{fontSize:28, opacity:0.2}}>📋</div>
     <div style={{fontSize:12, color:"#475569", textAlign:"center", lineHeight:1.9}}>
      왼쪽에서 분석 기록을 선택하면<br/>결과와 리포트를 다시 볼 수 있습니다
     </div>
    </div>
   )}
  </div>
 </div>
 );
}

// --- MAIN ---------------------------------------------------------------------
function NegotiationSimulator({ amendments = [] }) {
 const [mode, setMode] = useState('file'); // 'file' | 'text'
 const [inputText, setInputText] = useState('');
 const [ktGoals, setKtGoals] = useState('');
 const [fileContent, setFileContent] = useState(null);
 const [fileName, setFileName] = useState('');
 const [result, setResult] = useState(null);
 const [loading, setLoading] = useState(false);
 const [activeSection, setActiveSection] = useState(0);
 const fileRef = useRef(null);

 const handleFile = async (file) => {
 if (!file) return;
 setFileName(file.name);
 const ext = file.name.split('.').pop().toLowerCase();
 if (ext === 'pdf') {
 const b64 = await new Promise((res, rej) => {
 const r = new FileReader();
 r.onload = () => res(r.result.split(',')[1]);
 r.onerror = rej;
 r.readAsDataURL(file);
 });
 setFileContent({ type: 'pdf', b64 });
 } else {
 const text = await new Promise((res, rej) => {
 const r = new FileReader();
 r.onload = () => res(r.result);
 r.onerror = rej;
 r.readAsText(file, 'utf-8');
 });
 setFileContent({ type: 'text', text });
 }
 };

 const SYSTEM = () => {
 const kbSummary = CONTRACT_KB.clauses.slice(0, 30).map(c =>
 `${c.id}: ${c.topic} \u2014 ${c.core}`
 ).join('\n');
 const amdSummary = amendments.slice(0, 5).map(a =>
 `${a.fileName} (${a.docType}): ${a.summary}`
 ).join('\n');
 return `\ub2f9\uc2e0\uc740 KT(\ud55c\uad6d\ud1b5\uc2e0)\uc758 \uc218\uc11d \uacc4\uc57d \ud611\uc0c1 \uc790\ubb38\uc785\ub2c8\ub2e4.
KT\ub294 Palantir\uc640 \uc804\ub7b5\uc801 \ud30c\ud2b8\ub108\uc2ed \uacc4\uc57d(SAA)\uc744 \uccb4\uacb0\ud588\uc73c\uba70, \ud604\uc7ac Amendment \ud611\uc0c1 \uc911\uc785\ub2c8\ub2e4.

## \ud604\uc7ac \uacc4\uc57d KB \uc694\uc57d
${kbSummary}

## \uae30\uc874 Amendment \uc774\ub825
${amdSummary || '\uc5c6\uc74c'}

\ub2f9\uc2e0\uc758 \uc5ed\ud560:
- Palantir \uc81c\uc548\uc758 \uc870\ud56d\ubcc4 \uc758\ubbf8\uc640 KT \uc601\ud5a5\uc744 \ubd84\uc11d
- \uc870\ud56d \uac04 \ubc14\ud130(tradeoff) \uc804\ub7b5 \uc218\ub9bd
- KT \uc785\uc7a5\uc5d0\uc11c \ucd5c\uc801\uc758 \ud611\uc0c1 \ud328\ud0a4\uc9c0 \uad6c\uc131
- \uc2e4\uc804 \ud611\uc0c1 \ub300\ubcf8\uae4c\uc9c0 \uc81c\uc2dc`;
 };

 const buildPrompt = (docContent) => `
\ub2e4\uc74c\uc740 Palantir\uac00 \uc81c\uc2dc\ud55c \ud611\uc0c1 \ubb38\uc11c\uc785\ub2c8\ub2e4:

---
${docContent}
---

KT \ud611\uc0c1 \ubaa9\ud45c:
${ktGoals || '(\uba85\uc2dc \uc5c6\uc74c \u2014 KT \uc804\ubc18\uc801 \uc774\uc775 \uad00\uc810\uc5d0\uc11c \ubd84\uc11d)'}

\uc544\ub798 JSON \ud615\uc2dd\uc73c\ub85c\ub9cc \uc751\ub2f5. \ubc31\ud2f1 \uc5c6\uc774 \uc21c\uc218 JSON:
{
 "summary": "Palantir \uc81c\uc548\uc758 \ud575\uc2ec \uc758\ub3c4 1~2\ubb38\uc7a5 (\uc26c\uc6b4 \ud55c\uad6d\uc5b4)",
 "clauseAnalysis": [
 {
 "clauseId": "SAA-X.X \ub610\ub294 \uc2e0\uaddc",
 "title": "\uc870\ud56d \uc81c\ubaa9",
 "palantirProposal": "Palantir\uac00 \uc6d0\ud558\ub294 \uac83 (\ud55c\uad6d\uc5b4 1~2\ubb38\uc7a5, \uc27d\uac8c)",
 "ktRisk": "KT\uc5d0 \ubbf8\uce58\ub294 \uc2e4\uc9c8\uc801 \uc601\ud5a5 (\ud55c\uad6d\uc5b4, \uad6c\uccb4\uc801)",
 "riskLevel": "HIGH|MEDIUM|LOW",
 "ktPosition": "ACCEPT|MODIFY|REJECT"
 }
 ],
 "barterPackages": [
 {
 "packageName": "\ud328\ud0a4\uc9c0\uba85 (\uc608: '\uc870\uae30\uc885\ub8cc \uc644\ud654 + QRC \ub2e8\ucd95')",
 "ktGives": ["KT\uac00 \uc591\ubcf4\ud558\ub294 \uac83\ub4e4"],
 "ktGets": ["KT\uac00 \uc5bb\ub294 \uac83\ub4e4"],
 "rationale": "\uc774 \ubc14\ud130\uac00 \ud569\ub9ac\uc801\uc778 \uc774\uc720",
 "successProbability": "HIGH|MEDIUM|LOW"
 }
 ],
 "redLines": ["\uc808\ub300 \uc591\ubcf4 \ubd88\uac00 \uc870\uac74 (\uad6c\uccb4\uc801)"],
 "negotiationScript": {
 "opening": "\ud611\uc0c1 \uccab \ub9c8\ub514 (\ud55c\uad6d\uc5b4 \uc2e4\uc804 \ub300\ubcf8)",
 "keyArguments": ["\ud575\uc2ec \ub17c\uac70 3~4\uac1c"],
 "concessions": "\ucd5c\ud6c4 \uc218\ub2e8 \uc591\ubcf4 \uc804\ub7b5"
 },
 "recommendation": "\ucd5c\uc885 \uad8c\uace0\uc0ac\ud56d (\uc218\uc6a9/\uc218\uc815/\uac70\ubd80 + \uc774\uc720)"
}`;

 const analyze = async () => {
 setLoading(true);
 setResult(null);
 try {
 let msgContent;
 if (mode === 'file' && fileContent) {
 if (fileContent.type === 'pdf') {
 msgContent = [
 { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileContent.b64 } },
 { type: 'text', text: buildPrompt('[\uc704 \ucca8\ubd80 PDF \ubb38\uc11c\ub97c \ubd84\uc11d\ud558\uc2dc\uc624]') }
 ];
 } else {
 msgContent = buildPrompt(fileContent.text);
 }
 } else {
 msgContent = buildPrompt(inputText);
 }

 const resp = await fetch('/api/chat', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 
 max_tokens: 3000,
 system: SYSTEM(),
 messages: [{ role: 'user', content: msgContent }]
 })
 });
 const data = await resp.json();
 const raw = data.content.map(b => b.text || '').join('');
 const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
 const parsed = JSON.parse(raw.slice(s, e + 1));
 setResult(parsed);
 setActiveSection(0);
 } catch(err) {
 setResult({ error: err.message });
 }
 setLoading(false);
 };

 const canAnalyze = !loading && (
 (mode === 'file' && fileContent) ||
 (mode === 'text' && inputText.trim().length > 20)
 );

 const riskColor = { HIGH:'#ff4444', MEDIUM:'#f59e0b', LOW:'#10b981' };
 const posColor = { ACCEPT:'#10b981', MODIFY:'#f59e0b', REJECT:'#ff4444' };
 const posLabel = { ACCEPT:'\u2713 \uc218\uc6a9', MODIFY:'~ \uc218\uc815', REJECT:'\u2717 \uac70\ubd80' };
 const probColor = { HIGH:'#10b981', MEDIUM:'#f59e0b', LOW:'#ff4444' };

 const sections = result && !result.error ? [
 '\ud83d\udccb \uc870\ud56d\ubcc4 \ubd84\uc11d',
 '\ud83d\udd04 \ubc14\ud130 \uc804\ub7b5',
 '\ud83d\udeab Red Lines',
 '\ud83c\udfa4 \ud611\uc0c1 \ub300\ubcf8',
 ] : [];

 return (
 <div style={{height:'100%', display:'flex', flexDirection:'column', overflow:'hidden', background:'#07070f'}}>

 {/* \ud5e4\ub354 */}
 <div style={{padding:'10px 20px', borderBottom:'1px solid #1a1a2e',
 background:'#0a0a14', flexShrink:0}}>
 <div style={{fontSize:13, fontWeight:700, color:'#8899bb'}}>\ud83e\udd1d \ud611\uc0c1 \uc2dc\ubbac\ub808\uc774\ud130</div>
 <div style={{fontSize:11, color:'#475569', marginTop:2}}>
 Palantir Amendment \uc81c\uc548\uc11c\ub97c \uc5c5\ub85c\ub4dc\ud558\uac70\ub098 \ubd99\uc5ec\ub123\uc73c\uba74 \u2014 \uc870\ud56d\ubcc4 \ubd84\uc11d, \ubc14\ud130 \uc804\ub7b5, \ud611\uc0c1 \ub300\ubcf8\uc744 \uc81c\uc2dc\ud569\ub2c8\ub2e4
 </div>
 </div>

 <div style={{flex:1, display:'grid', gridTemplateColumns:'360px 1fr', overflow:'hidden'}}>

 {/* \uc67c\ucabd: \uc785\ub825 */}
 <div style={{borderRight:'1px solid #1a1a2e', display:'flex', flexDirection:'column',
 overflow:'hidden', background:'#0a0a14'}}>
 <div style={{flex:1, overflowY:'auto', padding:16, display:'flex', flexDirection:'column', gap:12}}>

 {/* \uc785\ub825 \ubc29\uc2dd \uc120\ud0dd */}
 <div style={{display:'flex', gap:4}}>
 {[['file','\ud83d\udcce \ud30c\uc77c \uc5c5\ub85c\ub4dc'],['text','\u270f\ufe0f \ud14d\uc2a4\ud2b8 \uc785\ub825']].map(([m,label]) => (
 <button key={m} onClick={() => setMode(m)}
 style={{flex:1, padding:'6px 0', borderRadius:4,
 cursor:'pointer', fontSize:10, fontWeight:600, fontFamily:'inherit',
 background: mode===m ? '#1e3a6e' : '#0f0f1a',
 color: mode===m ? '#60a5fa' : '#475569',
 border: '1px solid ' + (mode===m ? '#60a5fa44' : '#1e2030')}}>
 {label}
 </button>
 ))}
 </div>

 {/* \ud30c\uc77c \uc5c5\ub85c\ub4dc */}
 {mode === 'file' && (
 <div>
 <input ref={fileRef} type='file' accept='.pdf,.txt,.docx'
 style={{display:'none'}}
 onChange={e => handleFile(e.target.files[0])}/>
 <div onClick={() => fileRef.current?.click()}
 style={{padding:'20px', border:'1px dashed #334155', borderRadius:6,
 textAlign:'center', cursor:'pointer', background:'#0f0f1a',
 transition:'border-color 0.2s'}}
 onMouseEnter={e => e.currentTarget.style.borderColor='#60a5fa'}
 onMouseLeave={e => e.currentTarget.style.borderColor='#334155'}>
 {fileContent ? (
 <div>
 <div style={{fontSize:18, marginBottom:4}}>\ud83d\udcc4</div>
 <div style={{fontSize:10, color:'#60a5fa', fontWeight:600}}>{fileName}</div>
 <div style={{fontSize:11, color:'#475569', marginTop:2}}>\ud074\ub9ad\ud558\uc5ec \ubcc0\uacbd</div>
 </div>
 ) : (
 <div>
 <div style={{fontSize:20, marginBottom:6, opacity:0.4}}>\ud83d\udcce</div>
 <div style={{fontSize:10, color:'#475569'}}>
 Amendment \uc81c\uc548\uc11c \uc5c5\ub85c\ub4dc<br/>
 <span style={{fontSize:11, color:'#334155'}}>PDF \u00b7 TXT \uc9c0\uc6d0</span>
 </div>
 </div>
 )}
 </div>
 </div>
 )}

 {/* \ud14d\uc2a4\ud2b8 \uc785\ub825 */}
 {mode === 'text' && (
 <div style={{display:'flex', flexDirection:'column', gap:4}}>
 <div style={{fontSize:10, color:'#6677aa', fontWeight:700}}>
 Palantir \uc81c\uc548 \ub0b4\uc6a9
 </div>
 <div style={{fontSize:11, color:'#334155', lineHeight:1.6, padding:'6px 8px',
 background:'#0f0f1a', borderRadius:4, border:'1px solid #1a1a2e'}}>
 \ud83d\udca1 <strong style={{color:'#475569'}}>\uc608\uc2dc:</strong> \uc774\uba54\uc77c/\ubb38\uc11c\uc5d0\uc11c \ubc1b\uc740 Palantir \uc694\uad6c\uc0ac\ud56d\uc744 \uadf8\ub300\ub85c \ubd99\uc5ec\ub123\uc73c\uc138\uc694.<br/>
 "Section 6.3\uc744 \uc218\uc815\ud558\uc5ec Surviving QRC\ub97c 5\ub144\uc73c\ub85c \uc5f0\uc7a5\ud558\uace0, \u00a78.2 \ubc30\uc0c1 \ud55c\ub3c4\ub97c $200K\ub85c \ub0ae\ucd94\uae38 \uc6d0\ud569\ub2c8\ub2e4."
 </div>
 <textarea value={inputText} onChange={e => setInputText(e.target.value)}
 placeholder={'Palantir \uc774\uba54\uc77c, \uc870\ud56d \uc218\uc815 \uc694\uccad, \ud611\uc0c1 \uba54\ubaa8 \ub4f1\uc744 \ubd99\uc5ec\ub123\uc73c\uc138\uc694...\n\n\uc870\ud56d \ubc88\ud638\ub098 \uc815\ud655\ud55c \ubb38\uad6c\ub97c \ubab0\ub77c\ub3c4 \ub429\ub2c8\ub2e4.\n"\uacc4\uc57d \uae30\uac04\uc744 \uc5f0\uc7a5\ud558\uace0 \uc2f6\ub2e4", "\uc774 \uc870\ud56d\uc744 \uc0ad\uc81c\ud558\uc790" \uac19\uc740 \ub0b4\uc6a9\ub3c4 OK.'}
 style={{height:160, width:'100%', background:'#0f0f1a', border:'1px solid #1e2030',
 borderRadius:4, color:'#c8d0dc', padding:'8px 10px', fontSize:10,
 fontFamily:'inherit', resize:'none', lineHeight:1.6,
 boxSizing:'border-box'}}/>
 </div>
 )}

 {/* KT \ud611\uc0c1 \ubaa9\ud45c */}
 <div>
 <div style={{fontSize:10, color:'#6677aa', fontWeight:700, marginBottom:4}}>
 \ud83c\udfaf KT \ud611\uc0c1 \ubaa9\ud45c <span style={{color:'#334155', fontWeight:400}}>(\uc120\ud0dd)</span>
 </div>
 <div style={{fontSize:11, color:'#334155', marginBottom:5, lineHeight:1.6}}>
 \uc6b0\ub9ac\uac00 \uaf2d \uc5bb\uace0 \uc2f6\uc740 \uac83, \ub610\ub294 \ub9c9\uc544\uc57c \ud558\ub294 \uac83\uc744 \uc790\uc720\ub86d\uac8c \uc801\uc73c\uc138\uc694
 </div>
 <textarea value={ktGoals} onChange={e => setKtGoals(e.target.value)}
 placeholder={'\uc608:\n- Surviving QRC \uacc4\uc0b0 \uae30\uac04 3\ub144\u21921\ub144 \ub2e8\ucd95\n- \u00a78.2 KT \ubc30\uc0c1 \ud55c\ub3c4 \ud604\uc7ac \uc720\uc9c0\n- \uc870\uae30\uc885\ub8cc \uc870\uac74 \uc644\ud654'}
 style={{width:'100%', height:80, background:'#0f0f1a', border:'1px solid #1e2030',
 borderRadius:4, color:'#c8d0dc', padding:'7px 9px', fontSize:10,
 fontFamily:'inherit', resize:'none', lineHeight:1.6,
 boxSizing:'border-box'}}/>
 </div>

 <button onClick={analyze} disabled={!canAnalyze}
 style={{padding:'10px', borderRadius:5, border:'none',
 cursor: canAnalyze ? 'pointer' : 'default',
 fontFamily:'inherit', fontSize:11, fontWeight:700,
 background: canAnalyze ? '#1e3a6e' : '#1e2030',
 color: canAnalyze ? '#60a5fa' : '#334155',
 transition:'all 0.2s'}}>
 {loading ? '\u2699 \ubd84\uc11d \uc911...' : '\ud83d\udd0d \ud611\uc0c1 \uc804\ub7b5 \ubd84\uc11d'}
 </button>

 {/* \ubd84\uc11d \uacb0\uacfc \uc694\uc57d (\uc67c\ucabd \ud558\ub2e8) */}
 {result && !result.error && !loading && (
 <div style={{padding:'10px 12px', background:'#0f1e35',
 borderRadius:6, border:'1px solid #1e3a6e'}}>
 <div style={{fontSize:11, color:'#60a5fa', fontWeight:700, marginBottom:6}}>
 \ubd84\uc11d \uc644\ub8cc
 </div>
 <div style={{fontSize:10, color:'#c8d0dc', lineHeight:1.6}}>
 {result.summary}
 </div>
 <div style={{marginTop:8, fontSize:11, color:'#6677aa'}}>
 \ucd5c\uc885 \uad8c\uace0: <span style={{color:'#e2e8f0', fontWeight:600}}>{result.recommendation}</span>
 </div>
 </div>
 )}
 </div>
 </div>

 {/* \uc624\ub978\ucabd: \uacb0\uacfc */}
 <div style={{display:'flex', flexDirection:'column', overflow:'hidden'}}>

 {loading && (
 <div style={{flex:1, display:'flex', alignItems:'center', justifyContent:'center',
 flexDirection:'column', gap:12}}>
 <div style={{fontSize:28}}>\u2699\ufe0f</div>
 <div style={{fontSize:11, color:'#475569'}}>\ud611\uc0c1 \uc804\ub7b5 \ubd84\uc11d \uc911...</div>
 <div style={{fontSize:11, color:'#334155'}}>\uc870\ud56d \ubd84\uc11d \u2192 \ubc14\ud130 \ud328\ud0a4\uc9c0 \uad6c\uc131 \u2192 \ud611\uc0c1 \ub300\ubcf8 \uc791\uc131</div>
 </div>
 )}

 {!loading && !result && (
 <div style={{flex:1, display:'flex', alignItems:'center', justifyContent:'center',
 flexDirection:'column', gap:10, color:'#1e2d3d'}}>
 <div style={{fontSize:36}}>\ud83e\udd1d</div>
 <div style={{fontSize:12, color:'#334155'}}>Palantir \uc81c\uc548\uc744 \uc785\ub825\ud558\uba74</div>
 <div style={{display:'flex', flexDirection:'column', gap:6, marginTop:4}}>
 {['\ud83d\udccb \uac01 \uc870\ud56d\uc774 KT\uc5d0 \ubbf8\uce58\ub294 \uc601\ud5a5 \ubd84\uc11d',
 '\ud83d\udd04 \ubc14\ud130 \ud328\ud0a4\uc9c0 \uad6c\uc131 (A \uc591\ubcf4 \u2192 B \ud68d\ub4dd)',
 '\ud83d\udeab \uc808\ub300 \uc591\ubcf4 \ubd88\uac00 Red Lines \uc815\ub9ac',
 '\ud83c\udfa4 \uc2e4\uc804 \ud611\uc0c1 \ub300\ubcf8 \uc81c\uc2dc'].map(t => (
 <div key={t} style={{fontSize:10, color:'#334155', display:'flex', alignItems:'center', gap:6}}>
 <span style={{color:'#1e3a6e'}}>\u25b8</span>{t}
 </div>
 ))}
 </div>
 </div>
 )}

 {!loading && result && !result.error && (
 <>
 {/* \uc139\uc158 \ud0ed */}
 <div style={{display:'flex', gap:1, padding:'8px 16px',
 borderBottom:'1px solid #1a1a2e', background:'#0a0a14', flexShrink:0}}>
 {sections.map((s, i) => (
 <button key={i} onClick={() => setActiveSection(i)}
 style={{padding:'4px 12px', borderRadius:3, border:'none',
 cursor:'pointer', fontSize:10, fontWeight:600, fontFamily:'inherit',
 background: activeSection===i ? '#1e3a6e' : 'transparent',
 color: activeSection===i ? '#60a5fa' : '#475569'}}>
 {s}
 </button>
 ))}
 </div>

 <div style={{flex:1, overflowY:'auto', padding:16}}>

 {/* \uc870\ud56d\ubcc4 \ubd84\uc11d */}
 {activeSection === 0 && (
 <div style={{display:'flex', flexDirection:'column', gap:8}}>
 {(result.clauseAnalysis || []).map((c, i) => {
 const rc = riskColor[c.riskLevel] || '#8899aa';
 const pc = posColor[c.ktPosition] || '#8899aa';
 return (
 <div key={i} style={{borderRadius:6, overflow:'hidden',
 border:'1px solid ' + rc + '33', background:'#0a0a14'}}>
 <div style={{padding:'8px 12px', background: rc + '0d',
 display:'flex', alignItems:'center', gap:8}}>
 <span style={{fontSize:11, fontWeight:700, color:rc,
 background:rc+'22', padding:'2px 7px', borderRadius:3}}>
 {c.riskLevel}
 </span>
 <span style={{fontSize:10, fontWeight:700, color:'#e2e8f0'}}>
 {c.clauseId}
 </span>
 <span style={{fontSize:10, color:'#8899aa'}}>{c.title}</span>
 <span style={{marginLeft:'auto', fontSize:11, fontWeight:700,
 color:pc, background:pc+'18', padding:'2px 7px', borderRadius:3}}>
 {posLabel[c.ktPosition]}
 </span>
 </div>
 <div style={{padding:'10px 12px', display:'grid',
 gridTemplateColumns:'1fr 1fr', gap:10}}>
 <div>
 <div style={{fontSize:10, color:'#a78bfa', fontWeight:700,
 marginBottom:4}}>Palantir\uac00 \uc6d0\ud558\ub294 \uac83</div>
 <div style={{fontSize:10, color:'#9aaabb', lineHeight:1.6}}>
 {c.palantirProposal}
 </div>
 </div>
 <div>
 <div style={{fontSize:10, color:rc, fontWeight:700,
 marginBottom:4}}>KT \uc601\ud5a5</div>
 <div style={{fontSize:10, color:'#9aaabb', lineHeight:1.6}}>
 {c.ktRisk}
 </div>
 </div>
 </div>
 </div>
 );
 })}
 </div>
 )}

 {/* \ubc14\ud130 \uc804\ub7b5 */}
 {activeSection === 1 && (
 <div style={{display:'flex', flexDirection:'column', gap:10}}>
 {(result.barterPackages || []).map((pkg, i) => {
 const pc = probColor[pkg.successProbability] || '#8899aa';
 return (
 <div key={i} style={{borderRadius:8, overflow:'hidden',
 border:'1px solid #1e3a6e', background:'#0a0a14'}}>
 <div style={{padding:'10px 14px', background:'#0f1e35',
 display:'flex', alignItems:'center', gap:8}}>
 <span style={{fontSize:11, fontWeight:700, color:'#60a5fa'}}>
 \ud328\ud0a4\uc9c0 {i+1}
 </span>
 <span style={{fontSize:10, color:'#c8d0dc', fontWeight:600}}>
 {pkg.packageName}
 </span>
 <span style={{marginLeft:'auto', fontSize:11, color:pc,
 background:pc+'18', padding:'2px 7px', borderRadius:3, fontWeight:700}}>
 \uc131\uacf5\ud655\ub960 {pkg.successProbability}
 </span>
 </div>
 <div style={{padding:'12px 14px', display:'grid',
 gridTemplateColumns:'1fr 1fr', gap:12}}>
 <div style={{padding:'8px 10px', background:'#1a0a0a',
 borderRadius:5, border:'1px solid #ff444422'}}>
 <div style={{fontSize:10, color:'#ff6b6b', fontWeight:700,
 marginBottom:6}}>KT\uac00 \uc591\ubcf4\ud558\ub294 \uac83</div>
 {pkg.ktGives.map((g, j) => (
 <div key={j} style={{fontSize:11, color:'#cc8888',
 marginBottom:4, paddingLeft:8,
 borderLeft:'2px solid #ff444433', lineHeight:1.5}}>
 {g}
 </div>
 ))}
 </div>
 <div style={{padding:'8px 10px', background:'#0a1a0a',
 borderRadius:5, border:'1px solid #10b98122'}}>
 <div style={{fontSize:10, color:'#10b981', fontWeight:700,
 marginBottom:6}}>KT\uac00 \uc5bb\ub294 \uac83</div>
 {pkg.ktGets.map((g, j) => (
 <div key={j} style={{fontSize:11, color:'#88bb99',
 marginBottom:4, paddingLeft:8,
 borderLeft:'2px solid #10b98133', lineHeight:1.5}}>
 {g}
 </div>
 ))}
 </div>
 </div>
 <div style={{padding:'8px 14px', borderTop:'1px solid #1e2030',
 fontSize:11, color:'#6677aa', lineHeight:1.5}}>
 \ud83d\udca1 {pkg.rationale}
 </div>
 </div>
 );
 })}
 </div>
 )}

 {/* Red Lines */}
 {activeSection === 2 && (
 <div style={{display:'flex', flexDirection:'column', gap:8}}>
 <div style={{fontSize:10, color:'#8899aa', lineHeight:1.7, marginBottom:4}}>
 \uc544\ub798 \uc870\uac74\uc740 \uc5b4\ub5a4 \ubc14\ud130 \ud328\ud0a4\uc9c0\uc5d0\uc11c\ub3c4 \uc591\ubcf4\ud574\uc120 \uc548 \ub429\ub2c8\ub2e4.
 </div>
 {(result.redLines || []).map((r, i) => (
 <div key={i} style={{padding:'10px 14px', borderRadius:6,
 background:'#1a0808', border:'1px solid #ff444433',
 display:'flex', gap:10, alignItems:'flex-start'}}>
 <span style={{color:'#ff4444', fontSize:14, flexShrink:0}}>\ud83d\udeab</span>
 <span style={{fontSize:10, color:'#cc8888', lineHeight:1.6}}>{r}</span>
 </div>
 ))}
 </div>
 )}

 {/* \ud611\uc0c1 \ub300\ubcf8 */}
 {activeSection === 3 && (
 <div style={{display:'flex', flexDirection:'column', gap:12}}>
 <div style={{padding:'12px 14px', borderRadius:6,
 background:'#0f1e35', border:'1px solid #1e3a6e'}}>
 <div style={{fontSize:11, color:'#60a5fa', fontWeight:700, marginBottom:6}}>
 \ud83c\udfa4 \uc624\ud504\ub2dd \uba58\ud2b8
 </div>
 <div style={{fontSize:11, color:'#c8d0dc', lineHeight:1.8,
 fontStyle:'italic', padding:'8px 12px', background:'#0a0a14',
 borderRadius:4, borderLeft:'3px solid #60a5fa'}}>
 "{result.negotiationScript?.opening}"
 </div>
 </div>
 <div style={{padding:'12px 14px', borderRadius:6,
 background:'#0a1a0a', border:'1px solid #10b98133'}}>
 <div style={{fontSize:11, color:'#10b981', fontWeight:700, marginBottom:8}}>
 \ud83d\udcaa \ud575\uc2ec \ub17c\uac70
 </div>
 {(result.negotiationScript?.keyArguments || []).map((arg, i) => (
 <div key={i} style={{padding:'7px 10px', marginBottom:6,
 background:'#0a0a14', borderRadius:4,
 borderLeft:'2px solid #10b98144', fontSize:10,
 color:'#9aaabb', lineHeight:1.6}}>
 <span style={{color:'#10b981', fontWeight:700, marginRight:8}}>
 {i+1}.
 </span>
 {arg}
 </div>
 ))}
 </div>
 <div style={{padding:'12px 14px', borderRadius:6,
 background:'#1a1a08', border:'1px solid #f59e0b33'}}>
 <div style={{fontSize:11, color:'#f59e0b', fontWeight:700, marginBottom:6}}>
 \ud83e\udd1d \ucd5c\ud6c4 \uc591\ubcf4 \uc804\ub7b5
 </div>
 <div style={{fontSize:10, color:'#bbaa77', lineHeight:1.6}}>
 {result.negotiationScript?.concessions}
 </div>
 </div>
 </div>
 )}

 </div>
 </>
 )}

 {!loading && result?.error && (
 <div style={{padding:20, color:'#ff6b6b', fontSize:10}}>
 \uc624\ub958: {result.error}
 </div>
 )}
 </div>
 </div>
 </div>
 );
}
