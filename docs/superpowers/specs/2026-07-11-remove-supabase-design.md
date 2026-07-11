# Supabase 제거 → Upstash Redis 전환 설계

- 날짜: 2026-07-11
- 상태: 승인됨

## 배경

명함·영수증 스캐너는 Vercel(서버리스 함수) + Supabase(Postgres) 구조로 배포되어 있다.
Supabase는 `users` 테이블 하나만 사용하며, 스키마는 사실상 `name`을 키로 하는
JSON 문서 저장소다(`pin`, `cards` jsonb, `receipts` jsonb). 관계형 쿼리(조인 등)는
전혀 쓰이지 않는다.

Supabase를 유지할 이유(비용/무료 한도)가 없어져, 이 앱 규모에 더 맞는 저장소로
교체한다. 데이터 형태가 사용자별 JSON 문서이므로 SQL이 필요 없고, Redis 키-값
저장소가 자연스럽게 맞는다.

## 목표

- Supabase(Postgres) 의존성을 완전히 제거하고 Upstash Redis(Vercel Marketplace,
  무료 티어)로 대체한다.
- 프런트엔드(`src/api.js`, `src/App.jsx`)와 API 계약은 변경하지 않는다 — 서버
  내부 저장소 구현만 교체한다.
- 기존 Supabase에 저장된 사용자 데이터를 Upstash로 1회성 마이그레이션한다.
- Vercel에 재배포하여 실제 서비스에 반영한다.

## 비목표

- 인증/PIN 로직 변경 (평문 PIN 저장 방식 유지 — 기존 설계 결정 그대로)
- 프런트엔드 UI/기능 변경
- 영수증 이미지 base64 저장 방식 변경 (README에 기록된 "다음 단계"이지 이번 범위 아님)

## 아키텍처

```
프런트(React/Vite)
  └─ /api/parse   → Anthropic (변경 없음)
  └─ /api/data    → Upstash Redis (신규, 이름+PIN 재검증 후 CRUD)
  └─ /api/admin   → Upstash Redis (신규, 관리자: PIN확인/재설정/삭제)
```

### 데이터 모델 (Redis)

- `user:{name}` → JSON 문자열: `{ name, pin, cards: [], receipts: [], createdAt }`
- `users:index` → Set. 존재하는 모든 사용자 이름. `listUsers`에서 `KEYS`/`SCAN`
  대신 이 Set을 사용해 조회한다(서버리스 REST 호출 비용/지연 최소화).

### 코드 변경

- `api/_lib/supabase.js` 삭제 → `api/_lib/store.js` 신설.
  - `getStore()`: `@upstash/redis`의 `Redis.fromEnv()`로 클라이언트 생성.
  - `verifyUser(name, pin)`: 기존과 동일한 시그니처/동작 유지.
  - `getUser`, `createUser`, `updateUser`, `deleteUser`, `listUserNames` 등
    현재 `api/data.js`/`api/admin.js`가 필요로 하는 만큼만 최소 구현.
- `api/data.js`, `api/admin.js`: import 경로와 DB 호출부만 교체. 액션 분기,
  검증 로직, 응답 형식은 그대로 둔다(프런트가 이미 이 계약에 맞춰져 있음).
- `package.json`: `@supabase/supabase-js` 제거, `@upstash/redis` 추가.

### 환경변수

제거: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
추가: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
(Vercel 대시보드 → Storage/Marketplace → Upstash 연동 시 자동 주입됨)

유지: `ANTHROPIC_API_KEY`, `ADMIN_PASSWORD`, `ANTHROPIC_MODEL*`

## 마이그레이션

- `scripts/migrate-supabase-to-upstash.mjs` (1회성, 배포 코드에는 포함되지만
  Vercel 함수로는 실행되지 않는 로컬 실행용 스크립트)
  - Supabase(`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`)와 Upstash
    (`UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`) 자격증명을 모두
    로컬 `.env.migration`(gitignore 대상)에서 읽는다.
  - `users` 테이블 전체를 읽어 각 행을 `user:{name}` 키와 `users:index` Set에
    그대로 옮긴다.
  - 실행 후 건수를 출력해 육안 확인 가능하게 한다(예: "12명 마이그레이션 완료").
  - Supabase 프로젝트/키 삭제는 스크립트가 하지 않는다 — 사용자가 새 저장소로
    정상 동작 확인 후 직접 정리한다.

## 문서 갱신

- `README_DEPLOY.md`: Supabase 설정 섹션 → Upstash 연동 섹션으로 교체.
- `PROJECT_NOTES.md`: 저장소 관련 서술 갱신.
- `.env.example`: 변수 목록 갱신.
- `supabase/schema.sql`: 삭제하지 않고 `legacy/supabase-schema.sql`로 이동
  (마이그레이션 스크립트 작성/검증 시 참고 및 과거 이력 보존 목적).

## 배포 절차

1. 코드 변경을 `main`에 push.
2. Vercel 대시보드에서 프로젝트에 Upstash 통합 추가(무료 티어) → 환경변수 자동 주입.
3. 기존 `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` 환경변수 제거.
4. 재배포(자동 트리거되거나 수동 Redeploy).
5. `scripts/migrate-supabase-to-upstash.mjs` 로컬 실행으로 기존 데이터 이전.
6. 검증 체크리스트 수행(아래) 후 Supabase 프로젝트는 사용자가 직접 정리.

## 검증 체크리스트

- [ ] 기존 사용자 이름으로 로그인(PIN) 성공
- [ ] 기존에 저장돼 있던 명함/영수증이 마이그레이션 후에도 그대로 보임
- [ ] 새 사용자 생성 → PIN 설정 → 로그인
- [ ] 사진 업로드 OCR(`/api/parse`, 변경 없음) 정상 동작
- [ ] 영수증 저장/수정/삭제, 다른 사용자 데이터 미노출
- [ ] 관리자 로그인 → 목록/PIN 재설정/삭제
- [ ] Vercel 배포 후 실제 URL에서 전체 플로우 재확인

## 리스크/트레이드오프

- Upstash REST 호출은 Postgres 연결보다 오히려 서버리스 환경에 더 적합(연결
  풀링 이슈 없음)하지만, 트랜잭션/원자적 다중 키 갱신 능력은 Postgres보다 약함.
  이 앱은 사용자별 단일 키 갱신만 하므로 문제되지 않는다.
- `users:index` Set과 개별 `user:{name}` 키 사이에 정합성을 코드가 책임진다
  (Postgres는 테이블 하나가 이를 자동 보장했음). `createUser`/`deleteUser`
  경로에서 두 키를 함께 갱신하도록 구현한다.
