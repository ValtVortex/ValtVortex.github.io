const { test, expect } = require('@playwright/test');

const supabaseMock = `
export function createClient() {
  const table = (name) => ({
    select() {
      const query = {
        eq() { return query; },
        order() { return query; },
        limit: async () => ({ data: [], error: null })
      };
      return query;
    },
    insert(row) {
      globalThis.__testSupabaseCalls.push({ table: name, row });
      return { abortSignal: async () => ({ error: null }) };
    },
    update() { return { eq: async () => ({ error: null }) }; },
    delete() { return { eq: async () => ({ error: null }) }; }
  });
  return {
    from: table,
    rpc(name) { globalThis.__testSupabaseCalls.push({ rpc: name }); return Promise.resolve({ data: [{ id: 'test-id', place_name: 'My saved place', category: 'Shop', status: 'pending', created_at: '2026-10-31T00:00:00Z' }], error: null }); },
    auth: {
      getSession: async () => ({ data: { session: globalThis.__testSession || null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
      signInWithOtp: async () => ({ error: null }),
      verifyOtp: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: { id: 'test-user' } } })
    }
  };
}
`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { globalThis.__testSupabaseCalls = []; });
  await page.route('https://esm.sh/**', route => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: supabaseMock
  }));
});

test('visitor account is optional and guest contribution form stays available', async ({ page }) => {
  await page.goto('/community.html');
  await expect(page.locator('#account-panel')).toBeVisible();
  await expect(page.locator('#account-verify-form')).toBeHidden();
  await expect(page.locator('#account-session')).toBeHidden();
  await expect(page.locator('#form')).toBeVisible();
  await expect(page.locator('#send')).toBeEnabled();
});

test('signed-in visitor sees only their own linked place submissions', async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.__testSession = {
      user: {
        id: 'visitor-id',
        email: 'visitor@example.com',
        user_metadata: { display_name: 'Community Visitor' },
        app_metadata: {}
      }
    };
  });
  await page.goto('/community.html');
  await expect(page.locator('#account-welcome')).toContainText('visitor@example.com');
  await expect(page.locator('#my-submissions')).toContainText('My saved place');
  await expect(page.locator('#email')).toHaveValue('visitor@example.com');
  const calls = await page.evaluate(() => globalThis.__testSupabaseCalls);
  expect(calls.some(call => call.rpc === 'my_community_submissions')).toBeTruthy();
});

test('visitor can request a passwordless email sign-in code', async ({ page }) => {
  await page.goto('/community.html');
  await page.locator('#account-email').fill('visitor@example.com');
  await page.locator('#account-send').click();
  await expect(page.locator('#account-status')).toContainText('Code sent');
  await expect(page.locator('#account-verify-form')).toBeVisible();
});

test('place form explains missing required information without sending', async ({ page }) => {
  await page.goto('/community.html');
  await page.locator('#send').click();
  await expect(page.locator('#status')).toContainText('Please complete the required fields');
  expect(await page.evaluate(() => globalThis.__testSupabaseCalls.length)).toBe(0);
});

test('guest can submit a place with optional fields left empty', async ({ page }) => {
  await page.goto('/community.html');
  await page.locator('#name').fill('Test Community Place');
  await page.locator('#category').selectOption({ label: 'Shop' });
  await page.locator('#description').fill('A useful place shared by an automated browser test.');
  await page.locator('#send').click();
  await expect(page.locator('#status')).toContainText('Submitted successfully');
  const calls = await page.evaluate(() => globalThis.__testSupabaseCalls);
  expect(calls).toHaveLength(1);
  expect(calls[0].table).toBe('community_submissions');
  expect(calls[0].row.status).toBe('pending');
  expect(calls[0].row.address).toBeNull();
  expect(calls[0].row.contact_email).toBeNull();
});

test('place honeypot blocks automated spam submissions', async ({ page }) => {
  await page.goto('/community.html');
  await page.locator('#name').fill('Spam Place');
  await page.locator('#category').selectOption({ label: 'Shop' });
  await page.locator('#description').fill('This should be blocked by the hidden spam field.');
  await page.locator('#company_site').evaluate(el => { el.value = 'spam.example'; });
  await page.locator('#send').click();
  await expect(page.locator('#status')).toContainText('blocked by spam protection');
  expect(await page.evaluate(() => globalThis.__testSupabaseCalls.length)).toBe(0);
});

test('feedback form validates required fields before sending', async ({ page }) => {
  await page.goto('/community.html');
  await page.locator('#fb-send').click();
  await expect(page.locator('#fb-status')).toContainText('Please complete the required fields');
  expect(await page.evaluate(() => globalThis.__testSupabaseCalls.length)).toBe(0);
});

test('guest can send feedback without providing optional contact details', async ({ page }) => {
  await page.goto('/community.html');
  await page.locator('#fb-subject').fill('Automated feedback');
  await page.locator('#fb-message').fill('This feedback is sent by a browser test and is not stored in production.');
  await page.locator('#fb-send').click();
  await expect(page.locator('#fb-status')).toContainText('Your feedback has been sent');
  const calls = await page.evaluate(() => globalThis.__testSupabaseCalls);
  expect(calls).toHaveLength(1);
  expect(calls[0].table).toBe('community_feedback');
  expect(calls[0].row.status).toBe('new');
  expect(calls[0].row.contact_email).toBeNull();
});

test('admin dashboard uses the protected moderation endpoint', async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.__testSession = {
      user: {
        id: 'admin-id',
        email: 'admin@example.com',
        app_metadata: { role: 'admin' },
        user_metadata: {}
      }
    };
  });
  await page.goto('/admin.html');
  await expect(page.locator('#dashboard')).toBeVisible();
  await expect(page.locator('#items')).toContainText('My saved place');
  const calls = await page.evaluate(() => globalThis.__testSupabaseCalls);
  expect(calls.some(call => call.rpc === 'admin_list_community_submissions')).toBeTruthy();
});

test('admin page loads without JavaScript syntax errors', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/admin.html');
  await expect(page.locator('#login')).toBeVisible();
  expect(pageErrors).toEqual([]);
});
