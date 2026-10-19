import logo from "../assets/brand/billiontalks-logo.png";
import favicon16 from "../../assets/website/favicon-16.png";
import favicon32 from "../../assets/website/favicon-32.png";
import favicon48 from "../../assets/website/favicon-48.png";
import favicon180 from "../../assets/website/favicon-180.png";
import socialPreview from "../../assets/website/social-preview.png";
import teamSmall from "../assets/website/team-640.webp";
import teamLarge from "../assets/website/team-1200.webp";
import earth from "../assets/website/earth-800.webp";
import priya from "../assets/website/portrait-priya.webp";
import arun from "../assets/website/portrait-arun.webp";
import karthik from "../assets/website/portrait-karthik.webp";
import sneha from "../assets/website/portrait-sneha.webp";
import support from "../assets/website/support.webp";
import solutionsTeam from "../assets/website/solutions-team.webp";

const assets: Record<string, { source: string | ArrayBuffer; type: string }> = {
  "/assets/website/logo.png": { source: logo, type: "image/png" },
  "/assets/website/favicon-16.png": { source: favicon16, type: "image/png" },
  "/assets/website/favicon-32.png": { source: favicon32, type: "image/png" },
  "/assets/website/favicon-48.png": { source: favicon48, type: "image/png" },
  "/assets/website/favicon-180.png": { source: favicon180, type: "image/png" },
  "/assets/website/social-preview.png": { source: socialPreview, type: "image/png" },
  "/assets/website/team-640.webp": { source: teamSmall, type: "image/webp" },
  "/assets/website/team-1200.webp": { source: teamLarge, type: "image/webp" },
  "/assets/website/earth-800.webp": { source: earth, type: "image/webp" },
  "/assets/website/portrait-priya.webp": { source: priya, type: "image/webp" },
  "/assets/website/portrait-arun.webp": { source: arun, type: "image/webp" },
  "/assets/website/portrait-karthik.webp": { source: karthik, type: "image/webp" },
  "/assets/website/portrait-sneha.webp": { source: sneha, type: "image/webp" },
  "/assets/website/support.webp": { source: support, type: "image/webp" },
  "/assets/website/solutions-team.webp": { source: solutionsTeam, type: "image/webp" },
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
