# 진행 상황 / TODO

> 지금까지 한 작업 정리 + 오늘(2026-07-02) 분석·수정 내역 + 앞으로 할 일. 완료된 기능 목록은 `docs/PRD.md` 3절, AI 세부사항은 `docs/TECHNICAL_SPEC.md` 5절, 버그 해결 기록은 `docs/TROUBLESHOOTING.md` 참고.

---

## 지금까지 한 작업 (커밋 순)

1. **MVP 초기 구현** (`bd6ae0b`) — 15×15 보드, 방 생성/입장, 5목 판정, 기본 AI, 채팅
2. **렌주룰 금수 + 실시간 타이머 + 개발환경 개선** (`a6d3227`) — 금수(33/44/장목) 판정 최초 구현, 턴 타이머, `predev` 포트 정리 스크립트
3. **AI 위협 탐색(VCF) + Web Worker** (`779bf40`) — `searchVCF`로 종반 강제 승리 수순 탐색, AI 연산을 Web Worker로 이전해 메인 스레드 블로킹 제거
4. **README / CLAUDE.md 문서 갱신** (`f1f04f2`, `509188a`) — 위 변경사항 반영
5. **공개방 목록 / 랭킹전 ELO 시스템** (`488aa99`) — 로비 3탭(비공개방/공개방/랭킹전), ELO 레이팅(1200 시작, K=32), 매칭 큐, 순위표 페이지, 익명 UUID(`userId.js`) 기반 레이팅 식별
6. **거짓금수(四) 판정 누락 수정** (`36605d1`, 오늘) — 아래 "오늘 분석·수정 내역" 참고
7. **런타임 데이터 gitignore 처리** (`11e315d`, 오늘) — `server/data/` 제외

> **참고**: 6·7번 커밋은 원래 "임시 푸시"라는 커밋 메시지로 `d2c039f` 하나에 뭉쳐 있던 것을, 내용을 분석해 의미 있는 커밋 2개로 재구성하고 `git commit --amend` + `force-push`로 origin/main 히스토리를 새로 썼습니다. 다른 곳에 이 저장소를 클론해둔 게 있다면 `git fetch && git reset --hard origin/main`으로 맞춰야 합니다 (구 커밋 해시 `d2c039f`는 더 이상 origin에 없음).

---

## 오늘 분석·수정 내역 (거짓금수 로직)

`server/forbidden.js` / `client/src/utils/forbidden.js`의 `checkForbidden` 재귀 검증 방식을 분석한 결과 두 가지 문제를 발견해 수정했습니다.

1. **거짓사(四) 판정이 아예 없었음**: 거짓삼(열린삼 완성 자리가 금수면 진짜 삼으로 불인정)은 구현돼 있었지만, 사(四)에 대한 동일 처리가 `_hasFour`에 빠져 있었음 → `checkForbidden` 재귀 호출 추가로 수정
2. **재귀 깊이를 `depth < 2`로 임의 제한하던 문제**: 3단계 이상 중첩된 거짓금수 상황을 검증하지 않고 무조건 진짜 삼으로 처리했음 → `evaluating`(현재 스택에서 평가 중인 좌표) Set 기반 순환 감지로 교체, 깊이 제한 없이 정확하게 재귀 검증

자세한 원인 분석과 수정 전/후 코드는 `docs/TROUBLESHOOTING.md` #4, 아키텍처 설명은 `docs/TECHNICAL_SPEC.md` 6절 참고.

### 함께 업데이트한 문서
- `CLAUDE.md` — "거짓금수 허용 (depth≤2 재귀 체크)" 표현이 구현과 어긋나 최신화, 주요 파일 표/Socket 이벤트 목록에 랭킹전·ELO 관련 항목(`ratings.js`, `Leaderboard.jsx`, `ranked:*` 이벤트 등) 누락돼 있던 것 보강
- `docs/PRD.md` — "랭킹 시스템"이 4절(미구현)에 남아 있었으나 이미 `488aa99`에서 구현 완료된 상태였음 → 3.5절로 이동, 제외 범위(6절)의 "DB 없음" 서술도 ELO 레이팅 파일 저장 예외를 반영해 수정
- `docs/TECHNICAL_SPEC.md` — 공개방/랭킹전/ELO 기능이 아키텍처 문서에 전혀 반영되어 있지 않았음(디렉토리 구조, Room 객체, Socket 이벤트, REST API 전부 구버전) → 6절(금수 판정)·7절(랭킹전/ELO)을 신설하고 관련 섹션 전체 갱신

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

### AI 엔진 (`docs/TECHNICAL_SPEC.md` 5절 "성능 개선 방향" 상세)
- [ ] Iterative Deepening + 시간 제한
- [ ] Zobrist Hashing + Transposition Table
- [ ] Killer Move / History Heuristic 후보 정렬
- [ ] VCT(사·삼 함께 고려하는 확장 위협 탐색)

### 검증 필요
- [ ] 거짓금수 재귀 로직 변경(오늘 수정) 후 실제 대국 시나리오로 회귀 테스트 — 특히 3단계 이상 중첩되는 거짓삼/거짓사 케이스가 실전에서 드물어 자동화 테스트가 없음. 유닛 테스트 추가 검토
