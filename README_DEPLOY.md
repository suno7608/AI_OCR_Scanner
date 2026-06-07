# 배포 가이드 — 명함 · 영수증 스캐너

단일 아티팩트(`scanner_app.jsx`)를 **Vercel + Supabase**로 독립 배포할 수 있게 재구성한 프로젝트입니다.

## 구조

```
프런트(React/Vite)
  └─ /api/parse   → Anthropic (OCR, ANTHROPIC_API_KEY 서버 보관)
  └─ /api/data    → Supabase  (이름+PIN 재검증 후 CRUD)
  └─ /api/admin   → Supabase  (관리자: PIN확인/재설정/삭제)
```

핵심: **브라우저는 DB와 Anthropic에 직접 접근하지 않습니다.** 모든 키는 서버리스 함수 환경변수로만 존재하고, 데이터 요청마다 서버가 이름+PIN을 재검증합니다.

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
│  └─ _lib/supabase.js  ← 서버 전용 Supabase 클라이언트
├─ supabase/schema.sql  ← DB 테이블 생성 SQL
└─ public/icons/        ← PWA 아이콘
```

> `scanner_app.jsx`(원본)는 참고용으로 남겨뒀습니다. 실제 배포 본체는 `src/App.jsx` 입니다.

## 1. Supabase 설정

1. https://supabase.com 에서 프로젝트 생성
2. **SQL Editor** → `supabase/schema.sql` 내용 붙여넣고 실행
3. **Settings → API** 에서 다음 값 확인
   - `Project URL` → `SUPABASE_URL`
   - `service_role` 키(secret) → `SUPABASE_SERVICE_ROLE_KEY`  ⚠️ 절대 프런트/깃에 넣지 말 것

## 2. 로컬 실행 (선택)

```bash
npm install
npm run dev    # http://localhost:5173
```

> 로컬에서 `/api/*` 까지 테스트하려면 `npm i -g vercel` 후 `vercel dev` 를 쓰는 게 가장 간단합니다. (환경변수는 `.env` 또는 `vercel env`)

## 3. Vercel 배포

1. 깃 저장소에 push (또는 `vercel` CLI로 업로드)
2. Vercel에서 New Project → 이 저장소 선택 (프레임워크 자동 감지: Vite)
3. **Settings → Environment Variables** 에 아래 등록 후 배포

| 변수 | 값 |
|---|---|
| `ANTHROPIC_API_KEY` | 본인 Anthropic API 키 |
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role 키 |
| `ADMIN_PASSWORD` | 관리자 비밀번호 (기본 admin1234 대신 새로 지정) |
| `ANTHROPIC_MODEL` | (선택) 기본 `claude-sonnet-4-20250514` |

`.env.example` 에 같은 목록이 있습니다.

## 4. 배포 후 검증 체크리스트

- [ ] 새 사용자 생성 → PIN 설정 → 다시 로그인 되는지
- [ ] 사진 업로드 시 OCR(명함/영수증 자동 판별)이 동작하는지 (`/api/parse`)
- [ ] 영수증 저장/수정/삭제, 기간 필터, 집계, CSV 내보내기
- [ ] 다른 사용자로 전환 시 서로의 데이터가 안 보이는지
- [ ] 관리자 로그인 → PIN 확인/재설정/사용자 삭제
- [ ] **iPhone Safari**에서 명함 "연락처에 추가(.vcf)" 실제 등록되는지
- [ ] 홈 화면에 추가(PWA) → 독립 실행되는지

## 보안 메모 (의도된 수준)

- PIN은 평문 저장이며 관리자는 평문 확인이 가능합니다. 암호학적 보안이 아니라 "사내 사용자끼리 서로 못 들여다보게" 막는 실용적 장벽입니다. (원본 설계 유지)
- 다만 데이터 접근은 모두 서버에서 PIN을 재검증하므로, 브라우저에서 DB를 직접 열어 남의 데이터를 보는 것은 불가능합니다.
- 사용자에게 은행 등과 다른 PIN을 쓰도록 안내하세요.

## 알려진 개선 여지 (다음 단계)

- 영수증 이미지가 현재 DB에 base64로 저장됩니다. 건수가 많아지면 **Supabase Storage**로 옮기는 것을 권장.
- PIN 무차별 대입 방지(rate limit) 미적용 — 필요 시 함수에 시도 제한 추가.
