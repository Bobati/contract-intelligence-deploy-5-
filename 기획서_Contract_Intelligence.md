# KT–Palantir 계약 인텔리전스 플랫폼
### 최종 기획서

---

## 서비스 링크

| 구분 | URL |
|------|-----|
| **서비스 배포 URL** | https://contract-kt-palantir.vercel.app |
| **GitHub 소스코드** | https://github.com/Bobati/contract-intelligence-deploy-5- |

---

## 1. 문제 정의

KT와 Palantir 간 파트너십 계약(SAA, TOS, Order Form 등)은 수백 페이지의 영문 법률 문서로 구성되어 있다. 실무 담당자가 특정 이슈를 분석하려면:

- 관련 조항을 수동으로 검색·대조해야 함
- KT 측 입장과 Palantir 측 반론을 동시에 고려해야 함
- TOS(이용약관)가 SAA(본계약)와 충돌하는지 별도 검토해야 함
- 분석 결과를 보고서로 정리하는 데 수 시간 소요

이 플랫폼은 위 과정을 **AI 기반 병렬 분석**으로 수 분 내에 자동화한다.

---

## 2. 서비스 개요

KT–Palantir 계약의 **법적 리스크를 실시간으로 분석**하는 AI 계약 인텔리전스 플랫폼이다.

실무 담당자가 계약 이슈를 자연어로 입력하면, KT 측 변호사·Palantir 측 변호사·TOS 전문가의 역할을 수행하는 3개의 AI 에이전트가 동시에 분석을 수행하고, 최종 판사 역할의 AI가 종합 판단을 내린다.

---

## 3. 핵심 기능

### 3-1. 이슈 분석 (3단계 병렬 AI 아키텍처)

```
Stage 1 (병렬)
  ├─ KT 변호사 AI   : SAA·OF3·OF4 기반 KT 유리 논거 구성
  ├─ Palantir 변호사 AI : Palantir 입장에서 예상 반론 구성
  └─ TOS 분석 AI   : TOS 조항 위반 리스크 독립 분석

Stage 2 (순차)
  └─ 판사 AI       : 3개 분석 통합 → 종합 의견 + 리스크 등급
```

- **자동 모드 감지**: 입력 이슈 내용을 분석해 기본(SAA·OF)/확장(하도급·개인정보·공정거래법 포함) 모드 자동 선택
- **중단 기능**: 분석 중 언제든 취소 가능 (AbortController)
- **종합 의견**: 분석 결론을 한 문장으로 요약 (리스크 색상 연동)

### 3-2. 문서 관리

| 문서 유형 | 설명 |
|-----------|------|
| SAA | Software Reseller Agreement (본계약) |
| TOS | Terms of Service (Palantir 이용약관) |
| OF3 | Order Form 3 (Enablement Program) |
| OF4 | Order Form 4 (Cloud 라이선스) |
| AMD | Amendment (계약 변경서) — AI 자동 파싱 후 KB 반영 |

- PDF·DOCX·TXT 업로드 지원
- AMD 업로드 시: 변경 조항 자동 추출 → 검토 패널 → KB 반영 확인 플로우

### 3-3. 조항 지식베이스 (CONTRACT_KB)

- SAA 40개 + TOS 17개 + OF3 4개 + OF4 5개 조항 수록
- 각 조항: 원문·한국어 전문번역·핵심 요약·KT 리스크 분석 포함
- 조항 클릭 시 팝업으로 원문·번역 확인

### 3-4. Hurdle 트래커

KT의 핵심 KPI인 누적 Net Revenue Hurdle($55M) 달성 현황을 실시간 추적한다.

- QRC(Qualified Resale Contract) 실적 등록·관리
- 달성률 시각화, 예측 추이 표시
- Supabase 기반 영구 저장 (세션 공유 가능)

### 3-5. 분석 리포트 출력

분석 결과를 A4 인쇄용 HTML 리포트로 자동 생성한다.

| 구성 | 내용 |
|------|------|
| 본문 (1페이지) | 이슈 요약 + 종합 의견 + 상황·법적 분석 + 리스크 근거 |
| 별첨 A | KT 방어 전략 전문 |
| 별첨 B | Palantir 예상 반론 전문 |
| 별첨 C | 즉시 조치사항 |
| 별첨 D | 관련 조항 요약 |
| 별첨 E | 조항 원문 전문 |

---

## 4. 기술 아키텍처

```
Frontend (React SPA)
  └─ IssueAnalyzer.jsx  — 전체 로직 단일 파일
       ├─ CONTRACT_KB   — 조항 지식베이스 (정적)
       ├─ CLAUSE_FULLTEXT — 조항 원문·번역 (정적)
       └─ Supabase      — kv_store (허들 실적, AMD 패치 이력)

Backend (Vercel Serverless)
  └─ /api/chat          — Claude API 프록시
       └─ claude-opus-4-6 / claude-sonnet-4-6

External
  ├─ Anthropic Claude API  — AI 분석 엔진
  └─ Supabase              — 영구 데이터 저장
```

### 사용 기술
- **Frontend**: React 18, Vite, CSS-in-JS
- **AI**: Anthropic Claude (Opus/Sonnet)
- **Backend**: Vercel Serverless Functions
- **Storage**: Supabase (PostgreSQL kv_store)
- **PDF 처리**: pdf.js + Tesseract.js (스캔 PDF OCR)
- **DOCX 처리**: Mammoth.js

---

## 5. 주요 설계 결정

### 충돌 감지 시스템
SAA와 TOS 간 5개 주요 충돌 조항을 사전 분석하여 KB에 내장:
- XC-001: 서비스 정지권 충돌 (SAA §6.2 vs TOS §8.4)
- XC-002: Liability Cap 충돌 (SAA §8.2 $10M vs TOS §12 $100K)
- XC-003: 준거법 충돌 (SAA §9.0 한국법/서울 vs TOS §13 영국법/런던)
- IC-001: Hurdle 산입 범위 충돌
- IC-002: 해지 후 수익배분 충돌

### Amendment 자동 파싱
AMD 업로드 시 3단계 파싱 시도:
1. 청크 기반 AI 추출 (SAA 조항 참조 60개로 최적화)
2. 전문 AMENDMENT_PARSE_PROMPT 프롬프트
3. 구조화 라인 포맷 추출 (최후 안전장치)

---

## 6. 서비스 화면 구성

| 탭 | 기능 |
|----|------|
| 이슈 분석 | 이슈 입력 → 3단계 병렬 AI 분석 → 결과 (종합 의견, KT 전략, 반론, TOS, 조항) → 리포트 출력 |
| 문서 관리 | 계약서 업로드·조회, AMD 검토·반영, 조항 원문 뷰어 |
| Hurdle 추적 | QRC 실적 등록, 달성 현황 시각화 |

---

## 7. 향후 개선 방향

1. **다국어 지원**: 영문 리포트 자동 생성
2. **협업 기능**: 멀티 사용자 분석 공유 및 코멘트
3. **알림 시스템**: Hurdle 임박 시 이메일/슬랙 알림
4. **계약 버전 관리**: AMD 이력 추적 및 조항 변경 이력 시각화
5. **타 계약 확장**: Palantir 외 다른 파트너십 계약 분석 지원

---

## 8. 제출 정보

| 항목 | 내용 |
|------|------|
| 서비스 URL | https://contract-kt-palantir.vercel.app |
| GitHub | https://github.com/Bobati/contract-intelligence-deploy-5- |
| 개발 기간 | 2025년 ~ 2026년 3월 |
| 기술 스택 | React, Vite, Vercel, Claude API, Supabase |

---

*본 플랫폼은 KT의 Palantir 파트너십 계약 관리 효율화를 위해 개발된 AI 기반 계약 인텔리전스 도구입니다.*
