// 로컬에 설치된 Yixin(Gomocup 상위권 엔진, docs/todo.md 2026-07-04 참고)에게
// BOARD 명령(pbrain 프로토콜)으로 초반 국면을 주고 "이 자리면 뭘 두겠냐"를 직접
// 질의해서 얻은 백의 4/6수째 응수. 웹에서 찾은 렌주 정석 이론(26개 명명 오프닝)은
// 좌표 데이터가 이미지에만 있고 스왑 규칙이 있는 대회 프로토콜 전제라 이 프로젝트의
// 단순 교대 규칙에 그대로 안 맞아 채택하지 않음 — 대신 이미 이 세션에서 검증된
// 실제 강한 엔진의 실전 응수를 그대로 가져옴.
//
// key: 그 시점 보드의 모든 돌을 "row,col,player" 문자열로 만들어 정렬·결합한 것
// (boardKey와 동일한 형식이어야 매치됨). 흑의 첫 수가 항상 정중앙(7,7)이고 백의
// 2수째가 getOpeningMove(8방향 무작위) 중 하나라는 전제로, 8방향 전부에 대해 각각
// 라인을 생성해뒀다 — 백의 2수째가 무엇이든 그 이후 흑의 실제 응수가 해당 라인과
// 정확히 일치할 때만 사용됨. 안 맞으면 아래 getAIMove가 정상 탐색으로 넘어감
export const OPENING_BOOK = [
  // 백 2수째 = 6,7 (위)
  { key: '5,6,1|6,7,2|7,7,1', move: { row: 6, col: 6 } },
  { key: '5,6,1|6,6,2|6,7,2|6,8,1|7,7,1', move: { row: 5, col: 9 } },
  // 백 2수째 = 8,7 (아래)
  { key: '7,7,1|8,7,2|9,8,1', move: { row: 8, col: 8 } },
  { key: '7,7,1|8,6,1|8,7,2|8,8,2|9,8,1', move: { row: 9, col: 5 } },
  // 백 2수째 = 7,6 (왼쪽)
  { key: '7,6,2|7,7,1|8,5,1', move: { row: 8, col: 6 } },
  { key: '6,6,1|7,6,2|7,7,1|8,5,1|8,6,2', move: { row: 5, col: 5 } },
  // 백 2수째 = 7,8 (오른쪽)
  { key: '6,9,1|7,7,1|7,8,2', move: { row: 6, col: 8 } },
  { key: '6,8,2|6,9,1|7,7,1|7,8,2|8,8,1', move: { row: 9, col: 9 } },
  // 백 2수째 = 6,6 (좌상 대각)
  { key: '6,5,1|6,6,2|7,7,1', move: { row: 7, col: 6 } },
  { key: '6,5,1|6,6,2|7,6,2|7,7,1|8,6,1', move: { row: 9, col: 5 } },
  // 백 2수째 = 6,8 (우상 대각)
  { key: '5,8,1|6,8,2|7,7,1', move: { row: 6, col: 7 } },
  { key: '5,8,1|6,6,1|6,7,2|6,8,2|7,7,1', move: { row: 5, col: 5 } },
  // 백 2수째 = 8,6 (좌하 대각)
  { key: '7,7,1|7,8,1|8,6,2', move: { row: 7, col: 9 } },
  { key: '7,7,1|7,8,1|7,9,2|8,6,2|8,7,1', move: { row: 9, col: 7 } },
  // 백 2수째 = 8,8 (우하 대각)
  { key: '7,7,1|7,8,1|8,8,2', move: { row: 7, col: 6 } },
  { key: '6,7,1|7,6,2|7,7,1|7,8,1|8,8,2', move: { row: 8, col: 7 } },
]

const BOOK_MAP = new Map(OPENING_BOOK.map(({ key, move }) => [key, move]))

export function boardKey(board) {
  const stones = []
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board.length; c++) {
      if (board[r][c] !== 0) stones.push(`${r},${c},${board[r][c]}`)
    }
  }
  return stones.sort().join('|')
}

export function lookupBook(board) {
  return BOOK_MAP.get(boardKey(board)) ?? null
}
