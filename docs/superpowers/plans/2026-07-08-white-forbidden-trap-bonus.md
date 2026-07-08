# 백의 금수 유도 사(四) 보너스 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI가 백으로 둘 때, 상대(흑)가 합법적으로 막을 수 없는(금수인) 완성 지점 하나짜리 사(四)를 만드는 자리에 `scoreCell`이 가산점을 주도록 해서, 강제수순(VCF)이 아직 성립하지 않은 평범한 국면에서도 이런 "사실상 확정승리" 자리를 검색이 알아보게 한다.

**Architecture:** `client/src/utils/aiEngine.js`의 `scoreCell(board, row, col, player)` 함수 한 곳만 수정한다. 기존 포크 보너스 블록 뒤에, 상대가 흑(`opp === 1`)이고 이 자리가 어느 방향으로든 사(四)를 만드는 후보(`myFourDirs === 0 && myThreeDirs >= 1` — 구현 중 발견: `myFourDirs`는 착수 전 이미 4목+빈칸1인 경우라 사실상 "즉시 5목 승리" 케이스라 이 용도에 안 맞고, "이 후보가 사를 만드는" 경우는 `myThreeDirs`로 잡힘. 아래 Self-Review Notes 참고)일 때만 그 사의 완성 지점을 `getFourThreats`로 계산해 `checkForbidden`으로 확인하는 분기를 추가한다. 새 탐색 구조나 새 파일은 없다.

**Tech Stack:** 순수 JS(ESM), Node.js 스크립트로 격리 검증, Vite 빌드, `tools/self-play.mjs`로 자가대국 회귀 확인.

## Global Constraints

- 설계 문서: `docs/superpowers/specs/2026-07-08-white-forbidden-trap-bonus-design.md` (사용자 승인됨)
- **커밋하기 전에 반드시 사용자에게 먼저 확인받는다** — 이번 세션에서 사용자가 명시적으로 요청한 사항. 어떤 태스크의 "커밋" 스텝도 사용자 승인 없이 실행하지 않는다.
- `completions.length === 1` 조건을 벗어난 범위(완성 지점 2곳 이상인 오픈사 케이스)와 삼(三) 단계 유도는 이번 플랜의 범위가 아니다 — 스펙에서 이미 제외 합의됨
- 새 파일을 만들지 않는다 — `client/src/utils/aiEngine.js` 하나만 수정
- `getFourThreats`는 이미 별도 커밋으로 "player===1(흑)일 때 완성 지점 중 흑 금수는 제외"하도록 수정되어 있다 — 이번 태스크의 시나리오는 `player=2(백)`로 호출하므로 그 필터의 영향을 받지 않는다(그 필터는 `player===1`일 때만 동작).

---

### Task 1: `scoreCell`에 금수 유도 사(四) 보너스 추가

**Files:**
- Modify: `client/src/utils/aiEngine.js:56-90` (`scoreCell` 함수)
- 검증용 임시 스크립트(커밋 대상 아님, 검증 후 삭제): `tools/_verify_trap_bonus.mjs`, `tools/_aiEngine_copy.mjs`

**Interfaces:**
- Consumes: 같은 파일의 `getFourThreats(board, row, col, player)` (완성 지점 배열 `{row, col}[]` 반환), `checkForbidden(board, row, col)` (`./forbidden.js`, 이미 파일 상단에서 import됨)
- Produces: `scoreCell`의 반환값이 이 조건에서 기존보다 정확히 30000 높아짐. 이 값은 `orderCandidates`(`aiEngine.js` 약 573행)가 후보 정렬에 그대로 사용 — 이 함수가 유일한 소비처라 후속 태스크 없음

**검증용 국면(이 세션에서 직접 실행해 확인한 좌표 — 그대로 사용한다):**

```js
function emptyBoard() {
  return Array.from({ length: 15 }, () => Array(15).fill(0))
}

const board = emptyBoard()
board[7][3] = 1   // (7,3) 쪽 창을 흑돌로 막아 그 방향은 사(四)로 안 잡히게 함
board[7][4] = 2
board[7][5] = 2
board[7][6] = 2
board[4][8] = 1
board[5][8] = 1
board[6][8] = 1
board[8][8] = 1
board[9][8] = 1
// 백이 (7,7)에 두면 가로로 (7,4)-(7,7) 사(四)가 되고, 유일한 완성 지점은 (7,8).
// (7,8)에 흑이 두면 세로 (4,8)(5,8)(6,8)(7,8)(8,8)(9,8) = 6목(장목)이라 흑에게 금수.
```

이 국면에서 `getFourThreats(board, 7, 7, 2)`(백이 `(7,7)`에 이미 둔 상태로 호출)는 `[{row:7, col:8}]` 하나만 반환하고, `checkForbidden(board, 7, 8)`은 `'장목'`을 반환한다 — 둘 다 이 세션에서 직접 실행해 확인함.

- [ ] **Step 1: 임시 검증 스크립트 작성**

`tools/_verify_trap_bonus.mjs` 파일을 새로 만든다:

```js
import { checkForbidden } from '../client/src/utils/forbidden.js'
import { getFourThreats, scoreCell } from './_aiEngine_copy.mjs'

function emptyBoard() {
  return Array.from({ length: 15 }, () => Array(15).fill(0))
}

const board = emptyBoard()
board[7][3] = 1
board[7][4] = 2
board[7][5] = 2
board[7][6] = 2
board[4][8] = 1
board[5][8] = 1
board[6][8] = 1
board[8][8] = 1
board[9][8] = 1

board[7][7] = 2 // 백이 이번 수로 여기 둔다고 가정
console.log('completions:', getFourThreats(board, 7, 7, 2))
console.log('(7,8) forbidden for black?', checkForbidden(board, 7, 8))

board[7][7] = 0 // scoreCell은 착수 "전" 후보를 채점하는 함수라 그 자리를 비워야 함
console.log('scoreCell score:', scoreCell(board, 7, 7, 2))
```

- [ ] **Step 2: `scoreCell`을 임시로 export하는 복사본 생성 후 수정 전 기준선 측정**

`scoreCell`과 `getFourThreats`는 `aiEngine.js`에서 export되어 있지 않으므로, 복사본을 만들어 임시로 export를 붙이고 검증한다:

```bash
cp client/src/utils/aiEngine.js tools/_aiEngine_copy.mjs
node -e "
const fs = require('fs');
let c = fs.readFileSync('tools/_aiEngine_copy.mjs', 'utf8');
c = c.replace(\"from './forbidden.js'\", \"from '../client/src/utils/forbidden.js'\");
c = c.replace(\"from './openingBook.js'\", \"from '../client/src/utils/openingBook.js'\");
c = c.replace('function getFourThreats(board, row, col, player) {', 'export function getFourThreats(board, row, col, player) {');
c = c.replace('function scoreCell(board, row, col, player) {', 'export function scoreCell(board, row, col, player) {');
fs.writeFileSync('tools/_aiEngine_copy.mjs', c);
"
node tools/_verify_trap_bonus.mjs
```

Expected (수정 전 기준선):
```
completions: [ { row: 7, col: 8 } ]
(7,8) forbidden for black? 장목
scoreCell score: 100
```

- [ ] **Step 3: `scoreCell`에 보너스 코드 추가 (실제 수정)**

`client/src/utils/aiEngine.js`에서 `scoreCell` 함수의 기존 코드:

```js
  if (myFourDirs >= 2) score += 80000
  else if (myFourDirs >= 1 && myThreeDirs >= 1) score += 5000

  if (enemyFourDirs >= 2) score += 40000
  else if (enemyFourDirs >= 1 && enemyThreeDirs >= 1) score += 2500

  return score
}
```

를 아래로 교체한다:

```js
  if (myFourDirs >= 2) score += 80000
  else if (myFourDirs >= 1 && myThreeDirs >= 1) score += 5000

  if (enemyFourDirs >= 2) score += 40000
  else if (enemyFourDirs >= 1 && enemyThreeDirs >= 1) score += 2500

  // 사(四)가 한 방향에서만 만들어졌고(오픈사/포크는 위에서 이미 최우선 처리됨),
  // 상대가 흑이면: 그 사의 완성 지점을 실제로 계산해 유일한 완성 지점이
  // 흑에게 금수(33/44/장목)인지 확인한다. 금수라면 흑은 이 자리를 합법적으로
  // 막을 수 없으므로 사실상 확정승리에 준한다 — searchVCF는 이미 강제수순
  // 안에서 이 판단을 하지만(약 350행), 강제수순이 아직 성립하지 않은 평범한
  // 국면에서는 이 정보가 후보 정렬에 전혀 반영되지 않았다.
  if (opp === 1 && myFourDirs === 1) {
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

- [ ] **Step 4: 수정 후 점수 재측정 — 보너스가 정확히 붙는지 확인**

Step 2와 같은 방식으로 `tools/_aiEngine_copy.mjs`를 최신 `aiEngine.js`에서 다시 복사·패치한다(Step 2의 `cp`+`node -e` 블록을 그대로 재실행):

```bash
cp client/src/utils/aiEngine.js tools/_aiEngine_copy.mjs
node -e "
const fs = require('fs');
let c = fs.readFileSync('tools/_aiEngine_copy.mjs', 'utf8');
c = c.replace(\"from './forbidden.js'\", \"from '../client/src/utils/forbidden.js'\");
c = c.replace(\"from './openingBook.js'\", \"from '../client/src/utils/openingBook.js'\");
c = c.replace('function getFourThreats(board, row, col, player) {', 'export function getFourThreats(board, row, col, player) {');
c = c.replace('function scoreCell(board, row, col, player) {', 'export function scoreCell(board, row, col, player) {');
fs.writeFileSync('tools/_aiEngine_copy.mjs', c);
"
node tools/_verify_trap_bonus.mjs
```

Expected: `scoreCell score: 30100` (Step 2의 100에서 정확히 30000 증가).

- [ ] **Step 5: 대조군 확인 — 완성 지점이 합법이면 보너스가 붙지 않아야 함**

`tools/_verify_trap_bonus.mjs`에서 `board[9][8] = 1` 줄을 지운다(장목을 만들던 다섯 번째 흑돌 제거 → `(7,8)`에 흑이 둬도 4,5,6,7,8 다섯 개뿐이라 정상 5목 승리이지 금수가 아니게 됨). 파일을 아래처럼 수정:

```js
import { checkForbidden } from '../client/src/utils/forbidden.js'
import { getFourThreats, scoreCell } from './_aiEngine_copy.mjs'

function emptyBoard() {
  return Array.from({ length: 15 }, () => Array(15).fill(0))
}

const board = emptyBoard()
board[7][3] = 1
board[7][4] = 2
board[7][5] = 2
board[7][6] = 2
board[4][8] = 1
board[5][8] = 1
board[6][8] = 1
board[8][8] = 1
// board[9][8] = 1 제거 — 이제 (7,8)은 흑에게 합법(정상 승리 저지 지점)

board[7][7] = 2
console.log('completions:', getFourThreats(board, 7, 7, 2))
console.log('(7,8) forbidden for black?', checkForbidden(board, 7, 8))

board[7][7] = 0
console.log('scoreCell score:', scoreCell(board, 7, 7, 2))
```

Run: `node tools/_verify_trap_bonus.mjs`

Expected:
```
completions: [ { row: 7, col: 8 } ]
(7,8) forbidden for black? null
scoreCell score: 100
```
(보너스 없이 Step 2와 동일한 100 — `(7,8)`이 이제 합법이라 보너스가 붙지 않아야 함)

- [ ] **Step 6: 임시 파일 정리**

```bash
rm tools/_verify_trap_bonus.mjs tools/_aiEngine_copy.mjs
```

- [ ] **Step 7: 빌드 확인**

```bash
cd client && npx vite build
```
Expected: 에러 없이 빌드 성공.

- [ ] **Step 8: P0 스팟체크**

`npm run dev`로 서버·클라이언트를 띄우고 로비에서 "AI 대전"을 선택해 실제 브라우저 대국으로 확인한다:
1. 사람이 흑을 선택해 백 AI와 대국 — 백 AI가 기존처럼 오픈쓰리를 정상적으로 막는지, 이상 동작(백이 뜬금없는 자리에 두거나 방어를 빼먹는지) 없는지 확인
2. 사람이 백을 선택해 흑 AI와 대국 — 흑 AI가 기존처럼 정상 동작하는지 확인(이번 변경은 `opp===1`일 때만 적용되므로 흑 AI 자신의 채점에는 영향 없어야 함)

- [ ] **Step 9: 자가대국 회귀 확인**

```bash
git show HEAD:client/src/utils/aiEngine.js > client/src/utils/_baseline_aiEngine.mjs
node tools/self-play.mjs client/src/utils/aiEngine.js client/src/utils/_baseline_aiEngine.mjs --games=10 --node-budget=15000
rm client/src/utils/_baseline_aiEngine.mjs
```

(`HEAD`는 이미 `getFourThreats` 버그 수정을 포함한 상태여야 한다 — 그게 아직 커밋 전이라면 이 비교의 베이스라인이 "버그 수정 전" 버전이 되어버려 두 변경이 섞여 비교된다. 버그 수정을 먼저 커밋했는지 확인하고 진행할 것.)

Expected: 신규가 5승 이상(동률 포함)이면 채택. 표본이 흔들리면(과거 #14/#15 패턴, 이번 세션의 장목 버그 수정 검증에서도 6게임 5:1 → 10게임 5:5로 뒤집힌 전례 있음) 격리 재현(Step 1~5)과 빌드 통과를 우선 근거로 채택 여부를 판단한다.

**실제 실행 결과 (2026-07-08):** 동일 코드로 10게임 배치를 3번 반복 실행(오프닝북의 무작위 선택 때문에 코드 변경 없이도 매번 다른 대국이 나옴) — 4승6패 → 3승7패 → 6승4패, 합산 13승17패(30게임, 43%). 코드를 전혀 바꾸지 않고 재실행만 했는데도 3승7패에서 6승4패로 뒤집힐 만큼 이 테스트 환경(노드예산 15000, 고정 오프닝 5개) 자체의 변동폭이 이 기능의 실제 효과보다 크다고 판단, 격리 재현(Step 1~5, 의도대로 정확히 동작 확인됨)을 우선 근거로 삼아 **채택**하기로 사용자와 합의함.

- [ ] **Step 10: 커밋 여부 사용자에게 확인 후 커밋**

Step 9까지 통과했으면, 사용자에게 변경 내용을 요약해 커밋해도 되는지 먼저 묻는다. 승인받으면:

```bash
git add client/src/utils/aiEngine.js docs/superpowers/specs/2026-07-08-white-forbidden-trap-bonus-design.md docs/superpowers/plans/2026-07-08-white-forbidden-trap-bonus.md
git commit -m "$(cat <<'EOF'
feat: 백이 흑을 금수로 몰아넣는 사(四) 자리에 scoreCell 가산점 추가

searchVCF에는 이미 있던 "완성 지점이 흑에게 금수면 확정승리" 판단을
강제수순이 아직 성립하지 않은 일반 국면의 후보 정렬(scoreCell)에도 반영.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 11: `docs/todo.md`에 완료 기록**

`docs/todo.md`에 아래 항목을 최근 작업 로그 형식으로 추가한다:

```markdown
## 백의 금수 유도 사(四) 보너스 (2026-07-08)

`getFourThreats`가 흑의 완성 지점 중 금수(33/44/장목)를 걸러내지 않던 버그를 먼저 수정(`searchVCF`/`negamax`의 강제수 연장 판단이 부풀려지던 문제 해소, 자가대국 10판 5:5로 회귀 없음 확인). 이어서 `scoreCell`에 "백의 사(四) 완성 지점이 흑에게 금수라 사실상 확정승리"인 경우 가산점(+30000)을 추가 — `searchVCF`에만 있던 이 인식을 강제수순이 아직 성립하지 않은 일반 국면의 후보 정렬에도 반영. 설계 `docs/superpowers/specs/2026-07-08-white-forbidden-trap-bonus-design.md`, 플랜 `docs/superpowers/plans/2026-07-08-white-forbidden-trap-bonus.md` 참고.
```

## Self-Review Notes

- Step 1~5의 좌표와 기대 출력값(`100`, `30100`, `장목`, `null`)은 전부 이 세션에서 직접 실행해 확인한 실측값이다(추정치 아님).
- `getFourThreats`/`scoreCell`은 export되어 있지 않아 검증 시 임시 복사본(`tools/_aiEngine_copy.mjs`)에 export를 붙여 사용한다 — 실제 소스 파일(`client/src/utils/aiEngine.js`)에는 export를 추가하지 않는다(기존 컨벤션 유지: 오직 `getAIMove`, `resetSearchState`만 export).
