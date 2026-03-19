const PptxGenJS = require("pptxgenjs");
const pptx = new PptxGenJS();

// ── 공통 설정 ──────────────────────────────────────────────────────────────
const BG_DARK   = "0B1120";   // 배경 (거의 검정)
const BG_CARD   = "111827";   // 카드 배경
const BG_ACCENT = "1E3A5F";   // 강조 패널 배경
const C_WHITE   = "FFFFFF";
const C_BLUE    = "60A5FA";   // 밝은 파랑
const C_TEAL    = "2DD4BF";   // 청록
const C_ORANGE  = "FB923C";   // 오렌지
const C_GRAY    = "94A3B8";   // 회색
const C_YELLOW  = "FCD34D";   // 노랑
const C_GREEN   = "34D399";   // 초록

pptx.layout   = "LAYOUT_WIDE";   // 13.33 × 7.5 인치
pptx.author   = "KT Contract Intelligence";
pptx.company  = "KT";
pptx.subject  = "KT–Palantir 계약 인텔리전스 플랫폼";
pptx.title    = "Contract Intelligence 기획서";

// ── helper: 슬라이드 기본 배경 ─────────────────────────────────────────────
function newSlide() {
  const s = pptx.addSlide();
  s.background = { color: BG_DARK };
  return s;
}

// ── helper: 상단 제목 바 ───────────────────────────────────────────────────
function addHeader(slide, title, subtitle) {
  // 상단 구분선
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: "100%", h: 0.06,
    fill: { color: C_BLUE }, line: { color: C_BLUE },
  });
  slide.addText(title, {
    x: 0.4, y: 0.18, w: 12.5, h: 0.52,
    fontSize: 22, bold: true, color: C_WHITE, fontFace: "Malgun Gothic",
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.4, y: 0.72, w: 12.5, h: 0.32,
      fontSize: 12, color: C_BLUE, fontFace: "Malgun Gothic",
    });
  }
  // 하단 구분선
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.4, y: 1.08, w: 12.53, h: 0.03,
    fill: { color: BG_ACCENT }, line: { color: BG_ACCENT },
  });
}

// ── helper: 카드 박스 ──────────────────────────────────────────────────────
function addCard(slide, x, y, w, h, opts = {}) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h,
    fill: { color: opts.fill || BG_CARD },
    line: { color: opts.border || C_BLUE, pt: 1 },
    rectRadius: 0.08,
  });
}

// ── helper: 섹션 레이블 ────────────────────────────────────────────────────
function addLabel(slide, text, x, y, color) {
  slide.addText(text, {
    x, y, w: 3, h: 0.25,
    fontSize: 9, bold: true, color: color || C_BLUE,
    fontFace: "Malgun Gothic",
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SLIDE 1 – 표지
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = newSlide();

  // 왼쪽 색 블록
  s.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.22, h: "100%",
    fill: { color: C_BLUE }, line: { color: C_BLUE },
  });

  // 메인 제목
  s.addText("KT–Palantir\n계약 인텔리전스 플랫폼", {
    x: 0.55, y: 1.6, w: 8, h: 1.9,
    fontSize: 38, bold: true, color: C_WHITE,
    fontFace: "Malgun Gothic", lineSpacingMultiple: 1.2,
  });

  // 부제
  s.addText("AI 기반 계약 리스크 분석 · 문서 관리 · Hurdle 추적", {
    x: 0.55, y: 3.6, w: 9, h: 0.45,
    fontSize: 14, color: C_BLUE, fontFace: "Malgun Gothic",
  });

  // 구분선
  s.addShape(pptx.ShapeType.rect, {
    x: 0.55, y: 4.15, w: 5, h: 0.04,
    fill: { color: C_TEAL }, line: { color: C_TEAL },
  });

  // URL 정보
  s.addText("서비스 URL", {
    x: 0.55, y: 4.4, w: 2.5, h: 0.28,
    fontSize: 10, color: C_GRAY, fontFace: "Malgun Gothic",
  });
  s.addText("https://contract-kt-palantir.vercel.app", {
    x: 0.55, y: 4.65, w: 8, h: 0.3,
    fontSize: 12, color: C_TEAL, fontFace: "Malgun Gothic", bold: true,
  });
  s.addText("GitHub", {
    x: 0.55, y: 5.05, w: 2.5, h: 0.28,
    fontSize: 10, color: C_GRAY, fontFace: "Malgun Gothic",
  });
  s.addText("https://github.com/Bobati/contract-intelligence-deploy-5-", {
    x: 0.55, y: 5.3, w: 10, h: 0.3,
    fontSize: 12, color: C_TEAL, fontFace: "Malgun Gothic",
  });

  // 날짜
  s.addText("2026년 3월", {
    x: 0.55, y: 6.6, w: 3, h: 0.3,
    fontSize: 11, color: C_GRAY, fontFace: "Malgun Gothic",
  });

  // 우측 데코 원
  s.addShape(pptx.ShapeType.ellipse, {
    x: 10.2, y: 0.5, w: 3.5, h: 3.5,
    fill: { color: "1E3A5F" }, line: { color: "60A5FA", pt: 1 },
  });
  s.addShape(pptx.ShapeType.ellipse, {
    x: 11.0, y: 3.5, w: 2.2, h: 2.2,
    fill: { color: "0F2040" }, line: { color: "2DD4BF", pt: 1 },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SLIDE 2 – 문제 정의
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = newSlide();
  addHeader(s, "문제 정의", "왜 이 플랫폼이 필요한가?");

  const pains = [
    { icon: "📄", title: "수백 페이지 영문 법률 문서", desc: "SAA·TOS·Order Form을 수동으로\n대조·검색하는 데 수 시간 소요" },
    { icon: "⚖️", title: "복잡한 이해관계 분석", desc: "KT 입장과 Palantir 예상 반론을\n동시에 고려해야 하는 어려움" },
    { icon: "🔗", title: "문서 간 충돌 조항", desc: "SAA와 TOS가 서로 상충하는\n조항 5개 이상 — 놓치면 리스크" },
    { icon: "💰", title: "Hurdle 달성 추적 부재", desc: "$55M 목표 대비 누적 실적을\n실시간으로 파악하기 어려움" },
  ];

  pains.forEach((p, i) => {
    const x = i < 2 ? 0.4 + (i * 6.3) : 0.4 + ((i-2) * 6.3);
    const y = i < 2 ? 1.3 : 4.0;
    addCard(s, x, y, 6.0, 2.4, { border: C_ORANGE });
    s.addText(p.icon + " " + p.title, {
      x: x+0.2, y: y+0.2, w: 5.6, h: 0.42,
      fontSize: 13, bold: true, color: C_ORANGE, fontFace: "Malgun Gothic",
    });
    s.addText(p.desc, {
      x: x+0.2, y: y+0.72, w: 5.6, h: 1.4,
      fontSize: 12, color: C_WHITE, fontFace: "Malgun Gothic",
      lineSpacingMultiple: 1.4,
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SLIDE 3 – 솔루션 개요
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = newSlide();
  addHeader(s, "솔루션 개요", "AI 3중 병렬 분석으로 계약 리스크를 즉시 파악");

  // 중앙 설명
  s.addText(
    "실무 담당자가 계약 이슈를 자연어로 입력하면,\nKT 변호사 · Palantir 변호사 · TOS 전문가 역할의 AI 에이전트가 동시에 분석하고\n최종 판사 AI가 종합 판단 및 리스크 등급을 산출합니다.",
    {
      x: 0.4, y: 1.15, w: 12.5, h: 1.0,
      fontSize: 13, color: C_GRAY, fontFace: "Malgun Gothic",
      lineSpacingMultiple: 1.5, align: "center",
    }
  );

  // 아키텍처 박스 — Stage 1
  addCard(s, 0.4, 2.3, 12.5, 1.1, { fill: BG_ACCENT, border: C_BLUE });
  s.addText("Stage 1  ·  병렬 분석", {
    x: 0.6, y: 2.35, w: 3, h: 0.3,
    fontSize: 9, color: C_BLUE, bold: true, fontFace: "Malgun Gothic",
  });
  const agents = [
    { label: "⚖  KT 변호사 AI", desc: "SAA·OF 기반\nKT 유리 논거", color: C_GREEN },
    { label: "🔴  Palantir 변호사 AI", desc: "Palantir 입장\n예상 반론 구성", color: C_ORANGE },
    { label: "📋  TOS 분석 AI", desc: "TOS 리스크\n독립 분석", color: C_YELLOW },
  ];
  agents.forEach((a, i) => {
    const x = 0.6 + i * 4.15;
    addCard(s, x, 2.62, 3.8, 0.65, { fill: "0D1F35", border: a.color });
    s.addText(a.label, { x: x+0.12, y: 2.67, w: 3.5, h: 0.28, fontSize: 11, bold: true, color: a.color, fontFace: "Malgun Gothic" });
    s.addText(a.desc, { x: x+0.12, y: 2.95, w: 3.5, h: 0.3, fontSize: 9, color: C_GRAY, fontFace: "Malgun Gothic" });
  });

  // 화살표
  s.addShape(pptx.ShapeType.rect, { x: 6.26, y: 3.44, w: 0.8, h: 0.04, fill: { color: C_BLUE }, line: { color: C_BLUE } });
  s.addText("▼", { x: 6.4, y: 3.42, w: 0.5, h: 0.3, fontSize: 14, color: C_BLUE, fontFace: "Malgun Gothic" });

  // Stage 2
  addCard(s, 0.4, 3.78, 12.5, 0.85, { fill: "1A0A2E", border: C_TEAL });
  s.addText("Stage 2  ·  종합 판단", {
    x: 0.6, y: 3.83, w: 3, h: 0.3,
    fontSize: 9, color: C_TEAL, bold: true, fontFace: "Malgun Gothic",
  });
  addCard(s, 4.5, 3.9, 4.3, 0.65, { fill: "0D1A2E", border: C_TEAL });
  s.addText("🧑‍⚖️  판사 AI", { x: 4.65, y: 3.95, w: 3.8, h: 0.28, fontSize: 12, bold: true, color: C_TEAL, fontFace: "Malgun Gothic" });
  s.addText("3개 분석 통합 → 종합 의견 + 리스크 등급 산출", { x: 4.65, y: 4.22, w: 4, h: 0.28, fontSize: 9, color: C_GRAY, fontFace: "Malgun Gothic" });

  // 출력
  const outputs = ["종합 의견\n(리스크 등급)", "KT 방어\n전략", "Palantir\n예상 반론", "TOS 위반\n리스크", "관련 조항\n원문"];
  s.addText("▼ 분석 결과", { x: 0.4, y: 4.72, w: 3, h: 0.28, fontSize: 10, color: C_GRAY, fontFace: "Malgun Gothic" });
  outputs.forEach((o, i) => {
    const x = 0.4 + i * 2.5;
    addCard(s, x, 5.05, 2.25, 0.85, { fill: "0A1628", border: "334155" });
    s.addText(o, { x: x+0.08, y: 5.12, w: 2.1, h: 0.72, fontSize: 10, color: C_WHITE, fontFace: "Malgun Gothic", align: "center", lineSpacingMultiple: 1.3 });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SLIDE 4 – 핵심 기능 (1) 이슈 분석
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = newSlide();
  addHeader(s, "핵심 기능 ①  이슈 분석", "자연어 입력 → AI 3중 병렬 분석 → 즉시 결과");

  const features = [
    { icon: "🤖", title: "자동 모드 감지", desc: "입력 이슈를 분석해 기본(SAA·OF) / 확장(하도급·개인정보·공정거래법) 모드 자동 선택. 수동 전환도 가능." },
    { icon: "📌", title: "이슈 입력 템플릿", desc: "계약 위반·대금 미지급·영업 제한 등 유형별 2줄 스타터 템플릿 제공으로 입력 부담 최소화." },
    { icon: "🎨", title: "리스크 색상 코딩", desc: "HIGH(빨강) · MEDIUM(주황) · LOW(초록) 3단계 시각적 표시. 종합 의견 박스에 리스크 색상 연동." },
    { icon: "✕", title: "분석 중단 버튼", desc: "분석 진행 중 언제든 취소 가능. AbortController로 모든 병렬 API 호출 즉시 중단." },
    { icon: "📊", title: "분석 리포트 출력", desc: "본문 1페이지 + 별첨 A~E 구성의 A4 인쇄용 HTML 리포트 자동 생성." },
    { icon: "🔗", title: "조항 링크", desc: "분석 결과 내 조항 번호(SAA §3.2 등) 클릭 시 원문·번역 팝업 즉시 표시." },
  ];

  features.forEach((f, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 0.4 + col * 4.33;
    const y = 1.3 + row * 2.8;
    addCard(s, x, y, 4.05, 2.5, { border: C_BLUE });
    s.addText(f.icon + " " + f.title, { x: x+0.18, y: y+0.18, w: 3.7, h: 0.4, fontSize: 13, bold: true, color: C_BLUE, fontFace: "Malgun Gothic" });
    s.addText(f.desc, { x: x+0.18, y: y+0.65, w: 3.7, h: 1.7, fontSize: 11, color: C_WHITE, fontFace: "Malgun Gothic", lineSpacingMultiple: 1.4 });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SLIDE 5 – 핵심 기능 (2) 문서 관리 & AMD
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = newSlide();
  addHeader(s, "핵심 기능 ②  문서 관리 & Amendment 파싱", "계약서 업로드 → AI 자동 추출 → 검토 → KB 반영");

  // 문서 유형 표
  s.addText("지원 문서 유형", { x: 0.4, y: 1.25, w: 5, h: 0.3, fontSize: 11, color: C_BLUE, bold: true, fontFace: "Malgun Gothic" });
  const docs = [
    ["SAA", "Software Reseller Agreement", "본계약 — 핵심 조항 40개 내장"],
    ["TOS", "Terms of Service", "Palantir 이용약관 — 17개 조항"],
    ["OF3", "Order Form 3", "Enablement Program — 4개 조항"],
    ["OF4", "Order Form 4", "Cloud 라이선스 — 5개 조항"],
    ["AMD", "Amendment", "계약 변경서 — AI 자동 파싱"],
  ];
  docs.forEach((d, i) => {
    const y = 1.65 + i * 0.62;
    addCard(s, 0.4, y, 5.8, 0.55, { fill: i === 4 ? "1A2A1A" : "0D1A2E", border: i === 4 ? C_GREEN : "1E3A5F" });
    s.addText(d[0], { x: 0.6, y: y+0.13, w: 0.7, h: 0.3, fontSize: 11, bold: true, color: i === 4 ? C_GREEN : C_BLUE, fontFace: "Malgun Gothic" });
    s.addText(d[1], { x: 1.35, y: y+0.13, w: 2.5, h: 0.3, fontSize: 10, color: C_WHITE, fontFace: "Malgun Gothic" });
    s.addText(d[2], { x: 3.9, y: y+0.13, w: 2.2, h: 0.3, fontSize: 9, color: C_GRAY, fontFace: "Malgun Gothic" });
  });

  // AMD 파싱 플로우
  s.addText("AMD 자동 파싱 플로우", { x: 6.6, y: 1.25, w: 6, h: 0.3, fontSize: 11, color: C_GREEN, bold: true, fontFace: "Malgun Gothic" });
  const steps = [
    { n: "1", t: "파일 업로드", d: "PDF · DOCX · TXT 지원\nOCR(스캔 PDF) 자동 처리" },
    { n: "2", t: "AI 청크 추출", d: "SAA 조항 참조 60개 기반\n변경 조항 자동 식별 및 분류" },
    { n: "3", t: "검토 패널", d: "변경 전·후 전문 비교 뷰어\n조항별 선택적 반영 가능" },
    { n: "4", t: "KB 반영", d: "확인 후 Contract KB 업데이트\n이후 이슈 분석에 즉시 반영" },
  ];
  steps.forEach((st, i) => {
    const y = 1.6 + i * 1.35;
    addCard(s, 6.6, y, 6.3, 1.18, { fill: "0A1A0A", border: C_GREEN });
    s.addText(st.n, { x: 6.75, y: y+0.1, w: 0.5, h: 0.55, fontSize: 22, bold: true, color: C_GREEN, fontFace: "Malgun Gothic" });
    s.addText(st.t, { x: 7.3, y: y+0.1, w: 5.4, h: 0.32, fontSize: 12, bold: true, color: C_WHITE, fontFace: "Malgun Gothic" });
    s.addText(st.d, { x: 7.3, y: y+0.46, w: 5.4, h: 0.65, fontSize: 10, color: C_GRAY, fontFace: "Malgun Gothic", lineSpacingMultiple: 1.3 });
    if (i < 3) s.addText("▼", { x: 7.0, y: y+1.18, w: 0.5, h: 0.15, fontSize: 10, color: C_GREEN, fontFace: "Malgun Gothic" });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SLIDE 6 – 핵심 기능 (3) Hurdle 추적 & 충돌 감지
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = newSlide();
  addHeader(s, "핵심 기능 ③  Hurdle 추적 & 충돌 감지", "KT 핵심 KPI 실시간 관리 + 계약 간 리스크 사전 탐지");

  // Hurdle 트래커 섹션
  s.addText("💰  Hurdle 트래커", { x: 0.4, y: 1.25, w: 6, h: 0.35, fontSize: 14, bold: true, color: C_YELLOW, fontFace: "Malgun Gothic" });
  addCard(s, 0.4, 1.68, 6.1, 4.6, { fill: "0D1A10", border: C_YELLOW });

  const hurdleItems = [
    { label: "목표 Hurdle", val: "$55,000,000", color: C_YELLOW },
    { label: "현황 추적 단위", val: "QRC (Qualified Resale Contract)", color: C_WHITE },
    { label: "저장 방식", val: "Supabase 영구 저장 (세션 공유 가능)", color: C_WHITE },
  ];
  hurdleItems.forEach((h, i) => {
    s.addText(h.label, { x: 0.6, y: 1.85 + i * 0.6, w: 2.5, h: 0.3, fontSize: 10, color: C_GRAY, fontFace: "Malgun Gothic" });
    s.addText(h.val, { x: 3.1, y: 1.85 + i * 0.6, w: 3.2, h: 0.3, fontSize: 10, color: h.color, fontFace: "Malgun Gothic", bold: true });
  });

  // 시각적 Hurdle 바
  s.addText("누적 달성률 시뮬레이션", { x: 0.6, y: 3.7, w: 5.5, h: 0.28, fontSize: 10, color: C_GRAY, fontFace: "Malgun Gothic" });
  s.addShape(pptx.ShapeType.rect, { x: 0.6, y: 4.05, w: 5.5, h: 0.38, fill: { color: "1E2D1E" }, line: { color: "334155" } });
  s.addShape(pptx.ShapeType.rect, { x: 0.6, y: 4.05, w: 5.5 * 0.32, h: 0.38, fill: { color: C_YELLOW }, line: { color: C_YELLOW } });
  s.addText("32% 달성 ($17.6M / $55M)", { x: 0.6, y: 4.5, w: 5.5, h: 0.28, fontSize: 10, color: C_YELLOW, fontFace: "Malgun Gothic" });

  const hFeatures = ["QRC 실적 등록 · 수정 · 삭제", "달성률 시각화 바", "예측 추이 표시", "Supabase 실시간 동기화"];
  hFeatures.forEach((f, i) => {
    s.addText("• " + f, { x: 0.6, y: 5.0 + i * 0.42, w: 5.5, h: 0.38, fontSize: 11, color: C_WHITE, fontFace: "Malgun Gothic" });
  });

  // 충돌 감지 섹션
  s.addText("⚡  충돌 조항 감지 (내장)", { x: 6.8, y: 1.25, w: 6, h: 0.35, fontSize: 14, bold: true, color: C_ORANGE, fontFace: "Malgun Gothic" });
  const conflicts = [
    { id: "XC-001", risk: "HIGH", desc: "서비스 정지권\nSAA §6.2(20일 통보) vs TOS §8.4(즉시 정지)" },
    { id: "XC-002", risk: "HIGH", desc: "Liability Cap\nSAA §8.2($10M) vs TOS §12($100K)" },
    { id: "XC-003", risk: "MED", desc: "준거법·중재지\nSAA §9.0(한국법/서울) vs TOS §13(영국법/런던)" },
    { id: "IC-001", risk: "MED", desc: "Hurdle 산입 범위\nCo-Sell 수익의 Hurdle 포함 여부" },
    { id: "IC-002", risk: "LOW", desc: "해지 후 수익 배분\n§2.11(10/90) vs §6.3(good faith 협상)" },
  ];
  conflicts.forEach((c, i) => {
    const y = 1.68 + i * 1.05;
    const rColor = c.risk === "HIGH" ? "EF4444" : c.risk === "MED" ? C_ORANGE : C_GREEN;
    addCard(s, 6.8, y, 6.1, 0.92, { fill: "1A0D00", border: rColor });
    s.addText(c.id, { x: 7.0, y: y+0.12, w: 1.1, h: 0.28, fontSize: 10, bold: true, color: rColor, fontFace: "Malgun Gothic" });
    s.addText(c.risk, { x: 8.15, y: y+0.12, w: 0.9, h: 0.24, fontSize: 9, bold: true, color: rColor, fontFace: "Malgun Gothic", align: "center" });
    s.addText(c.desc, { x: 7.0, y: y+0.44, w: 5.7, h: 0.42, fontSize: 9, color: C_GRAY, fontFace: "Malgun Gothic", lineSpacingMultiple: 1.2 });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SLIDE 7 – 기술 아키텍처
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = newSlide();
  addHeader(s, "기술 아키텍처", "React SPA · Vercel Serverless · Azure OpenAI (GPT-5 Nano) · Supabase");

  // 레이어 박스들
  const layers = [
    { label: "Frontend (React 18 + Vite)", color: C_BLUE, fill: "0D1A2E",
      items: ["IssueAnalyzer.jsx — 전체 로직 단일 파일", "CONTRACT_KB — 조항 지식베이스 (정적)", "CLAUSE_FULLTEXT — 조항 원문·번역 (정적)", "pdf.js + Tesseract.js — PDF/OCR 처리", "Mammoth.js — DOCX 추출"] },
    { label: "Backend (Vercel Serverless)", color: C_TEAL, fill: "0A1A1A",
      items: ["/api/chat — Azure OpenAI 프록시 (Node.js)", "환경변수 관리 (API Key 보호)", "스트리밍 응답 처리"] },
    { label: "AI Engine (Azure OpenAI)", color: C_ORANGE, fill: "1A0D00",
      items: ["GPT-5 Nano (gpt-5-nano-03) — 모든 분석 단계", "Azure East US 2 리전 배포", "3-way 동시 호출 + AbortController"] },
    { label: "Storage (Supabase)", color: C_GREEN, fill: "0A1A0A",
      items: ["kv_store 테이블 — 키-값 범용 저장", "Hurdle 실적 데이터 영구 저장", "세션 기반 접근 (공유 가능)"] },
  ];

  layers.forEach((l, i) => {
    const x = i < 2 ? 0.4 + i * 6.35 : 0.4 + (i-2) * 6.35;
    const y = i < 2 ? 1.25 : 4.15;
    addCard(s, x, y, 6.1, 2.65, { fill: l.fill, border: l.color });
    s.addText(l.label, { x: x+0.2, y: y+0.15, w: 5.7, h: 0.35, fontSize: 12, bold: true, color: l.color, fontFace: "Malgun Gothic" });
    l.items.forEach((item, j) => {
      s.addText("• " + item, { x: x+0.2, y: y+0.58 + j*0.42, w: 5.7, h: 0.38, fontSize: 10, color: C_WHITE, fontFace: "Malgun Gothic" });
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SLIDE 8 – 제출 정보
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = newSlide();

  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: "100%", h: 0.06, fill: { color: C_TEAL }, line: { color: C_TEAL } });
  s.addText("제출 정보", {
    x: 0.4, y: 0.25, w: 12.5, h: 0.55,
    fontSize: 26, bold: true, color: C_WHITE, fontFace: "Malgun Gothic",
  });

  addCard(s, 0.4, 1.0, 12.5, 5.8, { fill: BG_CARD, border: C_TEAL });

  const rows = [
    { label: "서비스 URL", val: "https://contract-kt-palantir.vercel.app", color: C_TEAL },
    { label: "GitHub", val: "https://github.com/Bobati/contract-intelligence-deploy-5-", color: C_TEAL },
    { label: "기술 스택", val: "React 18 · Vite · Vercel · Azure OpenAI · Supabase", color: C_WHITE },
    { label: "AI 모델", val: "Azure OpenAI · GPT-5 Nano (2024-12-01-preview)", color: C_WHITE },
    { label: "지원 문서", val: "SAA · TOS · OF3 · OF4 · AMD (PDF · DOCX · TXT)", color: C_WHITE },
    { label: "저장소", val: "Supabase kv_store (영구 저장, 세션 공유)", color: C_WHITE },
  ];

  rows.forEach((r, i) => {
    const y = 1.3 + i * 0.82;
    s.addShape(pptx.ShapeType.rect, { x: 0.6, y: y, w: 0.04, h: 0.42, fill: { color: C_TEAL }, line: { color: C_TEAL } });
    s.addText(r.label, { x: 0.75, y: y, w: 2.6, h: 0.42, fontSize: 11, color: C_GRAY, fontFace: "Malgun Gothic", valign: "middle" });
    s.addText(r.val, { x: 3.4, y: y, w: 9.2, h: 0.42, fontSize: 12, bold: true, color: r.color, fontFace: "Malgun Gothic", valign: "middle" });
  });

  s.addText("KT–Palantir 계약 인텔리전스 플랫폼 · 2026년 3월", {
    x: 0.4, y: 6.95, w: 12.5, h: 0.3,
    fontSize: 10, color: C_GRAY, fontFace: "Malgun Gothic", align: "center",
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SLIDE NEW-A – 핵심 기능 (4) 분석 리포트 즉시 출력
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = newSlide();
  addHeader(s, "핵심 기능 ④  분석 리포트 즉시 출력", "분석 완료 즉시 A4 인쇄용 리포트 자동 생성 — 별도 작업 불필요");

  // 왼쪽: 리포트 구성도
  s.addText("리포트 구성", { x: 0.4, y: 1.25, w: 5.5, h: 0.32, fontSize: 12, bold: true, color: C_BLUE, fontFace: "Malgun Gothic" });

  const sections = [
    { label: "본문  (1페이지)", color: C_BLUE, fill: "0D1A2E", items: [
      "① 이슈 요약",
      "② 종합 의견 (리스크 등급 색상 연동)",
      "③ 상황 요약 + 법적 분석 (2단 레이아웃)",
      "④ 위험도 근거 · 충돌 태그",
    ]},
    { label: "별첨 A  KT 방어 전략", color: C_GREEN, fill: "0A1A0A", items: ["KT 측 법적 논거 전문", "유리한 조항 인용 및 전략"] },
    { label: "별첨 B  Palantir 예상 반론", color: C_ORANGE, fill: "1A0D00", items: ["Palantir 측 반론 전문", "대응 포인트 포함"] },
    { label: "별첨 C  즉시 조치사항", color: C_YELLOW, fill: "1A1500", items: ["당장 해야 할 액션 리스트"] },
    { label: "별첨 D  관련 조항 요약", color: C_TEAL, fill: "0A1A1A", items: ["분석에 활용된 조항 요약"] },
    { label: "별첨 E  조항 원문 전문", color: C_GRAY, fill: "111827", items: ["영문 원문 + 한국어 완역 전체"] },
  ];

  let yOff = 1.65;
  sections.forEach((sec, i) => {
    const h = i === 0 ? 1.85 : 0.72;
    addCard(s, 0.4, yOff, 5.8, h - 0.06, { fill: sec.fill, border: sec.color });
    s.addText(sec.label, { x: 0.6, y: yOff + 0.1, w: 5.4, h: 0.28, fontSize: i === 0 ? 12 : 10, bold: true, color: sec.color, fontFace: "Malgun Gothic" });
    if (i === 0) {
      sec.items.forEach((it, j) => {
        s.addText(it, { x: 0.6, y: yOff + 0.44 + j * 0.34, w: 5.4, h: 0.3, fontSize: 10, color: C_WHITE, fontFace: "Malgun Gothic" });
      });
    } else {
      s.addText(sec.items.join("  ·  "), { x: 0.6, y: yOff + 0.38, w: 5.4, h: 0.28, fontSize: 9, color: C_GRAY, fontFace: "Malgun Gothic" });
    }
    yOff += h;
  });

  // 오른쪽: 핵심 포인트
  s.addText("왜 이 기능이 중요한가", { x: 6.6, y: 1.25, w: 6.3, h: 0.32, fontSize: 12, bold: true, color: C_YELLOW, fontFace: "Malgun Gothic" });

  const points = [
    { icon: "⚡", title: "분석 즉시 리포트 완성", desc: "별도 정리 작업 없이 버튼 하나로 구조화된 보고서 생성. 상위 보고·법무팀 공유에 바로 활용 가능." },
    { icon: "📋", title: "본문 1페이지 원칙", desc: "핵심 결론을 1페이지에 압축. 별첨으로 세부 근거를 분리해 가독성과 활용도 모두 확보." },
    { icon: "🖨️", title: "A4 인쇄용 HTML 출력", desc: "브라우저 인쇄 기능으로 즉시 PDF 변환 가능. 별도 소프트웨어 불필요." },
    { icon: "⚖️", title: "양측 입장 동시 수록", desc: "KT 방어 전략(별첨A)과 Palantir 예상 반론(별첨B)이 한 문서에 — 협상 준비에 바로 활용." },
    { icon: "📌", title: "조항 원문 전문 포함", desc: "별첨E에 영문 원문 + 완역을 전부 수록. 외부 법무 자문 시 추가 자료 요청 없이 전달 가능." },
  ];

  points.forEach((p, i) => {
    const y = 1.65 + i * 1.1;
    addCard(s, 6.6, y, 6.3, 1.0, { fill: "0D1420", border: C_YELLOW });
    s.addText(p.icon + "  " + p.title, { x: 6.8, y: y + 0.1, w: 6.0, h: 0.3, fontSize: 12, bold: true, color: C_YELLOW, fontFace: "Malgun Gothic" });
    s.addText(p.desc, { x: 6.8, y: y + 0.45, w: 6.0, h: 0.48, fontSize: 10, color: C_WHITE, fontFace: "Malgun Gothic", lineSpacingMultiple: 1.35 });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SLIDE NEW-B – vs Google NotebookLM
// ═══════════════════════════════════════════════════════════════════════════
{
  const s = newSlide();
  addHeader(s, "왜 Google NotebookLM이 아닌가?", "범용 AI 도구 대비 전용 솔루션의 압도적 차이");

  // 상단 요약 문구
  s.addText(
    "NotebookLM에 계약서를 올려도 쓸 수는 있다 — 하지만 계약 실무에 필요한 것은 \"질문에 답하는 AI\"가 아니라 \"계약을 이해하고 판단하는 시스템\"이다.",
    { x: 0.4, y: 1.12, w: 12.5, h: 0.62, fontSize: 12, color: C_GRAY, fontFace: "Malgun Gothic", lineSpacingMultiple: 1.4, italic: true }
  );

  // 비교 테이블 헤더
  const COL_ITEM = 0.4, COL_NB = 5.2, COL_SOL = 9.2;
  const COL_W_ITEM = 4.6, COL_W = 3.8;

  addCard(s, COL_ITEM, 1.82, COL_W_ITEM, 0.4, { fill: "1E2030", border: "1E2030" });
  addCard(s, COL_NB,   1.82, COL_W,      0.4, { fill: "1E1E2E", border: "1E1E2E" });
  addCard(s, COL_SOL,  1.82, COL_W,      0.4, { fill: BG_ACCENT, border: C_BLUE });

  s.addText("비교 항목",         { x: COL_ITEM+0.15, y: 1.88, w: COL_W_ITEM, h: 0.28, fontSize: 11, bold: true, color: C_GRAY,   fontFace: "Malgun Gothic" });
  s.addText("🔵 Google NotebookLM", { x: COL_NB+0.15,   y: 1.88, w: COL_W,      h: 0.28, fontSize: 11, bold: true, color: "818CF8", fontFace: "Malgun Gothic" });
  s.addText("✅ 이 솔루션",       { x: COL_SOL+0.15,  y: 1.88, w: COL_W,      h: 0.28, fontSize: 11, bold: true, color: C_TEAL,   fontFace: "Malgun Gothic" });

  const rows = [
    ["분석 관점",        "단일 관점 응답\n(질문한 방향으로만)",         "KT + Palantir + TOS\n3-way 병렬 동시 분석"],
    ["리스크 등급화",    "없음\n(텍스트 답변만 제공)",                  "HIGH / MEDIUM / LOW\n색상 코딩 + 종합 의견"],
    ["보고서 출력",      "없음\n(채팅 로그만 남음)",                    "A4 리포트 즉시 생성\n(본문+별첨 A~E 완비)"],
    ["계약 충돌 감지",   "질문해야 확인 가능\n(사전 분석 없음)",         "SAA-TOS 충돌 5개\n사전 분석 내장"],
    ["계약 변경서(AMD)", "수동 재업로드 후 재질문",                     "AI 자동 파싱 →\n검토 → KB 즉시 반영"],
    ["KPI 추적",         "기능 없음",                                   "Hurdle($55M) 실적\n통합 추적 관리"],
    ["데이터 보안",      "Google 서버 저장\n(민감 계약 정보 외부 노출)", "Azure(KT 파트너)\n자체 환경 통제 가능"],
    ["계약 특화 KB",     "없음\n(업로드 문서에만 의존)",                 "조항 66개 + 충돌 분석\n사전 내장"],
  ];

  const ROW_H = 0.62;
  rows.forEach((row, i) => {
    const y = 2.28 + i * ROW_H;
    const bg = i % 2 === 0 ? "0A0F1A" : "0D1320";
    addCard(s, COL_ITEM, y, COL_W_ITEM, ROW_H - 0.04, { fill: bg,      border: "1E2A40" });
    addCard(s, COL_NB,   y, COL_W,      ROW_H - 0.04, { fill: "0D0D1A", border: "1E1E35" });
    addCard(s, COL_SOL,  y, COL_W,      ROW_H - 0.04, { fill: "081820", border: "1E3A50" });
    s.addText(row[0], { x: COL_ITEM+0.15, y: y+0.12, w: COL_W_ITEM-0.2, h: ROW_H-0.14, fontSize: 10, bold: true,  color: C_WHITE,   fontFace: "Malgun Gothic", valign: "middle" });
    s.addText(row[1], { x: COL_NB+0.15,   y: y+0.05, w: COL_W-0.2,      h: ROW_H-0.1,  fontSize: 9,  color: "6B7280", fontFace: "Malgun Gothic", lineSpacingMultiple: 1.25 });
    s.addText(row[2], { x: COL_SOL+0.15,  y: y+0.05, w: COL_W-0.2,      h: ROW_H-0.1,  fontSize: 9,  color: C_TEAL,   fontFace: "Malgun Gothic", lineSpacingMultiple: 1.25, bold: true });
  });
}

// ── 파일 저장 ─────────────────────────────────────────────────────────────
const OUTPUT = "기획서_Contract_Intelligence.pptx";
pptx.writeFile({ fileName: OUTPUT }).then(() => {
  console.log("✅ 생성 완료:", OUTPUT);
}).catch(e => {
  console.error("❌ 오류:", e.message);
});
