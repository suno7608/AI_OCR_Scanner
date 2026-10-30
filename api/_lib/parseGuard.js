// /api/parse 게이트. Anthropic 호출 전에 이름+PIN을 재검증하고 호출량을 제한한다.
// 인증은 /api/data 와 같다. 세션의 이름+PIN을 store.verifyUser 로 확인한다.
import { clientIp, createFixedWindowLimiter } from "./ratelimit.js";

export const AUTH_ERROR = "인증이 필요합니다.";
export const RATE_ERROR = "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.";

const DEFAULT_LIMITS = {
  windowSec: 600,
  // 사진 여러 장은 한 장씩 순차 인식한다. 10분 창에 120회면 그 배치가 한도에 걸리지 않고,
  // 인증 없는 대량 호출은 막힌다.
  userMax: 120,
  ipMax: 400,
  authFailMax: 20,
};

export function readLimits(env = process.env) {
  return {
    windowSec: positiveInt(env.PARSE_RATE_LIMIT_WINDOW_SEC, DEFAULT_LIMITS.windowSec),
    userMax: positiveInt(env.PARSE_RATE_LIMIT_USER_MAX, DEFAULT_LIMITS.userMax),
    ipMax: positiveInt(env.PARSE_RATE_LIMIT_IP_MAX, DEFAULT_LIMITS.ipMax),
    authFailMax: positiveInt(env.PARSE_RATE_LIMIT_AUTH_FAIL_MAX, DEFAULT_LIMITS.authFailMax),
  };
}

function positiveInt(value, fallback) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

export function credentialsFrom(req) {
  const body = req?.body || {};
  const name = String(body.name || "").trim();
  const pin = body.pin == null ? "" : String(body.pin);
  return { name, pin };
}

export function hasParseCredentials(req) {
  const { name, pin } = credentialsFrom(req);
  return !!(name && pin !== "");
}

function denied(status, error, retryAfter = 0) {
  return { ok: false, status, error, retryAfter };
}

// 자격 증명이 없거나 틀리면 401. 틀린 PIN이 반복되면 429.
// 이름/PIN이 비어 있으면 Redis와 verifyUser를 호출하지 않는다.
export async function authenticateParse({ req, store, redis, limits }) {
  const { name, pin } = credentialsFrom(req);
  if (!name || pin === "") return denied(401, AUTH_ERROR);

  const user = await store.verifyUser(name, pin);
  if (user) return { ok: true, name, ip: clientIp(req) };

  const hit = createFixedWindowLimiter(redis);
  const ip = clientIp(req);
  const ipHit = await hit({
    key: `rl:parse:ip:${ip}`,
    max: limits.ipMax,
    windowSec: limits.windowSec,
  });
  if (!ipHit.allowed) return denied(429, RATE_ERROR, ipHit.retryAfterSec);

  const fail = await hit({
    key: `rl:parse:fail:${ip}`,
    max: limits.authFailMax,
    windowSec: limits.windowSec,
  });
  if (!fail.allowed) return denied(429, RATE_ERROR, fail.retryAfterSec);
  return denied(401, AUTH_ERROR);
}

// 인증이 끝난 뒤, Anthropic을 호출하기 직전에만 집계한다.
export async function enforceParseQuota({ redis, limits, name, ip }) {
  const hit = createFixedWindowLimiter(redis);
  const ipHit = await hit({
    key: `rl:parse:ip:${ip}`,
    max: limits.ipMax,
    windowSec: limits.windowSec,
  });
  if (!ipHit.allowed) return denied(429, RATE_ERROR, ipHit.retryAfterSec);

  const userHit = await hit({
    key: `rl:parse:user:${encodeURIComponent(name)}`,
    max: limits.userMax,
    windowSec: limits.windowSec,
  });
  if (!userHit.allowed) return denied(429, RATE_ERROR, userHit.retryAfterSec);
  return { ok: true, name, ip };
}
