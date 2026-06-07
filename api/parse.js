// /api/parse — Anthropic 멀티모달 프록시
// 브라우저는 이미지를 base64로 보내고, 서버가 키를 붙여 Anthropic을 호출한다.
// API 키는 ANTHROPIC_API_KEY 환경변수(서버 전용)로만 존재한다.

const PROMPT = `이 이미지를 분석해줘. 명함(business card)인지 영수증(receipt)인지 먼저 판별하고, 내용을 추출해.
반드시 아래 JSON 형식으로만 응답해. 설명, 마크다운, 코드펜스 없이 순수 JSON만.

명함이면:
{"type":"card","data":{"name":"","title":"","department":"","company":"","mobile":"","phone":"","fax":"","email":"","email2":"","website":"","zipcode":"","address":""}}

영수증이면:
{"type":"receipt","data":{"date":"YYYY-MM-DD","merchant":"","amount":"숫자만(콤마/원 제외)","category":"식대|교통|접대|숙박|사무용품|기타 중 추정","payment":"법인카드|개인카드|현금 중 추정","note":""}}

휴대폰은 010 번호, 유선은 그 외. 금액은 최종 결제(합계) 금액. 모르는 값은 빈 문자열.
명함의 department는 부서/팀명(예: 해외영업그룹, 마케팅팀). email은 회사 대표 이메일, email2는 추가 이메일이 있을 때만. website는 회사 홈페이지 URL. zipcode는 우편번호(숫자), address는 우편번호를 제외한 나머지 주소.`;

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
        max_tokens: 1000,
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
    const clean = text.replace(/```json|```/g, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      return res.status(502).json({ error: "OCR 결과를 해석하지 못했습니다." });
    }
    return res.status(200).json(parsed); // { type, data }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "OCR 처리 중 오류가 발생했습니다." });
  }
}
