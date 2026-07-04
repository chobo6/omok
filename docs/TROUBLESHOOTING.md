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

---

## #8 AI 엔진 3단계(Killer/History/PVS/바운딩박스) 자가대국 검증에서 킬러 보너스 스케일 버그 발견 + PVS·TT 상호작용 문제로 결국 되돌림

### 배경
`docs/TECHNICAL_SPEC.md` 5절 "성능 개선 방향" 3단계 세 항목(Killer Move/History Heuristic, PVS, 바운딩박스 증분 관리)을 한 번에 구현하고, 지금까지의 관례대로 고정 시나리오 회귀 테스트 + 자가대국으로 검증하는 과정에서 두 가지 문제를 발견함.

### 1차 발견: 킬러 보너스가 실제 전술 점수를 역전시킴

고정 depth(5)에서 노드 방문 수를 비교(`killer+history만` 켠 버전 vs 기존)했더니 **519 → 687개로 오히려 32% 증가**. 원인: `orderCandidates`에서 킬러 보너스(+50000)와 history 누적값을 `scoreCell` 원점수에 그냥 더했는데, 이 값들이 `scoreCell`의 실제 사(四)·삼(三) 위협 점수(10~100000 범위)와 같은 스케일이라, "최근 다른 곳에서 컷오프를 냈던" 조용한 자리가 진짜 위협 자리보다 먼저 탐색되는 경우가 생겨 알파베타 가지치기 효율이 오히려 나빠짐.

**수정**: `scoreCell`을 구성하는 모든 가중치 상수(100000~10)가 전부 10의 배수라는 점 확인 → `scoreCell`은 항상 10의 배수이고, 서로 다른 두 `scoreCell` 값의 최소 격차는 10. `scoreCell * 1000` 위에 킬러(+500)·history(최대 499, 합쳐도 999 미만)를 얹으면 실제 전술 점수 차이는 절대 역전되지 않으면서, `scoreCell`이 완전히 같은 조용한 후보들 사이에서만 순서를 가르는 순수 타이브레이커가 됨. 이 보정 후 같은 고정 depth 비교에서 노드 수가 519로 원래 수준 회복(회귀 없음 확인).

### 2차 발견: 보정 후에도 자가대국에서 결국 순손실 (진짜 결론)

노드 수 비교만으로는 부족하다고 판단해 실제 대국으로 검증(300ms/800ms 시간예산, 각 6~10판):

| 구성 | 결과 |
|---|---|
| bbox만 | 8/8, 8/10 등 — **명확한 순증가** (800ms 예산에서 8전 8승) |
| killer+history만 (보정 후) | **1승 9패** |
| PVS 포함 전체(bbox+killer+history+PVS) | **0승 8패** |
| PVS 제외(bbox+killer+history) | 2승 4패 |

**killer+history**: 수학적으로 전술 순위를 역전시키지 않도록 고쳤음에도 실전에서 크게 밀림. `scoreCell` 자체가 이미 정교한 전술 신호라 완전히 "조용한"(scoreCell 동점) 후보 사이에서만 개입하는 타이브레이커가 실제로 도움될 여지가 적은 반면, 매 노드마다 킬러 테이블 조회(`isKillerMove`)와 history 배열 접근은 무조건 드는 고정 비용이라 이 엔진 특성상 순손실로 판단.

**PVS**: 훨씬 크게(0/8) 밀림. 원인으로 추정되는 것은 Transposition Table과의 상호작용: 널윈도우(scout) 재탐색이 끝나자마자 같은 해시·같은 depth로 즉시 "풀윈도우 재탐색"을 호출하는데, 이때 TT 조회가 방금 널윈도우 탐색이 저장한 좁은 윈도우 기준 바운드를 그대로 읽어 `alpha`/`beta`를 다시 좁혀버림 — 결과적으로 "정확한 값을 다시 구한다"는 재탐색의 목적이 무력화되고, 널윈도우 탐색과 사실상 같은(낮게 잡힌) 값을 반환하게 되는 것으로 보임. PVS+TT를 함께 쓰는 구현은 이런 상호작용에 주의가 필요하다는 게 알려져 있는데, 여기서는 별도 처리 없이 그대로 TT를 공유해 문제가 생김.

### 최종 결정
- **채택**: 바운딩박스 증분 관리만 — `getCandidates`가 전체 15×15 대신 놓인 돌의 바운딩박스(+2칸)만 스캔, 착수마다 `expandBBox`로 갱신. 논리적으로 항상 기존과 동일한 후보 집합을 만들어내므로(바운딩박스 밖엔 돌이 없다는 게 보장됨) 안전하고, 800ms 예산 자가대국 8전 8승으로 실질 강화 확인.
- **보류(코드에서 제거)**: Killer Move / History Heuristic, PVS — `docs/todo.md`의 3단계 항목에 "시도 후 되돌림"으로 표시. 재도전한다면 PVS는 TT 상호작용을 제대로 처리(예: 재탐색 직전엔 해당 노드의 TT 컷오프를 건너뛰거나, 별도 윈도우별 저장)해야 하고, killer/history는 이 엔진처럼 이미 강한 정적 휴리스틱이 있는 경우 기대 이득 자체가 작다는 점을 감안해야 함.

### 교훈
"수학적으로 안전하게 고쳤다"(전술 순위 역전 불가 증명)와 "실전에서 이득이다"는 다른 문제였음. 고정 depth 노드 수 비교는 버그(순위 역전)를 잡아내는 데는 유효했지만, 오버헤드가 이득을 상회하는지는 자가대국으로 실측하지 않으면 알 수 없었음.

### 관련 파일
- `client/src/utils/aiEngine.js` — 바운딩박스(`computeBBox`/`expandBBox`) 추가, `getCandidates`에 `bbox` 매개변수 반영. Killer/History/PVS는 구현 후 제거(최종 코드에는 남아있지 않음)

---

## #9 위급 방어 분기가 매 수마다 탐색을 완전히 생략함 (Yixin 벤치마크로 발견)

### 배경
`docs/TECHNICAL_SPEC.md` 5절 "성능 개선 방향"에 따라 VCT·시간예산·평가함수를 여러 번 개선해봤지만 `tools/bench-vs-yixin.mjs`(로컬 강한 엔진 Yixin 상대 벤치마크) 결과가 계속 베이스라인과 동일했음(2026-07-03~04). 원인을 찾기 위해 실제로 진 판 하나를 골라 백의 매 수 직전 `evaluate()` 점수를 추적함.

### 원인 분석
백 4수째까지는 평가가 무난(0→490)하다가 5수째에서 갑자기 -702로 급락하는 지점 발견. 그 지점에서 `findCriticalDefenseCells`를 직접 호출해보니 critical cell이 2개 검출됐는데, `getAIMove`의 "위급 방어" 분기는 이 경우 **`iterativeDeepeningSearch`(반복심화 탐색)를 아예 호출하지 않고** `scoreCell` 한 번만으로 즉시 반환하는 구조였음(`criticalCells.length===1`이면 즉시 반환, `>=2`면 `scoreCell` 정렬 후 최상위 하나만 반환). 같은 판 전체를 다시 추적하니 **백이 둔 10수 중 7수가 이 반사 분기**였음 — 강한 상대(Yixin)가 계속 위협을 만들어내는 한 AI는 거의 매 수 한 수 앞도 못 내다보는 반사적 방어만 반복하게 됨. VCT·시간예산·평가함수 개선이 전부 무효했던 이유가 설명됨 — 그 코드들은 전부 `iterativeDeepeningSearch` 경로 안에 있는데, 이 경로 자체가 게임의 대부분에서 거의 안 불렸음.

추가로 이 국면에서 critical cell 두 자리(`(6,8)`, `(10,4)`) 각각을 실제로 둬본 뒤 재확인하니 **둘 다 남은 critical cell이 없어져서**(즉 진짜 "막을 수 없는 이중 위협"이 아니라 둘 중 아무거나 막아도 즉시 위기는 해소됨) 반사 분기의 얕은 `scoreCell` 비교(`-702` vs `-896`)가 이 경우엔 우연히 맞는 선택을 했지만, 다른 국면에서는 우연에 의존하는 구조라는 게 확인됨.

### 해결
`criticalCells`를 찾아도 즉시 반환하지 않고, `orderCandidates`에 `forcedCells` 매개변수를 추가해 이 자리들이 `MAX_CANDIDATES_PER_NODE`(20)에 밀려 후보에서 잘려나가지 않도록 최우선 순위(`Infinity` 휴리스틱, TT수와 동급)로만 고정한다. 실제 선택은 `iterativeDeepeningSearch`가 몇 수 앞을 보고 결정 — `forcedCells`는 재귀 호출(`negamax`)에는 전달하지 않고 루트(`rootSearch`)에서만 적용해, 탐색 트리 내부 로직은 그대로 둔 채 "루트에서의 즉시 반환"만 "루트에서의 강제 후보 지정"으로 바꾼 최소 변경.

### 검증
- P0 회귀(열린사 방어, 자기 VCF 우선), `vite build` 정상
- 문제 국면 재현: 수정 전 2~3ms 만에 반사적으로 결정하던 것이, 수정 후 실제로 2000ms 전체 예산을 써서 탐색하는 것 확인(이 특정 국면에선 결과 수는 우연히 동일했음)
- 자가대국(300ms, 12판): 실행마다 6승6패~8승4패로 편차 있음(반복심화가 `Date.now()` 벽시계 기준이라 실행 시점에 따라 미세하게 다른 depth에서 끊기는 게 원인으로 추정)
- Yixin 벤치마크(렌주룰+백, 12판 vs 12판): 베이스라인 0승12패(평균 23.0수) vs 수정본 0승12패(평균 23.17수) — **거의 동일, Yixin 상대로는 유의미한 차이 없음**
- **최종 판단**: Yixin은 격차가 너무 커서 이 정도 구조 개선으로는 승패가 안 갈리는 것으로 추정. 다만 반사적 방어라는 구조적 결함 자체는 명백하고, 실제 서비스 상대(사람)는 Yixin보다 훨씬 약하니 이 수정이 거기서는 더 유효할 가능성이 있어 채택함(다운사이드 없음 — P0/회귀 전부 정상)

### 교훈
"자가대국 소표본은 신뢰할 수 없다"는 이 세션 내내 확인된 교훈이 이번에도 재현됨(같은 코드로 실행마다 6승6패~8승4패). 다만 이번엔 원인이 실제 국면 추적으로 명확히 규명된 구조적 결함이라, 승부수 표본이 흔들려도(Yixin 벤치마크가 중립이어도) 아키텍처 정합성 논리(반사적 0-ply 결정 제거)로 채택 여부를 판단할 수 있었음 — 모든 결정을 자가대국/외부벤치마크 승수에만 의존할 필요는 없다는 것.

### 관련 파일
- `client/src/utils/aiEngine.js` — `orderCandidates`/`rootSearch`/`iterativeDeepeningSearch`에 `forcedCells` 매개변수 추가, `getAIMove`의 위급 방어 즉시반환 로직 제거

---

## #10 aiEngine.js가 렌주 금수를 전혀 몰라 흑의 장목을 승리로 오판, 금수 함정도 활용 못 함

### 배경
`docs/todo.md` "AI 엔진 성능 향상 여지" 검토 중, `aiEngine.js`에 렌주 금수(33/44/장목) 관련 코드가 전혀 없다는 게 확인됨(`server/forbidden.js`/`client/src/utils/forbidden.js`의 `checkForbidden`과 완전히 분리). AI는 항상 백이라 자기 금수 걱정은 없지만, 다음 두 가지를 놓치고 있었다.

### 문제 1 — 흑의 장목(6목 이상)을 승리로 오판
`checkWinBoard`는 `count >= 5`만 확인해 5목이든 6목 이상이든 "승리"로 취급한다. 그런데 `server/index.js`(258행)를 보면 흑(`playerNumber===1`)의 착수는 **금수 판정을 승패 판정보다 먼저** 하고, 금수(장목 포함)면 그 자리에서 무조건 백 승리로 즉시 종료한다 — 흑에게는 장목이 "6목 완성"이 아니라 "즉시 패배"다. 그런데 `hasImmediateWin(board, candidates, player=1)`과 `findCriticalDefenseCells(board, candidates, opponent=1)`은 이 구분 없이 흑이 6목 이상을 만드는 자리를 그냥 "즉시 승리"·"위협"으로 판정하고 있었다 — 백이 불필요하게 막으려 들거나(`findCriticalDefenseCells`), `searchVCF`가 "상대가 먼저 이긴다"고 착각해 실제로는 안전한 강제수순을 스스로 포기할 수 있는(`hasImmediateWin`) 잠재적 버그.

### 문제 2 — 사(四)의 유일한 완성지점이 흑 금수인 경우를 활용 못 함
`searchVCF`는 백의 사(四)가 완성 지점을 1곳만 가지면 "상대가 그 자리를 막는다"고 가정하고 재귀 탐색한다. 하지만 그 완성 지점이 흑에게 33/44/장목 중 하나라면, 흑은 그 자리에 둘 수 없다(두면 5목 완성 여부와 무관하게 즉시 패배). 즉 이 경우 흑은 막을 방법이 없어 완성 지점 2곳 이상(오픈사)인 경우와 마찬가지로 확정승리인데, 기존 코드는 이를 놓치고 계속 "상대가 막는다"고 가정해 더 깊이(때로는 헛되이) 탐색했다.

### 해결
`client/src/utils/forbidden.js`의 `checkForbidden(board, row, col)`을 `aiEngine.js`에 import해 세 곳에 반영.

- `hasImmediateWin`: `player === 1 && checkForbidden(...) !== null`이면 그 후보를 건너뜀(흑의 금수 자리는 승리 아님)
- `findCriticalDefenseCells`: `opponent === 1 && checkForbidden(...) !== null`이면 그 후보를 건너뜀(흑의 금수 자리는 막을 필요 없는 위협)
- `searchVCF`: 완성 지점이 1곳이고 `opponent === 1 && checkForbidden(board, block.row, block.col) !== null`이면, 완성 지점 2곳 이상인 경우와 동일하게 즉시 확정승리로 반환

### 검증
격리 단위 테스트로 정확성을 직접 확인(자가대국은 상대 엔진도 금수 인식이 없어 이 기능을 제대로 시험 못 함 — 아래 "교훈" 참고):
- **대조군 구성**: 백 삼(row7 col5~7)의 양끝을 흑으로 막아, 사를 만들 수 있는 두 방향(col4 확장/col8 확장) 모두 완성지점이 정확히 1곳씩만 나오게 구성. 한쪽 완성지점(7,8)에 흑의 33 함정(세로+반대각선 열린삼 동시완성)을 깔아둔 버전과, 함정 없이 평범한 빈 칸인 버전을 각각 테스트
- **함정 있음**: `checkForbidden(board,7,8)` → `'33'` 확인 후 `searchVCF(board,2,0)` → `[{row:7,col:4}]` 반환(확정승리로 인식, 정상)
- **함정 없음**: 같은 모양에서 `searchVCF` → `null` 반환(강제승리 아님, 정상 — 오탐 없음 확인)
- 장목 테스트: 흑 4목(col3~6)+빈칸(col8) 상태에서 (7,7)이 장목 금수인지 확인(`checkForbidden` → `'장목'`) 후 `hasImmediateWin`(false 정상)·`findCriticalDefenseCells`(빈 배열 정상) 확인
- P0 회귀(열린사 방어, 자기 VCF 우선), 성능(2000ms 예산 내 정상), `vite build` 전부 통과
- Yixin 벤치마크(렌주룰+백, 6판): 베이스라인과 큰 차이 없음(0승6패, 평균 23.7수) — 예상된 결과(아래 교훈 참고)

### 교훈
이 기능은 "사의 유일한 완성지점이 하필 상대 금수"라는 매우 구체적인 전술적 정렬이 있어야만 발동하는 니치 케이스라, 6판 정도의 표본으로는 발동 여부 자체가 우연에 가깝다 — 이 세션에서 실패했던 여섯 번의 "모든 국면에 일반 적용되는" 시도들과 성격이 다르므로, Yixin 벤치마크 승수만으로 채택 여부를 판단하면 안 되고 격리된 단위 테스트로 로직 정확성을 직접 검증하는 게 맞는 방식이었다. 또한 자가대국(미러매치)으로는 이 기능을 애초에 검증할 수 없다는 것도 확인됨 — 상대 엔진도 똑같이 금수를 모르는 `aiEngine.js` 사본이라, 백이 "여기는 흑이 못 막는다"고 판단해도 자가대국 하네스는 금수 규칙을 전혀 강제하지 않아 흑이 그냥 그 자리에 둬버린다. 렌주 규칙을 실제로 지키는 Yixin 상대로만 이 기능의 진짜 효과를 관찰할 수 있다.

### 관련 파일
- `client/src/utils/aiEngine.js` — `checkForbidden` import 추가, `hasImmediateWin`/`findCriticalDefenseCells`/`searchVCF` 세 곳에 반영
- `client/src/utils/forbidden.js` — 기존 `checkForbidden` 재사용(수정 없음)

---

## #11 사삼(4-3)을 삼삼(3-3) 금수로 오판정

### 증상
사용자가 실제 대국 스크린샷을 보내와 제보: 사(四) 하나 + 삼(三) 하나로 구성된, 렌주룰상 허용되는 "4-3" 모양인데 그 완성 지점이 33(더블삼) 금수로 표시됨.

### 원인 분석
이미지 속 정확한 좌표를 단정할 수 없어, 사+삼 조합을 여러 방향으로 구성해 `checkForbidden`을 직접 호출하며 체계적으로 재현을 시도함. 가로줄에 흑 (7,6)(7,7) + (7,10), 세로줄에 흑 (6,8)(9,8)을 두고 (7,8)을 검사하면(가로는 사, 세로는 진짜 독립적인 삼) `checkForbidden(board,7,8)`이 `'33'`을 반환하는 것을 확인.

`_hasFour`(7,8, 가로)와 `_hasOpenThree`(7,8, 가로)를 각각 직접 호출해보니 **둘 다 `true`**를 반환함. 원인: `_hasOpenThree`는 6칸 창을 여러 오프셋으로 슬라이딩하며 검사하는데, 이미 사(四)로 완성된 가로줄(col6,7,8,10, col9가 완성지점)이 **더 앞쪽 오프셋에서 다른 빈 칸(col5)을 완성지점 삼는 "열린삼" 패턴과도 동시에 일치**해버림 — 같은 돌들을 다른 창으로 잘라 보는 것뿐인데 별개의 삼으로 잡힘. `checkForbidden`의 삼 집계 루프(`for (const [dr,dc] of DIRS) { if (_hasOpenThree(...)) threes++ ... }`)는 각 방향을 사 여부와 무관하게 독립적으로 카운트하므로, 가로(사이자 가짜삼) + 세로(진짜삼) = threes 2개로 집계돼 33으로 오판정됨. 실제로는 사 1개 + 삼 1개(허용되는 4-3)일 뿐임.

### 해결
`checkForbidden`에서 사(四) 판정 루프를 돌 때 사로 확인된 방향들을 `fourDirs` Set에 기록해두고, 삼 집계 루프에서 이미 `fourDirs`에 있는 방향은 건너뛰도록 수정. 한 방향이 사로 이미 판정됐다면 그 방향에서 `_hasOpenThree`가 무엇을 반환하든 삼 집계에서 제외한다 — 사와 삼은 서로 다른 방향(줄)에서 나와야 진짜 3-3/4-3 판정이 의미 있기 때문.

`client/src/utils/forbidden.js`(클라이언트 ESM)와 `server/forbidden.js`(서버 CJS) 둘 다 완전히 동일한 로직을 중복 구현하고 있어 같은 버그가 있었고, 둘 다 동일하게 수정함.

### 검증
- 재현 케이스(사+삼): `null`로 정상화 확인(수정 전 `'33'`)
- 회귀 테스트: 진짜 3-3(독립된 삼 2개) → 여전히 `'33'`, 진짜 4-4 → 여전히 `'44'`, 단순 삼 하나 → `null`, 장목 → `'장목'` — 전부 정상
- 서버(`server/forbidden.js`)·클라이언트(`client/src/utils/forbidden.js`) 양쪽 동일 검증
- `vite build` 통과

### 교훈
`_hasFour`와 `_hasOpenThree`를 4방향에 대해 독립적으로 돌리면서 "한 방향이 사이면서 동시에 삼으로도 보일 수 있다"는 걸 놓쳤던 게 원인 — 두 함수 각각은 자기 역할(사 판정, 삼 판정)에 대해 개별적으로는 맞게 동작했지만, 그 결과를 합산하는 상위 로직이 "사와 삼은 서로 다른 방향에서 나와야 한다"는 렌주룰의 전제를 명시하지 않고 있었음. 개별 함수 단위 테스트만으로는 못 잡고, 실제 대국에서 나온 국면을 재현해서야 발견됨 — 사용자 제보(스크린샷)가 결정적이었음.

### 관련 파일
- `client/src/utils/forbidden.js`, `server/forbidden.js` — `checkForbidden`에 `fourDirs` 추적 및 삼 집계 시 제외 로직 추가
