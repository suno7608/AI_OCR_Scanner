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
  // Vercel Marketplace의 Upstash 연동은 KV_REST_API_URL/TOKEN 이름으로 주입한다.
  // Upstash 콘솔에서 직접 만든 경우엔 UPSTASH_REDIS_REST_URL/TOKEN을 쓰므로 둘 다 지원한다.
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error("Redis 환경변수가 없습니다 (KV_REST_API_URL/TOKEN 또는 UPSTASH_REDIS_REST_URL/TOKEN).");
  }
  _default = createStore(new Redis({ url, token }));
  return _default;
}
