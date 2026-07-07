const GIS_SRC = 'https://accounts.google.com/gsi/client'

let scriptPromise = null
function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.defer = true
    script.onload = resolve
    script.onerror = reject
    document.head.appendChild(script)
  })
  return scriptPromise
}

// containerId 엘리먼트 안에 Google 로그인 버튼을 렌더링한다.
// 로그인 성공 시 onCredential(idTokenString)이 호출된다.
export async function renderGoogleButton(containerId, onCredential) {
  await loadGoogleScript()
  window.google.accounts.id.initialize({
    client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
    callback: (response) => onCredential(response.credential),
  })
  window.google.accounts.id.renderButton(
    document.getElementById(containerId),
    { theme: 'outline', size: 'large', text: 'signin_with' }
  )
}

export async function loginWithGoogle(credential) {
  const res = await fetch('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ credential }),
  })
  if (!res.ok) throw new Error('로그인에 실패했습니다.')
  return res.json()
}

export async function fetchMe() {
  const res = await fetch('/api/auth/me', { credentials: 'include' })
  if (!res.ok) return null
  return res.json()
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
}
