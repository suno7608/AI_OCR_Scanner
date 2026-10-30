import { test } from "node:test";
import assert from "node:assert/strict";
import { handleParse } from "./parse.js";

const LIMITS = { windowSec: 600, userMax: 2, ipMax: 10, authFailMax: 2 };

function mockRes() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

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

function storeOf() {
  return {
    async verifyUser(name, pin) {
      if (name === "홍길동" && pin === "1234") return { name, pin };
      return null;
    },
  };
}

function anthropicOk() {
  return {
    ok: true,
    status: 200,
    async json() {
      return { content: [{ type: "text", text: '{"type":"card","data":{"name":"홍길동"}}' }] };
    },
  };
}

function req(body, method = "POST") {
  return {
    method,
    headers: { "x-real-ip": "203.0.113.8" },
    body,
  };
}

async function expectNoAnthropic(run) {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("global fetch should not run");
  };
  const fetchImpl = async () => {
    calls += 1;
    throw new Error("Anthropic should not be called");
  };
  try {
    await run(fetchImpl);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
}

test("missing credentials are rejected before Anthropic", async () => {
  await expectNoAnthropic(async (fetchImpl) => {
    const res = mockRes();
    await handleParse(req({ base64: "aaa" }), res, {
      fetchImpl,
      store: { async verifyUser() { throw new Error("no verify"); } },
      redis: { async incr() { throw new Error("no redis"); } },
      limits: LIMITS,
    });
    assert.equal(res.statusCode, 401);
    assert.match(res.body.error, /인증/);
  });
});

test("invalid PIN is rejected before Anthropic", async () => {
  await expectNoAnthropic(async (fetchImpl) => {
    const res = mockRes();
    await handleParse(req({ name: "홍길동", pin: "9999", base64: "aaa" }), res, {
      fetchImpl,
      store: storeOf(),
      redis: makeCounterRedis(),
      limits: LIMITS,
    });
    assert.equal(res.statusCode, 401);
  });
});

test("non-POST is rejected before Anthropic", async () => {
  await expectNoAnthropic(async (fetchImpl) => {
    const res = mockRes();
    await handleParse(req({ name: "홍길동", pin: "1234", base64: "aaa" }, "GET"), res, {
      fetchImpl,
      limits: LIMITS,
    });
    assert.equal(res.statusCode, 405);
  });
});

test("authenticated image parse calls Anthropic once", async () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key";
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("global fetch should not run");
  };
  let calls = 0;
  try {
    const res = mockRes();
    await handleParse(req({ name: "홍길동", pin: "1234", base64: "aaa", mediaType: "image/jpeg" }), res, {
      store: storeOf(),
      redis: makeCounterRedis(),
      limits: LIMITS,
      fetchImpl: async (url, init) => {
        calls += 1;
        assert.equal(url, "https://api.anthropic.com/v1/messages");
        assert.equal(init.headers["x-api-key"], "test-key");
        return anthropicOk();
      },
    });
    assert.equal(calls, 1);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.type, "card");
    assert.equal(res.body.data.name, "홍길동");
  } finally {
    globalThis.fetch = original;
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prev;
  }
});

test("rate limit is enforced before Anthropic", async () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key";
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("global fetch should not run");
  };
  const redis = makeCounterRedis();
  const deps = {
    store: storeOf(),
    redis,
    limits: { ...LIMITS, userMax: 1 },
    fetchImpl: async () => {
      calls += 1;
      return anthropicOk();
    },
  };
  try {
    const first = mockRes();
    await handleParse(req({ name: "홍길동", pin: "1234", base64: "aaa" }), first, deps);
    assert.equal(first.statusCode, 200);
    assert.equal(calls, 1);

    const second = mockRes();
    await handleParse(req({ name: "홍길동", pin: "1234", base64: "aaa" }), second, deps);
    assert.equal(second.statusCode, 429);
    assert.match(second.body.error, /너무 많/);
    assert.ok(second.headers["Retry-After"]);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prev;
  }
});

test("missing API key after auth does not call Anthropic", async () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    await expectNoAnthropic(async (fetchImpl) => {
      const res = mockRes();
      await handleParse(req({ name: "홍길동", pin: "1234", base64: "aaa" }), res, {
        fetchImpl,
        store: storeOf(),
        redis: makeCounterRedis(),
        limits: LIMITS,
      });
      assert.equal(res.statusCode, 500);
      assert.match(res.body.error, /ANTHROPIC_API_KEY/);
    });
  } finally {
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prev;
  }
});
