#!/usr/bin/env node
// 1회성 스크립트: 기존 Supabase `users` 테이블 데이터를 Upstash Redis로 옮긴다.
// Vercel 서버리스 함수로는 배포되지 않으며, 로컬에서 한 번만 실행한다.
//
// 필요한 환경변수(.env.migration 파일 또는 쉘 환경에 설정, 두 서비스 자격증명 모두 필요):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
//
// 실행: node scripts/migrate-supabase-to-upstash.mjs
import { readFileSync, existsSync } from "node:fs";
import { Redis } from "@upstash/redis";
import { createStore } from "../api/_lib/store.js";

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnvFile(new URL("../.env.migration", import.meta.url));

async function fetchSupabaseUsers(url, serviceRoleKey) {
  const res = await fetch(`${url}/rest/v1/users?select=*`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Supabase 조회 실패: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 필요합니다 (.env.migration).");
  }
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    throw new Error("UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN이 필요합니다 (.env.migration).");
  }

  const rows = await fetchSupabaseUsers(supabaseUrl, supabaseKey);
  const store = createStore(Redis.fromEnv());

  let count = 0;
  for (const row of rows) {
    await store.putUser({
      name: row.name,
      pin: row.pin || "",
      cards: row.cards || [],
      receipts: row.receipts || [],
      createdAt: row.created_at || new Date().toISOString(),
    });
    count++;
  }
  console.log(`${count}명 마이그레이션 완료.`);
}

main().catch((e) => {
  console.error("마이그레이션 실패:", e.message || e);
  process.exit(1);
});
