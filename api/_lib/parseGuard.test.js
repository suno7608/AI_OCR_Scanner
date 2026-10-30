import { test } from "node:test";
import assert from "node:assert/strict";
import { authenticateParse, enforceParseQuota, readLimits } from "./parseGuard.js";

function makeCounterRedis() {
  const counts = new Map();
  const expires = new Map();
  return {
    counts,
    async incr(key) {
      const n = (counts.get(key) || 0) + 1;
      counts.set(key, n);
      return n;
    },
    async ttl(key) {
      return expires.has(key) ? expires.get(key) : -1;
    },
    async expire(key, sec) {
      expires.set(key, sec);
      return 1;
    },
  };
}

function limits(over = {}) {
  return { windowSec: 600, userMax: 2, ipMax: 5, authFailMax: 2, ...over };
}

function storeOf(pin = "1234") {
  return {
    calls: 0,
    async verifyUser(name, given) {
      this.calls += 1;
      if (name === "홍길동" && given === pin) return { name };
      return null;
    },
  };
}

test("readLimits uses defaults and ignores non-positive overrides", () => {
  assert.deepEqual(readLimits({}), {
    windowSec: 600,
    userMax: 120,
    ipMax: 400,
    authFailMax: 20,
  });
  assert.equal(readLimits({ PARSE_RATE_LIMIT_USER_MAX: "nope" }).userMax, 120);
  assert.equal(readLimits({ PARSE_RATE_LIMIT_USER_MAX: "0" }).userMax, 120);
  assert.equal(readLimits({ PARSE_RATE_LIMIT_USER_MAX: "15" }).userMax, 15);
  assert.equal(readLimits({ PARSE_RATE_LIMIT_WINDOW_SEC: "90.9" }).windowSec, 90);
});

test("missing credentials do not touch the store or Redis", async () => {
  const store = {
    async verifyUser() {
      throw new Error("verify should not run");
    },
  };
  const redis = {
    async incr() {
      throw new Error("redis should not run");
    },
  };
  const gate = await authenticateParse({
    req: { headers: {}, body: { base64: "abc" } },
    store,
    redis,
    limits: limits(),
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.status, 401);
});

test("wrong PIN is 401 and repeated failures become 429", async () => {
  const store = storeOf();
  const redis = makeCounterRedis();
  const req = { headers: { "x-real-ip": "1.1.1.1" }, body: { name: "홍길동", pin: "0000" } };
  const first = await authenticateParse({ req, store, redis, limits: limits() });
  const second = await authenticateParse({ req, store, redis, limits: limits() });
  const third = await authenticateParse({ req, store, redis, limits: limits() });
  assert.equal(first.status, 401);
  assert.equal(second.status, 401);
  assert.equal(third.status, 429);
  assert.ok(third.retryAfter > 0);
  assert.equal(redis.counts.has("rl:parse:user:%ED%99%8D%EA%B8%B8%EB%8F%99"), false);
});

test("valid PIN does not consume the auth-failure budget", async () => {
  const store = storeOf();
  const redis = makeCounterRedis();
  const req = { headers: { "x-real-ip": "1.1.1.1" }, body: { name: "홍길동", pin: "1234" } };
  const gate = await authenticateParse({ req, store, redis, limits: limits() });
  assert.equal(gate.ok, true);
  assert.equal(gate.name, "홍길동");
  assert.equal(redis.counts.size, 0);
});

test("quota blocks the user before another OCR call would be allowed", async () => {
  const redis = makeCounterRedis();
  const opts = { redis, limits: limits({ userMax: 1 }), name: "홍길동", ip: "1.1.1.1" };
  assert.equal((await enforceParseQuota(opts)).ok, true);
  const blocked = await enforceParseQuota(opts);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 429);
});
