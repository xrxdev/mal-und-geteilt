// Empfängt den Lernfortschritt von der Lernseite und speichert ihn in Netlify Blobs.
import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

const sha = s => createHash("sha256").update(String(s)).digest("hex");
const str = (v, n) => String(v ?? "").slice(0, n);
const int = v => Math.max(0, Math.min(1000000, Math.floor(Number(v) || 0)));
const json = (o, status = 200) => Response.json(o, { status });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Nur POST erlaubt" }, 405);

  let body;
  try { body = JSON.parse(await req.text()); } catch { return json({ error: "Ungültige Daten" }, 400); }
  const { id, secret, data } = body || {};
  if (!/^[a-f0-9]{16,64}$/.test(String(id || ""))) return json({ error: "Ungültige ID" }, 400);
  if (typeof secret !== "string" || secret.length < 16 || secret.length > 128) return json({ error: "Ungültig" }, 400);
  if (!data || typeof data !== "object") return json({ error: "Keine Daten" }, 400);

  const name = str(data.name, 30).trim();
  if (!name) return json({ error: "Kein Name" }, 400);

  const store = getStore({ name: "learners", consistency: "strong" });
  const old = await store.get(id, { type: "json" });
  const secretHash = sha(secret);
  if (old && old.secretHash !== secretHash) return json({ error: "Kein Zugriff" }, 403);

  const now = Date.now();
  const last = (Array.isArray(data.last) ? data.last : []).slice(-15).map(x => {
    const at = Math.floor(Number(x && x.at));
    return {
      t: str(x && x.t, 20),
      a: str(x && x.a, 6),
      ok: !!(x && x.ok),
      at: Number.isFinite(at) && at > 0 && at < now + 60000 ? at : now
    };
  });

  const record = {
    id,
    secretHash,
    name,
    view: str(data.view, 20),
    detail: str(data.detail, 120),
    level: str(data.level, 20),
    learnStage: str(data.learnStage, 60),
    correct: int(data.correct),
    wrong: int(data.wrong),
    streak: int(data.streak),
    last,
    online: !!data.online,
    lastSeen: now,
    firstSeen: (old && old.firstSeen) || now
  };

  await store.setJSON(id, record);
  return json({ ok: true });
};

export const config = { path: "/api/track" };
