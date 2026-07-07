const ADJECTIVES = ['조용한', '빠른', '용감한', '느긋한', '영리한', '든든한', '유쾌한', '차분한']
const NOUNS = ['너구리', '사자', '고양이', '까치', '다람쥐', '수달', '여우', '부엉이']
const STORAGE_KEY = 'omok_guest_nickname'

function randomPick(list) {
  return list[Math.floor(Math.random() * list.length)]
}

export function generateNickname() {
  return `${randomPick(ADJECTIVES)}${randomPick(NOUNS)}`
}

// 같은 브라우저 탭 세션 동안은 같은 닉네임을 유지하고(재입장/재연결해도 안 바뀌게),
// 새 탭/새 세션이면 다시 생성한다 — 게스트에게 영속적 정체성을 주지 않기 위해 sessionStorage 사용
export function getGuestNickname() {
  let nickname = sessionStorage.getItem(STORAGE_KEY)
  if (!nickname) {
    nickname = generateNickname()
    sessionStorage.setItem(STORAGE_KEY, nickname)
  }
  return nickname
}
