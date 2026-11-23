import {COATS} from "../../public/campus/world.js";
import {sceneInfo} from "../../public/campus/scenes.js";
import {campusSeats} from "../campus-seats.js";
import {sharedCalendar} from "../shared-calendar.js";
import { createHash } from "node:crypto";
import { getCache } from "@vercel/functions";
const slots = [1, 2, 3, 4],
  uuid =
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export default async function rendezvous(req, res) {
  const shared = !!(
    globalThis[Symbol.for("@vercel/request-context")]?.get?.()?.cache ||
    (process.env.RUNTIME_CACHE_ENDPOINT &&
      process.env.RUNTIME_CACHE_HEADERS &&
      process.env.RUNTIME_CACHE_DISABLE_BUILD_CACHE !== "true")
  );
  res.setHeader("X-Plaza-Directory", shared ? "regional" : "instance");
  res.setHeader("Cache-Control", "private, no-store");
  if (
    req.method !== "POST" ||
    !req.headers["content-type"]?.startsWith("application/json")
  )
    return res.status(405).end();
  const p = req.body || {};
  if (
    !/^[a-z0-9-]{1,40}$/.test(p.room) ||
    !uuid.test(p.secret) ||
    typeof p.name !== "string" ||
    p.name.length > 16
  )
    return res.status(400).end();
  const id = createHash("sha256").update(p.secret).digest("hex").slice(0, 32);
  const web = p.mode === "web";
  const cache = getCache({
      keyHashFunction: (key) => createHash("sha256").update(key).digest("hex"),
    }),
    key = (i) => (web ? "plaza-web-1/" : "plaza-signals-2/") + p.room + "/" + i,
    now = Date.now();
  try {
    const values = await Promise.all(slots.map((i) => cache.get(key(i))));
    const rows = values.map((row) => (row && row.until > now ? row : null));
    let index = rows.findIndex((row) => row?.id === id);
    if (p.leave) {
      if (index >= 0) await cache.delete(key(index + 1));
      return res.status(204).end();
    }
    if (index < 0) index = rows.indexOf(null);
    if (index < 0) return res.status(409).json({ error: "full" });
    const mail = {};
    for (const [to, s] of Object.entries(p.mail || {})) {
      if (
        !rows.some((row) => row?.id === to) ||
        !s ||
        !uuid.test(s.attempt) ||
        !["offer", "answer"].includes(s.type) ||
        typeof s.sdp !== "string" ||
        s.sdp.length > 12000 ||
        !s.sdp.startsWith("v=0") ||
        !s.sdp.includes("m=application")
      )
        continue;
      mail[to] = { attempt: s.attempt, type: s.type, sdp: s.sdp };
    }
    const me = { id, name: p.name, until: now + 50000, mail };
    if (web) {
      const a = p.pose;
      if (
        a &&
        Number.isFinite(a.x) &&
        Number.isFinite(a.y) &&
        a.x >= 0 &&
        a.x <= 1536 &&
        a.y >= 0 &&
        a.y <= 1024 &&
        ["male", "female"].includes(a.avatar) &&
        COATS.includes(a.coat) &&
        [
          "east",
          "southeast",
          "south",
          "southwest",
          "west",
          "northwest",
          "north",
          "northeast",
        ].includes(a.f)
      ) {
        const scene=sceneInfo(a.scene)?.id||"plaza";
        me.pose = {
          t: "pose",
          name: me.name,
          x: a.x,
          y: a.y,
          f: a.f,
          w: a.w === true,run:a.w===true && a.run===true,
          scene,
          chair:Number.isInteger(a.chair)&&campusSeats[a.chair]?.scene===scene?a.chair:null,
          seat:
            Number.isInteger(a.seat) && a.seat >= 0 && a.seat < 12
              ? a.seat
              : null,
          playful:a.playful!==false,bumpSlot:slots.includes(a.bumpSlot)?a.bumpSlot:null,studying:a.studying===true,calendar:sharedCalendar(a.calendar),
          style:["male-ash","male-hoodie","male-jacket","female-ash","female-offshoulder"].includes(a.style)?a.style:null,
          crouch: a.crouch === true,
          action: ["jump", "wave", "cheer", "heart", "coffee", "idea", "bump"].includes(a.action)
            ? a.action
            : "",
          seq: Number.isSafeInteger(a.seq) ? a.seq : 0,
          avatar: a.avatar,
          coat: a.coat,
        };
      }
      me.chats = (Array.isArray(p.chats) ? p.chats : [])
        .slice(-12)
        .filter(
          (c) =>
            c &&
            Number.isSafeInteger(c.seq) &&
            c.seq > 0 &&
            typeof c.text === "string" &&
            c.text.length > 0 &&
            c.text.length <= 160,
        )
        .map((c) => ({ seq: c.seq, text: c.text }));
    }
    await cache.set(key(index + 1), me, { ttl: 55, name: "plaza-signaling" });
    rows[index] = me;
    res.json({
      slot: index + 1,
      id,
      roster: rows.flatMap((row, i) =>
        row
          ? [
              {
                slot: i + 1,
                id: row.id,
                name: row.name,
                ...(web
                  ? { pose: row.pose, chats: row.chats ?? [] }
                  : { signal: row.mail?.[id] || null }),
              },
            ]
          : [],
      ),
    });
  } catch {
    res.status(503).json({ error: "rendezvous" });
  }
}
