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
