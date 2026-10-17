import type { Account } from "../account/domain";
import { publicPages, homeCards, steps, features, audiences, type PublicPage } from "./content";
import { websiteStyles } from "./styles";
import { contactForm, contactScript } from "./contact";
import { escapeHtml } from "./html";
import { icon, iconBadge, meetingPreview, globeVisual, miniVisual, audienceCard } from "./visuals";

function cards(items: readonly (readonly [string, string, string])[], className = ""): string {
  return `<div class="cards ${className}">${items.map(([image, title, copy]) =>
    `<article class="card"><span class="icon-box">${icon(image)}</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(copy)}</p></article>`,
  ).join("")}</div>`;
}

function accountCta(account: Account | null): string {
  return `<a class="button" href="${account ? "/dashboard" : "/account#register"}">${account ? "Go to Dashboard" : "Create Free Account"}</a>`;
}

function closing(heading: string, account: Account | null, copy = ""): string {
  return `<section class="section wrap"><div class="cta"><div><h2>${escapeHtml(heading)}</h2>${copy ? `<p>${escapeHtml(copy)}</p>` : ""}<p class="tagline">The meeting doesn't end when the call ends.</p></div><div class="hero-actions">${accountCta(account)}<a class="button secondary" href="/features">Explore Features ${icon("arrow")}</a></div></div></section>`;
}

function pageBody(page: PublicPage, account: Account | null): string {
  switch (page.path) {
    case "/":
      return `<section class="section wrap feature-shelf" aria-label="Meeting essentials">${cards(homeCards, "home-cards")}</section>
      <section class="section wrap why-section"><div><p class="eyebrow">Why BillionTalks</p><h2>Built for beginnings.<br><em>Ready for what comes next.</em></h2><p>Whether you're building a business, leading a small team, consulting or connecting with friends, a meaningful conversation deserves a simple place to begin.</p><a class="text-link" href="/solutions">Find your way to meet &rarr;</a></div><div class="why-pillars">${cards([["globe", "Connect across borders", "Ideas can start anywhere."], ["calendar", "Plan ahead", "Keep your next meeting in view."], ["chat", "Stay connected", "Make room for conversation."]])}</div><div class="brand-devices" aria-label="BillionTalks across devices"><div class="brand-laptop"><img src="/assets/website/logo.png" alt="BillionTalks" width="629" height="190"></div><div class="brand-phone">${icon("video")}</div></div></section>${closing("Good conversations create possibilities.", account)}`;
    case "/about":
      return `<section class="section wrap philosophy-grid">${globeVisual()}<article class="card">${iconBadge("bulb")}<h2>Our Philosophy</h2><p>Technology should remove friction, not human connection. We design experiences that make conversations feel natural, purposeful, and human.</p></article><article class="card">${iconBadge("target")}<h2>Our Mission</h2><p>Make it simpler for individuals and teams to plan, join and host online meetings using accessible tools that put conversation first.</p></article><article class="card">${iconBadge("eye")}<h2>Our Vision</h2><p>A world where distance creates fewer barriers to meaningful collaboration and every conversation has the potential to lead somewhere.</p></article></section>
      <section class="section wrap"><div class="section-heading"><p class="eyebrow">Our Values</p><h2>What Drives Us</h2></div>${cards([["chat", "Clarity", "Communication should be simple."], ["globe", "Accessibility", "Ideas can start anywhere."], ["shield", "Trust", "Show people clearly how the product works."], ["heart", "Progress", "Improve by listening to users."]], "values")}</section>${closing("Be Part of Our Journey", account, "Join BillionTalks and experience a better way to meet, collaborate and grow.")}`;
    case "/how-it-works":
      return `<section class="section wrap journey-panel"><div class="section-heading"><div><p class="eyebrow">Get Started</p><h2>Four Simple Steps</h2></div><p>Start meeting, scheduling and collaborating &mdash; no complex setup required.</p></div><ol class="step-list">${steps.map(([title, body], index) => `<li>${iconBadge(["person", "calendar", "people", "video"][index]!)}<h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p>${miniVisual(["register", "calendar", "link", "capabilities"][index]!, account ? "/dashboard" : "/account#register")}</li>`).join("")}</ol></section>
      <section class="section wrap"><div class="section-heading"><p class="eyebrow">It's that simple</p><h2>Everything You Need to Work Together</h2></div>${cards(homeCards.slice(0, 4), "values")}</section><section class="section wrap joining-note"><h2>Joining someone else's meeting?</h2><p>Open the link you received and follow the steps on screen. Depending on the host's settings, you may wait for admission.</p><a class="button secondary" href="/ui">Join with a Meeting ID ${icon("arrow")}</a></section>`;
    case "/features":
      return `<section class="section wrap feature-panel"><div class="section-heading"><div><p class="eyebrow">Our Features</p><h2>Simple. Powerful. Built for Everyone.</h2></div><p>One connected experience from scheduling to joining and meeting management.</p></div><div class="cards feature-cards">${features.map(([symbol, title, copy], i) => `<article class="card feature-card">${iconBadge(symbol)}<h2>${escapeHtml(title)}</h2><p>${escapeHtml(copy)}</p>${i === 0 ? `<div class="mini-meeting">${["priya", "arun"].map((name) => `<img src="/assets/website/portrait-${name}.webp" width="480" height="480" alt="" loading="lazy">`).join("")}</div>` : miniVisual(symbol, account ? "/dashboard" : "/account#register")}</article>`).join("")}</div></section><section class="section wrap feature-finale"><div><p class="eyebrow">All in one place</p><h2>A Better Way <em>to Meet.</em></h2><p>Powerful features. Simple experience.</p>${accountCta(account)}</div><div class="workspace-previews">${miniVisual("calendar", "")}${miniVisual("link", "")}${miniVisual("chat", "")}</div></section>`;
    case "/solutions":
      return `<section class="section wrap"><div class="cards audience-cards">${audiences.map(([symbol, title, copy], i) => audienceCard(["solutions-team", "portrait-arun", "support", "portrait-karthik", "portrait-sneha", "portrait-priya"][i]!, title, copy, symbol, account ? "/dashboard" : "/account#register")).join("")}</div></section>${closing("One Platform. Endless Possibilities.", account, "Start now, plan ahead and choose how participants enter - without extra complexity.")}`;
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
  const accent = { "/": "for Free.", "/about": "Building Better Conversations.", "/how-it-works": "Works.", "/features": "for Better Meetings.", "/solutions": "of All Sizes.", "/contact": "Every Conversation Counts." }[page.path];
  const heading = `${escapeHtml(page.heading.slice(0, -accent.length))}<em>${escapeHtml(accent)}</em>`;
  const heroArt = page.path === "/solutions"
    ? `<div class="solutions-art"><img src="/assets/website/solutions-team.webp" alt="Illustrative team collaborating around a laptop" width="370" height="327" fetchpriority="high"><div class="floating-checklist"><span>Meet</span><span>Schedule</span><span>Collaborate</span><span>Stay connected</span></div><span class="product-float">${icon("video")}</span></div>`
    : page.path === "/contact"
      ? `<div class="support-art"><img src="/assets/website/support.webp" alt="A professional working at a laptop, illustrating the support experience" width="800" height="800" fetchpriority="high"><div class="idea-card">${icon("bulb")}<span>Great ideas.<br><strong>A better BillionTalks.</strong></span></div></div>`
      : meetingPreview(page.path === "/" ? "home" : page.path === "/about" ? "about" : page.path === "/features" ? "features" : "journey");
  const eyebrow = page.path === "/contact" ? "We're here to help" : page.path === "/how-it-works" ? "Get started in minutes" : page.path === "/features" ? "Powerful features. Made simple." : page.path === "/" ? "A free place to connect" : page.path === "/about" ? "About BillionTalks" : "Solutions";
  const actions = page.path === "/contact" ? "" : `<div class="hero-actions">${accountCta(account)}<a class="button secondary" href="${page.path === "/" || page.path === "/how-it-works" ? "/features" : "/how-it-works"}">${page.path === "/" || page.path === "/how-it-works" ? "Explore Features" : "See How It Works"} ${icon("arrow")}</a></div>`;
  const note = page.path === "/" ? `<div class="hero-note">${icon("video")}${icon("mic")}${icon("chat")}<span>Current V1 access is free.<br>For individuals and growing teams.</span></div>` : "";
  const principles = page.path === "/about" ? `<div class="about-principles">${["people", "shield", "spark", "globe"].map((name, i) => `<div>${iconBadge(name)}<strong>${["People first", "Clear controls", "Built for everyone", "Global connection"][i]}</strong></div>`).join("")}</div>` : "";
  const hero = `<section class="hero"><div class="wrap hero-grid"><div class="hero-copy"><p class="eyebrow">${eyebrow}</p><h1>${heading}</h1><p class="lead">${escapeHtml(page.intro)}</p>${actions}${note}${principles}</div>${heroArt}</div></section>`;
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
  <main id="main" tabindex="-1">${body}</main><footer class="site-footer"><div class="wrap"><div class="footer-top"><div><a class="logo" href="/"><img src="/assets/website/logo.png" alt="BillionTalks" width="629" height="190" loading="lazy"></a><p>The meeting doesn't end when the call ends.</p></div><nav class="footer-links" aria-label="Footer">${publicPages.slice(1).map((page) => `<a href="${page.path}">${page.label}</a>`).join("")}<a href="/ui">Join a meeting</a><a href="/contact#privacy">Contact privacy</a></nav></div><div class="footer-bottom"><span>&copy; ${new Date().getUTCFullYear()} BillionTalks. A place for better conversations.</span><span>Product visuals are illustrative, not customer or staff endorsements.</span></div></div></footer><script nonce="${nonce}">(()=>{'use strict';${commonScript}${script}})();</script></body></html>`;
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
