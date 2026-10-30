import { test } from "node:test";
import assert from "node:assert/strict";
import { clientIp, createFixedWindowLimiter } from "./ratelimit.js";

function makeCounterRedis() {
  const counts = new Map();
  const expires = new Map();
  return {
    counts,
    expires,
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

test("fixed window allows up to max then blocks", async () => {
  const redis = makeCounterRedis();
  const hit = createFixedWindowLimiter(redis);
  const first = await hit({ key: "k", max: 2, windowSec: 60 });
  const second = await hit({ key: "k", max: 2, windowSec: 60 });
  const third = await hit({ key: "k", max: 2, windowSec: 60 });
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.equal(third.retryAfterSec, 60);
  assert.equal(redis.counts.get("k"), 3);
});

test("later hits do not extend the window", async () => {
  let expires = 0;
  let n = 0;
  const redis = {
    async incr() {
      n += 1;
      return n;
    },
    async ttl() {
      return n === 1 ? -1 : 12;
    },
    async expire() {
      expires += 1;
      return 1;
    },
  };
  const hit = createFixedWindowLimiter(redis);
  const first = await hit({ key: "k", max: 10, windowSec: 600 });
  const second = await hit({ key: "k", max: 10, windowSec: 600 });
  assert.equal(expires, 1);
  assert.equal(first.retryAfterSec, 600);
  assert.equal(second.retryAfterSec, 12);
});

test("clientIp prefers the platform x-real-ip header", () => {
  const req = {
    headers: {
      "x-forwarded-for": "1.2.3.4, 5.6.7.8",
      "x-real-ip": "9.9.9.9",
    },
  };
  assert.equal(clientIp(req), "9.9.9.9");
});

test("clientIp falls back to the first forwarded address", () => {
  assert.equal(clientIp({ headers: { "x-forwarded-for": " 8.8.8.8 , 1.1.1.1" } }), "8.8.8.8");
  assert.equal(clientIp({ headers: {} }), "unknown");
  assert.equal(clientIp({ headers: { "x-real-ip": "bad ip<script>" } }), "unknown");
  assert.equal(clientIp({ headers: { "x-real-ip": "2001:db8::1" } }), "2001:db8::1");
});
