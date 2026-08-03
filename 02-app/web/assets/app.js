// EyeG-Stack 共通スクリプト: API クライアント / 認証ガード / 共通モーダル

// --- API クライアント -------------------------------------------------------

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  // コード検証の 401（コード誤り・期限切れ）はリダイレクトせず、呼び出し側で
  // メッセージ表示させる。それ以外の 401（セッション切れ等）はログインへ。
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/auth/verify-code') {
    window.location.href = 'login.html';
    throw new ApiError(401, 'ログインが必要です');
  }
  if (!res.ok) throw new ApiError(res.status, data.error || `エラー (${res.status})`);
  return data;
}

// ログイン必須ページの入口で呼ぶ。未ログインなら login.html へ飛ぶ。
async function requireLogin() {
  const { user } = await api('/api/auth/me');
  return user;
}

// ヘッダーのスーパーリロードボタン（キャッシュを無視して強制再取得）を配線する
function setupReload() {
  const btn = document.querySelector('.reload-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const url = new URL(window.location.href);
    url.searchParams.set('_r', Date.now());
    window.location.replace(url.toString());
  });
}
setupReload();

// ヘッダー右上のログアウトボタン（アイコンは HTML 側に埋め込み済み）を配線する
function setupAvatar(user) {
  const avatar = document.querySelector('.eyeg-avatar');
  if (!avatar) return;
  avatar.title = `ログアウト（${user.email}）`;
  avatar.addEventListener('click', async () => {
    const ok = await eyegConfirm({
      title: 'ログアウトしますか？',
      message: user.email,
      confirmLabel: 'ログアウト',
    });
    if (ok) {
      await api('/api/auth/logout', { method: 'POST' });
      window.location.href = 'login.html';
    }
  });
}

// --- カテゴリ表示名（デフォルト + ユーザーカスタム） -------------------------

const DEFAULT_LABELS = { personal: '私用', work: '仕事用', general: '一般' };
let labelsCache = null;

async function getLabels() {
  if (!labelsCache) {
    try {
      labelsCache = (await api('/api/labels')).labels;
    } catch {
      labelsCache = DEFAULT_LABELS;
    }
  }
  return labelsCache;
}

// --- 整形ヘルパー ------------------------------------------------------------

function fmtDateTime(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDate(dateStr) {
  if (!dateStr) return null;
  const [y, mo, day] = dateStr.split('-');
  return `${y}/${mo}/${day}`;
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// --- 共通モーダル（eyeg-cal の EyeG.confirm 移植） ---------------------------

function eyegConfirm(opts) {
  return new Promise((resolve) => {
    const title = opts.title || '確認';
    const message = opts.message || '';
    const confirmLabel = opts.confirmLabel || 'OK';
    const cancelLabel = opts.cancelLabel || 'キャンセル';
    const danger = !!opts.danger;
    const alertMode = !!opts.alertMode; // OK のみ（通知用）

    const backdrop = document.createElement('div');
    backdrop.className = 'eyeg-modal-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.style.zIndex = '200'; // 詳細モーダルより前面

    const modal = document.createElement('div');
    modal.className = 'eyeg-modal eyeg-confirm';

    const header = document.createElement('div');
    header.className = 'eyeg-modal__header';
    const h2 = document.createElement('h2');
    h2.className = 'eyeg-modal__title';
    h2.textContent = title;
    header.appendChild(h2);

    const body = document.createElement('div');
    body.className = 'eyeg-modal__body eyeg-confirm__body';
    if (message) {
      const p = document.createElement('p');
      p.className = 'eyeg-confirm__message';
      p.textContent = message;
      body.appendChild(p);
    }

    const footer = document.createElement('div');
    footer.className = 'eyeg-modal__footer eyeg-confirm__footer';

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'eyeg-button ' + (danger ? 'eyeg-button--danger' : 'eyeg-button--primary');
    okBtn.textContent = confirmLabel;

    if (!alertMode) {
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'eyeg-button eyeg-button--ghost';
      cancelBtn.textContent = cancelLabel;
      cancelBtn.addEventListener('click', () => cleanup(false));
      footer.appendChild(cancelBtn);
    }
    footer.appendChild(okBtn);

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    backdrop.appendChild(modal);

    function cleanup(result) {
      backdrop.removeEventListener('click', onBackdropClick);
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      resolve(result);
    }
    function onBackdropClick(e) {
      if (e.target === backdrop) cleanup(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') cleanup(false);
      if (e.key === 'Enter') cleanup(true);
    }
    okBtn.addEventListener('click', () => cleanup(true));
    backdrop.addEventListener('click', onBackdropClick);
    document.addEventListener('keydown', onKey);

    document.body.appendChild(backdrop);
    okBtn.focus();
  });
}

const eyegAlert = (title, message) =>
  eyegConfirm({ title, message, alertMode: true });
