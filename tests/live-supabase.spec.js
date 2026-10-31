const { test, expect } = require('@playwright/test');

test('live Supabase guest API exposes approved places only', async ({ request }) => {
  const page = await request.get('/community.html');
  expect(page.ok()).toBeTruthy();
  const html = await page.text();
  const projectUrl = html.match(/createClient\('(https:\/\/[^']+)'/)?.[1];
  const publishableKey = html.match(/createClient\('https:\/\/[^']+','([^']+)'/)?.[1];
  expect(projectUrl).toBe('https://gtortwrmnxyphzceloub.supabase.co');
  expect(publishableKey).toBeTruthy();

  const headers = { apikey: publishableKey, Authorization: `Bearer ${publishableKey}` };
  const approvedResponse = await request.get(
    `${projectUrl}/rest/v1/community_submissions?select=id,status&status=eq.approved&limit=100`,
    { headers }
  );
  expect(approvedResponse.status()).toBe(200);
  const approved = await approvedResponse.json();
  expect(Array.isArray(approved)).toBeTruthy();
  expect(approved.every(row => row.status === 'approved')).toBeTruthy();

  const pendingResponse = await request.get(
    `${projectUrl}/rest/v1/community_submissions?select=id,status&status=eq.pending&limit=100`,
    { headers }
  );
  expect(pendingResponse.status()).toBe(200);
  expect(await pendingResponse.json()).toEqual([]);

  const privateFeedbackResponse = await request.get(
    `${projectUrl}/rest/v1/community_feedback?select=id&limit=1`,
    { headers }
  );
  expect([401, 403]).toContain(privateFeedbackResponse.status());
});
