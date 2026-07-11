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
