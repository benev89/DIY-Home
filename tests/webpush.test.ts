import { describe, expect, it } from "vitest";
import { b64urlDecode, b64urlEncode, encryptPayload, generateVapidKeys, vapidAuth } from "../server/src/webpush";
import { localDay, nextLocalTime, parseTime, reachedLocalTime } from "../server/src/timeutil";

const enc = new TextEncoder();
async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, n: number) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, n * 8));
}
const cat = (...a: Uint8Array[]) => Uint8Array.from(a.flatMap((x) => [...x]));

/** A browser's side of RFC 8291, written independently from the server code. */
async function browserDecrypt(body: Uint8Array, uaPriv: CryptoKey, uaPub: Uint8Array, auth: Uint8Array) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
  const idlen = body[20];
  const asPub = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, uaPriv, 256));
  const ikm = await hkdf(shared, auth, cat(enc.encode("WebPush: info\0"), uaPub, asPub), 32);
  const cek = await hkdf(ikm, salt, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(ikm, salt, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, cipher));
  return { rs, idlen, delimiter: plain[plain.length - 1], text: new TextDecoder().decode(plain.slice(0, -1)) };
}

describe("web push encryption (RFC 8291)", () => {
  it("produces a message the browser can decrypt", async () => {
    const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const uaPub = new Uint8Array((await crypto.subtle.exportKey("raw", ua.publicKey)) as ArrayBuffer);
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const sub = { endpoint: "https://web.push.apple.com/abc", keys: { p256dh: b64urlEncode(uaPub), auth: b64urlEncode(auth) } };
    const msg = JSON.stringify({ title: "⏱ Timer", body: "Silikon ist trocken", url: "#/repair/1/work" });
    const body = await encryptPayload(sub, enc.encode(msg));
    const out = await browserDecrypt(body, ua.privateKey, uaPub, auth);
    expect(out).toEqual({ rs: 4096, idlen: 65, delimiter: 2, text: msg });
  });
});

describe("VAPID (RFC 8292)", () => {
  it("signs a JWT for the push service's origin", async () => {
    const keys = await generateVapidKeys();
    expect(b64urlDecode(keys.publicKey)).toHaveLength(65);
    const header = await vapidAuth("https://web.push.apple.com/QWERTY", keys, "https://benev89.github.io/DIY-Home/");
    const [, jwt, k] = header.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(k).toBe(keys.publicKey);
    const [h, c, sig] = jwt.split(".");
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(c)));
    expect(claims.aud).toBe("https://web.push.apple.com");
    expect(claims.sub).toBe("https://benev89.github.io/DIY-Home/");
    const pub = await crypto.subtle.importKey("raw", b64urlDecode(keys.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, b64urlDecode(sig), enc.encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });
});

describe("server time zone helpers", () => {
  it("finds the next 09:00 in Berlin across DST and day boundaries", () => {
    // 27 Nov 2026 08:00 UTC = 09:00 Berlin (CET, UTC+1) → already past? exactly 09:00 → next day
    expect(new Date(nextLocalTime(Date.UTC(2026, 10, 27, 7, 30), "Europe/Berlin")).toISOString()).toBe("2026-11-27T08:00:00.000Z");
    expect(new Date(nextLocalTime(Date.UTC(2026, 10, 27, 9, 0), "Europe/Berlin")).toISOString()).toBe("2026-11-28T08:00:00.000Z");
    // Summer time (CEST, UTC+2)
    expect(new Date(nextLocalTime(Date.UTC(2026, 6, 1, 3, 0), "Europe/Berlin")).toISOString()).toBe("2026-07-01T07:00:00.000Z");
    // 23:30 UTC on the 27th is already the 28th in Berlin
    expect(localDay(Date.UTC(2026, 10, 27, 23, 30), "Europe/Berlin")).toBe("2026-11-28");
  });
});

describe("custom reminder time", () => {
  it("uses the chosen local time, also across summer time", () => {
    expect(new Date(nextLocalTime(Date.UTC(2026, 10, 28, 5, 0), "Europe/Berlin", "07:30")).toISOString()).toBe("2026-11-28T06:30:00.000Z");
    expect(new Date(nextLocalTime(Date.UTC(2026, 10, 28, 7, 0), "Europe/Berlin", "07:30")).toISOString()).toBe("2026-11-29T06:30:00.000Z");
    expect(new Date(nextLocalTime(Date.UTC(2026, 6, 1, 12, 0), "Europe/Berlin", "18:45")).toISOString()).toBe("2026-07-01T16:45:00.000Z");
  });
  it("knows whether today's time has been reached", () => {
    expect(reachedLocalTime(Date.UTC(2026, 10, 28, 17, 0), "Europe/Berlin", "18:00")).toBe(true); // 18:00 Berlin
    expect(reachedLocalTime(Date.UTC(2026, 10, 28, 16, 59), "Europe/Berlin", "18:00")).toBe(false);
  });
  it("falls back to 09:00 for invalid values", () => {
    expect(parseTime("25:00")).toEqual([9, 0]);
    expect(parseTime(undefined)).toEqual([9, 0]);
    expect(parseTime("6:05")).toEqual([6, 5]);
  });
});

