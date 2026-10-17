import type { Account } from "../account/domain";
import { publicPages, homeCards, steps, features, audiences, type PublicPage } from "./content";
import { websiteStyles } from "./styles";
import { contactForm, contactScript } from "./contact";
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
  book: '<path d="M12 5c-3-3-7-3-10-1v16c3-2 7-2 10 1 3-3 7-3 10-1V4c-3-2-7-2-10 1Zm0 0v16"/>',
  globe: '<circle cx="12" cy="12" r="10"/><ellipse cx="12" cy="12" rx="4" ry="10"/><path d="M2 12h20M4 6h16M4 18h16"/>',
};

export function icon(name: string): string {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] ?? paths.chat}</svg>`;
}

function cards(items: readonly (readonly [string, string, string])[], className = ""): string {
  return `<div class="cards ${className}">${items.map(([image, title, copy]) =>
    `<article class="card"><span class="icon-box">${icon(image)}</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(copy)}</p></article>`,
  ).join("")}</div>`;
}

function accountCta(account: Account | null): string {
  return `<a class="button" href="${account ? "/dashboard" : "/account#register"}">${account ? "Go to Dashboard" : "Create Free Account"}</a>`;
}

function photoHero(): string {
  return `<div class="hero-art"><figure class="photo-frame"><picture><source type="image/webp" srcset="/assets/website/team-640.webp 640w, /assets/website/team-1200.webp 1200w" sizes="(max-width:800px) 90vw, 45vw"><img src="/assets/website/team-1200.webp" alt="People collaborating around a table with laptops and notebooks" width="1200" height="900" fetchpriority="high"></picture></figure><span class="float-symbol">${icon("video")}</span><div class="photo-caption"><strong>Make room for conversation.</strong><span>Start now. Plan ahead. Bring people together.</span></div></div>`;
}

function closing(heading: string, account: Account | null, copy = ""): string {
  return `<section class="section wrap"><div class="cta"><h2>${escapeHtml(heading)}</h2>${copy ? `<p>${escapeHtml(copy)}</p>` : ""}${accountCta(account)}<p class="tagline">The meeting doesn't end when the call ends.</p></div></section>`;
}

function pageBody(page: PublicPage, account: Account | null): string {
  switch (page.path) {
    case "/":
      return `<section class="section wrap"><div class="section-heading"><h2>More than a meeting link.</h2><p>From setting a time to welcoming everyone into the room, keep the essentials in one place.</p></div>${cards(homeCards, "home-cards")}</section>
      <section class="section tinted"><div class="wrap split"><div><p class="eyebrow">Space for your next idea</p><h2>Built for beginnings. Ready for what comes next.</h2><p>Whether you're building a business, leading a small team, consulting or connecting with friends, a meaningful conversation deserves a simple place to begin.</p><a class="text-link" href="/solutions">Find your way to meet &rarr;</a></div><div class="card"><span class="icon-box">${icon("calendar")}</span><h3>From the first hello to your next meeting.</h3><p>Start with an account, plan a time and share your meeting link. Keep the essentials together in your workspace.</p><a class="text-link" href="/how-it-works">See how it works &rarr;</a></div></div></section>${closing("Good conversations create possibilities.", account)}`;
    case "/about":
      return `<section class="section wrap split"><div><p class="eyebrow">People first. Wherever you are.</p><h2>Why BillionTalks.</h2><p>Our working lives span cities, borders and time zones. Yet the need is universal: to share ideas, listen and move forward together. BillionTalks is being built around that human connection.</p></div><img class="section-image" src="/assets/website/earth-800.webp" alt="Earth seen from space, connecting the story across borders and time zones" width="800" height="600" loading="lazy" decoding="async"></section>
      <section class="section tinted"><div class="wrap cards" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))"><article class="card"><span class="icon-box">${icon("people")}</span><h2>Our mission.</h2><p>Make it simpler for individuals and teams to plan, join and host online meetings using accessible tools that put conversation first.</p></article><article class="card"><span class="icon-box">${icon("globe")}</span><h2>Our vision.</h2><p>A world where distance creates fewer barriers to meaningful collaboration and every conversation has the potential to lead somewhere.</p></article></div></section>
      <section class="section wrap"><div class="section-heading"><h2>What guides us.</h2></div>${cards([["chat", "Clarity", "Communication should be simple."], ["globe", "Accessibility", "Ideas can start anywhere."], ["shield", "Trust", "Show people clearly how the product works."], ["spark", "Progress", "Improve by listening to users."]], "values")}</section>${closing("Let's start a better conversation.", account)}`;
    case "/how-it-works":
      return `<section class="section wrap"><ol class="step-list">${steps.map(([title, body]) => `<li><h2 style="font-size:21px">${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p></li>`).join("")}</ol></section>
      <section class="section tinted"><div class="wrap text-section"><h2>Joining someone else's meeting?</h2><p>Open the link you received and follow the steps on screen. Depending on the host's settings, you may wait for admission.</p><a class="text-link" href="/ui">Join with a Meeting ID &rarr;</a></div></section>${closing("Ready when you are.", account)}<p class="wrap" style="text-align:center"><a href="/features">Explore Features</a></p>`;
    case "/features":
      return `<section class="section wrap">${cards(features)}</section><section class="section tinted"><div class="wrap text-section"><h2>Designed around the conversation.</h2><p>One connected experience from scheduling to joining and meeting management.</p><a class="text-link" href="/how-it-works">See the steps &rarr;</a></div></section>${closing("Bring your next meeting together.", account)}`;
    case "/solutions":
      return `<section class="section wrap">${cards(audiences)}</section><section class="section tinted"><div class="wrap text-section"><h2>One workspace. Many ways to meet.</h2><p>Start now, plan ahead and choose how participants enter &mdash; without extra complexity.</p><p><a href="/how-it-works">See how it works</a> or <a href="/features">explore the features</a>.</p></div></section>${closing("Wherever the conversation starts, begin here.", account)}`;
    case "/contact":
      return contactForm(account);
  }
}

const commonScript = `
const menuButton = document.getElementById('menuToggle');
menuButton.addEventListener('click', () => {
  const expanded = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded', String(expanded));
  document.getElementById('publicNavigation').classList.toggle('open', expanded);
});
const signOut = document.getElementById('publicSignOut');
if (signOut) signOut.addEventListener('click', async () => {
  signOut.disabled = true;
  const error = document.getElementById('authError');
  error.textContent = '';
  try {
    const response = await fetch('/api/accounts/logout', { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:'{}' });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Unable to sign out. Please try again.');
    location.assign('/');
  } catch (failure) { error.textContent = failure instanceof Error ? failure.message : 'Unable to sign out. Please try again.'; signOut.disabled = false; }
});
`;

export function websiteResponse(page: PublicPage, account: Account | null, isProduction: boolean): Response {
  const hero = `<section class="hero"><div class="wrap hero-grid"><div class="hero-copy"><p class="eyebrow">${page.path === "/" ? "A free place to connect" : `BillionTalks / ${page.label}`}</p><h1>${escapeHtml(page.heading)}</h1><p class="lead">${escapeHtml(page.intro)}</p>${page.path === "/contact" ? "" : `<div class="hero-actions">${accountCta(account)}<a class="button secondary" href="${page.path === "/" || page.path === "/how-it-works" ? "/features" : "/how-it-works"}">${page.path === "/" || page.path === "/how-it-works" ? "Explore Features" : "See How It Works"}</a></div>${page.path === "/" ? '<p class="hero-note">Current V1 access is free. For individuals and growing teams.</p>' : ""}`}</div>${page.path === "/contact" ? "" : photoHero()}</div></section>`;
  return htmlResponse(page.path, page.title, page.description, hero + pageBody(page, account), account, isProduction, page.path === "/contact" ? contactScript : "");
}

export function htmlResponse(path: string, title: string, description: string, body: string, account: Account | null, isProduction: boolean, script = ""): Response {
  const nonce = crypto.randomUUID().replace(/-/gu, "");
  const canonical = `https://billiontalks.com${path}`;
  const isPublic = publicPages.some((page) => page.path === path);
  const schema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: title,
    url: canonical,
    description,
    isPartOf: { "@type": "WebSite", name: "BillionTalks", url: "https://billiontalks.com/" },
    publisher: { "@type": "Organization", name: "BillionTalks", url: "https://billiontalks.com/", logo: "https://billiontalks.com/assets/website/logo.png" },
  }).replace(/</gu, "\\u003c");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><meta name="robots" content="${isProduction && isPublic ? "index,follow" : "noindex,nofollow"}"><link rel="canonical" href="${escapeHtml(canonical)}"><meta property="og:type" content="website"><meta property="og:site_name" content="BillionTalks"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(canonical)}"><meta property="og:image" content="https://billiontalks.com/assets/website/team-1200.webp"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="900"><meta property="og:image:alt" content="People collaborating around a table"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="https://billiontalks.com/assets/website/team-1200.webp"><meta name="theme-color" content="#1755d9"><link rel="icon" href="/assets/website/logo.png"><style nonce="${nonce}">${websiteStyles}</style><script nonce="${nonce}" type="application/ld+json">${schema}</script></head><body class="page-${path === "/" ? "home" : path.slice(1).replace(/\//gu, "-")}"><a class="skip" href="#main">Skip to content</a>
  <header class="site-header"><div class="wrap header-inner"><a class="logo" href="/" aria-label="BillionTalks home"><img src="/assets/website/logo.png" alt="BillionTalks" width="629" height="190"></a><button id="menuToggle" class="menu-toggle" type="button" aria-controls="publicNavigation" aria-expanded="false">Menu</button><nav class="public-nav" id="publicNavigation" aria-label="Main navigation">${publicPages.map((page) => `<a href="${page.path}"${page.path === path ? ' aria-current="page"' : ""}>${page.label}</a>`).join("")}</nav><div class="account-actions">${account ? `<a class="button" href="/dashboard">Dashboard</a><details class="profile"><summary>${escapeHtml(account.fullName)}</summary><div class="profile-menu"><a href="/account#profile">Profile</a><a href="/account#preferences">Settings</a><button id="publicSignOut" class="button secondary" type="button">Sign Out</button></div></details>` : '<a class="text-link" href="/account#login">Sign In</a><a class="button" href="/account#register">Create Free Account</a>'}</div></div><p class="auth-error" id="authError" role="alert"></p></header>
  <main id="main" tabindex="-1">${body}</main><footer class="site-footer"><div class="wrap"><div class="footer-top"><div><a class="logo" href="/"><img src="/assets/website/logo.png" alt="BillionTalks" width="629" height="190" loading="lazy"></a><p>The meeting doesn't end when the call ends.</p></div><nav class="footer-links" aria-label="Footer">${publicPages.slice(1).map((page) => `<a href="${page.path}">${page.label}</a>`).join("")}<a href="/ui">Join a meeting</a><a href="/contact#privacy">Contact privacy</a></nav></div><div class="footer-bottom"><span>&copy; ${new Date().getUTCFullYear()} BillionTalks. A place for better conversations.</span><span>Photography: <a href="https://unsplash.com/@anniespratt" rel="noopener noreferrer">Annie Spratt</a> and <a href="https://unsplash.com/@nasa" rel="noopener noreferrer">NASA</a> / Unsplash</span></div></div></footer><script nonce="${nonce}">(()=>{'use strict';${commonScript}${script}})();</script></body></html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'`,
      ...(isProduction && isPublic ? {} : { "X-Robots-Tag": "noindex, nofollow" }),
    },
  });
}

export function sitemapResponse(): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${publicPages.map((page) => `<url><loc>https://billiontalks.com${page.path}</loc></url>`).join("")}</urlset>`, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" },
  });
}

export function robotsResponse(isProduction: boolean): Response {
  return new Response(isProduction
    ? "User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /account\nDisallow: /dashboard\nDisallow: /schedule\nDisallow: /calendar\nDisallow: /contacts\nDisallow: /notifications\nDisallow: /rsvp\nDisallow: /ui\nDisallow: /admin/\nDisallow: /*?meeting=\nSitemap: https://billiontalks.com/sitemap.xml\n"
    : "User-agent: *\nDisallow: /\n", {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
