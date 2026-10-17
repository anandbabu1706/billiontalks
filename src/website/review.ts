import type { Account } from "../account/domain";
import { htmlResponse } from "./ui";

export function feedbackReviewPage(account: Account | null): Response {
  return htmlResponse("/admin/feedback", "Feedback review | BillionTalks", "Authorized Contact & Feedback review.", `
  <section class="section wrap"><h1>Contact &amp; Feedback review</h1><p>Access is restricted to explicitly authorized reviewers using a verified BillionTalks account.</p><p><a href="/account#login">Sign in</a> &middot; <a href="/dashboard">Dashboard</a></p>
  <p id="reviewStatus" class="form-status" role="status" aria-live="polite"></p><div id="reviewEntries" class="review-list"></div><div class="form-buttons"><button id="reviewNext" class="button" hidden type="button">Next page</button></div></section>`, account, false, reviewScript);
}

const reviewScript = `
const reviewStatus = document.getElementById('reviewStatus');
const entries = document.getElementById('reviewEntries');
const next = document.getElementById('reviewNext');
let cursor = null;
function node(tag, text) { const element = document.createElement(tag); element.textContent = text; return element; }
async function loadSubmissions() {
  next.disabled = true;
  reviewStatus.classList.remove('error');
  reviewStatus.textContent = 'Loading submissions…';
  try {
    const query = new URLSearchParams({limit:'25'});
    if (cursor) { query.set('before', cursor.before); query.set('beforeId', cursor.beforeId); }
    const response = await fetch('/api/admin/feedback?' + query, {credentials:'same-origin'});
    const result = await response.json();
    if (!response.ok || !Array.isArray(result.submissions)) throw new Error(result.error || 'Unable to load submissions.');
    entries.replaceChildren();
    for (const submission of result.submissions) {
      const entry = node('article', '');
      entry.className = 'card review-entry';
      entry.append(node('h2', submission.category), node('small', 'Reference: ' + submission.id), node('small', submission.createdAt + ' · Expires: ' + submission.expiresAt), node('p', submission.name + ' · ' + submission.email), node('small', submission.accountId ? 'Verified account: ' + submission.accountId : 'Guest submission'), node('p', submission.message));
      if (submission.rating !== null) entry.append(node('p', 'Rating: ' + submission.rating + '/5'));
      if (submission.affectedFeature) entry.append(node('p', 'Affected feature: ' + submission.affectedFeature));
      if (submission.context) entry.append(node('p', submission.context));
      const remove = node('button', 'Delete submission');
      remove.type = 'button';
      remove.className = 'button secondary';
      remove.addEventListener('click', async () => {
        if (!confirm('Permanently delete this submission?')) return;
        remove.disabled = true;
        try {
          const response = await fetch('/api/admin/feedback/' + encodeURIComponent(submission.id), {method:'DELETE', credentials:'same-origin'});
          const result = await response.json();
          if (!response.ok || result.deleted !== true) throw new Error(result.error || 'Unable to delete submission.');
          entry.remove();
          reviewStatus.classList.remove('error');
          reviewStatus.textContent = 'Submission deleted.';
        } catch (failure) { reviewStatus.classList.add('error'); reviewStatus.textContent = failure instanceof Error ? failure.message : 'Unable to delete submission.'; remove.disabled = false; }
      });
      entry.append(remove);
      entries.append(entry);
    }
    cursor = result.nextCursor;
    next.hidden = !cursor;
    reviewStatus.textContent = result.submissions.length ? 'Showing ' + result.submissions.length + ' submissions.' : 'No submissions available.';
  } catch (failure) {
    entries.replaceChildren();
    next.hidden = true;
    reviewStatus.classList.add('error');
    reviewStatus.textContent = failure instanceof Error ? failure.message : 'Unable to load submissions.';
  } finally { next.disabled = false; }
}
next.addEventListener('click', loadSubmissions);
void loadSubmissions();
`;
