/*
 * Shareable verification links: the signed manifest, gzip-compressed
 * and base64url-encoded into a URL fragment. The fragment never reaches
 * any server (fragments are not sent in HTTP requests), so the evidence
 * travels peer to peer even through a link.
 */

async function pipe(bytes, TransformCtor, kind) {
  const stream = new Blob([bytes]).stream().pipeThrough(new TransformCtor(kind));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function manifestToLink(manifest, verifyUrl) {
  const raw = new TextEncoder().encode(JSON.stringify(manifest));
  const gz = await pipe(raw, CompressionStream, "gzip");
  return verifyUrl + "#m=" + b64url(gz);
}

export async function linkFragmentToManifest(hash) {
  if (!hash || !hash.startsWith("#m=")) return null;
  try {
    const gz = unb64url(hash.slice(3));
    const raw = await pipe(gz, DecompressionStream, "gzip");
    return JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
}
