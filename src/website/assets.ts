import logo from "../assets/brand/billiontalks-logo.png";
import teamSmall from "../assets/website/team-640.webp";
import teamLarge from "../assets/website/team-1200.webp";
import earth from "../assets/website/earth-800.webp";

const assets: Record<string, { source: string | ArrayBuffer; type: string }> = {
  "/assets/website/logo.png": { source: logo, type: "image/png" },
  "/assets/website/team-640.webp": { source: teamSmall, type: "image/webp" },
  "/assets/website/team-1200.webp": { source: teamLarge, type: "image/webp" },
  "/assets/website/earth-800.webp": { source: earth, type: "image/webp" },
};

export async function websiteAsset(path: string): Promise<Response | null> {
  const asset = assets[path];
  if (!asset) return null;
  const body = typeof asset.source === "string"
    ? Uint8Array.from(atob(asset.source.slice(asset.source.indexOf(",") + 1)), (character) => character.charCodeAt(0))
    : new Uint8Array(asset.source);
  const hash = await crypto.subtle.digest("SHA-256", body);
  const etag = `"${Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join("")}"`;
  return new Response(body, {
    headers: {
      "Content-Type": asset.type,
      "Cache-Control": "public, max-age=86400",
      "ETag": etag,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
