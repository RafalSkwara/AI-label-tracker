// Generates a VAPID key pair for Web Push (run once: `node scripts/gen-vapid.mjs`).
// Put both values into the Worker secrets VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY. Never commit the private key.
const b64u = (b) => Buffer.from(b).toString("base64url");
const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const raw = new Uint8Array(await crypto.subtle.exportKey("raw", publicKey));
const jwk = await crypto.subtle.exportKey("jwk", privateKey);
console.log("VAPID_PUBLIC_KEY=" + b64u(raw));
console.log("VAPID_PRIVATE_KEY=" + jwk.d);
