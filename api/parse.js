// /api/parse — Anthropic 멀티모달 프록시
// 브라우저는 이미지를 base64로 보내고, 서버가 키를 붙여 Anthropic을 호출한다.
// API 키는 ANTHROPIC_API_KEY 환경변수(서버 전용)로만 존재한다.

const PROMPT = `당신은 한국어 명함/영수증을 판독하는 OCR 전문가입니다.
이미지를 분석해 명함(business card)인지 영수증(receipt)인지 먼저 판별하고 정보를 추출하세요.
이미지가 다소 흐리거나 기울어져 있어도 보이는 글자를 최대한 판독하세요.
반드시 아래 JSON 한 개로만 응답합니다. 설명·마크다운·코드펜스 없이 순수 JSON만 출력하세요.

명함이면:
{"type":"card","data":{"name":"","title":"","department":"","company":"","mobile":"","phone":"","fax":"","email":"","email2":"","website":"","zipcode":"","address":""}}

영수증이면:
{"type":"receipt","data":{"date":"YYYY-MM-DD","merchant":"","amount":"","category":"","payment":"","note":""}}

[공통 규칙]
- 모르는 값은 빈 문자열 "".
- 추측이 필요하면 가장 가능성 높은 값으로 채우되, 전혀 단서가 없으면 비워 둔다.

[명함 규칙]
- mobile: 010으로 시작하는 휴대폰 번호. phone: 그 외 유선/대표 번호.
- department: 부서/팀명(예: 해외영업그룹, 마케팅팀). title: 직책(예: 부장, 대표이사).
- email: 회사 대표 이메일. email2: 추가 이메일이 있을 때만.
- website: 회사 홈페이지 URL. zipcode: 우편번호(숫자만). address: 우편번호를 제외한 주소.

[영수증 규칙]
- date: 거래(승인) 날짜를 YYYY-MM-DD로 정규화. 2자리 연도는 20xx로. 시간은 제외.
- merchant: 상호명/가맹점명(사업자 상호).
- amount: '합계 / 결제금액 / 받을금액 / 총액 / 승인금액' 등 최종 결제 총액. 숫자만 남기고 콤마·원·₩·공백 제거. 부가세 별도 표기에 헷갈리지 말고 실제 결제한 총액을 고른다.
- category: 식대 | 교통 | 접대 | 숙박 | 사무용품 | 기타 중 가장 알맞은 것.
- payment: 법인카드 | 개인카드 | 현금 중 추정(카드사·카드번호 표기가 있으면 카드, '현금영수증/현금'이면 현금).
- note: 특이사항이 있으면 간단히, 없으면 "".`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST만 허용됩니다." });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다." });
  }

  const { base64, mediaType } = req.body || {};
  if (!base64) {
    return res.status(400).json({ error: "이미지 데이터가 없습니다." });
  }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
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
    if (!r.ok) {
      console.error("Anthropic error:", json);
      return res.status(502).json({ error: json?.error?.message || "OCR 호출 실패" });
    }

    const text = (json.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
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
