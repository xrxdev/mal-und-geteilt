// Wird von der Lernseite alle 30 Sekunden abgefragt:
// Nachricht an alle, Wartungsmodus, festgelegte Schwierigkeit, Neu-laden, persönliche Befehle.
import { getStore } from "@netlify/blobs";

const json = (o, status = 200) => new Response(JSON.stringify(o), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
});
const HOUR = 60 * 60 * 1000;

export default async (req) => {
  const now = Date.now();
  const id = new URL(req.url).searchParams.get("id") || "";
  const cfg = (await getStore({ name: "admin", consistency: "strong" }).get("config", { type: "json" })) || {};

  const out = {
    now,
    broadcast: cfg.broadcast && cfg.broadcast.until > now ? cfg.broadcast : null,
    maintenance: cfg.maintenance && cfg.maintenance.on ? { text: cfg.maintenance.text || "" } : null,
    forcedLevel: cfg.forcedLevel || null,
    reloadAt: cfg.reloadAt || 0,
    banned: false,
    cmds: []
  };

  if (/^[a-f0-9]{16,64}$/.test(id)) {
    const rec = await getStore({ name: "learners", consistency: "strong" }).get(id, { type: "json" });
    if (rec) {
      out.banned = !!rec.banned;
      out.cmds = (rec.cmds || []).filter(c => now - c.at < HOUR);
    }
  }
  return json(out);
};

export const config = { path: "/api/state" };
