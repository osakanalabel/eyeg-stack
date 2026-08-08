    const emailForm = document.getElementById('email-form');
    const codeForm = document.getElementById('code-form');
    const emailInput = document.getElementById('email');
    const codeInput = document.getElementById('code');
    const sendBtn = document.getElementById('send-btn');
    const verifyBtn = document.getElementById('verify-btn');
    const backBtn = document.getElementById('back-btn');
    const sentTo = document.getElementById('code-sent-to');
    const note = document.getElementById('login-note');

    // ログイン済みならメニューへ
    fetch('/api/auth/me', { credentials: 'same-origin' }).then((res) => {
      if (res.ok) window.location.href = 'index.html';
    });

    // 数字以外の入力を弾く（ペースト時も含めて数字6桁に整形）
    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6);
    });

    // ステップ1: コード送信
    emailForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      sendBtn.disabled = true;
      note.textContent = '送信中…';
      try {
        await api('/api/auth/request-code', {
          method: 'POST',
          body: { email: emailInput.value },
        });
        note.textContent = '';
        sentTo.textContent = emailInput.value.trim();
        emailForm.hidden = true;
        codeForm.hidden = false;
        codeInput.focus();
      } catch (err) {
        note.textContent = err.message;
      } finally {
        sendBtn.disabled = false;
      }
    });

    // ステップ2: コード検証 → 成功でメニューへ
    codeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      verifyBtn.disabled = true;
      note.textContent = '確認中…';
      try {
        await api('/api/auth/verify-code', {
          method: 'POST',
          body: { email: emailInput.value, code: codeInput.value },
        });
        window.location.href = 'index.html';
      } catch (err) {
        note.textContent = err.message;
        verifyBtn.disabled = false;
      }
    });

    // メールアドレス変更（ステップ1へ戻る）
    backBtn.addEventListener('click', () => {
      codeForm.hidden = true;
      emailForm.hidden = false;
      codeInput.value = '';
      note.textContent = '';
      emailInput.focus();
    });
