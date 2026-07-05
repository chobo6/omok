# TT 세션 내 재사용 + 결정론적 노드예산 자가대국 도구 — 설계

## 배경

`docs/TROUBLESHOOTING.md` #14·#15(상대 VCF 사전감지 두 번 시도, 둘 다 되돌림)에서 얻은 결론: "공격/방어 타이밍 판단"은 기존 반복심화 탐색이 충분히 깊이 보면 이미 스스로 계산해낸다 — 실제 대국에서 캡처한 국면으로 확인됨. 그러므로 새 판단 로직을 추가하기보다, **기존 탐색이 더 깊이/안정적으로 보게 만드는 쪽**이 더 근본적인 개선 방향이다.

동시에 `#9`에서 이미 지적된 문제: `iterativeDeepeningSearch`의 종료 기준이 `Date.now()` 벽시계 기준이라, 실행 시점마다 미세하게 다른 depth에서 끊겨 자가대국 결과가 흔들린다(같은 코드로 6승6패~8승4패 편차 관측 이력, 오늘 VCF 힌트 시도의 4승6패도 이 현상으로 설명될 가능성 있음). 이 노이즈를 없애지 않으면 앞으로 어떤 탐색 개선을 시도해도 "진짜 좋아졌는지" 신뢰도 있게 판단할 수 없다.

이 설계는 Killer Move/History Heuristic/PVS(`#8`, 시도 후 되돌림)와 다른 성격의, 아직 안 써본 두 가지 개선을 다룬다.

## 설계 1: Transposition Table 세션 내 재사용

### 현재 구조의 낭비
`iterativeDeepeningSearch(board, candidates, aiPlayer, timeBudgetMs, forcedCells)`가 매 `getAIMove` 호출마다 `const tt = new Map()`로 TT를 새로 만든다. `Game.jsx`가 AI 대전 중 Web Worker(`aiWorker.js`)를 게임당 한 번만 생성해 계속 재사용하는 걸 확인했으므로(`aiWorkerRef.current = new Worker(...)`는 마운트 시 1회, 언마운트 시 종료), 같은 게임 안에서 "내 수 → 상대 응수 → 내 다음 수"로 이어지는 대부분의 탐색 결과가 매번 완전히 버려지고 있다.

### 변경
- `aiEngine.js` 모듈 레벨에 `let persistentTT = new Map()` 도입, `iterativeDeepeningSearch`가 이걸 사용
- 무한 증가 방지: 매 호출 시작 시 `persistentTT.size > TT_MAX_ENTRIES`(상수, 100만)면 전체 `clear()` — LRU 등 정교한 정책 없이 안전망만
- Zobrist 해시는 보드 내용만으로 계산되고(누구 차례인지는 돌 개수 홀짝으로 항상 결정되므로) 세션 내 재사용이 안전함 — 해시 충돌 리스크는 기존에도 있던 것으로 새로 생기는 문제 아님

### 건드리지 않는 것
- 새 게임 시작 시 TT를 명시적으로 비우는 로직은 추가하지 않음(같은 워커가 재대국에도 재사용될 수 있으나, 이전 게임의 stale 엔트리는 틀린 값이 아니라 그냥 무관한 값이라 안전 — 크기 상한이 최종 안전망)

## 설계 2: 종료조건 통합(시간 vs 노드 수) + 결정론적 자가대국 도구

### 변경 — `aiEngine.js`
현재 `negamax`/`rootSearch` 곳곳에 흩어진 `Date.now() > deadline` 체크를 `budget` 객체 하나로 통합:
```js
function createTimeBudget(ms) {
  const deadline = Date.now() + ms
  return { exceeded: () => Date.now() > deadline }
}
function createNodeBudget(limit) {
  let count = 0
  return { exceeded: () => ++count > limit }
}
```
`getAIMove(board, aiPlayer, options)` — `options?.nodeBudget`이 있으면 `createNodeBudget`, 없으면 기존과 동일하게 `createTimeBudget(TIME_BUDGET_MS)`. 프로덕션 호출부(`aiWorker.js`)는 인자를 안 바꾸므로 동작 완전 동일(순수 opt-in 추가).

### 신규 — `tools/self-play.mjs`
지금까지 세션마다 scratchpad에 임시로 만들어 쓰던 자가대국 스크립트를 `tools/bench-vs-yixin.mjs`와 같은 위치에 정식 커밋:
- 두 엔진 모듈 경로를 인자로 받아 비교(기본값: 현재 HEAD vs 인자로 받은 경로)
- 색 교대, 여러 오프닝 세트로 N판 실행, 승/패/무 집계
- `--node-budget=N` 옵션 지원 — 지정하면 `getAIMove(board, player, { nodeBudget: N })`으로 호출해 결정론적 비교

## 검증 계획
1. P0 회귀(오픈쓰리 방어, 자기 VCF 우선, 오프닝북) + `npx vite build`
2. TT 재사용 정확성: 실제 몇 수를 이어 두면서 불법수/이상 동작 없는지 확인
3. 효율 이득 측정: 동일 게임 시뮬레이션에서 TT 재사용 유무에 따른 도달 depth·노드 수 비교
4. **결정론 검증**: `tools/self-play.mjs --node-budget=N`으로 같은 대국을 2회 실행해 완전히 동일한 결과가 나오는지 확인 — 기존 시간 기준 모드는 실행마다 다를 수 있음과 대조
5. `tools/bench-vs-yixin.mjs`로 최종 회귀 확인

## 채택 기준
P0·build·결정론 검증이 전부 통과하고 Yixin 벤치마크에서 퇴보가 없으면 채택. TT 재사용이 실제로 도달 depth를 늘리는 효과가 측정되면 성공으로 간주(자가대국 승률 자체보다 "탐색이 더 깊이 도달하는가"가 이번 변경의 직접적 성공 기준 — 승률 개선은 이후 별도로 지켜볼 사안).
