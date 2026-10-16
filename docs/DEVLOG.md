# 개발 기록 (DEVLOG)

## 2026-10-17 (D1)
### 결정 (사용자 부재 중 자율 진행, 10/17 사용자 지시 "너 판단으로 계속 진행")
- spec Q4: 전용 키 대신 형제 저장소의 기존 ANTHROPIC_API_KEY를 쓰고, 코드상 출품 누적 예산 상한 USD 50(풀 키 `pl26:budget:*`)으로 막는다. 콘솔 상한은 사용자 확인 대상.
- spec Q6: 같은 대회 프로젝트이므로 push·Vercel 배포 자동 위임을 이 저장소에도 적용한다.
- spec Q7: 형제 Upstash를 키 접두사 `pl26:`로 공유한다(새 DB 생성은 외부 계정 작업이라 보류). 장애 격리 한계는 기록.
- spec Q11: 에이전트 작업 시간이 하루 5h 가정보다 길므로 C2(문서→DSL)를 Must로 유지한다.
- Q1·Q2·Q3·Q8·Q9·Q10은 기본안으로 진행하고 최종 보고에서 확인받는다.

### 완료
- 리서치 run power-outage-lifeline-sim-95b993 출하(형제 저장소 research/), 인계 research/handoff_power.md
- 설계 패널(시안 3 → 심사 3 → 종합 → 레드팀 3라운드): docs/spec.md, docs/design/panel-summary.md
- 앱 골격(app/, Next.js 16·React 19·TS·Tailwind 4·vitest·Anthropic SDK)
