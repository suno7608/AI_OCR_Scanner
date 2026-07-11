// /api/admin — 관리자 전용 (PIN 확인 / 재설정 / 사용자 삭제)
// 관리자 비밀번호는 ADMIN_PASSWORD 환경변수(서버 전용)로 검증한다.
import { getStore } from "./_lib/store.js";

const PIN_RE = /^\d{4}$/;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST만 허용됩니다." });
  }

  const body = req.body || {};
  const adminPassword = String(body.adminPassword || "");
  const expected = process.env.ADMIN_PASSWORD;

  if (!expected) {
    return res.status(500).json({ error: "서버에 ADMIN_PASSWORD가 설정되지 않았습니다." });
  }
  if (adminPassword !== expected) {
    return res.status(401).json({ error: "비밀번호가 틀렸습니다." });
  }

  try {
    const store = getStore();
    const action = body.action;

    if (action === "verify") {
      return res.status(200).json({ ok: true });
    }

    // 관리자만 PIN 평문을 볼 수 있다 (데이터 내용은 제외)
    if (action === "listUsers") {
      const users = await store.listUsers();
      return res.status(200).json({ users });
    }

    if (action === "resetPin") {
      const name = String(body.name || "").trim();
      const pin = String(body.pin || "");
      if (!PIN_RE.test(pin)) return res.status(400).json({ error: "PIN은 4자리 숫자여야 합니다." });
      await store.updateUser(name, { pin });
      return res.status(200).json({ ok: true });
    }

    if (action === "deleteUser") {
      const name = String(body.name || "").trim();
      await store.deleteUser(name);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "알 수 없는 요청입니다." });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
}
