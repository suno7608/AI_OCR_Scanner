// /api/vcard — 연락처(.vcf) 파일을 올바른 헤더로 내려준다.
// iOS Safari는 새 탭(window.open) 대신, 숨은 iframe으로 이 응답을 받으면
// 연락처 추가 시트를 현재 앱 화면 위에 띄우고, 완료 후 앱으로 그대로 복귀한다.
// (about:blank 빈 탭 문제 해결)

function esc(v) {
  // vCard 값 이스케이프
  return String(v || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function buildVCard(c) {
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${esc(c.name)}`,
    `FN:${esc(c.name)}`,
    (c.company || c.department) ? `ORG:${esc(c.company)}${c.department ? ";" + esc(c.department) : ""}` : "",
    c.title ? `TITLE:${esc(c.title)}` : "",
    c.mobile ? `TEL;TYPE=CELL:${esc(c.mobile)}` : "",
    c.phone ? `TEL;TYPE=WORK,VOICE:${esc(c.phone)}` : "",
    c.fax ? `TEL;TYPE=FAX:${esc(c.fax)}` : "",
    c.email ? `EMAIL;TYPE=WORK:${esc(c.email)}` : "",
    c.email2 ? `EMAIL;TYPE=HOME:${esc(c.email2)}` : "",
    c.website ? `URL:${esc(c.website)}` : "",
    (c.address || c.zipcode) ? `ADR;TYPE=WORK:;;${esc(c.address)};;;${esc(c.zipcode)};` : "",
    "END:VCARD",
  ];
  return lines.filter(Boolean).join("\r\n");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST만 허용됩니다." });
  }
  // 폼(application/x-www-form-urlencoded) 또는 JSON 모두 허용
  const c = req.body || {};
  const text = buildVCard(c);
  const filename = encodeURIComponent((c.name || "contact")) + ".vcf";

  res.setHeader("Content-Type", "text/vcard; charset=utf-8");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  res.status(200).send(text);
}
