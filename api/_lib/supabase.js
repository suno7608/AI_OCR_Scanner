// 서버 전용 Supabase 클라이언트 (service-role 키 사용)
// service-role 키는 RLS를 우회하므로 절대 브라우저로 내보내지 않는다.
import { createClient } from "@supabase/supabase-js";

let _client = null;

export function getSupabase() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
  }
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

// 이름+PIN 검증. 성공 시 사용자 row 반환, 실패 시 null.
export async function verifyUser(name, pin) {
  const db = getSupabase();
  const { data, error } = await db.from("users").select("*").eq("name", name).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if ((data.pin || "") !== (pin || "")) return null;
  return data;
}
