import type { Account } from "../account/domain";
import { FEEDBACK_CATEGORIES } from "../feedback/api";
import { escapeHtml } from "./html";

const topicDescriptions = [
  "Ask a question about BillionTalks.",
  "Get help with a feature or your workspace.",
  "Share an idea for a better experience.",
  "Start a conversation about working together.",
  "Tell us what worked well and what could be better.",
  "Describe a problem so we can understand it.",
];

export function contactForm(account: Account | null): string {
  const categories = Object.entries(FEEDBACK_CATEGORIES);
  return `<section class="section wrap"><noscript><p class="legal-notice">Please enable JavaScript to choose a topic and submit the contact form. Your message is not sent until the service confirms receipt.</p></noscript><div class="cards" id="contactTopics" aria-label="Choose a contact topic">${categories.map(([value, label], index) =>
    `<button class="card topic-card" type="button" data-topic="${escapeHtml(value)}" aria-controls="feedbackPanel" aria-pressed="false"><span class="icon-box" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(label)}</strong><span>${topicDescriptions[index]}</span></button>`,
  ).join("")}</div>
  <section id="feedbackPanel" class="card feedback-panel" aria-labelledby="feedbackHeading" hidden><header><h2 id="feedbackHeading" tabindex="-1">Let's hear from you</h2><p>${account ? "Your registered name and verified email are prefilled. You can edit them for this message without changing your account." : "Share the details below. You do not need an account to contact us."}</p></header>
  <form id="contactForm"><div class="form-grid">
  <label class="field wide" for="contactCategory">Topic<select id="contactCategory" name="category" required>${categories.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("")}</select></label>
  <label class="field" for="contactName">Name<input id="contactName" name="name" autocomplete="name" maxlength="100" value="${escapeHtml(account?.fullName ?? "")}" required></label>
  <label class="field" for="contactEmail">Email<input id="contactEmail" name="email" type="email" autocomplete="email" maxlength="254" value="${escapeHtml(account?.email ?? "")}" required></label>
  <fieldset id="feedbackRating" class="wide" hidden><legend>How was your experience? <span class="hint">(optional)</span></legend><div class="rating">${[1, 2, 3, 4, 5].map((value) => `<label><input type="radio" name="rating" value="${value}">${value}<span class="hint">${value === 1 ? "Low" : value === 5 ? "High" : ""}</span></label>`).join("")}<label><input type="radio" name="rating" value="" checked>No rating</label></div></fieldset>
  <div id="issueDetails" class="wide" hidden><label class="field" for="affectedFeature">Affected feature<select id="affectedFeature" name="affectedFeature"><option value="">Choose a feature</option><option>Account</option><option>Dashboard</option><option>Meetings</option><option>Scheduling</option><option>Calendar</option><option>Contacts and invitations</option><option>Notifications</option><option>Website</option><option>Other</option></select></label></div>
  <label class="field wide" for="contactMessage"><span id="messageLabel">Message</span><textarea id="contactMessage" name="message" maxlength="5000" minlength="10" rows="6" aria-describedby="messageHint" required></textarea><span class="hint" id="messageHint">Please include enough detail to help us understand. Do not include passwords, private meeting content or other sensitive information.</span></label>
  <label class="field wide" id="contextField" for="contactContext" hidden>Steps to reproduce or context <span class="hint">(optional)</span><textarea id="contactContext" name="context" maxlength="2000" rows="3"></textarea></label>
  </div><div class="honey" aria-hidden="true"><label>Leave this field empty<input name="website" tabindex="-1" autocomplete="off" maxlength="200"></label></div>
  <p class="privacy-copy">We use your name, email and message to review and respond to your request. Signed-in submissions are associated with your account, even if you edit the contact email. ${account ? "" : "Abuse protection uses a short-lived hashed IP/session identifier. "}No private meeting content is automatically collected. <a href="#privacy">Read the contact privacy notice</a>.</p>
  <div class="form-buttons"><button id="contactSubmit" class="button" type="submit">Send Message</button><button id="changeTopic" class="button secondary" type="button">Choose another topic</button></div>
  <p id="contactStatus" class="form-status" role="status" aria-live="polite" tabindex="-1"></p></form></section>
  <aside id="privacy" class="text-section section" aria-labelledby="contactPrivacyHeading"><h2 id="contactPrivacyHeading">Your message. Your information.</h2><p class="privacy-copy">Only authorized reviewers can access submissions. Contact details and message content are available for up to 90 days, after which they expire from review and are deleted during service cleanup. Abuse-protection hashes expire after one day. Cleanup runs when the service handles requests; deletion from inactive storage can occur later. Avoid sharing confidential information. To request earlier removal, choose General Enquiries and include your message reference; we may need to verify the request.</p><p class="privacy-copy">You can submit without creating an account. This notice covers Contact &amp; Feedback only; it does not make additional claims about meeting-data retention or response times.</p></aside></section>`;
}

export const contactScript = `
const contactForm = document.getElementById('contactForm');
const category = document.getElementById('contactCategory');
const panel = document.getElementById('feedbackPanel');
const topics = [...document.querySelectorAll('[data-topic]')];
const rating = document.getElementById('feedbackRating');
const issue = document.getElementById('issueDetails');
const context = document.getElementById('contextField');
const contactStatus = document.getElementById('contactStatus');
function syncTopic() {
  const feedback = category.value === 'feedback';
  const report = category.value === 'report-issue';
  rating.hidden = !feedback;
  rating.disabled = !feedback;
  issue.hidden = !report;
  context.hidden = !report;
  document.getElementById('affectedFeature').required = report;
  document.getElementById('affectedFeature').disabled = !report;
  document.getElementById('contactContext').disabled = !report;
  document.getElementById('messageLabel').textContent = feedback ? 'What worked well? What could be better?' : report ? 'What happened?' : 'Message';
  topics.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.topic === category.value)));
}
topics.forEach(button => button.addEventListener('click', () => {
  category.value = button.dataset.topic;
  panel.hidden = false;
  syncTopic();
  document.getElementById('feedbackHeading').focus();
  panel.scrollIntoView({block:'start', behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
}));
category.addEventListener('change', syncTopic);
document.getElementById('changeTopic').addEventListener('click', () => {
  panel.hidden = true;
  const selected = topics.find(button => button.dataset.topic === category.value);
  topics.forEach(button => button.setAttribute('aria-pressed', 'false'));
  (selected || topics[0]).focus();
});
contactForm.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = document.getElementById('contactSubmit');
  if (submit.disabled) return;
  if (!contactForm.reportValidity()) return;
  const fields = new FormData(contactForm);
  const body = {category:category.value, name:fields.get('name'), email:fields.get('email'), message:fields.get('message'), website:fields.get('website')};
  if (category.value === 'feedback' && fields.get('rating')) body.rating = Number(fields.get('rating'));
  if (category.value === 'report-issue') {
    body.affectedFeature = fields.get('affectedFeature');
    const details = String(fields.get('context') || '').trim();
    if (details) body.context = details;
  }
  submit.disabled = true;
  submit.textContent = 'Sending…';
  contactForm.setAttribute('aria-busy', 'true');
  contactStatus.textContent = '';
  contactStatus.classList.remove('error');
  try {
    const response = await fetch('/api/feedback', {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    const result = await response.json();
    const reference = result.referenceId;
    if (!response.ok || !reference) throw new Error(result.error || "We couldn't submit your message. Please try again.");
    contactStatus.textContent = 'Thank you. Your message has been received. Reference: ' + reference;
    contactForm.elements.message.value = '';
    contactForm.elements.context.value = '';
    contactForm.querySelector('input[name="rating"][value=""]').checked = true;
    contactStatus.focus();
  } catch (failure) {
    contactStatus.classList.add('error');
    contactStatus.textContent = "We couldn't submit your message. Please try again." + (failure instanceof Error && failure.message !== "We couldn't submit your message. Please try again." ? ' ' + failure.message : '');
    contactStatus.focus();
  } finally {
    submit.disabled = false;
    submit.textContent = 'Send Message';
    contactForm.setAttribute('aria-busy', 'false');
  }
});
syncTopic();
`;
