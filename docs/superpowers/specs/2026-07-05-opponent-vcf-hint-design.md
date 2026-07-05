# 상대 VCF 힌트 기반 방어 통합 — 설계

## 배경

`aiEngine.js`의 현재 공격/방어 판단 흐름:
1. 내 VCF(연속 사 강제승리) 있으면 공격 (`searchVCF(board, aiPlayer, 0)`)
2. 상대의 "지금 당장"(1수 앞) 위협만 방어 (`findCriticalDefenseCells`) — 상대가 몇 수 뒤에 사를 연속으로 이어 강제승리하는 다단계 수순은 못 봄
3. 그 외엔 일반 탐색(`iterativeDeepeningSearch`)에 위임

2026-07-05에 이 공백을 메우려고 `filterOpponentVCFMoves`(후보 중 "상대에게 VCF가 열리는 자리"를 강제 제외)를 시도했으나, 10판 자가대국에서 4승6패로 개선 효과가 없어 되돌림(`docs/TROUBLESHOOTING.md` #14). 이번 문서는 같은 개념을 다른 통합 방식으로 재시도하는 설계다.

## 지난 시도가 실패했을 수 있는 이유

`searchVCF`는 "상대는 항상 유일한 완성지점을 막는다"고 가정하고, 이 가정에 대한 유일한 예외는 "상대에게 즉시 승리 수가 있는 경우"뿐이다(`hasImmediateWin` 체크). 이를 "상대 위협 판단용"으로 뒤집어 쓰면, 실제로는 상대(진짜 AI)가 즉시 승리는 아니어도 더 영리한 반격(예: 자기 위협을 만들어 우리가 그걸 막게 하는)으로 사슬을 끊을 수 있는데도 "상대가 VCF로 이긴다"고 과대판정(false positive)할 구조적 여지가 있다. **필터**로 쓰면 이 오탐이 좋은 후보를 통째로 제거하는 손실로 이어지고, 자가대국 4:6이 이걸로 설명될 가능성이 있다.

## 설계: 필터 → 힌트(forcedCells) 전환

탐지 로직(`searchVCF` 재사용)은 그대로 두고, **통합 방식만 바꾼다**: 위험한 후보를 제외하는 대신, "상대 VCF를 무력화하는" 후보를 기존 `criticalCells`와 같은 방식으로 `forcedCells`에 합류시켜 탐색 후보에서 밀려나지 않게만 한다. 최종 선택은 여전히 `iterativeDeepeningSearch`가 한다.

이렇게 하면 오탐의 대가가 "불필요한 방어수 하나가 후보 목록에 끼어드는" 정도로 줄어든다 — 후보를 줄이지 않으므로 원래 좋은 수가 사라질 위험이 없다.

### 변경 사항

**`client/src/utils/aiEngine.js`**

1. `filterOpponentVCFMoves(board, candidates, aiPlayer, opponent)` → `findOpponentVCFDefenses(board, candidates, aiPlayer, opponent)`로 교체
   - 반환값 의미 변경: "안전한 후보 목록 전체"가 아니라 "상대 VCF를 무력화하는 후보만" 반환
   - 내부 로직(후보 하나씩 둬보고 `searchVCF(board, opponent, 0)` 호출)은 동일

   ```js
   function findOpponentVCFDefenses(board, candidates, aiPlayer, opponent) {
     const defenses = []
     for (const { row, col } of candidates) {
       board[row][col] = aiPlayer
       const opponentVCF = searchVCF(board, opponent, 0)
       board[row][col] = 0
       if (!opponentVCF) defenses.push({ row, col })
     }
     return defenses
   }
   ```

2. `getAIMove`: 결과를 기존 `criticalCells`와 합쳐서 `forcedCells`로 넘김. `candidates` 자체는 줄이지 않음.

   ```js
   const opponentVCFDefenses = findOpponentVCFDefenses(board, candidates, aiPlayer, humanPlayer)
   const criticalCells = findCriticalDefenseCells(board, candidates, humanPlayer)
   const forcedCells = [...new Map(
     [...criticalCells, ...opponentVCFDefenses].map(c => [`${c.row},${c.col}`, c])
   ).values()]

   return iterativeDeepeningSearch(board, candidates, aiPlayer, TIME_BUDGET_MS, forcedCells)
   ```

   (중복 좌표는 `Map` 키로 자연스럽게 dedup)

### 건드리지 않는 것

- `searchVCF`, `findCriticalDefenseCells`, `orderCandidates`의 `forcedCells` 처리 방식 — 전부 기존 그대로 재사용
- 후보 생성(`getCandidates`)이나 `range`/`SPARSE_STONE_THRESHOLD` 관련 로직 — 무관

## 검증 계획

1. P0 회귀: 오픈쓰리 방어, 자기 VCF 우선, 오프닝북 조회 — 기존 스팟체크 그대로 재사용
2. `npx vite build`
3. 지난 시도 때 만든 손동작 2단계 VCF 함정 국면 재확인 — 이번 방식으로도 정확히 방어하는지
4. **10판 자가대국**: 현재 HEAD(`5c72ee9`, 힌트 적용 전) vs 신규(힌트 적용 후), 색 교대, 프로덕션 시간예산(2000ms/수) 그대로
5. **Yixin 벤치마크 6판** 추가: `tools/bench-vs-yixin.mjs`로 신규 버전 실행, 기존 베이스라인(0승6패)과 비교

## 채택 기준

10판 자가대국에서 신규가 5승 이상(동률 포함 우세)이고 Yixin 벤치마크에서 퇴보가 없으면 채택. 신규가 4승 이하(지난번과 같거나 더 나쁨)면 되돌리고 `docs/TROUBLESHOOTING.md`에 두 번째 실패로 기록 — 이 경우 "필터든 힌트든 이 방식 자체가 이 엔진 구조에서 실익이 없다"는 결론으로 넘어가고, `docs/todo.md`의 관련 항목을 정리한다.
