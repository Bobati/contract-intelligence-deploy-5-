import { useState, useEffect, useRef } from "react";

// ── localStorage 헬퍼 (동기) ─────────────────────────────────────────────────
const lsGet = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const lsSet = (key, v) => { try { localStorage.setItem(key, v); } catch {} };
const lsDel = (key) => { try { localStorage.removeItem(key); } catch {} };

export default function IssueAnalyzer() {
  const [appTab, setAppTab]           = useState("docs");   // "docs" | "analyze"
  const [mode, setMode]               = useState("basic");
  const [input, setInput]             = useState("");
  const [history, setHistory]         = useState([]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState(null);
  const [activeHistory, setActiveHistory] = useState(null);
  const [amendments, setAmendments]   = useState([]);
  const [kbSummary, setKbSummary]     = useState({ clauses: CONTRACT_KB.clauses.length, conflicts: CONTRACT_KB.conflicts.length });

  useEffect(()=>{
    (async()=>{
      try {
        await loadAndApplyStoredPatches();
        await loadDynamicKB();
        setKbSummary({ clauses: CONTRACT_KB.clauses.length, conflicts: CONTRACT_KB.conflicts.length });
        const s = lsGet("issue_history");
        if (s) setHistory(JSON.parse(s));
      } catch(e){}
    })();
  },[]);

  const handleAmendmentsChange = (list) => { setAmendments(list); };
  const handleKBUpdated = ({ clauses, conflicts }) => {
    setKbSummary({ clauses: clauses.length, conflicts: conflicts.length });
  };

  const saveHistory = async (h) => {
    try { lsSet("issue_history", JSON.stringify(h.slice(-50))); } catch(e){}
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
    try { lsDel("issue_history"); } catch(e){}
  };

  const analyze = async () => {
    if (!input.trim()||loading) return;
    const query = input.trim();
    setInput(""); setLoading(true); setError(null); setActiveHistory(null);
    try {
      const res = await fetch("/api/chat",{
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          model:"claude-sonnet-4-6", max_tokens:2000,
          system:buildSystemPrompt(mode, amendments),
          messages:[{role:"user",content:query}]
        })
      });
      if (!res.ok) { const t=await res.text(); throw new Error("API "+res.status+": "+t.slice(0,100)); }
      const data = await res.json();
      if (data.error) throw new Error(data.error.message||JSON.stringify(data.error));
      const text = data.content?.map(b=>b.text||"").join("").trim();
      if (!text) throw new Error("빈 응답");

      const getField = (tag) => { const m=text.match(new RegExp("##"+tag+"##\\s*([^\\n#][^\\n]*)","i")); return m?m[1].trim():""; };
      const getClauses = () => text.split("\n").filter(l=>l.trim().startsWith("##CLAUSE##")).map(line=>{
        const raw=line.replace(/^##CLAUSE##\s*/,""); const obj={};
        raw.split("|").forEach(p=>{const eq=p.indexOf("=");if(eq>-1)obj[p.slice(0,eq).trim()]=p.slice(eq+1).trim();});
        return {clause_id:obj.clause_id||"",doc:obj.doc||"",topic:obj.topic||"",relevance:obj.relevance||"",kt_position:obj.kt_position||"",urgency:obj.urgency||"단기"};
      }).filter(c=>c.clause_id);
      const getActions = () => text.split("\n").filter(l=>l.trim().startsWith("##ACTION##")).map(line=>{
        const raw=line.replace(/^##ACTION##\s*/,""); const obj={};
        raw.split("|").forEach(p=>{const eq=p.indexOf("=");if(eq>-1)obj[p.slice(0,eq).trim()]=p.slice(eq+1).trim();});
        return {step:obj.step||"",timeframe:obj.timeframe||"",action:obj.action||"",clauses:obj.clauses||""};
      }).filter(a=>a.action);
      const conflictsRaw = getField("CONFLICTS");
      const riskRaw = getField("RISK").toUpperCase();
      const result = {
        situation_summary: getField("SUMMARY")||query,
        risk_level: ["HIGH","MEDIUM","LOW"].includes(riskRaw)?riskRaw:"MEDIUM",
        risk_reason: getField("RISK_REASON")||"-",
        legal_analysis: getField("LEGAL")||"-",
        kt_defense: getField("KT_DEFENSE")||"-",
        palantir_position: getField("PALANTIR")||"-",
        bottom_line: getField("BOTTOM_LINE")||"-",
        related_conflicts: conflictsRaw&&conflictsRaw!=="없음"?conflictsRaw.split(",").map(s=>s.trim()).filter(Boolean):[],
        triggered_clauses: getClauses(),
        immediate_actions: getActions()
      };
      const entry={id:Date.now(),query,result,mode,ts:new Date().toLocaleString("ko-KR")};
      const nh=[entry,...history];
      setHistory(nh); setActiveHistory(entry.id); await saveHistory(nh);
    } catch(e) {
      setError("오류: "+e.message);
    } finally { setLoading(false); }
  };

  const current = history.find(h=>h.id===activeHistory);

  return (
    <div style={{fontFamily:"'IBM Plex Mono',monospace",background:"#07070f",height:"100vh",display:"flex",flexDirection:"column",color:"#e2e8f0",overflow:"hidden"}}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&display=swap" rel="stylesheet"/>

      {/* ── 헤더 ── */}
      <div style={{background:"#0a0a14",borderBottom:"1px solid #1a1a2e",padding:"0 20px",display:"flex",alignItems:"center",gap:16,height:48,flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:"#60a5fa",boxShadow:"0 0 8px #60a5fa"}}/>
          <span style={{fontSize:12,fontWeight:600,letterSpacing:"0.1em",color:"#c8d0dc"}}>{"CONTRACT INTELLIGENCE"}</span>
          <span style={{fontSize:10,color:"#6677aa"}}>{"KT × Palantir Korea"}</span>
        </div>

        {/* 상단 탭 */}
        <div style={{display:"flex",gap:1,background:"#0f0f1a",borderRadius:5,padding:3,border:"1px solid #1e2030",marginLeft:8}}>
          {[["docs","📂 문서 관리"],["analyze","🔍 이슈 분석"],["hurdle","📊 Hurdle"],["timeline","📜 변경 이력"],["history","📋 히스토리"]].map(([tab,label])=>(
            <button key={tab} onClick={()=>setAppTab(tab)}
              style={{padding:"4px 14px",borderRadius:3,border:"none",cursor:"pointer",fontSize:10,fontWeight:600,fontFamily:"inherit",transition:"all 0.12s",
                background:appTab===tab?"#1e3a6e":"transparent",
                color:appTab===tab?"#60a5fa":"#8899aa",
                position:"relative"}}>
              {label}
              {tab==="history" && history.length>0 && (
                <span style={{position:"absolute",top:0,right:2,fontSize:7,background:"#60a5fa",
                  color:"#07070f",borderRadius:"50%",width:12,height:12,
                  display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>
                  {history.length > 9 ? "9+" : history.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* KB 상태 배지 */}
        <div style={{display:"flex",gap:8,marginLeft:"auto",alignItems:"center"}}>
          <span style={{fontSize:9,color:"#475569"}}>KB</span>
          <span style={{fontSize:10,color:"#60a5fa",background:"#60a5fa12",padding:"2px 8px",borderRadius:3,border:"1px solid #60a5fa22"}}>
            조항 {kbSummary.clauses}
          </span>
          <span style={{fontSize:10,color:kbSummary.conflicts>0?"#ff2d20":"#10b981",
            background:kbSummary.conflicts>0?"#ff2d2012":"#10b98112",
            padding:"2px 8px",borderRadius:3,border:`1px solid ${kbSummary.conflicts>0?"#ff2d2022":"#10b98122"}`}}>
            충돌 {kbSummary.conflicts}
          </span>
          {appTab==="analyze" && <>
            <div style={{width:1,height:20,background:"#1e2030",margin:"0 4px"}}/>
            <div style={{display:"flex",background:"#0f0f1a",borderRadius:4,padding:2,border:"1px solid #1e2030"}}>
              {[["basic","기본"],["extended","확장"]].map(([m,label])=>(
                <button key={m} onClick={()=>setMode(m)} style={{padding:"3px 10px",borderRadius:2,border:"none",cursor:"pointer",fontSize:9,fontWeight:600,
                  background:mode===m?(m==="extended"?"#1a1040":"#0f1e35"):"transparent",
                  color:mode===m?(m==="extended"?"#a78bfa":"#60a5fa"):"#8899aa",fontFamily:"inherit"}}>{label}</button>
              ))}
            </div>

          </>}
        </div>
      </div>

      {/* ── 탭 콘텐츠 ── */}
      <div style={{flex:1,overflow:"hidden"}}>

        {/* 문서 관리 탭 */}
        {appTab==="docs" && (
          <DocumentManagerTab
            onKBUpdated={handleKBUpdated}
            onAmendmentsFromUpload={(list) => {
              // 문서관리 탭에서 AMD 업로드 시 amendments state 갱신
              const merged = [...list, ...amendments.filter(a => !list.find(l=>l.id===a.id))];
              setAmendments(merged);
            }}
          />
        )}

        {/* 변경 이력 탭 */}
        {appTab==="timeline" && (
          <ClauseTimelineTab/>
        )}

        {/* 허들 트래커 탭 */}
        {appTab==="hurdle" && (
          <HurdleTracker/>
        )}

        {/* 히스토리 탭 */}
        {appTab==="history" && (
          <HistoryTab
            history={history}
            onSelect={h=>{ setActiveHistory(h.id); setAppTab("analyze"); }}
            onDelete={deleteHistory}
            onUpdateMemo={updateMemo}
            onClear={clearHistory}
          />
        )}

        {/* 이슈 분석 탭 */}
        {appTab==="analyze" && (
          <div style={{display:"grid",gridTemplateColumns:"280px 1fr",height:"100%"}}>
            {/* 왼쪽 */}
            <div style={{background:"#0a0a14",borderRight:"1px solid #1a1a2e",display:"flex",flexDirection:"column",overflow:"hidden"}}>
              <div style={{padding:14,borderBottom:"1px solid #1a1a2e"}}>
                <textarea value={input} onChange={e=>setInput(e.target.value)}
                  onKeyDown={e=>(e.metaKey||e.ctrlKey)&&e.key==="Enter"&&analyze()}
                  placeholder={"계약 관련 상황을 자유롭게 입력하세요.\n\n예) Palantir이 우리 고객에게 직접 접근했다\n    서비스가 갑자기 정지됐다"}
                  style={{width:"100%",background:"#0f0f1a",border:"1px solid #1e2030",borderRadius:6,padding:"9px 11px",
                    fontSize:11,color:"#e2e8f0",fontFamily:"inherit",resize:"none",height:120,outline:"none",lineHeight:1.7,boxSizing:"border-box"}}/>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:7}}>
                  <span style={{fontSize:9,color:"#1e2d3d"}}>⌘+Enter</span>
                  <button onClick={analyze} disabled={!input.trim()||loading}
                    style={{padding:"6px 14px",background:input.trim()&&!loading?"#1e3a6e":"#0f1525",
                      border:`1px solid ${input.trim()&&!loading?"#60a5fa44":"#1e2030"}`,borderRadius:4,fontSize:11,fontWeight:600,
                      color:input.trim()&&!loading?"#60a5fa":"#6677aa",cursor:input.trim()&&!loading?"pointer":"not-allowed",fontFamily:"inherit"}}>
                    {"분석"}
                  </button>
                </div>
              </div>
              <div style={{padding:"8px 14px",borderBottom:"1px solid #1a1a2e"}}>
                <AmendmentManager onAmendmentsChange={handleAmendmentsChange}/>
              </div>
              <div style={{padding:"8px 14px",borderBottom:"1px solid #1a1a2e"}}>
                <div style={{fontSize:10,color:"#1e2d3d",marginBottom:6}}>샘플 이슈</div>
                {SAMPLE_ISSUES.map((s,i)=>(
                  <button key={i} onClick={()=>setInput(s)}
                    style={{textAlign:"left",background:"none",border:"1px solid #1a1a2a",borderRadius:4,padding:"5px 7px",
                      fontSize:10,color:"#8899aa",cursor:"pointer",fontFamily:"inherit",lineHeight:1.4,width:"100%",marginBottom:3}}
                    onMouseEnter={e=>{e.currentTarget.style.borderColor="#2a3a5a";e.currentTarget.style.color="#c8d0dc";}}
                    onMouseLeave={e=>{e.currentTarget.style.borderColor="#1a1a2a";e.currentTarget.style.color="#8899aa";}}>
                    {s.length>40?s.slice(0,40)+"…":s}
                  </button>
                ))}
              </div>
              <div style={{flex:1,overflowY:"auto",padding:"8px 14px"}}>
                {history.length>0 && <>
                  <div style={{fontSize:10,color:"#1e2d3d",marginBottom:6}}>기록 ({history.length})</div>
                  {history.map(h=>{
                    const rc=RISK_COLOR[h.result?.risk_level]||"#8899aa";
                    return (
                      <div key={h.id} onClick={()=>setActiveHistory(h.id===activeHistory?null:h.id)}
                        style={{padding:"7px 9px",borderRadius:5,border:`1px solid ${activeHistory===h.id?rc+"44":"#1a1a2a"}`,
                          background:activeHistory===h.id?rc+"08":"transparent",cursor:"pointer",marginBottom:4}}>
                        <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:2}}>
                          <div style={{width:5,height:5,borderRadius:"50%",background:rc}}/>
                          <span style={{fontSize:9,color:rc,fontWeight:600}}>{h.result?.risk_level}</span>
                          {h.memo && <span style={{fontSize:8,color:"#a78bfa"}}>●</span>}
                          <span style={{fontSize:9,color:"#1e2d3d",marginLeft:"auto"}}>{h.ts}</span>
                        </div>
                        <div style={{fontSize:10,color:"#8899aa",lineHeight:1.4}}>{h.query.length>38?h.query.slice(0,38)+"…":h.query}</div>
                      </div>
                    );
                  })}
                </>}
              </div>
            </div>

            {/* 오른쪽 */}
            <div style={{overflowY:"auto",padding:20}}>
              {loading && <div style={{background:"#0d0d1a",border:"1px solid #1e2035",borderRadius:10,padding:16,marginBottom:16}}><TypingDots/></div>}
              {error && <div style={{background:"#1a0808",border:"1px solid #ff2d2044",borderRadius:8,padding:12,marginBottom:16,fontSize:11,color:"#ff2d20"}}>{error}</div>}
              {current && !loading && (
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                    <span style={{fontSize:10,color:"#6677aa"}}>입력 이슈</span>
                    <span style={{fontSize:11,color:"#9aaabb",background:"#0f0f1a",border:"1px solid #1e2030",borderRadius:4,padding:"3px 9px",flex:1}}>{current.query}</span>
                    <span style={{fontSize:9,color:current.mode==="extended"?"#a78bfa":"#60a5fa",background:current.mode==="extended"?"#1a1040":"#0f1e35",padding:"2px 6px",borderRadius:3}}>{current.mode==="extended"?"확장":"기본"}</span>
                  </div>
                  <AnalysisResult result={current.result} query={current.query} mode={current.mode} amendments={amendments}/>
                </div>
              )}
              {!current && !loading && (
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"60%",gap:10}}>
                  <div style={{width:40,height:40,borderRadius:"50%",border:"1px solid #1e2030",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <div style={{width:12,height:12,borderRadius:"50%",background:"#1e2030"}}/>
                  </div>
                  <div style={{fontSize:12,color:"#6677aa",textAlign:"center",lineHeight:2}}>
                    상황을 입력하면 관련 조항, 법적 효과, 즉각 조치를 분석합니다<br/>
                    <span style={{fontSize:10,color:"#475569"}}>KB 조항 {kbSummary.clauses}개 · 충돌 {kbSummary.conflicts}건 로드됨</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <style>{`@keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}} *{box-sizing:border-box} ::-webkit-scrollbar{width:3px} ::-webkit-scrollbar-thumb{background:#1e2030} textarea::placeholder{color:#1e2d3d}`}</style>
    </div>
  );
}

// ─── CLAUSE FULL TEXT DB ──────────────────────────────────────────────────────
let CLAUSE_FULLTEXT = {
  "SAA-1.3.1": {
    doc:"SAA", section:"Section 1.3.1", title:"Exclusivity — Grant to Partner",
    text:``,
    context:"독점권 조항. KT가 한국 내 금융·보험 분야에서 Palantir Products를 독점적으로 재판매·배포할 권리를 갖는 근거. 적시 지급 조건 미충족 시 독점권 효력이 문제될 수 있음.",
    translation:`계약 기간 동안, Palantir은 KT에게 Territory(대한민국) 내 Target End Customers에 대한 **독점적 재판매·배포 권한**을 부여한다. 단, KT가 해당 Order Form에 명시된 **지급 의무를 적시에 이행**하는 것을 조건으로 한다.

명확히 하자면, 본 조에 따른 독점권은 **Schedule A에 정의된 Target Market(금융서비스·보험)에만 적용**되며, Palantir이 Territory 내에서 Other Market(§1.6.8)과 관련된 활동을 하는 것을 제한하지 않는다.

[Schedule A 정의] "Target Market"이라 함은 **금융서비스(투자은행, 자산관리, 회계법인) 및 보험사**로서 Appendix 6에 등재된 자를 의미한다.`
  },
  "SAA-1.3.2": {
    doc:"SAA", section:"Section 1.3.2", title:"Exclusivity — Palantir Restrictions",
    text:``,
    context:"Palantir의 직접 판매 금지 조항. KT 동의 없이 Target Market에서 직접 판매하거나 제3자 파트너를 선임하는 행위 금지. IC-001 충돌의 핵심.",
    translation:`계약 기간 동안, Palantir은 KT의 사전 서면 동의 없이 다음 행위를 할 수 없다:
(a) **Territory 내 Target End Customers에게 Palantir Products를 직접 판매·배포하는 행위**
(b) Territory 내 Target End Customers 대상으로 판매·배포 권한을 가진 제3자 재판매자·배포자·대리인을 선임하는 행위
(c) 제3자에게 Territory 내 Target End Customers 대상 재판매·배포권을 부여하는 사업 제휴를 체결하는 행위
(d) 위 독점권과 충돌하는 방식으로 사업 구조를 개편하는 행위

다만, 다음은 위 제한의 예외로 한다:
(i) **§1.6.8에 따른 Other Market 관련 활동**
(ii) **§2.10에 따른 Extraordinary Bilateral Transaction(EBT) 이행 의무**`
  },
  "SAA-1.6.8": {
    doc:"SAA", section:"Section 1.6.8", title:"Other Market — Marketing Restrictions",
    text:``,
    context:"Other Market 마케팅 제한. 이 조항 위반이 곧 material breach → SAA §6.2 해지 사유로 연결되는 핵심 조항. Palantir 경고의 직접적 법적 근거.",
    translation:`본 계약의 다른 조항에도 불구하고, KT는 Palantir의 사전 서면 동의 없이, 다음 조건을 **모두** 충족하는 법인을 대상으로 적극적으로 마케팅하거나 영업을 권유할 수 없다:
(a) **Appendix 7에 승인된 Other Market 고객으로 등재되지 않은 법인**
(b) 주된 사업이 Other Market에 속하는 법인

본 조에서 '적극적 마케팅(active marketing)'에는 다음이 포함된다(단, 이에 한정되지 않음):
• 직접 권유(direct solicitation)
• 타깃 광고 캠페인(targeted advertising campaigns)
• 무요청 제안서 발송(unsolicited proposals)
• 해당 법인이 개시한 조달 절차 참여

**이 조항 위반은 §6.2 적용상 "material breach(중대한 위반)"에 해당**하며, Palantir은 치유 기간을 부여한 후 계약을 해지할 수 있다.

[현재 Appendix 7 등재 고객(10개사)] 현대자동차, 기아, 포스코, 한화시스템, 현대로템, 현대글로비스, CJ제일제당, 한국해양진흥공사, 서울아산병원, 산업통상자원부`
  },
  "SAA-2.10": {
    doc:"SAA", section:"Section 2.10", title:"Extraordinary Bilateral Transaction",
    text:``,
    context:"KT가 발굴한 고객에 Palantir이 직접 접근하는 경우의 처리 절차. '삼성전자 직접 접촉' 시나리오에서 핵심 조항. IC-001 충돌과 직결.",
    translation:`Palantir이 Territory 내에서 KT의 독점권(§1.3.1) 범위에 해당하는 잠재 고객과 독자적으로 사업 기회를 발굴·개발하는 경우("Extraordinary Bilateral Transaction", EBT), Palantir은 다음 절차를 이행해야 한다:
(a) **해당 기회를 KT에 서면으로 즉시 통보**
(b) 해당 거래의 구조에 관해 KT와 **성실히(good faith) 협상**
(c) 합리적인 상업 조건으로 KT에 **참여권(participation right) 제공**

**Palantir의 최초 통보 후 30일 이내에 합의가 이루어지지 않을 경우**, Palantir은 비독점 방식으로 해당 거래를 진행할 수 있다. 단, 이 경우 **최초 계약 기간 동안 해당 거래에서 발생한 순수익의 [REDACTED]%를 KT에 소개 수수료(referral fee)로 지급**해야 한다.`
  },
  "SAA-2.11": {
    doc:"SAA", section:"Section 2.11", title:"Surviving QRC Revenue Allocation",
    text:``,
    context:"계약 종료 후 잔여 수익(Surviving QRC) 배분율. KT 10% / Palantir 90% 고정. IC-002에서 SAA §6.3의 good faith 협상 조항과 충돌.",
    translation:`계약 종료 또는 만료 시, 종료일 현재 계약은 체결되었으나 수익이 아직 인식되지 않은 QRC("Surviving QRC")에 대해, 양 당사자는 다음 수익 배분에 합의한다:

(a) **KT는 종료일 이후 24개월간 Palantir이 Surviving QRC 고객으로부터 실제 수령한 순수익의 10%를 수취**한다
(b) **Palantir은 해당 순수익의 90%를 보유**한다
(c) Palantir은 해당 기간 동안 Surviving QRC 고객에 관한 **분기별 수익 보고서를 KT에 제공**해야 한다

위 배분 조건은 Surviving QRC 수익에 관한 **당사자 간의 다른 모든 수익 배분 약정에 우선하여 적용**된다.

※ 핵심 쟁점: SAA §6.3은 good faith 협상을 규정하나 §2.11은 10/90을 고정 → **IC-002 충돌**`
  },
  "SAA-6.2": {
    doc:"SAA", section:"Section 6.2", title:"Termination for Material Breach",
    text:``,
    context:"계약 해지의 핵심 조항. 20일 치유 기간 부여. Other Market 마케팅 위반을 명시적 material breach로 규정. XC-001(vs TOS 30일), EC-002(vs 하도급법 1개월)의 중심 조항.",
    translation:`일방 당사자가 본 계약의 **중요한 의무(material breach)**를 위반한 경우, 상대방은 위반의 성격을 합리적으로 특정한 **서면 통지**를 해야 한다.

서면 통지를 수령한 당사자는 수령일로부터 **20일(치유 기간, Cure Period) 이내에 해당 위반을 치유**해야 한다.

치유 기간 내에 위반을 치유하지 못한 경우, **통지를 발송한 당사자는 계약을 해지**할 수 있다.

※ 핵심 쟁점 — XC-001:
• TOS §8.2는 **30일** 치유 기간을 규정 → 어느 쪽이 우선하는지 충돌
• TOS §8.4는 **사전 통보 없이 즉시 서비스 정지**를 허용 → 이 조항의 치유 기간을 사실상 우회 가능
• 문서 우선순위 원칙상 SAA가 TOS보다 상위이나, 실무상 TOS가 먼저 적용될 위험 존재`
  },
  "SAA-6.3": {
    doc:"SAA", section:"Section 6.3", title:"Effect of Termination — Revenue and Obligations",
    text:``,
    context:"해지 효과 및 잔여 수익 처리. good faith 협상 원칙이나, KT material breach로 해지 시 §2.11 고정 배분 적용 가능. IC-002의 핵심.",
    translation:`계약의 해지 또는 만료 시에도 일정 의무는 존속한다.

**Hurdle(총 수익 목표 USD 55,000,000) 미달성 상태에서 계약이 해지될 경우**, 양 당사자는 Surviving QRC(계약 체결되었으나 수익 미인식 잔여 계약)의 수익 처리 방식에 관해 **good faith(성실한 방법으로) 협상할 의무**를 진다.

※ 핵심 쟁점 — IC-002:
• §2.11은 KT 10% / Palantir 90% 고정 배분을 규정
• §6.3은 good faith 협상을 요구
• 두 조항이 충돌하여 해지 시 수익 배분 기준이 불명확함`
  },
  "SAA-8.2": {
    doc:"SAA", section:"Section 8.2", title:"Limitation of Liability",
    text:``,
    context:"책임 한도 조항. max(12개월 Partner Compensation, $10M). XC-002에서 TOS §12의 $100K 한도와 충돌 — 어느 문서가 우선하느냐에 따라 100배 차이.",
    translation:`어느 당사자도 본 계약 또는 이와 관련하여 **USD $10,000,000(1,000만 달러)를 초과하는 금액**에 대해 손해배상 책임을 지지 않는다.

단, 다음의 경우는 위 상한의 예외로 한다:
(i) **사망 또는 신체상해**로 인한 청구
(ii) **고의적 위법행위 또는 중과실**로 인한 청구
(iii) **비밀유지 의무(§7.1) 위반**으로 인한 청구

※ 핵심 쟁점 — XC-002:
• TOS §12는 최대 **USD $100,000(10만 달러)** 상한을 규정
• SAA $10M vs TOS $100K → **최대 100배 차이**
• 문서 우선순위상 SAA가 상위이나, Palantir이 TOS 적용을 주장할 경우 분쟁 발생`
  },
  "SAA-9.0": {
    doc:"SAA", section:"Section 9", title:"Governing Law and Dispute Resolution",
    text:``,
    context:"준거법·중재지. 한국법·서울 ICC. XC-003에서 TOS §13(영국법·런던 ICC)과 직접 충돌 — OF3/OF4가 TOS를 참조하므로 OF 관련 분쟁 시 어느 기준이 적용되는지 불명확.",
    translation:`본 계약의 성립, 유효성, 해석 및 이행은 **대한민국 법률**에 의해 규율된다.

본 계약과 관련하여 발생하는 모든 분쟁은 **서울 소재 ICC(국제상업회의소) 중재**를 통해 최종적이고 구속력 있게 해결한다. 중재 언어는 **영어**로 한다.

※ 핵심 쟁점 — XC-003:
• TOS §13은 **영국법** 및 **런던 ICC 중재**를 지정
• SAA(한국법·서울) vs TOS(영국법·런던) 직접 충돌
• 문서 우선순위상 SAA가 상위이나, TOS §13이 별도 독립 조항이라는 주장 가능
• 분쟁 발생 시 준거법·중재지 자체가 최초 쟁점이 되는 심각한 구조적 문제`
  },
  "OF3-FEES": {
    doc:"OF3", section:"Order Form #3 — Fees", title:"Enablement Program 지급 조건",
    text:``,
    context:"OF3 지급 조건. $9M 인보이스 즉시 발행, 30일 내 지급. $3M 할인은 OF2 파트너십 목적에 연동. EC-001(연체이자 충돌)의 기초.",
    translation:`KT는 Enablement Program에 대해 **USD $9,000,000(900만 달러)**를 Palantir의 인보이스 수령 후 **30일 이내**에 지급해야 한다.

지급 기한 초과 시 TOS §7에 따른 **월 1.5%(연 18%)의 연체이자**가 부과된다.

하도급지침 제8조에 따른 **공정위 고시 이율(연 15.5%)과 충돌** 가능성 있음(EC-001).`
  },
  "OF4-FEES": {
    doc:"OF4", section:"Order Form #4 — Billing Details", title:"Platform License 지급 일정",
    text:``,
    context:"OF4 지급 일정. 즉시 $4M 포함 5년 $27M. 편의해지 절대 불가. EC-005(예산 집행 원칙 충돌)의 핵심 조항.",
    translation:`KT는 Platform License에 대해 다음과 같이 지급해야 한다:
• **계약 즉시: USD $4,000,000(400만 달러)**
• **이후 연간: USD $5,000,000~$6,000,000(500~600만 달러)**
• **5년 총액: USD $27,000,000(2,700만 달러)**

**편의해지(termination for convenience) 불가** 조항 포함 — KT는 사업상 이유로 일방적 해지 후 잔여 금액 면제를 받을 수 없음.

※ 핵심 쟁점: 즉시 지급 $4M이 기존 예산 편성 범위를 초과하는지 여부(EC-005, 회계규정 제30조).`
  },
  "OF4-CLOUD": {
    doc:"OF4", section:"Order Form #4 — Infrastructure", title:"Azure Cloud Infrastructure",
    text:``,
    context:"Azure 클라우드 인프라 조항. EC-003(CISO 승인), EC-004(가급 자산 통제)의 직접 계약 근거. SPC 마이그레이션 시 요금 재협의 조항 포함.",
    translation:`PoC(개념 검증, Proof of Concept) 단계에서 **Microsoft Azure Cloud Infrastructure**를 사용한다.

SPC(Special Purpose Company, 특수목적법인)로의 마이그레이션이 발생하는 경우 클라우드 인프라 요금 구조를 **재협의**한다.

※ 핵심 쟁점 — EC-003:
• KT 정보보호지침 제43조에 따라 **신규 정보시스템 도입 전 CISO 보안성 승인 필수**
• OF4에 따른 Azure 즉시 사용 의무와 충돌
• CISO 승인 없이 Azure 도입 시 내규 위반 → TOS §8.4의 '법적 준수 위반'으로 해석되어 즉시 서비스 정지 사유가 될 수 있음`
  },
  "TOS-7": {
    doc:"TOS", section:"Section 7", title:"Fees and Payment / Late Payment",
    text:``,
    context:"연체이자 조항. 월 1.5%(연 18%). EC-001에서 하도급법 공정위 고시 이율(연 약 15.5%)과 충돌. 하도급법이 강행규정이므로 적용 우선순위 검토 필요.",
    translation:`KT가 TOS에 따른 지급 기한을 준수하지 못하는 경우, **연체 금액 전액에 대해 월 1.5%(연 환산 18%)의 연체이자**가 자동으로 부과된다.

※ 핵심 쟁점 — EC-001:
• 하도급거래 공정화에 관한 법률 시행령 및 공정거래위원회 고시에 따른 법정 이율은 **연 15.5%**
• TOS §7의 연 18%는 이보다 높아 **하도급법 강행규정과 충돌**
• 하도급법 적용 시 초과분(2.5%p) 청구가 무효가 될 수 있음
• Palantir이 한국 하도급법 적용 대상인지 여부가 선결 쟁점`
  },
  "TOS-8.2": {
    doc:"TOS", section:"Section 8.2", title:"Termination for Cause",
    text:``,
    context:"TOS 해지 조항. 30일 치유 기간. XC-001에서 SAA §6.2(20일)와 충돌. 단, 충돌 시 OF/SAA 우선 원칙에 따라 SAA §6.2(20일)가 적용되어야 함.",
    translation:`Palantir은 KT가 본 약관의 중요한 조항을 위반하고, **서면 통보 후 30일 이내에 위반을 치유하지 않을 경우** 계약을 해지할 수 있다.

※ 핵심 쟁점 — XC-001:
• **SAA §6.2는 20일** 치유 기간을 규정하여 직접 충돌
• 문서 우선순위(Order Form > SAA > TOS)상 SAA의 20일이 우선 적용되어야 하나, Palantir이 TOS의 30일을 주장할 경우 분쟁 발생
• TOS §8.4의 즉시 정지 조항이 이 치유 기간 자체를 우회할 수 있음(XC-004)`
  },
  "TOS-8.4": {
    doc:"TOS", section:"Section 8.4", title:"Suspension of Services",
    text:``,
    context:"서비스 즉시 정지 조항. KT 위반·연체 30일·보안 리스크 시 사전 통보 없이 즉시 정지 가능. XC-004에서 SAA §6.2 치유 기간을 사실상 우회하는 문제.",
    translation:`Palantir은 KT가 다음에 해당하는 경우 **사전 통보 없이 즉각적으로 서비스를 정지**할 수 있다:
(i) **TOS에 따른 지급 의무 위반**
(ii) **보안 위험을 초래하는 행위**
(iii) **적용 법령 또는 규정 준수 의무 위반**

※ 핵심 쟁점 — XC-004 (KT에 매우 불리한 핵심 조항):
• **SAA §6.2의 20일 치유 기간을 사실상 우회**하는 조항
• KT가 위반 사실을 인지하고 치유할 기회 없이 서비스가 즉시 중단될 수 있음
• '보안 위험' 및 '법령 준수 위반'의 정의가 불명확하여 Palantir의 자의적 적용 가능성
• 실무적으로 서비스 중단은 KT 사업에 즉각적·치명적 영향을 미침`
  },
  "TOS-12": {
    doc:"TOS", section:"Section 12", title:"Limitation of Liability (TOS)",
    text:``,
    context:"TOS 책임 한도. max(12개월 Fee, $100K). XC-002에서 SAA §8.2($10M)와 최대 100배 차이. SAA가 상위 문서이므로 SAA §8.2($10M)가 우선 적용되어야 하나, OF3/OF4가 TOS를 직접 참조하는 구조로 인해 불확실성 존재.",
    translation:`본 약관에 따른 Palantir의 배상 책임 총액은 다음 중 **큰 금액**을 초과할 수 없다:

• 청구 원인 발생 직전 **12개월간 KT가 Palantir에 실제 지급한 Order Form 금액**
• **USD $100,000(10만 달러)**

단, 다음의 경우는 위 상한의 예외이다:
• KT의 IP 침해에 따른 Palantir의 면책 의무(§9.1)
• 사망·신체상해

※ 핵심 쟁점 — XC-002 (구조적 핵심 충돌):
• **SAA §8.2: USD $10,000,000(1,000만 달러) 상한**
• **TOS §12: USD $100,000(10만 달러) 상한**
• **최대 100배 차이** — 실제 손해 발생 시 적용 조항에 따라 결과가 완전히 달라짐
• 문서 우선순위상 SAA $10M이 적용되어야 하나, Palantir이 TOS §12 적용을 주장할 경우 분쟁`
  },
  "TOS-13": {
    doc:"TOS", section:"Section 13", title:"Governing Law (TOS)",
    text:``,
    context:"TOS 준거법·중재지. 영국법·런던 ICC. XC-003에서 SAA §9.0(한국법·서울 ICC)과 직접 충돌. OF3/OF4가 TOS를 참조하므로 OF 관련 분쟁에서 어느 기준이 적용되는지 불명확.",
    translation:`본 약관은 **영국법(laws of England and Wales)**에 의해 규율되며, 동 법에 따라 해석된다.

본 약관과 관련된 모든 분쟁은 **런던 소재 ICC(국제상업회의소) 중재**를 통해 최종 해결한다.

※ 핵심 쟁점 — XC-003 (구조적 핵심 충돌):
• **SAA §9.0: 대한민국 법률 + 서울 ICC**
• **TOS §13: 영국법 + 런던 ICC**
• 두 문서가 완전히 다른 준거법과 중재지를 규정
• 분쟁 발생 시 **준거법·중재지 결정 자체가 최초 쟁점**이 되는 심각한 구조적 문제
• 어느 국가 법원에 소를 제기해야 하는지도 불명확`
  },
  "REG-하도급-8조": {
    doc:"하도급지침", section:"제8조⑤", title:"합리적인 대금지급 기일 결정",
    text:``,
    context:"하도급법상 지급기한 및 연체이자. EC-001에서 TOS §7 월 1.5%(연 18%)와 충돌. 하도급법은 강행규정으로 Palantir Korea가 중소기업인 경우 공정위 이율이 우선 적용됨.",
    translation:`원사업자(KT)는 수급사업자(Palantir)에게 목적물 수령일로부터 **60일 이내에 하도급대금을 지급**해야 한다.

60일 초과 지연 시, **공정거래위원회 고시 이율(현행 연 15.5%)에 따른 지연이자** 지급 의무가 발생한다.

※ 핵심 쟁점: TOS §7의 월 1.5%(연 18%) 연체이율과 충돌(EC-001). 하도급법은 강행법규이므로 계약 조항에도 불구하고 우선 적용될 수 있음.`
  },
  "REG-하도급-8조⑦": {
    doc:"하도급지침", section:"제8조⑦", title:"계약 해제·해지 절차",
    text:``,
    context:"하도급법상 해지 최고 기간. 중요 내용 위반 시 1개월 이상 최고 필수. EC-002에서 SAA §6.2(20일), TOS §8.2(30일)와 충돌. 하도급법 강행규정으로 SAA 20일 해지가 법적으로 무효화될 수 있음.",
    translation:`원사업자(KT)가 하도급계약의 **중요한 내용을 위반**한 경우, 수급사업자(Palantir)는 **1개월 이상의 기간을 정하여 이행을 최고(催告)**한 후 계약을 해지할 수 있다.

※ 핵심 쟁점: SAA §6.2(20일), TOS §8.2(30일)와의 충돌(EC-002). 하도급법의 1개월 최고 기간이 더 길어, 하도급법 적용 시 Palantir의 해지 가능 시점이 늦어질 수 있음.`
  },
  "REG-정보보호-43조": {
    doc:"정보보호지침", section:"제43조", title:"보안성 승인",
    text:``,
    context:"CISO 보안성 승인 의무. EC-003의 핵심 내규 조항. Azure 클라우드 도입 전 CISO 승인이 없었다면 내규 위반. CISO가 서비스 중단을 요구할 수 있어 OF4 계약상 의무와 충돌 가능.",
    translation:`KT의 임직원 및 협력업체는 **신규 정보시스템 구축·도입 전에 반드시 CISO(정보보호최고책임자)의 보안성 검토·승인**을 받아야 한다.

승인 없이 시스템을 구축하거나 외부 서비스를 도입하는 것은 지침 위반에 해당한다.

※ 핵심 쟁점: OF4에 따른 Azure Cloud Infrastructure 즉시 사용과 충돌(EC-003). CISO 승인 없이 진행 시 KT 내규 위반이 되며, 이것이 TOS §8.4의 '법적 준수 의무 위반'으로 해석되어 서비스 즉시 정지 사유가 될 수 있음.`
  },
  "REG-정보보호-44조": {
    doc:"정보보호지침", section:"제44조", title:"정보자산의 분류 및 통제",
    text:``,
    context:"가급 정보자산 외부 제공 통제. EC-004의 핵심 내규 조항. KT 고객 데이터를 Palantir Azure에 업로드 시 가급 해당 가능성. 부문정보보안관리자 사전승인 없이 업로드하면 내규 위반 + 개인정보보호법 위반 가능.",
    translation:`KT의 **'가급' 정보자산**은 외부 법인·개인에게 제공하기 전 **부문정보보안관리자의 사전 서면 승인**을 받아야 한다.

무단 외부 제공 시 보안 사고 책임 및 징계 대상이 될 수 있다.

※ 핵심 쟁점: Palantir에 KT 고객 데이터를 제공하거나 Azure에 업로드하는 행위가 가급 자산 외부 제공에 해당하는지 여부(EC-004). TOS §3의 데이터 처리 허용 조항과 충돌 소지.`
  },
  "REG-회계-30조": {
    doc:"회계규정", section:"제30조", title:"지출의 원칙",
    text:``,
    context:"예산 집행 원칙. EC-005의 핵심 내규 조항. OF4 즉시 지급 $4M(약 54억원) 및 5개년 $27M이 연도별 예산 편성 없이 집행됐다면 회계규정 위반.",
    translation:`KT의 모든 지출은 **성립된 예산의 범위 내에서** 집행해야 한다.

예산을 초과하거나 미편성 항목에 지출이 필요한 경우, **재무실과 사전 협의**를 거쳐야 한다.

※ 핵심 쟁점: OF4에 따른 즉시 $4,000,000(400만 달러) 지급 의무가 기존 예산 편성 범위를 초과하는지 여부(EC-005). 사전 예산 협의 없이 집행된 경우 내부 규정 위반이 될 수 있음.`
  },
};

// ─── KNOWLEDGE BASE ───────────────────────────────────────────────────────────
let CONTRACT_KB = {
  clauses: [
    { id:"SAA-1.3.1", doc:"SAA", topic:"독점권 (Target Market)", core:"KT는 한국 내 금융·보험 분야 Palantir Products 독점 재판매권 보유" },
    { id:"SAA-1.3.2", doc:"SAA", topic:"Palantir 직접 판매 금지", core:"KT 동의 없는 Palantir 직접 판매·파트너 선임 금지" },
    { id:"SAA-1.6.8", doc:"SAA", topic:"Other Market 마케팅 제한", core:"Appendix 7 미등재 고객 대상 적극적 마케팅 금지. 위반 시 material breach" },
    { id:"SAA-2.10", doc:"SAA", topic:"Extraordinary Bilateral Transaction", core:"KT 발굴 고객을 Palantir이 직접 계약 시 협의로 처리" },
    { id:"SAA-2.11", doc:"SAA", topic:"Surviving QRC 배분율", core:"KT 10% / Palantir 90% 고정 배분" },
    { id:"SAA-6.2", doc:"SAA", topic:"계약 해지 (material breach)", core:"20일 서면 통보 후 해지. 계약 범위 외 영업은 material breach로 명시" },
    { id:"SAA-6.3", doc:"SAA", topic:"해지 효과 및 잔여 수익 처리", core:"Hurdle 미달성 해지 시 Surviving QRC 수익 good faith 협상" },
    { id:"SAA-7.1", doc:"SAA", topic:"비밀유지", core:"5년 비밀유지. 법원/정부 명령 시 사전 통보 의무" },
    { id:"SAA-8.1", doc:"SAA", topic:"상호 면책", core:"허위진술·서비스 하자·중과실로 인한 제3자 클레임 상호 면책" },
    { id:"SAA-8.2", doc:"SAA", topic:"Liability Cap", core:"max(12개월 Partner Compensation, USD $10M)" },
    { id:"SAA-9.0", doc:"SAA", topic:"준거법·중재지", core:"한국법 적용, 서울 ICC 중재" },
    { id:"SAA-10.4", doc:"SAA", topic:"독립 개발권", core:"KT 기밀 미사용 시 Palantir 경쟁 제품 독립 개발 가능" },
    { id:"OF3-FEES", doc:"OF3", topic:"Enablement Program 지급", core:"$9M, 인보이스 수령 후 30일 내 지급" },
    { id:"OF3-T2", doc:"OF3", topic:"Non-Solicitation (4년)", core:"Palantir Certified KT 직원 4년간 스카우트 금지" },
    { id:"OF4-FEES", doc:"OF4", topic:"Platform License 지급", core:"즉시 $4M, 이후 연 $5~6M, 5년 총 $27M. 편의해지 불가" },
    { id:"OF4-CLOUD", doc:"OF4", topic:"Azure Cloud Infrastructure", core:"PoC Azure 사용. SPC 마이그레이션 시 요금 재협의" },
    { id:"TOS-7", doc:"TOS", topic:"연체이자", core:"연체 시 월 1.5% (연 18%) 이자 부과" },
    { id:"TOS-8.2", doc:"TOS", topic:"해지 (치유 기간)", core:"30일 치유 기간 후 해지" },
    { id:"TOS-8.4", doc:"TOS", topic:"서비스 즉시 정지", core:"KT 위반·보안 리스크 시 사전 통보 없이 즉시 서비스 정지" },
    { id:"TOS-9.1", doc:"TOS", topic:"IP 침해 면책", core:"Palantir Technology 관련 IP 침해 클레임 Palantir이 면책" },
    { id:"TOS-12", doc:"TOS", topic:"Liability Cap (TOS)", core:"max(12개월 Order Form Fee, USD $100K)" },
    { id:"TOS-13", doc:"TOS", topic:"준거법·중재지 (TOS)", core:"영국법 적용, 런던 ICC 중재" },
    { id:"REG-하도급-8조", doc:"하도급지침", topic:"대금 지급기한 (하도급)", core:"수령일로부터 60일 이내. 초과 시 공정위 고시 이율" },
    { id:"REG-하도급-8조⑦", doc:"하도급지침", topic:"계약 해지 최고 기간", core:"중요 내용 위반 시 1개월 이상 최고 후 해지" },
    { id:"REG-정보보호-43조", doc:"정보보호지침", topic:"CISO 보안성 승인", core:"신규 정보시스템 구축 전 CISO 보안성 승인 필수" },
    { id:"REG-정보보호-44조", doc:"정보보호지침", topic:"가급 정보자산 통제", core:"가급 자산 외부 유출 시 부문정보보안관리자 사전승인 필수" },
    { id:"REG-계약-36조", doc:"계약규정", topic:"계약서 필수 기재사항", core:"계약목적·금액·이행기간·지체상금 필수 기재" },
    { id:"REG-계약-18조", doc:"계약규정", topic:"수의계약 집행기준", core:"특정 기술·특허·단일 공급자 해당 시 수의계약 가능" },
    { id:"REG-회계-30조", doc:"회계규정", topic:"예산 집행 원칙", core:"지출은 성립된 예산 범위 내. 초과 시 재무실 사전 협의" },
    { id:"REG-협력사-4조", doc:"협력사선정지침", topic:"협력사 등록 요건", core:"신용등급 B- 이상, TL9000/ISO9001 인증 필요" },
  ],
  conflicts: [
    { id:"XC-001", risk:"HIGH", topic:"치유 기간", summary:"SAA §6.2 (20일) vs TOS §8.2 (30일)" },
    { id:"XC-002", risk:"HIGH", topic:"Liability Cap", summary:"SAA §8.2 ($10M) vs TOS §12 ($100K)" },
    { id:"XC-003", risk:"HIGH", topic:"준거법·중재지", summary:"SAA §9.0 (한국법/서울) vs TOS §13 (영국법/런던)" },
    { id:"XC-004", risk:"HIGH", topic:"서비스 즉시 정지", summary:"TOS §8.4 즉시 정지로 SAA 20일 치유 기간 우회 가능" },
    { id:"XC-005", risk:"HIGH", topic:"해지 후 잔여 Fee", summary:"SAA §6.3 (협상) vs OF4 (ratable 기준)" },
    { id:"IC-001", risk:"HIGH", topic:"독점 vs EBT", summary:"SAA §1.3.2 직접 판매 금지 vs §2.10 EBT 협의" },
    { id:"IC-002", risk:"HIGH", topic:"Surviving QRC 배분", summary:"SAA §6.3 (협상) vs §2.11 (10%/90% 고정)" },
    { id:"EC-001", risk:"HIGH", topic:"연체이자율 충돌", summary:"TOS §7 월 1.5% vs 하도급법 공정위 고시 이율" },
    { id:"EC-002", risk:"HIGH", topic:"해지 최고 기간", summary:"하도급지침 1개월 vs SAA 20일/TOS 30일" },
    { id:"EC-003", risk:"HIGH", topic:"CISO 보안성 승인", summary:"Azure 도입 전 CISO 승인 의무 vs OF4 즉시 사용" },
    { id:"EC-004", risk:"HIGH", topic:"가급 자산 외부 제공", summary:"정보보호지침 사전승인 vs TOS §3 데이터 처리 허용" },
    { id:"EC-005", risk:"HIGH", topic:"예산 집행 원칙", summary:"회계규정 예산 범위 내 집행 vs OF4 즉시 $4M 지급" },
  ],
  appendix7: ["현대자동차","기아","포스코","한화시스템","현대로템","현대글로비스","CJ제일제당","한국해양진흥공사","서울아산병원","산업통상자원부"],
};


// ─── KB PATCH ENGINE ──────────────────────────────────────────────────────────
// Amendment 파싱 결과(patchset)를 CONTRACT_KB와 CLAUSE_FULLTEXT에 직접 반영
function applyPatchesToKB(patches) {
  for (const p of patches) {
    // CONTRACT_KB.clauses 업데이트
    const clause = CONTRACT_KB.clauses.find(c => c.id === p.clauseId);
    if (clause) {
      if (p.changeType === "삭제") {
        clause.core = "[삭제됨] " + (p.deletionReason || clause.core);
        clause._deleted = true;
      } else {
        clause.core    = p.newCore    || clause.core;
        clause.topic   = p.newTopic   || clause.topic;
        clause._amended = true;
        clause._amendedBy = p.amendedBy;
      }
    } else if (p.changeType === "추가") {
      // 신규 조항 추가
      CONTRACT_KB.clauses.push({
        id:    p.clauseId,
        doc:   p.doc    || "AMD",
        topic: p.newTopic || "신규 조항",
        core:  p.newCore  || "",
        _new:  true,
        _amendedBy: p.amendedBy,
      });
    }
    // CLAUSE_FULLTEXT 업데이트
    if (CLAUSE_FULLTEXT[p.clauseId]) {
      if (p.newFullText)    CLAUSE_FULLTEXT[p.clauseId].text        = p.newFullText;
      if (p.newTranslation) CLAUSE_FULLTEXT[p.clauseId].translation = p.newTranslation;
      if (p.newContext)     CLAUSE_FULLTEXT[p.clauseId].context     = p.newContext;
      CLAUSE_FULLTEXT[p.clauseId]._amended  = true;
      CLAUSE_FULLTEXT[p.clauseId]._amendedBy = p.amendedBy;
    } else if (p.newFullText && p.changeType === "추가") {
      CLAUSE_FULLTEXT[p.clauseId] = {
        doc:         p.doc    || "AMD",
        section:     p.clauseId,
        title:       p.newTopic || "신규 조항",
        text:        p.newFullText,
        translation: p.newTranslation || "",
        context:     p.newContext || "",
        _new: true,
        _amendedBy: p.amendedBy,
      };
    }
    // 충돌 KB 업데이트 (신규 충돌 추가)
    if (p.newConflicts) {
      for (const nc of p.newConflicts) {
        const exists = CONTRACT_KB.conflicts.find(c => c.id === nc.id);
        if (!exists) CONTRACT_KB.conflicts.push({ ...nc, _amendedBy: p.amendedBy });
      }
    }
  }
}

// storage에서 패치셋 로드 → KB에 즉시 적용 (앱 시작 시 1회 실행)
async function loadAndApplyStoredPatches() {
  try {
    const s = lsGet("kb_patches_v1");
    if (s?.value) {
      const patchHistory = JSON.parse(s);
      const allPatches = patchHistory.flatMap(h => h.patches);
      applyPatchesToKB(allPatches);
      return patchHistory;
    }
  } catch(e) { console.error("KB patch load error:", e); }
  return [];
}

// ─── PROMPT BUILDER ───────────────────────────────────────────────────────────
function buildSystemPrompt(mode, amendments=[]) {
  const clauseLines = CONTRACT_KB.clauses.map(c => c.id+" / "+c.doc+" / "+c.topic+" / "+c.core).join("\n");
  const conflictLines = CONTRACT_KB.conflicts.map(c => c.id+" / "+c.risk+" / "+c.topic+" / "+c.summary).join("\n");
  const extNote = mode==="extended"
    ? "분석 모드: 확장. 계약 문서와 KT 내규(계약규정, 회계규정, 정보보호지침, 하도급지침, 협력사선정지침, 도급관리지침) 모두 참조."
    : "분석 모드: 기본. 계약 문서(SAA/OF3/OF4/TOS)만 참조.";
  return `당신은 KT와 Palantir Korea LLC 간의 계약 리스크 분석 전문가입니다.
${extNote}
문서 우선순위: Order Form > SAA > TOS
Hurdle: USD 55,000,000 / OF3: USD 9,000,000 / OF4: USD 27,000,000 (편의해지 불가)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
분석 전 의무 체크리스트 — 조항 적용 전 반드시 4가지 확인
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【체크 1】 고객 범위 — 이 고객은 누구인가?
  ├ Target Market: 금융서비스(투자은행·자산관리·회계법인) 및 보험사 (Appendix 6 등재)
  │   → SAA-1.3.1/1.3.2 독점권 유효. Palantir 직접 판매 금지.
  │   → KT가 영업하지 않으면 SAA-6.2 위반 아님
  ├ Other Market: Appendix 7 등재 10개사만 해당
  │   (현대자동차, 기아, 포스코, 한화시스템, 현대로템, 현대글로비스,
  │    CJ제일제당, 한국해양진흥공사, 서울아산병원, 산업통상자원부)
  │   → KT 영업 가능하나 SAA-1.6.3~1.6.8 Co-Sell 조건 준수 필요
  └ 계약 범위 외: 위 두 범위 모두 아닌 고객 (예: 삼성전자, 제조업체 등)
      → Palantir 자유롭게 직접 접촉·계약 가능. SAA 위반 아님.
      → KT가 이 고객에 영업했다면 오히려 KT가 SAA-6.2 material breach

【체크 2】 행위 주체 — 누가 무엇을 했는가?
  ├ Palantir이 한 행위인가, KT가 한 행위인가, 아니면 제3자인가?
  ├ 서비스 정지: Palantir이 일방적으로 한 것인지(TOS-8.4), KT 귀책으로 정지된 것인지 먼저 확인
  ├ 계약 위반 주장 전 해당 의무가 어느 당사자에게 있는지 조항에서 확인
  └ "KT가 피해자"로 결론 내리기 전에 KT에게도 책임 있는 행위가 없었는지 검토

【체크 3】 선후관계·조건 — 조항 적용 조건이 충족되었는가?
  ├ Hurdle ($55M) 달성 여부 확인 후 수익 배분 조항(SAA-2.11) 적용
  ├ OF4 편의해지 불가 조건 — 해지 논거 전개 전 반드시 확인
  ├ SAA-6.2 material breach 주장 시 20일 서면 통보 선행 여부 확인
  ├ TOS-8.2 30일 치유 기간 / SAA-6.2 20일 치유 기간 — 어느 문서가 우선인지 확인
  └ EBT(SAA-2.10)는 Target Market 내 고객에게만 적용. 범위 외 고객에 EBT 주장 불가.

【체크 4】 문서 우선순위 — 충돌 시 어느 조항이 이기는가?
  ├ 일반 원칙: Order Form (OF3, OF4) > SAA > TOS 순으로 상위 문서 우선 적용
  ├ 단, 이미 식별된 충돌(XC-/IC-/EC- 항목)이 관련된 경우 우선순위 원칙이 그대로 적용되지 않음
  │   → XC-001: SAA 20일 vs TOS 30일 치유 기간 — 어느 쪽 우선인지 자체가 분쟁 포인트
  │   → XC-002: Liability Cap SAA $10M vs TOS $100K — Palantir의 TOS 적용 주장 시 분쟁
  │   → XC-003: 준거법·중재지(한국법/서울 vs 영국법/런던) — 문서 우선순위로 해결 불가
  │   → XC-004: TOS-8.4 즉시 정지가 SAA-6.2 20일 치유를 사실상 우회 가능 — 결과 불확실
  ├ 충돌 식별 항목 해당 시: "원칙상 SAA 우선이나 Palantir이 TOS 적용 주장 시 분쟁 리스크 존재"로 서술
  └ 내규(하도급지침 등)는 SAA/TOS와 독립적으로 KT 내부 의무 — 계약 위반과 내부 징계는 별개로 발생

⚠️ 절대 금지
  - 체크 1~4 확인 없이 조항을 상황에 기계적으로 매칭하는 것
  - KT가 권리 없는 상황에서 KT 방어 논거를 억지로 구성하는 것
  - 조항 적용 조건(Hurdle, 기간, 등재 여부 등) 미확인 상태로 결론 도출
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

주요 조항 (ID/문서/주제/내용):
${clauseLines}

기식별 충돌 (ID/위험도/주제/요약):
${conflictLines}

사용자의 상황을 분석하고 아래 형식으로 출력하세요.

##SUMMARY## 한 문장 상황 요약
##RISK## HIGH 또는 MEDIUM 또는 LOW
##RISK_REASON## 위험도 판단 이유
##LEGAL## 법적 효과 분석
##KT_DEFENSE## KT 방어 논거
##PALANTIR## Palantir 측 주장
##BOTTOM_LINE## 핵심 결론 한 문장
##CONFLICTS## 관련충돌ID를쉼표로나열 (없으면 없음)
##CLAUSE## clause_id=SAA-6.2|doc=SAA|topic=조항주제|relevance=관련성|kt_position=KT입장|urgency=즉시
##ACTION## step=STEP 1|timeframe=오늘중|action=조치내용|clauses=SAA-6.2,TOS-8.4

주의사항:
- ##CLAUSE##와 ##ACTION##은 여러 줄 가능. 나머지는 한 줄씩. | 는 구분자로만 사용.
- 모든 필드에서 조항을 언급할 때는 반드시 SAA-6.2, TOS-8.4, OF4-FEES, REG-하도급-8조 등 정확한 하이픈 형식 ID 사용. §, 제X조 등 다른 형식 사용 금지.
- ##ACTION##의 clauses= 에는 이 조치와 관련된 조항 ID를 반드시 쉼표로 나열할 것(없으면 없음).`;
}


// ─── REPORT ───────────────────────────────────────────────────────────────────
function ReportButton(){return null;}


function buildFollowupPrompt(mode, analysisResult, chatHistory, amendments=[]) {
  const clauseLines = CONTRACT_KB.clauses.map(c => c.id+" / "+c.doc+" / "+c.topic+" / "+c.core).join("\n");
  const extNote = mode==="extended" ? "확장 모드 (계약 + 내규)" : "기본 모드 (계약 문서)";
  const historyText = chatHistory.map(m => (m.role==="user" ? "사용자: " : "AI: ") + m.content).join("\n");
  const amendNote = amendments.length > 0
    ? "\n\n현재 적용 중인 Amendment:\n" + amendments.map(a =>
        `[${a.docType}] ${a.fileName}: ${a.changes.map(c=>c.clauseId+" "+c.changeType).join(", ")}`
      ).join("\n")
    : "";
  return `당신은 KT와 Palantir Korea LLC 간의 계약 리스크 분석 전문가입니다. ${extNote}${amendNote}

[분석 전 의무 체크 — 4가지]
체크1 고객 범위: Target Market(금융·보험, Appendix 6) / Other Market(Appendix 7 10개사) / 계약 범위 외(→KT 영업권 없음, Palantir 자유)
체크2 행위 주체: 위반 행위가 Palantir인지 KT인지 제3자인지 확인 후 책임 귀속
체크3 조건 충족: Hurdle($55M) 달성 여부, OF4 편의해지 불가, 20일/30일 치유 기간, EBT는 Target Market 내에서만
체크4 문서 우선순위: 일반 원칙은 Order Form > SAA > TOS. 단 XC-001/XC-002/XC-003/XC-004 등 이미 식별된 충돌 항목은 우선순위 원칙이 그대로 적용되지 않으므로 "원칙상 SAA 우선이나 분쟁 리스크 존재"로 서술. 내규는 KT 내부 의무로 계약 위반과 독립.
⚠️ 조건 미확인·범위 밖 조항 적용·KT 권리 없는 상황에서 KT 방어 논거 구성 금지

주요 조항 (ID/문서/주제/내용):
${clauseLines}

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


// ─── DOCUMENT MANAGEMENT SYSTEM ───────────────────────────────────────────────

// 문서 타입 정의
const DOC_TYPES = {
  SAA:    { label:"SAA",       color:"#60a5fa", desc:"Strategic Alliance Agreement" },
  TOS:    { label:"TOS",       color:"#f59e0b", desc:"Terms of Service" },
  OF:     { label:"Order Form",color:"#a78bfa", desc:"Order Form (3, 4, ...)" },
  REG:    { label:"내규",      color:"#34d399", desc:"KT 내부 규정" },
  AMD:    { label:"Amendment", color:"#fb923c", desc:"계약 변경서" },
  NEW:    { label:"신규",      color:"#e879f9", desc:"신규 계약서" },
  OTHER:  { label:"기타",      color:"#8899aa", desc:"기타 문서" },
};

// 충돌 재검토 AI 프롬프트
const CONFLICT_CHECK_PROMPT = (clauses) => {
  const clauseLines = clauses.map(c => {
    const core  = (c.core  || '').replace(/[\r\n\t"]/g, ' ').slice(0, 80);
    const topic = (c.topic || '').replace(/[\r\n\t"]/g, ' ').slice(0, 30);
    return '[' + c.id + '] ' + (c.doc || '') + ' | ' + topic + ' | ' + core;
  }).join('\n');
  return '당신은 KT x Palantir Korea 계약 전문가입니다.\n' +
    '아래 조항 목록에서 조항 간 충돌을 찾아내시오.\n' +
    'Markdown 백틱 없이 순수 JSON 배열만 출력.\n\n' +
    '조항 목록:\n' + clauseLines + '\n\n' +
    '출력 형식:\n[\n' +
    '  {\n' +
    '    "id": "XC-001",\n' +
    '    "risk": "HIGH|MEDIUM|LOW",\n' +
    '    "topic": "충돌 주제 20자 이내",\n' +
    '    "summary": "A조항 vs B조항 충돌 설명 80자 이내",\n' +
    '    "clauseIds": ["SAA-6.2", "TOS-8.2"]\n' +
    '  }\n]\n\n' +
    '규칙: 기존 ID(XC-,IC-,EC-) 유지. 신규는 XC-NEW-001. 충돌없으면 [] 반환.';
};



// 문서 업로드용 조항 추출 AI 프롬프트
const CLAUSE_EXTRACT_PROMPT = (docType, fileName) => `당신은 계약서 분석 전문가입니다.
아래 문서(${docType}: ${fileName})에서 핵심 조항을 추출하여 JSON 배열로만 반환하시오.
Markdown 백틱 없이 순수 JSON만 출력. 문자열 내 줄바꿈은 반드시 \\n으로 이스케이프할 것.

[
  {
    "id": "DOC-조항번호",
    "doc": "${docType}",
    "topic": "조항 주제 (한국어, 15자 이내)",
    "core": "핵심 내용 요약 (한국어, 100자 이내)",
    "section": "조항 번호/제목",
    "title": "조항 제목",
    "translation": "한국어 번역 요약 (100자 이내)",
    "context": "KT 관점 리스크 (50자 이내)"
  }
]

규칙:
- 중요 조항만 추출 (최대 15개). 사소한 정의/서명/날짜 조항 제외.
- 각 필드값에 큰따옴표(")가 포함되면 반드시 \\"로 이스케이프.
- 응답은 반드시 [ 로 시작하고 ] 로 끝나야 함.`;

// ─── 문서 DB 헬퍼 ────────────────────────────────────────────────────────────
const DocDB = {
  DOCS_KEY:      "docmgr_docs_v1",
  CLAUSES_KEY:   "docmgr_clauses_v1",
  CONFLICTS_KEY: "docmgr_conflicts_v1",

  async load() {
    const results = {};
    for (const [key, prop] of [
      [this.DOCS_KEY, 'docs'],
      [this.CLAUSES_KEY, 'clauses'],
      [this.CONFLICTS_KEY, 'conflicts'],
    ]) {
      try {
        const s = lsGet(key);
        results[prop] = s ? JSON.parse(s) : null;
      } catch(e) { results[prop] = null; }
    }
    return results;
  },

  async saveDocs(docs) {
    try { lsSet(this.DOCS_KEY, JSON.stringify(docs)); } catch(e) {}
  },
  async saveClauses(clauses) {
    try { lsSet(this.CLAUSES_KEY, JSON.stringify(clauses)); } catch(e) {}
  },
  async saveConflicts(conflicts) {
    try { lsSet(this.CONFLICTS_KEY, JSON.stringify(conflicts)); } catch(e) {}
  },

  async clear() {
    for (const k of [this.DOCS_KEY, this.CLAUSES_KEY, this.CONFLICTS_KEY])
      try { lsDel(k); } catch(e) {}
  }
};

// KB를 storage 기반 데이터로 교체하는 함수 (앱 시작 시 실행)
async function loadDynamicKB() {
  const { clauses, conflicts } = await DocDB.load();
  if (clauses && clauses.length > 0) {
    CONTRACT_KB.clauses = clauses;
    // CLAUSE_FULLTEXT도 업데이트
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

// ─── COMPONENTS ──────────────────────────────────────────────────────────────
const RISK_COLOR  = { HIGH:"#ff2d20", MEDIUM:"#f59e0b", LOW:"#10b981" };
const RISK_BG     = { HIGH:"#2a0808", MEDIUM:"#2a1f08", LOW:"#082a14" };
const URGENCY_COL = { "즉시":"#ff2d20", "단기":"#f59e0b", "장기":"#10b981" };
const DOC_COLOR   = { SAA:"#60a5fa", OF3:"#34d399", OF4:"#a78bfa", TOS:"#f59e0b", "하도급지침":"#fb923c", "정보보호지침":"#0ea5e9", "회계규정":"#e879f9", "계약규정":"#f43f5e", "협력사선정지침":"#84cc16" };

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
      <span style={{fontSize:11,color:"#8899aa",marginLeft:4}}>분석 중...</span>
    </div>
  );
}

// Clause full text drawer (bottom panel)


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
          <span style={{display:"block",fontSize:10,color:"#c8d0dc",lineHeight:1.6}}>{info.text?.slice(0,140)}{info.text?.length>140?"…":""}</span>
          {info.context && <span style={{display:"block",fontSize:10,color:docColor+"cc",marginTop:4,lineHeight:1.5}}>{info.context.slice(0,100)}{info.context.length>100?"…":""}</span>}
          <span style={{display:"block",fontSize:9,color:"#6677aa",marginTop:6}}>{"클릭하면 전체 원문 보기"}</span>
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

  // 각 ID에 대해 여러 표기 변형 생성
  const patterns = [];
  for (const id of allIds) {
    patterns.push({ pat: id, id });
    // SAA-6.2 → SAA §6.2 / SAA§6.2 / SAA 6.2
    const m = id.match(/^(SAA|TOS|OF3|OF4|REG)-(.+)$/);
    if (m) {
      patterns.push({ pat: m[1] + " §" + m[2], id });
      patterns.push({ pat: m[1] + "§" + m[2], id });
      patterns.push({ pat: m[1] + " " + m[2], id });
      // §만 있는 경우: §6.2, §2.10
      patterns.push({ pat: "§" + m[2], id });
    }
  }
  // 긴 패턴 우선
  patterns.sort((a,b) => b.pat.length - a.pat.length);

  let segs = [{ text, matched: false }];
  for (const { pat, id } of patterns) {
    const next = [];
    for (const seg of segs) {
      if (seg.matched) { next.push(seg); continue; }
      const idx = seg.text.indexOf(pat);
      if (idx === -1) { next.push(seg); continue; }
      if (idx > 0) next.push({ text: seg.text.slice(0, idx), matched: false });
      next.push({ text: pat, matched: true, id });
      const rest = seg.text.slice(idx + pat.length);
      if (rest) next.push({ text: rest, matched: false });
    }
    segs = next;
  }

  const out = segs.map((seg, i) => {
    if (!seg.matched) return seg.text || null;
    return <ClauseInlinePopup key={i} clauseId={seg.id} onOpen={onOpen}>{seg.text}</ClauseInlinePopup>;
  }).filter(v => v !== null && v !== "");

  return out.some(v => typeof v !== "string") ? out : text;
}

function formatArgument(text, onOpen) {
  if (!text) return null;
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
        <span style={{minWidth:20,height:20,borderRadius:"50%",background:"#1e3a6e",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,color:"#60a5fa",flexShrink:0,marginTop:1}}>{m[1]}</span>
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
  return text.split("\n").map((line, i) => (
    <span key={i}>{renderBold(line)}{i < text.split("\n").length-1 && <br/>}</span>
  ));
}

function ClauseDrawer({ clauseId, onClose }) {
  const [tab, setTab] = useState("en");
  const data = CLAUSE_FULLTEXT[clauseId];
  if (!clauseId) return null;
  const docColor = DOC_COLOR[data?.doc] || "#c8d0dc";
  const hasTranslation = !!data?.translation;
  return (
    <div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:100,background:"#0a0a14",borderTop:`2px solid ${docColor}44`,boxShadow:"0 -8px 32px #00000088",maxHeight:"50vh",display:"flex",flexDirection:"column"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 20px",borderBottom:"1px solid #1a1a2e",flexShrink:0}}>
        <span style={{fontSize:10,fontWeight:700,color:docColor,background:docColor+"18",padding:"2px 8px",borderRadius:3}}>{data?.doc}</span>
        <span style={{fontSize:11,fontWeight:600,color:"#c8d0dc"}}>{data?.section}</span>
        <span style={{fontSize:12,color:"#e2e8f0",fontWeight:500}}>{data?.title}</span>
        {hasTranslation && (
          <div style={{display:"flex",gap:4,marginLeft:12}}>
            {[["en","English"],["ko","한국어"],["both","병기"]].map(([v,l])=>(
              <button key={v} onClick={()=>setTab(v)} style={{padding:"2px 10px",fontSize:10,borderRadius:3,border:"1px solid "+(tab===v?docColor:"#1e2030"),background:tab===v?docColor+"22":"none",color:tab===v?docColor:"#8899aa",cursor:"pointer",fontFamily:"inherit"}}>{l}</button>
            ))}
          </div>
        )}
        <button onClick={onClose} style={{marginLeft:"auto",background:"none",border:"1px solid #1e2030",borderRadius:4,padding:"3px 10px",fontSize:11,color:"#8899aa",cursor:"pointer",fontFamily:"inherit"}}>{"닫기 ×"}</button>
      </div>
      <div style={{overflowY:"auto",padding:"14px 20px",display:"grid",gridTemplateColumns:(tab==="both"&&hasTranslation)?"1fr 1fr 1fr":"1fr 1fr",gap:16}}>
        {(tab==="en"||tab==="both") && (
          <div>
            <div style={{fontSize:10,color:"#6677aa",letterSpacing:"0.08em",marginBottom:8}}>{"조항 원문 (English)"}</div>
            <pre style={{fontSize:11,color:"#c8d0dc",lineHeight:1.8,whiteSpace:"pre-wrap",fontFamily:"'IBM Plex Mono',monospace",margin:0,background:"#07070f",padding:"12px 14px",borderRadius:6,border:"1px solid #1a1a2e"}}>{data?.text || "원문 데이터 없음"}</pre>
          </div>
        )}
        {(tab==="ko"||tab==="both") && hasTranslation && (
          <div>
            <div style={{fontSize:10,color:"#6677aa",letterSpacing:"0.08em",marginBottom:8}}>{"한국어 번역"}</div>
            <div style={{fontSize:11,color:"#c8d0dc",lineHeight:1.9,background:"#07070f",padding:"12px 14px",borderRadius:6,border:`1px solid ${docColor}22`}}>
              {renderBoldLines(data.translation)}
            </div>
          </div>
        )}
        <div>
          <div style={{fontSize:10,color:"#6677aa",letterSpacing:"0.08em",marginBottom:8}}>분석 맥락</div>
          <div style={{fontSize:11,color:"#9aaabb",lineHeight:1.8,background:"#07070f",padding:"12px 14px",borderRadius:6,border:`1px solid ${docColor}22`}}>{data?.context || "-"}</div>
        </div>
      </div>
    </div>
  );
}

function ClauseCard({ clause, onViewFull }) {
  const urg = clause.urgency || "단기";
  const docColor = DOC_COLOR[clause.doc] || "#c8d0dc";
  const hasFullText = !!CLAUSE_FULLTEXT[clause.clause_id];
  return (
    <div style={{background:"#0a0a14",border:"1px solid #1e2035",borderRadius:6,padding:"10px 12px",marginBottom:6}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
        <span style={{fontSize:10,fontWeight:700,color:docColor,background:docColor+"18",padding:"2px 6px",borderRadius:3}}>{clause.clause_id}</span>
        <span style={{fontSize:10,color:"#c8d0dc",fontWeight:600}}>{clause.topic}</span>
        {(()=>{const kb=CONTRACT_KB.clauses.find(c=>c.id===clause.clause_id);return kb?._amended?<span style={{fontSize:8,color:"#a78bfa",background:"#a78bfa18",padding:"1px 5px",borderRadius:2,fontWeight:700}}>{"AMD"}</span>:kb?._new?<span style={{fontSize:8,color:"#10b981",background:"#10b98118",padding:"1px 5px",borderRadius:2,fontWeight:700}}>{"NEW"}</span>:null})()}
        <span style={{marginLeft:"auto",fontSize:10,color:URGENCY_COL[urg]||"#c8d0dc",background:(URGENCY_COL[urg]||"#c8d0dc")+"18",padding:"1px 6px",borderRadius:2}}>{urg}</span>
      </div>
      <div style={{fontSize:11,color:"#9aaabb",marginBottom:6}}>{clause.relevance}</div>
      <div style={{fontSize:11,color:"#c8d0dc",background:"#0f1525",padding:"6px 8px",borderRadius:4,borderLeft:`2px solid ${docColor}44`,marginBottom:8}}>{clause.kt_position}</div>
      {hasFullText && (
        <button onClick={()=>onViewFull(clause.clause_id)} style={{fontSize:10,color:docColor,background:docColor+"10",border:`1px solid ${docColor}33`,borderRadius:3,padding:"3px 10px",cursor:"pointer",fontFamily:"inherit",width:"100%"}}>
          {"조항 원문 보기"}
        </button>
      )}
    </div>
  );
}

function ActionCard({ action, index, onOpen }) {
  const colors=["#ff2d20","#f59e0b","#10b981","#60a5fa","#a78bfa"];
  const color=colors[index%colors.length];
  // clauses 필드 파싱: "SAA-6.2,TOS-8.4" → 배열
  const clauseIds = (action.clauses||"").split(",").map(s=>s.trim()).filter(s=>s && s!=="없음");
  return (
    <div style={{display:"flex",gap:10,padding:"10px 12px",background:"#0a0a14",borderRadius:6,border:`1px solid ${color}22`,marginBottom:6}}>
      <div style={{minWidth:56,textAlign:"center"}}>
        <div style={{fontSize:10,fontWeight:700,color,background:color+"18",padding:"3px 6px",borderRadius:3,marginBottom:3}}>{action.step}</div>
        <div style={{fontSize:9,color:"#6677aa"}}>{action.timeframe}</div>
      </div>
      <div style={{flex:1}}>
        <div style={{fontSize:13,color:"#c8d0dc",lineHeight:1.6,paddingTop:2,marginBottom: clauseIds.length>0?6:0}}>
          {linkifyClauses(action.action, onOpen)}
        </div>
        {clauseIds.length>0 && (
          <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
            {clauseIds.map(cid=>{
              const kb = CONTRACT_KB.clauses.find(c=>c.id===cid);
              const dc = DOC_COLOR[kb?.doc] || "#60a5fa";
              return (
                <span key={cid}
                  onClick={()=>onOpen&&onOpen(cid)}
                  style={{fontSize:9,fontWeight:700,color:dc,background:dc+"18",border:"1px solid "+dc+"44",borderRadius:3,padding:"1px 7px",cursor:"pointer",userSelect:"none"}}
                  title={kb ? kb.topic : cid}
                >
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


// ─── DOCUMENT UPLOADER ────────────────────────────────────────────────────────

// ─── DOCUMENT MANAGER TAB ─────────────────────────────────────────────────────
function DocumentManagerTab({ onKBUpdated, onAmendmentsFromUpload }) {
  const [docs,      setDocs]      = useState([]);   // 등록된 문서 목록
  const [clauses,   setClauses]   = useState(CONTRACT_KB.clauses);   // 전체 조항 (기본값: 하드코딩 KB)
  const [conflicts, setConflicts] = useState(CONTRACT_KB.conflicts); // 전체 충돌 (기본값: 하드코딩 KB)
  const [uploading, setUploading] = useState(false);
  const [checking,  setChecking]  = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [conflictStatus, setConflictStatus] = useState(null);
  const [selectedDoc, setSelectedDoc] = useState(null); // 조항 보기 패널
  const [showClauses, setShowClauses] = useState(false);
  const fileRef = useRef(null);
  const [newDocType, setNewDocType] = useState("SAA");

  // 초기 로드
  useEffect(() => {
    (async () => {
      const { docs: d, clauses: c, conflicts: cf } = await DocDB.load();
      if (d)  setDocs(d);
      if (c)  { setClauses(c);   CONTRACT_KB.clauses   = c; }
      if (cf) { setConflicts(cf); CONTRACT_KB.conflicts = cf; }
      // CLAUSE_FULLTEXT 동기화
      if (c) for (const cl of c) {
        if (cl.text) CLAUSE_FULLTEXT[cl.id] = {
          doc: cl.doc, section: cl.section||cl.id, title: cl.title||cl.topic,
          text: cl.text, translation: cl.translation||"", context: cl.context||""
        };
      }
    })();
  }, []);

  // KB 동기화 헬퍼
  const syncKB = async (newClauses, newConflicts, newDocs) => {
    const c = newClauses ?? clauses;
    const cf = newConflicts ?? conflicts;
    const d = newDocs ?? docs;
    CONTRACT_KB.clauses   = c;
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

  // ── 파일 업로드 & 조항 추출 ─────────────────────────────────────────────────
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
    setUploadStatus({ name: file.name, status: 'extracting', msg: 'AI가 조항 추출 중...' });

    try {
      // 텍스트 추출
      let textContent = null, b64 = null, isPDF = false;
      if (ext === 'pdf') {
        b64 = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result.split(',')[1]);
          r.onerror = rej;
          r.readAsDataURL(file);
        });
        isPDF = true;
      } else if (ext === 'docx' || ext === 'doc') {
        try {
          const ab = await file.arrayBuffer();
          textContent = '[DOCX: PDF로 변환 후 업로드하세요]';
        } catch(e) { textContent = '[DOCX 파싱 실패]'; }
      } else {
        textContent = await file.text();
      }

      // Claude API: 조항 추출
      const prompt = CLAUSE_EXTRACT_PROMPT(newDocType, file.name);
      const msgContent = isPDF
        ? [{ type:'document', source:{ type:'base64', media_type:'application/pdf', data:b64 }},
           { type:'text', text: prompt }]
        : prompt + '\n\n===문서 내용===\n' + (textContent||'').slice(0, 12000);

      const resp = await fetch('/api/chat', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:8000,
          messages:[{ role:'user', content: msgContent }] })
      });
      const data = await resp.json();
      const raw  = data.content?.map(c => c.text||'').join('') || '';
      let json = raw.replace(/```json|```/g,'').trim();
      // JSON이 잘린 경우 마지막 불완전 객체 제거 후 배열 닫기
      if (!json.endsWith(']')) {
        const lastComplete = json.lastIndexOf('},');
        const lastObj      = json.lastIndexOf('}');
        const cut = lastObj > lastComplete ? lastObj + 1 : lastComplete + 1;
        json = json.slice(0, cut).trimEnd().replace(/,$/, '') + ']';
      }
      // 제어문자 제거
      json = json.replace(/[ -]/g, m => m === '\n' || m === '\t' ? m : ' ');
      let extracted;
      try {
        extracted = JSON.parse(json);
      } catch(parseErr) {
        // 마지막 수단: 각 객체를 개별 파싱
        const objMatches = json.match(/\{[^{}]+\}/g) || [];
        extracted = objMatches.map(o => { try { return JSON.parse(o); } catch(e){ return null; } }).filter(Boolean);
        if (extracted.length === 0) throw new Error('JSON 파싱 실패: ' + parseErr.message);
      }

      if (!Array.isArray(extracted) || extracted.length === 0) {
        setUploadStatus({ name: file.name, status:'warn', msg:'추출된 조항 없음' });
        setUploading(false); return;
      }

      // 문서 메타 등록
      const docEntry = {
        id:        `doc_${Date.now()}`,
        fileName:  file.name,
        docType:   newDocType,
        uploadedAt: new Date().toLocaleString('ko-KR'),
        clauseCount: extracted.length,
        fileSize:  file.size,
        isAmendment: newDocType === 'AMD',
        amendedDocId: null, // Amendment인 경우 원본 문서 ID
      };

      // 기존 같은 doc 타입의 조항 처리 (Amendment면 덮어쓰기, 신규면 추가)
      let newClauses;
      if (newDocType === 'AMD') {
        // Amendment: 기존 조항 ID가 있으면 덮어쓰기
        newClauses = [...clauses];
        for (const ec of extracted) {
          const idx = newClauses.findIndex(c => c.id === ec.id);
          if (idx >= 0) {
            newClauses[idx] = { ...ec, _amended:true, _amendedBy: file.name, _prevCore: newClauses[idx].core };
          } else {
            newClauses.push({ ...ec, _new:true, _amendedBy: file.name });
          }
        }
      } else {
        // 신규 문서: 같은 문서 타입 기존 조항 제거 후 새로 추가
        const sameDocIds = docs.filter(d=>d.docType===newDocType).map(d=>d.id);
        const docsToRemove = docs.filter(d=>d.docType===newDocType&&d.id!==docEntry.id).map(d=>d.id);
        newClauses = clauses.filter(c => !docsToRemove.includes(c._docId)).concat(
          extracted.map(e => ({ ...e, _docId: docEntry.id }))
        );
      }

      const newDocs = [docEntry, ...docs.filter(d => newDocType==='AMD' ? true : d.docType !== newDocType)];
      const newConflicts = conflicts; // 충돌은 별도로 재검토

      setClauses(newClauses);
      setDocs(newDocs);
      await syncKB(newClauses, newConflicts, newDocs);

      setUploadStatus({ name: file.name, status:'ok',
        msg: `${extracted.length}개 조항 추출 완료${newDocType==='AMD'?' — 충돌 재검토 권장':''}` });

      // Amendment: patchHistory에 변경 이력 기록
      if (newDocType === 'AMD') {
        const ts = new Date().toLocaleString('ko-KR');
        // extracted 조항을 patches 형태로 변환
        const amdPatches = extracted.map(ec => {
          const prev = clauses.find(c => c.id === ec.id);
          return {
            clauseId:   ec.id,
            changeType: prev ? '수정' : '추가',
            prevCore:   prev?.core || null,
            newCore:    ec.core,
            topic:      ec.topic,
            amendedBy:  `${file.name} (${ts})`,
          };
        });
        const amdEntry = {
          id:            Date.now(),
          fileName:      file.name,
          uploadedAt:    ts,
          docType:       'Amendment',
          effectiveDate: null,
          summary:       `${file.name} 업로드 — ${amdPatches.length}개 조항 변경`,
          patches:       amdPatches,
        };
        // kb_patches_v1 로드 → 앞에 추가 → 저장
        try {
          const stored = lsGet('kb_patches_v1');
          const existing = stored ? JSON.parse(stored) : [];
          const nextPatches = [amdEntry, ...existing].slice(0, 30);
          lsSet('kb_patches_v1', JSON.stringify(nextPatches));
          // 부모 컴포넌트(amendments state) 갱신
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
        } catch(e) { console.warn('patchHistory 저장 실패:', e); }

        // 자동 충돌 재검토
        await runConflictCheck(newClauses);
      }

    } catch(e) {
      console.error(e);
      setUploadStatus({ name: file.name, status:'error', msg:'실패: '+e.message });
    }
    setUploading(false);
  };

  // ── 충돌 재검토 ──────────────────────────────────────────────────────────────
  const runConflictCheck = async (clausesToCheck) => {
    const cl = clausesToCheck || clauses;
    if (cl.length === 0) {
      setConflictStatus({ status:'warn', msg:'조항이 없습니다' });
      return;
    }
    setChecking(true);
    setConflictStatus({ status:'running', msg:`${cl.length}개 조항 충돌 검토 중...` });

    try {
      const resp = await fetch('/api/chat', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:3000,
          messages:[{ role:'user', content: CONFLICT_CHECK_PROMPT(cl) }] })
      });
      const data = await resp.json();
      const raw  = data.content?.map(c=>c.text||'').join('') || '';
      let json = raw.replace(/```json|```/g,'').trim();
      if (!json.endsWith(']')) {
        const lastObj = json.lastIndexOf('}');
        json = lastObj > 0 ? json.slice(0, lastObj+1).replace(/,$/, '') + ']' : '[]';
      }
      const cs = json.indexOf('['), ce = json.lastIndexOf(']');
      if (cs !== -1 && ce > cs) json = json.slice(cs, ce+1);
      json = json.replace(/[\x00-\x1f]/g, m => (m==='\n'||m==='\t') ? ' ' : '');
      let newConflicts;
      try {
        newConflicts = JSON.parse(json);
      } catch(e) {
        const objs = json.match(/\{[^{}]+\}/g)||[];
        newConflicts = objs.map(o=>{try{return JSON.parse(o);}catch(e){return null;}}).filter(Boolean);
        if (newConflicts.length===0) throw new Error('충돌 JSON 파싱 실패: '+e.message);
      }

      CONTRACT_KB.conflicts = newConflicts;
      setConflicts(newConflicts);
      await DocDB.saveConflicts(newConflicts);
      // clauses state 최신값과 함께 동기화
      if (onKBUpdated) onKBUpdated({ docs, clauses: cl, conflicts: newConflicts });

      setConflictStatus({ status:'ok',
        msg: newConflicts.length > 0
          ? `${newConflicts.length}개 충돌 발견`
          : '충돌 없음' });
    } catch(e) {
      setConflictStatus({ status:'error', msg:'충돌 검토 실패: '+e.message });
    }
    setChecking(false);
  };

  // ── 문서 삭제 ─────────────────────────────────────────────────────────────
   const deleteDoc = async (docId) => {
     const doc = docs.find(d=>d.id===docId);
     if (!doc) return;
     if (!window.confirm(doc.fileName + ' 삭제 시 관련 조항도 제거됩니다. 계속?')) return;
     const newDocs    = docs.filter(d=>d.id!==docId);
     const newClauses = clauses.filter(c=>c._docId!==docId && c._amendedBy!==doc.fileName);
     setDocs(newDocs);
     setClauses(newClauses);
     if (selectedDoc?.id===docId) setSelectedDoc(null);
     await syncKB(newClauses, conflicts, newDocs);
     if (newClauses.length > 0) {
       await runConflictCheck(newClauses);
     } else {
       setConflicts([]);
       CONTRACT_KB.conflicts = [];
       await DocDB.saveConflicts([]);
       if (onKBUpdated) onKBUpdated({ docs: newDocs, clauses: [], conflicts: [] });
     }
   };

  // ── 전체 초기화 ───────────────────────────────────────────────────────────
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

  // 문서별 조항 보기
  const docClauses = selectedDoc ? clauses.filter(c=>c._docId===selectedDoc.id || c._amendedBy===selectedDoc.fileName) : [];

  // 문서 타입 한국어 정의
  const DOC_TYPE_KO = {
    SAA:   { name:"전략적 제휴 계약서",  short:"SAA",        color:"#60a5fa", desc:"Palantir Korea와 KT 간 기본 계약" },
    TOS:   { name:"서비스 이용약관",     short:"TOS",        color:"#f59e0b", desc:"플랫폼 이용 조건 및 책임 규정" },
    OF:    { name:"주문서 (Order Form)", short:"OF",         color:"#a78bfa", desc:"OF3(인에이블먼트), OF4(플랫폼 라이선스) 등" },
    REG:   { name:"사내 규정",           short:"내규",       color:"#34d399", desc:"KT 내부 규정 (하도급, 회계, 정보보호 등)" },
    AMD:   { name:"계약 변경서",         short:"Amendment",  color:"#fb923c", desc:"기존 계약 조항의 수정·추가·삭제" },
    NEW:   { name:"신규 계약서",         short:"신규",       color:"#e879f9", desc:"신규 체결 계약" },
    OTHER: { name:"기타 문서",           short:"기타",       color:"#8899aa", desc:"기타 참고 문서" },
  };

  const [showUploadPanel, setShowUploadPanel] = useState(false);
  const [rightView, setRightView] = useState('conflicts'); // 'clauses' | 'conflicts'

  const totalAmended = clauses.filter(c=>c._amended).length;
  const highConflicts = conflicts.filter(c=>c.risk==='HIGH').length;

  return (
    <div style={{display:'grid', gridTemplateColumns:'300px 1fr', height:'100%', overflow:'hidden'}}>

      {/* ── 왼쪽 패널 ── */}
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
                <div style={{fontSize:9, color:'#475569', marginBottom:3}}>{s.label}</div>
                <div style={{fontSize:13, fontWeight:700, color:s.color, marginBottom:2}}>{s.value}</div>
                <div style={{fontSize:8, color:'#6677aa'}}>{s.sub}</div>
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
              <div style={{fontSize:9, color:'#6677aa', marginBottom:6}}>문서 종류 선택</div>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:4, marginBottom:10}}>
                {Object.entries(DOC_TYPE_KO).map(([k,v]) => (
                  <button key={k} onClick={()=>setNewDocType(k)}
                    style={{padding:'6px 8px', borderRadius:4, border:`1px solid ${newDocType===k?v.color+'88':'#1e2030'}`,
                      background:newDocType===k?v.color+'15':'#0f0f1a', cursor:'pointer', fontFamily:'inherit', textAlign:'left'}}>
                    <div style={{fontSize:10, fontWeight:700, color:newDocType===k?v.color:'#8899aa'}}>{v.short}</div>
                    <div style={{fontSize:8, color:'#475569', marginTop:1, lineHeight:1.3}}>{v.desc}</div>
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
                      <div style={{fontSize:20, marginBottom:4}}>📄</div>
                      <div style={{fontSize:11, color:'#8899aa', marginBottom:2}}>
                        파일을 여기에 끌어다 놓거나 클릭
                      </div>
                      <div style={{fontSize:9, color:'#475569'}}>PDF · DOCX · TXT 지원</div>
                    </>
                }
              </div>
              <input ref={fileRef} type='file' multiple accept='.pdf,.docx,.doc,.txt'
                style={{display:'none'}} onChange={e=>handleUpload(e.target.files)}/>
              {uploadStatus && (
                <div style={{marginTop:6, padding:'6px 8px', borderRadius:4,
                  background:statusColor(uploadStatus.status)+'10',
                  border:`1px solid ${statusColor(uploadStatus.status)}33`}}>
                  <div style={{fontSize:9, color:statusColor(uploadStatus.status), fontWeight:600, marginBottom:1}}>{uploadStatus.name}</div>
                  <div style={{fontSize:9, color:statusColor(uploadStatus.status)}}>{uploadStatus.msg}</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 충돌 재검토 버튼 */}
        <div style={{padding:'8px 16px', borderBottom:'1px solid #1a1a2e'}}>
          <button onClick={()=>runConflictCheck()} disabled={checking}
            style={{width:'100%', padding:'6px', borderRadius:4, border:`1px solid ${checking?'#1e2030':'#a78bfa44'}`,
              background:checking?'#0f1525':'#1a1040', color:checking?'#6677aa':'#a78bfa',
              fontSize:10, fontWeight:600, cursor:checking?'not-allowed':'pointer', fontFamily:'inherit'}}>
            {checking ? '⏳ 충돌 검토 중...' : '🔍 조항 간 충돌 재검토'}
          </button>
          {conflictStatus && (
            <div style={{marginTop:4, fontSize:9, color:statusColor(conflictStatus.status), textAlign:'center'}}>
              {conflictStatus.msg}
            </div>
          )}
        </div>

        {/* 문서 목록 */}
        <div style={{flex:1, overflowY:'auto', padding:'10px 16px'}}>

          {/* 기본 제공 문서 */}
          {(() => {
            // CONTRACT_KB에서 문서별로 그룹핑
            const builtinGroups = {};
            for (const c of CONTRACT_KB.clauses) {
              const docKey = c.doc || 'OTHER';
              if (!builtinGroups[docKey]) builtinGroups[docKey] = [];
              builtinGroups[docKey].push(c);
            }
            const builtinDocs = [
              { key:'SAA',      label:'전략적 제휴 계약서 (SAA)',      color:'#60a5fa', desc:'Palantir Korea ↔ KT 기본 계약' },
              { key:'TOS',      label:'서비스 이용약관 (TOS)',          color:'#f59e0b', desc:'플랫폼 이용 조건 및 책임' },
              { key:'OF3',      label:'주문서 3 (인에이블먼트)',        color:'#a78bfa', desc:'$9M 교육 프로그램, Non-Solicitation' },
              { key:'OF4',      label:'주문서 4 (플랫폼 라이선스)',     color:'#a78bfa', desc:'$27M 5년 라이선스, Azure 클라우드' },
              { key:'하도급지침',  label:'하도급 지침',                color:'#fb923c', desc:'KT 내규 — 대금 지급 기한 등' },
              { key:'정보보호지침',label:'정보보호 지침',               color:'#0ea5e9', desc:'KT 내규 — CISO 승인, 가급 자산' },
              { key:'회계규정',   label:'회계 규정',                   color:'#e879f9', desc:'KT 내규 — 예산 집행 원칙' },
              { key:'계약규정',   label:'계약 규정',                   color:'#f43f5e', desc:'KT 내규 — 계약서 필수 기재사항' },
              { key:'협력사선정지침',label:'협력사 선정 지침',          color:'#84cc16', desc:'KT 내규 — 협력사 등록 요건' },
            ];
            return (
              <>
                <div style={{fontSize:9, color:'#475569', marginBottom:8, display:'flex', alignItems:'center', gap:6}}>
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
                      onClick={()=>{ setSelectedDoc(isSelected?null:fakeDoc); setRightView('clauses'); }}
                      style={{marginBottom:5, borderRadius:5, padding:'8px 10px', cursor:'pointer',
                        border:`1px solid ${isSelected?bd.color+'55':'#1e2030'}`,
                        background:isSelected?bd.color+'0a':'#0f0f1a'}}>
                      <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:2}}>
                        <span style={{fontSize:9, fontWeight:700, color:bd.color,
                          background:bd.color+'18', padding:'1px 5px', borderRadius:2}}>내장</span>
                        <span style={{fontSize:10, color:'#c8d0dc', flex:1, fontWeight:500}}>{bd.label}</span>
                        <span style={{fontSize:9, color:'#475569'}}>{groupClauses.length}개</span>
                      </div>
                      <div style={{fontSize:9, color:'#475569'}}>{bd.desc}</div>
                    </div>
                  );
                })}
              </>
            );
          })()}

          {/* 업로드한 문서 */}
          {docs.length > 0 && (
            <>
              <div style={{fontSize:9, color:'#475569', margin:'14px 0 8px', display:'flex', alignItems:'center', gap:6}}>
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
                      <span style={{fontSize:9, fontWeight:700, color:tc.color,
                        background:tc.color+'18', padding:'1px 5px', borderRadius:2}}>{tc.short}</span>
                      <span style={{fontSize:10, color:'#c8d0dc', flex:1, overflow:'hidden',
                        textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{d.fileName}</span>
                      <button onClick={e=>{e.stopPropagation();deleteDoc(d.id);}}
                        style={{background:'none',border:'none',color:'#475569',cursor:'pointer',
                          fontSize:14,padding:'0 2px',fontFamily:'inherit',lineHeight:1}}>×</button>
                    </div>
                    <div style={{display:'flex', gap:8, fontSize:9, color:'#475569'}}>
                      <span>조항 {dClauses.length}개</span>
                      <span>{fmt(d.fileSize)}</span>
                      {d.isAmendment && <span style={{color:'#fb923c'}}>⚡ 변경서</span>}
                    </div>
                  </div>
                );
              })}
              <button onClick={resetToOriginal}
                style={{width:'100%', marginTop:8, fontSize:9, color:'#475569', background:'none',
                  border:'1px solid #1e2030', borderRadius:3, padding:'5px', cursor:'pointer', fontFamily:'inherit'}}>
                업로드 전체 초기화
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── 오른쪽 패널 ── */}
      <div style={{display:'flex', flexDirection:'column', overflow:'hidden'}}>

        {/* 뷰 전환 탭 */}
        <div style={{display:'flex', borderBottom:'1px solid #1a1a2e', background:'#0a0a14', padding:'0 16px', gap:16}}>
          {[
            ['conflicts', `충돌 현황`, conflicts.length],
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
              <span style={{marginLeft:5, fontSize:9, color:'#475569'}}>{count}개</span>
            </button>
          ))}
          {selectedDoc && (
            <span onClick={()=>setSelectedDoc(null)}
              style={{marginLeft:'auto', alignSelf:'center', fontSize:9, color:'#6677aa', cursor:'pointer', padding:'4px 8px',
                background:'#0f0f1a', borderRadius:3, border:'1px solid #1e2030'}}>
              × 전체 보기
            </span>
          )}
        </div>

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
                    총 {conflicts.length}건의 조항 간 충돌이 탐지되었습니다.
                    {highConflicts > 0 && <span style={{color:'#ff2d20', marginLeft:6}}>HIGH {highConflicts}건 즉시 검토 필요</span>}
                  </div>
                  {conflicts.map((cf,i) => {
                    const rc = RISK_COLOR[cf.risk]||'#8899aa';
                    return (
                      <div key={cf.id||i} style={{marginBottom:8, padding:'10px 12px', borderRadius:5,
                        border:`1px solid ${rc}33`, background:rc+'08'}}>
                        <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:5}}>
                          <span style={{fontSize:9, fontWeight:700, color:rc, background:rc+'18', padding:'1px 6px', borderRadius:2}}>{cf.id}</span>
                          <span style={{fontSize:10, color:'#c8d0dc', fontWeight:600, flex:1}}>{cf.topic}</span>
                          <span style={{fontSize:9, fontWeight:700, color:rc,
                            background:rc+'18', padding:'2px 7px', borderRadius:3}}>{cf.risk}</span>
                        </div>
                        <div style={{fontSize:10, color:'#9aaabb', lineHeight:1.6}}>{cf.summary}</div>
                        {cf.clauseIds && cf.clauseIds.length > 0 && (
                          <div style={{marginTop:5, display:'flex', gap:4, flexWrap:'wrap'}}>
                            {cf.clauseIds.map(id=>(
                              <span key={id} style={{fontSize:8, color:'#60a5fa', background:'#60a5fa18',
                                padding:'1px 5px', borderRadius:2}}>{id}</span>
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
                        <span style={{fontSize:9, fontWeight:700, color:dc, background:dc+'18',
                          padding:'1px 6px', borderRadius:2}}>{c.id}</span>
                        <span style={{fontSize:10, color:'#c8d0dc', fontWeight:600, flex:1}}>{c.topic}</span>
                        {c._amended && <span style={{fontSize:8, color:'#fb923c', background:'#fb923c18',
                          padding:'1px 5px', borderRadius:2, fontWeight:700}}>수정됨</span>}
                        {c._new && <span style={{fontSize:8, color:'#10b981', background:'#10b98118',
                          padding:'1px 5px', borderRadius:2, fontWeight:700}}>신규</span>}
                      </div>
                      <div style={{fontSize:10, color:'#9aaabb', lineHeight:1.6}}>{c.core}</div>
                      {c._prevCore && (
                        <div style={{marginTop:5, fontSize:9, color:'#475569', textDecoration:'line-through',
                          borderTop:'1px solid #1e2030', paddingTop:4}}>
                          이전: {c._prevCore}
                        </div>
                      )}
                      {c._amendedBy && (
                        <div style={{marginTop:3, fontSize:8, color:'#fb923c66'}}>변경 출처: {c._amendedBy}</div>
                      )}
                    </div>
                  );
                });
          })()}

        </div>
      </div>
    </div>
  );
}

// ─── AMENDMENT MANAGER ───────────────────────────────────────────────────────

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
      "newTranslation": "변경된 한국어 번역 (없으면 null)",
      "newContext": "변경 맥락 및 KT 영향 분석 (한국어)",
      "deletionReason": "삭제 이유 (삭제 시만)",
      "newConflicts": [{"id":"XC-NEW-001","risk":"HIGH|MEDIUM|LOW","topic":"충돌주제","summary":"충돌요약"}]
    }
  ]
}

기존 조항 ID 목록(참고): SAA-1.3.1, SAA-1.3.2, SAA-1.6.8, SAA-2.10, SAA-2.11, SAA-6.2, SAA-6.3, SAA-8.2, SAA-9.0, OF3-FEES, OF4-FEES, OF4-CLOUD, TOS-7, TOS-8.2, TOS-8.4, TOS-12, TOS-13`;

// ─── KB AMENDMENT MANAGER ─────────────────────────────────────────────────────
function AmendmentManager({ onAmendmentsChange }) {
  const [patchHistory, setPatchHistory] = useState([]);
  const [expanded, setExpanded]     = useState(false);
  const [parsing, setParsing]       = useState(false);
  const [parseStatus, setParseStatus] = useState(null);
  const fileRef = useRef(null);

  // 앱 시작 시 저장된 패치 로드
  useEffect(() => {
    (async () => {
      try {
        const s = lsGet("kb_patches_v1");
        if (s?.value) {
          const history = JSON.parse(s.value);
          setPatchHistory(history);
          // amendments 형식으로 변환해서 상위 컴포넌트에 전달
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
      lsSet("kb_patches_v1", JSON.stringify(history));
    } catch(e) { console.error("patch save error", e); }
  };

  const parseAndApply = async (file) => {
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["pdf","docx","doc","txt"].includes(ext)) return;
    setParsing(true);
    setParseStatus({ name: file.name, status: "parsing", msg: "AI가 조항 변경사항 추출 중..." });

    try {
      // 텍스트/바이너리 추출
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
          const ab = await file.arrayBuffer();
          textContent = "[DOCX: PDF로 변환 후 업로드하세요]";
        } catch(e) { textContent = "[DOCX 파싱 실패]"; }
        b64 = btoa(unescape(encodeURIComponent(textContent || "")));
      } else {
        textContent = await file.text();
        b64 = btoa(unescape(encodeURIComponent(textContent)));
      }

      // Claude API: 구조화 파싱
      const msgContent = (b64 && mediaType === "application/pdf")
        ? [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
            { type: "text", text: AMENDMENT_PARSE_PROMPT }
          ]
        : AMENDMENT_PARSE_PROMPT + "\n\n===문서 내용===\n" + (textContent || "").slice(0, 10000);

      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 3000,
          messages: [{ role: "user", content: msgContent }] })
      });
      const data = await resp.json();
      const raw  = data.content?.map(c => c.text || "").join("") || "";
      const jsonStr = raw.replace(/```json|```/g, "").trim();
      let parsed;
      try {
        parsed = JSON.parse(jsonStr);
      } catch(e) {
        // 잘린 JSON 복구 시도
        const cut = jsonStr.lastIndexOf('}');
        const fixed = cut > 0 ? jsonStr.slice(0, cut+1) + (jsonStr.trim().startsWith('{') ? '' : '') : jsonStr;
        try { parsed = JSON.parse(fixed); } catch(e2) { throw new Error('Amendment JSON 파싱 실패: ' + e.message); }
      }

      if (!parsed.patches || parsed.patches.length === 0) {
        setParseStatus({ name: file.name, status: "warn", msg: "변경된 조항 없음 — 신규 계약서로 등록" });
        setParsing(false);
        return;
      }

      // 각 patch에 출처 정보 추가
      const ts = new Date().toLocaleString("ko-KR");
      const amendedBy = `${file.name} (${ts})`;
      const patches = parsed.patches.map(p => ({ ...p, amendedBy }));

      // KB에 직접 적용
      applyPatchesToKB(patches);

      // 이력 저장
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

      // 상위 컴포넌트 갱신
      onAmendmentsChange(nextHistory.map(h => ({
        id: h.id, fileName: h.fileName, docType: h.docType,
        effectiveDate: h.effectiveDate, summary: h.summary,
        uploadedAt: h.uploadedAt,
        changes: h.patches.map(p => ({ clauseId: p.clauseId, changeType: p.changeType, newText: p.newCore, prevCore: p.prevCore, topic: p.topic }))
      })));

      setParseStatus({ name: file.name, status: "ok", msg: `KB 업데이트 완료 — ${patches.length}개 조항 반영` });

    } catch(e) {
      console.error(e);
      setParseStatus({ name: file.name, status: "error", msg: "실패: " + e.message });
    }
    setParsing(false);
  };

  const removeEntry = async (id) => {
    // 제거 후 KB를 초기화하고 남은 패치를 재적용
    // (KB를 직접 수정하므로 전체 재적용 필요 — 페이지 새로고침 안내)
    const next = patchHistory.filter(h => h.id !== id);
    setPatchHistory(next);
    onAmendmentsChange(next.map(h => ({
      id: h.id, fileName: h.fileName, docType: h.docType,
      effectiveDate: h.effectiveDate, summary: h.summary,
      uploadedAt: h.uploadedAt,
        changes: h.patches.map(p => ({ clauseId: p.clauseId, changeType: p.changeType, newText: p.newCore, prevCore: p.prevCore, topic: p.topic }))
    })));
    await savePatchHistory(next);
    // KB 재적용을 위해 페이지 새로고침 권장
    if (next.length < patchHistory.length) {
      alert("변경사항이 제거되었습니다. KB를 재적용하려면 페이지를 새로고침하세요.");
    }
  };

  const clearAll = async () => {
    setPatchHistory([]);
    onAmendmentsChange([]);
    try { lsDel("kb_patches_v1"); } catch(e) {}
    alert("모든 Amendment가 초기화되었습니다. 페이지를 새로고침하면 원본 KB로 복원됩니다.");
  };

  const typeColor = { Amendment:"#a78bfa", NewContract:"#60a5fa", OrderForm:"#10b981", Other:"#8899aa" };
  const impColor  = { HIGH:"#ff2d20", MEDIUM:"#f59e0b", LOW:"#10b981" };
  const chgColor  = { 수정:"#60a5fa", 삭제:"#ff2d20", 추가:"#10b981", 대체:"#f59e0b" };
  const totalPatches = patchHistory.reduce((s, h) => s + (h.patches?.length||0), 0);

  return (
    <div style={{border:"1px solid #1e2030",borderRadius:6,overflow:"hidden",marginBottom:8}}>
      <div onClick={()=>setExpanded(!expanded)}
        style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",background:"#0a0a14",cursor:"pointer",userSelect:"none"}}>
        <div style={{width:5,height:5,borderRadius:"50%",background:patchHistory.length>0?"#a78bfa":"#1e2030"}}/>
        <span style={{fontSize:11,color:patchHistory.length>0?"#c8d0dc":"#8899aa",flex:1}}>
          {"Amendment / 계약 변경"}
          {patchHistory.length > 0 && (
            <span style={{fontSize:10,color:"#a78bfa",marginLeft:6}}>
              {patchHistory.length}건 · KB {totalPatches}개 조항 수정됨
            </span>
          )}
        </span>
        <span style={{fontSize:10,color:"#6677aa"}}>{expanded?"▲":"▼"}</span>
      </div>

      {expanded && (
        <div style={{background:"#07070f",borderTop:"1px solid #1a1a2e"}}>
          {/* 업로드 영역 */}
          <div style={{padding:"10px 12px",borderBottom:"1px solid #0f0f20"}}>
            <div
              onClick={()=>!parsing&&fileRef.current?.click()}
              onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor="#a78bfa";}}
              onDragLeave={e=>{e.currentTarget.style.borderColor="#1e2030";}}
              onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor="#1e2030";if(!parsing)Array.from(e.dataTransfer.files).forEach(parseAndApply);}}
              style={{border:"1px dashed #1e2030",borderRadius:5,padding:"12px",textAlign:"center",cursor:parsing?"not-allowed":"pointer",transition:"border-color 0.15s",opacity:parsing?0.6:1}}
            >
              {parsing
                ? <div style={{fontSize:11,color:"#a78bfa"}}>{"⏳ AI가 조항 변경사항을 추출하는 중..."}</div>
                : <>
                    <div style={{fontSize:11,color:"#8899aa",marginBottom:3}}>{"PDF · DOCX · TXT"}</div>
                    <div style={{fontSize:10,color:"#6677aa"}}>{"업로드 시 AI가 자동으로 KB 조항을 업데이트하고 영구 저장합니다"}</div>
                  </>
              }
            </div>
            <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.doc,.txt"
              style={{display:"none"}} onChange={e=>Array.from(e.target.files).forEach(parseAndApply)}/>
            {parseStatus && (
              <div style={{marginTop:6,padding:"5px 8px",borderRadius:4,
                background:parseStatus.status==="ok"?"#0a2a1a":parseStatus.status==="error"?"#2a0a0a":parseStatus.status==="warn"?"#1a1a08":"#0f1525",
                border:`1px solid ${parseStatus.status==="ok"?"#10b98133":parseStatus.status==="error"?"#ff2d2033":parseStatus.status==="warn"?"#f59e0b33":"#60a5fa33"}`}}>
                <span style={{fontSize:9,color:parseStatus.status==="ok"?"#10b981":parseStatus.status==="error"?"#ff2d20":parseStatus.status==="warn"?"#f59e0b":"#60a5fa"}}>
                  {parseStatus.status==="ok"?"✓":parseStatus.status==="error"?"✗":parseStatus.status==="warn"?"⚠":"⏳"}{" "}{parseStatus.name}: {parseStatus.msg}
                </span>
              </div>
            )}
          </div>

          {/* 패치 이력 */}
          {patchHistory.length === 0
            ? <div style={{padding:"14px",fontSize:10,color:"#6677aa",textAlign:"center",lineHeight:1.7}}>
                {"Amendment를 업로드하면 AI가 조항 변경사항을 추출하여"}<br/>
                {"CONTRACT_KB를 직접 업데이트하고 storage에 영구 저장합니다"}
              </div>
            : <div style={{maxHeight:360,overflowY:"auto"}}>
                {patchHistory.map(h => (
                  <div key={h.id} style={{padding:"10px 12px",borderBottom:"1px solid #0f0f20"}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5}}>
                      <span style={{fontSize:9,fontWeight:700,color:typeColor[h.docType]||"#8899aa",background:(typeColor[h.docType]||"#8899aa")+"18",padding:"1px 6px",borderRadius:2}}>{h.docType}</span>
                      <span style={{fontSize:10,color:"#c8d0dc",fontWeight:600,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h.fileName}</span>
                      {h.effectiveDate && <span style={{fontSize:9,color:"#6677aa",whiteSpace:"nowrap"}}>{h.effectiveDate}</span>}
                      <button onClick={()=>removeEntry(h.id)} style={{background:"none",border:"none",color:"#6677aa",cursor:"pointer",fontSize:12,padding:"0 2px",fontFamily:"inherit"}}>{"×"}</button>
                    </div>
                    <div style={{fontSize:10,color:"#9aaabb",marginBottom:5,lineHeight:1.5}}>{h.summary}</div>
                    {(h.patches||[]).map((p,i)=>(
                      <div key={i} style={{display:"flex",gap:5,alignItems:"flex-start",marginBottom:3,padding:"4px 6px",background:"#0a0a14",borderRadius:3,borderLeft:`2px solid ${chgColor[p.changeType]||"#8899aa"}`}}>
                        <span style={{fontSize:9,fontWeight:700,color:"#60a5fa",whiteSpace:"nowrap",minWidth:90}}>{p.clauseId}</span>
                        <span style={{fontSize:9,color:chgColor[p.changeType]||"#8899aa",whiteSpace:"nowrap",minWidth:28}}>{p.changeType}</span>
                        <span style={{fontSize:9,color:"#9aaabb",lineHeight:1.4}}>{p.newCore||p.newTopic||""}</span>
                      </div>
                    ))}
                  </div>
                ))}
                <div style={{padding:"8px 12px"}}>
                  <button onClick={clearAll} style={{fontSize:10,color:"#6677aa",background:"none",border:"1px solid #1e2030",borderRadius:3,padding:"3px 10px",cursor:"pointer",fontFamily:"inherit",width:"100%"}}>
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

// Follow-up chat component
function FollowupChat({ result, mode, amendments=[] }) {
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
          model:"claude-sonnet-4-6",
          max_tokens:1000,
          system: buildFollowupPrompt(mode, result, messages, amendments),
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
    <div style={{background:"#0a0a14",border:"1px solid #1e2030",borderRadius:8,overflow:"hidden"}}>
      <div style={{padding:"10px 14px",borderBottom:"1px solid #1a1a2e",display:"flex",alignItems:"center",gap:8}}>
        <div style={{width:6,height:6,borderRadius:"50%",background:"#60a5fa",boxShadow:"0 0 6px #60a5fa"}}/>
        <span style={{fontSize:11,color:"#8899aa",letterSpacing:"0.08em"}}>후속 질문</span>
        <span style={{fontSize:10,color:"#475569"}}>{"어떤 탭에서든 분석 내용에 대해 자유롭게 질문하세요"}</span>
      </div>
      {messages.length > 0 && (
        <div style={{maxHeight:280,overflowY:"auto",padding:"12px 14px",display:"flex",flexDirection:"column",gap:8}}>
          {messages.map((m,i)=>(
            <div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
              <div style={{maxWidth:"85%",padding:"8px 12px",borderRadius:6,background:m.role==="user"?"#0f1e35":"#0f0f1a",border:`1px solid ${m.role==="user"?"#1e3a5f":"#1e2030"}`,fontSize:13,color:"#c8d0dc",lineHeight:1.7,whiteSpace:"pre-wrap"}}>
                {m.content}
              </div>
            </div>
          ))}
          {loading && <div style={{display:"flex",justifyContent:"flex-start"}}><div style={{background:"#0f0f1a",border:"1px solid #1e2030",borderRadius:6,padding:"4px 8px"}}><TypingDots/></div></div>}
          <div ref={bottomRef}/>
        </div>
      )}
      <div style={{padding:"10px 12px",borderTop: messages.length>0 ? "1px solid #1a1a2e" : "none",display:"flex",gap:8}}>
        <input
          value={input}
          onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&send()}
          placeholder="이 분석에 대해 추가 질문..."
          style={{flex:1,background:"#07070f",border:"1px solid #1e2030",borderRadius:4,padding:"7px 10px",fontSize:11,color:"#e2e8f0",fontFamily:"inherit",outline:"none"}}
        />
        <button onClick={send} disabled={!input.trim()||loading} style={{padding:"7px 14px",background:input.trim()&&!loading?"#1e3a6e":"#0f1525",border:`1px solid ${input.trim()&&!loading?"#60a5fa44":"#1e2030"}`,borderRadius:4,fontSize:11,color:input.trim()&&!loading?"#60a5fa":"#6677aa",cursor:input.trim()&&!loading?"pointer":"not-allowed",fontFamily:"inherit"}}>
          전송
        </button>
      </div>
    </div>
  );
}



function AnalysisResult({ result, query, mode, amendments=[] }) {
  const [activeSection, setActiveSection] = useState("overview");
  const [viewingClause, setViewingClause] = useState(null);
  const riskColor = RISK_COLOR[result.risk_level] || "#10b981";
  const riskBg    = RISK_BG[result.risk_level]    || "#082a14";

  const sections = [
    {id:"overview", label:"개요"},
    {id:"clauses",  label:`관련 조항 (${result.triggered_clauses?.length||0})`},
    {id:"analysis", label:"법적 분석"},
    {id:"actions",  label:`조치 (${result.immediate_actions?.length||0})`},
  ];

  return (
    <>
      <div style={{background:"#0d0d1a",border:`1px solid ${riskColor}33`,borderRadius:10,overflow:"hidden",marginBottom: viewingClause ? "46vh" : 0}}>
        {/* HEADER */}
        <div style={{background:riskBg,padding:"14px 18px",borderBottom:`1px solid ${riskColor}22`}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
            <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 10px",background:riskColor+"22",border:`1px solid ${riskColor}44`,borderRadius:4}}>
              <div style={{width:6,height:6,borderRadius:"50%",background:riskColor,boxShadow:`0 0 6px ${riskColor}`}}/>
              <span style={{fontSize:12,fontWeight:700,color:riskColor,letterSpacing:"0.1em"}}>{result.risk_level} RISK</span>
            </div>
            <span style={{fontSize:11,color:"#8899aa"}}>{result.triggered_clauses?.length||0}개 조항 · {result.related_conflicts?.length||0}개 충돌 연결</span>
          </div>
          <div style={{fontSize:14,color:"#f0f4f8",fontWeight:500,lineHeight:1.5}}>{result.situation_summary}</div>
        </div>
        {/* TABS */}
        <div style={{display:"flex",borderBottom:"1px solid #1a1a2e",background:"#0a0a14"}}>
          {sections.map(s=>(
            <button key={s.id} onClick={()=>setActiveSection(s.id)} style={{padding:"8px 14px",border:"none",background:"none",cursor:"pointer",fontSize:11,color:activeSection===s.id?"#e2e8f0":"#8899aa",borderBottom:activeSection===s.id?"2px solid #60a5fa":"2px solid transparent",fontFamily:"inherit",transition:"all 0.12s"}}>
              {s.id==="chat" ? <span style={{color:activeSection==="chat"?"#60a5fa":"#2d5a8a"}}>💬 {s.label}</span> : s.label}
            </button>
          ))}
        </div>
        <div style={{padding:16}}>
          {/* OVERVIEW */}
          {activeSection==="overview" && (
            <div>
              <div style={{padding:"10px 14px",background:"#0a0a0f",borderRadius:6,borderLeft:`3px solid ${riskColor}`,marginBottom:12}}>
                <div style={{fontSize:11,color:"#8899aa",marginBottom:4,letterSpacing:"0.08em"}}>BOTTOM LINE</div>
                <div style={{fontSize:14,color:"#f0f4f8",fontWeight:500,lineHeight:1.6}}>{result.bottom_line}</div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                <div style={{background:"#0a1020",border:"1px solid #1e3050",borderRadius:6,padding:12}}>
                  <div style={{fontSize:11,color:"#60a5fa",marginBottom:8,fontWeight:700}}>KT 방어 논거</div>
                  <div style={{fontSize:13,color:"#c8d0dc",lineHeight:1.7}}>{formatArgument(result.kt_defense, setViewingClause)}</div>
                </div>
                <div style={{background:"#100a0a",border:"1px solid #3f1515",borderRadius:6,padding:12}}>
                  <div style={{fontSize:11,color:"#ff2d20",marginBottom:8,fontWeight:700}}>Palantir 측 논거</div>
                  <div style={{fontSize:13,color:"#c8d0dc",lineHeight:1.7}}>{formatArgument(result.palantir_position, setViewingClause)}</div>
                </div>
              </div>
              {result.related_conflicts?.length>0 && (
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
                    <div style={{fontSize:10,color:"#8899aa"}}>연결된 기존 충돌</div>
                    <span title="이번 이슈가 시스템에 등록된 기존 충돌(XC/IC/EC) 중 어떤 것과 관련있는지 AI가 판단한 결과입니다." style={{fontSize:9,color:"#60a5fa",background:"#0f1e35",border:"1px solid #1e3a6e",borderRadius:"50%",width:14,height:14,display:"inline-flex",alignItems:"center",justifyContent:"center",cursor:"help",flexShrink:0}}>{"?"}</span>
                  </div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                    {result.related_conflicts.map(cid=>(
                      <span key={cid} style={{fontSize:10,color:"#f59e0b",background:"#2a1f08",padding:"3px 8px",borderRadius:3,border:"1px solid #3a2a08"}}>{cid}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {/* CLAUSES */}
          {activeSection==="clauses" && (
            <div>
              {result.triggered_clauses?.length>0
                ? result.triggered_clauses.map((c,i)=><ClauseCard key={i} clause={c} onViewFull={setViewingClause}/>)
                : <div style={{fontSize:12,color:"#6677aa",textAlign:"center",padding:20}}>관련 조항 없음</div>
              }
            </div>
          )}
          {/* ANALYSIS */}
          {activeSection==="analysis" && (
            <div>
              <div style={{fontSize:11,color:"#9aaabb",marginBottom:8,letterSpacing:"0.08em"}}>위험도 판단 근거</div>
              <div style={{padding:"10px 14px",background:"#0a0a0f",borderRadius:6,borderLeft:`2px solid ${riskColor}44`,marginBottom:14}}>
                <div style={{fontSize:13,color:"#c8d0dc",lineHeight:1.7}}>{result.risk_reason}</div>
              </div>
              <div style={{fontSize:11,color:"#9aaabb",marginBottom:8,letterSpacing:"0.08em"}}>법적 효과 분석</div>
              <div style={{padding:"10px 14px",background:"#0a0a0f",borderRadius:6}}>
                <div style={{fontSize:13,color:"#c8d0dc",lineHeight:1.8,whiteSpace:"pre-line"}}>{result.legal_analysis}</div>
              </div>
            </div>
          )}
          {/* ACTIONS */}
          {activeSection==="actions" && (
            <div>
              {result.immediate_actions?.length>0
                ? result.immediate_actions.map((a,i)=><ActionCard key={i} action={a} index={i} onOpen={setViewingClause}/>)
                : <div style={{fontSize:12,color:"#6677aa",textAlign:"center",padding:20}}>조치 사항 없음</div>
              }
            </div>
          )}

        </div>
      </div>
      {/* CLAUSE DRAWER */}
      {viewingClause && <ClauseDrawer clauseId={viewingClause} onClose={()=>setViewingClause(null)}/>}

      {/* FOLLOWUP CHAT — 모든 탭 하단 고정 */}
      {result && <div style={{marginTop:10}}>
        <FollowupChat result={result} mode={mode} amendments={amendments}/>
      </div>}

      {/* REPORT BUTTON */}
      <ReportButton result={result} query={query} mode={mode}/>
    </>
  );
}



// ─── CLAUSE TIMELINE TAB ──────────────────────────────────────────────────────
function ClauseTimelineTab() {
  const [patchHistory, setPatchHistory] = useState([]);
  useEffect(() => {
    (async () => {
      try {
        const s = lsGet('kb_patches_v1');
        if (s) setPatchHistory(JSON.parse(s));
      } catch(e) {}
    })();
    // 탭 포커스 시 새로고침
    const onFocus = async () => {
      try {
        const s = lsGet('kb_patches_v1');
        if (s) setPatchHistory(JSON.parse(s));
      } catch(e) {}
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
  const [viewMode,    setViewMode]    = useState("timeline"); // "timeline" | "clause"
  const [selectedId,  setSelectedId]  = useState(null);       // 조항 ID 필터
  const [search,      setSearch]      = useState("");
  const [expandedAmds, setExpandedAmds] = useState({});

  // 모든 영향받은 조항 ID 목록
  const allClauseIds = [...new Set(
    patchHistory.flatMap(h => (h.patches||[]).map(p => p.clauseId))
  )].sort();

  // 검색 필터 적용한 히스토리
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

  // 조항별 변경 히스토리
  const clauseHistory = selectedId
    ? patchHistory
        .filter(h => (h.patches||[]).some(p => p.clauseId === selectedId))
        .map(h => ({
          ...h,
          patches: (h.patches||[]).filter(p => p.clauseId === selectedId)
        }))
    : [];

  const chgColor  = { MODIFY:"#60a5fa", DELETE:"#ff2d20", ADD:"#10b981", REPLACE:"#f59e0b",
                       수정:"#60a5fa",   삭제:"#ff2d20",   추가:"#10b981", 대체:"#f59e0b" };
  const chgLabel  = { MODIFY:"수정", DELETE:"삭제", ADD:"추가", REPLACE:"대체" };
  const typeColor = { Amendment:"#a78bfa", NewContract:"#60a5fa", OrderForm:"#10b981", Other:"#8899aa" };

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

      {/* ── 왼쪽: Amendment 목록 + 조항 필터 ── */}
      <div style={{borderRight:"1px solid #1a1a2e", display:"flex", flexDirection:"column",
        overflow:"hidden", background:"#0a0a14"}}>

        {/* 검색 */}
        <div style={{padding:"12px 14px", borderBottom:"1px solid #1a1a2e"}}>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="문서명·조항 ID·내용 검색..."
            style={{width:"100%", background:"#0f0f1a", border:"1px solid #1e2030", borderRadius:4,
              padding:"6px 9px", fontSize:10, color:"#e2e8f0", fontFamily:"inherit",
              outline:"none", boxSizing:"border-box"}}/>
        </div>

        {/* 뷰 전환 */}
        <div style={{display:"flex", borderBottom:"1px solid #1a1a2e"}}>
          {[["timeline","타임라인"],["clause","조항별"]].map(([k,label])=>(
            <button key={k} onClick={()=>{ setViewMode(k); setSelectedId(null); }}
              style={{flex:1, padding:"8px", fontSize:10, fontWeight:600, border:"none",
                background:"transparent", cursor:"pointer", fontFamily:"inherit",
                borderBottom:viewMode===k?"2px solid #60a5fa":"2px solid transparent",
                color:viewMode===k?"#60a5fa":"#6677aa"}}>
              {label}
            </button>
          ))}
        </div>

        <div style={{flex:1, overflowY:"auto", padding:"8px 10px"}}>

          {/* 타임라인 모드: Amendment 목록 */}
          {viewMode==="timeline" && filtered.map(h => {
            const tc = typeColor[h.docType]||"#8899aa";
            const isExp = expandedAmds[h.id];
            const patchCount = h.patches?.length||0;
            return (
              <div key={h.id} style={{marginBottom:6, borderRadius:5,
                border:`1px solid ${isExp?tc+"44":"#1e2030"}`,
                background:isExp?tc+"06":"#0f0f1a"}}>
                <div onClick={()=>toggleAmd(h.id)}
                  style={{padding:"9px 10px", cursor:"pointer"}}>
                  <div style={{display:"flex", alignItems:"center", gap:5, marginBottom:3}}>
                    <span style={{fontSize:9, fontWeight:700, color:tc,
                      background:tc+"18", padding:"1px 5px", borderRadius:2}}>
                      {h.docType}
                    </span>
                    <span style={{fontSize:8, color:"#475569", marginLeft:"auto"}}>
                      {h.effectiveDate || h.uploadedAt?.slice(0,10) || "날짜 미상"}
                    </span>
                  </div>
                  <div style={{fontSize:10, color:"#c8d0dc", marginBottom:3,
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
                    {h.fileName}
                  </div>
                  <div style={{display:"flex", gap:6, fontSize:8, color:"#475569"}}>
                    <span>조항 {patchCount}개 변경</span>
                    {isExp ? <span style={{marginLeft:"auto"}}>▲</span> : <span style={{marginLeft:"auto"}}>▼</span>}
                  </div>
                </div>
                {isExp && (
                  <div style={{borderTop:"1px solid #1e2030", padding:"6px 10px"}}>
                    {(h.patches||[]).map((p,i)=>{
                      const cc = chgColor[p.changeType]||"#8899aa";
                      return (
                        <div key={i} style={{display:"flex", alignItems:"center", gap:5,
                          padding:"3px 0", borderBottom:"1px solid #0f0f1a"}}>
                          <span style={{fontSize:8, color:cc, background:cc+"15",
                            padding:"1px 4px", borderRadius:2, whiteSpace:"nowrap"}}>
                            {chgLabel[p.changeType]||p.changeType}
                          </span>
                          <span style={{fontSize:9, color:"#9aaabb"}}>{p.clauseId}</span>
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
              <div style={{fontSize:9, color:"#475569", marginBottom:8, padding:"2px 2px"}}>
                변경 이력이 있는 조항 ({allClauseIds.length}개)
              </div>
              {allClauseIds.filter(id=>!search.trim()||id.toLowerCase().includes(search.toLowerCase())).map(id => {
                const changes = patchHistory.filter(h=>(h.patches||[]).some(p=>p.clauseId===id));
                const lastChange = changes[0];
                const lastPatch = (lastChange?.patches||[]).find(p=>p.clauseId===id);
                const cc = chgColor[lastPatch?.changeType]||"#8899aa";
                return (
                  <div key={id} onClick={()=>setSelectedId(selectedId===id?null:id)}
                    style={{marginBottom:4, padding:"8px 10px", borderRadius:5, cursor:"pointer",
                      border:`1px solid ${selectedId===id?"#60a5fa44":"#1e2030"}`,
                      background:selectedId===id?"#0f1e35":"#0f0f1a"}}>
                    <div style={{display:"flex", alignItems:"center", gap:6}}>
                      <span style={{fontSize:10, fontWeight:700,
                        color:selectedId===id?"#60a5fa":"#9aaabb"}}>{id}</span>
                      <span style={{fontSize:8, color:cc, background:cc+"15",
                        padding:"1px 4px", borderRadius:2, marginLeft:"auto"}}>
                        {chgLabel[lastPatch?.changeType]||lastPatch?.changeType}
                      </span>
                    </div>
                    <div style={{fontSize:8, color:"#475569", marginTop:2}}>
                      변경 {changes.length}회 · 최종 {lastChange?.effectiveDate||lastChange?.uploadedAt?.slice(0,10)}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      {/* ── 오른쪽: 상세 타임라인 ── */}
      <div style={{overflowY:"auto", padding:20}}>

        {/* 타임라인 모드 */}
        {viewMode==="timeline" && (
          <>
            <div style={{fontSize:11, color:"#6677aa", marginBottom:16, fontWeight:600}}>
              전체 변경 타임라인 &nbsp;
              <span style={{fontSize:9, color:"#475569", fontWeight:400}}>
                {patchHistory.length}건의 문서 · 총 {patchHistory.reduce((s,h)=>s+(h.patches?.length||0),0)}개 조항 변경
              </span>
            </div>

            {/* 타임라인 */}
            <div style={{position:"relative", paddingLeft:24}}>
              {/* 수직선 */}
              <div style={{position:"absolute", left:8, top:0, bottom:0, width:1,
                background:"linear-gradient(#1e2030, #1e203000)"}}/>

              {filtered.map((h, hi) => {
                const tc = typeColor[h.docType]||"#8899aa";
                return (
                  <div key={h.id} style={{marginBottom:24, position:"relative"}}>
                    {/* 노드 */}
                    <div style={{position:"absolute", left:-20, top:4, width:10, height:10,
                      borderRadius:"50%", background:tc, border:"2px solid #07070f",
                      boxShadow:`0 0 6px ${tc}88`}}/>

                    {/* 헤더 */}
                    <div style={{marginBottom:8}}>
                      <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:3}}>
                        <span style={{fontSize:10, fontWeight:700, color:tc,
                          background:tc+"18", padding:"2px 7px", borderRadius:3}}>
                          {h.docType}
                        </span>
                        <span style={{fontSize:11, color:"#c8d0dc", fontWeight:600}}>{h.fileName}</span>
                        <span style={{fontSize:9, color:"#475569", marginLeft:"auto"}}>
                          {h.effectiveDate
                            ? `발효일 ${h.effectiveDate}`
                            : `업로드 ${h.uploadedAt?.slice(0,10)||""}`}
                        </span>
                      </div>
                      {h.summary && (
                        <div style={{fontSize:10, color:"#8899aa", lineHeight:1.5,
                          padding:"6px 10px", background:"#0f0f1a",
                          borderLeft:`2px solid ${tc}44`, borderRadius:"0 4px 4px 0"}}>
                          {h.summary}
                        </div>
                      )}
                    </div>

                    {/* 조항별 변경 카드 */}
                    <div style={{display:"flex", flexDirection:"column", gap:6}}>
                      {(h.patches||[]).map((p, pi) => {
                        const cc = chgColor[p.changeType]||"#8899aa";
                        return (
                          <div key={pi} style={{padding:"10px 12px", borderRadius:5,
                            border:`1px solid ${cc}22`, background:cc+"06"}}>
                            <div style={{display:"flex", alignItems:"center", gap:6, marginBottom:p.prevCore||p.newCore?6:0}}>
                              <span style={{fontSize:9, fontWeight:700, color:cc,
                                background:cc+"18", padding:"1px 6px", borderRadius:2}}>
                                {chgLabel[p.changeType]||p.changeType}
                              </span>
                              <span style={{fontSize:11, fontWeight:700, color:"#c8d0dc"}}>{p.clauseId}</span>
                              {p.topic && <span style={{fontSize:9, color:"#6677aa"}}>{p.topic}</span>}
                            </div>
                            {p.prevCore && (
                              <div style={{fontSize:9, color:"#6677aa", lineHeight:1.5,
                                textDecoration:"line-through", marginBottom:4,
                                padding:"4px 8px", background:"#1a0808", borderRadius:3}}>
                                이전: {p.prevCore}
                              </div>
                            )}
                            {p.newCore && (
                              <div style={{fontSize:9, color:"#9aaabb", lineHeight:1.5,
                                padding:"4px 8px", background:"#0a0a14", borderRadius:3}}>
                                변경: {p.newCore}
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
                <div style={{fontSize:13, fontWeight:700, color:"#c8d0dc", marginBottom:4}}>{selectedId}</div>
                <div style={{fontSize:10, color:"#6677aa"}}>
                  {clauseHistory.length}건의 문서에서 변경됨
                </div>
              </div>

              {/* 현재 상태 */}
              {(() => {
                const cur = CONTRACT_KB.clauses.find(c=>c.id===selectedId);
                return cur ? (
                  <div style={{marginBottom:16, padding:"10px 12px",
                    background:"#0a1a0a", border:"1px solid #10b98133", borderRadius:6}}>
                    <div style={{fontSize:9, color:"#10b981", fontWeight:700, marginBottom:4}}>현재 상태</div>
                    <div style={{fontSize:10, color:"#9aaabb", lineHeight:1.5}}>{cur.core}</div>
                    {cur._amended && (
                      <div style={{fontSize:8, color:"#fb923c", marginTop:3}}>⚡ 수정된 조항</div>
                    )}
                  </div>
                ) : null;
              })()}

              {/* 변경 타임라인 (최신 → 과거) */}
              <div style={{position:"relative", paddingLeft:20}}>
                <div style={{position:"absolute", left:6, top:0, bottom:0, width:1, background:"#1e2030"}}/>
                {clauseHistory.map((h, hi) => {
                  const p = (h.patches||[])[0];
                  if (!p) return null;
                  const cc = chgColor[p.changeType]||"#8899aa";
                  const tc = typeColor[h.docType]||"#8899aa";
                  return (
                    <div key={h.id} style={{marginBottom:16, position:"relative"}}>
                      <div style={{position:"absolute", left:-16, top:3, width:8, height:8,
                        borderRadius:"50%", background:cc, border:"2px solid #07070f"}}/>
                      <div style={{marginBottom:4, display:"flex", alignItems:"center", gap:6}}>
                        <span style={{fontSize:8, fontWeight:700, color:cc,
                          background:cc+"18", padding:"1px 5px", borderRadius:2}}>
                          {chgLabel[p.changeType]||p.changeType}
                        </span>
                        <span style={{fontSize:9, color:tc}}>{h.fileName}</span>
                        <span style={{fontSize:8, color:"#475569", marginLeft:"auto"}}>
                          {h.effectiveDate||h.uploadedAt?.slice(0,10)}
                        </span>
                      </div>
                      {p.prevCore && (
                        <div style={{fontSize:9, color:"#6677aa", lineHeight:1.5,
                          textDecoration:"line-through", padding:"4px 8px",
                          background:"#1a0808", borderRadius:3, marginBottom:3}}>
                          {p.prevCore}
                        </div>
                      )}
                      {p.newCore && (
                        <div style={{fontSize:9, color:"#9aaabb", lineHeight:1.5,
                          padding:"4px 8px", background:"#0a0a14", borderRadius:3}}>
                          {p.newCore}
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


// ─── HURDLE TRACKER ───────────────────────────────────────────────────────────
const HURDLE_TARGET  = 55_000_000;  // KT가 보유한 라이선스 총량 ($50M 선구매 + $5M 추가)
const PURCHASE_SCHEDULE = [         // KT → Palantir 연간 선구매 (SAA 고정 스케줄, 합계 $50M)
  { year: 1, amount: 8_000_000,  bonus: 0,         label: "Y1" },
  { year: 2, amount: 10_000_000, bonus: 0,         label: "Y2" },
  { year: 3, amount: 10_000_000, bonus: 0,         label: "Y3" },
  { year: 4, amount: 11_000_000, bonus: 0,         label: "Y4" },
  { year: 5, amount: 11_000_000, bonus: 5_000_000, label: "Y5" }, // Y5: +$5M 추가 라이선스
];

function HurdleTracker() {
  const STORAGE_KEY    = "hurdle_data_v3";
  const PURCHASE_KEY   = "hurdle_purchase_v1";

  // 파트너 Revenue 실적 레코드
  const [records,    setRecords]    = useState([]);
  // 연간 선구매 실제 지급 여부
  const [purchased,  setPurchased]  = useState({});  // { "1": true, "2": false, ... }
  // 계약 시작 연도
  const [startYear,  setStartYear]  = useState(2025);
  const [showForm,   setShowForm]   = useState(false);
  const [activeTab,  setActiveTab]  = useState("revenue"); // "revenue" | "purchase"
  // form: 계약 기간·연도별 지급 포함
  // yearlyAmounts: ["1500000","2000000",...] 계약 기간만큼
  const EMPTY_FORM = { date:"", years:"1", yearlyAmounts:[""], customer:"", customerType:"Target Market", note:"" };
  const [form,       setForm]       = useState(EMPTY_FORM);
  const [editId,     setEditId]     = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const s1 = lsGet(STORAGE_KEY);
        if (s1?.value) {
          const parsed = JSON.parse(s1.value);
          setRecords(parsed.records || []);
          setStartYear(parsed.startYear || 2025);
        }
        const s2 = lsGet(PURCHASE_KEY);
        if (s2?.value) setPurchased(JSON.parse(s2.value));
      } catch(e) {}
    })();
  }, []);

  const saveRecords = async (recs, sy) => {
    try { lsSet(STORAGE_KEY, JSON.stringify({ records: recs, startYear: sy })); } catch(e) {}
  };
  const savePurchased = async (p) => {
    try { lsSet(PURCHASE_KEY, JSON.stringify(p)); } catch(e) {}
  };

  // ── Revenue 실적 계산 ──────────────────────────────────────────────────────
  const totalRevenue   = records.reduce((s, r) => s + (r.amount || 0), 0);
  const remaining      = Math.max(0, HURDLE_TARGET - totalRevenue);
  const pct            = Math.min(100, (totalRevenue / HURDLE_TARGET) * 100);
  const riskLevel      = pct >= 100 ? "달성" : pct >= 70 ? "LOW" : pct >= 40 ? "MEDIUM" : "HIGH";
  const riskColor      = { 달성:"#10b981", LOW:"#10b981", MEDIUM:"#f59e0b", HIGH:"#ff2d20" }[riskLevel];

  // ── 선구매 계산 ────────────────────────────────────────────────────────────
  const totalPurchased = PURCHASE_SCHEDULE.reduce((s, p) => purchased[p.year] ? s + p.amount : s, 0);
  const totalLicense   = PURCHASE_SCHEDULE.reduce((s, p) => purchased[p.year] ? s + p.amount + p.bonus : s, 0);
  const unusedLicense  = Math.max(0, totalLicense - totalRevenue);

  const fmt = (n) => n >= 1_000_000 ? `$${(n/1_000_000).toFixed(1)}M` : `$${n.toLocaleString()}`;

  // Revenue 월별 누적
  const monthlyData = (() => {
    const sorted = [...records].sort((a,b) => a.date.localeCompare(b.date));
    const map = {};
    for (const r of sorted) {
      const ym = r.date.slice(0,7);
      map[ym] = (map[ym]||0) + r.amount;
    }
    let cum = 0;
    return Object.entries(map).map(([ym, amt]) => {
      cum += amt;
      return { label: ym, amount: amt, cumulative: cum };
    });
  })();
  const maxCum = Math.max(HURDLE_TARGET, ...monthlyData.map(d=>d.cumulative), 1);

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
    await saveRecords(newRecs, startYear);
    setForm(EMPTY_FORM);
    setShowForm(false);
  };

  const deleteRecord = async (id) => {
    const newRecs = records.filter(r => r.id !== id);
    setRecords(newRecs);
    await saveRecords(newRecs, startYear);
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
    await savePurchased(next);
  };

  const ctColor = { "Target Market":"#60a5fa", "KT그룹":"#34d399" };

  return (
    <div style={{height:"100%", overflowY:"auto", padding:24, background:"#07070f"}}>
      <div style={{maxWidth:960, margin:"0 auto"}}>

        {/* 타이틀 */}
        <div style={{marginBottom:20, display:"flex", alignItems:"center", justifyContent:"space-between", gap:16}}>
          <div>
            <div style={{fontSize:14, fontWeight:700, color:"#c8d0dc", marginBottom:4}}>Hurdle 달성 트래커</div>
            <div style={{fontSize:10, color:"#475569", lineHeight:1.7}}>
              SAA §6.3 — KT 라이선스 총량: <span style={{color:"#60a5fa"}}>{fmt(HURDLE_TARGET)}</span>
              &nbsp;(선구매 $50M + Y5 추가 $5M) &nbsp;|&nbsp; 미달성 해지 시 Surviving QRC good faith 협상
            </div>
          </div>
          <div style={{display:"flex", alignItems:"center", gap:8}}>
            <span style={{fontSize:9, color:"#475569"}}>계약 시작</span>
            <input type="number" value={startYear} onChange={e=>{ setStartYear(+e.target.value); saveRecords(records,+e.target.value); }}
              style={{width:64, background:"#0f0f1a", border:"1px solid #1e2030", borderRadius:4,
                padding:"4px 6px", fontSize:11, color:"#e2e8f0", fontFamily:"inherit", outline:"none", textAlign:"center"}}/>
          </div>
        </div>

        {/* ── 요약 카드 4개 ── */}
        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:10, marginBottom:20}}>
          {[
            { label:"선구매 누적",    value:fmt(totalPurchased), sub:`${fmt(50_000_000)} 목표`,   color:"#a78bfa" },
            { label:"확보 라이선스",  value:fmt(totalLicense),   sub:`미사용 ${fmt(unusedLicense)}`, color:"#34d399" },
            { label:"Revenue 달성",  value:fmt(totalRevenue),   sub:`${pct.toFixed(1)}% / Hurdle`, color:riskColor },
            { label:"Hurdle 상태",   value:riskLevel,           sub:riskLevel==="달성"?"QRC 협상력 확보":"미달 시 협상 불리", color:riskColor },
          ].map((c,i) => (
            <div key={i} style={{background:"#0a0a14", border:`1px solid ${c.color}33`, borderRadius:8, padding:"12px 14px"}}>
              <div style={{fontSize:9, color:"#6677aa", marginBottom:5}}>{c.label}</div>
              <div style={{fontSize:18, fontWeight:700, color:c.color, marginBottom:3}}>{c.value}</div>
              <div style={{fontSize:8, color:"#475569"}}>{c.sub}</div>
            </div>
          ))}
        </div>

        {/* ── 내부 탭 ── */}
        <div style={{display:"flex", borderBottom:"1px solid #1a1a2e", marginBottom:16, gap:0}}>
          {[["revenue","📈 Revenue 실적 (Hurdle)"],["purchase","💳 연간 선구매 스케줄"]].map(([k,label])=>(
            <button key={k} onClick={()=>setActiveTab(k)}
              style={{padding:"8px 18px", fontSize:11, fontWeight:600, border:"none", cursor:"pointer",
                fontFamily:"inherit", background:"transparent",
                borderBottom:activeTab===k?"2px solid #60a5fa":"2px solid transparent",
                color:activeTab===k?"#60a5fa":"#6677aa"}}>
              {label}
            </button>
          ))}
        </div>

        {/* ══════════ Revenue 탭 ══════════ */}
        {activeTab==="revenue" && (<>

          {/* 프로그레스 바 */}
          <div style={{marginBottom:16, background:"#0a0a14", border:"1px solid #1e2030", borderRadius:8, padding:16}}>
            <div style={{display:"flex", justifyContent:"space-between", marginBottom:8}}>
              <span style={{fontSize:10, color:"#8899aa", fontWeight:600}}>Hurdle 달성률</span>
              <span style={{fontSize:10, color:riskColor, fontWeight:700}}>{fmt(totalRevenue)} / {fmt(HURDLE_TARGET)}</span>
            </div>
            <div style={{background:"#0f0f1a", borderRadius:4, height:14, overflow:"hidden", position:"relative"}}>
              <div style={{position:"absolute", height:"100%", borderRadius:4,
                background:`linear-gradient(90deg, ${riskColor}88, ${riskColor})`,
                width:`${pct}%`, transition:"width 0.4s"}}/>
              <div style={{position:"absolute", left:"70%", top:0, width:1, height:"100%", background:"#f59e0b66"}}/>
            </div>
            <div style={{display:"flex", justifyContent:"space-between", marginTop:4, fontSize:8, color:"#2a3a4a"}}>
              <span>$0</span>
              <span style={{color:"#f59e0b55"}}>70% ($38.5M)</span>
              <span>{fmt(HURDLE_TARGET)}</span>
            </div>
          </div>

          {/* 월별 추이 그래프 */}
          {monthlyData.length > 0 && (
            <div style={{marginBottom:16, background:"#0a0a14", border:"1px solid #1e2030", borderRadius:8, padding:16}}>
              <div style={{fontSize:10, color:"#8899aa", fontWeight:600, marginBottom:12}}>월별 누적 Revenue 추이</div>
              <svg width="100%" viewBox={`0 0 ${Math.max(monthlyData.length*72,300)} 140`} style={{overflow:"visible"}}>
                <line x1="0" y1={110*(1-HURDLE_TARGET/maxCum)} x2="100%" y2={110*(1-HURDLE_TARGET/maxCum)}
                  stroke="#ff2d2055" strokeWidth="1" strokeDasharray="4,3"/>
                <text x="4" y={110*(1-HURDLE_TARGET/maxCum)-4} fontSize="8" fill="#ff2d2088">$55M</text>
                {monthlyData.map((d,i) => {
                  const W = Math.max(monthlyData.length*72,300);
                  const x = monthlyData.length===1 ? W/2 : (i/(monthlyData.length-1))*(W-40)+20;
                  const y = 110*(1-d.cumulative/maxCum);
                  const bH = 110*(d.amount/maxCum);
                  return (
                    <g key={d.label}>
                      <rect x={x-12} y={110-bH} width={24} height={bH} fill="#60a5fa18" rx="2"/>
                      <circle cx={x} cy={y} r="4" fill="#60a5fa"/>
                      <text x={x} y={130} fontSize="7" fill="#475569" textAnchor="middle">{d.label}</text>
                      <text x={x} y={y-8} fontSize="7" fill="#60a5fa" textAnchor="middle">{fmt(d.cumulative)}</text>
                    </g>
                  );
                })}
                {monthlyData.length > 1 && (
                  <polyline
                    points={monthlyData.map((d,i)=>{
                      const W=Math.max(monthlyData.length*72,300);
                      const x=monthlyData.length===1?W/2:(i/(monthlyData.length-1))*(W-40)+20;
                      return `${x},${110*(1-d.cumulative/maxCum)}`;
                    }).join(" ")}
                    fill="none" stroke="#60a5fa" strokeWidth="1.5" strokeLinejoin="round"/>
                )}
              </svg>
            </div>
          )}

          {/* 입력 폼 */}
          <div style={{marginBottom:12, display:"flex", justifyContent:"flex-end"}}>
            <button onClick={()=>{ setShowForm(!showForm); setEditId(null); setForm(EMPTY_FORM); }}
              style={{padding:"6px 16px", background:"#1e3a6e", border:"1px solid #60a5fa44",
                borderRadius:5, color:"#60a5fa", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit"}}>
              {showForm?"닫기":"+ 실적 입력"}
            </button>
          </div>
          {showForm && (
            <div style={{marginBottom:14, padding:16, background:"#0a0a14", border:"1px solid #1e2030", borderRadius:8}}>
              {/* 1행: 체결일 / 고객 유형 / 고객사 / 계약기간 / 내용 */}
              <div style={{display:"grid", gridTemplateColumns:"140px 130px 1fr 100px 1fr", gap:10, marginBottom:12, alignItems:"end"}}>
                <div>
                  <div style={{fontSize:9, color:"#6677aa", marginBottom:4}}>계약 체결일</div>
                  <input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}
                    style={{width:"100%",background:"#0f0f1a",border:"1px solid #1e2030",borderRadius:4,
                      padding:"6px 8px",fontSize:11,color:"#e2e8f0",fontFamily:"inherit",outline:"none",
                      boxSizing:"border-box",colorScheme:"dark"}}/>
                </div>
                <div>
                  <div style={{fontSize:9, color:"#6677aa", marginBottom:4}}>고객 유형</div>
                  <select value={form.customerType} onChange={e=>setForm({...form,customerType:e.target.value})}
                    style={{width:"100%",background:"#0f0f1a",border:"1px solid #1e2030",borderRadius:4,
                      padding:"6px 8px",fontSize:11,color:"#e2e8f0",fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}>
                    {["Target Market","KT그룹"].map(t=><option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{fontSize:9, color:"#6677aa", marginBottom:4}}>고객사</div>
                  <input value={form.customer} onChange={e=>setForm({...form,customer:e.target.value})}
                    placeholder="현대자동차"
                    style={{width:"100%",background:"#0f0f1a",border:"1px solid #1e2030",borderRadius:4,
                      padding:"6px 8px",fontSize:11,color:"#e2e8f0",fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                </div>
                <div>
                  <div style={{fontSize:9, color:"#6677aa", marginBottom:4}}>계약 기간</div>
                  <select value={form.years} onChange={e=>{
                    const y = parseInt(e.target.value)||1;
                    const prev = form.yearlyAmounts;
                    const next = Array(y).fill("").map((_,i)=>prev[i]||"");
                    setForm({...form, years:String(y), yearlyAmounts:next});
                  }}
                    style={{width:"100%",background:"#0f0f1a",border:"1px solid #1e2030",borderRadius:4,
                      padding:"6px 8px",fontSize:11,color:"#e2e8f0",fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}>
                    {[1,2,3,4,5].map(y=><option key={y} value={y}>{y}년</option>)}
                  </select>
                </div>
                <div>
                  <div style={{fontSize:9, color:"#6677aa", marginBottom:4}}>계약 내용</div>
                  <input value={form.note} onChange={e=>setForm({...form,note:e.target.value})}
                    placeholder="플랫폼 라이선스"
                    style={{width:"100%",background:"#0f0f1a",border:"1px solid #1e2030",borderRadius:4,
                      padding:"6px 8px",fontSize:11,color:"#e2e8f0",fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                </div>
              </div>

              {/* 2행: 연도별 지급액 */}
              <div style={{marginBottom:12}}>
                <div style={{fontSize:9, color:"#6677aa", marginBottom:6}}>
                  연도별 지급액 (USD) &nbsp;
                  <span style={{color:"#2a3a4a"}}>
                    총액: ${form.yearlyAmounts.reduce((s,v)=>s+(parseFloat(String(v).replace(/,/g,''))||0),0).toLocaleString()}
                  </span>
                </div>
                <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
                  {form.yearlyAmounts.map((amt, i) => (
                    <div key={i} style={{display:"flex", flexDirection:"column", gap:3, minWidth:100}}>
                      <div style={{fontSize:8, color:"#475569"}}>{i+1}년차</div>
                      <input
                        value={amt}
                        onChange={e=>{
                          const next = [...form.yearlyAmounts];
                          next[i] = e.target.value;
                          setForm({...form, yearlyAmounts:next});
                        }}
                        placeholder="1500000"
                        style={{background:"#0f0f1a",border:"1px solid #1e2030",borderRadius:4,
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
                  style={{padding:"6px 14px",background:"none",border:"1px solid #1e2030",
                    borderRadius:4,color:"#6677aa",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>취소</button>
              </div>
            </div>
          )}

          {/* 실적 테이블 */}
          <div style={{background:"#0a0a14",border:"1px solid #1e2030",borderRadius:8,overflow:"hidden",marginBottom:16}}>
            <div style={{padding:"10px 16px",borderBottom:"1px solid #1e2030",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <span style={{fontSize:10,color:"#8899aa",fontWeight:600}}>Revenue 실적 ({records.length}건)</span>
              <span style={{fontSize:9,color:"#475569"}}>{records.length>0?`합계 ${fmt(totalRevenue)}`:""}</span>
            </div>
            {records.length===0 ? (
              <div style={{padding:"28px",textAlign:"center",fontSize:10,color:"#475569",lineHeight:1.8}}>
                실적 없음 — "+ 실적 입력"으로 고객 계약 체결 건을 기록하세요
              </div>
            ) : (
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
                <thead>
                  <tr style={{borderBottom:"1px solid #1e2030"}}>
                    {["계약일","고객사","유형","계약구조","총액","내용",""].map((h,i)=>(
                      <th key={i} style={{padding:"7px 12px",textAlign:"left",fontSize:9,color:"#475569",fontWeight:600}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...records].sort((a,b)=>b.date.localeCompare(a.date)).map(r=>{
                    const cc = ctColor[r.customerType]||"#8899aa";
                    return (
                      <tr key={r.id} style={{borderBottom:"1px solid #0f0f1a"}}>
                        <td style={{padding:"7px 12px",color:"#9aaabb",whiteSpace:"nowrap"}}>{r.date}</td>
                        <td style={{padding:"7px 12px",color:"#c8d0dc",fontWeight:500}}>{r.customer||"-"}</td>
                        <td style={{padding:"7px 12px"}}>
                          <span style={{fontSize:8,fontWeight:700,color:cc,background:cc+"18",padding:"1px 5px",borderRadius:2}}>{r.customerType}</span>
                        </td>
                        <td style={{padding:"7px 12px"}}>
                          {r.yearlyAmounts && r.years > 1 ? (
                            <div>
                              <span style={{fontSize:9,color:"#9aaabb"}}>{r.years}년 계약</span>
                              <div style={{display:"flex",gap:3,marginTop:2,flexWrap:"wrap"}}>
                                {r.yearlyAmounts.map((a,i)=>(
                                  <span key={i} style={{fontSize:8,color:"#60a5fa66",background:"#60a5fa0a",
                                    padding:"1px 4px",borderRadius:2}}>Y{i+1}:{fmt(a)}</span>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <span style={{fontSize:9,color:"#9aaabb"}}>1년 계약</span>
                          )}
                        </td>
                        <td style={{padding:"7px 12px",color:"#60a5fa",fontWeight:600,whiteSpace:"nowrap"}}>{fmt(r.amount)}</td>
                        <td style={{padding:"7px 12px",color:"#6677aa",fontSize:9}}>{r.note||"-"}</td>
                        <td style={{padding:"7px 12px"}}>
                          <div style={{display:"flex",gap:6}}>
                            <button onClick={()=>startEdit(r)}
                              style={{background:"none",border:"1px solid #1e2030",borderRadius:2,
                                padding:"2px 7px",fontSize:8,color:"#6677aa",cursor:"pointer",fontFamily:"inherit"}}>수정</button>
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
              <div style={{fontSize:10,color:"#9aaabb",lineHeight:1.8}}>
                {riskLevel==="달성"
                  ? `Hurdle ${fmt(HURDLE_TARGET)} 달성. 계약 해지 시에도 SAA §6.3에 따라 Surviving QRC 수익 배분 협상 권리 보유.`
                  : riskLevel==="LOW"
                    ? `${pct.toFixed(1)}% 달성 — 잔여 ${fmt(remaining)} 추가 확보 시 Hurdle 충족 가능.`
                    : riskLevel==="MEDIUM"
                      ? `${pct.toFixed(1)}% 달성 — 잔여 ${fmt(remaining)} 미확보 시 해지 후 SAA §6.3 협상에서 KT 협상력 약화 우려.`
                      : `${pct.toFixed(1)}% 달성 — 목표 대비 현저히 부족. Hurdle 미달성 해지 시 Surviving QRC 수익이 KT에 불리하게 배분될 리스크 HIGH.`
                }
              </div>
            </div>
          )}
        </>)}

        {/* ══════════ 선구매 스케줄 탭 ══════════ */}
        {activeTab==="purchase" && (
          <div>
            <div style={{fontSize:10,color:"#6677aa",marginBottom:14,lineHeight:1.7}}>
              SAA에 고정된 KT → Palantir 연간 선구매 스케줄입니다. 실제 지급 완료 시 체크하세요.<br/>
              Y5 지급 시 Palantir으로부터 추가 $5M 라이선스를 수취합니다.
            </div>

            {/* 선구매 진행 바 */}
            <div style={{marginBottom:20,background:"#0a0a14",border:"1px solid #1e2030",borderRadius:8,padding:16}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                <span style={{fontSize:10,color:"#8899aa",fontWeight:600}}>선구매 진행률</span>
                <span style={{fontSize:10,color:"#a78bfa",fontWeight:700}}>{fmt(totalPurchased)} / $50M</span>
              </div>
              <div style={{background:"#0f0f1a",borderRadius:4,height:10,overflow:"hidden"}}>
                <div style={{height:"100%",borderRadius:4,background:"linear-gradient(90deg,#a78bfa88,#a78bfa)",
                  width:`${Math.min(100,(totalPurchased/50_000_000)*100)}%`,transition:"width 0.4s"}}/>
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
                    style={{background:"#0a0a14",border:`1px solid ${done?"#a78bfa44":"#1e2030"}`,
                      borderRadius:8,padding:14,cursor:"pointer",transition:"all 0.15s",
                      opacity:done?1:0.7}}
                    onClick={()=>togglePurchased(p.year)}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                      <span style={{fontSize:11,fontWeight:700,color:done?"#a78bfa":"#6677aa"}}>{p.label}</span>
                      <span style={{fontSize:9,color:"#475569"}}>{yr}년</span>
                    </div>
                    <div style={{fontSize:16,fontWeight:700,color:done?"#c8d0dc":"#475569",marginBottom:4}}>
                      {fmt(p.amount)}
                    </div>
                    {p.bonus>0 && (
                      <div style={{fontSize:9,color:"#34d399",marginBottom:6}}>
                        +{fmt(p.bonus)} 라이선스 추가 수취
                      </div>
                    )}
                    <div style={{fontSize:9,color:"#475569",marginBottom:8}}>
                      확보 라이선스: {fmt(totalWithBonus)}
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <div style={{width:12,height:12,borderRadius:"50%",border:`2px solid ${done?"#a78bfa":"#1e2030"}`,
                        background:done?"#a78bfa":"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>
                        {done && <span style={{fontSize:8,color:"#07070f",fontWeight:700}}>✓</span>}
                      </div>
                      <span style={{fontSize:9,color:done?"#a78bfa":"#475569"}}>{done?"지급 완료":"미지급"}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 합계 요약 */}
            <div style={{marginTop:16,padding:"12px 16px",background:"#0a0a14",border:"1px solid #1e2030",borderRadius:8}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16,fontSize:10}}>
                <div>
                  <div style={{color:"#6677aa",marginBottom:3}}>총 선구매 (5년)</div>
                  <div style={{color:"#a78bfa",fontWeight:700,fontSize:14}}>$50M</div>
                </div>
                <div>
                  <div style={{color:"#6677aa",marginBottom:3}}>총 확보 라이선스</div>
                  <div style={{color:"#34d399",fontWeight:700,fontSize:14}}>$55M <span style={{fontSize:10,fontWeight:400}}>(Y5 +$5M 포함)</span></div>
                </div>
                <div>
                  <div style={{color:"#6677aa",marginBottom:3}}>현재 확보 라이선스</div>
                  <div style={{color:"#60a5fa",fontWeight:700,fontSize:14}}>{fmt(totalLicense)}</div>
                  <div style={{color:"#475569",fontSize:8,marginTop:2}}>미사용 {fmt(unusedLicense)}</div>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}


// ─── HISTORY TAB ──────────────────────────────────────────────────────────────
function HistoryTab({ history, onSelect, onDelete, onUpdateMemo, onClear }) {
  const [filter, setFilter]     = useState("all");   // all | HIGH | MEDIUM | LOW
  const [editingId, setEditingId] = useState(null);
  const [editMemo, setEditMemo] = useState("");
  const [search, setSearch]     = useState("");
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
    <div style={{display:"grid", gridTemplateColumns:"320px 1fr", height:"100%", overflow:"hidden"}}>

      {/* ── 왼쪽: 목록 ── */}
      <div style={{borderRight:"1px solid #1a1a2e", display:"flex", flexDirection:"column", overflow:"hidden", background:"#0a0a14"}}>

        {/* 검색 + 필터 */}
        <div style={{padding:"12px 14px", borderBottom:"1px solid #1a1a2e"}}>
          <input
            value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="이슈 내용, 메모 검색..."
            style={{width:"100%", background:"#0f0f1a", border:"1px solid #1e2030", borderRadius:4,
              padding:"6px 10px", fontSize:10, color:"#e2e8f0", fontFamily:"inherit",
              outline:"none", boxSizing:"border-box", marginBottom:8}}
          />
          <div style={{display:"flex", gap:4}}>
            {[["all","전체"], ["HIGH","HIGH"], ["MEDIUM","MED"], ["LOW","LOW"]].map(([v,label]) => {
              const c = v==="HIGH"?"#ff2d20":v==="MEDIUM"?"#f59e0b":v==="LOW"?"#10b981":"#8899aa";
              return (
                <button key={v} onClick={()=>setFilter(v)}
                  style={{flex:1, padding:"4px 0", borderRadius:3, border:`1px solid ${filter===v?c+"88":"#1e2030"}`,
                    background:filter===v?c+"15":"transparent", color:filter===v?c:"#6677aa",
                    fontSize:9, fontWeight:700, cursor:"pointer", fontFamily:"inherit"}}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 건수 + 전체삭제 */}
        <div style={{padding:"6px 14px", borderBottom:"1px solid #1a1a2e", display:"flex", alignItems:"center", justifyContent:"space-between"}}>
          <span style={{fontSize:9, color:"#475569"}}>
            {filtered.length}건 {filter!=="all"||search?`/ 전체 ${history.length}건`:""}
          </span>
          {history.length > 0 && (
            <button onClick={()=>{if(confirm("전체 히스토리를 삭제할까요?")) onClear();}}
              style={{fontSize:9, color:"#475569", background:"none", border:"1px solid #1e2030",
                borderRadius:3, padding:"2px 8px", cursor:"pointer", fontFamily:"inherit"}}>
              전체 삭제
            </button>
          )}
        </div>

        {/* 히스토리 목록 */}
        <div style={{flex:1, overflowY:"auto", padding:"8px 10px"}}>
          {filtered.length === 0 ? (
            <div style={{textAlign:"center", padding:"30px 0", fontSize:10, color:"#475569"}}>
              {history.length === 0 ? "분석 기록이 없습니다" : "검색 결과 없음"}
            </div>
          ) : filtered.map(h => {
            const rc = RISK_COLOR[h.result?.risk_level] || "#8899aa";
            const isSelected = selectedId === h.id;
            return (
              <div key={h.id}
                onClick={()=>{ setSelectedId(h.id); onSelect(h); }}
                style={{marginBottom:6, borderRadius:5, padding:"9px 10px", cursor:"pointer",
                  border:`1px solid ${isSelected?rc+"55":"#1e2030"}`,
                  background:isSelected?rc+"08":"#0f0f1a"}}>

                {/* 상단: 위험도 + 날짜 + 삭제 */}
                <div style={{display:"flex", alignItems:"center", gap:5, marginBottom:4}}>
                  <span style={{fontSize:9, fontWeight:700, color:rc,
                    background:rc+"18", padding:"1px 6px", borderRadius:2}}>
                    {h.result?.risk_level}
                  </span>
                  {h.memo && (
                    <span style={{fontSize:8, color:"#a78bfa", background:"#a78bfa18",
                      padding:"1px 5px", borderRadius:2}}>메모</span>
                  )}
                  <span style={{fontSize:8, color:"#475569", marginLeft:"auto"}}>{h.ts}</span>
                  <button onClick={e=>{e.stopPropagation(); if(confirm("이 항목을 삭제할까요?")) onDelete(h.id);}}
                    style={{background:"none", border:"none", color:"#475569", cursor:"pointer",
                      fontSize:13, padding:"0 2px", fontFamily:"inherit", lineHeight:1}}>×</button>
                </div>

                {/* 이슈 내용 */}
                <div style={{fontSize:10, color:"#c8d0dc", lineHeight:1.4, marginBottom:4}}>
                  {h.query.length > 60 ? h.query.slice(0,60)+"…" : h.query}
                </div>

                {/* 메모 표시/편집 */}
                {editingId === h.id ? (
                  <div onClick={e=>e.stopPropagation()} style={{marginTop:4}}>
                    <textarea
                      value={editMemo} onChange={e=>setEditMemo(e.target.value)}
                      autoFocus
                      style={{width:"100%", background:"#0a0a14", border:"1px solid #a78bfa44",
                        borderRadius:3, padding:"4px 6px", fontSize:9, color:"#e2e8f0",
                        fontFamily:"inherit", resize:"none", height:52, outline:"none", boxSizing:"border-box"}}
                    />
                    <div style={{display:"flex", gap:4, marginTop:3}}>
                      <button onClick={e=>saveEdit(h.id,e)}
                        style={{flex:1, fontSize:9, background:"#1a1040", border:"1px solid #a78bfa44",
                          color:"#a78bfa", borderRadius:3, padding:"3px", cursor:"pointer", fontFamily:"inherit"}}>저장</button>
                      <button onClick={e=>{e.stopPropagation();setEditingId(null);}}
                        style={{flex:1, fontSize:9, background:"none", border:"1px solid #1e2030",
                          color:"#6677aa", borderRadius:3, padding:"3px", cursor:"pointer", fontFamily:"inherit"}}>취소</button>
                    </div>
                  </div>
                ) : (
                  <div style={{display:"flex", alignItems:"flex-start", gap:6}}>
                    {h.memo && (
                      <div style={{fontSize:9, color:"#a78bfa", flex:1, lineHeight:1.4}}>
                        {h.memo.length>50?h.memo.slice(0,50)+"…":h.memo}
                      </div>
                    )}
                    <button onClick={e=>startEdit(h,e)}
                      style={{background:"none", border:"1px solid #1e2030", borderRadius:3,
                        padding:"1px 6px", fontSize:8, color:"#475569", cursor:"pointer",
                        fontFamily:"inherit", whiteSpace:"nowrap", marginLeft:"auto"}}>
                      {h.memo ? "메모 수정" : "메모 추가"}
                    </button>
                  </div>
                )}

                {/* 조항 수 / 충돌 수 */}
                <div style={{display:"flex", gap:8, marginTop:4, fontSize:8, color:"#475569"}}>
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
      <div style={{overflowY:"auto", padding:20}}>
        {selected ? (
          <div>
            <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:12}}>
              <span style={{fontSize:10, color:"#6677aa"}}>이슈</span>
              <span style={{fontSize:11, color:"#9aaabb", background:"#0f0f1a", border:"1px solid #1e2030",
                borderRadius:4, padding:"3px 9px", flex:1}}>{selected.query}</span>
              <span style={{fontSize:9, color:"#475569"}}>{selected.ts}</span>
            </div>
            {selected.memo && (
              <div style={{marginBottom:12, padding:"8px 12px", background:"#0f0a20",
                border:"1px solid #a78bfa33", borderRadius:5, fontSize:10, color:"#a78bfa", lineHeight:1.5}}>
                📝 {selected.memo}
              </div>
            )}
            <AnalysisResult result={selected.result} query={selected.query} mode={selected.mode} amendments={[]}/>
          </div>
        ) : (
          <div style={{display:"flex", flexDirection:"column", alignItems:"center",
            justifyContent:"center", height:"60%", gap:8}}>
            <div style={{fontSize:30, opacity:0.2}}>📋</div>
            <div style={{fontSize:11, color:"#475569", textAlign:"center", lineHeight:1.8}}>
              왼쪽에서 분석 기록을 선택하면<br/>결과와 리포트를 다시 볼 수 있습니다
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
function NegotiationSimulator({ amendments = [] }) {
  const [mode,         setMode]         = useState('file'); // 'file' | 'text'
  const [inputText,    setInputText]    = useState('');
  const [ktGoals,      setKtGoals]      = useState('');
  const [fileContent,  setFileContent]  = useState(null);
  const [fileName,     setFileName]     = useState('');
  const [result,       setResult]       = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [activeSection, setActiveSection] = useState(0);
  const fileRef = useRef(null);

  // PDF/\ud14d\uc2a4\ud2b8 \ud30c\uc77c \uc77d\uae30
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
          model: 'claude-sonnet-4-6',
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

  const riskColor  = { HIGH:'#ff4444', MEDIUM:'#f59e0b', LOW:'#10b981' };
  const posColor   = { ACCEPT:'#10b981', MODIFY:'#f59e0b', REJECT:'#ff4444' };
  const posLabel   = { ACCEPT:'\u2713 \uc218\uc6a9', MODIFY:'~ \uc218\uc815', REJECT:'\u2717 \uac70\ubd80' };
  const probColor  = { HIGH:'#10b981', MEDIUM:'#f59e0b', LOW:'#ff4444' };

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
        <div style={{fontSize:9, color:'#475569', marginTop:2}}>
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
                  style={{flex:1, padding:'6px 0', borderRadius:4, border:'none',
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
                      <div style={{fontSize:9, color:'#475569', marginTop:2}}>\ud074\ub9ad\ud558\uc5ec \ubcc0\uacbd</div>
                    </div>
                  ) : (
                    <div>
                      <div style={{fontSize:20, marginBottom:6, opacity:0.4}}>\ud83d\udcce</div>
                      <div style={{fontSize:10, color:'#475569'}}>
                        Amendment \uc81c\uc548\uc11c \uc5c5\ub85c\ub4dc<br/>
                        <span style={{fontSize:9, color:'#334155'}}>PDF \u00b7 TXT \uc9c0\uc6d0</span>
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
                <div style={{fontSize:9, color:'#334155', lineHeight:1.6, padding:'6px 8px',
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
              <div style={{fontSize:9, color:'#334155', marginBottom:5, lineHeight:1.6}}>
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
                <div style={{fontSize:9, color:'#60a5fa', fontWeight:700, marginBottom:6}}>
                  \ubd84\uc11d \uc644\ub8cc
                </div>
                <div style={{fontSize:10, color:'#c8d0dc', lineHeight:1.6}}>
                  {result.summary}
                </div>
                <div style={{marginTop:8, fontSize:9, color:'#6677aa'}}>
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
              <div style={{fontSize:9, color:'#334155'}}>\uc870\ud56d \ubd84\uc11d \u2192 \ubc14\ud130 \ud328\ud0a4\uc9c0 \uad6c\uc131 \u2192 \ud611\uc0c1 \ub300\ubcf8 \uc791\uc131</div>
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
                            <span style={{fontSize:9, fontWeight:700, color:rc,
                              background:rc+'22', padding:'2px 7px', borderRadius:3}}>
                              {c.riskLevel}
                            </span>
                            <span style={{fontSize:10, fontWeight:700, color:'#e2e8f0'}}>
                              {c.clauseId}
                            </span>
                            <span style={{fontSize:10, color:'#8899aa'}}>{c.title}</span>
                            <span style={{marginLeft:'auto', fontSize:9, fontWeight:700,
                              color:pc, background:pc+'18', padding:'2px 7px', borderRadius:3}}>
                              {posLabel[c.ktPosition]}
                            </span>
                          </div>
                          <div style={{padding:'10px 12px', display:'grid',
                            gridTemplateColumns:'1fr 1fr', gap:10}}>
                            <div>
                              <div style={{fontSize:8, color:'#a78bfa', fontWeight:700,
                                marginBottom:4}}>Palantir\uac00 \uc6d0\ud558\ub294 \uac83</div>
                              <div style={{fontSize:10, color:'#9aaabb', lineHeight:1.6}}>
                                {c.palantirProposal}
                              </div>
                            </div>
                            <div>
                              <div style={{fontSize:8, color:rc, fontWeight:700,
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
                            <span style={{marginLeft:'auto', fontSize:9, color:pc,
                              background:pc+'18', padding:'2px 7px', borderRadius:3, fontWeight:700}}>
                              \uc131\uacf5\ud655\ub960 {pkg.successProbability}
                            </span>
                          </div>
                          <div style={{padding:'12px 14px', display:'grid',
                            gridTemplateColumns:'1fr 1fr', gap:12}}>
                            <div style={{padding:'8px 10px', background:'#1a0a0a',
                              borderRadius:5, border:'1px solid #ff444422'}}>
                              <div style={{fontSize:8, color:'#ff6b6b', fontWeight:700,
                                marginBottom:6}}>KT\uac00 \uc591\ubcf4\ud558\ub294 \uac83</div>
                              {pkg.ktGives.map((g, j) => (
                                <div key={j} style={{fontSize:9, color:'#cc8888',
                                  marginBottom:4, paddingLeft:8,
                                  borderLeft:'2px solid #ff444433', lineHeight:1.5}}>
                                  {g}
                                </div>
                              ))}
                            </div>
                            <div style={{padding:'8px 10px', background:'#0a1a0a',
                              borderRadius:5, border:'1px solid #10b98122'}}>
                              <div style={{fontSize:8, color:'#10b981', fontWeight:700,
                                marginBottom:6}}>KT\uac00 \uc5bb\ub294 \uac83</div>
                              {pkg.ktGets.map((g, j) => (
                                <div key={j} style={{fontSize:9, color:'#88bb99',
                                  marginBottom:4, paddingLeft:8,
                                  borderLeft:'2px solid #10b98133', lineHeight:1.5}}>
                                  {g}
                                </div>
                              ))}
                            </div>
                          </div>
                          <div style={{padding:'8px 14px', borderTop:'1px solid #1e2030',
                            fontSize:9, color:'#6677aa', lineHeight:1.5}}>
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
                      <div style={{fontSize:9, color:'#60a5fa', fontWeight:700, marginBottom:6}}>
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
                      <div style={{fontSize:9, color:'#10b981', fontWeight:700, marginBottom:8}}>
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
                      <div style={{fontSize:9, color:'#f59e0b', fontWeight:700, marginBottom:6}}>
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
