# 시연영상 사용 소스 목록 (인수인계서 5.2절 8번, 5.4절)

| 구분 | 무엇 | 출처·버전 | 라이선스·이용 조건 | 비고 |
|---|---|---|---|---|
| 화면 | 운영 사이트 화면 녹화 | https://power-safety-net-ai.vercel.app (2026-10-31 녹화) | 자체 저작물 | 가구·자원은 시연용 합성 데이터. 사이트 일러스트는 AI 생성(사이트에 표기) |
| 음성 | 내레이션 TTS | Microsoft Edge 읽기 서비스의 `ko-KR-SunHiNeural` 음성, `edge-tts` 7.3.1(Python)로 생성 | **확인 필요**: Microsoft가 Edge 읽기 음성의 녹음물 이용 조건을 별도로 공개하지 않았습니다. 비영리 공모전 제출물에 쓰지만 상업 이용 허락을 확인한 것은 아닙니다. 영상 끝 자막에 TTS 사용을 밝혔습니다 | 상업 이용이 필요해지면 Azure AI Speech(유료, 상업 이용 약관 있음)로 같은 음성을 다시 생성 |
| 글꼴 | 자막·장 표시·엔딩 카드 | Noto Sans KR(Google Fonts, `@remotion/google-fonts` 4.0.539) | SIL Open Font License 1.1 | 화면 속 사이트 글꼴은 사이트 자체(Pretendard 하위집합·시스템 글꼴) |
| 편집 | 합성·렌더 | Remotion 4.0.539 | Remotion License: 개인·3인 이하 팀 무료 | 프로젝트 `video/` |
| 녹화 | 브라우저 자동 조작·화면 캐스트 | Playwright 1.64.1(Chromium) | Apache-2.0 | 커서는 녹화 스크립트가 그린 표시(`video/record/record.mts`) |
| 인코딩 | 클립 인코딩 | FFmpeg 9.0(gyan.dev full build) | 도구로만 사용(GPL), 결과물에 코드 포함 없음 | |
| 음악·효과음 | 없음 | — | — | 넣지 않음 |
| 레퍼런스 | 구조 참고만 | `research/video-references.md` | 영상·음성·화면을 가져다 쓰지 않음 | |
