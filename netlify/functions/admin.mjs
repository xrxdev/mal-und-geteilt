// Admin-API: Einmal-PIN, Owner-Zugang, Geräte verbinden, Lernende abrufen.
import { getStore } from "@netlify/blobs";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

const sha = s => createHash("sha256").update(String(s)).digest("hex");
const str = (v, n) => String(v ?? "").slice(0, n);
const json = (o, status = 200) => Response.json(o, { status });
const safeEq = (a, b) => {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && timingSafeEqual(A, B);
};

const MAX_FAILS = 8;                 // nach 8 Fehlversuchen ...
const LOCK_MS = 15 * 60 * 1000;      // ... 15 Minuten Sperre
const CODE_MS = 10 * 60 * 1000;      // Gerätecode gilt 10 Minuten

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Nur POST erlaubt" }, 405);

  let body;
  try { body = JSON.parse(await req.text()); } catch { return json({ error: "Ungültige Daten" }, 400); }
  const action = String(body.action || "");

  const meta = getStore({ name: "admin", consistency: "strong" });
  const owner = Object.assign(
    { tokens: [], usedPins: [], codes: [], fails: { count: 0, until: 0 } },
    (await meta.get("owner", { type: "json" })) || {}
  );
  const now = Date.now();
  const save = () => meta.setJSON("owner", owner);

  /* ---------- Anmelden: Einmal-PIN oder Gerätecode ---------- */
  if (action === "claim" || action === "link") {
    if (owner.fails.until > now) {
      return json({ error: "Zu viele Fehlversuche. Warte ein paar Minuten." }, 429);
    }
    const fail = async (msg) => {
      owner.fails.count++;
      if (owner.fails.count >= MAX_FAILS) owner.fails = { count: 0, until: now + LOCK_MS };
      await save();
      return json({ error: msg }, 403);
    };

    if (action === "claim") {
      const envPin = process.env.ADMIN_PIN;
      if (!envPin) return json({ error: "ADMIN_PIN ist in Netlify noch nicht eingetragen." }, 500);
      const pin = String(body.pin || "").trim();
      if (!safeEq(pin, envPin) || owner.usedPins.includes(sha(pin))) return fail("PIN falsch oder schon benutzt.");
      owner.usedPins.push(sha(pin));   // diese PIN nie wieder gültig
      owner.tokens = [];               // alte Zugänge werden ungültig
      owner.codes = [];
    } else {
      owner.codes = owner.codes.filter(c => c.exp > now);
      const h = sha(String(body.code || "").trim());
      const i = owner.codes.findIndex(c => c.hash === h);
      if (i < 0) return fail("Code falsch oder abgelaufen.");
      owner.codes.splice(i, 1);        // Code nur einmal nutzbar
    }

    const token = randomBytes(32).toString("hex");
    owner.tokens.push({ hash: sha(token), created: now, device: str(body.device, 80) });
    owner.fails = { count: 0, until: 0 };
    await save();
    return json({ token });
  }

  /* ---------- Ab hier nur mit gültigem Owner-Token ---------- */
  const tokenHash = sha(String(body.token || ""));
  if (!owner.tokens.some(t => t.hash === tokenHash)) return json({ error: "Nicht angemeldet" }, 401);

  if (action === "check") return json({ ok: true });

  if (action === "list") {
    const store = getStore({ name: "learners", consistency: "strong" });
    const { blobs } = await store.list();
    const items = await Promise.all(blobs.map(b => store.get(b.key, { type: "json" })));
    const learners = items.filter(Boolean).map(({ secretHash, ...rest }) => rest);
    const config = (await meta.get("config", { type: "json" })) || {};
    if (config.broadcast && config.broadcast.until <= now) config.broadcast = null;
    return json({ now, learners, devices: owner.tokens.length, config });
  }

  if (action === "newcode") {
    const code = String(randomInt(0, 1000000)).padStart(6, "0");
    owner.codes = owner.codes.filter(c => c.exp > now);
    owner.codes.push({ hash: sha(code), exp: now + CODE_MS });
    await save();
    return json({ code, validMinutes: CODE_MS / 60000 });
  }

  /* ---------- Einstellungen für die ganze Seite ---------- */
  const cfg = (await meta.get("config", { type: "json" })) || {};
  const saveCfg = () => meta.setJSON("config", cfg);
  const learnersStore = getStore({ name: "learners", consistency: "strong" });
  const validId = id => /^[a-f0-9]{16,64}$/.test(String(id || ""));
  const LEVELS = ["sehrleicht", "leicht", "mittel", "schwer", "sehrschwer", "extrem"];

  if (action === "broadcast") {
    const text = str(body.text, 500).trim();
    if (!text) return json({ error: "Die Nachricht ist leer." }, 400);
    const secs = Math.max(5, Math.min(7 * 24 * 3600, Math.floor(Number(body.seconds) || 0)));
    cfg.broadcast = {
      id: randomBytes(6).toString("hex"),
      text,
      style: "banner",
      sent: now,
      until: now + secs * 1000
    };
    await saveCfg();
    return json({ ok: true, broadcast: cfg.broadcast });
  }

  if (action === "clearBroadcast") {
    cfg.broadcast = null;
    await saveCfg();
    return json({ ok: true });
  }

  if (action === "maintenance") {
    cfg.maintenance = { on: !!body.on, text: str(body.text, 300) };
    await saveCfg();
    return json({ ok: true });
  }

  if (action === "forceLevel") {
    cfg.forcedLevel = LEVELS.includes(body.level) ? body.level : null;
    await saveCfg();
    return json({ ok: true });
  }

  if (action === "reloadAll") {
    cfg.reloadAt = now;
    await saveCfg();
    return json({ ok: true });
  }

  if (action === "cmd" || action === "ban") {
    if (!validId(body.id)) return json({ error: "Ungültige ID" }, 400);
    const rec = await learnersStore.get(body.id, { type: "json" });
    if (!rec) return json({ error: "Person nicht gefunden" }, 404);
    if (action === "ban") {
      rec.banned = !!body.banned;
    } else {
      const type = String(body.type || "");
      if (!["msg", "reset", "rename", "reload"].includes(type)) return json({ error: "Unbekannter Befehl" }, 400);
      if (type === "msg" && !str(body.text, 500).trim()) return json({ error: "Die Nachricht ist leer." }, 400);
      const cmd = { id: randomBytes(6).toString("hex"), type, text: str(body.text, 500), at: now };
      rec.cmds = [...(rec.cmds || []).filter(c => now - c.at < 60 * 60 * 1000), cmd].slice(-10);
      if (type === "reset") { rec.correct = 0; rec.wrong = 0; rec.streak = 0; rec.last = []; }
    }
    await learnersStore.setJSON(body.id, rec);
    return json({ ok: true });
  }

  if (action === "deleteAll") {
    const { blobs } = await learnersStore.list();
    await Promise.all(blobs.map(b => learnersStore.delete(b.key)));
    return json({ ok: true, deleted: blobs.length });
  }

  if (action === "delete") {
    const id = String(body.id || "");
    if (!/^[a-f0-9]{16,64}$/.test(id)) return json({ error: "Ungültige ID" }, 400);
    await getStore({ name: "learners", consistency: "strong" }).delete(id);
    return json({ ok: true });
  }

  if (action === "logout") {
    owner.tokens = owner.tokens.filter(t => t.hash !== tokenHash);
    await save();
    return json({ ok: true });
  }

  return json({ error: "Unbekannte Aktion" }, 400);
};

export const config = { path: "/api/admin" };
