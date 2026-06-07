// ─────────────────────────────────────────────────────────────
// API 클라이언트
// 브라우저는 DB/Anthropic에 직접 접근하지 않는다.
// 모든 요청은 우리 서버리스 함수(/api/*)를 거치며,
// 함수가 서버 전용 키로 처리한다.
// ─────────────────────────────────────────────────────────────

// 로그인한 사용자의 세션(이름 + PIN)을 메모리에 보관.
// 데이터 요청마다 서버가 PIN을 재검증한다(다른 사용자에게 PIN/데이터 노출 없음).
let session = { name: null, pin: null };

export function setSession(name, pin) {
  session = { name, pin };
}
export function clearSession() {
  session = { name: null, pin: null };
}

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error("서버 응답을 읽지 못했습니다.");
  }
  if (!res.ok) {
    throw new Error(json?.error || `요청 실패 (${res.status})`);
  }
  return json;
}

// ── 사용자 / 인증 ──
export function listUsers() {
  // [{ name, hasPin }] — PIN 자체는 절대 내려보내지 않음
  return post("/api/data", { action: "listUsers" }).then((r) => r.users || []);
}
export function createUser(name, pin) {
  return post("/api/data", { action: "createUser", name, pin });
}
export function authUser(name, pin) {
  // 성공 시 {ok:true}, 실패 시 throw
  return post("/api/data", { action: "auth", name, pin });
}
export function setUserPin(name, pin) {
  // PIN 미설정 계정에 최초 PIN 설정 (레거시 마이그레이션 경로)
  return post("/api/data", { action: "setPin", name, pin });
}

// ── 데이터 (세션 사용) ──
export function getCards() {
  return post("/api/data", { action: "getCards", name: session.name, pin: session.pin })
    .then((r) => r.cards || []);
}
export function saveCards(list) {
  return post("/api/data", { action: "saveCards", name: session.name, pin: session.pin, cards: list });
}
export function getReceipts() {
  return post("/api/data", { action: "getReceipts", name: session.name, pin: session.pin })
    .then((r) => r.receipts || []);
}
export function saveReceipts(list) {
  return post("/api/data", { action: "saveReceipts", name: session.name, pin: session.pin, receipts: list });
}

// ── 관리자 ──
export function adminListUsers(adminPassword) {
  return post("/api/admin", { action: "listUsers", adminPassword }).then((r) => r.users || []);
}
export function adminResetPin(adminPassword, name, pin) {
  return post("/api/admin", { action: "resetPin", adminPassword, name, pin });
}
export function adminDeleteUser(adminPassword, name) {
  return post("/api/admin", { action: "deleteUser", adminPassword, name });
}
export function adminVerify(adminPassword) {
  return post("/api/admin", { action: "verify", adminPassword });
}

// ── OCR 파싱 (Anthropic 프록시) ──
export function parseImage(base64, mediaType) {
  return post("/api/parse", { base64, mediaType }); // → { type, data }
}
