import React, { useState, useEffect, useRef } from "react";
import * as api from "./api.js";

// ─────────────────────────────────────────────────────────────
// 명함 & 영수증 스캐너 — 사내 private 앱 (1차 버전)
// 사용자 구분: 이름 선택 / 저장: 사용자별 개인 공간
// 파싱: Claude 멀티모달 1회 호출 (유형판별 + OCR + 구조화)
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// 명함 & 영수증 스캐너 — 사내 private 앱
// 사용자 구분: 이름 + 4자리 PIN / 관리자 계정 별도
// 저장: 사용자별 개인 공간 (서로 접근 불가)
// 파싱: Claude 멀티모달 1회 호출 (유형판별 + OCR + 구조화)
// ─────────────────────────────────────────────────────────────

export default function App() {
  const [stage, setStage] = useState("loading"); // loading | pickUser | createUser | enterPin | admin | home
  const [users, setUsers] = useState([]); // [{name, hasPin}]
  const [currentUser, setCurrentUser] = useState(null);
  const [pendingUser, setPendingUser] = useState(null); // PIN 입력 대기 중인 사용자명
  const [adminPw, setAdminPw] = useState("");

  const refreshUsers = async () => {
    try {
      setUsers(await api.listUsers());
    } catch {
      setUsers([]);
    }
  };

  useEffect(() => {
    (async () => {
      await refreshUsers();
      setStage("pickUser");
    })();
  }, []);

  if (stage === "loading") return <Centered>불러오는 중…</Centered>;

  if (stage === "pickUser") {
    return (
      <UserPicker
        users={users}
        onPick={(name) => {
          const u = users.find((x) => x.name === name);
          if (u && !u.hasPin) {
            // 구버전 사용자(PIN 없음) → PIN 설정 유도
            setPendingUser(name);
            setStage("setPinExisting");
          } else {
            setPendingUser(name);
            setStage("enterPin");
          }
        }}
        onCreate={() => setStage("createUser")}
        onAdmin={() => setStage("adminLogin")}
      />
    );
  }

  if (stage === "createUser") {
    return (
      <CreateUser
        existingNames={users.map((u) => u.name)}
        onCancel={() => setStage("pickUser")}
        onCreate={async (name, pin) => {
          await api.createUser(name, pin);
          api.setSession(name, pin);
          await refreshUsers();
          setCurrentUser(name);
          setStage("home");
        }}
      />
    );
  }

  if (stage === "setPinExisting") {
    // 기존(PIN 미설정) 사용자가 처음 PIN을 거는 경우
    return (
      <SetPin
        name={pendingUser}
        onCancel={() => { setPendingUser(null); setStage("pickUser"); }}
        onSet={async (pin) => {
          await api.setUserPin(pendingUser, pin);
          api.setSession(pendingUser, pin);
          setCurrentUser(pendingUser);
          setPendingUser(null);
          await refreshUsers();
          setStage("home");
        }}
      />
    );
  }

  if (stage === "enterPin") {
    return (
      <EnterPin
        name={pendingUser}
        onCancel={() => { setPendingUser(null); setStage("pickUser"); }}
        onSuccess={(pin) => {
          api.setSession(pendingUser, pin);
          setCurrentUser(pendingUser);
          setPendingUser(null);
          setStage("home");
        }}
      />
    );
  }

  if (stage === "adminLogin") {
    return (
      <AdminLogin
        onCancel={() => setStage("pickUser")}
        onSuccess={(pw) => { setAdminPw(pw); setStage("admin"); }}
      />
    );
  }

  if (stage === "admin") {
    return (
      <AdminPanel
        adminPw={adminPw}
        onBack={() => { setAdminPw(""); setStage("pickUser"); }}
        onDeleteUser={async (name) => {
          await api.adminDeleteUser(adminPw, name);
        }}
        onResetPin={async (name, newPin) => {
          await api.adminResetPin(adminPw, name, newPin);
        }}
      />
    );
  }

  return (
    <Home
      user={currentUser}
      onSwitchUser={() => {
        api.clearSession();
        setCurrentUser(null);
        setStage("pickUser");
      }}
    />
  );
}

// ───────────────────────── 디자인 토큰 ─────────────────────────
const C = {
  ink: "#1a1410",
  paper: "#f4efe6",
  card: "#fbf8f1",
  accent: "#b8472f", // 테라코타
  accent2: "#2f5d50", // 딥그린
  line: "#ddd3c2",
  muted: "#8a8073",
};

const fontDisplay = `"Marcellus", "Nanum Myeongjo", serif`;
const fontBody = `"Nanum Gothic", -apple-system, sans-serif`;

function FontInjector() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Marcellus&family=Nanum+Gothic:wght@400;700;800&family=Nanum+Myeongjo:wght@400;700;800&display=swap');
      * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
      body { margin:0; }
      @keyframes fadeUp { from { opacity:0; transform: translateY(8px);} to {opacity:1; transform:none;} }
      .fadeUp { animation: fadeUp .4s ease both; }
      input, button, textarea, select { font-family: inherit; }
    `}</style>
  );
}

function Centered({ children }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.paper, fontFamily: fontBody, color: C.ink }}>
      <FontInjector />
      {children}
    </div>
  );
}

// ───────────────────────── 사용자 선택 ─────────────────────────
function UserPicker({ users, onPick, onCreate, onAdmin }) {
  return (
    <div style={{ minHeight: "100vh", background: C.paper, fontFamily: fontBody, color: C.ink, padding: "0 20px" }}>
      <FontInjector />
      <div style={{ maxWidth: 460, margin: "0 auto", paddingTop: 64 }} className="fadeUp">
        <div style={{ fontFamily: fontDisplay, fontSize: 13, letterSpacing: 4, color: C.accent, textTransform: "uppercase" }}>Private · 사내 전용</div>
        <h1 style={{ fontFamily: fontDisplay, fontSize: 40, margin: "8px 0 4px", lineHeight: 1.1 }}>명함 · 영수증<br />스캐너</h1>
        <p style={{ color: C.muted, fontSize: 14, marginBottom: 36 }}>본인 계정을 선택하고 PIN으로 잠금 해제하세요.</p>

        {users.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 10, letterSpacing: 1 }}>사용자 선택</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {users.map((u) => (
                <button key={u.name} onClick={() => onPick(u.name)}
                  style={{ background: C.card, border: `1.5px solid ${C.line}`, borderRadius: 999, padding: "11px 20px", fontSize: 15, fontWeight: 700, color: C.ink, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                  {!u.hasPin && <span style={{ fontSize: 11 }}>🔓</span>}
                  {u.hasPin && <span style={{ fontSize: 11 }}>🔒</span>}
                  {u.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <button onClick={onCreate}
          style={{ width: "100%", background: C.accent, color: "#fff", border: "none", borderRadius: 14, padding: "16px 0", fontWeight: 800, fontSize: 16, cursor: "pointer", marginBottom: 12 }}>
          ＋  새 사용자 만들기
        </button>

        <button onClick={onAdmin}
          style={{ width: "100%", background: "none", border: `1.5px solid ${C.line}`, borderRadius: 14, padding: "13px 0", fontWeight: 700, fontSize: 14, color: C.muted, cursor: "pointer" }}>
          관리자
        </button>
      </div>
    </div>
  );
}

// ───────────────────────── PIN 입력 패드 ─────────────────────────
function PinPad({ value, onChange, max = 4 }) {
  const press = (d) => { if (value.length < max) onChange(value + d); };
  const del = () => onChange(value.slice(0, -1));
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "center", gap: 14, margin: "8px 0 28px" }}>
        {Array.from({ length: max }).map((_, i) => (
          <div key={i} style={{ width: 16, height: 16, borderRadius: "50%", background: i < value.length ? C.accent : "transparent", border: `2px solid ${i < value.length ? C.accent : C.line}` }} />
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, maxWidth: 280, margin: "0 auto" }}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <button key={n} onClick={() => press(String(n))}
            style={{ aspectRatio: "1.6", background: C.card, border: `1.5px solid ${C.line}`, borderRadius: 14, fontSize: 24, fontWeight: 700, color: C.ink, cursor: "pointer" }}>{n}</button>
        ))}
        <div />
        <button onClick={() => press("0")} style={{ aspectRatio: "1.6", background: C.card, border: `1.5px solid ${C.line}`, borderRadius: 14, fontSize: 24, fontWeight: 700, color: C.ink, cursor: "pointer" }}>0</button>
        <button onClick={del} style={{ aspectRatio: "1.6", background: "none", border: "none", fontSize: 20, color: C.muted, cursor: "pointer" }}>⌫</button>
      </div>
    </div>
  );
}

function AuthShell({ title, subtitle, children, onCancel }) {
  return (
    <div style={{ minHeight: "100vh", background: C.paper, fontFamily: fontBody, color: C.ink, padding: "0 20px" }}>
      <FontInjector />
      <div style={{ maxWidth: 380, margin: "0 auto", paddingTop: 72 }} className="fadeUp">
        <button onClick={onCancel} style={{ background: "none", border: "none", fontSize: 15, color: C.muted, cursor: "pointer", padding: 0, marginBottom: 20 }}>‹ 뒤로</button>
        <h1 style={{ fontFamily: fontDisplay, fontSize: 30, margin: "0 0 4px" }}>{title}</h1>
        {subtitle && <p style={{ color: C.muted, fontSize: 14, marginBottom: 28 }}>{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

// ── 새 사용자 만들기 (이름 + PIN 설정) ──
function CreateUser({ existingNames, onCreate, onCancel }) {
  const [step, setStep] = useState("name"); // name | pin | confirm
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");

  if (step === "name") {
    return (
      <AuthShell title="새 사용자" subtitle="이름을 입력하세요." onCancel={onCancel}>
        <input autoFocus value={name} onChange={(e) => { setName(e.target.value); setErr(""); }} placeholder="예: 김전무"
          onKeyDown={(e) => { if (e.key === "Enter") next(); }}
          style={{ width: "100%", padding: "14px 16px", borderRadius: 12, border: `1.5px solid ${C.line}`, fontSize: 16, background: C.card, color: C.ink, outline: "none", marginBottom: 12 }} />
        {err && <p style={{ color: C.accent, fontSize: 13, margin: "0 0 12px" }}>{err}</p>}
        <button onClick={next} style={{ width: "100%", background: C.accent, color: "#fff", border: "none", borderRadius: 12, padding: "15px 0", fontWeight: 800, fontSize: 16, cursor: "pointer" }}>다음</button>
      </AuthShell>
    );
    function next() {
      const t = name.trim();
      if (!t) return setErr("이름을 입력하세요.");
      if (existingNames.includes(t)) return setErr("이미 있는 이름입니다.");
      setStep("pin");
    }
  }

  if (step === "pin") {
    return (
      <AuthShell title="PIN 설정" subtitle={`${name} 님이 사용할 4자리 PIN을 만드세요.`} onCancel={() => setStep("name")}>
        <PinPad value={pin} onChange={(v) => { setPin(v); if (v.length === 4) { setStep("confirm"); } }} />
        <p style={{ textAlign: "center", color: C.muted, fontSize: 12, marginTop: 24 }}>다른 곳에서 쓰는 비밀번호와 다르게 설정하세요.</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="PIN 확인" subtitle="같은 PIN을 한 번 더 입력하세요." onCancel={() => { setPin(""); setConfirm(""); setStep("pin"); }}>
      <PinPad value={confirm} onChange={(v) => {
        setConfirm(v);
        if (v.length === 4) {
          if (v === pin) onCreate(name.trim(), pin);
          else { setErr("PIN이 일치하지 않습니다."); setConfirm(""); }
        }
      }} />
      {err && <p style={{ textAlign: "center", color: C.accent, fontSize: 13, marginTop: 20 }}>{err}</p>}
    </AuthShell>
  );
}

// ── 기존(PIN 미설정) 사용자의 PIN 최초 설정 ──
function SetPin({ name, onSet, onCancel }) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [step, setStep] = useState("pin");
  const [err, setErr] = useState("");
  if (step === "pin") {
    return (
      <AuthShell title="PIN 설정 필요" subtitle={`${name} 계정을 보호할 4자리 PIN을 만드세요.`} onCancel={onCancel}>
        <PinPad value={pin} onChange={(v) => { setPin(v); if (v.length === 4) setStep("confirm"); }} />
      </AuthShell>
    );
  }
  return (
    <AuthShell title="PIN 확인" subtitle="같은 PIN을 한 번 더 입력하세요." onCancel={() => { setPin(""); setConfirm(""); setStep("pin"); }}>
      <PinPad value={confirm} onChange={(v) => {
        setConfirm(v);
        if (v.length === 4) {
          if (v === pin) onSet(pin);
          else { setErr("PIN이 일치하지 않습니다."); setConfirm(""); }
        }
      }} />
      {err && <p style={{ textAlign: "center", color: C.accent, fontSize: 13, marginTop: 20 }}>{err}</p>}
    </AuthShell>
  );
}

// ── PIN 입력 (잠금 해제) ──
function EnterPin({ name, onSuccess, onCancel }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [checking, setChecking] = useState(false);
  return (
    <AuthShell title={name} subtitle="PIN을 입력하세요." onCancel={onCancel}>
      <PinPad value={pin} onChange={async (v) => {
        if (checking) return;
        setPin(v);
        if (v.length === 4) {
          setChecking(true);
          try {
            await api.authUser(name, v);
            onSuccess(v);
          } catch {
            setErr("PIN이 틀렸습니다. 잊으셨다면 관리자에게 문의하세요.");
            setPin("");
          } finally {
            setChecking(false);
          }
        }
      }} />
      {checking && <p style={{ textAlign: "center", color: C.muted, fontSize: 13, marginTop: 20 }}>확인 중…</p>}
      {err && <p style={{ textAlign: "center", color: C.accent, fontSize: 13, marginTop: 20 }}>{err}</p>}
    </AuthShell>
  );
}

// ── 관리자 로그인 ──
function AdminLogin({ onSuccess, onCancel }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.adminVerify(pw);
      onSuccess(pw);
    } catch {
      setErr("비밀번호가 틀렸습니다.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title="관리자" subtitle="관리자 비밀번호를 입력하세요." onCancel={onCancel}>
      <input autoFocus type="password" value={pw} onChange={(e) => { setPw(e.target.value); setErr(""); }}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        style={{ width: "100%", padding: "14px 16px", borderRadius: 12, border: `1.5px solid ${C.line}`, fontSize: 16, background: C.card, color: C.ink, outline: "none", marginBottom: 12 }} />
      {err && <p style={{ color: C.accent, fontSize: 13, margin: "0 0 12px" }}>{err}</p>}
      <button onClick={submit} style={{ width: "100%", background: C.accent, color: "#fff", border: "none", borderRadius: 12, padding: "15px 0", fontWeight: 800, fontSize: 16, cursor: "pointer" }}>로그인</button>
    </AuthShell>
  );
}

// ── 관리자 패널 (PIN 확인 / 사용자 삭제 / PIN 재설정) ──
function AdminPanel({ adminPw, onBack, onDeleteUser, onResetPin }) {
  const [users, setUsers] = useState([]); // [{name, pin}]
  const [revealed, setRevealed] = useState({}); // name -> bool
  const [resetting, setResetting] = useState(null); // name
  const [confirmDel, setConfirmDel] = useState(null); // name pending delete confirmation

  const reload = async () => {
    try { setUsers(await api.adminListUsers(adminPw)); } catch { setUsers([]); }
  };
  useEffect(() => { reload(); }, []);

  if (resetting) {
    return (
      <AuthShell title="PIN 재설정" subtitle={`${resetting} 님의 새 PIN을 설정합니다.`} onCancel={() => setResetting(null)}>
        <AdminPinReset name={resetting} onDone={async (pin) => { await onResetPin(resetting, pin); await reload(); setResetting(null); }} />
      </AuthShell>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: C.paper, fontFamily: fontBody, color: C.ink, padding: "0 20px" }}>
      <FontInjector />
      <div style={{ maxWidth: 460, margin: "0 auto", paddingTop: 56 }} className="fadeUp">
        <button onClick={onBack} style={{ background: "none", border: "none", fontSize: 15, color: C.muted, cursor: "pointer", padding: 0, marginBottom: 16 }}>‹ 나가기</button>
        <h1 style={{ fontFamily: fontDisplay, fontSize: 30, margin: "0 0 4px" }}>관리자</h1>
        <p style={{ color: C.muted, fontSize: 14, marginBottom: 28 }}>사용자 PIN 확인 및 관리. 데이터 내용은 보이지 않습니다.</p>

        {users.length === 0 && <div style={{ color: C.muted, fontSize: 14 }}>등록된 사용자가 없습니다.</div>}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {users.map((u) => (
            <div key={u.name} style={{ background: C.card, border: `1.5px solid ${C.line}`, borderRadius: 14, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 800, fontSize: 16 }}>{u.name}</div>
                <div style={{ fontSize: 14, color: C.muted }}>
                  PIN: <b style={{ color: C.ink, letterSpacing: 2 }}>{revealed[u.name] ? (u.pin || "(미설정)") : "••••"}</b>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button onClick={() => setRevealed((r) => ({ ...r, [u.name]: !r[u.name] }))}
                  style={{ flex: 1, background: "none", border: `1.5px solid ${C.line}`, borderRadius: 8, padding: "9px 0", fontSize: 13, fontWeight: 700, color: C.accent2, cursor: "pointer" }}>
                  {revealed[u.name] ? "가리기" : "PIN 보기"}
                </button>
                <button onClick={() => setResetting(u.name)}
                  style={{ flex: 1, background: "none", border: `1.5px solid ${C.line}`, borderRadius: 8, padding: "9px 0", fontSize: 13, fontWeight: 700, color: C.ink, cursor: "pointer" }}>
                  PIN 재설정
                </button>
                {confirmDel === u.name ? (
                  <button onClick={async () => { await onDeleteUser(u.name); await reload(); setConfirmDel(null); }}
                    style={{ flex: 1, background: C.accent, border: `1.5px solid ${C.accent}`, borderRadius: 8, padding: "9px 0", fontSize: 13, fontWeight: 800, color: "#fff", cursor: "pointer" }}>
                    정말 삭제?
                  </button>
                ) : (
                  <button onClick={() => setConfirmDel(u.name)}
                    style={{ flex: 1, background: "none", border: `1.5px solid ${C.accent}`, borderRadius: 8, padding: "9px 0", fontSize: 13, fontWeight: 700, color: C.accent, cursor: "pointer" }}>
                    삭제
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AdminPinReset({ name, onDone }) {
  const [pin, setPin] = useState("");
  return (
    <div>
      <PinPad value={pin} onChange={(v) => { setPin(v); if (v.length === 4) onDone(v); }} />
      <p style={{ textAlign: "center", color: C.muted, fontSize: 12, marginTop: 24 }}>새 PIN 4자리를 입력하면 바로 적용됩니다.</p>
    </div>
  );
}

// ───────────────────────── 홈 ─────────────────────────
function Home({ user, onSwitchUser }) {
  const [tab, setTab] = useState("scan"); // scan | cards | receipts
  const [cards, setCards] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      setLoaded(false);
      try { setCards(await api.getCards()); } catch { setCards([]); }
      try { setReceipts(await api.getReceipts()); } catch { setReceipts([]); }
      setLoaded(true);
    })();
  }, [user]);

  const persistCards = async (list) => {
    setCards(list);
    try { await api.saveCards(list); } catch (e) { console.error(e); }
  };
  const persistReceipts = async (list) => {
    setReceipts(list);
    try { await api.saveReceipts(list); } catch (e) { console.error(e); }
  };

  // 중복 검사: 같은 가맹점 + 금액 + 거래날짜면 중복으로 간주
  const findDuplicateReceipt = (data) => {
    const norm = (s) => String(s || "").trim().toLowerCase();
    return receipts.find((r) =>
      norm(r.merchant) === norm(data.merchant) &&
      parseNum(r.amount) === parseNum(data.amount) &&
      norm(r.date) === norm(data.date) &&
      norm(r.merchant) !== ""
    );
  };

  return (
    <div style={{ minHeight: "100vh", background: C.paper, fontFamily: fontBody, color: C.ink, paddingBottom: 90 }}>
      <FontInjector />
      {/* 헤더 */}
      <div style={{ padding: "20px 20px 12px", maxWidth: 560, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 11, color: C.muted, letterSpacing: 2 }}>사용자</div>
          <div style={{ fontFamily: fontDisplay, fontSize: 22 }}>{user}</div>
        </div>
        <button onClick={onSwitchUser} style={{ background: "none", border: `1.5px solid ${C.line}`, borderRadius: 999, padding: "8px 14px", fontSize: 13, color: C.muted, cursor: "pointer" }}>전환</button>
      </div>

      <div style={{ maxWidth: 560, margin: "0 auto", padding: "0 20px" }}>
        {tab === "scan" && <ScanView user={user} cards={cards} receipts={receipts} findDuplicateReceipt={findDuplicateReceipt} onSavedCard={(c) => persistCards([c, ...cards])} onSavedReceipt={(r) => persistReceipts([r, ...receipts])} />}
        {tab === "cards" && <CardsView cards={cards} onDelete={(i) => persistCards(cards.filter((_, idx) => idx !== i))} />}
        {tab === "receipts" && <ReceiptsView receipts={receipts} user={user}
          onDelete={(i) => persistReceipts(receipts.filter((_, idx) => idx !== i))}
          onUpdate={(i, data) => persistReceipts(receipts.map((r, idx) => idx === i ? { ...r, ...data } : r))} />}
      </div>

      {/* 하단 탭바 */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: C.card, borderTop: `1.5px solid ${C.line}`, display: "flex", justifyContent: "center" }}>
        <div style={{ display: "flex", width: "100%", maxWidth: 560 }}>
          {[["scan", "스캔", "◎"], ["cards", `명함 ${cards.length || ""}`, "▭"], ["receipts", `영수증 ${receipts.length || ""}`, "▤"]].map(([k, label, icon]) => (
            <button key={k} onClick={() => setTab(k)}
              style={{ flex: 1, background: "none", border: "none", padding: "14px 0 18px", cursor: "pointer", color: tab === k ? C.accent : C.muted, fontWeight: tab === k ? 800 : 400, fontSize: 13 }}>
              <div style={{ fontSize: 19, marginBottom: 3 }}>{icon}</div>{label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── 스캔 뷰 ─────────────────────────
function ScanView({ user, onSavedCard, onSavedReceipt, findDuplicateReceipt }) {
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(null); // {done, total} 인식 진행 중
  const [queue, setQueue] = useState([]); // 인식 완료된 항목들 [{type, data, image, failed}]
  const [qIndex, setQIndex] = useState(0); // 현재 확인 중인 큐 인덱스
  const [dupWarn, setDupWarn] = useState(null); // {data, image}
  const fileRef = useRef();

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setError(""); setQueue([]); setQIndex(0); setDupWarn(null);
    setProgress({ done: 0, total: files.length });

    const results = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const dataUrl = await toDataURL(file);
        const base64 = dataUrl.split(",")[1];
        const mediaType = file.type || "image/jpeg";
        const result = await api.parseImage(base64, mediaType);
        results.push({ ...result, image: dataUrl });
      } catch (e) {
        console.error(e);
        results.push({ failed: true, image: null });
      }
      setProgress({ done: i + 1, total: files.length });
    }

    setProgress(null);
    const ok = results.filter((r) => !r.failed);
    const failCount = results.length - ok.length;
    if (failCount > 0) setError(`${failCount}장은 인식에 실패해 건너뜁니다. 사진이 선명한지 확인해주세요.`);
    if (ok.length === 0) return;
    setQueue(ok);
    setQIndex(0);
  };

  const advance = () => {
    setDupWarn(null);
    if (qIndex + 1 < queue.length) {
      setQIndex(qIndex + 1);
    } else {
      // 큐 종료
      setQueue([]); setQIndex(0);
    }
  };

  const commitReceipt = (finalData, image) => {
    onSavedReceipt({ ...finalData, image, savedAt: Date.now() });
    advance();
  };

  // ── 중복 경고 화면 (영수증) ──
  if (dupWarn) {
    const ex = dupWarn.existing;
    return (
      <div className="fadeUp">
        <QueueBadge index={qIndex} total={queue.length} />
        <div style={{ background: "#fff4e8", border: `1.5px solid ${C.accent}`, borderRadius: 14, padding: 20, marginTop: 8 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.accent, marginBottom: 8 }}>⚠ 이미 등록된 영수증일 수 있어요</div>
          <p style={{ fontSize: 14, color: C.ink, lineHeight: 1.6, margin: "0 0 12px" }}>같은 가맹점·금액·날짜의 영수증이 이미 있습니다.</p>
          <div style={{ background: C.card, borderRadius: 10, padding: 12, fontSize: 13, color: C.muted }}>
            <b style={{ color: C.ink }}>{ex.merchant}</b> · {(parseNum(ex.amount)).toLocaleString()}원<br />
            {ex.date} · 입력일 {fmtDate(ex.savedAt)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button onClick={advance} style={{ flex: 1, background: "none", border: `1.5px solid ${C.line}`, borderRadius: 12, padding: "14px 0", fontWeight: 700, color: C.muted, cursor: "pointer" }}>건너뛰기</button>
          <button onClick={() => commitReceipt(dupWarn.data, dupWarn.image)} style={{ flex: 2, background: C.accent, color: "#fff", border: "none", borderRadius: 12, padding: "14px 0", fontWeight: 800, fontSize: 16, cursor: "pointer" }}>그래도 저장</button>
        </div>
      </div>
    );
  }

  // ── 확인 화면 (큐에 항목이 있을 때) ──
  if (queue.length > 0) {
    const cur = queue[qIndex];
    return (
      <div className="fadeUp">
        <QueueBadge index={qIndex} total={queue.length} />
        <ReviewCard
          key={qIndex}
          parsed={cur}
          multiLabel={queue.length > 1}
          onCancel={advance}
          onConfirm={(finalData) => {
            if (cur.type === "card") {
              onSavedCard({ ...finalData, savedAt: Date.now() });
              advance();
            } else {
              const dup = findDuplicateReceipt?.(finalData);
              if (dup) setDupWarn({ data: finalData, image: cur.image, existing: dup });
              else commitReceipt(finalData, cur.image);
            }
          }}
        />
      </div>
    );
  }

  // ── 인식 진행 중 ──
  if (progress) {
    const pct = Math.round((progress.done / progress.total) * 100);
    return (
      <div className="fadeUp" style={{ paddingTop: 40, textAlign: "center" }}>
        <h2 style={{ fontFamily: fontDisplay, fontSize: 24, margin: "0 0 20px" }}>인식하는 중…</h2>
        <div style={{ fontSize: 40, fontWeight: 800, color: C.accent }}>{progress.done} / {progress.total}</div>
        <div style={{ height: 8, background: C.line, borderRadius: 4, overflow: "hidden", maxWidth: 280, margin: "20px auto 0" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: C.accent, transition: "width .3s" }} />
        </div>
        <p style={{ color: C.muted, fontSize: 13, marginTop: 16 }}>Claude가 사진을 한 장씩 읽고 있어요.<br />잠시만 기다려주세요.</p>
      </div>
    );
  }

  // ── 시작 화면 ──
  return (
    <div className="fadeUp">
      <h2 style={{ fontFamily: fontDisplay, fontSize: 26, margin: "8px 0 6px" }}>스캔하기</h2>
      <p style={{ color: C.muted, fontSize: 14, marginTop: 0, marginBottom: 24 }}>명함이든 영수증이든, 사진을 올리면 자동으로 구분해서 정리합니다. 명함은 여러 장을 한 번에 올릴 수 있어요.</p>

      <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => handleFiles(e.target.files)} />

      <button onClick={() => fileRef.current?.click()}
        style={{ width: "100%", background: C.accent, color: "#fff", border: "none", borderRadius: 18, padding: "26px 0", fontSize: 18, fontWeight: 800, cursor: "pointer", boxShadow: "0 8px 24px rgba(184,71,47,.25)" }}>
        ＋  사진 촬영 / 업로드
      </button>
      <p style={{ textAlign: "center", color: C.muted, fontSize: 12, marginTop: 10 }}>명함 여러 장을 한꺼번에 선택해도 됩니다.</p>

      {error && <p style={{ color: C.accent, fontSize: 14, marginTop: 16 }}>{error}</p>}

      <div style={{ marginTop: 32, padding: 18, background: C.card, border: `1.5px solid ${C.line}`, borderRadius: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>이렇게 동작해요</div>
        <ol style={{ margin: 0, paddingLeft: 18, color: C.muted, fontSize: 13, lineHeight: 1.7 }}>
          <li>사진을 올리면 명함/영수증을 자동 판별</li>
          <li>여러 장이면 한 장씩 확인 화면으로 넘어갑니다</li>
          <li>명함 → 연락처(.vcf) / 영수증 → 내역 저장</li>
        </ol>
      </div>
    </div>
  );
}

// 큐 진행 표시 배지
function QueueBadge({ index, total }) {
  if (total <= 1) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0 8px" }}>
      <span style={{ background: C.accent2, color: "#fff", fontSize: 12, fontWeight: 800, padding: "5px 12px", borderRadius: 999 }}>
        {index + 1} / {total}
      </span>
      <span style={{ fontSize: 12, color: C.muted }}>확인 후 저장하면 다음 장으로 넘어갑니다</span>
    </div>
  );
}

// ───────────────────────── 확인/수정 카드 ─────────────────────────
function ReviewCard({ parsed, onConfirm, onCancel, multiLabel }) {
  const isCard = parsed.type === "card";
  const [data, setData] = useState(parsed.data || {});
  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));

  const cardFields = [
    ["name", "이름"], ["title", "직책"], ["department", "부서/팀"], ["company", "회사"],
    ["mobile", "휴대폰"], ["phone", "유선전화"], ["fax", "팩스"],
    ["email", "회사 이메일"], ["email2", "이메일 2"], ["website", "회사 URL"],
    ["zipcode", "우편번호"], ["address", "주소"],
  ];
  const receiptFields = [
    ["date", "날짜"], ["merchant", "가맹점"], ["amount", "금액"],
    ["category", "카테고리"], ["payment", "결제수단"], ["note", "비고"],
  ];
  const fields = isCard ? cardFields : receiptFields;

  return (
    <div className="fadeUp">
      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0 4px" }}>
        <span style={{ background: isCard ? C.accent2 : C.accent, color: "#fff", fontSize: 12, fontWeight: 800, padding: "4px 10px", borderRadius: 999 }}>
          {isCard ? "명함" : "영수증"}
        </span>
        <h2 style={{ fontFamily: fontDisplay, fontSize: 24, margin: 0 }}>내용 확인</h2>
      </div>
      <p style={{ color: C.muted, fontSize: 13, marginTop: 0 }}>틀린 부분이 있으면 수정하세요.</p>

      {parsed.image && !isCard && (
        <img src={parsed.image} alt="receipt" style={{ width: "100%", borderRadius: 12, marginBottom: 16, border: `1.5px solid ${C.line}` }} />
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {fields.map(([k, label]) => (
          <div key={k}>
            <label style={{ fontSize: 12, color: C.muted, display: "block", marginBottom: 4 }}>{label}</label>
            <input value={data[k] || ""} onChange={(e) => set(k, e.target.value)}
              style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1.5px solid ${C.line}`, fontSize: 15, background: C.card, color: C.ink, outline: "none" }} />
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
        <button onClick={onCancel} style={{ flex: 1, background: "none", border: `1.5px solid ${C.line}`, borderRadius: 12, padding: "14px 0", fontWeight: 700, color: C.muted, cursor: "pointer" }}>{multiLabel ? "건너뛰기" : "취소"}</button>
        <button onClick={() => onConfirm(data)} style={{ flex: 2, background: C.accent, color: "#fff", border: "none", borderRadius: 12, padding: "14px 0", fontWeight: 800, fontSize: 16, cursor: "pointer" }}>
          {isCard ? "저장" : "내역에 저장"}
        </button>
      </div>
    </div>
  );
}

// ───────────────────────── 명함 목록 ─────────────────────────
function CardsView({ cards, onDelete }) {
  if (!cards.length) return <Empty text="저장된 명함이 없어요." />;
  return (
    <div className="fadeUp">
      <h2 style={{ fontFamily: fontDisplay, fontSize: 26, margin: "8px 0 16px" }}>명함 {cards.length}</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {cards.map((c, i) => (
          <div key={i} style={{ background: C.card, border: `1.5px solid ${C.line}`, borderRadius: 14, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>{c.name || "(이름 없음)"}</div>
                <div style={{ color: C.muted, fontSize: 13 }}>{[c.title, c.department, c.company].filter(Boolean).join(" · ")}</div>
              </div>
              <button onClick={() => onDelete(i)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 18 }}>×</button>
            </div>
            <div style={{ marginTop: 10, fontSize: 13, color: C.ink, lineHeight: 1.6 }}>
              {c.mobile && <div>📱 {c.mobile}</div>}
              {c.phone && <div>☎ {c.phone}</div>}
              {c.email && <div>✉ {c.email}</div>}
              {c.email2 && <div>✉ {c.email2}</div>}
              {c.website && <div>🔗 {c.website}</div>}
              {(c.address || c.zipcode) && <div>📍 {[c.zipcode, c.address].filter(Boolean).join(" ")}</div>}
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: C.muted }}>입력일 {fmtDate(c.savedAt)}</div>
            <button onClick={() => downloadVCard(c)}
              style={{ marginTop: 12, width: "100%", background: C.accent2, color: "#fff", border: "none", borderRadius: 10, padding: "11px 0", fontWeight: 800, fontSize: 14, cursor: "pointer" }}>
              연락처에 추가 (.vcf)
            </button>
            <div style={{ marginTop: 6, fontSize: 11, color: C.muted, textAlign: "center", lineHeight: 1.5 }}>
              카드가 뜨면 <b>"새로운 연락처 생성"</b> 탭<br />
              화면만 뜨고 멈추면 우측 상단 <b>공유 → 연락처에 추가</b>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────── 영수증 목록 ─────────────────────────
function ReceiptsView({ receipts, user, onDelete, onUpdate }) {
  const [period, setPeriod] = useState("all"); // all | thisMonth | lastMonth
  const [detailIdx, setDetailIdx] = useState(null);

  if (!receipts.length) return <Empty text="저장된 영수증이 없어요." />;

  // 기간 필터 (영수증 거래 날짜 r.date 기준, 없으면 입력일)
  const now = new Date();
  const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const thisMonth = ym(now);
  const lastMonth = ym(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const monthOf = (r) => {
    const raw = r.date || (r.savedAt ? new Date(r.savedAt).toISOString().slice(0, 10) : "");
    return raw ? raw.slice(0, 7) : "";
  };

  // 원본 인덱스를 유지한 채 필터링 (수정/삭제가 올바른 항목을 가리키도록)
  const indexed = receipts.map((r, i) => ({ r, i }));
  const filtered = indexed.filter(({ r }) => {
    if (period === "thisMonth") return monthOf(r) === thisMonth;
    if (period === "lastMonth") return monthOf(r) === lastMonth;
    return true;
  });

  const total = filtered.reduce((s, { r }) => s + parseNum(r.amount), 0);

  // 카테고리별 집계
  const byCat = {};
  filtered.forEach(({ r }) => {
    const cat = r.category || "미분류";
    byCat[cat] = (byCat[cat] || 0) + parseNum(r.amount);
  });
  const catRows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

  if (detailIdx !== null) {
    return (
      <ReceiptDetail
        receipt={receipts[detailIdx]}
        onClose={() => setDetailIdx(null)}
        onSave={(data) => { onUpdate(detailIdx, data); setDetailIdx(null); }}
        onDelete={() => { onDelete(detailIdx); setDetailIdx(null); }}
      />
    );
  }

  const periodLabel = { all: "전체", thisMonth: "이번 달", lastMonth: "지난 달" };

  return (
    <div className="fadeUp">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h2 style={{ fontFamily: fontDisplay, fontSize: 26, margin: "8px 0 12px" }}>영수증</h2>
        <button onClick={() => downloadCSV(filtered.map(({ r }) => r), user)} style={{ background: "none", border: `1.5px solid ${C.line}`, borderRadius: 999, padding: "8px 14px", fontSize: 13, color: C.accent2, fontWeight: 700, cursor: "pointer" }}>CSV 내보내기</button>
      </div>

      {/* 기간 필터 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {["all", "thisMonth", "lastMonth"].map((p) => (
          <button key={p} onClick={() => setPeriod(p)}
            style={{ flex: 1, background: period === p ? C.accent2 : C.card, color: period === p ? "#fff" : C.muted, border: `1.5px solid ${period === p ? C.accent2 : C.line}`, borderRadius: 10, padding: "9px 0", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            {periodLabel[p]}
          </button>
        ))}
      </div>

      {/* 집계 요약 */}
      <div style={{ background: C.card, border: `1.5px solid ${C.line}`, borderRadius: 14, padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
          <span style={{ fontSize: 13, color: C.muted }}>{periodLabel[period]} 합계 · {filtered.length}건</span>
          <span style={{ fontSize: 22, fontWeight: 800, color: C.accent }}>{total.toLocaleString()}원</span>
        </div>
        {catRows.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {catRows.map(([cat, amt]) => (
              <div key={cat} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: C.ink, width: 64, flexShrink: 0 }}>{cat}</span>
                <div style={{ flex: 1, height: 6, background: C.line, borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ width: `${total ? (amt / total) * 100 : 0}%`, height: "100%", background: C.accent2 }} />
                </div>
                <span style={{ fontSize: 12, color: C.muted, width: 80, textAlign: "right", flexShrink: 0 }}>{amt.toLocaleString()}원</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 목록 */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", color: C.muted, padding: "40px 0", fontSize: 14 }}>이 기간에 영수증이 없어요.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.map(({ r, i }) => (
            <div key={i} onClick={() => setDetailIdx(i)}
              style={{ background: C.card, border: `1.5px solid ${C.line}`, borderRadius: 14, padding: 16, display: "flex", gap: 12, cursor: "pointer" }}>
              {r.image && <img src={r.image} alt="" style={{ width: 54, height: 54, objectFit: "cover", borderRadius: 8, flexShrink: 0 }} />}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 16 }}>{r.merchant || "(가맹점 없음)"}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: C.accent }}>{parseNum(r.amount).toLocaleString()}원</div>
                <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
                  {[r.date, r.category, r.payment].filter(Boolean).join(" · ")}
                </div>
                {r.note && <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{r.note}</div>}
                <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>입력일 {fmtDate(r.savedAt)} · 탭하여 상세</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── 영수증 상세/수정 ─────────────────────────
function ReceiptDetail({ receipt, onClose, onSave, onDelete }) {
  const [data, setData] = useState(receipt);
  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));
  const fields = [
    ["date", "날짜"], ["merchant", "가맹점"], ["amount", "금액"],
    ["category", "카테고리"], ["payment", "결제수단"], ["note", "비고"],
  ];
  return (
    <div className="fadeUp">
      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0 12px" }}>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, color: C.muted, cursor: "pointer", padding: 0 }}>‹</button>
        <h2 style={{ fontFamily: fontDisplay, fontSize: 24, margin: 0 }}>영수증 상세</h2>
      </div>

      {receipt.image && (
        <img src={receipt.image} alt="receipt" style={{ width: "100%", borderRadius: 12, marginBottom: 16, border: `1.5px solid ${C.line}` }} />
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {fields.map(([k, label]) => (
          <div key={k}>
            <label style={{ fontSize: 12, color: C.muted, display: "block", marginBottom: 4 }}>{label}</label>
            <input value={data[k] || ""} onChange={(e) => set(k, e.target.value)}
              style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1.5px solid ${C.line}`, fontSize: 15, background: C.card, color: C.ink, outline: "none" }} />
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11, color: C.muted, marginTop: 12 }}>입력일 {fmtDate(receipt.savedAt)}</div>

      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        <button onClick={onDelete} style={{ flex: 1, background: "none", border: `1.5px solid ${C.accent}`, borderRadius: 12, padding: "14px 0", fontWeight: 700, color: C.accent, cursor: "pointer" }}>삭제</button>
        <button onClick={() => onSave(data)} style={{ flex: 2, background: C.accent, color: "#fff", border: "none", borderRadius: 12, padding: "14px 0", fontWeight: 800, fontSize: 16, cursor: "pointer" }}>수정 저장</button>
      </div>
    </div>
  );
}

function Empty({ text }) {
  return (
    <div className="fadeUp" style={{ textAlign: "center", padding: "80px 0", color: C.muted }}>
      <div style={{ fontSize: 40, marginBottom: 12, opacity: .4 }}>◇</div>
      <div style={{ fontSize: 15 }}>{text}</div>
    </div>
  );
}

// (OCR 파싱은 서버리스 함수 /api/parse 로 이전됨 — src/api.js의 parseImage 사용)

// ───────────────────────── 유틸 ─────────────────────────
function toDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function parseNum(v) {
  if (typeof v === "number") return v;
  if (!v) return 0;
  return parseInt(String(v).replace(/[^0-9]/g, ""), 10) || 0;
}

function fmtDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function buildVCardText(c) {
  return [
    "BEGIN:VCARD", "VERSION:3.0",
    `N:${c.name || ""}`, `FN:${c.name || ""}`,
    (c.company || c.department) ? `ORG:${c.company || ""}${c.department ? ";" + c.department : ""}` : "",
    c.title ? `TITLE:${c.title}` : "",
    c.mobile ? `TEL;TYPE=CELL:${c.mobile}` : "",
    c.phone ? `TEL;TYPE=WORK,VOICE:${c.phone}` : "",
    c.fax ? `TEL;TYPE=FAX:${c.fax}` : "",
    c.email ? `EMAIL;TYPE=WORK:${c.email}` : "",
    c.email2 ? `EMAIL;TYPE=HOME:${c.email2}` : "",
    c.website ? `URL:${c.website}` : "",
    (c.address || c.zipcode) ? `ADR;TYPE=WORK:;;${c.address || ""};;;${c.zipcode || ""};` : "",
    "END:VCARD",
  ].filter(Boolean).join("\r\n");
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function downloadVCard(c) {
  const text = buildVCardText(c);
  // iOS: data URI를 새 탭으로 직접 열면 시스템이 연락처 카드로 인식한다.
  if (isIOS()) {
    const dataUri = "data:text/vcard;charset=utf-8," + encodeURIComponent(text);
    const w = window.open(dataUri, "_blank");
    if (!w) {
      // 팝업이 막히면 현재 창에서 이동 (사용자 탭 직후이므로 보통 허용됨)
      window.location.href = dataUri;
    }
    return;
  }
  // 그 외(데스크톱/안드로이드): 일반 파일 다운로드
  const blob = new Blob([text], { type: "text/x-vcard;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${c.name || "contact"}.vcf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadCSV(receipts, user) {
  const header = ["입력일", "날짜", "가맹점", "금액", "카테고리", "결제수단", "비고", "입력자"];
  const rows = receipts.map((r) => [fmtDate(r.savedAt), r.date, r.merchant, parseNum(r.amount), r.category, r.payment, r.note, user]);
  const csv = [header, ...rows].map((row) => row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `영수증_${user}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
