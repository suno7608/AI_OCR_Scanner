// /api/parse — Anthropic 멀티모달 프록시
// 브라우저는 이미지를 base64로 보내고, 서버가 키를 붙여 Anthropic을 호출한다.
// API 키는 ANTHROPIC_API_KEY 환경변수(서버 전용)로만 존재한다.
//
// hq=true 이면 고급(Opus) 모델로 인식 정확도를 높인다(느림/비용↑).
// 고급 모델 호출이 실패하면 기본 모델로 자동 폴백한다.

const STD_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
const HQ_MODEL = process.env.ANTHROPIC_MODEL_HQ || "claude-opus-4-6";

const PROMPT = `당신은 한국어 명함/영수증을 판독하는 OCR 전문가입니다.
이미지를 분석해 명함(business card)인지 영수증(receipt)인지 먼저 판별하고 정보를 추출하세요.
이미지가 다소 흐리거나 기울어져 있어도 보이는 글자를 최대한 판독하세요.
반드시 아래 JSON 한 개로만 응답합니다. 설명·마크다운·코드펜스 없이 순수 JSON만 출력하세요.

명함이면:
{"type":"card","data":{"name":"","title":"","department":"","company":"","mobile":"","phone":"","fax":"","email":"","email2":"","website":"","zipcode":"","address":""}}

영수증이면:
{"type":"receipt","data":{"date":"YYYY-MM-DD","time":"","merchant":"","bizno":"","amount":"","supply":"","vat":"","currency":"KRW","category":"","payment":"","cardLast4":"","items":"","note":""}}

[공통 규칙]
- 모르는 값은 빈 문자열 "".
- 추측이 필요하면 가장 가능성 높은 값으로 채우되, 전혀 단서가 없으면 비워 둔다.
- JSON 키를 임의로 추가/삭제하지 말고, 위 형식의 키를 모두 포함한다.

[명함 규칙]
- mobile: 010으로 시작하는 휴대폰 번호. phone: 그 외 유선/대표 번호.
- department: 부서/팀명(예: 해외영업그룹, 마케팅팀). title: 직책(예: 부장, 대표이사).
- email: 회사 대표 이메일. email2: 추가 이메일이 있을 때만.
- website: 회사 홈페이지 URL. zipcode: 우편번호(숫자만). address: 우편번호를 제외한 주소.

[영수증 규칙]
한국 신용카드 매출전표·간이영수증·현금영수증·세금계산서 포맷을 기준으로 판독한다.
- date: 거래(승인) 날짜를 YYYY-MM-DD로 정규화. 2자리 연도는 20xx로. '24.05.03', '2024년 5월 3일', '2024/5/3' 등은 모두 2024-05-03 형태로.
- time: 거래(승인) 시각을 24시간제 HH:MM 으로. 시각 표기가 없으면 "".
- merchant: 상호명/가맹점명(사업자 상호). '가맹점명', '상호', '판매자' 라벨 옆 값을 우선.
- bizno: 사업자등록번호. 'xxx-xx-xxxxx' 형식(10자리, 하이픈 포함)으로. 없으면 "".
- amount: '합계 / 결제금액 / 받을금액 / 총액 / 승인금액' 등 최종 결제 총액(공급가액+부가세 포함). 숫자만 남기고 콤마·원·₩·통화기호·공백 제거.
- supply: 공급가액(과세물품가액). 영수증에 '공급가액/과세금액'이 별도로 찍혀 있을 때만 숫자만 추출, 없으면 "".
- vat: 부가세(부가가치세/세액). '부가세/세액/VAT'가 별도로 찍혀 있을 때만 숫자만 추출, 없으면 "". 임의로 10%를 계산해 넣지 말 것(인쇄된 값만).
- currency: 통화 코드. 원화면 "KRW". 해외 영수증이면 USD/JPY/EUR 등으로, 이때 amount는 해당 통화의 표기 금액 그대로(소수점 유지).
- category: 식대 | 교통 | 접대 | 숙박 | 사무용품 | 통신 | 의료 | 경조사 | 기타 중 가장 알맞은 것.
- payment: 법인카드 | 개인카드 | 현금 중 추정(카드사·카드번호 표기가 있으면 카드, '현금영수증/현금'이면 현금).
- cardLast4: 카드 결제면 카드번호 마스킹(****-****-****-1234)의 끝 4자리 숫자만. 현금/미상이면 "".
- items: 주요 구매 품목을 한 줄로 요약. 품목이 여러 개면 콤마로 구분하고, 너무 많으면 '대표품목 외 N건' 형식. 품목 표기가 없으면 "".
- note: 특이사항(예: 할인·취소·분할결제)이 있으면 간단히, 없으면 "".`;

async function callAnthropic({ apiKey, model, base64, mediaType }) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      temperature: 0,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: base64 } },
          { type: "text", text: PROMPT },
        ],
      }],
    }),
  });
  const json = await r.json();
  return { ok: r.ok, status: r.status, json };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST만 허용됩니다." });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다." });
  }

  const { base64, mediaType, hq } = req.body || {};
  if (!base64) {
    return res.status(400).json({ error: "이미지 데이터가 없습니다." });
  }

  try {
    const primaryModel = hq ? HQ_MODEL : STD_MODEL;
    let result = await callAnthropic({ apiKey, model: primaryModel, base64, mediaType });

    // 고급 모델이 실패(미지원/권한 등)하면 기본 모델로 폴백
    if (!result.ok && hq && primaryModel !== STD_MODEL) {
      console.error("HQ model failed, falling back to standard:", primaryModel, result.json?.error?.message);
      result = await callAnthropic({ apiKey, model: STD_MODEL, base64, mediaType });
    }

    if (!result.ok) {
      console.error("Anthropic error:", result.json);
      return res.status(502).json({ error: result.json?.error?.message || "OCR 호출 실패" });
    }

    const text = (result.json.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    // 모델이 앞뒤로 설명을 붙여도 JSON 본문만 안전하게 추출
    const cleaned = text.replace(/```json|```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    const jsonStr = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      console.error("JSON parse fail. raw:", text.slice(0, 500));
      return res.status(502).json({ error: "OCR 결과를 해석하지 못했습니다. 더 선명한 사진으로 다시 시도해 주세요." });
    }
    return res.status(200).json(parsed); // { type, data }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "OCR 처리 중 오류가 발생했습니다." });
  }
}
