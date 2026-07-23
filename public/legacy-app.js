// ══════════════════════════════════
  //  GLOBAL ERROR HANDLER
  // ══════════════════════════════════
  window.onerror = function(msg, url, line) {
    console.error('Global error:', msg, 'line:', line);
    window.BuildersCore?.reportError(new Error(String(msg)), { url, line });
    const el = document.getElementById('authError');
    if (el) { el.style.display = ''; el.textContent = 'JS Error (line ' + line + '): ' + msg; }
    return false;
  };

  // ══════════════════════════════════
  //  SUPABASE CLIENT
  // ══════════════════════════════════
  const SUPABASE_URL = 'https://tlsyajmdxyyainyabakt.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_bWJWgAcBCxjTLKhXredtDA_W8kXadxI';

  if (!window.supabase) {
    document.body.innerHTML = '<div style="padding:40px;text-align:center;font-family:sans-serif;"><h2>Failed to load Supabase SDK</h2><p>Check your internet connection and refresh.</p></div>';
    throw new Error('Supabase SDK not loaded');
  }

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  let currentUser = null;
  let _profileCache = null;
  const testerCodeFromUrl = new URLSearchParams(window.location.search).get('tester');
  if (testerCodeFromUrl) sessionStorage.setItem('builders_tester_code', testerCodeFromUrl);
  let _stripePayUrl = ''; // Used by buildInvoiceHtml for Stripe pay button
  let _repositories = null;

  function toCents(value) {
    if (window.BuildersCore?.money) return window.BuildersCore.money.toCents(value);
    const amount = Number(String(value ?? 0).replace(/[$,\s]/g, ''));
    return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
  }

  function getRepositories() {
    if (!_repositories && window.BuildersCore?.createRepositories) {
      _repositories = window.BuildersCore.createRepositories(sb, () => currentUser);
    }
    return _repositories;
  }

  async function authFetch(url, options = {}) {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Your session expired. Please log in again.');
    return fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });
  }

  // EmailJS
  try { emailjs.init('PcnA2CmC9QK_bs_bw'); } catch(e) { console.warn('EmailJS not loaded:', e); }

  // ══════════════════════════════════
  //  FREE TIER GATING
  // ══════════════════════════════════
  const FREE_QUOTE_LIMIT = 3;

  function getUserTier() {
    const p = _profileCache;
    if (p?.tester_tier === 'business' && p.tester_access_expires_at && new Date(p.tester_access_expires_at).getTime() > Date.now()) {
      return 'business';
    }
    return p?.subscription_tier || 'free';
  }

  function updateTesterAccessUI() {
    const status = document.getElementById('testerAccessStatus');
    const input = document.getElementById('testerAccessCode');
    const button = document.getElementById('testerAccessBtn');
    if (!status) return;
    const expiresAt = _profileCache?.tester_access_expires_at;
    const active = _profileCache?.tester_tier === 'business' && expiresAt && new Date(expiresAt).getTime() > Date.now();
    if (active) {
      const days = Math.max(1, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000));
      status.textContent = `Business tester access is active for ${days} more day${days === 1 ? '' : 's'} (until ${new Date(expiresAt).toLocaleDateString()}).`;
      if (input) input.style.display = 'none';
      if (button) button.style.display = 'none';
    } else if (expiresAt) {
      status.textContent = 'Your tester access has ended. Your regular plan is now active.';
      if (input) input.style.display = 'none';
      if (button) button.style.display = 'none';
    }
  }

  function showTesterAccessModal() {
    if (_profileCache?.tester_access_expires_at || _profileCache?.subscription_tier === 'business') return;
    const modal = document.getElementById('testerAccessModal');
    const input = document.getElementById('testerModalCode');
    const pendingCode = sessionStorage.getItem('builders_tester_code') || '';
    if (input && pendingCode) input.value = pendingCode;
    if (modal) modal.style.display = 'flex';
    setTimeout(() => input?.focus(), 50);
  }

  function closeTesterAccessModal() {
    const modal = document.getElementById('testerAccessModal');
    if (modal) modal.style.display = 'none';
  }

  async function redeemTesterAccess(codeOverride) {
    const input = document.getElementById('testerAccessCode');
    const button = document.getElementById('testerAccessBtn');
    const status = document.getElementById('testerAccessStatus');
    const modalInput = document.getElementById('testerModalCode');
    const modalButton = document.getElementById('testerModalActivateBtn');
    const modalStatus = document.getElementById('testerModalStatus');
    const code = String(codeOverride || modalInput?.value || input?.value || sessionStorage.getItem('builders_tester_code') || '').trim();
    if (!code) {
      if (status) status.textContent = 'Enter your tester access code.';
      if (modalStatus) { modalStatus.style.display = ''; modalStatus.textContent = 'Enter your tester access code.'; }
      return;
    }
    if (button) { button.disabled = true; button.textContent = 'Activating…'; }
    if (modalButton) { modalButton.disabled = true; modalButton.textContent = 'Activating…'; }
    if (modalStatus) modalStatus.style.display = 'none';
    try {
      const response = await authFetch('/api/redeem-tester-access', { method: 'POST', body: JSON.stringify({ code }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not activate tester access');
      sessionStorage.removeItem('builders_tester_code');
      _profileCache = null;
      await dbGetProfile(true);
      updateTierUI();
      updateTesterAccessUI();
      closeTesterAccessModal();
      if (window.location.search.includes('tester=')) window.history.replaceState({}, '', window.location.pathname);
      showToast(result.already_redeemed ? 'Tester access is already active' : '60 days of Business access activated!');
    } catch (error) {
      if (status) status.textContent = error.message || 'Could not activate tester access.';
      if (modalStatus) { modalStatus.style.display = ''; modalStatus.textContent = error.message || 'Could not activate tester access.'; }
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Activate'; }
      if (modalButton) { modalButton.disabled = false; modalButton.textContent = 'Activate 60-Day Business Access'; }
    }
  }

  function isFree() { return getUserTier() === 'free'; }

  // Quota: auto-resets if month has changed
  function getQuotasThisMonth() {
    const p = _profileCache;
    if (!p) return 0;
    const currentMonth = new Date().toISOString().slice(0, 7); // "2026-04"
    if (p.quota_reset_month !== currentMonth) {
      // Month rolled over — update the UI cache; the database trigger resets atomically.
      p.quotes_this_month = 0;
      p.quota_reset_month = currentMonth;
    }
    return p.quotes_this_month || 0;
  }

  function hasQuoteQuota() {
    if (!isFree()) return true;
    return getQuotasThisMonth() < FREE_QUOTE_LIMIT;
  }

  // Upgrade prompt — shows a toast-style banner
  let _upgradeTargetTier = 'pro';

  function showUpgradePrompt(message, targetTier) {
    const banner = document.getElementById('upgradeBanner');
    if (!banner) return;
    _upgradeTargetTier = targetTier || 'pro';
    document.getElementById('upgradeBannerMsg').innerHTML = message;
    const btn = document.getElementById('upgradeBannerBtn');
    if (btn) btn.textContent = _upgradeTargetTier === 'business' ? 'Go Business →' : 'Go Pro →';
    banner.classList.add('show');
    clearTimeout(banner._timer);
    banner._timer = setTimeout(() => banner.classList.remove('show'), 8000);
  }

  // Update nav plan badge
  function updateTierUI() {
    const tier = getUserTier();
    const label = document.getElementById('navPlanLabel');
    if (label) {
      const names = { free: 'Free Plan', pro: 'Pro Plan', business: 'Business Plan' };
      label.textContent = names[tier] || 'Free Plan';
      label.style.color = tier === 'free' ? 'rgba(255,255,255,0.3)' : (tier === 'pro' ? '#E07A2F' : '#6ee7b7');
    }
  }

  // ══════════════════════════════════
  //  SHARED DOCUMENT VIEWER
  // ══════════════════════════════════
  function sanitizeDocumentHtml(html) {
    const parsed = new DOMParser().parseFromString(String(html || ''), 'text/html');
    parsed.querySelectorAll('script, iframe, object, embed, form, input, button, textarea, select, meta, base, link').forEach(el => el.remove());
    parsed.querySelectorAll('*').forEach(el => {
      Array.from(el.attributes).forEach(attr => {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim().toLowerCase();
        if (name.startsWith('on') || name === 'srcdoc') el.removeAttribute(attr.name);
        if ((name === 'href' || name === 'src' || name === 'xlink:href') && /^(javascript|data:text\/html):/.test(value)) {
          el.removeAttribute(attr.name);
        }
      });
      if (el.tagName === 'A') el.setAttribute('rel', 'noopener noreferrer');
    });
    return parsed.body.innerHTML;
  }

  // Check synchronously FIRST so auth listener doesn't interfere
  const __docId = new URLSearchParams(window.location.search).get('doc');
  if (__docId) {
    window.__isDocViewer = true;
    // Hide everything immediately
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('authPage').style.display = 'none';
    document.getElementById('appShell').style.display = 'none';
    document.getElementById('onboardingPage').style.display = 'none';
    document.body.style.background = '#fff';

    // Create viewer
    const viewer = document.createElement('div');
    viewer.id = 'docViewer';
    viewer.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;overflow-y:auto;';
    viewer.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;color:#6B7280;">Loading document…</div>';
    document.body.appendChild(viewer);

    // Fetch document async
    (async () => {
      try {
        const response = await fetch('/api/shared-document?id=' + encodeURIComponent(__docId));
        const data = response.ok ? await response.json() : null;
        if (!data) {
          viewer.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;"><div style="font-size:48px;margin-bottom:16px;">📄</div><div style="font-size:18px;font-weight:600;color:#1C1C1E;">Document not found</div><div style="font-size:14px;color:#6B7280;margin-top:8px;">This link may have expired or been removed.</div></div>';
          return;
        }
        const docType = data.doc_type === 'invoice' ? 'Invoice' : 'Quote';
        viewer.innerHTML = `
          <div class="no-print" style="background:#1C1C1E;padding:12px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100;">
            <span style="font-family:'Plus Jakarta Sans',sans-serif;color:white;font-size:14px;font-weight:600;">Builders<span style="color:#E07A2F;">Invoice</span> <span style="color:rgba(255,255,255,0.4);font-weight:400;margin-left:8px;">${docType}</span></span>
            <button onclick="window.print()" style="padding:8px 20px;background:#E07A2F;color:white;border:none;border-radius:6px;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer;">Save as PDF</button>
          </div>
          <div style="max-width:900px;margin:0 auto;background:white;min-height:calc(100vh - 48px);">${sanitizeDocumentHtml(data.html_content)}</div>
        `;
      } catch(e) {
        console.error('Doc fetch error:', e);
        viewer.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;color:#C0392B;">Error loading document.</div>';
      }
    })();
  }

  // ══════════════════════════════════
  //  PAYMENT SUCCESS/CANCEL PAGE (client returns from Stripe)
  // ══════════════════════════════════
  const __paymentStatus = new URLSearchParams(window.location.search).get('payment');
  if (__paymentStatus && !__docId) {
    window.__isDocViewer = true;
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('authPage').style.display = 'none';
    document.getElementById('appShell').style.display = 'none';
    document.getElementById('onboardingPage').style.display = 'none';
    document.body.style.background = '#fff';

    const viewer = document.createElement('div');
    viewer.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;display:flex;align-items:center;justify-content:center;';

    if (__paymentStatus === 'success') {
      viewer.innerHTML = `
        <div style="text-align:center;font-family:'DM Sans',sans-serif;padding:40px;">
          <div style="font-size:64px;margin-bottom:16px;">✅</div>
          <h2 style="font-family:'Plus Jakarta Sans',sans-serif;font-size:28px;font-weight:800;color:#1C1C1E;margin-bottom:8px;">Payment Successful!</h2>
          <p style="font-size:16px;color:#6B7280;margin-bottom:24px;">Thank you — your payment has been received.</p>
          <p style="font-size:13px;color:#6B7280;">You can close this page.</p>
        </div>`;
    } else {
      viewer.innerHTML = `
        <div style="text-align:center;font-family:'DM Sans',sans-serif;padding:40px;">
          <div style="font-size:64px;margin-bottom:16px;">↩️</div>
          <h2 style="font-family:'Plus Jakarta Sans',sans-serif;font-size:28px;font-weight:800;color:#1C1C1E;margin-bottom:8px;">Payment Cancelled</h2>
          <p style="font-size:16px;color:#6B7280;margin-bottom:24px;">No charge was made. You can try again from the invoice link.</p>
        </div>`;
    }
    document.body.appendChild(viewer);
  }

  // ══════════════════════════════════
  //  AUTH
  // ══════════════════════════════════
  let authMode = 'login';

  function switchAuthTab(mode) {
    authMode = mode;
    document.querySelectorAll('.auth-tab').forEach((t,i) => t.classList.toggle('active', (i===0&&mode==='login')||(i===1&&mode==='signup')));
    document.getElementById('authNameField').style.display = mode === 'signup' ? '' : 'none';
    document.getElementById('authSubmitBtn').textContent = mode === 'login' ? 'Log In' : 'Sign Up';
    document.getElementById('forgotLink').style.display = mode === 'login' ? '' : 'none';
    document.getElementById('authError').style.display = 'none';
  }

  function showAuthError(msg) {
    const el = document.getElementById('authError');
    el.textContent = msg; el.style.display = '';
  }

  async function handleAuth() {
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    if (!email || !password) { showAuthError('Email and password required.'); return; }
    if (password.length < 6) { showAuthError('Password must be at least 6 characters.'); return; }

    const btn = document.getElementById('authSubmitBtn');
    btn.disabled = true; btn.textContent = authMode === 'login' ? 'Logging in…' : 'Creating account…';

    // Safety timeout — reset button after 10s no matter what
    const safetyTimer = setTimeout(() => {
      btn.disabled = false;
      btn.textContent = authMode === 'login' ? 'Log In' : 'Sign Up';
    }, 10000);

    try {
      let result;
      if (authMode === 'signup') {
        const name = document.getElementById('authName').value.trim();
        result = await sb.auth.signUp({ email, password, options: { data: { full_name: name } } });
      } else {
        result = await sb.auth.signInWithPassword({ email, password });
      }

      console.log('Auth result:', result);
      clearTimeout(safetyTimer);

      if (result.error) {
        showAuthError(result.error.message);
        btn.disabled = false; btn.textContent = authMode === 'login' ? 'Log In' : 'Sign Up';
        return;
      }

      if (authMode === 'signup') {
        if (result.data.session) {
          // Auto-confirmed — go directly to onboarding
          currentUser = result.data.session.user;
          btn.textContent = 'Success! Loading…';
          showOnboarding();
        } else if (result.data.user && !result.data.session) {
          // Needs email confirmation — show confirmation screen
          document.getElementById('confirmEmailAddr').textContent = email;
          document.getElementById('authMainView').style.display = 'none';
          document.getElementById('authConfirmView').style.display = '';
          btn.disabled = false; btn.textContent = 'Sign Up';
        } else {
          showAuthError('This email may already be registered. Try logging in instead.');
          btn.disabled = false; btn.textContent = 'Sign Up';
        }
        return;
      }

      // Login success — go directly to app
      currentUser = result.data.session.user;
      btn.textContent = 'Success! Loading…';
      initApp(result.data.session);
    } catch(e) {
      clearTimeout(safetyTimer);
      console.error('Auth error:', e);
      showAuthError(e.message || 'Something went wrong.');
      btn.disabled = false; btn.textContent = authMode === 'login' ? 'Log In' : 'Sign Up';
    }
  }

  async function handleGoogleAuth() {
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + window.location.pathname } });
    if (error) showAuthError(error.message);
  }

  // ── Forgot Password ──
  function showForgotPassword() {
    document.getElementById('authMainView').style.display = 'none';
    document.getElementById('authConfirmView').style.display = 'none';
    document.getElementById('authResetView').style.display = 'none';
    document.getElementById('authForgotView').style.display = '';
    document.getElementById('forgotEmail').value = document.getElementById('authEmail').value || '';
    document.getElementById('forgotError').style.display = 'none';
  }

  function backToLogin() {
    document.getElementById('authMainView').style.display = '';
    document.getElementById('authConfirmView').style.display = 'none';
    document.getElementById('authForgotView').style.display = 'none';
    document.getElementById('authResetView').style.display = 'none';
    switchAuthTab('login');
  }

  // ── Forgot Password (Supabase-managed recovery) ──
  async function sendResetCode() {
    const email = document.getElementById('forgotEmail').value.trim();
    const errEl = document.getElementById('forgotError');
    if (!email) {
      errEl.style.display = '';
      errEl.style.background = 'var(--red-pale)';
      errEl.style.color = 'var(--red)';
      errEl.textContent = 'Please enter your email.';
      return;
    }

    const btn = document.getElementById('forgotSubmitBtn');
    btn.disabled = true; btn.textContent = 'Sending…';
    errEl.style.display = 'none';

    try {
      const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname + '?reset=true'
      });
      if (error) throw error;

      errEl.style.display = '';
      errEl.style.background = 'var(--green-pale)';
      errEl.style.color = 'var(--green)';
      errEl.textContent = 'Check your email for a secure password-reset link.';
      btn.textContent = 'Email Sent';

    } catch(e) {
      console.error('Password reset error:', e);
      errEl.style.display = '';
      errEl.style.background = 'var(--red-pale)';
      errEl.style.color = 'var(--red)';
      errEl.textContent = 'Failed to send reset link: ' + (e.text || e.message || 'Try again.');
    } finally {
      btn.disabled = false;
      if (btn.textContent !== 'Email Sent') btn.textContent = 'Send Reset Link';
    }
  }

  async function submitNewPassword() {
    const pw = document.getElementById('resetPassword').value;
    const pw2 = document.getElementById('resetPasswordConfirm').value;
    const errEl = document.getElementById('resetError');
    errEl.style.display = 'none';

    if (!pw || pw.length < 6) {
      errEl.style.display = '';
      errEl.style.background = 'var(--red-pale)';
      errEl.style.color = 'var(--red)';
      errEl.textContent = 'Password must be at least 6 characters.';
      return;
    }
    if (pw !== pw2) {
      errEl.style.display = '';
      errEl.style.background = 'var(--red-pale)';
      errEl.style.color = 'var(--red)';
      errEl.textContent = 'Passwords do not match.';
      return;
    }

    const btn = document.getElementById('resetSubmitBtn');
    btn.disabled = true; btn.textContent = 'Updating…';

    try {
      const { error } = await sb.auth.updateUser({ password: pw });

      if (error) {
        errEl.style.display = '';
        errEl.style.background = 'var(--red-pale)';
        errEl.style.color = 'var(--red)';
        errEl.textContent = error.message || 'Failed to update password. The recovery link may have expired.';
        btn.disabled = false; btn.textContent = 'Update Password';
        return;
      }

      // Success!
      errEl.style.display = '';
      errEl.style.background = 'var(--green-pale)';
      errEl.style.color = 'var(--green)';
      errEl.textContent = '✓ Password updated! You can now log in.';
      btn.textContent = 'Done!';
      setTimeout(async () => {
        await sb.auth.signOut();
        backToLogin();
      }, 2000);

    } catch(e) {
      console.error('Password update error:', e);
      errEl.style.display = '';
      errEl.style.background = 'var(--red-pale)';
      errEl.style.color = 'var(--red)';
      errEl.textContent = e.message || 'Something went wrong.';
      btn.disabled = false; btn.textContent = 'Update Password';
    }
  }

  async function handleLogout() {
    await sb.auth.signOut();
    currentUser = null;
    _profileCache = null;
    appInitialized = false;
    initInProgress = false;
    document.getElementById('appShell').style.display = 'none';
    document.getElementById('onboardingPage').style.display = 'none';
    document.getElementById('authPage').style.display = 'flex';
  }

  // ══════════════════════════════════
  //  SUPABASE DATA LAYER
  // ══════════════════════════════════
  async function dbGetProfile(forceRefresh) {
    if (_profileCache && !forceRefresh) return _profileCache;
    try {
      const { data, error } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
      if (error) {
        if (error.code === 'PGRST116') {
          await sb.from('profiles').insert({ id: currentUser.id });
          _profileCache = { id: currentUser.id };
          return _profileCache;
        }
        console.warn('Profile fetch error:', error);
        return null;
      }
      _profileCache = data;
      return data;
    } catch(e) { console.warn('dbGetProfile error:', e); return null; }
  }

  async function dbSaveProfile(profile) {
    _profileCache = { ...(_profileCache || {}), id: currentUser.id, ...profile };
    await sb.from('profiles').upsert({ id: currentUser.id, ...profile, updated_at: new Date().toISOString() });
  }

  async function dbGetClients() {
    const { data } = await sb.from('clients').select('*').eq('user_id', currentUser.id).order('name');
    return data || [];
  }

  async function dbSaveClient(client) {
    const payload = { ...client, user_id: currentUser.id };
    if (client.id) {
      await sb.from('clients').upsert(payload);
    } else {
      const { data } = await sb.from('clients').insert(payload).select().single();
      return data;
    }
    return payload;
  }

  async function dbDeleteClient(id) {
    await sb.from('clients').delete().eq('id', id);
  }

  async function dbGetQuotes() {
    const { data: quotes } = await sb.from('quotes').select('*').eq('user_id', currentUser.id).order('updated_at', { ascending: false });
    // Also fetch items for each quote
    if (quotes && quotes.length > 0) {
      const ids = quotes.map(q => q.id);
      const { data: items } = await sb.from('quote_items').select('*').in('quote_id', ids).order('sort_order');
      quotes.forEach(q => { q.items = (items || []).filter(i => i.quote_id === q.id); });
    }
    return quotes || [];
  }

  async function dbSaveQuote(quote, items) {
    let clientId = quote.clientId || _clientsCache.find(c => c.name === quote.clientName)?.id || null;
    if (!clientId && quote.clientName) {
      const savedClient = await dbSaveClient({ name: quote.clientName, phone: quote.clientPhone, email: quote.clientEmail, address: quote.jobAddress });
      clientId = savedClient?.id || null;
      await refreshClients();
    }
    const payload = {
      user_id: currentUser.id,
      quote_num: quote.quoteNum,
      status: quote.status,
      date: quote.date || null,
      valid_days: parseInt(quote.validFor) || 30,
      job_desc: quote.jobDesc,
      client_name: quote.clientName,
      client_phone: quote.clientPhone,
      client_email: quote.clientEmail,
      job_address: quote.jobAddress,
      biz_name: quote.bizName,
      biz_phone: quote.bizPhone,
      biz_email: quote.bizEmail,
      biz_address: quote.bizAddress,
      biz_license: quote.bizLicense,
      notes: quote.notes,
      tax_enabled: quote.taxEnabled,
      tax_rate: parseFloat(quote.taxRate) || 0,
      subtotal: parseFloat(quote.subtotal?.replace(/[$,]/g,'')) || 0,
      total: parseFloat(quote.total?.replace(/[$,]/g,'')) || 0,
      overhead_percent: parseFloat(quote.overheadPercent) || 0,
      overhead_visible: quote.overheadVisible || false,
      client_id: clientId,
      subtotal_cents: toCents(quote.subtotal),
      overhead_cents: toCents(document.getElementById('opDisplay')?.textContent),
      tax_cents: toCents(document.getElementById('taxDisplay')?.textContent),
      total_cents: toCents(quote.total),
    };

    const itemRows = (items || []).map((item, i) => {
      const rate = parseFloat(item.rate) || 0;
      const clientRate = parseFloat(item.clientRate) || rate;
      const amount = (parseFloat(item.qty) || 0) * clientRate;
      return {
        sort_order: i, description: item.desc, unit: item.unit, qty: parseFloat(item.qty) || 0,
        rate, amount, source_name: item.source || null, note: item.note || '', line_type: item.lineType || 'material',
        markup_enabled: item.markupEnabled || false, markup_mode: item.markupMode || 'percent',
        markup_value: parseFloat(item.markupValue) || 0, client_rate: clientRate,
        rate_cents: toCents(rate), client_rate_cents: toCents(clientRate), amount_cents: toCents(amount),
      };
    });

    if (quote.id && typeof quote.id === 'string' && quote.id.includes('-')) payload.id = quote.id;
    const repositories = getRepositories();
    if (repositories) {
      try { return await repositories.quotes.save(payload, itemRows); }
      catch (error) { if (error.code !== 'PGRST202') throw error; }
    }

    let quoteId;
    if (quote.id && typeof quote.id === 'string' && quote.id.includes('-')) {
      // Existing UUID — update
      payload.id = quote.id;
      const { error } = await sb.from('quotes').upsert(payload);
      if (error) throw error;
      quoteId = quote.id;
    } else {
      // New quote
      const { data, error } = await sb.from('quotes').insert(payload).select().single();
      if (error) throw error;
      quoteId = data.id;
    }

    // Delete old items and re-insert
    const { error: deleteItemsError } = await sb.from('quote_items').delete().eq('quote_id', quoteId);
    if (deleteItemsError) throw deleteItemsError;
    if (items && items.length > 0) {
      const legacyItemRows = items.map((item, i) => ({
        quote_id: quoteId,
        sort_order: i,
        description: item.desc,
        unit: item.unit,
        qty: parseFloat(item.qty) || 0,
        rate: parseFloat(item.rate) || 0,
        amount: (parseFloat(item.qty) || 0) * (parseFloat(item.clientRate) || parseFloat(item.rate) || 0),
        source_name: item.source || null,
        note: item.note || '',
        line_type: item.lineType || 'material',
        markup_enabled: item.markupEnabled || false,
        markup_mode: item.markupMode || 'percent',
        markup_value: parseFloat(item.markupValue) || 0,
        client_rate: parseFloat(item.clientRate) || parseFloat(item.rate) || 0,
      }));
      const { error: itemError } = await sb.from('quote_items').insert(legacyItemRows);
      if (itemError) throw itemError;
    }

    return quoteId;
  }

  async function dbDeleteQuote(id) {
    await sb.from('quotes').delete().eq('id', id);
  }

  async function dbGetInvoices() {
    const { data: invoices } = await sb.from('invoices').select('*').eq('user_id', currentUser.id).order('updated_at', { ascending: false });
    if (invoices && invoices.length > 0) {
      const ids = invoices.map(i => i.id);
      const { data: items } = await sb.from('invoice_items').select('*').in('invoice_id', ids).order('sort_order');
      invoices.forEach(inv => { inv.items = (items || []).filter(i => i.invoice_id === inv.id); });
    }
    return invoices || [];
  }

  async function dbSaveInvoice(invoice, items) {
    let clientId = invoice.clientId || _clientsCache.find(c => c.name === invoice.clientName)?.id || null;
    if (!clientId && invoice.clientName) {
      const savedClient = await dbSaveClient({ name: invoice.clientName, phone: invoice.clientPhone, email: invoice.clientEmail, address: invoice.jobAddress });
      clientId = savedClient?.id || null;
      await refreshClients();
    }
    const payload = {
      user_id: currentUser.id,
      invoice_num: invoice.invoiceNum,
      status: invoice.status,
      date: invoice.date || null,
      due_days: parseInt(invoice.dueIn) || 30,
      due_date: invoice.dueDate || null,
      job_desc: invoice.jobDesc,
      client_name: invoice.clientName,
      client_phone: invoice.clientPhone,
      client_email: invoice.clientEmail,
      job_address: invoice.jobAddress,
      biz_name: invoice.bizName,
      biz_phone: invoice.bizPhone,
      biz_email: invoice.bizEmail,
      biz_address: invoice.bizAddress,
      notes: invoice.notes,
      tax_enabled: invoice.taxEnabled,
      tax_rate: parseFloat(invoice.taxRate) || 0,
      subtotal: parseFloat(invoice.subtotal?.replace(/[$,]/g,'')) || 0,
      total: parseFloat(invoice.total?.replace(/[$,]/g,'')) || 0,
      from_quote_id: invoice.fromQuoteId || null,
      from_quote_num: invoice.fromQuoteNum || null,
      overhead_percent: parseFloat(invoice.overheadPercent) || 0,
      overhead_visible: invoice.overheadVisible || false,
      client_id: clientId,
      subtotal_cents: toCents(invoice.subtotal),
      overhead_cents: toCents(document.getElementById('invOpDisplay')?.textContent),
      tax_cents: toCents(document.getElementById('invTaxDisplay')?.textContent),
      total_cents: toCents(invoice.total),
    };

    const itemRows = (items || []).map((item, i) => {
      const rate = parseFloat(item.rate) || 0;
      const clientRate = parseFloat(item.clientRate) || rate;
      const amount = (parseFloat(item.qty) || 0) * clientRate;
      return {
        sort_order: i, description: item.desc, unit: item.unit, qty: parseFloat(item.qty) || 0,
        rate, amount, source_name: item.source || null, note: item.note || '', line_type: item.lineType || 'material',
        markup_enabled: item.markupEnabled || false, markup_mode: item.markupMode || 'percent',
        markup_value: parseFloat(item.markupValue) || 0, client_rate: clientRate,
        rate_cents: toCents(rate), client_rate_cents: toCents(clientRate), amount_cents: toCents(amount),
      };
    });

    if (invoice.id && typeof invoice.id === 'string' && invoice.id.includes('-')) payload.id = invoice.id;
    const repositories = getRepositories();
    if (repositories) {
      try { return await repositories.invoices.save(payload, itemRows); }
      catch (error) { if (error.code !== 'PGRST202') throw error; }
    }

    let invId;
    if (invoice.id && typeof invoice.id === 'string' && invoice.id.includes('-')) {
      payload.id = invoice.id;
      const { error } = await sb.from('invoices').upsert(payload);
      if (error) throw error;
      invId = invoice.id;
    } else {
      const { data, error } = await sb.from('invoices').insert(payload).select().single();
      if (error) throw error;
      invId = data.id;
    }

    const { error: deleteItemsError } = await sb.from('invoice_items').delete().eq('invoice_id', invId);
    if (deleteItemsError) throw deleteItemsError;
    if (items && items.length > 0) {
      const legacyItemRows = items.map((item, i) => ({
        invoice_id: invId,
        sort_order: i,
        description: item.desc,
        unit: item.unit,
        qty: parseFloat(item.qty) || 0,
        rate: parseFloat(item.rate) || 0,
        amount: (parseFloat(item.qty) || 0) * (parseFloat(item.clientRate) || parseFloat(item.rate) || 0),
        source_name: item.source || null,
        note: item.note || '',
        line_type: item.lineType || 'material',
        markup_enabled: item.markupEnabled || false,
        markup_mode: item.markupMode || 'percent',
        markup_value: parseFloat(item.markupValue) || 0,
        client_rate: parseFloat(item.clientRate) || parseFloat(item.rate) || 0,
      }));
      const { error: itemError } = await sb.from('invoice_items').insert(legacyItemRows);
      if (itemError) throw itemError;
    }

    return invId;
  }

  async function dbDeleteInvoice(id) {
    await sb.from('invoices').delete().eq('id', id);
  }


  // ══════════════════════════════════
  //  PDF GENERATION & UPLOAD
  // ══════════════════════════════════
  async function uploadDocumentHtml(htmlContent, docType) {
    if (!currentUser) { console.error('No user'); return null; }
    try {
      const { data, error } = await sb.from('shared_documents').insert({
        user_id: currentUser.id,
        doc_type: docType || 'quote',
        html_content: htmlContent
      }).select('id').single();
      if (error) { console.error('Doc save error:', error); return null; }
      const url = window.location.origin + window.location.pathname + '?doc=' + data.id;
      return url;
    } catch(e) {
      console.error('Doc upload error:', e);
      return null;
    }
  }

  // ══════════════════════════════════
  //  OVERRIDE LOCAL FUNCTIONS → SUPABASE
  // ══════════════════════════════════
  // Cache for dashboard renders
  let _quotesCache = [];
  let _invoicesCache = [];
  let _clientsCache = [];

  function getQuotes() { return _quotesCache; }
  function getInvoices() { return _invoicesCache; }
  function getClients() { return _clientsCache; }

  async function refreshQuotes() {
    const raw = await dbGetQuotes();
    _quotesCache = raw.map(q => ({
      id: q.id, quoteNum: q.quote_num, status: q.status, date: q.date,
      validFor: q.valid_days, jobDesc: q.job_desc, clientName: q.client_name,
      clientPhone: q.client_phone, clientEmail: q.client_email, jobAddress: q.job_address,
      bizName: q.biz_name, bizPhone: q.biz_phone, bizEmail: q.biz_email,
      bizAddress: q.biz_address, bizLicense: q.biz_license, notes: q.notes,
      taxEnabled: q.tax_enabled, taxRate: q.tax_rate, subtotal: '$' + (q.subtotal||0).toFixed(2),
      total: '$' + (q.total||0).toFixed(2), updatedAt: new Date(q.updated_at).getTime(),
      overheadPercent: q.overhead_percent || 0, overheadVisible: q.overhead_visible || false,
      items: (q.items||[]).map(i => ({
        desc: i.description, unit: i.unit, qty: i.qty, rate: i.rate, note: i.note || '',
        source: i.source_name || '',
        lineType: i.line_type || 'material',
        markupEnabled: i.markup_enabled || false,
        markupMode: i.markup_mode || 'percent',
        markupValue: i.markup_value || 0,
        clientRate: i.client_rate || i.rate || 0,
      }))
    }));
    return _quotesCache;
  }

  async function refreshInvoices() {
    const raw = await dbGetInvoices();
    _invoicesCache = raw.map(inv => ({
      id: inv.id, invoiceNum: inv.invoice_num, status: inv.status, date: inv.date,
      dueIn: inv.due_days, dueDate: inv.due_date, jobDesc: inv.job_desc,
      clientName: inv.client_name, clientPhone: inv.client_phone, clientEmail: inv.client_email,
      jobAddress: inv.job_address, bizName: inv.biz_name, bizPhone: inv.biz_phone,
      bizEmail: inv.biz_email, bizAddress: inv.biz_address, notes: inv.notes,
      taxEnabled: inv.tax_enabled, taxRate: inv.tax_rate, subtotal: '$' + (inv.subtotal||0).toFixed(2),
      total: '$' + (inv.total||0).toFixed(2), fromQuoteId: inv.from_quote_id,
      fromQuoteNum: inv.from_quote_num, updatedAt: new Date(inv.updated_at).getTime(),
      overheadPercent: inv.overhead_percent || 0, overheadVisible: inv.overhead_visible || false,
      items: (inv.items||[]).map(i => ({
        desc: i.description, unit: i.unit, qty: i.qty, rate: i.rate, note: i.note || '',
        source: i.source_name || '',
        lineType: i.line_type || 'material',
        markupEnabled: i.markup_enabled || false,
        markupMode: i.markup_mode || 'percent',
        markupValue: i.markup_value || 0,
        clientRate: i.client_rate || i.rate || 0,
      }))
    }));
    return _invoicesCache;
  }

  async function refreshClients() {
    const raw = await dbGetClients();
    _clientsCache = raw.map(c => ({
      id: c.id, name: c.name, phone: c.phone, email: c.email, address: c.address, notes: c.notes
    }));
    return _clientsCache;
  }

  // These get redefined below but we override saveQuotesToStorage etc
  function saveQuotesToStorage() {} // no-op, we use dbSaveQuote directly
  function saveInvoicesToStorage() {} // no-op
  function saveClientsToStorage() {} // no-op
  const dateInput = document.getElementById('estimateDate');
  const today = new Date();
  dateInput.value = today.toISOString().split('T')[0];

  let taxEnabled = false;

  // ── Nav toggle (mobile) ──
  function toggleNav() {
    document.getElementById('leftNav').classList.toggle('open');
    document.getElementById('navOverlay').classList.toggle('show');
  }

  // ══════════════════════════════════
  //  ACCORDION TOGGLE
  // ══════════════════════════════════
  function toggleCatalog(toggleId, switchId) {
    const toggle = document.getElementById(toggleId);
    const sw = document.getElementById(switchId);
    toggle.classList.toggle('open');
    if (sw) sw.classList.toggle('on');
  }

  function toggleCat(header) {
    header.closest('.cat-section').classList.toggle('open');
  }

  // ══════════════════════════════════
  //  RENDER ITEM CARDS
  // ══════════════════════════════════
  function initItemGrids() {
    document.querySelectorAll('.item-grid').forEach(grid => {
      const items = JSON.parse(grid.dataset.items);
      grid.innerHTML = items.map((item, i) => `
        <div class="item-card" data-unit="${item.unit}">
          <div class="item-card-top">
            <label class="item-check">
              <input type="checkbox" onchange="toggleItem(this)">
              <span class="item-checkmark"></span>
            </label>
            <div class="item-card-name">${escapeHtml(item.name)}</div>
          </div>
          <div class="item-card-inputs">
            <div class="item-card-field">
              <span class="item-card-label">${item.uLabel}</span>
              <input class="item-card-input" type="number" placeholder="0" min="0" step="0.01" data-role="qty" oninput="syncToTable(this)" disabled>
            </div>
            <div class="item-card-field">
              <span class="item-card-label">$/${item.uLabel}</span>
              <input class="item-card-input" type="number" placeholder="0.00" min="0" step="0.01" data-role="rate" oninput="syncToTable(this)" disabled>
            </div>
            <div class="item-card-total"></div>
          </div>
        </div>
      `).join('');
    });
  }

  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function toggleItem(checkbox) {
    const card = checkbox.closest('.item-card');
    const inputs = card.querySelectorAll('.item-card-input');
    const name = card.querySelector('.item-card-name').textContent;
    const unit = card.dataset.unit || 'each';

    if (checkbox.checked) {
      card.classList.add('checked');
      inputs.forEach(inp => { inp.disabled = false; });
      inputs[0].focus();
      // Auto-add to Items table
      addLine(name, unit);
    } else {
      card.classList.remove('checked');
      inputs.forEach(inp => { inp.disabled = true; inp.value = ''; });
      card.querySelector('.item-card-total').textContent = '';
      // Remove matching row from Items table
      removeLineByName(name);
    }
    calcAll();
  }

  // ══════════════════════════════════
  //  ITEMS TABLE
  // ══════════════════════════════════
  let lineCounter = 0;

  function guessLineType(unit, desc) {
    const laborUnits = ['hr','job'];
    const subWords = ['sub','subcontractor','employee','crew','helper'];
    const laborWords = ['labor','install','demo','cleanup','travel','management','repair','service'];
    if (desc && subWords.some(w => desc.toLowerCase().includes(w))) return 'sub';
    if (laborUnits.includes(unit)) return 'mylabor';
    if (desc && laborWords.some(w => desc.toLowerCase().includes(w))) return 'mylabor';
    return 'material';
  }

  function getTypeBadgeInfo(type) {
    if (type === 'mylabor') return { cls: 'type-labor', label: 'My Labor' };
    if (type === 'employee') return { cls: 'type-employee', label: 'Employee' };
    if (type === 'sub') return { cls: 'type-sub', label: 'Sub' };
    return { cls: 'type-material', label: 'Material' };
  }

  function addLine(description, unit) {
    lineCounter++;
    const body = document.getElementById('lineItemsBody');
    const row = document.createElement('div');
    row.className = 'line-item-row' + (description ? ' from-accordion' : '');
    row.dataset.id = lineCounter;
    row.dataset.lineType = guessLineType(unit || 'each', description || '');
    row.dataset.markupEnabled = 'false';
    row.dataset.markupMode = 'percent';
    row.dataset.markupValue = '0';
    if (description) row.dataset.sourceName = description;

    const unitVal = unit || 'each';
    const unitOptions = ['each','hr','sqft','lnft','sq','job'];
    const optionsHtml = unitOptions.map(u =>
      `<option value="${u}"${u === unitVal ? ' selected' : ''}>${u}</option>`
    ).join('');

    const typeInfo = getTypeBadgeInfo(row.dataset.lineType);
    const hideMarkup = row.dataset.lineType === 'mylabor' ? ' style="display:none;"' : '';

    row.innerHTML = `
      <div class="line-desc-wrap" style="display:flex;align-items:center;gap:6px;">
        <span class="line-type-badge ${typeInfo.cls}" onclick="toggleLineType(this)" title="Click to switch type">${typeInfo.label}</span>
        <input type="text" placeholder="Type or pick from suggestions…" value="${description ? escapeHtml(description) : ''}" style="flex:1;">
      </div>
      <select class="unit-select" onchange="updateUnit(this)">
        ${optionsHtml}
      </select>
      <div class="qty-wrap">
        <input type="number" placeholder="1" value="" min="0" step="0.01" oninput="syncToAccordion(this)">
        <span class="qty-suffix">${unitVal}</span>
      </div>
      <input type="number" placeholder="0.00" value="" min="0" step="0.01" oninput="syncToAccordion(this)" data-role="rate">
      <div class="line-total">$0.00</div>
      <div style="display:flex;gap:2px;">
        <button class="line-note-btn" onclick="toggleLineNote(this)" title="Add note">📝</button>
        <button class="line-markup-btn" onclick="toggleLineMarkup(this)" title="Add markup"${hideMarkup}>%</button>
      </div>
      <button class="line-remove" onclick="removeLine(this)" title="Remove">×</button>
      <div class="line-note-row" style="display:none;">
        <input class="line-note-input" type="text" placeholder="e.g. Includes removal of old materials…">
      </div>
      <div class="line-markup-row">
        <div class="markup-inner">
          <span class="markup-label">Your Cost</span>
          <span class="markup-cost" style="font-family:var(--font-mono);font-size:12px;color:var(--ink);">$0.00</span>
          <span class="markup-label" style="margin-left:8px;">Markup</span>
          <div class="markup-mode-toggle">
            <button class="markup-mode-btn active" onclick="setMarkupMode(this,'percent')">%</button>
            <button class="markup-mode-btn" onclick="setMarkupMode(this,'flat')">$</button>
          </div>
          <input class="markup-input" type="number" placeholder="0" min="0" step="0.5" value="" oninput="calcMarkup(this)">
          <span class="markup-label">→</span>
          <span class="markup-result">Client: $0.00</span>
        </div>
      </div>
    `;
    body.appendChild(row);

    const descInput = row.querySelector('.line-desc-wrap input');
    wireAutocomplete(descInput);
  }

  function toggleLineType(badge) {
    const row = badge.closest('.line-item-row');
    const cycle = { material: 'mylabor', mylabor: 'employee', employee: 'sub', sub: 'material' };
    const newType = cycle[row.dataset.lineType] || 'material';
    row.dataset.lineType = newType;
    const info = getTypeBadgeInfo(newType);
    badge.textContent = info.label;
    badge.className = 'line-type-badge ' + info.cls;

    // Hide markup for My Labor (no cost to mark up)
    const markupBtn = row.querySelector('.line-markup-btn');
    const markupRow = row.querySelector('.line-markup-row');
    if (newType === 'mylabor') {
      if (markupBtn) markupBtn.style.display = 'none';
      if (markupRow) { markupRow.classList.remove('show'); }
      row.dataset.markupEnabled = 'false';
      row.dataset.markupValue = '0';
    } else {
      if (markupBtn) markupBtn.style.display = '';
    }
    calcAll();
  }

  function toggleLineMarkup(btn) {
    const row = btn.closest('.line-item-row');
    const markupRow = row.querySelector('.line-markup-row');
    const isActive = markupRow.classList.contains('show');
    if (isActive) {
      markupRow.classList.remove('show');
      btn.classList.remove('active');
      row.dataset.markupEnabled = 'false';
      row.dataset.markupValue = '0';
      row.querySelector('.markup-input').value = '';
    } else {
      markupRow.classList.add('show');
      btn.classList.add('active');
      row.dataset.markupEnabled = 'true';
      row.querySelector('.markup-input').focus();
    }
    calcAll();
  }

  function setMarkupMode(btn, mode) {
    const row = btn.closest('.line-item-row');
    row.dataset.markupMode = mode;
    btn.parentElement.querySelectorAll('.markup-mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    calcMarkup(row.querySelector('.markup-input'));
  }

  function calcMarkup(input) {
    const row = input.closest('.line-item-row');
    row.dataset.markupValue = input.value || '0';
    calcAll();
  }

  function getLineClientRate(row) {
    const rateInput = row.querySelector('[data-role="rate"]');
    const baseCost = parseFloat(rateInput?.value) || 0;
    if (row.dataset.markupEnabled !== 'true') return baseCost;
    const markupVal = parseFloat(row.dataset.markupValue) || 0;
    if (row.dataset.markupMode === 'percent') {
      return baseCost * (1 + markupVal / 100);
    } else {
      return baseCost + markupVal;
    }
  }

  function removeLine(btn) {
    const row = btn.closest('.line-item-row');
    const rows = document.querySelectorAll('.line-item-row');
    if (rows.length <= 1 && !row.dataset.sourceName) return;

    // If it came from an accordion, uncheck it
    const sourceName = row.dataset.sourceName;
    if (sourceName) {
      document.querySelectorAll('.item-card').forEach(card => {
        if (card.querySelector('.item-card-name').textContent === sourceName) {
          const cb = card.querySelector('input[type="checkbox"]');
          if (cb && cb.checked) {
            cb.checked = false;
            card.classList.remove('checked');
            card.querySelectorAll('.item-card-input').forEach(inp => { inp.disabled = true; inp.value = ''; });
            card.querySelector('.item-card-total').textContent = '';
          }
        }
      });
    }

    row.style.opacity = '0';
    row.style.transform = 'translateX(8px)';
    row.style.transition = 'all 0.2s';
    setTimeout(() => { row.remove(); calcAll(); }, 200);
  }

  function removeLineByName(name) {
    document.querySelectorAll('.line-item-row').forEach(row => {
      if (row.dataset.sourceName === name) {
        row.remove();
      }
    });
  }

  function toggleLineNote(el) {
    const row = el.closest('.line-item-row');
    const noteRow = row.querySelector('.line-note-row');
    const noteInput = row.querySelector('.line-note-input');
    if (noteRow.style.display === 'none') {
      noteRow.style.display = '';
      noteInput.focus();
      el.classList.add('active');
    } else {
      noteRow.style.display = 'none';
      noteInput.value = '';
      el.classList.remove('active');
    }
  }

  function updateUnit(select) {
    const row = select.closest('.line-item-row');
    const suffix = row.querySelector('.qty-suffix');
    if (suffix) suffix.textContent = select.value;
    calcAll();
  }

  // ══════════════════════════════════
  //  SYNC ACCORDION → ITEMS TABLE
  // ══════════════════════════════════
  function syncToTable(input) {
    const card = input.closest('.item-card');
    const name = card.querySelector('.item-card-name').textContent;
    const qtyVal = card.querySelector('[data-role="qty"]').value;
    const rateVal = card.querySelector('[data-role="rate"]').value;

    // Find matching row in Items table
    document.querySelectorAll('.line-item-row').forEach(row => {
      if (row.dataset.sourceName === name) {
        const tableInputs = row.querySelectorAll('input[type="number"]');
        tableInputs[0].value = qtyVal;  // qty
        tableInputs[1].value = rateVal; // rate
      }
    });
    calcAll();
  }

  function syncToAccordion(input) {
    const row = input.closest('.line-item-row');
    const sourceName = row.dataset.sourceName;
    if (sourceName) {
      const tableInputs = row.querySelectorAll('input[type="number"]');
      const qtyVal = tableInputs[0].value;
      const rateVal = tableInputs[1].value;

      // Find matching accordion card
      document.querySelectorAll('.item-card').forEach(card => {
        if (card.querySelector('.item-card-name').textContent === sourceName) {
          const cardQty = card.querySelector('[data-role="qty"]');
          const cardRate = card.querySelector('[data-role="rate"]');
          if (cardQty) cardQty.value = qtyVal;
          if (cardRate) cardRate.value = rateVal;
        }
      });
    }
    calcAll();
  }

  // ══════════════════════════════════
  //  CALCULATE
  // ══════════════════════════════════
  let taxScope = 'all'; // 'all' or 'materials'
  let overheadPercent = 0;
  let overheadVisible = false;

  function calcAll() {
    let grandTotal = 0;
    let materialTotal = 0;
    let myLaborTotal = 0;
    let subTotal = 0;
    let empTotal = 0;
    let totalItems = 0;

    // Line items table
    document.querySelectorAll('#lineItemsBody .line-item-row').forEach(row => {
      const inputs = row.querySelectorAll('input[type="number"]');
      const qty = parseFloat(inputs[0]?.value) || 0;
      const baseCost = parseFloat(row.querySelector('[data-role="rate"]')?.value) || 0;
      const clientRate = getLineClientRate(row);
      const amount = qty * clientRate;

      row.querySelector('.line-total').textContent = amount > 0 ? formatMoney(amount) : '$0.00';

      // Update markup display
      if (row.dataset.markupEnabled === 'true') {
        const costEl = row.querySelector('.markup-cost');
        const resultEl = row.querySelector('.markup-result');
        if (costEl) costEl.textContent = formatMoney(baseCost);
        if (resultEl) resultEl.textContent = 'Client: ' + formatMoney(clientRate) + '/unit';
      }

      // Track by type
      const lt = row.dataset.lineType;
      if (lt === 'mylabor') { myLaborTotal += amount; }
      else if (lt === 'employee') { empTotal += amount; }
      else if (lt === 'sub') { subTotal += amount; }
      else { materialTotal += amount; }
      grandTotal += amount;
      if (amount > 0) totalItems++;
    });

    // Accordion items (for category subtotals display only)
    document.querySelectorAll('.cat-section[data-cat]').forEach(section => {
      let catTotal = 0;
      section.querySelectorAll('.item-card.checked').forEach(card => {
        const qtyInput = card.querySelector('[data-role="qty"]');
        const rateInput = card.querySelector('[data-role="rate"]');
        if (!qtyInput || !rateInput) return;
        const qty = parseFloat(qtyInput.value) || 0;
        const rate = parseFloat(rateInput.value) || 0;
        const amount = qty * rate;
        card.querySelector('.item-card-total').textContent = amount > 0 ? formatMoney(amount) : '';
        catTotal += amount;
      });
      const subtotalEl = section.querySelector('[data-subtotal]');
      if (subtotalEl) {
        subtotalEl.textContent = catTotal > 0 ? formatMoney(catTotal) : '$0.00';
        subtotalEl.classList.toggle('has-value', catTotal > 0);
      }
    });

    // Update totals panel
    document.getElementById('subtotalDisplay').textContent = formatMoney(grandTotal);
    document.getElementById('sidebarLineCount').textContent = totalItems;

    // Section subtotals — show only types that have values
    const hasMultipleTypes = (materialTotal > 0 ? 1 : 0) + (myLaborTotal > 0 ? 1 : 0) + (subTotal > 0 ? 1 : 0) + (empTotal > 0 ? 1 : 0) > 1;
    const matSubEl = document.getElementById('materialSubtotal');
    const labSubEl = document.getElementById('laborSubtotal');
    const subSubEl = document.getElementById('subSubtotal');
    const empSubEl = document.getElementById('empSubtotal');
    if (matSubEl) matSubEl.textContent = formatMoney(materialTotal);
    if (labSubEl) labSubEl.textContent = formatMoney(myLaborTotal);
    if (subSubEl) subSubEl.textContent = formatMoney(subTotal);
    if (empSubEl) empSubEl.textContent = formatMoney(empTotal);
    const matRow = document.getElementById('materialSubRow');
    const labRow = document.getElementById('laborSubRow');
    const subRow = document.getElementById('subSubRow');
    const empRow = document.getElementById('empSubRow');
    if (matRow) matRow.style.display = hasMultipleTypes && materialTotal > 0 ? 'flex' : 'none';
    if (labRow) labRow.style.display = hasMultipleTypes && myLaborTotal > 0 ? 'flex' : 'none';
    if (subRow) subRow.style.display = hasMultipleTypes && subTotal > 0 ? 'flex' : 'none';
    if (empRow) empRow.style.display = hasMultipleTypes && empTotal > 0 ? 'flex' : 'none';

    // O&P calculation
    let opAmt = 0;
    const opInput = document.getElementById('opRateInput');
    if (overheadPercent > 0 || document.getElementById('opToggle')?.classList.contains('on')) {
      overheadPercent = parseFloat(opInput?.value) || 0;
      opAmt = grandTotal * (overheadPercent / 100);
      document.getElementById('opLabel').textContent = `Overhead & Profit (${overheadPercent}%)`;
      document.getElementById('opDisplay').textContent = formatMoney(opAmt);
    }

    let taxAmt = 0;
    const afterOP = grandTotal + opAmt;
    if (taxEnabled) {
      const taxRate = parseFloat(document.getElementById('taxRateInput').value) || 0;
      const taxableAmount = taxScope === 'materials' ? materialTotal + (materialTotal / grandTotal * opAmt || 0) : afterOP;
      taxAmt = taxableAmount * (taxRate / 100);
      const scopeLabel = taxScope === 'materials' ? ' (materials)' : '';
      document.getElementById('taxLabel').textContent = `Tax (${taxRate}%)${scopeLabel}`;
      document.getElementById('taxDisplay').textContent = formatMoney(taxAmt);
    }
    document.getElementById('totalDisplay').textContent = formatMoney(afterOP + taxAmt);
  }

  function toggleOP() {
    const toggle = document.getElementById('opToggle');
    const isOn = toggle.classList.contains('on');
    if (isOn) {
      toggle.classList.remove('on');
      document.getElementById('opRateWrap').style.display = 'none';
      document.getElementById('opRow').style.display = 'none';
      overheadPercent = 0;
    } else {
      toggle.classList.add('on');
      document.getElementById('opRateWrap').style.display = 'flex';
      document.getElementById('opRow').style.display = '';
      overheadPercent = parseFloat(document.getElementById('opRateInput').value) || 15;
    }
    calcAll();
  }

  function setOPVisible(visible, btn) {
    overheadVisible = visible;
    btn.parentElement.querySelectorAll('.tax-scope-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }

  function toggleTax() {
    taxEnabled = !taxEnabled;
    document.getElementById('taxToggle').classList.toggle('on', taxEnabled);
    document.getElementById('taxRateWrap').style.display = taxEnabled ? 'flex' : 'none';
    document.getElementById('taxRow').style.display = taxEnabled ? 'flex' : 'none';
    document.getElementById('taxScopeWrap').style.display = taxEnabled ? '' : 'none';
    calcAll();
  }

  function setTaxScope(scope, btn) {
    taxScope = scope;
    btn.parentElement.querySelectorAll('.tax-scope-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    calcAll();
  }

  // Init
  initItemGrids();
  initInvItemGrids();

  // ══════════════════════════════════
  //  AUTOCOMPLETE ON DESCRIPTION
  // ══════════════════════════════════
  // Build flat list from accordion data
  const AC_ITEMS = [];
  document.querySelectorAll('.item-grid').forEach(grid => {
    const catSection = grid.closest('.cat-section');
    const catName = catSection ? catSection.querySelector('.cat-name').textContent : '';
    const items = JSON.parse(grid.dataset.items);
    items.forEach(item => AC_ITEMS.push({ cat: catName, name: item.name, unit: item.unit }));
  });

  let activeAcDropdown = null;
  let acFilterCat = 'All';

  // Get unique category names
  const AC_CATS = ['All', ...new Set(AC_ITEMS.map(i => i.cat))];

  function closeAc() {
    if (activeAcDropdown) {
      const row = activeAcDropdown.closest('.line-item-row');
      if (row) {
        row.classList.remove('ac-open');
        row.style.marginBottom = '';
        row.style.transition = 'margin-bottom 0.2s ease';
      }
      activeAcDropdown.remove();
      activeAcDropdown = null;
    }
    acFilterCat = 'All';
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.line-item-row')) closeAc();
  });

  function showAc(input) {
    closeAc();
    acFilterCat = 'All';
    const row = input.closest('.line-item-row');
    row.classList.add('ac-open');

    const dropdown = document.createElement('div');
    dropdown.className = 'ac-dropdown';
    dropdown.addEventListener('mousedown', (e) => e.preventDefault());
    activeAcDropdown = dropdown;

    // Trade tabs
    const tabs = document.createElement('div');
    tabs.className = 'ac-tabs';
    tabs.innerHTML = AC_CATS.map(c =>
      `<button class="ac-tab${c === 'All' ? ' active' : ''}" data-cat="${c}">${c}</button>`
    ).join('');
    tabs.addEventListener('mousedown', (e) => e.preventDefault());
    tabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.ac-tab');
      if (!tab) return;
      acFilterCat = tab.dataset.cat;
      tabs.querySelectorAll('.ac-tab').forEach(t => t.classList.toggle('active', t.dataset.cat === acFilterCat));
      renderAc(dropdown, input);
      // Re-measure push-down
      requestAnimationFrame(() => {
        row.style.marginBottom = (dropdown.offsetHeight + 8) + 'px';
      });
    });
    dropdown.appendChild(tabs);

    // List container
    const list = document.createElement('div');
    list.className = 'ac-list';
    dropdown.appendChild(list);

    row.appendChild(dropdown);
    renderAc(dropdown, input);

    // Push content below down
    requestAnimationFrame(() => {
      row.style.transition = 'margin-bottom 0.2s ease';
      row.style.marginBottom = (dropdown.offsetHeight + 8) + 'px';
    });
  }

  function renderAc(dropdown, input) {
    const list = dropdown.querySelector('.ac-list');
    const query = input.value.trim().toLowerCase();
    let pool = acFilterCat === 'All' ? AC_ITEMS : AC_ITEMS.filter(p => p.cat === acFilterCat);

    if (query.length > 0) {
      pool = pool.filter(p => p.name.toLowerCase().includes(query));
    }

    if (pool.length === 0) {
      list.innerHTML = '<div class="ac-empty">No matches — type a custom description</div>';
      return;
    }

    const showCat = acFilterCat === 'All';
    list.innerHTML = pool.map(p => {
      let display = escapeHtml(p.name);
      if (query.length > 0) {
        const idx = p.name.toLowerCase().indexOf(query);
        if (idx >= 0) {
          const before = escapeHtml(p.name.slice(0, idx));
          const match = escapeHtml(p.name.slice(idx, idx + query.length));
          const after = escapeHtml(p.name.slice(idx + query.length));
          display = `${before}<mark>${match}</mark>${after}`;
        }
      }
      return `<div class="ac-item" data-name="${escapeHtml(p.name)}" data-unit="${p.unit}" data-cat="${escapeHtml(p.cat)}">
        ${showCat ? `<span class="ac-item-cat">${escapeHtml(p.cat)}</span>` : ''}
        <span class="ac-item-name">${display}</span>
        <span class="ac-item-unit">${p.unit}</span>
      </div>`;
    }).join('');

    list.querySelectorAll('.ac-item').forEach(item => {
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        input.value = item.dataset.name;
        const row = input.closest('.line-item-row');
        const unitSelect = row.querySelector('.unit-select');
        if (unitSelect) {
          unitSelect.value = item.dataset.unit;
          const suffix = row.querySelector('.qty-suffix');
          if (suffix) suffix.textContent = item.dataset.unit;
        }
        row.dataset.sourceName = item.dataset.name;
        closeAc();
        calcAll();
        const qtyInput = row.querySelector('.qty-wrap input');
        if (qtyInput) qtyInput.focus();
      });
    });
  }

  function wireAutocomplete(input) {
    input.addEventListener('focus', () => showAc(input));
    input.addEventListener('input', () => {
      if (activeAcDropdown && input.closest('.line-item-row').contains(activeAcDropdown)) {
        renderAc(activeAcDropdown, input);
        // Recalculate push-down
        const row = input.closest('.line-item-row');
        requestAnimationFrame(() => {
          row.style.marginBottom = (activeAcDropdown.offsetHeight + 8) + 'px';
        });
      } else {
        showAc(input);
      }
      calcAll();
    });
    input.addEventListener('blur', () => {
      setTimeout(() => closeAc(), 150);
    });
  }


  function formatMoney(num) {
    return '$' + num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function formatPhone(input) {
    let digits = input.value.replace(/\D/g, '').slice(0, 10);
    if (digits.length === 0) { input.value = ''; return; }
    if (digits.length <= 3) {
      input.value = '(' + digits;
    } else if (digits.length <= 6) {
      input.value = '(' + digits.slice(0,3) + ') ' + digits.slice(3);
    } else {
      input.value = '(' + digits.slice(0,3) + ') ' + digits.slice(3,6) + '-' + digits.slice(6);
    }
  }

  // ══════════════════════════════════
  //  LOGO UPLOAD
  // ══════════════════════════════════
  let bizLogoData = null;

  function handleLogo(files) {
    const file = files[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      bizLogoData = e.target.result;
      const preview = document.getElementById('logoPreview');
      if (preview) { preview.innerHTML = `<img src="${bizLogoData}" alt="Logo">`; preview.classList.add('has-logo'); }
      const rmBtn = document.getElementById('logoRemoveBtn');
      if (rmBtn) rmBtn.style.display = 'inline';
    };
    reader.readAsDataURL(file);
  }

  function removeLogo() {
    bizLogoData = null;
    const preview = document.getElementById('logoPreview');
    if (preview) {
      preview.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
      preview.classList.remove('has-logo');
    }
    const rmBtn = document.getElementById('logoRemoveBtn');
    if (rmBtn) rmBtn.style.display = 'none';
  }

  // Make the label trigger the file input even after logo is set
  const _logoPreview = document.getElementById('logoPreview');
  if (_logoPreview) _logoPreview.addEventListener('click', function() {
    if (bizLogoData) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.hidden = true;
      input.onchange = () => handleLogo(input.files);
      input.click();
    }
  });

  // ══════════════════════════════════
  //  ATTACHMENTS
  // ══════════════════════════════════
  let attachCounter = 0;

  // Drag & drop
  const dropZone = document.getElementById('attachDrop');
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
  });

  function handleFiles(files) {
    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) return;
      attachCounter++;
      const reader = new FileReader();
      reader.onload = (e) => addAttachment(e.target.result, file.name);
      reader.readAsDataURL(file);
    });
  }

  function addAttachment(dataUrl, filename) {
    const grid = document.getElementById('attachGrid');
    const drop = document.getElementById('attachDrop');

    const item = document.createElement('div');
    item.className = 'attach-item';
    item.innerHTML = `
      <img class="attach-thumb" src="${dataUrl}" alt="">
      <div class="attach-info">
        <button class="attach-remove" onclick="removeAttachment(this)" title="Remove">×</button>
        <input class="attach-desc" type="text" placeholder="Add a description…">
        <div class="attach-filename">${escapeHtml(filename)}</div>
      </div>
    `;

    grid.insertBefore(item, drop);
    updateAttachCount();
  }

  function removeAttachment(btn) {
    const item = btn.closest('.attach-item');
    item.style.opacity = '0';
    item.style.transform = 'scale(0.95)';
    item.style.transition = 'all 0.2s';
    setTimeout(() => { item.remove(); updateAttachCount(); }, 200);
  }

  function updateAttachCount() {
    const count = document.querySelectorAll('#attachGrid .attach-item').length;
    document.getElementById('attachCount').textContent = count > 0 ? count + ' photo' + (count > 1 ? 's' : '') : '';
  }

  // ── Invoice photo attachments ──
  function handleInvFiles(files) {
    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = (e) => addInvAttachment(e.target.result, file.name);
      reader.readAsDataURL(file);
    });
  }

  function addInvAttachment(dataUrl, filename) {
    const grid = document.getElementById('invAttachGrid');
    const drop = document.getElementById('invAttachDrop');
    const item = document.createElement('div');
    item.className = 'attach-item';
    item.innerHTML = `
      <img class="attach-thumb" src="${dataUrl}" alt="">
      <div class="attach-info">
        <input class="attach-desc" type="text" placeholder="Add a description…">
        <span class="attach-filename">${escapeHtml(filename || 'photo')}</span>
      </div>
      <button class="attach-remove" onclick="removeInvAttachment(this)">×</button>`;
    grid.insertBefore(item, drop);
    updateInvAttachCount();
  }

  function removeInvAttachment(btn) {
    const item = btn.closest('.attach-item');
    item.style.opacity = '0'; item.style.transform = 'scale(0.95)'; item.style.transition = 'all 0.2s';
    setTimeout(() => { item.remove(); updateInvAttachCount(); }, 200);
  }

  function updateInvAttachCount() {
    const count = document.querySelectorAll('#invAttachGrid .attach-item').length;
    const el = document.getElementById('invAttachCount');
    if (el) el.textContent = count > 0 ? count + ' photo' + (count > 1 ? 's' : '') : '';
  }

  // ══════════════════════════════════
  //  PDF GENERATION
  // ══════════════════════════════════
  function generatePDF() {
    // Auto-save the quote
    const existingQuote = currentQuoteId ? getQuotes().find(q => q.id === currentQuoteId) : null;
    saveQuote(existingQuote?.status || 'Draft').catch(e => console.warn('Auto-save error:', e));

    const clientName = document.getElementById('clientName').value || 'Client';
    const clientPhone = document.getElementById('clientPhone').value || '';
    const clientEmail = document.getElementById('clientEmail').value || '';
    const jobAddress = document.getElementById('jobAddress').value || '';
    const estNum = document.getElementById('estimateNum').value || 'QT-0001';
    const estDate = document.getElementById('estimateDate').value || '';
    const validDays = document.getElementById('validFor').value || '30';
    const jobDesc = document.getElementById('jobDesc').value || '';
    const notes = document.getElementById('notes').value || '';
    const subtotal = document.getElementById('subtotalDisplay').textContent;
    const total = document.getElementById('totalDisplay').textContent;
    const taxLabel = document.getElementById('taxLabel').textContent;
    const taxAmt = document.getElementById('taxDisplay').textContent;
    const showTax = taxEnabled;

    // Business info
    const bizName = document.getElementById('bizName').value || '';
    const bizPhone = document.getElementById('bizPhone').value || '';
    const bizEmail = document.getElementById('bizEmail').value || '';
    const bizAddress = document.getElementById('bizAddress').value || '';
    const bizLicense = document.getElementById('bizLicense').value || '';

    // Gather line items from Items table, grouped by type
    let materialItemsHtml = '';
    let myLaborItemsHtml = '';
    let subItemsHtml = '';
    const quoteRows = document.querySelectorAll('#lineItemsBody .line-item-row');
    quoteRows.forEach(row => {
      const descInput = row.querySelector('.line-desc-wrap input') || row.querySelector('input[type="text"]');
      const desc = descInput?.value || '';
      if (!desc) return;
      const unit = row.querySelector('.unit-select')?.value || 'each';
      const numInputs = row.querySelectorAll('input[type="number"]');
      const qty = parseFloat(numInputs[0]?.value) || 0;
      const clientRate = getLineClientRate(row);
      const amount = qty * clientRate;
      const note = row.querySelector('.line-note-input')?.value || '';
      const lineType = row.dataset.lineType || 'material';
      const rowHtml = `
        <tr>
          <td style="padding:10px 12px;${note ? '' : 'border-bottom:1px solid #E0DBD4;'}font-size:13px;color:#1C1C1E;">${escapeHtml(desc)}</td>
          <td style="padding:10px 12px;${note ? '' : 'border-bottom:1px solid #E0DBD4;'}font-size:13px;color:#6B7280;text-align:center;">${escapeHtml(unit)}</td>
          <td style="padding:10px 12px;${note ? '' : 'border-bottom:1px solid #E0DBD4;'}font-family:'DM Mono',monospace;font-size:13px;color:#1C1C1E;text-align:center;">${qty}</td>
          <td style="padding:10px 12px;${note ? '' : 'border-bottom:1px solid #E0DBD4;'}font-family:'DM Mono',monospace;font-size:13px;color:#1C1C1E;text-align:right;">$${clientRate.toFixed(2)}</td>
          <td style="padding:10px 12px;${note ? '' : 'border-bottom:1px solid #E0DBD4;'}font-family:'DM Mono',monospace;font-size:13px;color:#1C1C1E;text-align:right;font-weight:500;">${formatMoney(amount)}</td>
        </tr>`;
      const noteHtml = note ? `<tr><td colspan="5" style="padding:2px 12px 10px 28px;border-bottom:1px solid #E0DBD4;font-size:11px;color:#6B7280;font-style:italic;">↳ ${escapeHtml(note)}</td></tr>` : '';
      if (lineType === 'mylabor') { myLaborItemsHtml += rowHtml + noteHtml; }
      else if (lineType === 'sub') { subItemsHtml += rowHtml + noteHtml; }
      else { materialItemsHtml += rowHtml + noteHtml; }
    });

    // Build combined items with section headers (only when multiple types)
    const sectionHeader = (title) => `<tr><td colspan="5" style="padding:8px 12px;background:#EDEAE5;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:#6B7280;border-bottom:1px solid #E0DBD4;">${title}</td></tr>`;
    const typeCount = (materialItemsHtml ? 1 : 0) + (myLaborItemsHtml ? 1 : 0) + (subItemsHtml ? 1 : 0);
    let lineItemsHtml = '';
    if (typeCount > 1) {
      if (materialItemsHtml) lineItemsHtml += sectionHeader('Materials') + materialItemsHtml;
      if (myLaborItemsHtml) lineItemsHtml += sectionHeader('Labor') + myLaborItemsHtml;
      if (subItemsHtml) lineItemsHtml += sectionHeader('Sub / Employee') + subItemsHtml;
    } else {
      lineItemsHtml = materialItemsHtml + myLaborItemsHtml + subItemsHtml;
    }

    // Gather attachments
    let attachHtml = '';
    const attachments = document.querySelectorAll('.attach-item');
    if (attachments.length > 0) {
      let imgs = '';
      attachments.forEach(item => {
        const src = item.querySelector('.attach-thumb').src;
        const desc = item.querySelector('.attach-desc').value || '';
        imgs += `
          <div style="break-inside:avoid;margin-bottom:12px;">
            <img src="${src}" style="width:100%;max-height:200px;object-fit:cover;border-radius:6px;border:1px solid #E0DBD4;">
            ${desc ? `<p style="font-size:11px;color:#6B7280;margin-top:4px;">${escapeHtml(desc)}</p>` : ''}
          </div>`;
      });
      attachHtml = `
        <div style="margin-top:32px;">
          <p style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:2px;color:#6B7280;margin-bottom:12px;">Photos</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">${imgs}</div>
        </div>`;
    }

    // Format expiry date
    let expiryStr = '';
    if (estDate) {
      const d = new Date(estDate + 'T00:00:00');
      d.setDate(d.getDate() + parseInt(validDays));
      expiryStr = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    }

    const formatDate = (str) => {
      if (!str) return '';
      const d = new Date(str + 'T00:00:00');
      return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    };

    const html = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<title>${estNum} — ${clientName}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'DM Sans', sans-serif; color: #1C1C1E; font-size: 13px; line-height: 1.6; padding: 0; }
  @page { size: letter; margin: 0.6in 0.7in; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } #pdfBar { display:none !important; } #pdfBar+div { display:none !important; } }
</style>
</head><body>

<div style="padding:40px 48px;">

  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px;padding-bottom:24px;border-bottom:2px solid #1C1C1E;">
    <div style="display:flex;align-items:center;gap:14px;">
      ${bizLogoData ? `<img src="${bizLogoData}" style="width:52px;height:52px;object-fit:contain;border-radius:8px;">` : ''}
      <div>
        <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:${bizName ? '20px' : '24px'};font-weight:800;color:#1C1C1E;letter-spacing:-0.5px;">${bizName ? escapeHtml(bizName) : 'Builders<span style=color:#E07A2F;>Invoice</span>'}</div>
        ${bizAddress ? `<div style="font-size:11px;color:#6B7280;margin-top:2px;">${escapeHtml(bizAddress)}</div>` : ''}
        ${bizPhone || bizEmail ? `<div style="font-size:11px;color:#6B7280;margin-top:1px;">${[bizPhone, bizEmail].filter(Boolean).map(escapeHtml).join(' · ')}</div>` : ''}
        ${bizLicense ? `<div style="font-size:10px;color:#6B7280;margin-top:1px;">License ${escapeHtml(bizLicense)}</div>` : ''}
      </div>
    </div>
    <div style="text-align:right;">
      <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:20px;font-weight:700;color:#1C1C1E;">${estNum}</div>
      <div style="font-size:12px;color:#6B7280;margin-top:2px;">${formatDate(estDate)}</div>
      ${expiryStr ? `<div style="font-size:11px;color:#E07A2F;font-weight:600;margin-top:2px;">Valid until ${expiryStr}</div>` : ''}
    </div>
  </div>

  <!-- Client + Job -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-bottom:32px;">
    <div>
      <p style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:2px;color:#6B7280;margin-bottom:8px;">Prepared For</p>
      <p style="font-size:15px;font-weight:600;color:#1C1C1E;">${escapeHtml(clientName)}</p>
      ${clientPhone ? `<p style="font-size:12px;color:#6B7280;">${escapeHtml(clientPhone)}</p>` : ''}
      ${clientEmail ? `<p style="font-size:12px;color:#6B7280;">${escapeHtml(clientEmail)}</p>` : ''}
    </div>
    <div>
      ${jobAddress ? `<p style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:2px;color:#6B7280;margin-bottom:8px;">Job Site</p><p style="font-size:13px;color:#1C1C1E;">${escapeHtml(jobAddress)}</p>` : ''}
      ${jobDesc ? `<p style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:2px;color:#6B7280;margin-bottom:8px;${jobAddress ? 'margin-top:16px;' : ''}">Job Description</p><p style="font-size:13px;color:#3E3E44;">${escapeHtml(jobDesc)}</p>` : ''}
    </div>
  </div>

  <!-- Line Items Table -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
    <thead>
      <tr style="background:#EDEAE5;">
        <th style="padding:8px 12px;text-align:left;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:#6B7280;">Description</th>
        <th style="padding:8px 12px;text-align:center;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:#6B7280;">Unit</th>
        <th style="padding:8px 12px;text-align:center;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:#6B7280;">Qty</th>
        <th style="padding:8px 12px;text-align:right;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:#6B7280;">Rate</th>
        <th style="padding:8px 12px;text-align:right;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:#6B7280;">Amount</th>
      </tr>
    </thead>
    <tbody>${lineItemsHtml}</tbody>
  </table>

  <!-- Totals -->
  <div style="display:flex;justify-content:flex-end;margin-bottom:32px;">
    <div style="width:240px;">
      <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;"><span style="color:#6B7280;">Subtotal</span><span style="font-family:'DM Mono',monospace;font-weight:500;">${subtotal}</span></div>
      ${overheadVisible && overheadPercent > 0 ? `<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;"><span style="color:#6B7280;">Contractor's Fee (${overheadPercent}%)</span><span style="font-family:'DM Mono',monospace;font-weight:500;">${formatMoney(parseFloat(subtotal.replace(/[$,]/g,'')) * overheadPercent / 100)}</span></div>` : ''}
      ${showTax ? `<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;"><span style="color:#6B7280;">${taxLabel}</span><span style="font-family:'DM Mono',monospace;font-weight:500;">${taxAmt}</span></div>` : ''}
      <div style="border-top:2px solid #1C1C1E;margin-top:8px;padding-top:10px;display:flex;justify-content:space-between;align-items:flex-end;">
        <span style="font-size:14px;font-weight:600;">Total</span>
        <span style="font-family:'Plus Jakarta Sans',sans-serif;font-size:26px;font-weight:800;letter-spacing:-0.5px;">${total}</span>
      </div>
    </div>
  </div>

  ${notes ? `
  <div style="margin-bottom:24px;padding:16px 20px;background:#F5F2EE;border-radius:8px;">
    <p style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:2px;color:#6B7280;margin-bottom:8px;">Notes</p>
    <p style="font-size:13px;color:#3E3E44;line-height:1.7;white-space:pre-wrap;">${escapeHtml(notes)}</p>
  </div>` : ''}

  ${attachHtml}

  ${isFree() ? '<div style="text-align:center;padding:24px 0 12px;"><div style="font-size:11px;color:#B0ACA6;letter-spacing:1px;">Created with</div><div style="font-family:\'Plus Jakarta Sans\',sans-serif;font-size:16px;font-weight:800;color:#B0ACA6;">Builders<span style=color:#E07A2F;>Invoice</span></div></div>' : ''}

  <!-- Footer -->
  <div style="margin-top:40px;padding-top:20px;border-top:1px solid #E0DBD4;display:flex;justify-content:space-between;align-items:center;">
    <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:14px;font-weight:700;color:#1C1C1E;">${bizName ? escapeHtml(bizName) : 'Builders<span style=color:#E07A2F;>Invoice</span>'}</div>
    <div style="font-size:11px;color:#6B7280;">Thank you for your business.</div>
  </div>

</div>

<div id="pdfBar" style="position:fixed;top:0;left:0;right:0;background:#1C1C1E;padding:12px 24px;display:flex;align-items:center;justify-content:space-between;z-index:9999;box-shadow:0 2px 12px rgba(0,0,0,0.3);"><span style="font-family:'Plus Jakarta Sans',sans-serif;color:white;font-size:14px;font-weight:600;">PDF Preview</span><div style="display:flex;gap:8px;"><button onclick="document.getElementById('pdfBar').style.display='none';window.print();" style="padding:8px 20px;background:#E07A2F;color:white;border:none;border-radius:6px;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer;">Save as PDF</button><button onclick="window.close()" style="padding:8px 16px;background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.7);border:1px solid rgba(255,255,255,0.15);border-radius:6px;font-family:'DM Sans',sans-serif;font-size:13px;cursor:pointer;">Close</button></div></div><div style="height:52px;"></div>
</body></html>`;

    const win = window.open('', '_blank');
    if (win) { win.document.write(html); win.document.close(); }
    else { alert('Pop-up blocked. Please allow pop-ups for this site, then try again.'); }
  }

  // ══════════════════════════════════
  //  LOCALSTORAGE — SAVE / LOAD / AUTOFILL
  // ══════════════════════════════════
  let currentQuoteId = null;

  // getQuotes/saveQuotesToStorage — overridden by Supabase cache layer above

  function generateQuoteNum() {
    const quotes = getQuotes();
    let max = 0;
    quotes.forEach(q => {
      const m = (q.quoteNum || '').match(/QT-(\d+)/);
      if (m) max = Math.max(max, parseInt(m[1]));
    });
    return 'QT-' + String(max + 1).padStart(4, '0');
  }

  function collectQuoteData(status) {
    // Collect line items from table
    const items = [];
    document.querySelectorAll('#lineItemsBody .line-item-row').forEach(row => {
      const desc = row.querySelector('input[type="text"]')?.value || '';
      const unit = row.querySelector('.unit-select')?.value || 'each';
      const rateInput = row.querySelector('[data-role="rate"]');
      const qtyInputs = row.querySelectorAll('input[type="number"]');
      const qty = qtyInputs[0]?.value || '';
      const rate = rateInput?.value || '';
      const note = row.querySelector('.line-note-input')?.value || '';
      const lineType = row.dataset.lineType || 'material';
      const markupEnabled = row.dataset.markupEnabled === 'true';
      const markupMode = row.dataset.markupMode || 'percent';
      const markupValue = row.dataset.markupValue || '0';
      const clientRate = getLineClientRate(row);
      if (desc || qty || rate) items.push({
        desc, unit, qty, rate, note, source: row.dataset.sourceName || '',
        lineType, markupEnabled, markupMode, markupValue, clientRate
      });
    });

    // Collect accordion checked items (for restoring state)
    const checkedItems = [];
    document.querySelectorAll('#categorySections .item-card.checked').forEach(card => {
      checkedItems.push({
        name: card.querySelector('.item-card-name').textContent,
        qty: card.querySelector('[data-role="qty"]')?.value || '',
        rate: card.querySelector('[data-role="rate"]')?.value || ''
      });
    });

    return {
      id: currentQuoteId || null,
      quoteNum: document.getElementById('estimateNum').value,
      status: status,
      date: document.getElementById('estimateDate').value,
      validFor: document.getElementById('validFor').value,
      jobDesc: document.getElementById('jobDesc').value,
      clientName: document.getElementById('clientName').value,
      clientPhone: document.getElementById('clientPhone').value,
      clientEmail: document.getElementById('clientEmail').value,
      jobAddress: document.getElementById('jobAddress').value,
      bizName: document.getElementById('bizName').value,
      bizPhone: document.getElementById('bizPhone').value,
      bizEmail: document.getElementById('bizEmail').value,
      bizAddress: document.getElementById('bizAddress').value,
      bizLicense: document.getElementById('bizLicense').value,
      items: items,
      checkedItems: checkedItems,
      notes: document.getElementById('notes').value,
      taxEnabled: taxEnabled,
      taxRate: document.getElementById('taxRateInput').value,
      taxScope: taxScope,
      overheadPercent: overheadPercent,
      overheadVisible: overheadVisible,
      total: document.getElementById('totalDisplay').textContent,
      subtotal: document.getElementById('subtotalDisplay').textContent,
      createdAt: currentQuoteId ? (getQuotes().find(q=>q.id===currentQuoteId)?.createdAt || Date.now()) : Date.now(),
      updatedAt: Date.now()
    };
  }

  async function saveQuote(status) {
    const isNew = !currentQuoteId;
    const data = collectQuoteData(status);
    const quoteId = await dbSaveQuote(data, data.items);
    currentQuoteId = quoteId;
    data.id = quoteId;

    // New-quote quotas are enforced atomically by the database trigger.
    if (isNew && isFree() && _profileCache) {
      _profileCache.quotes_this_month = getQuotasThisMonth() + 1;
    }

    await refreshQuotes();
    return data;
  }

  // ── Animated transitions ──
  function showToast(text, icon) {
    const toast = document.getElementById('toast');
    const iconEl = toast.querySelector('.toast-icon');
    document.getElementById('toastText').textContent = text;
    iconEl.className = 'toast-icon ' + (icon || 'success');
    iconEl.textContent = icon === 'amber' ? '\u2192' : '\u2713';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
  }

  function showSuccessOverlay(callback) {
    const overlay = document.getElementById('successOverlay');
    overlay.classList.add('show');
    setTimeout(() => {
      overlay.classList.remove('show');
      if (callback) callback();
    }, 1000);
  }

  // ══════════════════════════════════
  //  FORM VALIDATION
  // ══════════════════════════════════
  function clearValidation() {
    document.querySelectorAll('.field-error').forEach(el => el.classList.remove('field-error'));
    document.querySelectorAll('.field-error-msg').forEach(el => el.remove());
  }

  function markInvalid(el, msg) {
    el.classList.add('field-error');
    setTimeout(() => el.classList.remove('field-error'), 3000);
    if (msg) {
      const existing = el.parentElement.querySelector('.field-error-msg');
      if (existing) existing.remove();
      const errDiv = document.createElement('div');
      errDiv.className = 'field-error-msg';
      errDiv.textContent = msg;
      el.parentElement.appendChild(errDiv);
      setTimeout(() => errDiv.remove(), 3000);
    }
  }

  function validateQuoteForm() {
    clearValidation();
    let valid = true;
    let firstBad = null;

    const clientName = document.getElementById('clientName');
    const clientEmail = document.getElementById('clientEmail');
    const jobDesc = document.getElementById('jobDesc');

    if (!clientName.value.trim()) {
      markInvalid(clientName, 'Client name is required');
      valid = false; if (!firstBad) firstBad = clientName;
    }
    if (!clientEmail.value.trim()) {
      markInvalid(clientEmail, 'Client email is required');
      valid = false; if (!firstBad) firstBad = clientEmail;
    }
    if (!jobDesc.value.trim()) {
      markInvalid(jobDesc, 'Job description is required');
      valid = false; if (!firstBad) firstBad = jobDesc;
    }

    // Check for at least one line item with qty and rate
    let hasValidItem = false;
    document.querySelectorAll('#lineItemsBody .line-item-row').forEach(row => {
      const desc = (row.querySelector('.line-desc-wrap input') || row.querySelector('input[type="text"]'))?.value || '';
      const inputs = row.querySelectorAll('input[type="number"]');
      const qty = parseFloat(inputs[0]?.value) || 0;
      const rate = parseFloat(inputs[1]?.value) || 0;
      if (desc && qty > 0 && rate > 0) hasValidItem = true;
    });
    if (!hasValidItem) {
      showToast('Add at least one line item with qty and rate');
      valid = false;
    }

    if (firstBad) { firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' }); firstBad.focus(); }
    return valid;
  }

  function validateInvoiceForm() {
    clearValidation();
    let valid = true;
    let firstBad = null;

    const clientName = document.getElementById('invClientName');
    const clientEmail = document.getElementById('invClientEmail');
    const jobDesc = document.getElementById('invDesc');

    if (!clientName.value.trim()) {
      markInvalid(clientName, 'Client name is required');
      valid = false; if (!firstBad) firstBad = clientName;
    }
    if (!clientEmail.value.trim()) {
      markInvalid(clientEmail, 'Client email is required');
      valid = false; if (!firstBad) firstBad = clientEmail;
    }
    if (!jobDesc.value.trim()) {
      markInvalid(jobDesc, 'Job description is required');
      valid = false; if (!firstBad) firstBad = jobDesc;
    }

    let hasValidItem = false;
    document.querySelectorAll('#invLineItemsBody .line-item-row').forEach(row => {
      const desc = (row.querySelector('.line-desc-wrap input') || row.querySelector('input[type="text"]'))?.value || '';
      const inputs = row.querySelectorAll('input[type="number"]');
      const qty = parseFloat(inputs[0]?.value) || 0;
      const rate = parseFloat(inputs[1]?.value) || 0;
      if (desc && qty > 0 && rate > 0) hasValidItem = true;
    });
    if (!hasValidItem) {
      showToast('Add at least one line item with qty and rate');
      valid = false;
    }

    if (firstBad) { firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' }); firstBad.focus(); }
    return valid;
  }

  async function saveDraft() {
    if (!validateQuoteForm()) return;
    await saveQuote('Draft');
    showSuccessOverlay(() => {
      showPage('dashboard');
      showToast('Draft saved');
    });
  }

  async function sendQuote() {
    if (!validateQuoteForm()) return;

    const sendBtn = document.querySelector('.totals-send-btn');
    const origText = sendBtn.textContent;
    sendBtn.textContent = 'Sending…';
    sendBtn.disabled = true;

    try {
      const name = document.getElementById('clientName').value.trim();
      const email = document.getElementById('clientEmail').value.trim();
      const quoteNum = document.getElementById('estimateNum').value || 'Quote';
      const jobDesc = document.getElementById('jobDesc').value || '';
      const total = document.getElementById('totalDisplay').textContent || '$0.00';
      const bizName = document.getElementById('bizName').value || 'Builders Invoice';
      const bizEmail = document.getElementById('bizEmail').value || '';

      // Build shareable doc HTML
      const pdfHtml = buildQuoteHtml();

      // Upload to get shareable link
      const docUrl = await uploadDocumentHtml(pdfHtml, 'quote');

      // Save quote as Sent
      await saveQuote('Sent');

      // Send via EmailJS
      await emailjs.send('service_i3t7fwd', 'template_t619ekw', {
        client_name: name,
        client_email: email,
        doc_type: 'Quote',
        doc_num: quoteNum,
        job_desc: jobDesc ? `Job: ${jobDesc}` : '',
        total: total,
        doc_link: docUrl || '',
        biz_name: bizName,
        biz_email: bizEmail
      });

      showSuccessOverlay(() => {
        showPage('dashboard');
        showToast('Quote emailed to ' + name);
      });

    } catch(e) {
      console.error('sendQuote error:', e);
      showToast('Error sending email — try again');
    } finally {
      sendBtn.textContent = origText;
      sendBtn.disabled = false;
    }
  }

  function buildQuoteHtml() {
    const name = document.getElementById('clientName').value || 'Client';
    const email = document.getElementById('clientEmail').value || '';
    const clientPhone = document.getElementById('clientPhone').value || '';
    const jobAddress = document.getElementById('jobAddress').value || '';
    const quoteNum = document.getElementById('estimateNum').value || 'QT-0001';
    const estDate = document.getElementById('estimateDate').value || '';
    const jobDesc = document.getElementById('jobDesc').value || '';
    const total = document.getElementById('totalDisplay').textContent || '$0.00';
    const subtotal = document.getElementById('subtotalDisplay').textContent || '$0.00';
    const notes = document.getElementById('notes').value || '';
    const bizName = document.getElementById('bizName').value || '';
    const bizPhone = document.getElementById('bizPhone').value || '';
    const bizEmail = document.getElementById('bizEmail').value || '';
    const bizAddress = document.getElementById('bizAddress').value || '';
    const fmtDate = (s) => s ? new Date(s+'T00:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) : '';

    let itemsHtml = '';
    document.querySelectorAll('#lineItemsBody .line-item-row').forEach(row => {
      const desc = (row.querySelector('.line-desc-wrap input') || row.querySelector('input[type="text"]'))?.value || '';
      if (!desc) return;
      const unit = row.querySelector('.unit-select')?.value || '';
      const inputs = row.querySelectorAll('input[type="number"]');
      const qty = parseFloat(inputs[0]?.value) || 0;
      const rate = parseFloat(inputs[1]?.value) || 0;
      const note = row.querySelector('.line-note-input')?.value || '';
      const amt = qty * rate;
      itemsHtml += `<tr><td style="padding:8px 10px;${note ? '' : 'border-bottom:1px solid #E0DBD4;'}font-size:13px;">${escapeHtml(desc)}</td><td style="padding:8px;${note ? '' : 'border-bottom:1px solid #E0DBD4;'}font-size:12px;text-align:center;color:#6B7280;">${unit}</td><td style="padding:8px;${note ? '' : 'border-bottom:1px solid #E0DBD4;'}font-family:monospace;text-align:center;">${qty}</td><td style="padding:8px;${note ? '' : 'border-bottom:1px solid #E0DBD4;'}font-family:monospace;text-align:right;">$${rate.toFixed(2)}</td><td style="padding:8px;${note ? '' : 'border-bottom:1px solid #E0DBD4;'}font-family:monospace;text-align:right;font-weight:600;">$${amt.toFixed(2)}</td></tr>`;
      if (note) {
        itemsHtml += `<tr><td colspan="5" style="padding:2px 10px 8px 24px;border-bottom:1px solid #E0DBD4;font-size:11px;color:#6B7280;font-style:italic;">↳ ${escapeHtml(note)}</td></tr>`;
      }
    });

    // Gather photos
    let photosHtml = '';
    const attachments = document.querySelectorAll('.attach-item');
    if (attachments.length > 0) {
      let imgs = '';
      attachments.forEach(item => {
        const src = item.querySelector('.attach-thumb')?.src;
        const desc = item.querySelector('.attach-desc')?.value || '';
        if (src) imgs += `<div style="margin-bottom:12px;"><img src="${src}" style="width:100%;max-height:250px;object-fit:cover;border:1px solid #E0DBD4;"><div style="font-size:11px;color:#6B7280;margin-top:4px;">${desc ? escapeHtml(desc) : ''}</div></div>`;
      });
      photosHtml = `<div style="margin-top:24px;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#6B7280;margin-bottom:12px;">Photos</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">${imgs}</div></div>`;
    }

    return `<div style="font-family:Arial,sans-serif;color:#1C1C1E;padding:24px;width:780px;">
      <table style="width:100%;margin-bottom:24px;"><tr>
        <td style="vertical-align:top;">
          <div style="display:flex;align-items:center;gap:12px;">
            ${bizLogoData ? `<img src="${bizLogoData}" style="width:48px;height:48px;object-fit:contain;border-radius:8px;">` : ''}
            <div>
              <div style="font-size:20px;font-weight:800;">${escapeHtml(bizName) || 'Builders Invoice'}</div>
              ${bizAddress ? `<div style="font-size:11px;color:#6B7280;">${escapeHtml(bizAddress)}</div>` : ''}
              ${bizPhone || bizEmail ? `<div style="font-size:11px;color:#6B7280;">${[bizPhone,bizEmail].filter(Boolean).map(escapeHtml).join(' | ')}</div>` : ''}
            </div>
          </div>
        </td>
        <td style="vertical-align:top;text-align:right;"><div style="font-size:18px;font-weight:700;">${escapeHtml(quoteNum)}</div><div style="font-size:12px;color:#6B7280;">${fmtDate(estDate)}</div></td>
      </tr></table>
      <hr style="border:none;border-top:2px solid #1C1C1E;margin-bottom:24px;">
      <table style="width:100%;margin-bottom:24px;"><tr>
        <td style="vertical-align:top;width:50%;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#6B7280;margin-bottom:6px;">Prepared For</div><div style="font-weight:600;">${escapeHtml(name)}</div>${clientPhone ? `<div style="font-size:12px;color:#6B7280;">${escapeHtml(clientPhone)}</div>` : ''}${email ? `<div style="font-size:12px;color:#6B7280;">${escapeHtml(email)}</div>` : ''}</td>
        ${jobAddress ? `<td style="vertical-align:top;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#6B7280;margin-bottom:6px;">Job Site</div><div style="font-size:13px;">${escapeHtml(jobAddress)}</div></td>` : ''}
      </tr></table>
      ${jobDesc ? `<div style="margin-bottom:16px;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#6B7280;margin-bottom:6px;">Description</div><div style="font-size:13px;">${escapeHtml(jobDesc)}</div></div>` : ''}
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        <tr style="background:#EDEAE5;"><th style="padding:6px 10px;text-align:left;font-size:10px;font-weight:700;color:#6B7280;">Description</th><th style="padding:6px;text-align:center;font-size:10px;font-weight:700;color:#6B7280;">Unit</th><th style="padding:6px;text-align:center;font-size:10px;font-weight:700;color:#6B7280;">Qty</th><th style="padding:6px;text-align:right;font-size:10px;font-weight:700;color:#6B7280;">Rate</th><th style="padding:6px;text-align:right;font-size:10px;font-weight:700;color:#6B7280;">Amount</th></tr>
        ${itemsHtml}
      </table>
      <table style="width:100%;margin-bottom:20px;"><tr><td></td><td style="width:220px;vertical-align:top;">
        <table style="width:100%;"><tr><td style="padding:4px 0;font-size:13px;color:#6B7280;">Subtotal</td><td style="padding:4px 0;text-align:right;font-family:monospace;font-size:13px;">${subtotal}</td></tr></table>
        <div style="border-top:2px solid #1C1C1E;margin-top:6px;padding-top:8px;"><table style="width:100%;"><tr><td style="font-weight:700;">Total</td><td style="text-align:right;font-size:22px;font-weight:800;">${total}</td></tr></table></div>
      </td></tr></table>
      ${notes ? `<div style="margin-top:20px;padding:12px 16px;background:#F5F2EE;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#6B7280;margin-bottom:4px;">Notes</div><div style="font-size:12px;white-space:pre-wrap;">${escapeHtml(notes)}</div></div>` : ''}
      ${photosHtml}
      ${isFree() ? '<div style="text-align:center;padding:20px 0 10px;"><div style="font-size:11px;color:#B0ACA6;letter-spacing:1px;">Created with</div><div style="font-family:\'Plus Jakarta Sans\',sans-serif;font-size:16px;font-weight:800;color:#B0ACA6;letter-spacing:-0.3px;">Builders<span style="color:#E07A2F;">Invoice</span></div></div>' : ''}
      <table style="width:100%;margin-top:30px;border-top:1px solid #E0DBD4;padding-top:12px;"><tr><td style="font-size:11px;color:#6B7280;">${escapeHtml(bizName) || 'Builders Invoice'}</td><td style="text-align:right;font-size:11px;color:#6B7280;">Thank you for your business.</td></tr></table>
    </div>`;
  }

  function buildPaymentHandlesHtml() {
    const handles = _profileCache?.payment_handles || {};
    const items = [];
    if (handles.cashapp) {
      const tag = escapeHtml(handles.cashapp);
      const url = 'https://cash.app/' + encodeURIComponent(handles.cashapp.replace(/^\$/, '$'));
      items.push(`<div style="margin-bottom:6px;">💵 CashApp: <a href="${url}" target="_blank" style="color:#00D632;font-weight:700;text-decoration:none;">${tag}</a></div>`);
    }
    if (handles.venmo) {
      const tag = escapeHtml(handles.venmo);
      const clean = handles.venmo.replace(/^@/, '');
      const url = 'https://venmo.com/' + encodeURIComponent(clean);
      items.push(`<div style="margin-bottom:6px;">💙 Venmo: <a href="${url}" target="_blank" style="color:#3D95CE;font-weight:700;text-decoration:none;">${tag}</a></div>`);
    }
    if (handles.paypal) {
      const tag = escapeHtml(handles.paypal);
      const clean = handles.paypal.replace(/^@/, '');
      const url = 'https://paypal.me/' + encodeURIComponent(clean);
      items.push(`<div style="margin-bottom:6px;">🅿️ PayPal: <a href="${url}" target="_blank" style="color:#003087;font-weight:700;text-decoration:none;">${tag}</a></div>`);
    }
    if (handles.zelle) {
      items.push(`<div style="margin-bottom:6px;">⚡ Zelle: <strong>${escapeHtml(handles.zelle)}</strong></div>`);
    }
    if (items.length === 0) return '';
    return `<div style="margin-top:20px;padding:16px 20px;background:#F5F2EE;border-radius:8px;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#6B7280;margin-bottom:10px;">Pay With</div><div style="font-size:14px;line-height:1.8;">${items.join('')}</div></div>`;
  }

  async function convertToInvoice() {
    const quoteData = await saveQuote('Accepted');
    try {
      await refreshInvoices();
      const invoices = getInvoices();
      const invDate = new Date().toISOString().split('T')[0];
      const dueD = new Date();
      dueD.setDate(dueD.getDate() + 30);
      const invoice = {
        invoiceNum: generateInvNum(),
        fromQuoteId: quoteData.id,
        fromQuoteNum: quoteData.quoteNum,
        status: 'Unpaid',
        date: invDate,
        dueIn: 30,
        dueDate: dueD.toISOString().split('T')[0],
        clientName: quoteData.clientName,
        clientPhone: quoteData.clientPhone,
        clientEmail: quoteData.clientEmail,
        jobAddress: quoteData.jobAddress,
        jobDesc: quoteData.jobDesc,
        bizName: quoteData.bizName,
        bizPhone: quoteData.bizPhone,
        bizEmail: quoteData.bizEmail,
        bizAddress: quoteData.bizAddress,
        notes: quoteData.notes,
        taxEnabled: quoteData.taxEnabled,
        taxRate: quoteData.taxRate,
        taxScope: quoteData.taxScope || 'all',
        overheadPercent: quoteData.overheadPercent || 0,
        overheadVisible: quoteData.overheadVisible || false,
        total: quoteData.total,
        subtotal: quoteData.subtotal,
      };
      const invId = await dbSaveInvoice(invoice, quoteData.items);
      await refreshInvoices();
      showSuccessOverlay(() => {
        editInvoice(invId);
        showToast('Invoice ' + invoice.invoiceNum + ' created', 'amber');
      });
    } catch(e) {
      alert('Error creating invoice: ' + e.message);
    }
  }

  function loadQuoteFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (!id) return;

    const quotes = getQuotes();
    const q = quotes.find(r => r.id === id);
    if (!q) return;

    currentQuoteId = q.id;

    // Fill fields
    document.getElementById('estimateNum').value = q.quoteNum || '';
    document.getElementById('estimateDate').value = q.date || '';
    document.getElementById('validFor').value = q.validFor || '30';
    document.getElementById('jobDesc').value = q.jobDesc || '';
    document.getElementById('clientName').value = q.clientName || '';
    document.getElementById('clientPhone').value = q.clientPhone || '';
    document.getElementById('clientEmail').value = q.clientEmail || '';
    document.getElementById('jobAddress').value = q.jobAddress || '';
    document.getElementById('bizName').value = q.bizName || '';
    document.getElementById('bizPhone').value = q.bizPhone || '';
    document.getElementById('bizEmail').value = q.bizEmail || '';
    document.getElementById('bizAddress').value = q.bizAddress || '';
    document.getElementById('bizLicense').value = q.bizLicense || '';
    document.getElementById('notes').value = q.notes || '';

    // Load logo from settings
    // Logo already loaded from form fields or settings
    if (bizLogoData) {
      const preview = document.getElementById('logoPreview');
      if (preview) { preview.innerHTML = `<img src="${bizLogoData}" alt="Logo">`; preview.classList.add('has-logo'); }
      const _rmBtn = document.getElementById('logoRemoveBtn'); if (_rmBtn) _rmBtn.style.display = 'inline';
    }

    // Tax
    if (q.taxEnabled) {
      document.getElementById('taxRateInput').value = q.taxRate || '8';
      toggleTax();
    }

    // Restore accordion checked items
    if (q.checkedItems) {
      q.checkedItems.forEach(ci => {
        document.querySelectorAll('.item-card').forEach(card => {
          if (card.querySelector('.item-card-name').textContent === ci.name) {
            const cb = card.querySelector('input[type="checkbox"]');
            cb.checked = true;
            card.classList.add('checked');
            card.querySelectorAll('.item-card-input').forEach(inp => inp.disabled = false);
            const qtyInp = card.querySelector('[data-role="qty"]');
            const rateInp = card.querySelector('[data-role="rate"]');
            if (qtyInp) qtyInp.value = ci.qty;
            if (rateInp) rateInp.value = ci.rate;
          }
        });
      });
    }

    // Restore line items
    document.getElementById('lineItemsBody').innerHTML = '';
    lineCounter = 0;
    if (q.items && q.items.length > 0) {
      q.items.forEach(item => {
        addLine(item.desc, item.unit);
        const rows = document.querySelectorAll('#lineItemsBody .line-item-row');
        const row = rows[rows.length - 1];
        if (item.source) row.dataset.sourceName = item.source;
        const inputs = row.querySelectorAll('input[type="number"]');
        inputs[0].value = item.qty;
        row.querySelector('[data-role="rate"]').value = item.rate;
        // Restore type
        if (item.lineType) {
          row.dataset.lineType = item.lineType;
          const badge = row.querySelector('.line-type-badge');
          if (badge) {
            const info = getTypeBadgeInfo(item.lineType);
            badge.textContent = info.label;
            badge.className = 'line-type-badge ' + info.cls;
          }
          if (item.lineType === 'mylabor') {
            const mBtn = row.querySelector('.line-markup-btn');
            if (mBtn) mBtn.style.display = 'none';
          }
        }
        // Restore markup
        if (item.markupEnabled) {
          row.dataset.markupEnabled = 'true';
          row.dataset.markupMode = item.markupMode || 'percent';
          row.dataset.markupValue = item.markupValue || '0';
          const markupRow = row.querySelector('.line-markup-row');
          const markupBtn = row.querySelector('.line-markup-btn');
          if (markupRow) markupRow.classList.add('show');
          if (markupBtn) markupBtn.classList.add('active');
          const markupInput = row.querySelector('.markup-input');
          if (markupInput) markupInput.value = item.markupValue || '';
          if (item.markupMode === 'flat') {
            const btns = row.querySelectorAll('.markup-mode-btn');
            btns.forEach(b => b.classList.remove('active'));
            btns[1]?.classList.add('active');
          }
        }
        if (item.note) {
          const noteRow = row.querySelector('.line-note-row');
          const noteInput = row.querySelector('.line-note-input');
          const noteBtn = row.querySelector('.line-note-btn');
          if (noteRow) noteRow.style.display = '';
          if (noteInput) noteInput.value = item.note;
          if (noteBtn) noteBtn.classList.add('active');
        }
      });
    }

    calcAll();

    // Update page title
    document.querySelector('.page-title').textContent = 'Edit Quote';
    document.querySelector('.badge').textContent = q.status || 'Draft';
  }

  function autoFillFromSettings() {
    const biz = _profileCache;
    if (!biz) return;
    try {
      if (biz.biz_name) document.getElementById('bizName').value = biz.biz_name;
      if (biz.biz_phone) document.getElementById('bizPhone').value = biz.biz_phone;
      if (biz.biz_email) document.getElementById('bizEmail').value = biz.biz_email;
      if (biz.biz_address) document.getElementById('bizAddress').value = biz.biz_address;
      if (biz.biz_license) document.getElementById('bizLicense').value = biz.biz_license;
      if (biz.default_tax_rate) document.getElementById('taxRateInput').value = biz.default_tax_rate;
      if (biz.default_valid_days) document.getElementById('validFor').value = biz.default_valid_days;
      if (biz.default_notes) document.getElementById('notes').value = biz.default_notes;
      if (biz.biz_logo_url) {
        bizLogoData = biz.biz_logo_url;
        const preview = document.getElementById('logoPreview');
        if (preview) { preview.innerHTML = `<img src="${bizLogoData}" alt="Logo">`; preview.classList.add('has-logo'); }
        const _rmBtn = document.getElementById('logoRemoveBtn'); if (_rmBtn) _rmBtn.style.display = 'inline';
      }
      document.getElementById('estimateNum').value = generateQuoteNum();
    } catch(e) { console.warn('Auto-fill error:', e); }
  }

  function autoFillInvFromSettings() {
    const biz = _profileCache;
    if (!biz) return;
    try {
      if (biz.biz_name) document.getElementById('invBizName').value = biz.biz_name;
      if (biz.biz_phone) document.getElementById('invBizPhone').value = biz.biz_phone;
      if (biz.biz_email) document.getElementById('invBizEmail').value = biz.biz_email;
      if (biz.biz_address) document.getElementById('invBizAddress').value = biz.biz_address;
    } catch(e) { console.warn('Invoice auto-fill error:', e); }
  }

  function resetForm() {
    if (confirm('Discard this quote?')) {
      showPage('dashboard');
    }
  }

  // ══════════════════════════════════
  //  PAGE ROUTER
  // ══════════════════════════════════
  function showPage(page) {
    // Redirect old pages to jobs
    if (page === 'dashboard' || page === 'invoices') page = 'jobs';

    // Free tier gates
    if (page === 'clients' && isFree()) {
      showUpgradePrompt('Customer database requires <strong>Pro</strong>. Upgrade to save and reuse client info.', 'pro');
      return;
    }
    if (page === 'invoice-edit' && isFree()) {
      showUpgradePrompt('Invoicing requires <strong>Pro</strong>. Upgrade to create invoices and track payments.', 'pro');
      return;
    }
    if (page === 'pnl' && getUserTier() !== 'business') {
      showUpgradePrompt('Profit & Loss tracking requires <strong>Business</strong>. Upgrade to track expenses and see job profitability.', 'business');
      return;
    }

    document.querySelectorAll('.page-section').forEach(p => p.style.display = 'none');
    const el = document.getElementById('page-' + page);
    if (el) el.style.display = 'block';

    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    if (page === 'home') document.getElementById('navHome').classList.add('active');
    if (page === 'jobs' || page === 'quote' || page === 'invoice-edit') document.getElementById('navJobs').classList.add('active');
    if (page === 'clients') document.getElementById('navClients').classList.add('active');
    if (page === 'pnl') document.getElementById('navPnl').classList.add('active');
    if (page === 'settings') document.getElementById('navSettings').classList.add('active');

    window.scrollTo(0, 0);

    if (page === 'home') { Promise.all([refreshQuotes(), refreshInvoices()]).then(() => renderHome()); }
    if (page === 'jobs') { Promise.all([refreshQuotes(), refreshInvoices()]).then(() => renderJobs()); }
    if (page === 'settings') { dbGetProfile(true).then(p => loadSettingsFromProfile(p)); }
    if (page === 'clients') { refreshClients().then(() => renderClients()); }
    if (page === 'pnl') { Promise.all([refreshQuotes(), refreshInvoices(), refreshExpenses()]).then(() => renderPnl()); }
  }

  // ══════════════════════════════════
  //  JOBS PAGE
  // ══════════════════════════════════
  let currentJobFilter = 'all';

  function setJobFilter(f, el) {
    currentJobFilter = f;
    document.querySelectorAll('#page-jobs .filter-pill').forEach(p => p.classList.toggle('active', p.dataset.filter === f));
    renderJobs();
  }

  function getJobStatus(quote, invoice) {
    if (invoice) {
      if (invoice.status === 'Paid') return { label: 'Paid', class: 'status-paid', phase: 'paid', border: 'border-green' };
      if (invoice.status === 'Overdue') return { label: 'Overdue', class: 'status-overdue', phase: 'invoiced', border: 'border-amber' };
      return { label: 'Invoice ' + (invoice.status || 'Unpaid'), class: 'status-unpaid', phase: 'invoiced', border: 'border-amber' };
    }
    if (quote) {
      if (quote.status === 'Declined') return { label: 'Declined', class: 'status-declined', phase: 'declined', border: 'border-red' };
      if (quote.status === 'Accepted') return { label: 'Accepted', class: 'status-accepted', phase: 'accepted', border: 'border-blue' };
      if (quote.status === 'Sent') return { label: 'Quote Sent', class: 'status-sent', phase: 'quoting', border: 'border-blue' };
      return { label: 'Quote Draft', class: 'status-draft', phase: 'quoting', border: 'border-gray' };
    }
    return { label: 'Draft', class: 'status-draft', phase: 'quoting', border: 'border-gray' };
  }

  function renderJobs() {
    const quotes = getQuotes();
    const invoices = getInvoices();
    const search = (document.getElementById('jobSearchInput')?.value || '').toLowerCase();

    // Build jobs: merge quotes with linked invoices
    const jobs = [];
    const invoicesByQuote = {};
    const standaloneInvoices = [];

    invoices.forEach(inv => {
      if (inv.fromQuoteId) {
        invoicesByQuote[inv.fromQuoteId] = inv;
      } else {
        standaloneInvoices.push(inv);
      }
    });

    quotes.forEach(q => {
      const inv = invoicesByQuote[q.id] || null;
      const status = getJobStatus(q, inv);
      jobs.push({
        title: q.jobDesc || 'Untitled Job',
        client: q.clientName || '—',
        amount: inv ? inv.total : q.total,
        date: inv ? inv.date : q.date,
        quoteNum: q.quoteNum,
        invoiceNum: inv?.invoiceNum || null,
        status: status,
        quote: q,
        invoice: inv,
        updatedAt: Math.max(q.updatedAt || 0, inv?.updatedAt || 0)
      });
    });

    standaloneInvoices.forEach(inv => {
      const status = getJobStatus(null, inv);
      jobs.push({
        title: inv.jobDesc || 'Untitled Job',
        client: inv.clientName || '—',
        amount: inv.total,
        date: inv.date,
        quoteNum: null,
        invoiceNum: inv.invoiceNum,
        status: status,
        quote: null,
        invoice: inv,
        updatedAt: inv.updatedAt || 0
      });
    });

    let filtered = jobs;
    if (currentJobFilter !== 'all') {
      filtered = jobs.filter(j => j.status.phase === currentJobFilter);
    }
    if (search) {
      filtered = filtered.filter(j =>
        j.title.toLowerCase().includes(search) ||
        j.client.toLowerCase().includes(search) ||
        (j.quoteNum || '').toLowerCase().includes(search) ||
        (j.invoiceNum || '').toLowerCase().includes(search)
      );
    }

    filtered.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    if (filtered.length === 0) {
      document.getElementById('jobsList').style.display = 'none';
      document.getElementById('jobsEmpty').style.display = '';
      return;
    }
    document.getElementById('jobsList').style.display = '';
    document.getElementById('jobsEmpty').style.display = 'none';

    document.getElementById('jobsList').innerHTML = filtered.map(j => {
      const q = j.quote;
      const inv = j.invoice;
      const docNum = j.invoiceNum && j.quoteNum
        ? `${j.quoteNum} → ${j.invoiceNum}`
        : (j.quoteNum || j.invoiceNum || '');

      // Determine single next-step action
      let actionHtml = '';
      if (q && !inv) {
        if (q.status === 'Draft') {
          actionHtml = `<button class="job-card-action action-edit" onclick="event.stopPropagation();editQuote('${q.id}')">Edit →</button>`;
        } else if (q.status === 'Sent') {
          actionHtml = `<button class="job-card-action action-accept" onclick="event.stopPropagation();quickStatus('${q.id}','Accepted')">Accept ✓</button>`;
        } else if (q.status === 'Accepted') {
          actionHtml = `<button class="job-card-action action-invoice" onclick="event.stopPropagation();convertToInvoiceFromDash('${q.id}')">Create Invoice →</button>`;
        }
      } else if (inv && inv.status !== 'Paid') {
        actionHtml = `<button class="job-card-action action-paid" onclick="event.stopPropagation();quickMarkPaid('${inv.id}')">Mark Paid</button>`;
      }

      const onclick = inv ? `editInvoice('${inv.id}')` : (q ? `editQuote('${q.id}')` : '');
      const jobId = `job_${q?.id || inv?.id || ''}`;

      return `<div class="job-card ${j.status.border}" onclick="${onclick}">
        <div class="job-card-info">
          <div class="job-card-title">${escapeHtml(j.title)}</div>
          <div class="job-card-sub">
            <span>${escapeHtml(j.client)}</span>
            <span style="font-family:var(--font-mono);font-size:10px;">${escapeHtml(docNum)}</span>
            <span>${formatDate(j.date)}</span>
            <span class="status-badge ${j.status.class}">${j.status.label}</span>
          </div>
        </div>
        <div class="job-card-right">
          <div class="job-card-amount">${j.amount || '$0.00'}</div>
          ${actionHtml}
          <button class="job-card-more" onclick="event.stopPropagation();toggleJobMenu('${jobId}')" title="More">⋯</button>
        </div>
        <div class="job-card-menu" id="${jobId}_menu" style="display:none;">
          ${inv ? `<button onclick="event.stopPropagation();editInvoice('${inv.id}');closeJobMenus()">Edit Invoice</button>` : ''}
          ${q && !inv ? `<button onclick="event.stopPropagation();editQuote('${q.id}');closeJobMenus()">Edit Quote</button>` : ''}
          ${q && q.status === 'Sent' ? `<button onclick="event.stopPropagation();quickStatus('${q.id}','Declined');closeJobMenus()">Decline Quote</button>` : ''}
          <button class="danger" onclick="event.stopPropagation();deleteJob('${q?.id||''}','${inv?.id||''}');closeJobMenus()">Delete</button>
        </div>
      </div>`;
    }).join('');
  }

  async function quickMarkPaid(invId) {
    await sb.from('invoices').update({ status: 'Paid' }).eq('id', invId);
    await refreshInvoices();
    renderJobs();
    showToast('Invoice marked as Paid');
  }

  function toggleJobMenu(jobId) {
    const menu = document.getElementById(jobId + '_menu');
    const wasOpen = menu.style.display !== 'none';
    closeJobMenus();
    if (!wasOpen) menu.style.display = '';
  }

  function closeJobMenus() {
    document.querySelectorAll('.job-card-menu').forEach(m => m.style.display = 'none');
  }

  // Close menus on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.job-card-more') && !e.target.closest('.job-card-menu')) {
      closeJobMenus();
    }
  });

  async function deleteJob(quoteId, invoiceId) {
    if (!confirm('Delete this job?')) return;
    if (invoiceId) await dbDeleteInvoice(invoiceId);
    if (quoteId) await dbDeleteQuote(quoteId);
    await Promise.all([refreshQuotes(), refreshInvoices()]);
    renderJobs();
  }

  function renderHome() {
    // Greeting based on time of day
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const userName = document.getElementById('navUserName').textContent || '';
    document.getElementById('homeGreeting').textContent = userName ? `${greeting}, ${userName.split(' ')[0]}` : greeting;

    const invoices = getInvoices();
    const quotes = getQuotes();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Revenue this month (paid invoices in current month)
    const paidThisMonth = invoices.filter(inv => {
      if (inv.status !== 'Paid') return false;
      const d = inv.date ? new Date(inv.date + 'T00:00:00') : null;
      return d && d >= monthStart;
    });
    const revenueAmt = paidThisMonth.reduce((s, inv) => s + (parseFloat(inv.total?.replace(/[$,]/g, '')) || 0), 0);
    document.getElementById('homeRevenue').textContent = formatMoney(revenueAmt);
    document.getElementById('homeRevenueSub').textContent = paidThisMonth.length + ' paid invoice' + (paidThisMonth.length !== 1 ? 's' : '');

    // Outstanding (unpaid + overdue)
    const unpaid = invoices.filter(inv => inv.status === 'Unpaid' || inv.status === 'Overdue');
    const outstandingAmt = unpaid.reduce((s, inv) => s + (parseFloat(inv.total?.replace(/[$,]/g, '')) || 0), 0);
    document.getElementById('homeOutstanding').textContent = formatMoney(outstandingAmt);
    document.getElementById('homeOutstandingSub').textContent = unpaid.length + ' unpaid invoice' + (unpaid.length !== 1 ? 's' : '');

    // Total earned (all-time paid)
    const allPaid = invoices.filter(inv => inv.status === 'Paid');
    const totalEarned = allPaid.reduce((s, inv) => s + (parseFloat(inv.total?.replace(/[$,]/g, '')) || 0), 0);
    document.getElementById('homeTotalEarned').textContent = formatMoney(totalEarned);
    document.getElementById('homeTotalSub').textContent = allPaid.length + ' invoice' + (allPaid.length !== 1 ? 's' : '') + ' all-time';

    // Overdue invoices
    const overdue = invoices.filter(inv => {
      if (inv.status === 'Paid') return false;
      if (!inv.dueDate && !inv.date) return false;
      const dueDate = inv.dueDate || inv.date;
      return new Date(dueDate + 'T23:59:59') < now;
    });
    document.getElementById('homeOverdueCount').textContent = overdue.length;
    if (overdue.length === 0) {
      document.getElementById('homeOverdueList').innerHTML = '<div style="color:var(--green);font-size:12px;">✓ All caught up!</div>';
    } else {
      document.getElementById('homeOverdueList').innerHTML = overdue.slice(0, 5).map(inv =>
        `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border-soft,#EBE7E1);cursor:pointer;" onclick="editInvoice('${inv.id}')">
          <span style="color:var(--ink);font-weight:500;">${escapeHtml(inv.clientName || 'Unknown')}</span>
          <span style="font-family:var(--font-mono);color:var(--red);font-weight:600;">${inv.total || '$0'}</span>
        </div>`
      ).join('');
    }

    // Quotes awaiting response (status = Sent)
    const awaiting = quotes.filter(q => q.status === 'Sent');
    document.getElementById('homeAwaitingCount').textContent = awaiting.length;
    if (awaiting.length === 0) {
      document.getElementById('homeAwaitingList').innerHTML = '<div style="color:var(--green);font-size:12px;">✓ No pending quotes</div>';
    } else {
      document.getElementById('homeAwaitingList').innerHTML = awaiting.slice(0, 5).map(q =>
        `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border-soft,#EBE7E1);cursor:pointer;" onclick="editQuote('${q.id}')">
          <span style="color:var(--ink);font-weight:500;">${escapeHtml(q.clientName || q.jobDesc || 'Untitled')}</span>
          <span style="font-family:var(--font-mono);color:var(--amber);font-weight:600;">${q.total || '$0'}</span>
        </div>`
      ).join('');
    }

    // Free tier quota indicator
    let quotaEl = document.getElementById('homeQuotaBar');
    if (isFree()) {
      const used = getQuotasThisMonth();
      const pct = Math.min((used / FREE_QUOTE_LIMIT) * 100, 100);
      const full = used >= FREE_QUOTE_LIMIT;
      if (!quotaEl) {
        quotaEl = document.createElement('div');
        quotaEl.id = 'homeQuotaBar';
        const container = document.querySelector('#page-home .dash-container');
        const header = container.querySelector('.page-header');
        header.parentNode.insertBefore(quotaEl, header.nextSibling);
      }
      quotaEl.className = 'quota-indicator';
      quotaEl.innerHTML = `
        <span class="qi-text"><strong>${used}</strong> / ${FREE_QUOTE_LIMIT} quotes</span>
        <div class="qi-bar"><div class="qi-fill ${full ? 'full' : ''}" style="width:${pct}%"></div></div>
        <span style="font-size:11px;color:var(--gray);">Free Plan</span>
      `;
    } else if (quotaEl) {
      quotaEl.remove();
    }
  }

  function newQuote() {
    // Free tier: 3 quotes/month limit
    if (!hasQuoteQuota()) {
      const used = getQuotasThisMonth();
      showUpgradePrompt(`You've used all <strong>${used}/${FREE_QUOTE_LIMIT} free quotes</strong> this month. Upgrade to Pro for unlimited quotes.`, 'pro');
      return;
    }
    currentQuoteId = null;
    try {
      document.querySelectorAll('#page-quote input:not([readonly]), #page-quote textarea').forEach(el => el.value = '');
      dateInput.value = today.toISOString().split('T')[0];
      if (taxEnabled) toggleTax();
      // Reset O&P
      if (document.getElementById('opToggle')?.classList.contains('on')) toggleOP();
      overheadPercent = 0; overheadVisible = false;
      document.querySelectorAll('#categorySections .item-card').forEach(card => {
        card.classList.remove('checked');
        const cb = card.querySelector('.item-check input');
        if (cb) cb.checked = false;
        card.querySelectorAll('.item-card-input').forEach(inp => { inp.disabled = true; inp.value = ''; });
        const tot = card.querySelector('.item-card-total');
        if (tot) tot.textContent = '';
      });
      document.querySelectorAll('#categorySections .cat-subtotal').forEach(el => { el.textContent = '$0.00'; el.classList.remove('has-value'); });
      document.querySelectorAll('#categorySections .cat-section.open').forEach(s => s.classList.remove('open'));
      document.getElementById('lineItemsBody').innerHTML = '';
      lineCounter = 0;
      document.querySelectorAll('.attach-item').forEach(el => el.remove());
      attachCounter = 0;
      try { updateAttachCount(); } catch(e) {}
      bizLogoData = null;
      const title = document.querySelector('#page-quote .page-title');
      if (title) title.textContent = 'New Quote';
      const badge = document.querySelector('#page-quote .badge');
      if (badge) badge.textContent = 'Draft';
      try { calcAll(); } catch(e) {}
    } catch(e) { console.error('newQuote error:', e); }

    // Show page immediately
    showPage('quote');

    // Auto-fill from cached profile (synchronous)
    autoFillFromSettings();
  }

  function editQuote(id) {
    currentQuoteId = id;
    // Reset first
    document.querySelectorAll('#page-quote input:not([readonly]), #page-quote textarea').forEach(el => el.value = '');
    document.querySelectorAll('.item-card').forEach(card => {
      card.classList.remove('checked');
      card.querySelector('.item-check input').checked = false;
      card.querySelectorAll('.item-card-input').forEach(inp => { inp.disabled = true; inp.value = ''; });
      card.querySelector('.item-card-total').textContent = '';
    });
    document.querySelectorAll('.cat-section.open').forEach(s => s.classList.remove('open'));
    document.getElementById('lineItemsBody').innerHTML = '';
    lineCounter = 0;
    bizLogoData = null;

    const q = getQuotes().find(r => r.id === id);
    if (!q) return;

    document.getElementById('estimateNum').value = q.quoteNum || '';
    document.getElementById('estimateDate').value = q.date || '';
    document.getElementById('validFor').value = q.validFor || '30';
    document.getElementById('jobDesc').value = q.jobDesc || '';
    document.getElementById('clientName').value = q.clientName || '';
    document.getElementById('clientPhone').value = q.clientPhone || '';
    document.getElementById('clientEmail').value = q.clientEmail || '';
    document.getElementById('jobAddress').value = q.jobAddress || '';
    document.getElementById('bizName').value = q.bizName || '';
    document.getElementById('bizPhone').value = q.bizPhone || '';
    document.getElementById('bizEmail').value = q.bizEmail || '';
    document.getElementById('bizAddress').value = q.bizAddress || '';
    document.getElementById('bizLicense').value = q.bizLicense || '';
    document.getElementById('notes').value = q.notes || '';

    // Load logo from settings
    // Logo already loaded from form fields or settings
    if (bizLogoData) {
      const preview = document.getElementById('logoPreview');
      if (preview) { preview.innerHTML = `<img src="${bizLogoData}" alt="Logo">`; preview.classList.add('has-logo'); }
      const _rmBtn = document.getElementById('logoRemoveBtn'); if (_rmBtn) _rmBtn.style.display = 'inline';
    }

    if (q.taxEnabled && !taxEnabled) {
      document.getElementById('taxRateInput').value = q.taxRate || '8';
      toggleTax();
    }

    // Restore O&P
    if (q.overheadPercent > 0) {
      document.getElementById('opRateInput').value = q.overheadPercent;
      if (!document.getElementById('opToggle').classList.contains('on')) toggleOP();
      overheadVisible = q.overheadVisible || false;
      if (overheadVisible) {
        const btns = document.querySelectorAll('#opRow .tax-scope-btn');
        btns.forEach(b => b.classList.remove('active'));
        btns[1]?.classList.add('active');
      }
    }

    if (q.checkedItems) {
      q.checkedItems.forEach(ci => {
        document.querySelectorAll('.item-card').forEach(card => {
          if (card.querySelector('.item-card-name').textContent === ci.name) {
            const cb = card.querySelector('input[type="checkbox"]');
            cb.checked = true;
            card.classList.add('checked');
            card.querySelectorAll('.item-card-input').forEach(inp => inp.disabled = false);
            if (ci.qty) card.querySelector('[data-role="qty"]').value = ci.qty;
            if (ci.rate) card.querySelector('[data-role="rate"]').value = ci.rate;
          }
        });
      });
    }

    if (q.items && q.items.length > 0) {
      q.items.forEach(item => {
        addLine(item.desc, item.unit);
        const rows = document.querySelectorAll('.line-item-row');
        const row = rows[rows.length - 1];
        if (item.source) row.dataset.sourceName = item.source;
        row.querySelectorAll('input[type="number"]')[0].value = item.qty;
        row.querySelectorAll('input[type="number"]')[1].value = item.rate;
        if (item.note) {
          const noteRow = row.querySelector('.line-note-row');
          const noteInput = row.querySelector('.line-note-input');
          const noteBtn = row.querySelector('.line-note-btn');
          if (noteRow) noteRow.style.display = '';
          if (noteInput) noteInput.value = item.note;
          if (noteBtn) noteBtn.classList.add('active');
        }
      });
    }

    calcAll();
    document.querySelector('#page-quote .page-title').textContent = 'Edit Quote';
    document.querySelector('#page-quote .badge').textContent = q.status || 'Draft';
    showPage('quote');
  }

  // ══════════════════════════════════
  //  DASHBOARD
  // ══════════════════════════════════
  let currentFilter = 'all';
  let currentDashView = 'table';

  function setFilter(f, el) {
    currentFilter = f;
    document.querySelectorAll('.filter-pill').forEach(p => p.classList.toggle('active', p.dataset.filter === f));
    renderJobs();
  }
  function setView(v) {
    currentDashView = v;
    document.getElementById('viewTable').classList.toggle('active', v === 'table');
    document.getElementById('viewCards').classList.toggle('active', v === 'cards');
    document.getElementById('tableView').style.display = v === 'table' ? '' : 'none';
    document.getElementById('cardView').style.display = v === 'cards' ? '' : 'none';
    renderJobs();
  }

  function formatDate(d) {
    if (!d) return '—';
    const dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
  }
  function statusClass(s) { return 'status-' + (s||'draft').toLowerCase(); }

  function renderDashboard() {
    const allQuotes = getQuotes();
    let quotes = allQuotes.slice();
    const q = (document.getElementById('searchInput')?.value || '').toLowerCase();
    if (currentFilter !== 'all') quotes = quotes.filter(r => r.status === currentFilter);
    if (q) quotes = quotes.filter(r => (r.clientName||'').toLowerCase().includes(q) || (r.quoteNum||'').toLowerCase().includes(q) || (r.jobDesc||'').toLowerCase().includes(q));
    quotes.sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0));

    document.getElementById('statTotal').textContent = allQuotes.length;
    document.getElementById('statDraft').textContent = allQuotes.filter(r=>r.status==='Draft').length;
    document.getElementById('statSent').textContent = allQuotes.filter(r=>r.status==='Sent').length;
    document.getElementById('statValue').textContent = formatMoney(allQuotes.reduce((s,r) => s + (parseFloat(r.total?.replace(/[$,]/g,''))||0), 0));

    if (quotes.length === 0) {
      document.getElementById('emptyState').style.display = '';
      document.getElementById('tableView').style.display = 'none';
      document.getElementById('cardView').style.display = 'none';
      return;
    }
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('tableView').style.display = currentDashView === 'table' ? '' : 'none';
    document.getElementById('cardView').style.display = currentDashView === 'cards' ? '' : 'none';

    document.getElementById('tableBody').innerHTML = quotes.map(r => `
      <div class="qt-row" onclick="editQuote('${r.id}')">
        <div><div class="qt-client">${escapeHtml(r.jobDesc||'Untitled Quote')}</div><div class="qt-client-sub">${escapeHtml(r.clientName||'—')}</div></div>
        <div class="qt-num">${escapeHtml(r.quoteNum||'')}</div>
        <div><span class="status-badge ${statusClass(r.status)}">${r.status||'Draft'}</span></div>
        <div class="qt-date">${formatDate(r.date)}</div>
        <div class="qt-amount">${r.total||'$0.00'}</div>
        <div class="qt-actions" onclick="event.stopPropagation()">
          ${r.status === 'Sent' ? `<button class="qt-action-btn" onclick="quickStatus('${r.id}','Accepted')" title="Mark Accepted" style="color:var(--green);">✓</button><button class="qt-action-btn" onclick="quickStatus('${r.id}','Declined')" title="Mark Declined" style="color:var(--red);">✗</button>` : ''}
          ${r.status === 'Accepted' ? `<button class="qt-action-btn" onclick="convertToInvoiceFromDash('${r.id}')" title="Convert to Invoice" style="color:var(--amber);">→$</button>` : ''}
          <button class="qt-action-btn" onclick="duplicateQuote('${r.id}')" title="Duplicate">⧉</button>
          <button class="qt-action-btn danger" onclick="deleteQuote('${r.id}')" title="Delete">×</button>
        </div>
      </div>`).join('');

    document.getElementById('cardBody').innerHTML = quotes.map(r => `
      <div class="q-card" onclick="editQuote('${r.id}')">
        <div class="q-card-top"><div><div class="q-card-client">${escapeHtml(r.jobDesc||'Untitled Quote')}</div><div class="q-card-num">${escapeHtml(r.quoteNum||'')}</div></div>
          <span class="status-badge ${statusClass(r.status)}">${r.status||'Draft'}</span></div>
        <div class="q-card-desc">${escapeHtml(r.clientName||'No client')}</div>
        <div class="q-card-bottom"><div class="q-card-amount">${r.total||'$0.00'}</div><div class="q-card-date">${formatDate(r.date)}</div></div>
        <div class="q-card-actions" onclick="event.stopPropagation()">
          ${r.status === 'Sent' ? `<button class="qt-action-btn" onclick="quickStatus('${r.id}','Accepted')" title="Accept" style="color:var(--green);">✓</button><button class="qt-action-btn" onclick="quickStatus('${r.id}','Declined')" title="Decline" style="color:var(--red);">✗</button>` : ''}
          ${r.status === 'Accepted' ? `<button class="qt-action-btn" onclick="convertToInvoiceFromDash('${r.id}')" title="Invoice" style="color:var(--amber);">→$</button>` : ''}
          <button class="qt-action-btn" onclick="duplicateQuote('${r.id}')" title="Duplicate">⧉</button>
          <button class="qt-action-btn danger" onclick="deleteQuote('${r.id}')" title="Delete">×</button>
        </div>
      </div>`).join('');
  }

  async function duplicateQuote(id) {
    const quotes = getQuotes();
    const orig = quotes.find(q => q.id === id);
    if (!orig) return;
    const dupe = JSON.parse(JSON.stringify(orig));
    dupe.id = null; // let Supabase generate new UUID
    dupe.quoteNum = generateQuoteNum();
    dupe.status = 'Draft';
    const items = (orig.items || []).map(i => ({ desc: i.description || i.desc, unit: i.unit, qty: i.qty, rate: i.rate, source: i.source_name || i.source || '' }));
    await dbSaveQuote(dupe, items);
    await refreshQuotes();
    renderJobs();
  }

  async function quickStatus(id, newStatus) {
    await sb.from('quotes').update({ status: newStatus }).eq('id', id);
    await refreshQuotes();
    renderJobs();
    showToast(`Quote marked as ${newStatus}`);
  }

  async function convertToInvoiceFromDash(id) {
    if (isFree()) {
      showUpgradePrompt('Invoicing requires <strong>Pro</strong>. Upgrade to convert quotes to invoices.', 'pro');
      return;
    }
    const quotes = getQuotes();
    const q = quotes.find(qt => qt.id === id);
    if (!q) return;


    // Mark quote as Accepted
    await sb.from('quotes').update({ status: 'Accepted' }).eq('id', id);

    // Create invoice from quote data
    await refreshInvoices();
    const invoices = getInvoices();
    const invDate = new Date().toISOString().split('T')[0];
    const dueD = new Date();
    dueD.setDate(dueD.getDate() + 30);

    const invoice = {
      id: null,
      invoiceNum: generateInvNum(),
      fromQuoteId: q.id,
      fromQuoteNum: q.quoteNum,
      status: 'Unpaid',
      date: invDate,
      dueIn: q.validFor || 30,
      dueDate: dueD.toISOString().split('T')[0],
      clientName: q.clientName,
      clientPhone: q.clientPhone,
      clientEmail: q.clientEmail,
      jobAddress: q.jobAddress,
      jobDesc: q.jobDesc,
      bizName: q.bizName || (_profileCache?.biz_name || ''),
      bizPhone: q.bizPhone || (_profileCache?.biz_phone || ''),
      bizEmail: q.bizEmail || (_profileCache?.biz_email || ''),
      bizAddress: q.bizAddress || (_profileCache?.biz_address || ''),
      notes: q.notes,
      taxEnabled: q.taxEnabled,
      taxRate: q.taxRate,
      taxScope: q.taxScope || 'all',
      overheadPercent: q.overheadPercent || 0,
      overheadVisible: q.overheadVisible || false,
      subtotal: q.subtotal,
      total: q.total,
    };

    const items = (q.items || []).map(i => ({
      desc: i.description || i.desc || '',
      unit: i.unit || 'each',
      qty: i.qty || 0,
      rate: i.rate || 0,
      note: i.note || '',
      source: i.source_name || i.source || '',
      lineType: i.lineType || i.line_type || 'material',
      markupEnabled: i.markupEnabled || i.markup_enabled || false,
      markupMode: i.markupMode || i.markup_mode || 'percent',
      markupValue: i.markupValue || i.markup_value || 0,
      clientRate: i.clientRate || i.client_rate || i.rate || 0,
    }));


    const invId = await dbSaveInvoice(invoice, items);

    if (!invId) {
      showToast('Error creating invoice');
      return;
    }

    await refreshInvoices();
    await refreshQuotes();

    // Open the new invoice for editing
    editInvoice(invId);
    showToast('Invoice created from quote — review and send');
  }

  async function deleteQuote(id) {
    if (!confirm('Delete this quote?')) return;
    await dbDeleteQuote(id);
    await refreshQuotes();
    renderJobs();
  }

  // ══════════════════════════════════
  //  SETTINGS PAGE
  // ══════════════════════════════════
  const PAYMENT_OPTIONS = ['Card','Cash','Check','Zelle','Venmo','CashApp','PayPal','ACH','Financing'];
  let settingsLogoData = null;
  let activePayments = new Set(PAYMENT_OPTIONS);

  function loadSettingsPage() { /* replaced by loadSettingsFromProfile */ }

  function loadSettingsFromProfile(data) {
    if (!data) data = {};
    document.getElementById('sBizName').value = data.biz_name || '';
    document.getElementById('sBizPhone').value = data.biz_phone || '';
    document.getElementById('sBizEmail').value = data.biz_email || '';
    document.getElementById('sBizAddress').value = data.biz_address || '';
    document.getElementById('sBizLicense').value = data.biz_license || '';
    document.getElementById('sDefaultTax').value = data.default_tax_rate || '';
    document.getElementById('sDefaultValid').value = data.default_valid_days || '30';
    document.getElementById('sDefaultNotes').value = data.default_notes || '';
    if (data.biz_logo_url) {
      settingsLogoData = data.biz_logo_url;
      document.getElementById('settingsLogoPreview').innerHTML = `<img src="${settingsLogoData}" alt="Logo">`;
      document.getElementById('settingsLogoPreview').classList.add('has-logo');
      document.getElementById('settingsLogoRemove').style.display = 'inline';
    } else {
      settingsLogoData = null;
    }
    if (data.payments) activePayments = new Set(data.payments);

    // Payment handles
    const handles = data.payment_handles || {};
    document.getElementById('sHandleCashApp').value = handles.cashapp || '';
    document.getElementById('sHandleVenmo').value = handles.venmo || '';
    document.getElementById('sHandlePayPal').value = handles.paypal || '';
    document.getElementById('sHandleZelle').value = handles.zelle || '';

    // Stripe Connect status
    updateStripeUI(data);

    // Plan management
    renderSettingsPlan();
  }

  // ══════════════════════════════════
  //  SETTINGS — PLAN MANAGEMENT
  // ══════════════════════════════════
  function renderSettingsPlan() {
    const tier = getUserTier();
    const container = document.getElementById('settingsPlanCard');
    if (!container) return;

    const plans = {
      free:     { name: 'Free', icon: '📋', price: '$0', priceSub: 'forever', color: 'rgba(255,255,255,0.4)' },
      pro:      { name: 'Pro', icon: '⚡', price: '$49.99', priceSub: '/month', color: '#E07A2F' },
      business: { name: 'Business', icon: '🚀', price: '$99.99', priceSub: '/month', color: '#6ee7b7' },
    };
    const current = plans[tier];

    const allFeatures = [
      { text: '3 quotes/month',           tiers: ['free'] },
      { text: 'Unlimited quotes',          tiers: ['pro','business'] },
      { text: 'Unlimited invoices',        tiers: ['pro','business'] },
      { text: 'Basic templates',           tiers: ['free','pro','business'] },
      { text: 'Customer database',         tiers: ['pro','business'] },
      { text: 'No watermark on PDFs',tiers: ['pro','business'] },
      { text: 'Email quotes & invoices',   tiers: ['pro','business'] },
      { text: 'Payment tracking',          tiers: ['pro','business'] },
      { text: 'Cloud sync',               tiers: ['pro','business'] },
      { text: 'Expense tracking',          tiers: ['business'] },
      { text: 'Profit & Loss reports',     tiers: ['business'] },
      { text: 'Job profitability',         tiers: ['business'] },
      { text: 'PDF financial exports',     tiers: ['business'] },
      { text: 'Accept Stripe payments',    tiers: ['business'] },
    ];

    const featuresHtml = allFeatures.map(f => {
      const has = f.tiers.includes(tier);
      return `<div class="plan-feature ${has ? 'included' : 'locked'}"><span class="pf-icon">${has ? '✓' : '✗'}</span>${f.text}</div>`;
    }).join('');

    const tierOrder = { free: 0, pro: 1, business: 2 };

    // Features per tier for the expandable cards
    const tierFeatures = {
      free: [
        { text: '3 quotes per month', has: true },
        { text: 'Basic templates', has: true },
        { text: 'PDF generation', has: true },
        { text: 'Watermark on prints', has: false },
        { text: 'Invoicing', has: false },
        { text: 'Customer database', has: false },
        { text: 'Cloud sync', has: false },
        { text: 'Email quotes', has: false },
      ],
      pro: [
        { text: 'Unlimited quotes & invoices', has: true },
        { text: 'Cloud sync across devices', has: true },
        { text: 'Customer database', has: true },
        { text: 'No watermark on PDFs', has: true },
        { text: 'Email quotes & invoices', has: true },
        { text: 'Payment tracking', has: true },
        { text: 'Expense tracking', has: false },
        { text: 'Profit & Loss reports', has: false },
        { text: 'Job profitability', has: false },
      ],
      business: [
        { text: 'Everything in Pro', has: true },
        { text: 'Expense tracking', has: true },
        { text: 'Profit & Loss dashboard', has: true },
        { text: 'Job profitability reports', has: true },
        { text: 'PDF financial exports', has: true },
        { text: 'Accept Stripe payments', has: true },
      ],
    };

    const optionsHtml = Object.keys(plans).map(key => {
      const p = plans[key];
      const isCurrent = key === tier;
      const isUpgrade = tierOrder[key] > tierOrder[tier];
      const isDowngrade = tierOrder[key] < tierOrder[tier];

      let btnHtml;
      if (isCurrent) {
        btnHtml = '<span class="plan-option-btn btn-current">Current Plan</span>';
      } else if (isUpgrade) {
        btnHtml = `<button class="plan-option-btn btn-upgrade" onclick="event.stopPropagation();handlePlanChange('${key}')">Upgrade →</button>`;
      } else {
        btnHtml = `<button class="plan-option-btn btn-downgrade" onclick="event.stopPropagation();handlePlanChange('${key}')">Downgrade</button>`;
      }

      const featsHtml = tierFeatures[key].map(f =>
        `<div class="plan-option-feat ${f.has ? 'has' : 'missing'}"><span class="pof-icon">${f.has ? '✓' : '✗'}</span>${f.text}</div>`
      ).join('');

      return `<div class="plan-option ${isCurrent ? 'current' : ''}" onclick="togglePlanDetails(this)">
        <div style="font-size:1.2rem;margin-bottom:6px;">${p.icon}</div>
        <div class="plan-option-name">${p.name}</div>
        <div class="plan-option-price">${p.price}<span style="font-size:11px;"> ${p.priceSub}</span></div>
        ${btnHtml}
        <div class="plan-option-toggle">tap to see features ▾</div>
        <div class="plan-option-details">
          <div class="plan-option-details-inner">${featsHtml}</div>
        </div>
      </div>`;
    }).join('');

    // Quota info for free tier
    let quotaHtml = '';
    if (tier === 'free') {
      const used = getQuotasThisMonth();
      const pct = Math.min((used / FREE_QUOTE_LIMIT) * 100, 100);
      quotaHtml = `<div style="margin-bottom:20px;padding:12px 16px;background:rgba(255,255,255,0.05);border-radius:8px;display:flex;align-items:center;gap:12px;">
        <span style="font-size:13px;color:rgba(255,255,255,0.6);white-space:nowrap;"><strong style="color:var(--white);">${used}</strong> / ${FREE_QUOTE_LIMIT} quotes this month</span>
        <div style="flex:1;height:6px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${pct >= 100 ? 'var(--red)' : 'var(--amber)'};border-radius:3px;transition:width 0.3s;"></div>
        </div>
      </div>`;
    }

    container.innerHTML = `<div class="plan-card">
      <div class="plan-card-top">
        <div>
          <div class="plan-current-label">Current Plan</div>
          <div class="plan-current-name" style="color:${current.color};">${current.icon} ${current.name}</div>
          <div class="plan-current-price">${current.price} ${current.priceSub}</div>
        </div>
        <span class="plan-current-badge" style="background:${current.color};color:${tier === 'free' ? 'var(--ink)' : 'var(--white)'};">${current.name}</span>
      </div>
      ${quotaHtml}
      <div class="plan-features">${featuresHtml}</div>
      ${tier !== 'free' ? '<div style="margin-bottom:16px;"><button onclick="openStripePortal()" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.6);padding:10px 20px;border-radius:8px;font-family:var(--font-body);font-size:13px;font-weight:600;cursor:pointer;transition:all 0.15s;" onmouseover="this.style.color=\'#fff\';this.style.borderColor=\'rgba(255,255,255,0.3)\'" onmouseout="this.style.color=\'rgba(255,255,255,0.6)\';this.style.borderColor=\'rgba(255,255,255,0.15)\'">Manage Subscription →</button><span style="font-size:11px;color:rgba(255,255,255,0.3);margin-left:12px;">Update payment method, cancel, or view invoices</span></div>' : ''}
      <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:2px;color:rgba(255,255,255,0.25);margin-bottom:10px;">Change Plan</div>
      <div class="plan-options">${optionsHtml}</div>
    </div>`;
  }

  function togglePlanDetails(el) {
    const wasExpanded = el.classList.contains('expanded');
    // Collapse all
    document.querySelectorAll('.plan-option.expanded').forEach(o => {
      o.classList.remove('expanded');
      const tog = o.querySelector('.plan-option-toggle');
      if (tog) tog.textContent = 'tap to see features ▾';
    });
    // Expand clicked one (if it wasn't already open)
    if (!wasExpanded) {
      el.classList.add('expanded');
      const tog = el.querySelector('.plan-option-toggle');
      if (tog) tog.textContent = 'hide features ▴';
    }
  }

  async function handlePlanChange(newTier) {
    const tier = getUserTier();
    const tierOrder = { free: 0, pro: 1, business: 2 };
    const names = { free: 'Free', pro: 'Pro', business: 'Business' };
    const isUpgrade = tierOrder[newTier] > tierOrder[tier];
    const isDowngrade = tierOrder[newTier] < tierOrder[tier];

    if (newTier === 'free' && tier !== 'free') {
      // Downgrade to free = cancel subscription via Customer Portal
      if (confirm('Cancel your subscription and downgrade to Free? You\'ll lose access to paid features at the end of your billing period.')) {
        openStripePortal();
      }
      return;
    }

    if (isUpgrade) {
      // Create Stripe Checkout Session via API
      try {
        showToast('Opening checkout…');
        const resp = await authFetch('/api/stripe-subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tier: newTier
          })
        });
        const data = await resp.json();
        if (data.error) { showToast('Error: ' + data.error); return; }
        window.location.href = data.url;
      } catch(e) {
        console.error('Checkout error:', e);
        showToast('Could not open checkout');
      }
    } else if (isDowngrade) {
      // Downgrade between paid tiers = manage via Customer Portal
      if (confirm(`Downgrade to ${names[newTier]}? You can change your plan in the Stripe portal.`)) {
        openStripePortal();
      }
    }
  }

  async function openStripePortal() {
    try {
      showToast('Opening subscription manager…');
      const resp = await authFetch('/api/stripe-portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await resp.json();
      if (data.error) {
        showToast(data.error);
        return;
      }
      window.location.href = data.url;
    } catch (e) {
      console.error('Portal error:', e);
      showToast('Could not open subscription manager');
    }
  }

  async function saveSettingsData() {
    const profile = {
      biz_name: document.getElementById('sBizName').value,
      biz_phone: document.getElementById('sBizPhone').value,
      biz_email: document.getElementById('sBizEmail').value,
      biz_address: document.getElementById('sBizAddress').value,
      biz_license: document.getElementById('sBizLicense').value,
      biz_logo_url: settingsLogoData,
      default_tax_rate: parseFloat(document.getElementById('sDefaultTax').value) || 8,
      default_valid_days: parseInt(document.getElementById('sDefaultValid').value) || 30,
      default_notes: document.getElementById('sDefaultNotes').value,
      payments: Array.from(activePayments),
      payment_handles: {
        cashapp: document.getElementById('sHandleCashApp').value.trim(),
        venmo: document.getElementById('sHandleVenmo').value.trim(),
        paypal: document.getElementById('sHandlePayPal').value.trim(),
        zelle: document.getElementById('sHandleZelle').value.trim()
      }
    };
    await dbSaveProfile(profile);
    const el = document.getElementById('settingsSaveStatus');
    el.style.opacity = '1';
    setTimeout(() => el.style.opacity = '0', 2500);
  }

  // ══════════════════════════════════
  //  STRIPE CONNECT
  // ══════════════════════════════════
  async function connectStripe() {
    const btn = document.getElementById('stripeConnectBtn');
    if (btn) { btn.textContent = 'Connecting…'; btn.disabled = true; }

    try {
      const resp = await authFetch('/api/stripe-connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await resp.json();
      if (data.error) {
        showToast('Stripe error: ' + data.error);
        if (btn) { btn.textContent = 'Connect with Stripe →'; btn.disabled = false; }
        return;
      }
      // Redirect to Stripe onboarding
      window.location.href = data.url;
    } catch(e) {
      console.error('Stripe connect error:', e);
      showToast('Failed to connect Stripe');
      if (btn) { btn.textContent = 'Connect with Stripe →'; btn.disabled = false; }
    }
  }

  function updateStripeUI(profile) {
    if (profile?.stripe_account_id) {
      // Verify the account is actually active by checking with the server
      authFetch('/api/stripe-connect-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      }).then(r => r.json()).then(data => {
        if (data.charges_enabled) {
          document.getElementById('stripeNotConnected').style.display = 'none';
          document.getElementById('stripeConnected').style.display = '';
          document.getElementById('stripeAccountDisplay').textContent = profile.stripe_account_id;
        } else {
          // Account exists but onboarding not complete
          document.getElementById('stripeNotConnected').style.display = '';
          document.getElementById('stripeConnected').style.display = 'none';
          document.getElementById('stripeConnectBtn').textContent = 'Finish Stripe Setup →';
        }
      }).catch(() => {
        // If verification fails, fall back to showing connected
        document.getElementById('stripeNotConnected').style.display = 'none';
        document.getElementById('stripeConnected').style.display = '';
        document.getElementById('stripeAccountDisplay').textContent = profile.stripe_account_id;
      });
    } else {
      document.getElementById('stripeNotConnected').style.display = '';
      document.getElementById('stripeConnected').style.display = 'none';
    }
  }

  async function createPaymentLink(invoiceId, amountDollars, description, stripeAccountId) {
    try {
      const resp = await authFetch('/api/stripe-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice_id: invoiceId
        })
      });
      const data = await resp.json();
      if (data.error) { console.error('Payment link error:', data.error); return null; }
      return data.url;
    } catch(e) {
      console.error('Payment link error:', e);
      return null;
    }
  }

  async function exportAllData() {
    const btn = document.getElementById('exportBtn');
    btn.textContent = 'Exporting…';
    btn.disabled = true;

    try {
      const [profile, quotes, invoices, clients] = await Promise.all([
        dbGetProfile(),
        dbGetQuotes(),
        dbGetInvoices(),
        dbGetClients()
      ]);

      // Get quote items and invoice items via parent IDs
      const quoteIds = (quotes || []).map(q => q.id).filter(Boolean);
      const invoiceIds = (invoices || []).map(i => i.id).filter(Boolean);

      let quoteItems = [], invoiceItems = [];
      if (quoteIds.length) {
        const { data } = await sb.from('quote_items').select('*').in('quote_id', quoteIds).order('sort_order');
        quoteItems = data || [];
      }
      if (invoiceIds.length) {
        const { data } = await sb.from('invoice_items').select('*').in('invoice_id', invoiceIds).order('sort_order');
        invoiceItems = data || [];
      }

      const backup = {
        exported_at: new Date().toISOString(),
        app: 'Builders Invoice',
        user_email: currentUser.email,
        profile: profile,
        clients: clients,
        quotes: quotes,
        quote_items: quoteItems || [],
        invoices: invoices,
        invoice_items: invoiceItems || []
      };

      const json = JSON.stringify(backup, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `builders-invoice-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast('Backup downloaded');
    } catch(e) {
      console.error('Export error:', e);
      showToast('Export failed — try again');
    } finally {
      btn.textContent = 'Export All Data ↓';
      btn.disabled = false;
    }
  }

  function settingsUploadLogo() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.hidden = true;
    input.onchange = () => {
      const file = input.files[0];
      if (!file || !file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        settingsLogoData = e.target.result;
        document.getElementById('settingsLogoPreview').innerHTML = `<img src="${settingsLogoData}" alt="Logo">`;
        document.getElementById('settingsLogoPreview').classList.add('has-logo');
        document.getElementById('settingsLogoRemove').style.display = 'inline';
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  function settingsRemoveLogo() {
    settingsLogoData = null;
    document.getElementById('settingsLogoPreview').innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
    document.getElementById('settingsLogoPreview').classList.remove('has-logo');
    document.getElementById('settingsLogoRemove').style.display = 'none';
  }

  // ══════════════════════════════════
  //  INVOICES
  // ══════════════════════════════════
  let currentInvFilter = 'all';
  let currentInvId = null;
  let invTaxEnabled = false;
  let invLineCounter = 0;

  // getInvoices/saveInvoicesToStorage — overridden by Supabase cache layer above
  function generateInvNum() {
    const invoices = getInvoices();
    let max = 0;
    invoices.forEach(inv => {
      const m = (inv.invoiceNum || '').match(/INV-(\d+)/);
      if (m) max = Math.max(max, parseInt(m[1]));
    });
    return 'INV-' + String(max + 1).padStart(4, '0');
  }

  // ── Invoice accordion item grids ──
  function initInvItemGrids() {
    document.querySelectorAll('.inv-item-grid').forEach(grid => {
      const items = JSON.parse(grid.dataset.items);
      grid.innerHTML = items.map(item => `
        <div class="item-card" data-unit="${item.unit}">
          <div class="item-card-top">
            <label class="item-check">
              <input type="checkbox" onchange="toggleInvItem(this)">
              <span class="item-checkmark"></span>
            </label>
            <div class="item-card-name">${escapeHtml(item.name)}</div>
          </div>
          <div class="item-card-inputs">
            <div class="item-card-field">
              <span class="item-card-label">${item.uLabel}</span>
              <input class="item-card-input" type="number" placeholder="0" min="0" step="0.01" data-role="qty" oninput="syncInvToTable(this)" disabled>
            </div>
            <div class="item-card-field">
              <span class="item-card-label">$/${item.uLabel}</span>
              <input class="item-card-input" type="number" placeholder="0.00" min="0" step="0.01" data-role="rate" oninput="syncInvToTable(this)" disabled>
            </div>
            <div class="item-card-total"></div>
          </div>
        </div>
      `).join('');
    });
  }

  function toggleInvItem(checkbox) {
    const card = checkbox.closest('.item-card');
    const inputs = card.querySelectorAll('.item-card-input');
    const name = card.querySelector('.item-card-name').textContent;
    const unit = card.dataset.unit || 'each';
    if (checkbox.checked) {
      card.classList.add('checked');
      inputs.forEach(inp => { inp.disabled = false; });
      inputs[0].focus();
      addInvLine(name, unit);
      // Tag the new row
      const rows = document.querySelectorAll('#invLineItemsBody .line-item-row');
      rows[rows.length - 1].dataset.sourceName = name;
    } else {
      card.classList.remove('checked');
      inputs.forEach(inp => { inp.disabled = true; inp.value = ''; });
      card.querySelector('.item-card-total').textContent = '';
      removeInvLineByName(name);
    }
    calcInvTotals();
  }

  function removeInvLineByName(name) {
    document.querySelectorAll('#invLineItemsBody .line-item-row').forEach(row => {
      if (row.dataset.sourceName === name) row.remove();
    });
  }

  function syncInvToTable(input) {
    const card = input.closest('.item-card');
    const name = card.querySelector('.item-card-name').textContent;
    const qtyVal = card.querySelector('[data-role="qty"]').value;
    const rateVal = card.querySelector('[data-role="rate"]').value;
    document.querySelectorAll('#invLineItemsBody .line-item-row').forEach(row => {
      if (row.dataset.sourceName === name) {
        const inputs = row.querySelectorAll('input[type="number"]');
        inputs[0].value = qtyVal;
        inputs[1].value = rateVal;
      }
    });
    calcInvTotals();
  }

  function syncInvToAccordion(input) {
    const row = input.closest('.line-item-row');
    const sourceName = row.dataset.sourceName;
    if (sourceName) {
      const inputs = row.querySelectorAll('input[type="number"]');
      document.querySelectorAll('#invCategorySections .item-card').forEach(card => {
        if (card.querySelector('.item-card-name').textContent === sourceName) {
          const q = card.querySelector('[data-role="qty"]');
          const r = card.querySelector('[data-role="rate"]');
          if (q) q.value = inputs[0].value;
          if (r) r.value = inputs[1].value;
        }
      });
    }
    calcInvTotals();
  }

  function resetInvAccordions() {
    document.querySelectorAll('#invCategorySections .item-card').forEach(card => {
      card.classList.remove('checked');
      const cb = card.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = false;
      card.querySelectorAll('.item-card-input').forEach(inp => { inp.disabled = true; inp.value = ''; });
      card.querySelector('.item-card-total').textContent = '';
    });
    document.querySelectorAll('#invCategorySections .cat-subtotal').forEach(el => {
      el.textContent = '$0.00'; el.classList.remove('has-value');
    });
    document.querySelectorAll('#invCategorySections .cat-section.open').forEach(s => s.classList.remove('open'));
  }

  function setInvFilter(f, el) {
    currentInvFilter = f;
    document.querySelectorAll('[data-invfilter]').forEach(p => p.classList.toggle('active', p.dataset.invfilter === f));
    renderJobs();
  }

  function renderInvoices() {
    const all = getInvoices();
    let invoices = all.slice();
    const q = (document.getElementById('invSearchInput')?.value || '').toLowerCase();
    if (currentInvFilter !== 'all') invoices = invoices.filter(r => r.status === currentInvFilter);
    if (q) invoices = invoices.filter(r => (r.clientName||'').toLowerCase().includes(q) || (r.invoiceNum||'').toLowerCase().includes(q));
    invoices.sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0));

    // Check for overdue
    const now = Date.now();
    all.forEach(inv => {
      if (inv.status === 'Unpaid' && inv.dueDate) {
        const due = new Date(inv.dueDate + 'T23:59:59').getTime();
        if (now > due) inv.status = 'Overdue';
      }
    });
    saveInvoicesToStorage(all);

    document.getElementById('invStatTotal').textContent = all.length;
    document.getElementById('invStatUnpaid').textContent = all.filter(r => r.status === 'Unpaid' || r.status === 'Overdue').length;
    document.getElementById('invStatPaid').textContent = all.filter(r => r.status === 'Paid').length;
    const outstanding = all.filter(r => r.status !== 'Paid').reduce((s,r) => s + (parseFloat(r.total?.replace(/[$,]/g,''))||0), 0);
    document.getElementById('invStatOutstanding').textContent = formatMoney(outstanding);

    if (invoices.length === 0) {
      document.getElementById('invEmptyState').style.display = 'block';
      document.getElementById('invTableView').style.display = 'none';
      return;
    }
    document.getElementById('invEmptyState').style.display = 'none';
    document.getElementById('invTableView').style.display = 'block';

    document.getElementById('invTableBody').innerHTML = invoices.map(r => `
      <div class="qt-row" onclick="editInvoice('${r.id}')">
        <div><div class="qt-client">${escapeHtml(r.jobDesc||'Untitled Invoice')}</div><div class="qt-client-sub">${escapeHtml(r.clientName||'—')}</div></div>
        <div class="qt-num">${escapeHtml(r.invoiceNum||'')}</div>
        <div><span class="status-badge status-${(r.status||'unpaid').toLowerCase()}">${r.status||'Unpaid'}</span></div>
        <div class="qt-date">${formatDate(r.date)}</div>
        <div class="qt-amount">${r.total||'$0.00'}</div>
        <div class="qt-actions" onclick="event.stopPropagation()">
          <button class="qt-action-btn danger" onclick="deleteInvoice('${r.id}')" title="Delete">×</button>
        </div>
      </div>`).join('');
  }

  async function deleteInvoice(id) {
    if (!confirm('Delete this invoice?')) return;
    await dbDeleteInvoice(id);
    await refreshInvoices();
    renderJobs();
  }

  // ── Invoice line items ──
  function addInvLine(desc, unit) {
    invLineCounter++;
    const body = document.getElementById('invLineItemsBody');
    const row = document.createElement('div');
    row.className = 'line-item-row';
    row.dataset.lineType = guessLineType(unit || 'each', desc || '');
    row.dataset.markupEnabled = 'false';
    row.dataset.markupMode = 'percent';
    row.dataset.markupValue = '0';
    const unitVal = unit || 'each';
    const unitOptions = ['each','hr','sqft','lnft','sq','job'];
    const typeInfo = getTypeBadgeInfo(row.dataset.lineType);
    const hideMarkup = row.dataset.lineType === 'mylabor' ? ' style="display:none;"' : '';
    row.innerHTML = `
      <div class="line-desc-wrap" style="display:flex;align-items:center;gap:6px;">
        <span class="line-type-badge ${typeInfo.cls}" onclick="toggleLineType(this);calcInvTotals()" title="Click to switch type">${typeInfo.label}</span>
        <input type="text" placeholder="Description" value="${desc ? escapeHtml(desc) : ''}" style="flex:1;">
      </div>
      <select class="unit-select" onchange="updateInvUnit(this)">${unitOptions.map(u => `<option value="${u}"${u===unitVal?' selected':''}>${u}</option>`).join('')}</select>
      <div class="qty-wrap">
        <input type="number" placeholder="1" value="" min="0" step="0.01" oninput="syncInvToAccordion(this)">
        <span class="qty-suffix">${unitVal}</span>
      </div>
      <input type="number" placeholder="0.00" value="" min="0" step="0.01" oninput="syncInvToAccordion(this)" data-role="rate">
      <div class="line-total">$0.00</div>
      <div style="display:flex;gap:2px;">
        <button class="line-note-btn" onclick="toggleLineNote(this)" title="Add note">📝</button>
        <button class="line-markup-btn" onclick="toggleInvLineMarkup(this)" title="Add markup"${hideMarkup}>%</button>
      </div>
      <button class="line-remove" onclick="removeInvLine(this)" title="Remove">×</button>
      <div class="line-note-row" style="display:none;">
        <input class="line-note-input" type="text" placeholder="e.g. Includes removal of old materials…">
      </div>
      <div class="line-markup-row">
        <div class="markup-inner">
          <span class="markup-label">Your Cost</span>
          <span class="markup-cost" style="font-family:var(--font-mono);font-size:12px;color:var(--ink);">$0.00</span>
          <span class="markup-label" style="margin-left:8px;">Markup</span>
          <div class="markup-mode-toggle">
            <button class="markup-mode-btn active" onclick="setInvMarkupMode(this,'percent')">%</button>
            <button class="markup-mode-btn" onclick="setInvMarkupMode(this,'flat')">$</button>
          </div>
          <input class="markup-input" type="number" placeholder="0" min="0" step="0.5" value="" oninput="calcInvMarkup(this)">
          <span class="markup-label">→</span>
          <span class="markup-result">Client: $0.00</span>
        </div>
      </div>
    `;
    body.appendChild(row);
  }

  function toggleInvLineMarkup(btn) {
    const row = btn.closest('.line-item-row');
    const markupRow = row.querySelector('.line-markup-row');
    const isActive = markupRow.classList.contains('show');
    if (isActive) {
      markupRow.classList.remove('show');
      btn.classList.remove('active');
      row.dataset.markupEnabled = 'false';
      row.dataset.markupValue = '0';
      row.querySelector('.markup-input').value = '';
    } else {
      markupRow.classList.add('show');
      btn.classList.add('active');
      row.dataset.markupEnabled = 'true';
      row.querySelector('.markup-input').focus();
    }
    calcInvTotals();
  }

  function setInvMarkupMode(btn, mode) {
    const row = btn.closest('.line-item-row');
    row.dataset.markupMode = mode;
    btn.parentElement.querySelectorAll('.markup-mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    calcInvMarkup(row.querySelector('.markup-input'));
  }

  function calcInvMarkup(input) {
    const row = input.closest('.line-item-row');
    row.dataset.markupValue = input.value || '0';
    calcInvTotals();
  }

  function updateInvUnit(select) {
    const row = select.closest('.line-item-row');
    const suffix = row.querySelector('.qty-suffix');
    if (suffix) suffix.textContent = select.value;
    calcInvTotals();
  }

  function removeInvLine(btn) {
    const row = btn.closest('.line-item-row');
    const sourceName = row.dataset.sourceName;
    if (sourceName) {
      document.querySelectorAll('#invCategorySections .item-card').forEach(card => {
        if (card.querySelector('.item-card-name').textContent === sourceName) {
          const cb = card.querySelector('input[type="checkbox"]');
          if (cb) cb.checked = false;
          card.classList.remove('checked');
          card.querySelectorAll('.item-card-input').forEach(inp => { inp.disabled = true; inp.value = ''; });
          card.querySelector('.item-card-total').textContent = '';
        }
      });
    }
    row.style.opacity = '0'; row.style.transition = 'all 0.2s';
    setTimeout(() => { row.remove(); calcInvTotals(); }, 200);
  }

  let invTaxScope = 'all';
  let invOverheadPercent = 0;
  let invOverheadVisible = false;

  function calcInvTotals() {
    let subtotal = 0;
    let invMaterialTotal = 0;
    let invMyLaborTotal = 0;
    let invSubTotal = 0;
    let invEmpTotal = 0;

    document.querySelectorAll('#invLineItemsBody .line-item-row').forEach(row => {
      const inputs = row.querySelectorAll('input[type="number"]');
      const qty = parseFloat(inputs[0]?.value) || 0;
      const baseCost = parseFloat(row.querySelector('[data-role="rate"]')?.value) || 0;
      const clientRate = getLineClientRate(row);
      const amount = qty * clientRate;

      row.querySelector('.line-total').textContent = amount > 0 ? formatMoney(amount) : '$0.00';

      // Update markup display
      if (row.dataset.markupEnabled === 'true') {
        const costEl = row.querySelector('.markup-cost');
        const resultEl = row.querySelector('.markup-result');
        if (costEl) costEl.textContent = formatMoney(baseCost);
        if (resultEl) resultEl.textContent = 'Client: ' + formatMoney(clientRate) + '/unit';
      }

      const lt = row.dataset.lineType;
      if (lt === 'mylabor') { invMyLaborTotal += amount; }
      else if (lt === 'employee') { invEmpTotal += amount; }
      else if (lt === 'sub') { invSubTotal += amount; }
      else { invMaterialTotal += amount; }
      subtotal += amount;
    });

    // Accordion subtotals
    document.querySelectorAll('#invCategorySections .cat-section').forEach(section => {
      let catTotal = 0;
      section.querySelectorAll('.item-card.checked').forEach(card => {
        const q = parseFloat(card.querySelector('[data-role="qty"]')?.value) || 0;
        const r = parseFloat(card.querySelector('[data-role="rate"]')?.value) || 0;
        const amt = q * r;
        card.querySelector('.item-card-total').textContent = amt > 0 ? formatMoney(amt) : '';
        catTotal += amt;
      });
      const sub = section.querySelector('[data-subtotal]');
      if (sub) { sub.textContent = catTotal > 0 ? formatMoney(catTotal) : '$0.00'; sub.classList.toggle('has-value', catTotal > 0); }
    });

    document.getElementById('invSubtotal').textContent = formatMoney(subtotal);

    // Section subtotals — show only when multiple types
    const hasMultipleTypes = (invMaterialTotal > 0 ? 1 : 0) + (invMyLaborTotal > 0 ? 1 : 0) + (invSubTotal > 0 ? 1 : 0) + (invEmpTotal > 0 ? 1 : 0) > 1;
    const matSubEl = document.getElementById('invMaterialSubtotal');
    const labSubEl = document.getElementById('invLaborSubtotal');
    const subSubEl = document.getElementById('invSubSubtotal');
    const empSubEl = document.getElementById('invEmpSubtotal');
    if (matSubEl) matSubEl.textContent = formatMoney(invMaterialTotal);
    if (labSubEl) labSubEl.textContent = formatMoney(invMyLaborTotal);
    if (subSubEl) subSubEl.textContent = formatMoney(invSubTotal);
    if (empSubEl) empSubEl.textContent = formatMoney(invEmpTotal);
    const matRow = document.getElementById('invMaterialSubRow');
    const labRow = document.getElementById('invLaborSubRow');
    const subRow = document.getElementById('invSubSubRow');
    const empRow = document.getElementById('invEmpSubRow');
    if (matRow) matRow.style.display = hasMultipleTypes && invMaterialTotal > 0 ? 'flex' : 'none';
    if (labRow) labRow.style.display = hasMultipleTypes && invMyLaborTotal > 0 ? 'flex' : 'none';
    if (subRow) subRow.style.display = hasMultipleTypes && invSubTotal > 0 ? 'flex' : 'none';
    if (empRow) empRow.style.display = hasMultipleTypes && invEmpTotal > 0 ? 'flex' : 'none';

    // O&P calculation
    let invOpAmt = 0;
    const invOpInput = document.getElementById('invOpRateInput');
    if (invOverheadPercent > 0 || document.getElementById('invOpToggle')?.classList.contains('on')) {
      invOverheadPercent = parseFloat(invOpInput?.value) || 0;
      invOpAmt = subtotal * (invOverheadPercent / 100);
      document.getElementById('invOpLabel').textContent = `Overhead & Profit (${invOverheadPercent}%)`;
      document.getElementById('invOpDisplay').textContent = formatMoney(invOpAmt);
    }

    let taxAmt = 0;
    const invAfterOP = subtotal + invOpAmt;
    if (invTaxEnabled) {
      const rate = parseFloat(document.getElementById('invTaxRateInput').value) || 0;
      const taxableAmount = invTaxScope === 'materials' ? invMaterialTotal + (subtotal > 0 ? (invMaterialTotal / subtotal * invOpAmt) : 0) : invAfterOP;
      taxAmt = taxableAmount * (rate / 100);
      const scopeLabel = invTaxScope === 'materials' ? ' (materials)' : '';
      document.getElementById('invTaxLabel').textContent = `Tax (${rate}%)${scopeLabel}`;
      document.getElementById('invTaxDisplay').textContent = formatMoney(taxAmt);
    }
    document.getElementById('invTotalDisplay').textContent = formatMoney(invAfterOP + taxAmt);
  }

  function toggleInvOP() {
    const toggle = document.getElementById('invOpToggle');
    const isOn = toggle.classList.contains('on');
    if (isOn) {
      toggle.classList.remove('on');
      document.getElementById('invOpRateWrap').style.display = 'none';
      document.getElementById('invOpRow').style.display = 'none';
      invOverheadPercent = 0;
    } else {
      toggle.classList.add('on');
      document.getElementById('invOpRateWrap').style.display = 'flex';
      document.getElementById('invOpRow').style.display = '';
      invOverheadPercent = parseFloat(document.getElementById('invOpRateInput').value) || 15;
    }
    calcInvTotals();
  }

  function setInvOPVisible(visible, btn) {
    invOverheadVisible = visible;
    btn.parentElement.querySelectorAll('.tax-scope-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }

  function toggleInvTax() {
    invTaxEnabled = !invTaxEnabled;
    document.getElementById('invTaxToggle').classList.toggle('on', invTaxEnabled);
    document.getElementById('invTaxRateWrap').style.display = invTaxEnabled ? 'flex' : 'none';
    document.getElementById('invTaxRow').style.display = invTaxEnabled ? 'flex' : 'none';
    const scopeWrap = document.getElementById('invTaxScopeWrap');
    if (scopeWrap) scopeWrap.style.display = invTaxEnabled ? '' : 'none';
    calcInvTotals();
  }

  function setInvTaxScope(scope, btn) {
    invTaxScope = scope;
    btn.parentElement.querySelectorAll('.tax-scope-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    calcInvTotals();
  }

  // ── New / Edit / Save ──
  function newInvoice() {
    // Free tier: no invoicing (payment tracking is Pro+)
    if (isFree()) {
      showUpgradePrompt('Invoicing and payment tracking require <strong>Pro</strong>. Upgrade to send invoices and track payments.', 'pro');
      return;
    }
    try {
      currentInvId = null;
      // Clear all inputs and textareas
      document.querySelectorAll('#page-invoice-edit input:not([readonly]), #page-invoice-edit textarea').forEach(el => el.value = '');
      // Reset date and invoice number
      document.getElementById('invDate').value = new Date().toISOString().split('T')[0];
      document.getElementById('invNum').value = generateInvNum();
      document.getElementById('invSidebarNum').textContent = document.getElementById('invNum').value;
      document.getElementById('invFromQuote').textContent = '—';
      // Clear ALL line items and reset counter
      document.getElementById('invLineItemsBody').innerHTML = '';
      invLineCounter = 0;
      // Reset tax
      if (invTaxEnabled) toggleInvTax();
      // Reset O&P
      if (document.getElementById('invOpToggle')?.classList.contains('on')) toggleInvOP();
      invOverheadPercent = 0; invOverheadVisible = false;
      // Reset accordions
      try { resetInvAccordions(); } catch(e) {}
      // Reset totals displays explicitly
      document.getElementById('invSubtotal').textContent = '$0.00';
      document.getElementById('invTotalDisplay').textContent = '$0.00';
      document.getElementById('invTaxDisplay').textContent = '$0.00';
      // Clear invoice photo attachments
      document.querySelectorAll('#invAttachGrid .attach-item').forEach(el => el.remove());
      try { updateInvAttachCount(); } catch(e) {}
      // Add one fresh empty line
      addInvLine();
      // Reset UI labels
      document.getElementById('invPageTitle').textContent = 'New Invoice';
      document.getElementById('invEditTitle').textContent = 'New Invoice';
      document.getElementById('invBadge').textContent = 'Unpaid';
      document.getElementById('invBadge').style.background = 'var(--amber-pale)';
      document.getElementById('invBadge').style.color = 'var(--amber-deep)';
      document.getElementById('invMarkPaidBtn').style.display = 'block';
      document.getElementById('invMarkPaidBtn').textContent = 'Mark as Paid ✓';
      // Recalculate (should all be zero)
      try { calcInvTotals(); } catch(e) {}
    } catch(e) { console.error('newInvoice error:', e); }

    // Show page immediately
    showPage('invoice-edit');

    // Auto-fill from cached profile (synchronous)
    autoFillInvFromSettings();
  }

  function editInvoice(id) {
    const inv = getInvoices().find(i => i.id === id);
    if (!inv) return;
    currentInvId = id;
    if (invTaxEnabled) toggleInvTax();
    resetInvAccordions();

    document.getElementById('invNum').value = inv.invoiceNum || '';
    document.getElementById('invSidebarNum').textContent = inv.invoiceNum || '';
    document.getElementById('invFromQuote').textContent = inv.fromQuoteNum || '—';
    document.getElementById('invDate').value = inv.date || '';
    document.getElementById('invDueIn').value = inv.dueIn || '30';
    document.getElementById('invDesc').value = inv.jobDesc || '';
    document.getElementById('invClientName').value = inv.clientName || '';
    document.getElementById('invClientPhone').value = inv.clientPhone || '';
    document.getElementById('invClientEmail').value = inv.clientEmail || '';
    document.getElementById('invJobAddress').value = inv.jobAddress || '';
    document.getElementById('invBizName').value = inv.bizName || '';
    document.getElementById('invBizPhone').value = inv.bizPhone || '';
    document.getElementById('invBizEmail').value = inv.bizEmail || '';
    document.getElementById('invBizAddress').value = inv.bizAddress || '';
    document.getElementById('invNotes').value = inv.notes || '';

    // Tax
    if (inv.taxEnabled && !invTaxEnabled) {
      document.getElementById('invTaxRateInput').value = inv.taxRate || '8';
      toggleInvTax();
    }

    // Restore O&P
    if (inv.overheadPercent > 0) {
      document.getElementById('invOpRateInput').value = inv.overheadPercent;
      if (!document.getElementById('invOpToggle').classList.contains('on')) toggleInvOP();
      invOverheadVisible = inv.overheadVisible || false;
      if (invOverheadVisible) {
        const btns = document.querySelectorAll('#invOpRow .tax-scope-btn');
        btns.forEach(b => b.classList.remove('active'));
        btns[1]?.classList.add('active');
      }
    }

    // Restore accordion checked items
    if (inv.checkedItems) {
      inv.checkedItems.forEach(ci => {
        document.querySelectorAll('#invCategorySections .item-card').forEach(card => {
          if (card.querySelector('.item-card-name').textContent === ci.name) {
            const cb = card.querySelector('input[type="checkbox"]');
            cb.checked = true;
            card.classList.add('checked');
            card.querySelectorAll('.item-card-input').forEach(inp => inp.disabled = false);
            if (ci.qty) card.querySelector('[data-role="qty"]').value = ci.qty;
            if (ci.rate) card.querySelector('[data-role="rate"]').value = ci.rate;
          }
        });
      });
    }

    // Line items
    document.getElementById('invLineItemsBody').innerHTML = '';
    invLineCounter = 0;
    if (inv.items && inv.items.length > 0) {
      inv.items.forEach(item => {
        addInvLine(item.desc, item.unit);
        const rows = document.querySelectorAll('#invLineItemsBody .line-item-row');
        const row = rows[rows.length - 1];
        if (item.source) row.dataset.sourceName = item.source;
        row.querySelectorAll('input[type="number"]')[0].value = item.qty;
        row.querySelector('[data-role="rate"]').value = item.rate;
        // Restore type
        if (item.lineType) {
          row.dataset.lineType = item.lineType;
          const badge = row.querySelector('.line-type-badge');
          if (badge) {
            const info = getTypeBadgeInfo(item.lineType);
            badge.textContent = info.label;
            badge.className = 'line-type-badge ' + info.cls;
          }
          if (item.lineType === 'mylabor') {
            const mBtn = row.querySelector('.line-markup-btn');
            if (mBtn) mBtn.style.display = 'none';
          }
        }
        // Restore markup
        if (item.markupEnabled) {
          row.dataset.markupEnabled = 'true';
          row.dataset.markupMode = item.markupMode || 'percent';
          row.dataset.markupValue = item.markupValue || '0';
          const markupRow = row.querySelector('.line-markup-row');
          const markupBtn = row.querySelector('.line-markup-btn');
          if (markupRow) markupRow.classList.add('show');
          if (markupBtn) markupBtn.classList.add('active');
          const markupInput = row.querySelector('.markup-input');
          if (markupInput) markupInput.value = item.markupValue || '';
          if (item.markupMode === 'flat') {
            const btns = row.querySelectorAll('.markup-mode-btn');
            btns.forEach(b => b.classList.remove('active'));
            btns[1]?.classList.add('active');
          }
        }
        if (item.note) {
          const noteRow = row.querySelector('.line-note-row');
          const noteInput = row.querySelector('.line-note-input');
          const noteBtn = row.querySelector('.line-note-btn');
          if (noteRow) noteRow.style.display = '';
          if (noteInput) noteInput.value = item.note;
          if (noteBtn) noteBtn.classList.add('active');
        }
      });
    } else {
      addInvLine();
    }

    calcInvTotals();

    // Status badge
    const s = inv.status || 'Unpaid';
    document.getElementById('invBadge').textContent = s;
    if (s === 'Paid') {
      document.getElementById('invBadge').style.background = 'var(--green-pale)';
      document.getElementById('invBadge').style.color = 'var(--green)';
      document.getElementById('invMarkPaidBtn').style.display = 'none';
    } else {
      document.getElementById('invBadge').style.background = s === 'Overdue' ? 'var(--red-pale)' : 'var(--amber-pale)';
      document.getElementById('invBadge').style.color = s === 'Overdue' ? 'var(--red)' : 'var(--amber-deep)';
      document.getElementById('invMarkPaidBtn').style.display = 'block';
    }

    document.getElementById('invPageTitle').textContent = 'Edit Invoice';
    document.getElementById('invEditTitle').textContent = inv.invoiceNum || 'Edit Invoice';
    showPage('invoice-edit');
  }

  function collectInvoiceData() {
    const items = [];
    document.querySelectorAll('#invLineItemsBody .line-item-row').forEach(row => {
      const desc = row.querySelector('input[type="text"]')?.value || '';
      const unit = row.querySelector('.unit-select')?.value || 'each';
      const rateInput = row.querySelector('[data-role="rate"]');
      const qtyInputs = row.querySelectorAll('input[type="number"]');
      const qty = qtyInputs[0]?.value || '';
      const rate = rateInput?.value || '';
      const note = row.querySelector('.line-note-input')?.value || '';
      const lineType = row.dataset.lineType || 'material';
      const markupEnabled = row.dataset.markupEnabled === 'true';
      const markupMode = row.dataset.markupMode || 'percent';
      const markupValue = row.dataset.markupValue || '0';
      const clientRate = getLineClientRate(row);
      items.push({
        desc, unit, qty, rate, note, source: row.dataset.sourceName || '',
        lineType, markupEnabled, markupMode, markupValue, clientRate
      });
    });

    const checkedItems = [];
    document.querySelectorAll('#invCategorySections .item-card.checked').forEach(card => {
      checkedItems.push({
        name: card.querySelector('.item-card-name').textContent,
        qty: card.querySelector('[data-role="qty"]')?.value || '',
        rate: card.querySelector('[data-role="rate"]')?.value || ''
      });
    });

    const date = document.getElementById('invDate').value;
    const dueIn = parseInt(document.getElementById('invDueIn').value) || 30;
    let dueDate = '';
    if (date) {
      const d = new Date(date + 'T00:00:00');
      d.setDate(d.getDate() + dueIn);
      dueDate = d.toISOString().split('T')[0];
    }

    const existing = currentInvId ? getInvoices().find(i => i.id === currentInvId) : null;

    return {
      id: currentInvId || null,
      invoiceNum: document.getElementById('invNum').value,
      status: existing?.status || 'Unpaid',
      date: date,
      dueIn: dueIn,
      dueDate: dueDate,
      jobDesc: document.getElementById('invDesc').value,
      clientName: document.getElementById('invClientName').value,
      clientPhone: document.getElementById('invClientPhone').value,
      clientEmail: document.getElementById('invClientEmail').value,
      jobAddress: document.getElementById('invJobAddress').value,
      bizName: document.getElementById('invBizName').value,
      bizPhone: document.getElementById('invBizPhone').value,
      bizEmail: document.getElementById('invBizEmail').value,
      bizAddress: document.getElementById('invBizAddress').value,
      items: items,
      checkedItems: checkedItems,
      notes: document.getElementById('invNotes').value,
      taxEnabled: invTaxEnabled,
      taxRate: document.getElementById('invTaxRateInput').value,
      taxScope: invTaxScope,
      overheadPercent: invOverheadPercent,
      overheadVisible: invOverheadVisible,
      total: document.getElementById('invTotalDisplay').textContent,
      subtotal: document.getElementById('invSubtotal').textContent,
      fromQuoteId: existing?.fromQuoteId || '',
      fromQuoteNum: document.getElementById('invFromQuote').textContent,
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now()
    };
  }

  async function saveInvoiceAndReturn() {
    if (!validateInvoiceForm()) return;
    const data = collectInvoiceData();
    const invId = await dbSaveInvoice(data, data.items);
    currentInvId = invId;
    await refreshInvoices();
    showPage('invoices');
  }

  async function markInvPaid() {
    if (!currentInvId) { await saveInvoiceAndReturn(); return; }
    const invoices = getInvoices();
    const inv = invoices.find(i => i.id === currentInvId);
    if (!inv) return;
    const newStatus = inv.status === 'Paid' ? 'Unpaid' : 'Paid';
    await sb.from('invoices').update({ status: newStatus }).eq('id', currentInvId);
    await refreshInvoices();

    const badge = document.getElementById('invBadge');
    badge.textContent = newStatus;
    if (newStatus === 'Paid') { badge.style.background = 'var(--green-pale)'; badge.style.color = 'var(--green)'; }
    else { badge.style.background = 'var(--amber-pale)'; badge.style.color = 'var(--amber)'; }
    document.getElementById('invMarkPaidBtn').textContent = newStatus === 'Paid' ? '✓ Paid' : 'Mark as Paid ✓';
  }

  async function sendInvoice() {
    if (!validateInvoiceForm()) return;

    const name = document.getElementById('invClientName').value.trim();
    const email = document.getElementById('invClientEmail').value.trim();

    const sendBtn = document.querySelector('#page-invoice-edit .totals-send-btn');
    const origText = sendBtn.textContent;
    sendBtn.textContent = 'Sending…';
    sendBtn.disabled = true;

    try {
      const invNum = document.getElementById('invNum').value || 'Invoice';
      const jobDesc = document.getElementById('invDesc').value || '';
      const total = document.getElementById('invTotalDisplay').textContent || '$0.00';
      const bizName = document.getElementById('invBizName').value || 'Builders Invoice';
      const bizEmail = document.getElementById('invBizEmail').value || '';
      const dueIn = document.getElementById('invDueIn').value || '30';
      const dueLabel = dueIn === '0' ? 'Due on receipt' : 'Net ' + dueIn;

      // Save invoice first
      await saveInvoiceOnly();

      // Create Stripe payment link if connected (do this BEFORE building HTML)
      let paymentUrl = '';
      _stripePayUrl = '';
      const profile = _profileCache || await dbGetProfile(true);

      // Create Stripe payment link (works with or without Stripe Connect)
      if (currentInvId) {
        sendBtn.textContent = 'Creating payment link…';
        const totalNum = parseFloat(total.replace(/[$,]/g, '')) || 0;
        if (totalNum > 0) {
          paymentUrl = await createPaymentLink(currentInvId, totalNum, invNum + ' — ' + (jobDesc || 'Invoice'), profile?.stripe_account_id || null) || '';
          _stripePayUrl = paymentUrl;
        }
      }

      // Build shareable doc HTML (now includes Stripe button if available)
      const invHtml = buildInvoiceHtml();

      // Upload to get shareable link
      const docUrl = await uploadDocumentHtml(invHtml, 'invoice');

      // Send via EmailJS
      await emailjs.send('service_i3t7fwd', 'template_t619ekw', {
        client_name: name,
        client_email: email,
        doc_type: 'Invoice',
        doc_num: invNum,
        job_desc: jobDesc ? 'Job: ' + jobDesc : '',
        total: 'Amount Due: ' + total + ' (' + dueLabel + ')' + (paymentUrl ? '\n\n💳 Pay with card: ' + paymentUrl : ''),
        doc_link: docUrl || '',
        biz_name: bizName,
        biz_email: bizEmail
      });

      _stripePayUrl = ''; // reset

      // NOW navigate to invoices page
      await refreshInvoices();
      showPage('invoices');
      showToast('Invoice emailed to ' + name);

    } catch(e) {
      console.error('sendInvoice error:', e);
      showToast('Error sending email — try again');
    } finally {
      sendBtn.textContent = origText;
      sendBtn.disabled = false;
    }
  }

  function buildInvoiceHtml() {
    const name = document.getElementById('invClientName').value || 'Client';
    const email = document.getElementById('invClientEmail').value || '';
    const clientPhone = document.getElementById('invClientPhone').value || '';
    const jobAddress = document.getElementById('invJobAddress').value || '';
    const invNum = document.getElementById('invNum').value || 'INV-0001';
    const invDate = document.getElementById('invDate').value || '';
    const dueIn = document.getElementById('invDueIn').value || '30';
    const jobDesc = document.getElementById('invDesc').value || '';
    const total = document.getElementById('invTotalDisplay').textContent || '$0.00';
    const subtotal = document.getElementById('invSubtotal').textContent || '$0.00';
    const notes = document.getElementById('invNotes').value || '';
    const bizName = document.getElementById('invBizName').value || '';
    const bizPhone = document.getElementById('invBizPhone').value || '';
    const bizEmail = document.getElementById('invBizEmail').value || '';
    const bizAddress = document.getElementById('invBizAddress').value || '';
    const fmtDate = (s) => s ? new Date(s+'T00:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) : '';

    let dueDate = '';
    if (invDate) {
      const d = new Date(invDate+'T00:00:00');
      d.setDate(d.getDate() + parseInt(dueIn));
      dueDate = fmtDate(d.toISOString().split('T')[0]);
    }

    let bihMaterialHtml = '';
    let bihMyLaborHtml = '';
    let bihSubHtml = '';
    document.querySelectorAll('#invLineItemsBody .line-item-row').forEach(row => {
      const desc = (row.querySelector('.line-desc-wrap input') || row.querySelector('input[type="text"]'))?.value || '';
      if (!desc) return;
      const unit = row.querySelector('.unit-select')?.value || '';
      const inputs = row.querySelectorAll('input[type="number"]');
      const qty = parseFloat(inputs[0]?.value) || 0;
      const clientRate = getLineClientRate(row);
      const note = row.querySelector('.line-note-input')?.value || '';
      const amt = qty * clientRate;
      const lineType = row.dataset.lineType || 'material';
      const rowHtml = `<tr><td style="padding:8px 10px;${note ? '' : 'border-bottom:1px solid #E0DBD4;'}font-size:13px;">${escapeHtml(desc)}</td><td style="padding:8px;${note ? '' : 'border-bottom:1px solid #E0DBD4;'}font-size:12px;text-align:center;color:#6B7280;">${unit}</td><td style="padding:8px;${note ? '' : 'border-bottom:1px solid #E0DBD4;'}font-family:monospace;text-align:center;">${qty}</td><td style="padding:8px;${note ? '' : 'border-bottom:1px solid #E0DBD4;'}font-family:monospace;text-align:right;">$${clientRate.toFixed(2)}</td><td style="padding:8px;${note ? '' : 'border-bottom:1px solid #E0DBD4;'}font-family:monospace;text-align:right;font-weight:600;">$${amt.toFixed(2)}</td></tr>`;
      const noteHtml = note ? `<tr><td colspan="5" style="padding:2px 10px 8px 24px;border-bottom:1px solid #E0DBD4;font-size:11px;color:#6B7280;font-style:italic;">↳ ${escapeHtml(note)}</td></tr>` : '';
      if (lineType === 'mylabor') { bihMyLaborHtml += rowHtml + noteHtml; }
      else if (lineType === 'sub') { bihSubHtml += rowHtml + noteHtml; }
      else { bihMaterialHtml += rowHtml + noteHtml; }
    });
    const bihSH = (t) => `<tr><td colspan="5" style="padding:8px 10px;background:#EDEAE5;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:#6B7280;border-bottom:1px solid #E0DBD4;">${t}</td></tr>`;
    const bihTC = (bihMaterialHtml ? 1 : 0) + (bihMyLaborHtml ? 1 : 0) + (bihSubHtml ? 1 : 0);
    let itemsHtml = '';
    if (bihTC > 1) {
      if (bihMaterialHtml) itemsHtml += bihSH('Materials') + bihMaterialHtml;
      if (bihMyLaborHtml) itemsHtml += bihSH('Labor') + bihMyLaborHtml;
      if (bihSubHtml) itemsHtml += bihSH('Sub / Employee') + bihSubHtml;
    } else {
      itemsHtml = bihMaterialHtml + bihMyLaborHtml + bihSubHtml;
    }

    // Gather invoice photos
    let photosHtml = '';
    const invAttachments = document.querySelectorAll('#invAttachGrid .attach-item');
    if (invAttachments.length > 0) {
      let imgs = '';
      invAttachments.forEach(item => {
        const src = item.querySelector('.attach-thumb')?.src;
        const desc = item.querySelector('.attach-desc')?.value || '';
        if (src) imgs += `<div style="margin-bottom:12px;"><img src="${src}" style="width:100%;max-height:250px;object-fit:cover;border:1px solid #E0DBD4;"><div style="font-size:11px;color:#6B7280;margin-top:4px;">${desc ? escapeHtml(desc) : ''}</div></div>`;
      });
      photosHtml = `<div style="margin-top:24px;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#6B7280;margin-bottom:12px;">Photos</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">${imgs}</div></div>`;
    }

    return `<div style="font-family:Arial,sans-serif;color:#1C1C1E;padding:24px;width:780px;">
      <table style="width:100%;margin-bottom:24px;"><tr>
        <td style="vertical-align:top;">
          <div style="display:flex;align-items:center;gap:12px;">
            ${bizLogoData ? `<img src="${bizLogoData}" style="width:48px;height:48px;object-fit:contain;border-radius:8px;">` : ''}
            <div>
              <div style="font-size:20px;font-weight:800;">${escapeHtml(bizName) || 'Builders Invoice'}</div>
              ${bizAddress ? `<div style="font-size:11px;color:#6B7280;">${escapeHtml(bizAddress)}</div>` : ''}
              ${bizPhone || bizEmail ? `<div style="font-size:11px;color:#6B7280;">${[bizPhone,bizEmail].filter(Boolean).map(escapeHtml).join(' | ')}</div>` : ''}
            </div>
          </div>
        </td>
        <td style="vertical-align:top;text-align:right;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#E07A2F;">INVOICE</div><div style="font-size:18px;font-weight:700;">${escapeHtml(invNum)}</div><div style="font-size:12px;color:#6B7280;">${fmtDate(invDate)}</div>${dueDate ? `<div style="font-size:11px;color:#C0392B;font-weight:600;">Due: ${dueDate}</div>` : ''}</td>
      </tr></table>
      <hr style="border:none;border-top:2px solid #1C1C1E;margin-bottom:24px;">
      <table style="width:100%;margin-bottom:24px;"><tr>
        <td style="vertical-align:top;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#6B7280;margin-bottom:6px;">Bill To</div><div style="font-weight:600;">${escapeHtml(name)}</div>${clientPhone ? `<div style="font-size:12px;color:#6B7280;">${escapeHtml(clientPhone)}</div>` : ''}${email ? `<div style="font-size:12px;color:#6B7280;">${escapeHtml(email)}</div>` : ''}${jobAddress ? `<div style="font-size:12px;color:#6B7280;">${escapeHtml(jobAddress)}</div>` : ''}</td>
      </tr></table>
      ${jobDesc ? `<div style="margin-bottom:16px;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#6B7280;margin-bottom:6px;">Description</div><div style="font-size:13px;">${escapeHtml(jobDesc)}</div></div>` : ''}
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        <tr style="background:#EDEAE5;"><th style="padding:6px 10px;text-align:left;font-size:10px;font-weight:700;color:#6B7280;">Description</th><th style="padding:6px;text-align:center;font-size:10px;font-weight:700;color:#6B7280;">Unit</th><th style="padding:6px;text-align:center;font-size:10px;font-weight:700;color:#6B7280;">Qty</th><th style="padding:6px;text-align:right;font-size:10px;font-weight:700;color:#6B7280;">Rate</th><th style="padding:6px;text-align:right;font-size:10px;font-weight:700;color:#6B7280;">Amount</th></tr>
        ${itemsHtml}
      </table>
      <table style="width:100%;margin-bottom:20px;"><tr><td></td><td style="width:220px;vertical-align:top;">
        <table style="width:100%;"><tr><td style="padding:4px 0;font-size:13px;color:#6B7280;">Subtotal</td><td style="padding:4px 0;text-align:right;font-family:monospace;font-size:13px;">${subtotal}</td></tr></table>
        ${invOverheadVisible && invOverheadPercent > 0 ? `<table style="width:100%;"><tr><td style="padding:4px 0;font-size:13px;color:#6B7280;">Contractor's Fee (${invOverheadPercent}%)</td><td style="padding:4px 0;text-align:right;font-family:monospace;font-size:13px;">${formatMoney(parseFloat(subtotal.replace(/[$,]/g,'')) * invOverheadPercent / 100)}</td></tr></table>` : ''}
        <div style="border-top:2px solid #1C1C1E;margin-top:6px;padding-top:8px;"><table style="width:100%;"><tr><td style="font-weight:700;">Amount Due</td><td style="text-align:right;font-size:22px;font-weight:800;">${total}</td></tr></table></div>
      </td></tr></table>
      ${notes ? `<div style="margin-top:20px;padding:12px 16px;background:#F5F2EE;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#6B7280;margin-bottom:4px;">Notes</div><div style="font-size:12px;white-space:pre-wrap;">${escapeHtml(notes)}</div></div>` : ''}
      ${photosHtml}
      ${buildPaymentHandlesHtml()}
      ${typeof _stripePayUrl !== 'undefined' && _stripePayUrl ? `<div style="margin-top:16px;text-align:center;"><a href="${_stripePayUrl}" target="_blank" style="display:inline-block;padding:14px 36px;background:#635BFF;color:white;border-radius:8px;font-family:sans-serif;font-size:16px;font-weight:700;text-decoration:none;">💳 Pay with Card</a><p style="font-size:11px;color:#6B7280;margin-top:8px;">Secure payment powered by Stripe</p></div>` : ''}
      <table style="width:100%;margin-top:30px;border-top:1px solid #E0DBD4;padding-top:12px;"><tr><td style="font-size:11px;color:#6B7280;">${escapeHtml(bizName) || 'Builders Invoice'}</td><td style="text-align:right;font-size:11px;color:#6B7280;">Thank you for your business.</td></tr></table>
    </div>`;
  }

  async function saveInvoiceOnly() {
    const data = collectInvoiceData();
    const invId = await dbSaveInvoice(data, data.items);
    currentInvId = invId;
    await refreshInvoices();
    return invId;
  }

  async function generateInvPDF() {
    // Auto-save the invoice
    const invId = await saveInvoiceOnly();

    // Create Stripe payment link
    let stripePayUrl = '';
    const profile = _profileCache || await dbGetProfile(true);
    if (invId) {
      const totalStr = document.getElementById('invTotalDisplay').textContent || '$0';
      const totalNum = parseFloat(totalStr.replace(/[$,]/g, '')) || 0;
      const invNum = document.getElementById('invNum').value || 'Invoice';
      const jobDesc = document.getElementById('invDesc').value || '';
      if (totalNum > 0) {
        try {
          stripePayUrl = await createPaymentLink(invId, totalNum, invNum + ' — ' + (jobDesc || 'Invoice'), profile?.stripe_account_id || null) || '';
        } catch(e) { console.warn('Payment link error:', e); }
      }
    }

    const clientName = document.getElementById('invClientName').value || 'Client';
    const clientPhone = document.getElementById('invClientPhone').value || '';
    const clientEmail = document.getElementById('invClientEmail').value || '';
    const jobAddress = document.getElementById('invJobAddress').value || '';
    const invNum = document.getElementById('invNum').value || 'INV-0001';
    const invDate = document.getElementById('invDate').value || '';
    const dueIn = parseInt(document.getElementById('invDueIn').value) || 30;
    const jobDesc = document.getElementById('invDesc').value || '';
    const notes = document.getElementById('invNotes').value || '';
    const subtotal = document.getElementById('invSubtotal').textContent;
    const total = document.getElementById('invTotalDisplay').textContent;
    const taxLabel = document.getElementById('invTaxLabel').textContent;
    const taxAmt = document.getElementById('invTaxDisplay').textContent;
    const showTax = invTaxEnabled;
    const fromQuote = document.getElementById('invFromQuote').textContent;

    const bizName = document.getElementById('invBizName').value || '';
    const bizPhone = document.getElementById('invBizPhone').value || '';
    const bizEmail = document.getElementById('invBizEmail').value || '';
    const bizAddress = document.getElementById('invBizAddress').value || '';

    // Check status for paid watermark
    const isPaid = currentInvId && getInvoices().find(i => i.id === currentInvId)?.status === 'Paid';

    // Due date
    let dueDateStr = '';
    if (invDate) {
      const d = new Date(invDate + 'T00:00:00');
      d.setDate(d.getDate() + dueIn);
      dueDateStr = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    }

    const fmtDate = (str) => {
      if (!str) return '';
      return new Date(str + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    };

    // Line items grouped by type
    let invPdfMaterials = '';
    let invPdfMyLabor = '';
    let invPdfSub = '';
    document.querySelectorAll('#invLineItemsBody .line-item-row').forEach(row => {
      const descInput = row.querySelector('.line-desc-wrap input') || row.querySelector('input[type="text"]');
      const desc = descInput?.value || '';
      if (!desc) return;
      const unit = row.querySelector('.unit-select')?.value || 'each';
      const numInputs = row.querySelectorAll('input[type="number"]');
      const qty = parseFloat(numInputs[0]?.value) || 0;
      const clientRate = getLineClientRate(row);
      const amount = qty * clientRate;
      const note = row.querySelector('.line-note-input')?.value || '';
      const lineType = row.dataset.lineType || 'material';
      const rowHtml = `<tr>
        <td style="padding:10px 12px;${note ? '' : 'border-bottom:1px solid #E0DBD4;'}font-size:13px;color:#1C1C1E;">${escapeHtml(desc)}</td>
        <td style="padding:10px 12px;${note ? '' : 'border-bottom:1px solid #E0DBD4;'}font-size:13px;color:#6B7280;text-align:center;">${escapeHtml(unit)}</td>
        <td style="padding:10px 12px;${note ? '' : 'border-bottom:1px solid #E0DBD4;'}font-family:'DM Mono',monospace;font-size:13px;color:#1C1C1E;text-align:center;">${qty}</td>
        <td style="padding:10px 12px;${note ? '' : 'border-bottom:1px solid #E0DBD4;'}font-family:'DM Mono',monospace;font-size:13px;color:#1C1C1E;text-align:right;">$${clientRate.toFixed(2)}</td>
        <td style="padding:10px 12px;${note ? '' : 'border-bottom:1px solid #E0DBD4;'}font-family:'DM Mono',monospace;font-size:13px;color:#1C1C1E;text-align:right;font-weight:500;">${formatMoney(amount)}</td>
      </tr>`;
      const noteHtml = note ? `<tr><td colspan="5" style="padding:2px 12px 10px 28px;border-bottom:1px solid #E0DBD4;font-size:11px;color:#6B7280;font-style:italic;">↳ ${escapeHtml(note)}</td></tr>` : '';
      if (lineType === 'mylabor') { invPdfMyLabor += rowHtml + noteHtml; }
      else if (lineType === 'sub') { invPdfSub += rowHtml + noteHtml; }
      else { invPdfMaterials += rowHtml + noteHtml; }
    });
    const ipSH = (t) => `<tr><td colspan="5" style="padding:8px 12px;background:#EDEAE5;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:#6B7280;border-bottom:1px solid #E0DBD4;">${t}</td></tr>`;
    const ipTC = (invPdfMaterials ? 1 : 0) + (invPdfMyLabor ? 1 : 0) + (invPdfSub ? 1 : 0);
    let lineItemsHtml = '';
    if (ipTC > 1) {
      if (invPdfMaterials) lineItemsHtml += ipSH('Materials') + invPdfMaterials;
      if (invPdfMyLabor) lineItemsHtml += ipSH('Labor') + invPdfMyLabor;
      if (invPdfSub) lineItemsHtml += ipSH('Sub / Employee') + invPdfSub;
    } else {
      lineItemsHtml = invPdfMaterials + invPdfMyLabor + invPdfSub;
    }

    // Biz logo from settings
    let logoData = settingsLogoData || bizLogoData || null;

    const html = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<title>${invNum} — ${clientName}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'DM Sans', sans-serif; color: #1C1C1E; font-size: 13px; line-height: 1.6; padding: 0; position: relative; }
  @page { size: letter; margin: 0.6in 0.7in; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } #pdfBar { display:none !important; } #pdfBar+div { display:none !important; } }
  ${isPaid ? `.paid-watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%) rotate(-35deg); font-family: 'Plus Jakarta Sans', sans-serif; font-size: 120px; font-weight: 800; color: rgba(45,125,82,0.08); letter-spacing: 10px; pointer-events: none; z-index: 0; }` : ''}
</style>
</head><body>
${isPaid ? '<div class="paid-watermark">PAID</div>' : ''}

<div style="padding:40px 48px;position:relative;z-index:1;">

  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px;padding-bottom:24px;border-bottom:2px solid #1C1C1E;">
    <div style="display:flex;align-items:center;gap:14px;">
      ${logoData ? `<img src="${logoData}" style="width:52px;height:52px;object-fit:contain;border-radius:8px;">` : ''}
      <div>
        <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:${bizName ? '20px' : '24px'};font-weight:800;color:#1C1C1E;letter-spacing:-0.5px;">${bizName ? escapeHtml(bizName) : 'Builders<span style=color:#E07A2F;>Invoice</span>'}</div>
        ${bizAddress ? `<div style="font-size:11px;color:#6B7280;margin-top:2px;">${escapeHtml(bizAddress)}</div>` : ''}
        ${bizPhone || bizEmail ? `<div style="font-size:11px;color:#6B7280;margin-top:1px;">${[bizPhone, bizEmail].filter(Boolean).map(escapeHtml).join(' · ')}</div>` : ''}
      </div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:2px;color:#E07A2F;margin-bottom:4px;">INVOICE</div>
      <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:20px;font-weight:700;color:#1C1C1E;">${invNum}</div>
      <div style="font-size:12px;color:#6B7280;margin-top:2px;">${fmtDate(invDate)}</div>
      ${dueDateStr ? `<div style="font-size:11px;color:${isPaid ? '#2D7D52' : '#C0392B'};font-weight:600;margin-top:2px;">${isPaid ? '✓ Paid' : 'Due: ' + dueDateStr}</div>` : ''}
      ${fromQuote && fromQuote !== '—' ? `<div style="font-size:10px;color:#6B7280;margin-top:4px;">From ${escapeHtml(fromQuote)}</div>` : ''}
    </div>
  </div>

  <!-- Client + Job -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-bottom:32px;">
    <div>
      <p style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:2px;color:#6B7280;margin-bottom:8px;">Bill To</p>
      <p style="font-size:15px;font-weight:600;color:#1C1C1E;">${escapeHtml(clientName)}</p>
      ${clientPhone ? `<p style="font-size:12px;color:#6B7280;">${escapeHtml(clientPhone)}</p>` : ''}
      ${clientEmail ? `<p style="font-size:12px;color:#6B7280;">${escapeHtml(clientEmail)}</p>` : ''}
      ${jobAddress ? `<p style="font-size:12px;color:#6B7280;">${escapeHtml(jobAddress)}</p>` : ''}
    </div>
    <div>
      ${jobDesc ? `<p style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:2px;color:#6B7280;margin-bottom:8px;">Description</p><p style="font-size:13px;color:#3E3E44;">${escapeHtml(jobDesc)}</p>` : ''}
    </div>
  </div>

  <!-- Line Items -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
    <thead>
      <tr style="background:#EDEAE5;">
        <th style="padding:8px 12px;text-align:left;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:#6B7280;">Description</th>
        <th style="padding:8px 12px;text-align:center;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:#6B7280;">Unit</th>
        <th style="padding:8px 12px;text-align:center;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:#6B7280;">Qty</th>
        <th style="padding:8px 12px;text-align:right;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:#6B7280;">Rate</th>
        <th style="padding:8px 12px;text-align:right;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:#6B7280;">Amount</th>
      </tr>
    </thead>
    <tbody>${lineItemsHtml}</tbody>
  </table>

  <!-- Totals -->
  <div style="display:flex;justify-content:flex-end;margin-bottom:32px;">
    <div style="width:240px;">
      <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;"><span style="color:#6B7280;">Subtotal</span><span style="font-family:'DM Mono',monospace;font-weight:500;">${subtotal}</span></div>
      ${invOverheadVisible && invOverheadPercent > 0 ? `<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;"><span style="color:#6B7280;">Contractor's Fee (${invOverheadPercent}%)</span><span style="font-family:'DM Mono',monospace;font-weight:500;">${formatMoney(parseFloat(subtotal.replace(/[$,]/g,'')) * invOverheadPercent / 100)}</span></div>` : ''}
      ${showTax ? `<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;"><span style="color:#6B7280;">${taxLabel}</span><span style="font-family:'DM Mono',monospace;font-weight:500;">${taxAmt}</span></div>` : ''}
      <div style="border-top:2px solid #1C1C1E;margin-top:8px;padding-top:10px;display:flex;justify-content:space-between;align-items:flex-end;">
        <span style="font-size:14px;font-weight:600;">${isPaid ? 'Amount Paid' : 'Amount Due'}</span>
        <span style="font-family:'Plus Jakarta Sans',sans-serif;font-size:26px;font-weight:800;letter-spacing:-0.5px;">${total}</span>
      </div>
    </div>
  </div>

  ${notes ? `<div style="margin-bottom:24px;padding:16px 20px;background:#F5F2EE;border-radius:8px;">
    <p style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:2px;color:#6B7280;margin-bottom:8px;">Notes</p>
    <p style="font-size:13px;color:#3E3E44;line-height:1.7;white-space:pre-wrap;">${escapeHtml(notes)}</p>
  </div>` : ''}

  <!-- Payment Info -->
  ${(() => { const h = _profileCache?.payment_handles || {}; const parts = []; if(h.cashapp) { const url='https://cash.app/'+encodeURIComponent(h.cashapp.replace(/^\$/,'$')); parts.push('<div>💵 CashApp: <a href="'+url+'" target="_blank" style="color:#00D632;font-weight:700;text-decoration:none;">'+escapeHtml(h.cashapp)+'</a></div>'); } if(h.venmo) { const url='https://venmo.com/'+encodeURIComponent(h.venmo.replace(/^@/,'')); parts.push('<div>💙 Venmo: <a href="'+url+'" target="_blank" style="color:#3D95CE;font-weight:700;text-decoration:none;">'+escapeHtml(h.venmo)+'</a></div>'); } if(h.paypal) { const url='https://paypal.me/'+encodeURIComponent(h.paypal.replace(/^@/,'')); parts.push('<div>🅿️ PayPal: <a href="'+url+'" target="_blank" style="color:#003087;font-weight:700;text-decoration:none;">'+escapeHtml(h.paypal)+'</a></div>'); } if(h.zelle) parts.push('<div>⚡ Zelle: <strong>'+escapeHtml(h.zelle)+'</strong></div>'); return parts.length ? '<div style="margin-bottom:24px;padding:16px 20px;background:#F5F2EE;border-radius:8px;"><p style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:2px;color:#6B7280;margin-bottom:10px;">Pay With</p><div style="font-size:14px;color:#3E3E44;line-height:2.2;">'+parts.join('')+'</div></div>' : ''; })()}

  ${stripePayUrl ? `<div style="margin-bottom:24px;text-align:center;"><a href="${stripePayUrl}" target="_blank" style="display:inline-block;padding:14px 36px;background:#635BFF;color:white;border-radius:8px;font-family:sans-serif;font-size:16px;font-weight:700;text-decoration:none;">💳 Pay with Card</a><p style="font-size:11px;color:#6B7280;margin-top:8px;">Secure payment powered by Stripe</p></div>` : ''}

  <!-- Footer -->
  <div style="margin-top:40px;padding-top:20px;border-top:1px solid #E0DBD4;display:flex;justify-content:space-between;align-items:center;">
    <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:14px;font-weight:700;color:#1C1C1E;">${bizName ? escapeHtml(bizName) : 'Builders<span style=color:#E07A2F;>Invoice</span>'}</div>
    <div style="font-size:11px;color:#6B7280;">Thank you for your business.</div>
  </div>

</div>
<div id="pdfBar" style="position:fixed;top:0;left:0;right:0;background:#1C1C1E;padding:12px 24px;display:flex;align-items:center;justify-content:space-between;z-index:9999;box-shadow:0 2px 12px rgba(0,0,0,0.3);"><span style="font-family:'Plus Jakarta Sans',sans-serif;color:white;font-size:14px;font-weight:600;">PDF Preview</span><div style="display:flex;gap:8px;"><button onclick="document.getElementById('pdfBar').style.display='none';window.print();" style="padding:8px 20px;background:#E07A2F;color:white;border:none;border-radius:6px;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer;">Save as PDF</button><button onclick="window.close()" style="padding:8px 16px;background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.7);border:1px solid rgba(255,255,255,0.15);border-radius:6px;font-family:'DM Sans',sans-serif;font-size:13px;cursor:pointer;">Close</button></div></div><div style="height:52px;"></div>
</body></html>`;

    const win = window.open('', '_blank');
    if (win) { win.document.write(html); win.document.close(); }
    else { alert('Pop-up blocked. Please allow pop-ups for this site, then try again.'); }
  }


  // ══════════════════════════════════
  //  CLIENTS
  // ══════════════════════════════════
  let editingClientId = null;

  // getClients/saveClientsToStorage — overridden by Supabase cache layer above

  function renderClients() {
    const all = getClients();
    const q = (document.getElementById('clientSearchInput')?.value || '').toLowerCase();
    let clients = all.slice();
    if (q) clients = clients.filter(c => (c.name||'').toLowerCase().includes(q) || (c.email||'').toLowerCase().includes(q) || (c.phone||'').includes(q));
    clients.sort((a,b) => (a.name||'').localeCompare(b.name||''));

    // Stats
    const quotes = getQuotes();
    const invoices = getInvoices();
    document.getElementById('clientStatTotal').textContent = all.length;
    document.getElementById('clientStatQuotes').textContent = quotes.length;
    const totalInv = invoices.reduce((s,i) => s + (parseFloat(i.total?.replace(/[$,]/g,''))||0), 0);
    document.getElementById('clientStatInvoiced').textContent = formatMoney(totalInv);

    if (clients.length === 0) {
      document.getElementById('clientEmptyState').style.display = 'block';
      document.getElementById('clientTableView').style.display = 'none';
      return;
    }
    document.getElementById('clientEmptyState').style.display = 'none';
    document.getElementById('clientTableView').style.display = '';

    document.getElementById('clientTableBody').innerHTML = clients.map(c => {
      const initial = (c.name || '?')[0].toUpperCase();
      const phone = c.phone || '';
      const email = c.email || '';
      const address = c.address || '';
      return `
      <div class="client-card" onclick="editClientById('${c.id||c.name}')">
        <div class="client-avatar">${initial}</div>
        <div class="client-card-info">
          <div class="client-card-name">${escapeHtml(c.name||'Unnamed')}</div>
          <div class="client-card-details">
            ${phone ? `<span><span class="ccd-icon">📞</span>${escapeHtml(phone)}</span>` : ''}
            ${email ? `<span><span class="ccd-icon">✉</span>${escapeHtml(email)}</span>` : ''}
            ${address ? `<span><span class="ccd-icon">📍</span>${escapeHtml(address)}</span>` : ''}
          </div>
          ${c.notes ? `<div class="client-card-notes">"${escapeHtml(c.notes)}"</div>` : ''}
        </div>
        <div class="client-card-actions" onclick="event.stopPropagation()">
          <button onclick="editClientById('${c.id||c.name}')" title="Edit">✎</button>
          <button class="danger" onclick="deleteClient('${c.id||c.name}')" title="Delete">×</button>
        </div>
      </div>`;
    }).join('');
  }

  function showAddClient() {
    editingClientId = null;
    document.getElementById('cmClientName').value = '';
    document.getElementById('cmClientPhone').value = '';
    document.getElementById('cmClientEmail').value = '';
    document.getElementById('cmClientAddress').value = '';
    document.getElementById('cmClientNotes').value = '';
    document.getElementById('clientModalTitle').textContent = 'Add Client';
    document.getElementById('clientModalOverlay').style.display = 'flex';
  }

  function editClientById(id) {
    const clients = getClients();
    const c = clients.find(x => (x.id||x.name) === id);
    if (!c) return;
    editingClientId = id;
    document.getElementById('cmClientName').value = c.name || '';
    document.getElementById('cmClientPhone').value = c.phone || '';
    document.getElementById('cmClientEmail').value = c.email || '';
    document.getElementById('cmClientAddress').value = c.address || '';
    document.getElementById('cmClientNotes').value = c.notes || '';
    document.getElementById('clientModalTitle').textContent = 'Edit Client';
    document.getElementById('clientModalOverlay').style.display = 'flex';
  }

  function closeClientModal() {
    document.getElementById('clientModalOverlay').style.display = 'none';
    editingClientId = null;
  }

  async function saveClient() {
    const name = document.getElementById('cmClientName').value.trim();
    if (!name) {
      document.getElementById('cmClientName').style.borderColor = 'var(--red)';
      setTimeout(() => document.getElementById('cmClientName').style.borderColor = '', 2000);
      return;
    }
    const data = {
      name: name,
      phone: document.getElementById('cmClientPhone').value,
      email: document.getElementById('cmClientEmail').value,
      address: document.getElementById('cmClientAddress').value,
      notes: document.getElementById('cmClientNotes').value,
    };
    if (editingClientId) data.id = editingClientId;
    await dbSaveClient(data);
    await refreshClients();
    closeClientModal();
    renderClients();
  }

  async function deleteClient(id) {
    if (!confirm('Delete this client?')) return;
    await dbDeleteClient(id);
    await refreshClients();
    renderClients();
  }

  // ── Client Autocomplete ──
  function showClientAc(input, ctx) {
    const dropdown = document.getElementById(ctx === 'inv' ? 'clientAcInv' : 'clientAcQuote');
    const query = input.value.trim().toLowerCase();
    const clients = getClients();

    if (!query && clients.length === 0) { dropdown.style.display = 'none'; return; }

    let matches = clients;
    if (query) matches = clients.filter(c => (c.name||'').toLowerCase().includes(query));

    if (matches.length === 0) { dropdown.style.display = 'none'; return; }

    dropdown.innerHTML = matches.slice(0, 8).map(c => `
      <div class="client-ac-item" onmousedown="selectClient('${escapeHtml(c.id||c.name)}','${ctx}')">
        <div class="client-ac-name">${escapeHtml(c.name)}</div>
        <div class="client-ac-detail">${[c.phone, c.email].filter(Boolean).join(' · ') || c.address || ''}</div>
      </div>
    `).join('');
    dropdown.style.display = '';
  }

  function hideClientAc(ctx) {
    document.getElementById(ctx === 'inv' ? 'clientAcInv' : 'clientAcQuote').style.display = 'none';
  }

  function selectClient(id, ctx) {
    const c = getClients().find(x => (x.id||x.name) === id);
    if (!c) return;

    if (ctx === 'inv') {
      document.getElementById('invClientName').value = c.name || '';
      document.getElementById('invClientPhone').value = c.phone || '';
      document.getElementById('invClientEmail').value = c.email || '';
      document.getElementById('invJobAddress').value = c.address || '';
    } else {
      document.getElementById('clientName').value = c.name || '';
      document.getElementById('clientPhone').value = c.phone || '';
      document.getElementById('clientEmail').value = c.email || '';
      document.getElementById('jobAddress').value = c.address || '';
    }
    hideClientAc(ctx);
  }

  // ══════════════════════════════════
  //  EXPENSES — DB
  // ══════════════════════════════════
  let _expensesCache = [];

  async function dbGetExpenses() {
    const { data } = await sb.from('expenses').select('*').eq('user_id', currentUser.id).order('date', { ascending: false });
    return data || [];
  }

  async function dbSaveExpense(expense) {
    const payload = { ...expense, amount_cents: toCents(expense.amount), user_id: currentUser.id, updated_at: new Date().toISOString() };
    if (expense.id) {
      await sb.from('expenses').upsert(payload);
      return expense.id;
    } else {
      delete payload.id;
      const { data, error } = await sb.from('expenses').insert(payload).select().single();
      if (error) { console.error('Expense insert error:', error); return null; }
      return data.id;
    }
  }

  async function dbDeleteExpense(id) {
    await sb.from('expenses').delete().eq('id', id);
  }

  async function refreshExpenses() {
    _expensesCache = await dbGetExpenses();
    return _expensesCache;
  }

  function getExpenses() { return _expensesCache; }

  // ══════════════════════════════════
  //  EXPENSE MODAL
  // ══════════════════════════════════
  let editingExpenseId = null;

  function showExpenseModal(presetJobId, presetJobType) {
    editingExpenseId = null;
    document.getElementById('expModalTitle').textContent = 'Add Expense';
    document.getElementById('expDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('expAmount').value = '';
    document.getElementById('expDesc').value = '';
    document.getElementById('expCategory').value = 'Materials';
    document.getElementById('expNotes').value = '';

    // Populate job dropdown
    const sel = document.getElementById('expJobLink');
    sel.innerHTML = '<option value="">— Overhead (no job) —</option>';
    const quotes = getQuotes();
    const invoices = getInvoices();
    quotes.forEach(q => {
      sel.innerHTML += `<option value="q:${q.id}">${escapeHtml(q.clientName || 'Unknown')} — ${escapeHtml(q.jobDesc || q.quoteNum)}</option>`;
    });
    invoices.filter(i => !i.fromQuoteId).forEach(i => {
      sel.innerHTML += `<option value="i:${i.id}">${escapeHtml(i.clientName || 'Unknown')} — ${escapeHtml(i.jobDesc || i.invoiceNum)}</option>`;
    });

    if (presetJobId) {
      sel.value = (presetJobType === 'invoice' ? 'i:' : 'q:') + presetJobId;
    }

    document.getElementById('expenseModalOverlay').style.display = 'flex';
    document.getElementById('expDesc').focus();
  }

  function editExpense(id) {
    const exp = _expensesCache.find(e => e.id === id);
    if (!exp) return;
    editingExpenseId = id;
    showExpenseModal();
    document.getElementById('expModalTitle').textContent = 'Edit Expense';
    document.getElementById('expDate').value = exp.date || '';
    document.getElementById('expAmount').value = exp.amount || '';
    document.getElementById('expDesc').value = exp.description || '';
    document.getElementById('expCategory').value = exp.category || 'Other';
    document.getElementById('expNotes').value = exp.notes || '';
    if (exp.quote_id) document.getElementById('expJobLink').value = 'q:' + exp.quote_id;
    else if (exp.invoice_id) document.getElementById('expJobLink').value = 'i:' + exp.invoice_id;
    else document.getElementById('expJobLink').value = '';
    editingExpenseId = id;
  }

  function closeExpenseModal() {
    document.getElementById('expenseModalOverlay').style.display = 'none';
    editingExpenseId = null;
  }

  async function saveExpense() {
    const desc = document.getElementById('expDesc').value.trim();
    const amount = parseFloat(document.getElementById('expAmount').value);
    if (!desc) { markInvalid(document.getElementById('expDesc'), 'Description required'); return; }
    if (!amount || amount <= 0) { markInvalid(document.getElementById('expAmount'), 'Enter an amount'); return; }

    const jobVal = document.getElementById('expJobLink').value;
    let quote_id = null, invoice_id = null;
    if (jobVal.startsWith('q:')) quote_id = jobVal.slice(2);
    if (jobVal.startsWith('i:')) invoice_id = jobVal.slice(2);

    const data = {
      date: document.getElementById('expDate').value,
      description: desc,
      amount: amount,
      category: document.getElementById('expCategory').value,
      quote_id: quote_id,
      invoice_id: invoice_id,
      notes: document.getElementById('expNotes').value.trim() || null,
    };

    if (editingExpenseId) data.id = editingExpenseId;
    await dbSaveExpense(data);
    await refreshExpenses();
    closeExpenseModal();
    renderPnl();
    showToast(editingExpenseId ? 'Expense updated' : 'Expense added');
  }

  async function deleteExpense(id) {
    if (!confirm('Delete this expense?')) return;
    await dbDeleteExpense(id);
    await refreshExpenses();
    renderPnl();
  }

  // ══════════════════════════════════
  //  P&L PAGE — RENDERING
  // ══════════════════════════════════
  let pnlMonth = new Date().getMonth();
  let pnlYear = new Date().getFullYear();
  let pnlTab = 'monthly';

  function setPnlTab(tab, btn) {
    pnlTab = tab;
    document.querySelectorAll('.pnl-tab').forEach(t => t.classList.remove('active'));
    if (btn) btn.classList.add('active');
    document.getElementById('pnlTabMonthly').style.display = tab === 'monthly' ? '' : 'none';
    document.getElementById('pnlTabJobs').style.display = tab === 'jobs' ? '' : 'none';
    document.getElementById('pnlTabLifetime').style.display = tab === 'lifetime' ? '' : 'none';
    renderPnl();
  }

  function pnlPrevMonth() { pnlMonth--; if (pnlMonth < 0) { pnlMonth = 11; pnlYear--; } renderPnl(); }
  function pnlNextMonth() { pnlMonth++; if (pnlMonth > 11) { pnlMonth = 0; pnlYear++; } renderPnl(); }

  // Calculate auto-costs from invoice line items
  // Material, Sub, and Employee items ALWAYS have a cost (base rate × qty)
  // My Labor items NEVER have a cost (full amount is profit)
  function getInvoiceAutoCosts(inv) {
    if (!inv.items || inv.items.length === 0) return 0;
    return inv.items.reduce((total, item) => {
      const lt = item.lineType || 'material';
      if (lt === 'material' || lt === 'sub' || lt === 'employee') {
        const qty = parseFloat(item.qty) || 0;
        const baseCost = parseFloat(item.rate) || 0;
        return total + (qty * baseCost);
      }
      return total; // mylabor = no cost
    }, 0);
  }

  // Get detailed auto-cost breakdown per invoice
  function getInvoiceAutoCostItems(inv) {
    if (!inv.items || inv.items.length === 0) return [];
    return inv.items
      .filter(item => {
        const lt = item.lineType || 'material';
        return lt === 'material' || lt === 'sub' || lt === 'employee';
      })
      .map(item => {
        const qty = parseFloat(item.qty) || 0;
        const baseCost = parseFloat(item.rate) || 0;
        const clientRate = parseFloat(item.clientRate) || baseCost;
        return {
          desc: item.desc,
          qty,
          baseCost,
          clientRate,
          totalCost: qty * baseCost,
          totalRevenue: qty * clientRate,
          profit: qty * (clientRate - baseCost),
          lineType: item.lineType || 'material',
          invoiceNum: inv.invoiceNum,
          invoiceId: inv.id,
          date: inv.date,
          clientName: inv.clientName,
        };
      });
  }

  function pnlGetMonthData(year, month) {
    const invoices = getInvoices();
    const expenses = getExpenses();
    if (window.BuildersCore?.calculations) {
      const result = window.BuildersCore.calculations.calculateProfitAndLoss({ invoices, expenses, year, month });
      const autoCostItems = result.paidInvoices.flatMap(inv => getInvoiceAutoCostItems(inv));
      return {
        rev: result.paidInvoices,
        exp: result.monthlyExpenses,
        revTotal: result.revenueCents / 100,
        expTotal: result.expenseCents / 100,
        manualExpTotal: result.manualExpenseCents / 100,
        autoCostTotal: result.automaticCostCents / 100,
        autoCostItems,
        profit: result.profitCents / 100,
      };
    }
    const mStr = String(month + 1).padStart(2, '0');
    const prefix = `${year}-${mStr}`;

    const rev = invoices.filter(inv => inv.status === 'Paid' && inv.date && inv.date.startsWith(prefix));
    const exp = expenses.filter(e => e.date && e.date.startsWith(prefix));
    const revTotal = rev.reduce((s, i) => s + (parseFloat(i.total?.replace(/[$,]/g, '')) || 0), 0);
    const manualExpTotal = exp.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

    // Auto-costs from invoice markup
    const autoCostTotal = rev.reduce((s, inv) => s + getInvoiceAutoCosts(inv), 0);
    const autoCostItems = rev.flatMap(inv => getInvoiceAutoCostItems(inv));

    const expTotal = manualExpTotal + autoCostTotal;
    return { rev, exp, revTotal, expTotal, manualExpTotal, autoCostTotal, autoCostItems, profit: revTotal - expTotal };
  }

  function renderPnl() {
    const now = new Date();
    const thisData = pnlGetMonthData(now.getFullYear(), now.getMonth());

    // Zone 1: This month stats (always visible)
    const margin = thisData.revTotal > 0 ? ((thisData.profit / thisData.revTotal) * 100).toFixed(1) : '0.0';
    document.getElementById('pnlStats').innerHTML = `
      <div class="pnl-stat"><div class="pnl-stat-label">Revenue</div><div class="pnl-stat-value" style="color:var(--green);">${formatMoney(thisData.revTotal)}</div><div class="pnl-stat-sub">${thisData.rev.length} paid invoice${thisData.rev.length !== 1 ? 's' : ''}</div></div>
      <div class="pnl-stat"><div class="pnl-stat-label">Expenses</div><div class="pnl-stat-value" style="color:var(--red);">${formatMoney(thisData.expTotal)}</div><div class="pnl-stat-sub">${thisData.exp.length} expense${thisData.exp.length !== 1 ? 's' : ''}</div></div>
      <div class="pnl-stat"><div class="pnl-stat-label">Net Profit</div><div class="pnl-stat-value" style="color:${thisData.profit >= 0 ? 'var(--green)' : 'var(--red)'};">${formatMoney(thisData.profit)}</div><div class="pnl-stat-sub">this month</div></div>
      <div class="pnl-stat"><div class="pnl-stat-label">Margin</div><div class="pnl-stat-value" style="color:${thisData.profit >= 0 ? 'var(--green)' : 'var(--red)'};">${margin}%</div><div class="pnl-stat-sub">profit / revenue</div></div>
    `;

    // Revenue vs expense bar
    const total = thisData.revTotal + thisData.expTotal;
    document.getElementById('pnlBarRev').style.width = total > 0 ? ((thisData.revTotal / total) * 100) + '%' : '50%';
    document.getElementById('pnlBarExp').style.width = total > 0 ? ((thisData.expTotal / total) * 100) + '%' : '0%';

    if (pnlTab === 'monthly') renderPnlMonthly();
    if (pnlTab === 'jobs') renderPnlJobs();
    if (pnlTab === 'lifetime') renderPnlLifetime();
  }

  function renderPnlMonthly() {
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    document.getElementById('pnlMonthLabel').textContent = months[pnlMonth] + ' ' + pnlYear;
    const d = pnlGetMonthData(pnlYear, pnlMonth);

    // Revenue list
    document.getElementById('pnlRevList').innerHTML = d.rev.length === 0 ?
      '<div style="padding:16px;text-align:center;color:var(--gray);font-size:13px;">No paid invoices</div>' :
      d.rev.map(inv => `<div class="pnl-list-item"><div class="pnl-list-left"><span class="pnl-list-primary">${escapeHtml(inv.clientName || 'Unknown')}</span><span class="pnl-list-secondary">${escapeHtml(inv.jobDesc || inv.invoiceNum)} · ${formatDate(inv.date)}</span></div><span class="pnl-list-amount" style="color:var(--green);">${inv.total}</span></div>`).join('');
    document.getElementById('pnlRevTotal').textContent = formatMoney(d.revTotal);
    document.getElementById('pnlRevTotalBottom').textContent = formatMoney(d.revTotal);

    // Expense list grouped by category
    const cats = {};
    d.exp.forEach(e => { if (!cats[e.category]) cats[e.category] = []; cats[e.category].push(e); });
    let expHtml = '';
    if (d.exp.length === 0 && d.autoCostItems.length === 0) {
      expHtml = '<div style="padding:16px;text-align:center;color:var(--gray);font-size:13px;">No expenses</div>';
    } else {
      // Auto-costs from invoices — split by type
      if (d.autoCostItems.length > 0) {
        const matCosts = d.autoCostItems.filter(ac => ac.lineType === 'material');
        const empCosts = d.autoCostItems.filter(ac => ac.lineType === 'employee');
        const subCosts = d.autoCostItems.filter(ac => ac.lineType === 'sub');
        const matTotal = matCosts.reduce((s, ac) => s + ac.totalCost, 0);
        const empTotal = empCosts.reduce((s, ac) => s + ac.totalCost, 0);
        const subTotal = subCosts.reduce((s, ac) => s + ac.totalCost, 0);

        if (matCosts.length > 0) {
          expHtml += `<div class="pnl-cat-header" style="color:var(--green);">🟢 Material Costs · ${formatMoney(matTotal)}</div>`;
          matCosts.forEach(ac => {
            expHtml += `<div class="pnl-list-item"><div class="pnl-list-left"><span class="pnl-list-primary">${escapeHtml(ac.desc)}</span><span class="pnl-list-secondary">${escapeHtml(ac.clientName || '')} · ${escapeHtml(ac.invoiceNum)} · ${ac.qty} × ${formatMoney(ac.baseCost)}</span></div><span class="pnl-list-amount" style="color:var(--red);">-${formatMoney(ac.totalCost)}</span></div>`;
          });
        }
        if (empCosts.length > 0) {
          expHtml += `<div class="pnl-cat-header" style="color:#7C3AED;">🟣 Employee Costs · ${formatMoney(empTotal)}</div>`;
          empCosts.forEach(ac => {
            expHtml += `<div class="pnl-list-item"><div class="pnl-list-left"><span class="pnl-list-primary">${escapeHtml(ac.desc)}</span><span class="pnl-list-secondary">${escapeHtml(ac.clientName || '')} · ${escapeHtml(ac.invoiceNum)} · ${ac.qty} × ${formatMoney(ac.baseCost)}</span></div><span class="pnl-list-amount" style="color:var(--red);">-${formatMoney(ac.totalCost)}</span></div>`;
          });
        }
        if (subCosts.length > 0) {
          expHtml += `<div class="pnl-cat-header" style="color:var(--amber-deep);">🟠 Sub Costs · ${formatMoney(subTotal)}</div>`;
          subCosts.forEach(ac => {
            expHtml += `<div class="pnl-list-item"><div class="pnl-list-left"><span class="pnl-list-primary">${escapeHtml(ac.desc)}</span><span class="pnl-list-secondary">${escapeHtml(ac.clientName || '')} · ${escapeHtml(ac.invoiceNum)} · ${ac.qty} × ${formatMoney(ac.baseCost)}</span></div><span class="pnl-list-amount" style="color:var(--red);">-${formatMoney(ac.totalCost)}</span></div>`;
          });
        }
      }
      // Manual expenses
      if (d.exp.length > 0) {
        Object.keys(cats).sort().forEach(cat => {
          const catTotal = cats[cat].reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
          expHtml += `<div class="pnl-cat-header">${escapeHtml(cat)} · ${formatMoney(catTotal)}</div>`;
          cats[cat].forEach(e => {
            expHtml += `<div class="pnl-list-item" style="cursor:pointer;" onclick="editExpense('${e.id}')"><div class="pnl-list-left"><span class="pnl-list-primary">${escapeHtml(e.description)}</span><span class="pnl-list-secondary">${formatDate(e.date)}${e.notes ? ' · ' + escapeHtml(e.notes) : ''}</span></div><span class="pnl-list-amount" style="color:var(--red);">-${formatMoney(parseFloat(e.amount))}</span></div>`;
          });
        });
      }
    }
    document.getElementById('pnlExpList').innerHTML = expHtml;
    document.getElementById('pnlExpTotal').textContent = formatMoney(d.expTotal);
    document.getElementById('pnlExpTotalBottom').textContent = formatMoney(d.expTotal);

    // Summary
    const matAutoCost = d.autoCostItems.filter(ac => ac.lineType === 'material').reduce((s, ac) => s + ac.totalCost, 0);
    const empAutoCost = d.autoCostItems.filter(ac => ac.lineType === 'employee').reduce((s, ac) => s + ac.totalCost, 0);
    const subAutoCost = d.autoCostItems.filter(ac => ac.lineType === 'sub').reduce((s, ac) => s + ac.totalCost, 0);
    const jobExp = d.exp.filter(e => e.quote_id || e.invoice_id);
    const overheadExp = d.exp.filter(e => !e.quote_id && !e.invoice_id);
    const jobCost = jobExp.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    const overheadCost = overheadExp.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

    // Compare with previous month
    const pm = pnlMonth === 0 ? 11 : pnlMonth - 1;
    const py = pnlMonth === 0 ? pnlYear - 1 : pnlYear;
    const prev = pnlGetMonthData(py, pm);
    let vsHtml = '';
    if (prev.revTotal > 0 || prev.expTotal > 0) {
      const diff = d.profit - prev.profit;
      const pct = prev.profit !== 0 ? ((diff / Math.abs(prev.profit)) * 100).toFixed(0) : '—';
      vsHtml = `<div class="pnl-vs">${diff >= 0 ? '↑' : '↓'} ${pct}% vs previous month (${formatMoney(prev.profit)})</div>`;
    }

    document.getElementById('pnlMonthlySummary').innerHTML = `
      <div class="pnl-summary-row"><span>Revenue</span><span style="color:var(--green);">${formatMoney(d.revTotal)}</span></div>
      ${matAutoCost > 0 ? `<div class="pnl-summary-row"><span>Material Costs (auto)</span><span>-${formatMoney(matAutoCost)}</span></div>` : ''}
      ${empAutoCost > 0 ? `<div class="pnl-summary-row"><span>Employee Costs (auto)</span><span>-${formatMoney(empAutoCost)}</span></div>` : ''}
      ${subAutoCost > 0 ? `<div class="pnl-summary-row"><span>Sub Costs (auto)</span><span>-${formatMoney(subAutoCost)}</span></div>` : ''}
      <div class="pnl-summary-row"><span>Manual Expenses</span><span>-${formatMoney(jobCost + overheadCost)}</span></div>
      <div class="pnl-summary-total"><span>Net Profit</span><span style="color:${d.profit >= 0 ? 'var(--green)' : '#ef4444'};">${formatMoney(d.profit)}</span></div>
      ${vsHtml}
    `;
  }

  function renderPnlJobs() {
    const quotes = getQuotes();
    const invoices = getInvoices();
    const expenses = getExpenses();

    // Build job list: each quote is a job, plus standalone invoices
    const jobs = [];
    const invByQuote = {};
    invoices.forEach(inv => { if (inv.fromQuoteId) invByQuote[inv.fromQuoteId] = inv; });

    quotes.forEach(q => {
      const inv = invByQuote[q.id];
      const revenue = inv ? (parseFloat(inv.total?.replace(/[$,]/g, '')) || 0) : 0;
      const jobExps = expenses.filter(e => e.quote_id === q.id);
      const manualCost = jobExps.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
      const autoCost = inv ? getInvoiceAutoCosts(inv) : 0;
      const autoCostItems = inv ? getInvoiceAutoCostItems(inv) : [];
      const cost = manualCost + autoCost;
      jobs.push({ id: q.id, type: 'quote', title: q.jobDesc || 'Untitled', client: q.clientName || '—', revenue, cost, manualCost, autoCost, autoCostItems, profit: revenue - cost, items: (inv || q).items || [], expenses: jobExps, quoteId: q.id, invoice: inv, quote: q });
    });

    invoices.filter(i => !i.fromQuoteId).forEach(inv => {
      const revenue = parseFloat(inv.total?.replace(/[$,]/g, '')) || 0;
      const jobExps = expenses.filter(e => e.invoice_id === inv.id);
      const manualCost = jobExps.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
      const autoCost = getInvoiceAutoCosts(inv);
      const autoCostItems = getInvoiceAutoCostItems(inv);
      const cost = manualCost + autoCost;
      jobs.push({ id: inv.id, type: 'invoice', title: inv.jobDesc || 'Untitled', client: inv.clientName || '—', revenue, cost, manualCost, autoCost, autoCostItems, profit: revenue - cost, items: inv.items || [], expenses: jobExps, invoice: inv });
    });

    jobs.sort((a, b) => b.revenue - a.revenue);

    if (jobs.length === 0) {
      document.getElementById('pnlJobsList').innerHTML = '<div style="text-align:center;padding:40px;color:var(--gray);">No jobs yet</div>';
    } else {
      document.getElementById('pnlJobsList').innerHTML = jobs.map(j => {
        const margin = j.revenue > 0 ? ((j.profit / j.revenue) * 100).toFixed(0) : '0';
        const profitColor = j.profit >= 0 ? 'var(--green)' : 'var(--red)';
        const marginBg = j.profit >= 0 ? 'var(--green-pale)' : 'var(--red-pale)';
        const jobRef = j.type === 'quote' ? `q:${j.id}` : `i:${j.id}`;

        // Billed items
        let billedHtml = (j.items || []).filter(i => i.desc).map(i => {
          const amt = (parseFloat(i.qty) || 0) * (parseFloat(i.rate) || 0);
          return `<div class="pnl-job-row"><span>${escapeHtml(i.desc)}</span><span style="font-size:11px;color:var(--gray);">${i.qty} × $${parseFloat(i.rate||0).toFixed(2)}</span><span style="font-family:var(--font-mono);text-align:right;">${formatMoney(amt)}</span><span></span></div>`;
        }).join('');
        if (!billedHtml) billedHtml = '<div style="padding:10px 18px;font-size:13px;color:var(--gray);">No line items</div>';

        // Job expenses
        let expHtml = j.expenses.map(e =>
          `<div class="pnl-job-row"><span>${escapeHtml(e.description)}<br><span style="font-size:10px;color:var(--gray);">${e.category} · ${formatDate(e.date)}</span></span><span></span><span style="font-family:var(--font-mono);color:var(--red);text-align:right;">-${formatMoney(parseFloat(e.amount))}</span><button class="btn-ctx-danger" onclick="event.stopPropagation();deleteExpense('${e.id}')" style="font-size:14px;padding:2px 6px;">×</button></div>`
        ).join('');
        if (!expHtml) expHtml = '<div style="padding:10px 18px;font-size:13px;color:var(--gray);">No expenses logged</div>';

        return `<div class="pnl-job" id="pnlJob_${j.id}">
          <div class="pnl-job-header" onclick="document.getElementById('pnlJob_${j.id}').classList.toggle('open')">
            <div><div class="pnl-job-title">${escapeHtml(j.title)}</div><div class="pnl-job-client">${escapeHtml(j.client)}</div></div>
            <div class="pnl-job-nums">
              <span style="color:var(--gray);">Rev: ${formatMoney(j.revenue)}</span>
              <span style="color:var(--gray);">Cost: ${formatMoney(j.cost)}</span>
              <span class="pnl-job-profit" style="color:${profitColor};">${formatMoney(j.profit)}</span>
              <span class="pnl-job-margin" style="background:${marginBg};color:${profitColor};">${margin}%</span>
            </div>
          </div>
          <div class="pnl-job-body">
            <div class="pnl-job-section-label">Billed Items</div>
            ${billedHtml}
            ${(() => {
              if (!j.autoCostItems || j.autoCostItems.length === 0) return '';
              const matItems = j.autoCostItems.filter(ac => ac.lineType === 'material');
              const empItems = j.autoCostItems.filter(ac => ac.lineType === 'employee');
              const subItems = j.autoCostItems.filter(ac => ac.lineType === 'sub');
              let html = '';
              if (matItems.length > 0) {
                html += `<div class="pnl-job-section-label" style="margin-top:8px;color:var(--green);">🟢 Material Costs</div>`;
                html += matItems.map(ac => `<div class="pnl-job-row"><span>${escapeHtml(ac.desc)}<br><span style="font-size:10px;color:var(--gray);">${ac.qty} × ${formatMoney(ac.baseCost)} (your cost)</span></span><span></span><span style="font-family:var(--font-mono);color:var(--red);text-align:right;">-${formatMoney(ac.totalCost)}</span><span></span></div>`).join('');
              }
              if (empItems.length > 0) {
                html += `<div class="pnl-job-section-label" style="margin-top:8px;color:#7C3AED;">🟣 Employee Costs</div>`;
                html += empItems.map(ac => `<div class="pnl-job-row"><span>${escapeHtml(ac.desc)}<br><span style="font-size:10px;color:var(--gray);">${ac.qty} × ${formatMoney(ac.baseCost)} (their rate)</span></span><span></span><span style="font-family:var(--font-mono);color:var(--red);text-align:right;">-${formatMoney(ac.totalCost)}</span><span></span></div>`).join('');
              }
              if (subItems.length > 0) {
                html += `<div class="pnl-job-section-label" style="margin-top:8px;color:var(--amber-deep);">🟠 Sub Costs</div>`;
                html += subItems.map(ac => `<div class="pnl-job-row"><span>${escapeHtml(ac.desc)}<br><span style="font-size:10px;color:var(--gray);">${ac.qty} × ${formatMoney(ac.baseCost)} (their rate)</span></span><span></span><span style="font-family:var(--font-mono);color:var(--red);text-align:right;">-${formatMoney(ac.totalCost)}</span><span></span></div>`).join('');
              }
              return html;
            })()}
            <div class="pnl-job-section-label" style="margin-top:8px;">Manual Expenses</div>
            ${expHtml}
            <div class="pnl-job-add"><button class="btn btn-outline btn-sm" onclick="event.stopPropagation();showExpenseModal('${j.id}','${j.type}')">+ Add Expense</button></div>
            <div style="padding:12px 18px;background:var(--canvas);display:flex;justify-content:space-between;font-size:13px;font-weight:700;">
              <span>Revenue: ${formatMoney(j.revenue)} — Costs: ${formatMoney(j.cost)}</span>
              <span style="color:${profitColor};">Profit: ${formatMoney(j.profit)} (${margin}%)</span>
            </div>
          </div>
        </div>`;
      }).join('');
    }

    // Overhead
    const overhead = expenses.filter(e => !e.quote_id && !e.invoice_id);
    const overheadTotal = overhead.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    document.getElementById('pnlOverheadTotal').textContent = formatMoney(overheadTotal);
    document.getElementById('pnlOverheadList').innerHTML = overhead.length === 0 ?
      '<div style="padding:16px;text-align:center;color:var(--gray);font-size:13px;">No overhead expenses</div>' :
      overhead.map(e => `<div class="pnl-list-item" style="cursor:pointer;" onclick="editExpense('${e.id}')"><div class="pnl-list-left"><span class="pnl-list-primary">${escapeHtml(e.description)}</span><span class="pnl-list-secondary">${e.category} · ${formatDate(e.date)}</span></div><span class="pnl-list-amount" style="color:var(--red);">-${formatMoney(parseFloat(e.amount))}</span></div>`).join('');
  }

  function renderPnlLifetime() {
    const invoices = getInvoices();
    const expenses = getExpenses();
    const allInv = invoices;
    const totalRev = allInv.reduce((s, i) => s + (parseFloat(i.total?.replace(/[$,]/g, '')) || 0), 0);
    const totalManualExp = expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    const totalAutoCost = allInv.reduce((s, inv) => s + getInvoiceAutoCosts(inv), 0);
    const totalExp = totalManualExp + totalAutoCost;
    const totalProfit = totalRev - totalExp;

    document.getElementById('pnlLifetimeStats').innerHTML = `
      <div class="pnl-stat"><div class="pnl-stat-label">Total Earned</div><div class="pnl-stat-value" style="color:var(--green);">${formatMoney(totalRev)}</div><div class="pnl-stat-sub">all-time</div></div>
      <div class="pnl-stat"><div class="pnl-stat-label">Total Spent</div><div class="pnl-stat-value" style="color:var(--red);">${formatMoney(totalExp)}</div><div class="pnl-stat-sub">${totalAutoCost > 0 ? formatMoney(totalAutoCost) + ' invoice costs + ' + formatMoney(totalManualExp) + ' manual' : 'all-time'}</div></div>
      <div class="pnl-stat"><div class="pnl-stat-label">Lifetime Profit</div><div class="pnl-stat-value" style="color:${totalProfit >= 0 ? 'var(--green)' : 'var(--red)'};">${formatMoney(totalProfit)}</div><div class="pnl-stat-sub">net</div></div>
      <div class="pnl-stat"><div class="pnl-stat-label">Avg Monthly Profit</div><div class="pnl-stat-value" style="color:var(--ink);">${formatMoney(totalProfit / Math.max(1, getMonthsActive()))}</div><div class="pnl-stat-sub">across ${getMonthsActive()} month${getMonthsActive() !== 1 ? 's' : ''}</div></div>
    `;

    // 6-month trend
    const bars = [];
    for (let i = 5; i >= 0; i--) {
      let m = new Date().getMonth() - i;
      let y = new Date().getFullYear();
      if (m < 0) { m += 12; y--; }
      const d = pnlGetMonthData(y, m);
      bars.push({ month: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m], profit: d.profit });
    }
    const maxVal = Math.max(1, ...bars.map(b => Math.abs(b.profit)));
    document.getElementById('pnlTrendChart').innerHTML = bars.map(b => {
      const h = Math.max(4, (Math.abs(b.profit) / maxVal) * 140);
      const color = b.profit >= 0 ? 'var(--green)' : 'var(--red)';
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:160px;">
        <div style="font-family:var(--font-mono);font-size:10px;color:var(--gray);margin-bottom:4px;">${formatMoney(b.profit)}</div>
        <div style="width:100%;height:${h}px;background:${color};border-radius:4px 4px 0 0;opacity:0.7;"></div>
      </div>`;
    }).join('');
    document.getElementById('pnlTrendLabels').innerHTML = bars.map(b =>
      `<div style="flex:1;text-align:center;font-size:10px;color:var(--gray);font-weight:600;">${b.month}</div>`
    ).join('');
  }

  function getMonthsActive() {
    const invoices = getInvoices();
    const expenses = getExpenses();
    const dates = [...invoices.map(i => i.date), ...expenses.map(e => e.date)].filter(Boolean).sort();
    if (dates.length === 0) return 1;
    const first = new Date(dates[0] + 'T00:00:00');
    const now = new Date();
    return Math.max(1, Math.ceil((now - first) / (30 * 24 * 60 * 60 * 1000)));
  }

  // Placeholder for PDF export
  function exportPnlPdf() {
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const monthLabel = months[pnlMonth] + ' ' + pnlYear;
    const d = pnlGetMonthData(pnlYear, pnlMonth);
    const margin = d.revTotal > 0 ? ((d.profit / d.revTotal) * 100).toFixed(1) : '0.0';
    const bizName = _profileCache?.biz_name || 'Builders Invoice';
    const bizAddress = _profileCache?.biz_address || '';
    const bizPhone = _profileCache?.biz_phone || '';
    const bizEmail = _profileCache?.biz_email || '';

    // Revenue rows
    const revRows = d.rev.map(inv =>
      `<tr><td style="padding:8px 12px;border-bottom:1px solid #E0DBD4;font-size:13px;">${escapeHtml(inv.clientName || 'Unknown')}</td><td style="padding:8px 12px;border-bottom:1px solid #E0DBD4;font-size:12px;color:#6B7280;">${escapeHtml(inv.jobDesc || inv.invoiceNum)}</td><td style="padding:8px 12px;border-bottom:1px solid #E0DBD4;font-size:12px;color:#6B7280;">${formatDate(inv.date)}</td><td style="padding:8px 12px;border-bottom:1px solid #E0DBD4;font-family:monospace;text-align:right;color:#2D7D52;font-weight:600;">${inv.total}</td></tr>`
    ).join('') || '<tr><td colspan="4" style="padding:16px;text-align:center;color:#6B7280;">No paid invoices this month</td></tr>';

    // Auto-cost rows split by type
    const matCosts = d.autoCostItems.filter(ac => ac.lineType === 'material');
    const subCosts = d.autoCostItems.filter(ac => ac.lineType === 'sub');
    const matTotal = matCosts.reduce((s, ac) => s + ac.totalCost, 0);
    const subTotal = subCosts.reduce((s, ac) => s + ac.totalCost, 0);

    let costRows = '';
    if (matCosts.length > 0) {
      costRows += `<tr><td colspan="4" style="padding:8px 12px;background:#EDEAE5;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:#6B7280;">Material Costs · ${formatMoney(matTotal)}</td></tr>`;
      costRows += matCosts.map(ac =>
        `<tr><td style="padding:6px 12px;border-bottom:1px solid #E0DBD4;font-size:12px;">${escapeHtml(ac.desc)}</td><td style="padding:6px 12px;border-bottom:1px solid #E0DBD4;font-size:11px;color:#6B7280;">${escapeHtml(ac.clientName || '')}</td><td style="padding:6px 12px;border-bottom:1px solid #E0DBD4;font-size:11px;color:#6B7280;">${ac.qty} × ${formatMoney(ac.baseCost)}</td><td style="padding:6px 12px;border-bottom:1px solid #E0DBD4;font-family:monospace;text-align:right;color:#C0392B;">-${formatMoney(ac.totalCost)}</td></tr>`
      ).join('');
    }
    if (subCosts.length > 0) {
      costRows += `<tr><td colspan="4" style="padding:8px 12px;background:#EDEAE5;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:#6B7280;">Sub/Employee Costs · ${formatMoney(subTotal)}</td></tr>`;
      costRows += subCosts.map(ac =>
        `<tr><td style="padding:6px 12px;border-bottom:1px solid #E0DBD4;font-size:12px;">${escapeHtml(ac.desc)}</td><td style="padding:6px 12px;border-bottom:1px solid #E0DBD4;font-size:11px;color:#6B7280;">${escapeHtml(ac.clientName || '')}</td><td style="padding:6px 12px;border-bottom:1px solid #E0DBD4;font-size:11px;color:#6B7280;">${ac.qty} × ${formatMoney(ac.baseCost)}</td><td style="padding:6px 12px;border-bottom:1px solid #E0DBD4;font-family:monospace;text-align:right;color:#C0392B;">-${formatMoney(ac.totalCost)}</td></tr>`
      ).join('');
    }

    // Manual expense rows grouped by category
    const cats = {};
    d.exp.forEach(e => { if (!cats[e.category]) cats[e.category] = []; cats[e.category].push(e); });
    let manualRows = '';
    Object.keys(cats).sort().forEach(cat => {
      const catTotal = cats[cat].reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
      manualRows += `<tr><td colspan="4" style="padding:8px 12px;background:#EDEAE5;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:#6B7280;">${escapeHtml(cat)} · ${formatMoney(catTotal)}</td></tr>`;
      cats[cat].forEach(e => {
        manualRows += `<tr><td style="padding:6px 12px;border-bottom:1px solid #E0DBD4;font-size:12px;">${escapeHtml(e.description)}</td><td style="padding:6px 12px;border-bottom:1px solid #E0DBD4;font-size:11px;color:#6B7280;">${e.notes ? escapeHtml(e.notes) : '—'}</td><td style="padding:6px 12px;border-bottom:1px solid #E0DBD4;font-size:11px;color:#6B7280;">${formatDate(e.date)}</td><td style="padding:6px 12px;border-bottom:1px solid #E0DBD4;font-family:monospace;text-align:right;color:#C0392B;">-${formatMoney(parseFloat(e.amount))}</td></tr>`;
      });
    });

    const html = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<title>P&L — ${monthLabel}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap" rel="stylesheet">
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'DM Sans',sans-serif; color:#1C1C1E; font-size:13px; line-height:1.6; }
  @page { size:letter; margin:0.6in 0.7in; }
  @media print { body{-webkit-print-color-adjust:exact;print-color-adjust:exact;} #pdfBar{display:none!important;} #pdfBar+div{display:none!important;} }
  table { width:100%; border-collapse:collapse; }
</style>
</head><body>
<div style="padding:40px 48px;">

  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;padding-bottom:20px;border-bottom:2px solid #1C1C1E;">
    <div>
      <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:20px;font-weight:800;">${escapeHtml(bizName)}</div>
      ${bizAddress ? `<div style="font-size:11px;color:#6B7280;margin-top:2px;">${escapeHtml(bizAddress)}</div>` : ''}
      ${bizPhone || bizEmail ? `<div style="font-size:11px;color:#6B7280;">${[bizPhone,bizEmail].filter(Boolean).map(escapeHtml).join(' · ')}</div>` : ''}
    </div>
    <div style="text-align:right;">
      <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:2px;color:#E07A2F;">Profit & Loss</div>
      <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:18px;font-weight:700;margin-top:4px;">${monthLabel}</div>
    </div>
  </div>

  <!-- Summary Cards -->
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:28px;">
    <div style="padding:14px 16px;border:1px solid #E0DBD4;border-radius:8px;">
      <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:#6B7280;">Revenue</div>
      <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:22px;font-weight:800;color:#2D7D52;margin-top:6px;">${formatMoney(d.revTotal)}</div>
    </div>
    <div style="padding:14px 16px;border:1px solid #E0DBD4;border-radius:8px;">
      <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:#6B7280;">Expenses</div>
      <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:22px;font-weight:800;color:#C0392B;margin-top:6px;">${formatMoney(d.expTotal)}</div>
    </div>
    <div style="padding:14px 16px;border:1px solid #E0DBD4;border-radius:8px;">
      <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:#6B7280;">Net Profit</div>
      <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:22px;font-weight:800;color:${d.profit >= 0 ? '#2D7D52' : '#C0392B'};margin-top:6px;">${formatMoney(d.profit)}</div>
    </div>
    <div style="padding:14px 16px;border:1px solid #E0DBD4;border-radius:8px;">
      <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:#6B7280;">Margin</div>
      <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:22px;font-weight:800;color:#1C1C1E;margin-top:6px;">${margin}%</div>
    </div>
  </div>

  <!-- Revenue -->
  <div style="margin-bottom:24px;">
    <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:2px;color:#6B7280;margin-bottom:10px;">Revenue · ${formatMoney(d.revTotal)}</div>
    <table>
      <tr style="background:#EDEAE5;"><th style="padding:6px 12px;text-align:left;font-size:10px;font-weight:600;color:#6B7280;">Client</th><th style="padding:6px 12px;text-align:left;font-size:10px;font-weight:600;color:#6B7280;">Job</th><th style="padding:6px 12px;text-align:left;font-size:10px;font-weight:600;color:#6B7280;">Date</th><th style="padding:6px 12px;text-align:right;font-size:10px;font-weight:600;color:#6B7280;">Amount</th></tr>
      ${revRows}
    </table>
  </div>

  <!-- Cost of Goods -->
  ${d.autoCostTotal > 0 ? `
  <div style="margin-bottom:24px;">
    <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:2px;color:#6B7280;margin-bottom:10px;">Cost of Goods (from invoices) · ${formatMoney(d.autoCostTotal)}</div>
    <table>${costRows}</table>
  </div>` : ''}

  <!-- Manual Expenses -->
  ${d.exp.length > 0 ? `
  <div style="margin-bottom:24px;">
    <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:2px;color:#6B7280;margin-bottom:10px;">Expenses · ${formatMoney(d.manualExpTotal)}</div>
    <table>${manualRows}</table>
  </div>` : ''}

  <!-- Summary -->
  <div style="background:#1C1C1E;color:white;border-radius:10px;padding:20px 24px;margin-top:24px;">
    <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:14px;"><span style="color:rgba(255,255,255,0.5);">Revenue</span><span style="font-family:'DM Mono',monospace;color:#2D7D52;">${formatMoney(d.revTotal)}</span></div>
    ${d.autoCostTotal > 0 ? `<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:14px;"><span style="color:rgba(255,255,255,0.5);">Cost of Goods</span><span style="font-family:'DM Mono',monospace;">-${formatMoney(d.autoCostTotal)}</span></div>` : ''}
    ${d.manualExpTotal > 0 ? `<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:14px;"><span style="color:rgba(255,255,255,0.5);">Expenses</span><span style="font-family:'DM Mono',monospace;">-${formatMoney(d.manualExpTotal)}</span></div>` : ''}
    <div style="display:flex;justify-content:space-between;padding-top:12px;margin-top:8px;border-top:1px solid rgba(255,255,255,0.1);font-size:18px;font-weight:700;"><span>Net Profit</span><span style="font-family:'Plus Jakarta Sans',sans-serif;font-size:24px;font-weight:800;color:${d.profit >= 0 ? '#2D7D52' : '#ef4444'};">${formatMoney(d.profit)}</span></div>
  </div>

  <!-- Footer -->
  <div style="margin-top:32px;padding-top:16px;border-top:1px solid #E0DBD4;display:flex;justify-content:space-between;font-size:11px;color:#6B7280;">
    <span>${escapeHtml(bizName)}</span>
    <span>Generated ${new Date().toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' })}</span>
  </div>
</div>

<div id="pdfBar" style="position:fixed;top:0;left:0;right:0;background:#1C1C1E;padding:12px 24px;display:flex;align-items:center;justify-content:space-between;z-index:9999;box-shadow:0 2px 12px rgba(0,0,0,0.3);"><span style="font-family:'Plus Jakarta Sans',sans-serif;color:white;font-size:14px;font-weight:600;">P&L Report — ${monthLabel}</span><div style="display:flex;gap:8px;"><button onclick="document.getElementById('pdfBar').style.display='none';window.print();" style="padding:8px 20px;background:#E07A2F;color:white;border:none;border-radius:6px;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer;">Save as PDF</button><button onclick="window.close()" style="padding:8px 16px;background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.7);border:1px solid rgba(255,255,255,0.15);border-radius:6px;font-family:'DM Sans',sans-serif;font-size:13px;cursor:pointer;">Close</button></div></div><div style="height:52px;"></div>
</body></html>`;

    const win = window.open('', '_blank');
    if (win) { win.document.write(html); win.document.close(); }
    else { alert('Pop-up blocked. Please allow pop-ups.'); }
  }

  // ══════════════════════════════════
  //  ONBOARDING
  // ══════════════════════════════════
  function obNext(step) {
    // Validate step 1 before moving to step 2
    if (step === 2) {
      clearValidation();
      let valid = true;
      const bizName = document.getElementById('obBizName');
      const bizEmail = document.getElementById('obBizEmail');
      if (!bizName.value.trim()) {
        markInvalid(bizName, 'Business name is required');
        valid = false;
      }
      if (!bizEmail.value.trim()) {
        markInvalid(bizEmail, 'Email is required');
        valid = false;
      }
      if (!valid) return;
    }

    document.querySelectorAll('.onboard-step').forEach(s => s.style.display = 'none');
    document.getElementById('obStep' + step).style.display = '';
    document.querySelectorAll('.onboard-step-dots .dot').forEach((d, i) => {
      d.classList.remove('active', 'done');
      if (i < step - 1) d.classList.add('done');
      if (i === step - 1) d.classList.add('active');
    });
    if (step === 1 && currentUser) {
      const emailInput = document.getElementById('obBizEmail');
      if (!emailInput.value) emailInput.value = currentUser.email || '';
    }
  }

  function showOnboarding() {
    appInitialized = true;
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('authPage').style.display = 'none';
    document.getElementById('appShell').style.display = 'none';
    document.getElementById('onboardingPage').style.display = 'flex';
    obNext(1);
    if (currentUser) {
      document.getElementById('obBizEmail').value = currentUser.email || '';
    }
  }

  async function finishOnboarding() {
    const bizName = document.getElementById('obBizName').value.trim();
    const bizEmail = document.getElementById('obBizEmail').value.trim();

    clearValidation();
    let valid = true;
    if (!bizName) {
      markInvalid(document.getElementById('obBizName'), 'Business name is required');
      valid = false;
    }
    if (!bizEmail) {
      markInvalid(document.getElementById('obBizEmail'), 'Email is required');
      valid = false;
    }
    if (!valid) return;

    const profile = {
      biz_name: bizName,
      biz_phone: document.getElementById('obBizPhone').value.trim(),
      biz_email: bizEmail,
      biz_address: document.getElementById('obBizAddress').value.trim(),
      biz_license: document.getElementById('obBizLicense').value.trim(),
      default_tax_rate: parseFloat(document.getElementById('obTaxRate').value) || 8,
      default_valid_days: parseInt(document.getElementById('obValidDays').value) || 30,
      default_notes: document.getElementById('obNotes').value.trim(),
    };

    // Save to Supabase — wait for it
    try {
      await dbSaveProfile(profile);
      console.log('Profile saved from onboarding:', profile.biz_name);
    } catch(e) {
      console.error('Profile save error:', e);
    }

    // Hide onboarding, show app
    document.getElementById('onboardingPage').style.display = 'none';
    document.getElementById('appShell').style.display = '';

    const name = document.getElementById('obBizName').value.trim() || currentUser.email.split('@')[0];
    document.getElementById('navUserName').textContent = name;
    document.getElementById('navUserEmail').textContent = currentUser.email || '';
    document.getElementById('navAvatarLetter').textContent = (name[0] || 'U').toUpperCase();

    try { initItemGrids(); } catch(e) {}
    try { initInvItemGrids(); } catch(e) {}
    Promise.all([refreshQuotes(), refreshInvoices(), refreshClients()]).catch(e => {});
    updateTierUI();
    updateTesterAccessUI();
    showPage('home');
    appInitialized = true;
    setTimeout(showTesterAccessModal, 250);
  }

  // ══════════════════════════════════
  //  INIT — Auth State Listener
  // ══════════════════════════════════
  let appInitialized = false;

  async function initApp(session) {
    try {
      if (!session || !session.user) {
        currentUser = null;
        document.getElementById('appShell').style.display = 'none';
        document.getElementById('onboardingPage').style.display = 'none';
        document.getElementById('authPage').style.display = 'flex';
        return;
      }

      currentUser = session.user;
      console.log('initApp: user =', currentUser.email);

      // Try to fetch profile — if it fails, skip onboarding check and go to app
      let profile = null;
      let profileFetched = false;
      try {
        profile = await Promise.race([
          dbGetProfile(),
          new Promise(resolve => setTimeout(() => resolve('TIMEOUT'), 5000))
        ]);
        if (profile === 'TIMEOUT') {
          console.warn('Profile fetch timed out — skipping onboarding check');
          profile = null;
          profileFetched = false;
        } else {
          profileFetched = true;
          console.log('Profile loaded:', profile?.biz_name || '(no biz_name)');
        }
      } catch(e) {
        console.warn('Profile check error:', e);
        profileFetched = false;
      }

      // Only show onboarding if we successfully fetched the profile AND it has no biz_name
      // Only show onboarding if profile has NO business data at all
      const hasAnyBizData = profile && (profile.biz_name || profile.biz_email || profile.biz_phone || profile.biz_address);
      if (profileFetched && profile && !hasAnyBizData) {
        showOnboarding();
        return;
      }

      const email = currentUser.email || '';
      const name = currentUser.user_metadata?.full_name || email.split('@')[0];
      document.getElementById('navUserName').textContent = name;
      document.getElementById('navUserEmail').textContent = email;
      document.getElementById('navAvatarLetter').textContent = (name[0] || 'U').toUpperCase();

      document.getElementById('authPage').style.display = 'none';
      document.getElementById('onboardingPage').style.display = 'none';
      document.getElementById('appShell').style.display = '';

      try { initItemGrids(); } catch(e) {}
      try { initInvItemGrids(); } catch(e) {}
      Promise.all([refreshQuotes(), refreshInvoices(), refreshClients()]).catch(e => {});
      updateTierUI();
      updateTesterAccessUI();
      showPage('home');
      appInitialized = true;

      setTimeout(showTesterAccessModal, 250);

      // Check if returning from Stripe upgrade
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('upgraded')) {
        setTimeout(() => {
          const tierName = getUserTier() === 'business' ? 'Business' : (getUserTier() === 'pro' ? 'Pro' : 'your new');
          showToast('Welcome to ' + tierName + '! 🎉');
          // Clean URL
          window.history.replaceState({}, '', window.location.pathname);
        }, 500);
      }
    } catch(e) {
      console.error('initApp fatal:', e);
      document.getElementById('authPage').style.display = 'flex';
    } finally {
      document.getElementById('loadingScreen').style.display = 'none';
    }
  }

  let initInProgress = false;
  let authPageShownByUser = false;

  sb.auth.onAuthStateChange(async (event, session) => {
    if (window.__isDocViewer) return; // Don't init app when viewing shared doc
    if (event === 'PASSWORD_RECOVERY') {
      currentUser = session?.user || null;
      document.getElementById('loadingScreen').style.display = 'none';
      document.getElementById('appShell').style.display = 'none';
      document.getElementById('onboardingPage').style.display = 'none';
      document.getElementById('authPage').style.display = 'flex';
      document.getElementById('authMainView').style.display = 'none';
      document.getElementById('authForgotView').style.display = 'none';
      document.getElementById('authResetView').style.display = '';
    } else if (event === 'INITIAL_SESSION') {
      // This fires once on page load — determines initial state
      if (session && session.user) {
        if (appInitialized || initInProgress) return;
        initInProgress = true;
        await initApp(session);
        initInProgress = false;
      } else {
        // No session — show auth page
        document.getElementById('loadingScreen').style.display = 'none';
        document.getElementById('authPage').style.display = 'flex';
        authPageShownByUser = true;
      }
    } else if (event === 'SIGNED_IN') {
      // Only fires after explicit user sign-in action
      // Don't interrupt if auth page isn't the one that triggered this
      if (appInitialized || initInProgress) return;
      initInProgress = true;
      await initApp(session);
      initInProgress = false;
    } else if (event === 'SIGNED_OUT') {
      appInitialized = false;
      initInProgress = false;
      currentUser = null;
      _profileCache = null;
      document.getElementById('loadingScreen').style.display = 'none';
      document.getElementById('appShell').style.display = 'none';
      document.getElementById('onboardingPage').style.display = 'none';
      document.getElementById('authPage').style.display = 'flex';
      authPageShownByUser = true;
    }
  });
