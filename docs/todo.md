# 진행 상황 / TODO

> 지금까지 한 작업 정리 + 분석·수정 내역(항목별 날짜 표기) + 앞으로 할 일. 완료된 기능 목록은 `docs/PRD.md` 3절, AI 세부사항은 `docs/TECHNICAL_SPEC.md` 5절, 버그 해결 기록은 `docs/TROUBLESHOOTING.md` 참고.

---

## 지금까지 한 작업 (커밋 순)

1. **MVP 초기 구현** (`bd6ae0b`) — 15×15 보드, 방 생성/입장, 5목 판정, 기본 AI, 채팅
2. **렌주룰 금수 + 실시간 타이머 + 개발환경 개선** (`a6d3227`) — 금수(33/44/장목) 판정 최초 구현, 턴 타이머, `predev` 포트 정리 스크립트
3. **AI 위협 탐색(VCF) + Web Worker** (`779bf40`) — `searchVCF`로 종반 강제 승리 수순 탐색, AI 연산을 Web Worker로 이전해 메인 스레드 블로킹 제거
4. **README / CLAUDE.md 문서 갱신** (`f1f04f2`, `509188a`) — 위 변경사항 반영
5. **공개방 목록 / 랭킹전 ELO 시스템** (`488aa99`) — 로비 3탭(비공개방/공개방/랭킹전), ELO 레이팅(1200 시작, K=32), 매칭 큐, 순위표 페이지, 익명 UUID(`userId.js`) 기반 레이팅 식별
6. **거짓금수(四) 판정 누락 수정** (`36605d1`, 2026-07-02) — 아래 "거짓금수 로직 분석·수정 내역(2026-07-02)" 참고
7. **런타임 데이터 gitignore 처리** (`11e315d`, 2026-07-02) — `server/data/` 제외

8. **AI 열린사 방어 실패 버그 수정** (`35de8b0`, 2026-07-03) — 상대가 양끝 열린 4목(열린사)을 만들면 AI가 한쪽만 막고 지던 버그. `findCriticalDefenseCells`로 교체해 상대의 모든 즉시 승리 위협을 수집하도록 수정, 열린삼 단계에서 미리 한쪽을 막아 예방하는 효과도 확인. 실제 시나리오로 재현·검증 완료 (`docs/TROUBLESHOOTING.md` #5)
9. **AI 탐색 엔진 1단계 업그레이드** (`166e761`, 2026-07-03) — 고정 depth-3 Minimax를 반복심화+Transposition Table 기반 negamax로 교체. 아래 "AI 엔진 강화 분석·수정 내역(2026-07-03)" 참고

> **참고**: 6·7번 커밋은 원래 "임시 푸시"라는 커밋 메시지로 `d2c039f` 하나에 뭉쳐 있던 것을, 내용을 분석해 의미 있는 커밋 2개로 재구성하고 `git commit --amend` + `force-push`로 origin/main 히스토리를 새로 썼습니다. 다른 곳에 이 저장소를 클론해둔 게 있다면 `git fetch && git reset --hard origin/main`으로 맞춰야 합니다 (구 커밋 해시 `d2c039f`는 더 이상 origin에 없음).

---

## 거짓금수 로직 분석·수정 내역 (2026-07-02)

`server/forbidden.js` / `client/src/utils/forbidden.js`의 `checkForbidden` 재귀 검증 방식을 분석한 결과 두 가지 문제를 발견해 수정했습니다.

1. **거짓사(四) 판정이 아예 없었음**: 거짓삼(열린삼 완성 자리가 금수면 진짜 삼으로 불인정)은 구현돼 있었지만, 사(四)에 대한 동일 처리가 `_hasFour`에 빠져 있었음 → `checkForbidden` 재귀 호출 추가로 수정
2. **재귀 깊이를 `depth < 2`로 임의 제한하던 문제**: 3단계 이상 중첩된 거짓금수 상황을 검증하지 않고 무조건 진짜 삼으로 처리했음 → `evaluating`(현재 스택에서 평가 중인 좌표) Set 기반 순환 감지로 교체, 깊이 제한 없이 정확하게 재귀 검증

자세한 원인 분석과 수정 전/후 코드는 `docs/TROUBLESHOOTING.md` #4, 아키텍처 설명은 `docs/TECHNICAL_SPEC.md` 6절 참고.

### 함께 업데이트한 문서
- `CLAUDE.md` — "거짓금수 허용 (depth≤2 재귀 체크)" 표현이 구현과 어긋나 최신화, 주요 파일 표/Socket 이벤트 목록에 랭킹전·ELO 관련 항목(`ratings.js`, `Leaderboard.jsx`, `ranked:*` 이벤트 등) 누락돼 있던 것 보강
- `docs/PRD.md` — "랭킹 시스템"이 4절(미구현)에 남아 있었으나 이미 `488aa99`에서 구현 완료된 상태였음 → 3.5절로 이동, 제외 범위(6절)의 "DB 없음" 서술도 ELO 레이팅 파일 저장 예외를 반영해 수정
- `docs/TECHNICAL_SPEC.md` — 공개방/랭킹전/ELO 기능이 아키텍처 문서에 전혀 반영되어 있지 않았음(디렉토리 구조, Room 객체, Socket 이벤트, REST API 전부 구버전) → 6절(금수 판정)·7절(랭킹전/ELO)을 신설하고 관련 섹션 전체 갱신

---

## AI 엔진 강화 분석·수정 내역 (2026-07-03)

사용자 요청으로 "단일 난이도, 최대한 전문가 수준"을 목표로 AI를 강화하기로 하고, 참고 삼아 두 오목 엔진 리포를 리서치했습니다.

- **[Piskvork](https://github.com/plastovicka/Piskvork)**: 확인 결과 AI 엔진이 아니라 Gomocup 프로토콜 GUI/심판 툴이었음. 예제 봇은 랜덤 착수 수준. `source/pbrain/alfabeta.cpp`(~400줄)만 컴팩트한 알파베타+VCF 참고용으로 볼만했지만 Rapfi 대비 얻을 게 없어 실질적으로 기여한 내용 없음
- **[Rapfi](https://github.com/dhbloo/rapfi)**: Gomocup 상위권 엔진. 신경망(NNUE)·MCTS는 학습된 가중치와 ML 런타임이 필요해 브라우저 JS로 이식 불가 — 제외. 대신 알파베타 계열의 **구조적 기법**(반복심화, Transposition Table, 매 노드 후보 재정렬, 조합 패턴 평가, VCF 상대방어 탐색 등)은 대부분 순수 JS로 이식 가능해서 우선순위별로 정리 후 단계적으로 적용하기로 함

### 1단계 적용 완료 (`client/src/utils/aiEngine.js`)
- 최대화/최소화를 따로 두던 `minimax`를 표준 `negamax`(관점별 부호 반전 하나로 통일) 구조로 교체
- **반복심화(Iterative Deepening)**: 고정 depth-3 → 시간 예산(`TIME_BUDGET_MS=2000ms`) 안에서 depth 1→2→3…로 점점 깊게, 완료된 depth만 채택
- **Transposition Table**: Zobrist 해싱(칸×플레이어별 난수 XOR 증분 계산) + `Map` 기반 캐시(이번 탐색 호출 동안만 유지)
- **매 노드 후보 재정렬**: 기존엔 루트에서만 정렬하고 재귀 내부는 그대로 썼는데, 모든 노드에서 재정렬하도록 수정 (Rapfi 조사 중 발견한 기존 코드의 실제 비효율)

### 검증
- 실제 시나리오 재현 테스트: 회귀(P0 열린사/열린삼 방어), 적법성, 시간예산 준수(≤2500ms) 전부 통과
- **깊이 실측**: 초반 국면 depth 5, 중반 혼잡 국면 depth 7까지 도달 (기존 고정 depth-3 대비 2배 이상) — TT 12,000~22,000개 엔트리 생성돼 실제로 재사용되는 것 확인
- 평가함수 대칭성(`evaluate(board,1) === -evaluate(board,2)`) 검증 통과 — negamax 전환 시 흔한 부호 버그 없음 확인
- `npx vite build` 정상 통과

### 남은 단계 (아래 "AI 엔진" TODO 참고)
2단계(VCF 상대방어 탐색, 조합 패턴 평가표), 3단계(Killer/History, PVS, 바운딩박스)는 아직 미착수 — 검증 부담을 줄이려고 단계별로 나눠서 진행 중

---

## 앞으로 할 일

우선순위는 `docs/PRD.md` 4절, `docs/TECHNICAL_SPEC.md` 5·9절과 동일한 판단 기준입니다.

### 데이터/인프라
- [ ] `server/data/ratings.json` 단일 파일 저장 방식을 정식 DB(SQLite/Postgres 등)로 전환 — 동시 쓰기 경합, 배포 환경 이전 문제 해결
- [ ] 계정/로그인 시스템 도입 검토 — 현재 `localStorage` UUID 익명 식별이라 브라우저 데이터 삭제·기기 변경 시 레이팅 전적이 끊김

### 기능
- [ ] 관전 모드 (진행 중인 방 관전)
- [ ] AI 난이도 선택 (쉬움 depth-1 / 보통 depth-3 / 어려움 depth-5)
- [ ] 모바일 최적화 (터치 이벤트, 반응형 보드)

### AI 엔진 (`docs/TECHNICAL_SPEC.md` 5절 "성능 개선 방향" 상세, Rapfi 리서치 기반)
- [x] Iterative Deepening + 시간 제한 (2026-07-03 완료)
- [x] Zobrist Hashing + Transposition Table (2026-07-03 완료)
- [ ] VCF에 상대 방어 탐색(VCF-defend) 추가 — 2단계
- [ ] 조합 패턴 평가표 (Rapfi `Pattern4` 개념) — 2단계
- [ ] Killer Move / History Heuristic 후보 정렬 — 3단계
- [ ] PVS(Principal Variation Search) — 3단계
- [ ] 후보 영역 바운딩박스 증분 관리 — 3단계
- [ ] VCT(사·삼 함께 고려하는 확장 위협 탐색)
- [ ] 난이도별 depth/시간예산 조절 기능 (지금은 단일 최강 난이도만 존재)

### 검증 필요
- [ ] 거짓금수 재귀 로직 변경(2026-07-02 수정) 후 실제 대국 시나리오로 회귀 테스트 — 특히 3단계 이상 중첩되는 거짓삼/거짓사 케이스가 실전에서 드물어 자동화 테스트가 없음. 유닛 테스트 추가 검토
