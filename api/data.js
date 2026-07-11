// /api/data — 사용자/명함/영수증 CRUD
// 모든 데이터 접근은 이름+PIN을 서버에서 재검증한 뒤에만 수행된다.
// (다른 사용자의 PIN/데이터는 클라이언트로 절대 내려가지 않는다.)
import { getStore } from "./_lib/store.js";

const PIN_RE = /^\d{4}$/;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST만 허용됩니다." });
  }

  const body = req.body || {};
  const action = body.action;

  try {
    const store = getStore();
    // ── 사용자 목록 (PIN 노출 없음) ──
    if (action === "listUsers") {
      const list = await store.listUsers();
      const users = list.map((u) => ({ name: u.name, hasPin: !!(u.pin && u.pin.length) }));
      return res.status(200).json({ users });
    }

    // ── 사용자 생성 ──
    if (action === "createUser") {
      const name = String(body.name || "").trim();
      const pin = String(body.pin || "");
      if (!name) return res.status(400).json({ error: "이름이 필요합니다." });
      if (!PIN_RE.test(pin)) return res.status(400).json({ error: "PIN은 4자리 숫자여야 합니다." });
      const existing = await store.getUser(name);
      if (existing) return res.status(409).json({ error: "이미 있는 이름입니다." });
      await store.putUser({ name, pin, cards: [], receipts: [], createdAt: new Date().toISOString() });
      return res.status(200).json({ ok: true });
    }

    // ── PIN 미설정 계정에 최초 PIN 설정 ──
    if (action === "setPin") {
      const name = String(body.name || "").trim();
      const pin = String(body.pin || "");
      if (!PIN_RE.test(pin)) return res.status(400).json({ error: "PIN은 4자리 숫자여야 합니다." });
      const u = await store.getUser(name);
      if (!u) return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
      if (u.pin && u.pin.length) return res.status(409).json({ error: "이미 PIN이 설정되어 있습니다." });
      await store.updateUser(name, { pin });
      return res.status(200).json({ ok: true });
    }

    // ── 인증 ──
    if (action === "auth") {
      const u = await store.verifyUser(String(body.name || "").trim(), String(body.pin || ""));
      if (!u) return res.status(401).json({ error: "PIN이 틀렸습니다." });
      return res.status(200).json({ ok: true });
    }

    // ── 이하 데이터 작업: 이름+PIN 검증 필수 ──
    const name = String(body.name || "").trim();
    const pin = String(body.pin || "");
    const user = await store.verifyUser(name, pin);
    if (!user) return res.status(401).json({ error: "인증이 필요합니다." });

    if (action === "getCards") {
      return res.status(200).json({ cards: user.cards || [] });
    }
    if (action === "getReceipts") {
      return res.status(200).json({ receipts: user.receipts || [] });
    }
    if (action === "saveCards") {
      const cards = Array.isArray(body.cards) ? body.cards : [];
      await store.updateUser(name, { cards });
      return res.status(200).json({ ok: true });
    }
    if (action === "saveReceipts") {
      const receipts = Array.isArray(body.receipts) ? body.receipts : [];
      await store.updateUser(name, { receipts });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "알 수 없는 요청입니다." });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
}
