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
