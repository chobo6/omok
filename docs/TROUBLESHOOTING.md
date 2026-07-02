# 트러블슈팅 기록

> 개발 중 발생한 주요 버그와 해결 과정을 기록한 문서입니다.

---

## #1 금수 착수 시 패배 처리 미작동

### 증상
금수 위치에 빨간 삼각형(▲)이 정상 표시됨에도, 해당 위치를 클릭하면 패배 처리 없이 돌이 그냥 놓임.

### 원인 분석

**1차 시도 (실패)**: `onBoardClick` 내부에서 `checkForbidden(board.map(r=>[...r]), row, col)`을 직접 호출.  
→ `useMemo`로 계산된 `forbiddenCells`와 보드 상태가 일치하지 않는 타이밍 문제로 null이 반환되는 경우 발생.

**2차 시도 (부분 실패)**: 시각적으로 표시된 `forbiddenCells`에서 `forbiddenCells.find(f => f.row === row && f.col === col)`으로 직접 조회.  
→ 이론상 올바르나, `function` 선언문(hoisting)으로 정의된 `onBoardClick` 내부에서 이후 라인의 `const forbiddenCells`를 클로저로 참조할 때 stale closure가 발생할 수 있는 구조.

**근본 원인**: `const forbiddenCells = useMemo(...)` 선언이 `function onBoardClick()` 선언보다 아래에 위치. 이벤트 핸들러 실행 시점에는 `forbiddenCells`가 할당되어 있지만, 렌더 사이클 간 클로저 캡처 시점에 따라 이전 렌더의 값을 참조할 가능성 존재.

### 해결

`useRef`로 항상 최신 `forbiddenCells`를 별도 추적:

```javascript
// Game.jsx
const forbiddenCellsRef = useRef([])

// 매 렌더마다 ref 동기화 (hook이 아닌 일반 할당)
forbiddenCellsRef.current = forbiddenCells

// onBoardClick 내부
const forbiddenHit = forbiddenCellsRef.current.find(f => f.row === row && f.col === col)
```

`useRef`는 렌더 간 동일 객체를 유지하므로 클로저 stale 문제가 발생하지 않음.

### 관련 파일
- `client/src/pages/Game.jsx` — `forbiddenCellsRef` 추가, `onBoardClick` 수정
- `client/src/utils/forbidden.js` — `getForbiddenCells()` 구현 (ESM)
- `server/forbidden.js` — `checkForbidden()` 구현 (CJS, 온라인 모드 서버 측 판정)

---

## #2 턴 타이머 실시간 카운트다운 미작동 (온라인 모드)

### 증상
온라인 대전에서 타이머가 매초 줄어들지 않고, 돌을 놓는 이벤트가 발생할 때만 업데이트됨.

### 원인 분석

서버는 매초 `timer:tick` 이벤트를 emit하고, 클라이언트는 이를 수신해 `timers` state를 갱신함.

```
server → timer:tick({ socketId, timeLeft }) → client setTimers(...)
```

그런데 화면에 표시되는 `displayPlayers`가 `players` 배열을 그대로 사용했음:

```javascript
// 수정 전 — players는 room:state(착수 시)에만 갱신됨
const displayPlayers = isOnline ? players : aiPlayers
```

`players` 배열의 `timeLeft`는 `room:state` 이벤트(착수 시점)에만 갱신됨. 매초 `timer:tick`으로 `timers` state가 변해도 표시엔 반영되지 않았음.

### 해결

`displayPlayers`에서 `timers` state의 값으로 `timeLeft`를 덮어씀:

```javascript
// 수정 후 — timers state(매초 갱신)를 timeLeft에 합성
const displayPlayers = isOnline
  ? players.map(p => ({ ...p, timeLeft: timers[p.color === 'black' ? 1 : 2] ?? p.timeLeft }))
  : aiPlayers
```

`timers` state는 `timer:tick` 핸들러가 매초 갱신하므로 실시간 카운트다운이 정상 작동.

### 이벤트 흐름 (수정 후)

```
서버 setInterval(1000ms)
  └─ emit timer:tick({ socketId, timeLeft })
       └─ 클라이언트 socket.on('timer:tick')
            └─ setTimers(prev => { ...prev, [color]: timeLeft })
                 └─ 리렌더 → displayPlayers.timeLeft 갱신 → PlayerInfo 표시 업데이트
```

### 관련 파일
- `client/src/pages/Game.jsx` — `displayPlayers` 계산 로직 수정
- `server/index.js` — `startTimer()` 함수 (`timer:tick` emit)

---

## #3 포트 점유 프로세스 잔존 문제

### 증상
터미널 창을 그냥 닫으면 node 프로세스가 종료되지 않고 3000/4000 포트를 계속 점유. 다음 `npm run dev` 실행 시 포트 충돌 오류 발생.

### 원인
Windows에서 터미널 창을 닫을 때 SIGINT가 자식 프로세스에 전달되지 않아 orphan 프로세스가 남음.

### 해결

루트 `package.json`에 `predev` 스크립트 추가. `npm run dev` 실행 전 자동으로 해당 포트를 정리:

```javascript
// kill-ports.js (Windows/Mac 크로스 플랫폼)
const PORTS = [3000, 4000]
PORTS.forEach(port => {
  // Windows: netstat로 PID 찾아 taskkill
  // Unix: lsof | xargs kill -9
})
```

```json
// package.json
{
  "scripts": {
    "predev": "node kill-ports.js",
    "dev": "concurrently ... \"npm run dev --prefix server\" \"npm run dev --prefix client\""
  }
}
```

이제 `npm run dev` 한 번으로 포트 정리 → 서버/클라이언트 동시 실행.

### 관련 파일
- `kill-ports.js` — 포트 정리 스크립트
- `package.json` (루트) — `predev`, `dev` 스크립트

---

## #4 거짓사(四) 판정 누락 및 거짓금수 재귀 깊이 제한으로 인한 오판정

### 증상
거짓삼(열린삼을 완성하는 자리가 금수인 경우 진짜 삼으로 인정하지 않는 처리)은 구현되어 있었지만, 사(四)에 대해서는 동일한 예외 처리가 없었음. 또한 거짓삼 판정 자체도 재귀 깊이를 `depth < 2`로 임의 제한해, 3단계 이상 중첩된 거짓금수 상황에서 부정확한 결과가 나올 수 있었음.

### 원인 분석

**`_hasFour`**: 5칸 윈도우에 흑돌 4개 + 빈칸 1개가 있고, 그 빈칸을 채우면 정확히 5개(장목 아님)가 되면 곧바로 `true`(사 성립)를 반환했음. 그 빈칸이 흑 입장에서 그 자체로 금수(33/44/장목)인지는 검사하지 않았음 — 렌주룰상 이런 경우는 "거짓사"로 사(四)로 인정하지 않아야 하는데 구현이 빠져 있었음.

**`_hasOpenThree`**: 채우는 자리에 대해 `checkForbidden`을 재귀 호출하긴 했지만, `depth < 2`일 때만 호출하고 그 이상 깊이에서는 검사를 생략한 채 무조건 진짜 삼으로 처리했음. 무한 재귀를 막기 위한 임시방편이었으나, 재귀 깊이가 실제 순환(같은 좌표로 되돌아옴) 여부와 무관하게 고정 상수로 끊겨 있어 3단계 이상 중첩된 케이스를 놓칠 수 있었음.

### 해결

`checkForbidden(board, row, col, evaluating)`에 현재 재귀 스택에서 평가 중인 좌표를 담는 `evaluating` Set을 추가:
- 함수 진입 시 `evaluating`에 좌표를 추가하고, 종료 시 제거 (스택 프레임과 1:1 대응)
- 이미 평가 중인 좌표가 다시 fill 후보로 나오면(이론상 board 점유 체크로 이미 걸러지지만 방어적으로) 보수적으로 금수(`'33'`) 처리
- `_hasFour`에도 `_hasOpenThree`와 동일하게 완성 자리에 대한 `checkForbidden` 재귀 호출을 추가해 거짓사를 판정
- 임의의 `depth < 2` 상한을 제거 — 순환이 없는 한 깊이 제한 없이 정확하게 재귀 검증

```javascript
// server/forbidden.js, client/src/utils/forbidden.js 공통
function checkForbidden(board, row, col, evaluating = new Set()) {
  if (board[row][col] !== 0) return null
  const key = row * BOARD_SIZE + col
  if (evaluating.has(key)) return '33'   // 순환 시 보수적 처리
  evaluating.add(key)
  ...
  evaluating.delete(key)
  return result
}

function _hasFour(board, row, col, dr, dc, evaluating) {
  ...
  if (n !== 5) continue
  if (checkForbidden(board, er, ec, evaluating) !== null) continue  // 거짓사 체크 추가
  return true
}
```

### 관련 파일
- `server/forbidden.js` — `checkForbidden`/`_hasFour`/`_hasOpenThree` 수정 (CJS)
- `client/src/utils/forbidden.js` — 동일 수정 (ESM)

---

## #5 AI가 상대의 열린사(오픈 포)를 절반만 막고 패배

### 증상
상대(흑)가 양끝이 열린 4목(`. B B B B .`)을 만들면, AI는 두 완성 지점 중 한쪽만 막고 다음 차례에 반대쪽으로 바로 짐.

### 원인 분석
`getAIMove`의 "빠른 승리/패배 방어 체크"가 후보를 순회하다 **상대가 이기는 자리를 처음 발견하는 즉시 그 자리 하나만 반환**하고 종료됨. 상대가 이길 수 있는 자리가 2곳 이상인지는 확인하지 않았음. 열린사는 정의상 한 수로 막을 수 없는 패턴인데, 이 로직은 마치 막을 수 있는 것처럼 동작하다 실패함. 게다가 이 체크가 VCF·Minimax보다 먼저 실행되고 즉시 `return`하기 때문에, 더 나은 판단을 할 기회 자체가 없었음.

재현: `. B B B B .` 형태를 만든 뒤 AI 턴을 시뮬레이션 → 한쪽만 막고 반대쪽 방치 확인 (테스트 스크립트로 재현 및 수정 후 검증 완료).

### 해결

`findCriticalDefenseCells(board, candidates, opponent)` 신규 함수로 교체:
- 각 후보에 대해 상대가 두면 (a) 즉시 5목 승리하거나 (b) 완성 지점이 2곳 이상인 사(四)를 만드는지 확인
- 조건을 만족하는 자리를 **전부 수집**
- 1곳이면 그 자리를 막고, 2곳 이상이면 (이미 열린사가 만들어진, 사실상 이미 진 상황) 휴리스틱 점수가 가장 높은 자리를 막음

부가 효과: 상대가 아직 삼(열린삼) 단계일 때도, 그 수가 "완성 지점 2곳짜리 사"로 이어지는 자리라면 critical cell로 잡혀 한쪽 끝을 미리 막음 — 열린사 자체가 만들어지는 걸 예방.

```javascript
// client/src/utils/aiEngine.js
function findCriticalDefenseCells(board, candidates, opponent) {
  const critical = []
  for (const { row, col } of candidates) {
    board[row][col] = opponent
    const wins = checkWinBoard(board, row, col, opponent)
    const fourThreats = wins ? [] : getFourThreats(board, row, col, opponent)
    board[row][col] = 0
    if (wins || fourThreats.length >= 2) critical.push({ row, col })
  }
  return critical
}
```

### 검증
- 이미 열린사가 만들어진 상황: 한쪽은 막되(불가피하게 이미 늦은 상황), 최소한 무작위가 아니라 휴리스틱상 나은 쪽을 막음
- 열린삼 상황(신규 방지 대상): 수정 전에는 감지 자체가 안 됐지만, 수정 후에는 한쪽 끝을 미리 막아 열린사로 발전하는 것을 차단 — 이후 상대가 반대쪽에 둬도 단순 사(완성지점 1곳)가 되어 정상적으로 막힘
- 일반 국면(위급 상황 없음) 다수에서 수정 전/후 착수가 동일함을 확인 — 회귀 없음

### 관련 파일
- `client/src/utils/aiEngine.js` — `findCriticalDefenseCells` 추가, `getAIMove`의 방어 체크 교체

---

## #6 AI의 VCF 강제 승리 탐색이 상대 반격을 검증하지 않음 (+ 수정 중 발견한 2차 버그)

### 증상 (설계상 결함, 재현 버그는 아님)
`searchVCF`는 자기 자신이 사(四)를 연속으로 만들어 상대를 강제로 방어시키는 수순을 탐색하면서, 상대가 항상 유일한 완성 지점을 막는다고만 가정했음. 그런데 그 강제 방어 돌들이 누적되는 동안 상대의 기존 돌과 우연히 이어져 상대에게 새로운 즉시 승리 기회(오픈사 등)가 생겨도 알아채지 못함 — 실전에서는 상대가 막지 않고 그냥 자기가 먼저 이겨버리므로, 이런 경우 AI가 찾은 "강제 승리 수순"은 사실 강제가 아님.

### 원인 분석
`docs/TECHNICAL_SPEC.md` "알려진 한계"에 이미 "VCF의 상대 반격 미검증"으로 문서화돼 있던 항목. Rapfi(`vcfdefend`)가 참고 사례.

### 해결 (+ 검증 중 발견한 버그)

`hasImmediateWin(board, candidates, player)` 헬퍼를 추가해, `searchVCF`가 사(四)를 만들 때마다 "지금 상대에게 이미 즉시 승리 수가 있는가"를 확인하도록 수정.

**1차 구현의 버그**: 이 확인을 `completions.length >= 2`(오픈사라서 즉시 승리로 간주하는 분기) 이후에 배치했더니, AI가 오픈사를 만드는 순간 상대 반격 확인 없이 곧장 `isWin=true`로 승리를 주장해버리는 경로가 남아있었음. 실전에서는 AI가 오픈사를 만들어도 그 다음은 **상대 차례**이므로, 상대가 이미 다른 즉시 승리 수를 갖고 있다면 상대가 먼저 이겨버림 — 검증 테스트를 직접 구성하려던 중 이 순서 문제를 발견해서, `checkWinBoard`(진짜 5목 완성, 상대 턴 자체가 없음)만 먼저 처리하고, 그 외의 모든 경우(오픈사 주장 포함)는 `hasImmediateWin` 확인을 거치도록 순서를 재조정.

```javascript
// client/src/utils/aiEngine.js
for (const { row, col, completions } of findFourMoves(board, player)) {
  board[row][col] = player

  if (checkWinBoard(board, row, col, player)) {
    board[row][col] = 0
    return [{ row, col }] // 지금 이 수로 실제 5목 완성 — 상대 턴 자체가 없는 즉시 승리
  }

  if (hasImmediateWin(board, getCandidates(board), opponent)) {
    board[row][col] = 0
    continue // 상대가 우리보다 먼저 이길 수 있음 — 이 수순은 강제승리 아님
  }

  if (completions.length >= 2) {
    board[row][col] = 0
    return [{ row, col }] // 완성 지점 2곳 이상 & 상대 반격 없음 확인됨 — 진짜 강제승리
  }

  const block = completions[0]
  // ...이하 기존과 동일: 상대를 강제로 막게 하고 재귀
}
```

### 검증
- `hasImmediateWin` 단위 테스트: 상대가 열린삼(아직 사 아님) 상태 → `false`, 강제 블록으로 오픈사를 갖게 된 상태 → `true`로 정확히 전환되는 것 확인
- 기존 정상 VCF 탐색 경로가 에러 없이 계속 동작하는 것 확인 (회귀)
- P0(열린사/열린삼 방어) 회귀, 적법성, 시간예산, `vite build` 전부 정상

### 교훈
검증 테스트를 직접 구성하려고 시나리오를 짜보는 과정에서, 코드만 읽었을 때는 못 봤던 순서 버그(오픈사 주장 분기가 반격 확인을 우회하는 것)를 발견함. "일단 짜고 봤을 때 맞아 보인다"와 "구체적 반례를 만들어보려다 발견한 허점"은 다르다는 걸 보여주는 사례.

### 관련 파일
- `client/src/utils/aiEngine.js` — `hasImmediateWin` 추가, `searchVCF` 순서 수정

---

## #7 AI가 오히려 약해짐: 방어 우선 순서 + 리프 평가함수 중복 계산 (실제 대국 피드백)

### 증상
1·2단계 업그레이드(반복심화+TT, VCF-defend+포크) 후 실제 대국에서 오히려 더 약해짐. 사용자 피드백: (1) "본인이 먼저 끝낼 수 있는 수순이 있음에도 내가 공격하면 우선 방어부터 한다", (2) "수읽기가 안 돼서 이상한 곳에 두는 경우가 많다".

### 원인 분석

**문제 1 — 방어가 VCF보다 먼저 (코드 순서 확정)**: `getAIMove`의 판단 순서가 `즉시승리 → 방어(findCriticalDefenseCells) → VCF → 심화탐색`이었음. 방어가 VCF보다 앞이라, AI에게 자기만의 강제 승리 수순(VCF)이 있어도 상대가 위협을 걸면 방어부터 선택함. VCF가 성립하는 상황이면 상대는 매 수 내 사(四)를 막느라 자기 위협을 완성할 틈이 없으므로, 밀어붙여 이기는 게 맞음.

**문제 2 — 리프 평가함수가 위협을 중복 계산 (실측 확인)**: `evaluate`가 "점유 셀마다 `scoreCell`을 불러 합산"하는 구조라, 같은 위협을 그 위협을 구성하는 돌 개수만큼 중복 계산했음. 실측: 열린삼 1개 = 돌 3개 × 각 1000 = **3000**, 열린사 1개 = 돌 4개 × … = **40000**. 1단계에서 탐색 깊이가 depth 3→5~7로 깊어지면서, AI가 이 노이즈 섞인 신호를 더 강하게 최적화하게 됨 → "깊이 읽지만 엉뚱한 목표를 향해 읽어" 이상한 곳에 둠. (얕은 탐색일 땐 전술 사전체크가 지배적이라 이 노이즈가 덜 드러났음)

### 해결

**문제 1**: `searchVCF` 호출을 `findCriticalDefenseCells`보다 앞으로 이동. VCF는 내부적으로 `hasImmediateWin`으로 상대 즉시 승리를 확인하므로(#6), 상대가 먼저 이길 수 있는 상황이면 스스로 `null`을 반환해 방어로 넘어감 → 재정렬이 안전함.

**문제 2**: `evaluate`를 `boardScore` 기반으로 교체. 각 방향의 라인을 **라인 시작점에서 한 번씩만** 훑으며 5칸 윈도우를 슬라이딩하고, 상대 돌이 없는 윈도우의 "내 돌 개수"별 가중치(`WINDOW_WEIGHTS = [0,1,100,1000,10000,100000]`)를 합산. 각 윈도우를 정확히 한 번만 세므로 중복 계산이 사라지고, 위협이 강해질수록 점수가 단조 증가. `scoreCell`은 리프 평가에서 손 떼고 move-ordering 전용으로 남김.

### 검증
- 새 평가함수 단조성: 열린2목(432) < 막힌3목(1146) < 열린3목(3247) < 열린4목(22262), 반대칭성 `evaluate(b,1)===-evaluate(b,2)`, 고립 돌 ≈ 0 전부 확인
- 문제1 시나리오: AI가 자기 열린사를 가진 채 상대도 열린삼을 건 국면에서, 방어 대신 자기 열린사 완성 자리를 선택하는 것 확인
- 탐색 깊이 유지(초반 5, 중반 7), 시간예산·적법성·`vite build` 정상
- **자가대국(가장 강한 증거)**: 시간예산 250ms로 낮춰 이전 커밋(88d1bde) 엔진과 12판 대국 → 신엔진 10승 2패. 실제로 더 강해졌음을 객관적으로 확인

### 관련 파일
- `client/src/utils/aiEngine.js` — `getAIMove` 순서 변경(VCF↑), `evaluate`/`boardScore` 재작성, `WINDOW_WEIGHTS` 추가
