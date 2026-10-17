import { escapeHtml } from "./html";

const paths: Record<string, string> = {
  video: '<rect x="2" y="5" width="14" height="14" rx="3"/><path d="m16 9 6-3v12l-6-3"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 2v6m8-6v6M3 11h18m-14 5h3m4 0h3"/>',
  people: '<circle cx="9" cy="7" r="3"/><path d="M2 21v-3a7 7 0 0 1 14 0v3M16 4a3 3 0 0 1 0 6m3 4a6 6 0 0 1 3 5v2"/>',
  chat: '<path d="M21 11a8 8 0 0 1-8 8H8l-6 3V11a9 9 0 0 1 19 0ZM7 9h10M7 13h7"/>',
  shield: '<path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Zm-5 9 3 3 7-7"/>',
  screen: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M12 17v4M7 21h10m-1-11-4-4-4 4m4-4v8"/>',
  link: '<path d="m10 13 4-4m-6 6-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 3 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(1 0)"/>',
  spark: '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><ellipse cx="12" cy="12" rx="4" ry="10"/><path d="M2 12h20M4 6h16M4 18h16"/>',
  mic: '<rect x="8" y="2" width="8" height="13" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  bulb: '<path d="M8 17c0-4-3-4-3-8a7 7 0 0 1 14 0c0 4-3 4-3 8Zm1 4h6M12 5v5"/>',
  heart: '<path d="M12 21 3 12C-3 5 7-1 12 6c5-7 15-1 9 6Z"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 6v7m0 4v1"/>',
  headset: '<path d="M3 14V11a9 9 0 0 1 18 0v6c0 4-4 5-8 5M3 12h3v7H3Zm15 0h3v7h-3Z"/>',
  building: '<path d="M4 22V6h9v16M13 11h7v11M7 9h3m-3 4h3m-3 4h3m6-3h2m-2 4h2M1 22h22"/>',
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M8 7V3h8v4M2 12l10 4 10-4m-10 2v4"/>',
  person: '<circle cx="12" cy="7" r="4"/><path d="M3 22v-3a9 9 0 0 1 18 0v3Z"/>',
  rocket: '<path d="M9 15C9 5 17 2 22 2c0 5-3 13-13 13Zm0-6H5l-3 6h7m6 0v4l-6 3v-7M6 18l-3 3"/><circle cx="16" cy="8" r="2"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12Z"/><circle cx="12" cy="12" r="4"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="m12 12 9-9m-1 0h2v2"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="m2 6 10 7L22 6"/>',
};

export function icon(name: string): string {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] ?? paths.chat}</svg>`;
}

export function iconBadge(name: string): string {
  return `<span class="icon-box">${icon(name)}</span>`;
}

const participants = ["priya", "arun", "karthik", "sneha"] as const;

export function meetingPreview(variant: "home" | "about" | "journey" | "features"): string {
  return `<figure class="product-stage product-${variant}" aria-label="Illustrative four-person BillionTalks meeting on a laptop. Sample participants, not a live call.">
    <div class="laptop"><div class="meeting-preview">
      <div class="preview-top"><img src="/assets/website/logo.png" width="629" height="190" alt="BillionTalks"><span>Team Sync <small>12:36</small></span><span class="preview-top-icons">${icon("people")}${icon("shield")}</span></div>
      <div class="preview-room"><div class="preview-grid">${participants.map((name) => `<div class="preview-tile"><img src="/assets/website/portrait-${name}.webp" width="480" height="480" alt="" fetchpriority="${variant === "home" ? "high" : "auto"}"><span><i></i>${name[0]!.toUpperCase() + name.slice(1)}</span></div>`).join("")}</div>
      <div class="preview-roster"><strong>Participants (4)</strong>${participants.map((name, index) => `<span><img src="/assets/website/portrait-${name}.webp" alt="" width="24" height="24">${name[0]!.toUpperCase() + name.slice(1)}${index === 0 ? " (Host)" : ""}</span>`).join("")}</div></div>
      <div class="preview-bottom"><span>Meeting preview</span><span class="preview-capabilities">${icon("mic")}${icon("video")}${icon("screen")}${icon("chat")}</span><a href="/ui" aria-label="Open the real BillionTalks meeting interface">${icon("arrow")}</a></div>
    </div></div><div class="laptop-base"></div>
    ${variant === "journey" || variant === "features" ? '<div class="phone"><img src="/assets/website/logo.png" alt="" width="629" height="190"><span>Meet. Connect.</span></div>' : ""}
    ${variant === "features" ? `<span class="product-float">${icon("video")}</span>` : ""}
    <figcaption>Product illustration &middot; Sample participants</figcaption></figure>`;
}

export function globeVisual(): string {
  return `<div class="connection-globe" role="img" aria-label="A connected globe representing conversations across borders"><div class="globe-grid"></div>${[0, 1, 2, 3, 4].map((i) => `<span class="globe-person globe-person-${i}">${icon("person")}</span>`).join("")}</div>`;
}

export function miniVisual(kind: string, destination: string): string {
  switch (kind) {
    case "register":
      return `<div class="mini-ui"><strong>Create Your Account</strong><span class="sample-field">${icon("mail")} Your email address</span><a class="button" href="${destination}">Create Free Account</a></div>`;
    case "calendar":
      return `<div class="mini-ui"><div class="mini-calendar"><strong>Plan your next conversation</strong><div class="calendar-days" aria-hidden="true">${Array.from({ length: 14 }, (_, i) => `<span${i === 9 ? ' class="chosen"' : ""}>${i + 1}</span>`).join("")}</div></div><a class="button" href="/schedule">${icon("calendar")} Schedule a Meeting</a></div>`;
    case "link":
      return `<div class="mini-ui"><span class="sample-field">${icon("link")} Your meeting link</span><div class="avatar-row" aria-hidden="true">${participants.map((name) => `<img src="/assets/website/portrait-${name}.webp" alt="" width="36" height="36" loading="lazy">`).join("")}</div><a class="text-link" href="/how-it-works">See how invitations work &rarr;</a></div>`;
    case "shield":
      return `<div class="mini-ui"><strong>Participant access</strong><span class="sample-field">${icon("shield")} Host approval</span><span class="visual-note">Welcome people into your meeting.</span><a class="text-link" href="/ui">Open meeting controls &rarr;</a></div>`;
    case "chat":
      return `<div class="mini-ui"><strong>In-meeting chat</strong><span class="chat-bubble">Let's start the conversation.</span><span class="chat-bubble reply">Ready when you are.</span><span class="visual-note">Illustrative conversation</span></div>`;
    case "screen":
      return `<div class="mini-ui"><div class="shared-screen">${icon("screen")}<span>Bring your ideas into view</span></div><span class="visual-note">Screen sharing on supported browsers</span></div>`;
    default:
      return `<div class="capability-row">${["video", "mic", "screen", "chat"].map((name, i) => `<span>${iconBadge(name)}${["Video", "Audio", "Screen share", "Chat"][i]}</span>`).join("")}</div>`;
  }
}

export function audienceCard(image: string, title: string, copy: string, symbol: string, destination: string): string {
  return `<a class="card audience-card" href="${destination}"><div class="audience-copy">${iconBadge(symbol)}<h2>${escapeHtml(title)}</h2><p>${escapeHtml(copy)}</p></div><img class="audience-photo" src="/assets/website/${image}.webp" alt="" width="480" height="480" loading="lazy"><span class="card-arrow">${icon("arrow")}</span></a>`;
}
