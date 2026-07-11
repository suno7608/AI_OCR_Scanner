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
