# 백의 금수 유도 삼(三) 보너스 — 설계

## 배경

이전 세션에서 백의 사(四) 완성 지점이 흑에게 금수면 `scoreCell`에 가산점을 주는 기능을 추가했다(`docs/superpowers/specs/2026-07-08-white-forbidden-trap-bonus-design.md`). 그 설계에서 "삼(三) 단계의 금수 유도 판정은 막을 지점이 애매해서 범위 밖"이라고 명시적으로 제외했었다.

이후 사용자가 실제 대국 스크린샷을 제보: 백이 이미 두 칸을 연속으로 두고 있었는데, AI가 그 옆에 바로 붙여서 평범한 열린삼을 만들었다. 하지만 한 칸 더 띄워서 뛴삼(XX_X)을 만들었다면, 그 중간 빈칸이 흑의 기존 돌들과 얽혀 33/44/장목이 되어 흑이 합법적으로 막을 수 없는 상황이었다. AI가 이 기회를 놓쳤다는 제보로, 범위 밖으로 뺐던 삼 단계 유도를 이번에 구현한다.

## 시행착오: 막을 지점 탐지 방식

처음엔 `getFourThreats`와 같은 "느슨한 mine=3,empty=2 윈도우 스캔" 방식으로 막을 지점을 찾으려 했으나, 실제 좌표로 검증해보니 관련 없는 칸까지 "막을 지점"으로 잘못 집어내는 문제가 있었다(예: 뛴삼 사례에서 진짜 막을 칸은 1곳�면인데 이 방식은 3곳을 반환 — 나머지 2곳은 그 칸을 백이 채워도 여전히 진짜 갭은 그대로 남아 실질적 위협이 아닌 칸들이었음). 이런 "가짜 막을 지점"이 섞이면 "전부 금수여야 보너스"라는 채택 기준이 사실상 절대 만족되지 않아 기능이 무의미해진다.

대신 `client/src/utils/forbidden.js`의 `_hasOpenThree`가 이미 정확히 이 문제(진짜 열린삼인지, 완성 지점이 어디인지)를 6칸 패턴 매칭으로 풀고 있다는 걸 확인하고, 그 패턴 4개를 재사용해 일반화했다(원본은 흑 전용으로 하드코딩, 이번엔 `player` 파라미터로 일반화 + 완성 지점 좌표를 반환하도록 변경 + 첫 매치에서 멈추지 않고 방향당 가능한 매치를 전부 수집하도록 변경). 아래 두 시나리오로 실제 실행해 검증했다:

- **뛴삼(사용자 제보 사례)**: 백 `(7,4)(7,5)_(7,7)`(갭 `(7,6)`), 흑이 세로로 `(4,6)(5,6)(6,6)__(8,6)(9,6)`(갭 `(7,6)`) — 막을 지점이 정확히 `(7,6)` 하나만 나오고, `checkForbidden(board,7,6)`이 `'장목'` 반환 확인
- **대조군(평범한 열린삼)**: 백 `(7,5)(7,6)(7,7)` 연속 — 막을 지점이 `(7,4)`, `(7,8)` 두 곳 나오고 둘 다 합법(`null`) 확인

## 설계

**대상 파일:** `client/src/utils/aiEngine.js`

### 1. 새 함수: 열린삼 완성 지점 탐지 (player 일반화, 좌표 반환)

```js
// forbidden.js의 _hasOpenThree와 동일한 6칸 패턴 4개를 재사용하되, 특정 색(흑) 전용이 아니라
// 임의의 player에 대해 일반화하고, 참/거짓이 아니라 실제 완성 지점 좌표를 반환한다.
// 한 방향에서 진짜 열린삼(양 끝 다 열림)이면 완성 지점이 보통 2곳(양 끝) 나온다 —
// 첫 매치에서 멈추지 않고 이 방향에서 가능한 매치를 전부 모아야 함(대조군 검증 참고).
function getOpenThreeCompletions(board, row, col, dr, dc, player) {
  const PATS = [
    [[0, 1, 1, 1, 0, 0], 4, [1, 2, 3]],
    [[0, 0, 1, 1, 1, 0], 1, [2, 3, 4]],
    [[0, 1, 0, 1, 1, 0], 2, [1, 3, 4]],
    [[0, 1, 1, 0, 1, 0], 3, [1, 2, 4]],
  ]
  const results = []

  for (let off = 0; off <= 5; off++) {
    const sr = row - off * dr, sc = col - off * dc
    const cells = []
    for (let i = 0; i < 6; i++) {
      const r = sr + i * dr, c = sc + i * dc
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) { cells.push(9); continue }
      const v = board[r][c]
      cells.push(v === player ? 1 : v === 0 ? 0 : 9)
    }

    for (const [pat, fi, bis] of PATS) {
      if (!cells.every((v, i) => v === pat[i])) continue
      if (!bis.some(i => sr + i * dr === row && sc + i * dc === col)) continue

      const fr = sr + fi * dr, fc = sc + fi * dc
      board[fr][fc] = player
      let left = 0, right = 0
      for (let d = 1; d <= 4; d++) {
        const r = fr - dr * d, c = fc - dc * d
        if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE || board[r][c] !== player) break
        left++
      }
      for (let d = 1; d <= 4; d++) {
        const r = fr + dr * d, c = fc + dc * d
        if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE || board[r][c] !== player) break
        right++
      }
      const run = left + right + 1
      const lr = fr - (left + 1) * dr, lc = fc - (left + 1) * dc
      const rr = fr + (right + 1) * dr, rc = fc + (right + 1) * dc
      const lOpen = lr >= 0 && lr < BOARD_SIZE && lc >= 0 && lc < BOARD_SIZE && board[lr][lc] === 0
      const rOpen = rr >= 0 && rr < BOARD_SIZE && rc >= 0 && rc < BOARD_SIZE && board[rr][rc] === 0
      board[fr][fc] = 0

      if (run !== 4 || !lOpen || !rOpen) continue
      results.push({ row: fr, col: fc })
    }
  }
  return results
}

// (row,col)에 player가 착수했다고 가정한(board[row][col]=player로 이미 놓아둔 상태) 보드에서,
// 4방향 전체의 열린삼 완성 지점을 모아 중복 제거해 반환.
function getThreeBlockPoints(board, row, col, player) {
  const all = []
  for (const [dr, dc] of DIRECTIONS) {
    all.push(...getOpenThreeCompletions(board, row, col, dr, dc, player))
  }
  const seen = new Set()
  return all.filter(({ row: r, col: c }) => {
    const key = `${r},${c}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
```

### 2. `scoreCell`에 통합 (기존 사(四) 보너스 블록 확장)

기존(직전 커밋) 코드:

```js
  if (opp === 1 && myFourDirs === 0 && myThreeDirs >= 1) {
    board[row][col] = player
    const completions = getFourThreats(board, row, col, player)
    board[row][col] = 0
    if (completions.length === 1 && checkForbidden(board, completions[0].row, completions[0].col) !== null) {
      score += 30000
    }
  }
```

아래로 교체:

```js
  if (opp === 1 && myFourDirs === 0) {
    board[row][col] = player

    let fourBonusApplied = false
    if (myThreeDirs >= 1) {
      const fourCompletions = getFourThreats(board, row, col, player)
      if (fourCompletions.length === 1 && checkForbidden(board, fourCompletions[0].row, fourCompletions[0].col) !== null) {
        score += 30000
        fourBonusApplied = true
      }
    }

    if (!fourBonusApplied) {
      const threeBlockPoints = getThreeBlockPoints(board, row, col, player)
      if (threeBlockPoints.length > 0 && threeBlockPoints.every(p => checkForbidden(board, p.row, p.col) !== null)) {
        score += 20000
      }
    }

    board[row][col] = 0
  }
```

- **구현 중 발견한 게이트 버그**: 처음엔 이 블록 전체를 `myFourDirs === 0 && myThreeDirs >= 1`로 게이팅했으나, `myThreeDirs>=1`은 실제로 "이 후보가 사(四)를 만든다"는 뜻이다(analyzeDirection이 착수 전 기준으로 세므로, 사가 되는 자리도 3목+빈칸2로 잡힘 — 직전 사(四) 보너스 설계와 동일한 이유). 삼만 만들어지는 경우(이 기능의 핵심 대상)는 이 게이트를 통과하지 못해 보너스가 전혀 안 붙는 버그가 있었다(실제 재현 시 점수 차이 0으로 확인 후 수정). `myFourDirs === 0`만 바깥 게이트로 남기고 사/삼 체크를 독립시켜 해결.
- `fourBonusApplied`일 때 삼 체크를 건너뛴다 — 사(四)가 이미 있으면 그쪽이 우선(기존 로직 그대로).
- `threeBlockPoints.every(...)`: 막을 지점이 하나든 둘이든 **전부** 금수여야 보너스. 뛴삼(지점 1개)은 그 1개가 금수면 바로 만족. 일반 열린삼(지점 2개)은 둘 다 금수여야 하므로 훨씬 드물게 발동 — 이게 정확한 동작이다(하나라도 합법이면 흑이 그쪽으로 막으면 그만이므로 보너스 대상이 아님).
- 점수 `+20000`: 사(四)의 `+30000`보다 낮게(삼은 상대가 한 수 더 여유가 있어 즉각성이 사보다 낮음), 일반 삼(+100~1000)보다는 훨씬 높게.
- **실측값(이 세션에서 직접 확인)**: 뛴삼 시나리오 `scoreCell` 점수 `20010`(기본 10 + 보너스 20000), 대조군(평범한 열린삼, 막을 자리 둘 다 합법) `10`(보너스 없음) — 정확히 20000 차이.

### 건드리지 않는 것

- 직전 커밋의 사(四) 보너스 로직(`fourCompletions.length === 1` 분기) — 그대로 유지
- `searchVCF`, `findCriticalDefenseCells`, `negamax`/`rootSearch`의 `extend` 판단 — 무관
- `forbidden.js`의 `_hasOpenThree` 원본 — 수정하지 않음(흑 전용 하드코딩 그대로 두고, `aiEngine.js`에 일반화 버전을 별도로 둠 — 두 함수의 목적이 달라 통합하지 않음: `_hasOpenThree`는 "이 삼이 진짜 열린삼이냐"라는 boolean 판정 + 33 재귀 판정용이고, `getThreeBlockPoints`는 "완성 지점이 어디냐"는 좌표 수집용)

## 검증 계획

1. 격리 재현: 위 "시행착오" 절의 두 시나리오(뛴삼 실제 금수, 대조군 열린삼 합법)를 실제 `scoreCell`에 적용해 점수 차이 확인
2. `npx vite build`
3. 자가대국: 직전 세션에서 이미 확인했듯 이 테스트 환경(노드예산 15000, 고정 오프닝 5)은 노이즈가 매우 커서(동일 코드 재실행만으로 4:6→3:7→6:4) 신뢰도가 낮다 — 참고용으로만 1~2배치 실행하고, 격리 재현 결과를 채택의 주 근거로 삼는다

## 채택 기준

격리 재현이 기대대로 동작(뛴삼 사례는 보너스 발동, 대조군은 미발동)하고 빌드 통과하면 채택. 자가대국은 참고만 하고 노이즈 이유로 결정적 근거로 쓰지 않는다(직전 기능 채택 때와 동일한 판단 기준).
