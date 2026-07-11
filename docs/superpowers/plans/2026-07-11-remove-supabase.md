# Supabase 제거 → Upstash Redis 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supabase(Postgres) 의존성을 제거하고, 서버리스 API(`/api/data`, `/api/admin`)가 Upstash Redis를 통해 사용자별 명함/영수증 데이터를 저장·조회하도록 전환한다.

**Architecture:** `api/_lib/store.js`가 `name` 키의 사용자 JSON 문서(`user:{name}`)와 이름 인덱스(`users:index` Set)를 다루는 얇은 저장소 계층을 제공한다. `createStore(redisClient)` 형태의 의존성 주입으로 실서비스에서는 `@upstash/redis`를, 테스트에서는 인메모리 fake를 사용한다. `api/data.js`/`api/admin.js`는 액션 분기·검증 로직은 그대로 두고 DB 호출부만 이 store로 교체한다.

**Tech Stack:** `@upstash/redis`(REST 기반 클라이언트), Node 내장 `node:test`/`node:assert/strict`(신규 테스트 러너, 추가 의존성 없음).

## Global Constraints

- 스펙 문서: `docs/superpowers/specs/2026-07-11-remove-supabase-design.md`
- 프런트엔드(`src/api.js`, `src/App.jsx`)와 `/api/data`, `/api/admin`의 요청/응답 계약은 변경하지 않는다.
- `/api/parse.js`, `/api/vcard.js`는 이번 작업과 무관 — 손대지 않는다.
- PIN 평문 저장 방식은 유지한다(기존 설계 결정 그대로, 변경 범위 아님).
- 새 저장소 함수 시그니처: `listUsers()`, `getUser(name)`, `putUser(user)`, `updateUser(name, patch)`, `deleteUser(name)`, `verifyUser(name, pin)` — 모든 작업에서 이 이름을 정확히 그대로 사용한다.
- `user` 객체 형태: `{ name, pin, cards: [], receipts: [], createdAt }`.

---

### Task 1: 의존성 교체 및 테스트 러너 준비

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: `npm test` 명령으로 `node --test`가 `api/_lib/*.test.js`를 실행함.

- [ ] **Step 1: `package.json` 수정**

`dependencies`에서 `"@supabase/supabase-js": "^2.45.4"` 줄을 지우고 `"@upstash/redis": "^1.34.3"`을 추가한다. `scripts`에 `"test"`를 추가한다.

```json
{
  "name": "card-receipt-scanner",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "node --test api/_lib/*.test.js"
  },
  "dependencies": {
    "@upstash/redis": "^1.34.3",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.4",
    "vite": "^5.4.11"
  }
}
```

- [ ] **Step 2: 의존성 설치**

Run: `npm install`
Expected: `@supabase/supabase-js`가 `node_modules`에서 빠지고 `@upstash/redis`가 설치됨. exit code 0.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: Supabase 의존성 제거, Upstash Redis 의존성 추가"
```

---

### Task 2: `api/_lib/store.js` 저장소 계층 (TDD)

**Files:**
- Create: `api/_lib/store.js`
- Test: `api/_lib/store.test.js`

**Interfaces:**
- Consumes: 없음(순수 로직 + 주입된 redis 클라이언트).
- Produces:
  - `createStore(redis)` → `{ listUsers, getUser, putUser, updateUser, deleteUser, verifyUser }`
  - `getStore()` → `createStore(Redis.fromEnv())`의 싱글턴 (런타임 전용, 테스트에서는 사용하지 않음)
  - `listUsers(): Promise<Array<{name: string, pin: string}>>` (name 오름차순 정렬)
  - `getUser(name: string): Promise<User|null>`
  - `putUser(user: User): Promise<void>`
  - `updateUser(name: string, patch: object): Promise<User|null>` (없으면 null)
  - `deleteUser(name: string): Promise<void>`
  - `verifyUser(name: string, pin: string): Promise<User|null>`

- [ ] **Step 1: 실패하는 테스트 작성**

`api/_lib/store.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "./store.js";

function makeFakeRedis() {
  const data = new Map();
  const sets = new Map();
  return {
    async get(key) {
      return data.has(key) ? data.get(key) : null;
    },
    async set(key, value) {
      data.set(key, value);
    },
    async del(key) {
      data.delete(key);
    },
    async sadd(key, member) {
      if (!sets.has(key)) sets.set(key, new Set());
      sets.get(key).add(member);
    },
    async srem(key, member) {
      sets.get(key)?.delete(member);
    },
    async smembers(key) {
      return [...(sets.get(key) || [])];
    },
  };
}

test("putUser + getUser round-trip", async () => {
  const store = createStore(makeFakeRedis());
  await store.putUser({ name: "홍길동", pin: "1234", cards: [], receipts: [] });
  const user = await store.getUser("홍길동");
  assert.equal(user.name, "홍길동");
  assert.equal(user.pin, "1234");
  assert.deepEqual(user.cards, []);
});

test("getUser returns null for missing user", async () => {
  const store = createStore(makeFakeRedis());
  assert.equal(await store.getUser("없음"), null);
});

test("listUsers returns name+pin only, sorted by name", async () => {
  const store = createStore(makeFakeRedis());
  await store.putUser({ name: "나", pin: "1111", cards: [], receipts: [] });
  await store.putUser({ name: "가", pin: "2222", cards: [], receipts: [] });
  const users = await store.listUsers();
  assert.deepEqual(users, [
    { name: "가", pin: "2222" },
    { name: "나", pin: "1111" },
  ]);
});

test("verifyUser succeeds with correct pin, fails otherwise", async () => {
  const store = createStore(makeFakeRedis());
  await store.putUser({ name: "u", pin: "0000", cards: [], receipts: [] });
  const ok = await store.verifyUser("u", "0000");
  assert.equal(ok.name, "u");
  assert.equal(await store.verifyUser("u", "9999"), null);
  assert.equal(await store.verifyUser("nope", "0000"), null);
});

test("updateUser merges patch and returns updated user", async () => {
  const store = createStore(makeFakeRedis());
  await store.putUser({ name: "u", pin: "0000", cards: [], receipts: [] });
  const updated = await store.updateUser("u", { cards: [{ name: "card1" }] });
  assert.equal(updated.cards.length, 1);
  assert.equal(updated.pin, "0000");
});

test("updateUser returns null when user does not exist", async () => {
  const store = createStore(makeFakeRedis());
  assert.equal(await store.updateUser("missing", { cards: [] }), null);
});

test("deleteUser removes user and index entry", async () => {
  const store = createStore(makeFakeRedis());
  await store.putUser({ name: "u", pin: "0000", cards: [], receipts: [] });
  await store.deleteUser("u");
  assert.equal(await store.getUser("u"), null);
  assert.deepEqual(await store.listUsers(), []);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test`
Expected: FAIL — `api/_lib/store.js`를 찾을 수 없다는 에러(`Cannot find module './store.js'` 또는 동일 취지).

- [ ] **Step 3: 최소 구현 작성**

`api/_lib/store.js`:

```javascript
// 사용자별 명함/영수증을 Upstash Redis에 저장하는 저장소 계층.
// user:{name} 키에 사용자 JSON 문서 전체를 저장하고,
// users:index Set에 존재하는 이름을 유지해 목록 조회 시 스캔을 피한다.
import { Redis } from "@upstash/redis";

const INDEX_KEY = "users:index";
const userKey = (name) => `user:${name}`;

export function createStore(redis) {
  return {
    async listUsers() {
      const names = await redis.smembers(INDEX_KEY);
      const sorted = [...(names || [])].sort();
      const users = await Promise.all(sorted.map((name) => redis.get(userKey(name))));
      return users.filter(Boolean).map((u) => ({ name: u.name, pin: u.pin }));
    },

    async getUser(name) {
      return (await redis.get(userKey(name))) || null;
    },

    async putUser(user) {
      await redis.set(userKey(user.name), user);
      await redis.sadd(INDEX_KEY, user.name);
    },

    async updateUser(name, patch) {
      const existing = await redis.get(userKey(name));
      if (!existing) return null;
      const updated = { ...existing, ...patch };
      await redis.set(userKey(name), updated);
      return updated;
    },

    async deleteUser(name) {
      await redis.del(userKey(name));
      await redis.srem(INDEX_KEY, name);
    },

    async verifyUser(name, pin) {
      const user = await redis.get(userKey(name));
      if (!user) return null;
      if ((user.pin || "") !== (pin || "")) return null;
      return user;
    },
  };
}

let _default = null;
export function getStore() {
  if (_default) return _default;
  _default = createStore(Redis.fromEnv());
  return _default;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — 7개 테스트 모두 통과.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/store.js api/_lib/store.test.js
git commit -m "feat: Upstash Redis 기반 저장소 계층(store.js) 추가"
```

---

### Task 3: `api/data.js`를 store.js로 전환

**Files:**
- Modify: `api/data.js`

**Interfaces:**
- Consumes: Task 2의 `getStore()`, `listUsers`, `getUser`, `putUser`, `updateUser`, `verifyUser`.

- [ ] **Step 1: import 및 각 action의 DB 호출부 교체**

`api/data.js` 전체를 아래로 교체한다(액션 분기·상태 코드·에러 메시지는 원본과 동일하게 유지):

```javascript
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
  const store = getStore();

  try {
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
```

- [ ] **Step 2: 기존 store 테스트가 여전히 통과하는지 확인 (회귀 없음)**

Run: `npm test`
Expected: PASS — Task 2의 7개 테스트 모두 여전히 통과(이 파일은 store.js를 바꾸지 않았으므로 영향 없음).

- [ ] **Step 3: Commit**

```bash
git add api/data.js
git commit -m "refactor: api/data.js가 Supabase 대신 store.js를 사용하도록 전환"
```

---

### Task 4: `api/admin.js`를 store.js로 전환

**Files:**
- Modify: `api/admin.js`

**Interfaces:**
- Consumes: Task 2의 `getStore()`, `listUsers`, `updateUser`, `deleteUser`.

- [ ] **Step 1: import 및 각 action의 DB 호출부 교체**

`api/admin.js` 전체를 아래로 교체한다:

```javascript
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
```

- [ ] **Step 2: 회귀 확인**

Run: `npm test`
Expected: PASS — 7개 테스트 모두 통과.

- [ ] **Step 3: Commit**

```bash
git add api/admin.js
git commit -m "refactor: api/admin.js가 Supabase 대신 store.js를 사용하도록 전환"
```

---

### Task 5: 옛 Supabase 클라이언트 제거, 스키마 파일 legacy로 이동

**Files:**
- Delete: `api/_lib/supabase.js`
- Move: `supabase/schema.sql` → `legacy/supabase-schema.sql`

**Interfaces:**
- Consumes: 없음 (Task 3, 4가 이미 `api/_lib/supabase.js`에 대한 모든 import를 제거했음을 전제).

- [ ] **Step 1: 남은 참조가 없는지 확인**

Run: `grep -rn "_lib/supabase" api/ src/ 2>/dev/null`
Expected: 출력 없음(빈 결과). 출력이 있다면 Task 3/4가 불완전한 것이므로 먼저 바로잡는다.

- [ ] **Step 2: 파일 이동/삭제**

```bash
mkdir -p legacy
git mv supabase/schema.sql legacy/supabase-schema.sql
git rm api/_lib/supabase.js
rmdir supabase 2>/dev/null || true
```

- [ ] **Step 3: 테스트로 회귀 확인**

Run: `npm test`
Expected: PASS — 7개 테스트 모두 통과(이 변경은 테스트 대상 파일에 영향 없음).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: 옛 Supabase 클라이언트 삭제, 스키마 파일을 legacy/로 이동"
```

---

### Task 6: 마이그레이션 스크립트

**Files:**
- Create: `scripts/migrate-supabase-to-upstash.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: Task 2의 `createStore` (동일한 `putUser` 시맨틱으로 데이터를 옮기기 위해 재사용).

- [ ] **Step 1: `.gitignore`에 로컬 자격증명 파일 추가**

`.gitignore`에 `.env.migration` 한 줄을 추가한다:

```
node_modules
dist
.env
.env.local
.env.migration
.vercel
.DS_Store
*.log
```

- [ ] **Step 2: 마이그레이션 스크립트 작성**

`scripts/migrate-supabase-to-upstash.mjs`:

```javascript
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
```

- [ ] **Step 3: 문법/임포트 확인 (실제 자격증명 없이 dry-run)**

Run: `node --check scripts/migrate-supabase-to-upstash.mjs`
Expected: 출력 없음(구문 오류 없음, exit code 0). 실제 마이그레이션 실행은 Task 8(배포 단계)에서 진행한다.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-supabase-to-upstash.mjs .gitignore
git commit -m "feat: Supabase → Upstash 1회성 마이그레이션 스크립트 추가"
```

---

### Task 7: 문서 갱신

**Files:**
- Modify: `.env.example`
- Modify: `README_DEPLOY.md`
- Modify: `PROJECT_NOTES.md`

**Interfaces:**
- Consumes: 없음(문서 전용 변경).

- [ ] **Step 1: `.env.example` 갱신**

`.env.example` 전체를 아래로 교체한다:

```
# ── 서버리스 함수 전용 (브라우저에 노출되지 않음) ──
# Anthropic API 키 (OCR 프록시용)
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxx

# Upstash Redis (Vercel 대시보드 → Storage/Marketplace → Upstash 연동 시 자동 주입됨)
UPSTASH_REDIS_REST_URL=https://xxxxxxxxxxxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=AxxxXXXXxxxx...

# 관리자 비밀번호 (기본값 바꾸기)
ADMIN_PASSWORD=change-this-please

# (선택) OCR 기본 모델 — 설정하지 않으면 코드 기본값 claude-sonnet-4-6 사용.
# ⚠️ 폐기된 'claude-sonnet-4-20250514'를 넣으면 API가 거부해 인식이 실패하니 넣지 말 것.
# 굳이 고정하려면 아래처럼 현재 유효한 식별자를 사용:
# ANTHROPIC_MODEL=claude-sonnet-4-6

# (선택) 고급 인식 모델 — 정확도 우선 토글 시 사용. 비우면 코드 기본값 claude-opus-4-6 사용.
# ANTHROPIC_MODEL_HQ=claude-opus-4-6

# ── 아래는 기존 Supabase 데이터를 옮길 때만 일회성으로 필요 (scripts/migrate-supabase-to-upstash.mjs) ──
# .env.migration 파일에 별도로 넣고, 마이그레이션 완료 후 지운다.
# SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
# SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
```

- [ ] **Step 2: `README_DEPLOY.md` 갱신**

`README_DEPLOY.md` 전체를 아래로 교체한다:

```markdown
# 배포 가이드 — 명함 · 영수증 스캐너

단일 아티팩트(`scanner_app.jsx`)를 **Vercel + Upstash Redis**로 독립 배포할 수 있게 재구성한 프로젝트입니다.

## 구조

```
프런트(React/Vite)
  └─ /api/parse   → Anthropic (OCR, ANTHROPIC_API_KEY 서버 보관)
  └─ /api/data    → Upstash Redis (이름+PIN 재검증 후 CRUD)
  └─ /api/admin   → Upstash Redis (관리자: PIN확인/재설정/삭제)
```

핵심: **브라우저는 저장소와 Anthropic에 직접 접근하지 않습니다.** 모든 키는 서버리스 함수 환경변수로만 존재하고, 데이터 요청마다 서버가 이름+PIN을 재검증합니다.

```
.
├─ index.html / vite.config.js / package.json   ← 빌드 설정
├─ src/
│  ├─ main.jsx          ← 진입점
│  ├─ App.jsx           ← 앱 본체 (기존 scanner_app.jsx 리팩터)
│  └─ api.js            ← /api/* 호출 클라이언트
├─ api/
│  ├─ parse.js          ← Anthropic 프록시
│  ├─ data.js           ← 사용자/명함/영수증 CRUD (PIN 검증)
│  ├─ admin.js          ← 관리자 기능
│  └─ _lib/store.js     ← Upstash Redis 저장소 계층
├─ scripts/migrate-supabase-to-upstash.mjs  ← 옛 Supabase 데이터 1회성 이전
├─ legacy/supabase-schema.sql  ← 옛 Supabase 스키마(참고용)
└─ public/icons/        ← PWA 아이콘
```

> `scanner_app.jsx`(원본)는 참고용으로 남겨뒀습니다. 실제 배포 본체는 `src/App.jsx` 입니다.

## 1. Upstash Redis 설정

1. Vercel 대시보드 → 프로젝트 → **Storage** 탭(또는 **Marketplace**) → **Upstash** 선택 → 무료 티어로 연동
2. 연동하면 `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`이 프로젝트 환경변수에 자동으로 추가됨
3. 로컬 개발용으로도 쓰려면 같은 값을 `.env`에 복사

Vercel을 거치지 않고 직접 만들려면 https://console.upstash.com 에서 Redis 데이터베이스를 생성하고 REST URL/TOKEN을 복사해도 됩니다.

## 2. 로컬 실행 (선택)

```bash
npm install
npm run dev    # http://localhost:5173
npm test       # api/_lib/store.js 단위 테스트
```

> 로컬에서 `/api/*` 까지 테스트하려면 `npm i -g vercel` 후 `vercel dev` 를 쓰는 게 가장 간단합니다. (환경변수는 `.env` 또는 `vercel env`)

## 3. Vercel 배포

1. 깃 저장소에 push (또는 `vercel` CLI로 업로드)
2. Vercel에서 New Project → 이 저장소 선택 (프레임워크 자동 감지: Vite)
3. **Settings → Environment Variables** 에 아래 등록 후 배포

| 변수 | 값 |
|---|---|
| `ANTHROPIC_API_KEY` | 본인 Anthropic API 키 |
| `UPSTASH_REDIS_REST_URL` | Upstash 연동 시 자동 주입(또는 Upstash 콘솔에서 복사) |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash 연동 시 자동 주입(또는 Upstash 콘솔에서 복사) |
| `ADMIN_PASSWORD` | 관리자 비밀번호 (기본 admin1234 대신 새로 지정) |
| `ANTHROPIC_MODEL` | (선택) 기본 `claude-sonnet-4-6` |
| `ANTHROPIC_MODEL_HQ` | (선택) 정확도 우선 모델. 기본 `claude-opus-4-6` |

`.env.example` 에 같은 목록이 있습니다.

## 4. 기존 Supabase 데이터가 있다면: 마이그레이션

1. 로컬에 `.env.migration` 파일을 만들고 아래 값을 채운다(`.gitignore`에 이미 등록되어 커밋되지 않음):
   ```
   SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
   UPSTASH_REDIS_REST_URL=https://xxxxxxxxxxxx.upstash.io
   UPSTASH_REDIS_REST_TOKEN=AxxxXXXXxxxx...
   ```
2. `node scripts/migrate-supabase-to-upstash.mjs` 실행 → "N명 마이그레이션 완료." 출력 확인
3. 아래 검증 체크리스트 수행
4. 문제 없으면 Supabase 프로젝트/키를 정리(삭제)한다. `.env.migration` 파일도 지운다.

## 5. 배포 후 검증 체크리스트

- [ ] (마이그레이션한 경우) 기존 사용자 이름 + PIN으로 로그인 → 기존 명함/영수증이 그대로 보이는지
- [ ] 새 사용자 생성 → PIN 설정 → 다시 로그인 되는지
- [ ] 사진 업로드 시 OCR(명함/영수증 자동 판별)이 동작하는지 (`/api/parse`)
- [ ] 영수증 저장/수정/삭제, 기간 필터, 집계, CSV 내보내기
- [ ] 다른 사용자로 전환 시 서로의 데이터가 안 보이는지
- [ ] 관리자 로그인 → PIN 확인/재설정/사용자 삭제
- [ ] **iPhone Safari**에서 명함 "연락처에 추가(.vcf)" 실제 등록되는지
- [ ] 홈 화면에 추가(PWA) → 독립 실행되는지

## 보안 메모 (의도된 수준)

- PIN은 평문 저장이며 관리자는 평문 확인이 가능합니다. 암호학적 보안이 아니라 "사내 사용자끼리 서로 못 들여다보게" 막는 실용적 장벽입니다. (원본 설계 유지)
- 다만 데이터 접근은 모두 서버에서 PIN을 재검증하므로, 브라우저에서 저장소를 직접 열어 남의 데이터를 보는 것은 불가능합니다.
- 사용자에게 은행 등과 다른 PIN을 쓰도록 안내하세요.

## 알려진 개선 여지 (다음 단계)

- 영수증 이미지가 현재 사용자 문서에 base64로 저장됩니다. 건수가 많아지면 **Vercel Blob** 등 별도 파일 저장소로 옮기는 것을 권장.
- PIN 무차별 대입 방지(rate limit) 미적용 — 필요 시 함수에 시도 제한 추가.
```

- [ ] **Step 3: `PROJECT_NOTES.md`의 저장소 관련 서술 갱신**

`PROJECT_NOTES.md`에서 아래 줄을 찾는다:

```
- **데이터 저장**: Google Sheets 공유 방식은 폐기(사용자 간 데이터 섞임 문제). 대신 **앱이 사용자별로 격리 저장** + 필요 시 CSV 내보내기.
```

다음으로 교체한다:

```
- **데이터 저장**: Google Sheets 공유 방식은 폐기(사용자 간 데이터 섞임 문제). 대신 **앱이 사용자별로 격리 저장**(Upstash Redis, `user:{이름}` 키에 JSON 문서) + 필요 시 CSV 내보내기. (Supabase는 비용/무료한도 문제로 2026-07 Upstash Redis로 전환)
```

- [ ] **Step 4: Commit**

```bash
git add .env.example README_DEPLOY.md PROJECT_NOTES.md
git commit -m "docs: Supabase → Upstash Redis 전환에 맞춰 배포 문서 갱신"
```

---

### Task 8: 배포 및 마이그레이션 실행 (사용자 진행)

이 작업은 사용자의 Vercel/Upstash/Supabase 계정 접근이 필요해 에이전트가 대신 실행할 수 없다. 코드가 모두 `main`에 push된 뒤, 사용자와 함께 아래 순서로 진행한다.

**Files:** 없음(운영 작업).

- [ ] **Step 1: 코드 push**

```bash
git push origin main
```

- [ ] **Step 2: Vercel에 Upstash 연동 추가**

Vercel 대시보드 → 프로젝트 → Storage/Marketplace → Upstash 선택 → 무료 티어로 연동. 이 과정에서 `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`이 자동으로 프로젝트 환경변수에 추가된다.

- [ ] **Step 3: 옛 Supabase 환경변수 제거**

Vercel 대시보드 → Settings → Environment Variables에서 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`를 삭제.

- [ ] **Step 4: 재배포**

Push로 이미 자동 배포되지만, 환경변수만 바뀐 경우 Vercel 대시보드에서 Redeploy를 눌러 새 환경변수가 반영되게 한다.

- [ ] **Step 5: 마이그레이션 실행 (기존 Supabase 데이터가 있는 경우)**

로컬에서 `.env.migration` 파일에 두 서비스 자격증명을 모두 채운 뒤:

```bash
node scripts/migrate-supabase-to-upstash.mjs
```

Expected: `N명 마이그레이션 완료.` 출력.

- [ ] **Step 6: `README_DEPLOY.md`의 "배포 후 검증 체크리스트" 전체 수행**

실제 배포 URL(`https://ai-ocr-scanner.vercel.app/`)에서 로그인, OCR, 저장/조회, 관리자 기능, 사용자 간 데이터 격리를 직접 확인한다.

- [ ] **Step 7: 정리**

검증이 끝나면 Supabase 프로젝트/키, 로컬 `.env.migration` 파일을 정리한다(둘 다 되돌릴 수 없는 작업이므로 검증 완료 후에만 진행).

---

## Self-Review 메모

- 스펙의 모든 섹션(데이터 모델, 코드 변경, 환경변수, 마이그레이션, 문서 갱신, 배포 절차, 검증 체크리스트)이 Task 1~8에 매핑됨.
- 함수 시그니처(`listUsers/getUser/putUser/updateUser/deleteUser/verifyUser`)는 Task 2에서 정의된 그대로 Task 3, 4, 6에서 동일하게 사용됨.
- `user` 객체 필드명(`name/pin/cards/receipts/createdAt`)이 Task 2/3/6에서 일관됨.
