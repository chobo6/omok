# 백의 금수 유도 삼(三) 보너스 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 백이 삼(연속 열린삼이든 뛴삼이든)을 만들 때, 그 삼을 사(四)로 키우는 걸 막기 위해 흑이 둬야 하는 완성 지점(들)이 전부 흑에게 금수라면 `scoreCell`이 가산점을 주도록 한다.

**Architecture:** `client/src/utils/aiEngine.js`에 새 함수 `getOpenThreeCompletions`(방향별 완성 지점 탐지, `forbidden.js`의 `_hasOpenThree` 패턴 재사용·일반화)와 `getThreeBlockPoints`(4방향 통합)를 추가하고, 기존 사(四) 보너스 블록(현재 56-108행 `scoreCell` 안, 98-105행)을 확장해 사가 없을 때 삼 케이스도 확인하도록 한다.

**Tech Stack:** 순수 JS(ESM), Node.js 스크립트로 격리 검증, Vite 빌드.

## Global Constraints

- 설계 문서: `docs/superpowers/specs/2026-07-08-white-forbidden-trap-three-design.md` (사용자 승인됨, 코드는 이미 이 세션에서 격리 검증 완료)
- **커밋하기 전에 반드시 사용자에게 먼저 확인받는다**
- 자가대국은 이 테스트 환경(노드예산 15000, 고정 오프닝 5개) 자체의 노이즈가 매우 크다는 게 직전 기능에서 이미 확인됐다(동일 코드 재실행만으로 4:6→3:7→6:4) — 참고용으로만 실행하고, 격리 재현 결과를 채택의 주 근거로 삼는다
- 새 파일을 만들지 않는다 — `client/src/utils/aiEngine.js` 하나만 수정
- `forbidden.js`의 `_hasOpenThree`는 수정하지 않는다 — 흑 전용 boolean 판정용으로 그대로 두고, `aiEngine.js`에 일반화된 별도 버전(`getOpenThreeCompletions`)을 둔다

---

### Task 1: `getOpenThreeCompletions` / `getThreeBlockPoints` 추가 + `scoreCell` 통합

**Files:**
- Modify: `client/src/utils/aiEngine.js` — 새 함수 2개 추가(위치: `getFourThreats` 함수 정의 근처, 약 245행 이후), `scoreCell`의 98-105행 블록 확장
- 검증용 임시 스크립트(커밋 대상 아님, 검증 후 삭제): `tools/_verify_three_trap.mjs`, `tools/_aiEngine_copy.mjs`

**Interfaces:**
- Consumes: `checkForbidden(board, row, col)` (`./forbidden.js`, 이미 import됨), `getFourThreats(board, row, col, player)` (같은 파일, 기존 함수), `DIRECTIONS`, `BOARD_SIZE` (같은 파일 상단 상수)
- Produces: `getOpenThreeCompletions(board, row, col, dr, dc, player) → {row,col}[]`, `getThreeBlockPoints(board, row, col, player) → {row,col}[]` — 둘 다 이 태스크 안에서만 쓰임(export 안 함, 기존 컨벤션대로 `getAIMove`/`resetSearchState`만 export 유지). `scoreCell`의 반환값이 삼 케이스에서 기존보다 정확히 20000 높아짐 — `orderCandidates`가 그대로 소비하므로 후속 태스크 없음

**검증용 시나리오(이 세션에서 이미 실행해 확인한 좌표 — 그대로 사용):**

```js
function emptyBoard() {
  return Array.from({ length: 15 }, () => Array(15).fill(0))
}

// 시나리오 1: 뛴삼 — 사용자가 보고한 상황과 동일 구조
// 백: (7,4)(7,5) 기존 + (7,7) 착수 → 갭 (7,6)
// 흑: 세로로 (4,6)(5,6)(6,6) + (8,6)(9,6), 갭 (7,6)
// (7,6)에 흑이 두면 세로 4~9행 = 6목(장목) → 금수
const board1 = emptyBoard()
board1[7][4] = 2
board1[7][5] = 2
board1[4][6] = 1
board1[5][6] = 1
board1[6][6] = 1
board1[8][6] = 1
board1[9][6] = 1
// 후보: (7,7)

// 시나리오 2(대조군): 평범한 연속 열린삼 — 막을 자리 둘 다 합법
const board2 = emptyBoard()
board2[7][5] = 2
board2[7][6] = 2
// 후보: (7,7)
```

시나리오1에서 `getThreeBlockPoints(board, 7, 7, 2)`(백이 `(7,7)`에 이미 둔 상태로 호출)는 `[{row:7,col:6}]` 하나만 반환하고 `checkForbidden(board,7,6)`은 `'장목'`. 시나리오2는 `[{row:7,col:4},{row:7,col:8}]` 두 개를 반환하고 둘 다 `null`(합법) — 둘 다 이 세션에서 직접 실행해 확인함.

- [ ] **Step 1: 임시 검증 스크립트 작성**

`tools/_verify_three_trap.mjs`:

```js
import { checkForbidden } from '../client/src/utils/forbidden.js'
import { getThreeBlockPoints, scoreCell } from './_aiEngine_copy.mjs'

function emptyBoard() {
  return Array.from({ length: 15 }, () => Array(15).fill(0))
}

console.log('=== 시나리오 1: 뛴삼 ===')
{
  const board = emptyBoard()
  board[7][4] = 2
  board[7][5] = 2
  board[4][6] = 1
  board[5][6] = 1
  board[6][6] = 1
  board[8][6] = 1
  board[9][6] = 1

  board[7][7] = 2
  console.log('block points:', getThreeBlockPoints(board, 7, 7, 2))
  board[7][7] = 0
  console.log('scoreCell score:', scoreCell(board, 7, 7, 2))
}

console.log('=== 시나리오 2: 대조군(평범한 열린삼) ===')
{
  const board = emptyBoard()
  board[7][5] = 2
  board[7][6] = 2

  board[7][7] = 2
  console.log('block points:', getThreeBlockPoints(board, 7, 7, 2))
  board[7][7] = 0
  console.log('scoreCell score:', scoreCell(board, 7, 7, 2))
}
```

- [ ] **Step 2: 복사본 생성 후 수정 전 기준선 측정**

```bash
cp client/src/utils/aiEngine.js tools/_aiEngine_copy.mjs
node -e "
const fs = require('fs');
let c = fs.readFileSync('tools/_aiEngine_copy.mjs', 'utf8');
c = c.replace(\"from './forbidden.js'\", \"from '../client/src/utils/forbidden.js'\");
c = c.replace(\"from './openingBook.js'\", \"from '../client/src/utils/openingBook.js'\");
c = c.replace('function scoreCell(board, row, col, player) {', 'export function scoreCell(board, row, col, player) {');
fs.writeFileSync('tools/_aiEngine_copy.mjs', c);
"
```

이 시점엔 `getThreeBlockPoints`가 아직 없으므로 `node tools/_verify_three_trap.mjs`는 import 에러가 난다 — 이건 예상된 실패다(다음 Step에서 함수를 추가한 뒤에야 통과). 여기서는 그냥 스킵하고 Step 3으로 진행.

- [ ] **Step 3: `getOpenThreeCompletions`/`getThreeBlockPoints` 함수 추가**

`client/src/utils/aiEngine.js`에서 `getFourThreats` 함수(정의 끝나는 지점, `}` 다음 줄, VCF_MAX_DEPTH 상수 정의 이전) 바로 뒤에 아래 두 함수를 추가한다:

```js
// forbidden.js의 _hasOpenThree와 동일한 6칸 패턴 4개를 재사용하되, 흑 전용이 아니라
// 임의의 player에 대해 일반화하고, 참/거짓이 아니라 실제 완성 지점 좌표를 반환한다.
// 한 방향에서 진짜 열린삼(양 끝 다 열림)이면 완성 지점이 보통 2곳(양 끝) 나오므로
// 첫 매치에서 멈추지 않고 이 방향에서 가능한 매치를 전부 모은다.
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

- [ ] **Step 4: `scoreCell`의 사(四) 보너스 블록을 확장해 삼(三) 케이스 추가**

`client/src/utils/aiEngine.js`의 `scoreCell` 안, 기존 코드:

```js
  if (opp === 1 && myFourDirs === 0 && myThreeDirs >= 1) {
    board[row][col] = player
    const completions = getFourThreats(board, row, col, player)
    board[row][col] = 0
    if (completions.length === 1 && checkForbidden(board, completions[0].row, completions[0].col) !== null) {
      score += 30000
    }
  }

  return score
}
```

를 아래로 교체:

```js
  if (opp === 1 && myFourDirs === 0) {
    board[row][col] = player

    // myThreeDirs>=1은 "이 후보가 사(四)를 만든다"는 뜻이다(analyzeDirection은 착수 전
    // 기준으로 세므로, 사가 되는 자리는 이미 3목+빈칸2로 잡힌다 — 위 사(四) 보너스와
    // 동일한 이유). 사가 만들어졌다면 그 완성 지점이 흑에게 금수인지 확인.
    let fourBonusApplied = false
    if (myThreeDirs >= 1) {
      const fourCompletions = getFourThreats(board, row, col, player)
      if (fourCompletions.length === 1 && checkForbidden(board, fourCompletions[0].row, fourCompletions[0].col) !== null) {
        score += 30000
        fourBonusApplied = true
      }
    }

    // 이 후보가 삼(뛴삼 포함)을 만드는지는 getThreeBlockPoints 자체가 실제 보드를
    // 패턴 매칭해 판정하므로(삼이 아니면 빈 배열 반환), 위 사(四) 판정과 무관하게
    // 항상 시도한다. 뛴삼은 완성 지점 보통 1곳, 평범한 열린삼은 보통 2곳(양 끝) —
    // 그 지점들이 전부(하나든 둘이든) 흑에게 금수라면 흑은 합법적으로 막을 수 없다.
    // 하나라도 합법이면 흑이 그쪽으로 막으면 그만이므로 보너스 대상이 아니다(every).
    if (!fourBonusApplied) {
      const threeBlockPoints = getThreeBlockPoints(board, row, col, player)
      if (threeBlockPoints.length > 0 && threeBlockPoints.every(p => checkForbidden(board, p.row, p.col) !== null)) {
        score += 20000
      }
    }

    board[row][col] = 0
  }

  return score
}
```

**중요:** 처음엔 위 코드도 `myFourDirs === 0 && myThreeDirs >= 1`로 전체를 게이팅하려 했으나, `myThreeDirs>=1`이 실제로는 "사(四)가 만들어진다"는 뜻이라(위 사(四) 보너스 설계와 동일한 이유) 삼만 만들어지는 경우(이 태스크의 핵심 시나리오) 이 게이트 자체를 통과하지 못해 삼 보너스가 전혀 안 붙는 버그가 있었다. `myFourDirs === 0`만 바깥 게이트로 남기고 사/삼 체크를 독립시켜 수정했다 — 위 코드가 최종본이다.

- [ ] **Step 5: 격리 재현 실행**

```bash
cp client/src/utils/aiEngine.js tools/_aiEngine_copy.mjs
node -e "
const fs = require('fs');
let c = fs.readFileSync('tools/_aiEngine_copy.mjs', 'utf8');
c = c.replace(\"from './forbidden.js'\", \"from '../client/src/utils/forbidden.js'\");
c = c.replace(\"from './openingBook.js'\", \"from '../client/src/utils/openingBook.js'\");
c = c.replace('function getThreeBlockPoints(board, row, col, player) {', 'export function getThreeBlockPoints(board, row, col, player) {');
c = c.replace('function scoreCell(board, row, col, player) {', 'export function scoreCell(board, row, col, player) {');
fs.writeFileSync('tools/_aiEngine_copy.mjs', c);
"
node tools/_verify_three_trap.mjs
```

Expected(이 세션에서 실제로 확인한 값):
```
=== 시나리오 1: 뛴삼 ===
block points: [ { row: 7, col: 6 } ]
scoreCell score: 20010
=== 시나리오 2: 대조군(평범한 열린삼) ===
block points: [ { row: 7, col: 8 }, { row: 7, col: 4 } ]
scoreCell score: 10
```

**구현 중 발견한 게이트 버그**: 처음엔 사(四) 보너스와 같은 `if (opp===1 && myFourDirs===0 && myThreeDirs>=1)` 게이트 안에 삼 체크를 중첩시켰으나, `myThreeDirs>=1`은 실제로 "이 후보가 사(四)를 만든다"는 뜻이라(analyzeDirection이 착수 전 기준으로 세므로, 사가 되는 자리도 3목+빈칸2로 잡힘 — 사 보너스 설계 문서의 동일한 이유) 위 시나리오1(2개 기존 돌 + 후보 = 삼)에서는 이 게이트 자체가 통과하지 못해 보너스가 전혀 붙지 않았다(재현 시 점수가 10으로 동일하게 나옴). `myFourDirs===0` 게이트만 유지하고 사 체크와 삼 체크를 독립적으로 분리해 수정, 위 값대로 정상 동작 확인. Step 4의 코드 블록은 이미 이 수정을 반영한 최종본이다.

- [ ] **Step 6: 임시 파일 정리**

```bash
rm tools/_verify_three_trap.mjs tools/_aiEngine_copy.mjs
```

- [ ] **Step 7: 빌드 확인**

```bash
cd client && npx vite build
```
Expected: 에러 없이 빌드 성공.

- [ ] **Step 8: 자가대국 참고 실행 (결정적 근거 아님)**

```bash
git show HEAD:client/src/utils/aiEngine.js > client/src/utils/_baseline_aiEngine.mjs
node tools/self-play.mjs client/src/utils/aiEngine.js client/src/utils/_baseline_aiEngine.mjs --games=10 --node-budget=15000
rm client/src/utils/_baseline_aiEngine.mjs
```

이 결과는 참고만 한다 — 직전 기능에서 이미 확인했듯 동일 코드 재실행만으로도 4:6→3:7→6:4로 뒤집힐 만큼 이 테스트 환경 자체의 노이즈가 크다. Step 5의 격리 재현이 기대대로 통과했다면 이 결과와 무관하게 채택 방향으로 사용자와 상의한다.

- [ ] **Step 9: 커밋 여부 사용자에게 확인 후 커밋**

Step 5, 7이 통과했으면 사용자에게 변경 내용을 요약해 커밋해도 되는지 먼저 묻는다. 승인받으면:

```bash
git add client/src/utils/aiEngine.js docs/superpowers/specs/2026-07-08-white-forbidden-trap-three-design.md docs/superpowers/plans/2026-07-08-white-forbidden-trap-three.md
git commit -m "$(cat <<'EOF'
feat: 백의 뛴삼/열린삼 완성 지점이 흑에게 금수면 scoreCell 가산점 추가

사(四) 단계에만 있던 "완성 지점이 흑 금수면 사실상 확정승리" 판단을
삼(三) 단계(뛴삼 1곳, 열린삼 2곳)로 확장. 완성 지점이 전부 금수여야만
발동(하나라도 합법이면 흑이 그쪽으로 막으면 그만이므로 제외).

forbidden.js의 _hasOpenThree 패턴을 일반화한 getOpenThreeCompletions/
getThreeBlockPoints 신규 추가.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 10: `docs/todo.md`에 완료 기록**

`docs/todo.md`의 최근 작업 로그 섹션(직전 "백의 금수 유도 사(四) 보너스" 항목 바로 아래)에 추가:

```markdown
- [x] 백의 금수 유도 삼(三) 보너스 (2026-07-08 완료 — 직전 사(四) 단계 기능에 이어, 사용자가 실전 스크린샷으로 "백이 뛴삼을 뒀으면 흑이 33으로 못 막았을 자리인데 AI가 평범한 연속 열린삼을 뒀다"고 제보. `forbidden.js`의 `_hasOpenThree` 패턴을 일반화한 `getOpenThreeCompletions`/`getThreeBlockPoints`를 신규 추가해, 삼의 완성 지점(뛴삼 1곳/열린삼 2곳)이 전부 흑에게 금수면 `scoreCell`에 +20000. 격리 재현 2건(뛴삼 발동, 열린삼 대조군 미발동) 확인. 설계 `docs/superpowers/specs/2026-07-08-white-forbidden-trap-three-design.md`, 플랜 `docs/superpowers/plans/2026-07-08-white-forbidden-trap-three.md` 참고)
```

## Self-Review Notes

- Step 5의 좌표와 함수 로직은 이 세션에서 별도 스크립트로 이미 실행해 정확성을 확인한 것을 그대로 옮긴 것이다(추정치 아님) — 단, 이번엔 `tools/_aiEngine_copy.mjs`를 거치는 정식 절차로 한 번 더 재현하는 것이 Step 5의 목적
- `getOpenThreeCompletions`/`getThreeBlockPoints`는 export하지 않는다(기존 컨벤션 유지) — 검증 시에만 임시 복사본에 export를 붙인다
