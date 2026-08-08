    // 編集モード: push.html?id=<memoId> で既存メモをプリフィルし「更新」にする
    const editId = new URLSearchParams(window.location.search).get('id');

    let labels = { ...DEFAULT_LABELS };
    let selectedCategory = 'personal';
    let importance = 3; // デフォルト3（未操作でも3で送る）
    let photos = [null, null, null, null]; // base64（プレフィックスなし）
    let gps = { latitude: null, longitude: null };

    // === カテゴリ トグル ===
    const catButtons = document.querySelectorAll('.cat-toggle__btn');
    function setCategory(cat) {
      selectedCategory = cat;
      catButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cat === cat)));
    }
    catButtons.forEach((btn) => {
      btn.addEventListener('click', () => setCategory(btn.dataset.cat));
    });

    // === 詳細パネル 開閉 ===
    const detailToggle = document.getElementById('detail-toggle');
    const detailPanel = document.getElementById('detail-panel');
    function setDetailOpen(open) {
      if (open) detailPanel.removeAttribute('hidden');
      else detailPanel.setAttribute('hidden', '');
      detailToggle.setAttribute('aria-expanded', String(open));
      detailToggle.textContent = open ? '− 詳細' : '+ 詳細';
    }
    detailToggle.addEventListener('click', () => setDetailOpen(detailPanel.hasAttribute('hidden')));

    // === 重要度スター ===
    const stars = document.querySelectorAll('.importance__star');
    function renderStars() {
      stars.forEach((s) => {
        const v = Number(s.dataset.value);
        s.setAttribute('aria-pressed', String(importance !== null && v <= importance));
      });
    }
    stars.forEach((star) => {
      star.addEventListener('click', () => {
        importance = Number(star.dataset.value);
        renderStars();
      });
    });
    renderStars();

    // === 写真: 選択 → 長辺1024pxに縮小 → JPEG base64 ===
    const photoInput = document.getElementById('photo-input');
    const photoSlots = document.querySelectorAll('.photo-slot');
    let targetSlot = 0;

    function renderPhotos() {
      photoSlots.forEach((slot, i) => {
        slot.innerHTML = '';
        if (photos[i]) {
          const img = document.createElement('img');
          img.src = `data:image/jpeg;base64,${photos[i]}`;
          img.alt = `写真 ${i + 1}`;
          slot.appendChild(img);
          slot.classList.add('photo-slot--filled');
          slot.setAttribute('aria-label', `写真 ${i + 1} を削除`);
        } else {
          slot.textContent = '＋';
          slot.classList.remove('photo-slot--filled');
          slot.setAttribute('aria-label', '写真を追加');
        }
      });
    }

    function resizeToBase64(file) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          const MAX = 1024;
          const scale = Math.min(1, MAX / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした')); };
        img.src = url;
      });
    }

    photoSlots.forEach((slot) => {
      slot.addEventListener('click', async () => {
        const i = Number(slot.dataset.slot);
        if (photos[i]) {
          const ok = await eyegConfirm({
            title: 'この写真を外しますか？',
            confirmLabel: '外す', danger: true,
          });
          if (ok) { photos[i] = null; renderPhotos(); }
        } else {
          targetSlot = i;
          photoInput.click();
        }
      });
    });

    photoInput.addEventListener('change', async () => {
      const file = photoInput.files[0];
      photoInput.value = '';
      if (!file) return;
      try {
        photos[targetSlot] = await resizeToBase64(file);
        renderPhotos();
      } catch (err) {
        eyegAlert('写真を追加できませんでした', err.message);
      }
    });

    // === GPS（バックグラウンド取得。UIは小さなステータスのみ） ===
    const gpsText = document.getElementById('gps-text');
    const gpsDot = document.querySelector('.gps-status__dot');
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          gps.latitude = pos.coords.latitude;
          gps.longitude = pos.coords.longitude;
          gpsText.textContent = `GPS取得済み（${gps.latitude.toFixed(4)}, ${gps.longitude.toFixed(4)}）`;
          gpsDot.style.animation = 'none';
        },
        () => { gpsText.textContent = 'GPS取得できませんでした'; gpsDot.style.animation = 'none'; },
        { enableHighAccuracy: false, timeout: 8000 }
      );
    } else {
      gpsText.textContent = 'GPS非対応';
      gpsDot.style.animation = 'none';
    }

    // === フォーム値の収集 / リセット ===
    const bodyInput = document.getElementById('memo-body');
    const dueInput = document.getElementById('due-date');

    function collectPayload() {
      return {
        body: bodyInput.value,
        category: selectedCategory,
        importance,
        due_at: dueInput.value || null,
        latitude: gps.latitude,
        longitude: gps.longitude,
        photos: photos.filter(Boolean),
      };
    }

    function resetForm() {
      bodyInput.value = '';
      setCategory('personal');
      importance = 3;
      renderStars();
      dueInput.value = '';
      photos = [null, null, null, null];
      renderPhotos();
      setDetailOpen(false);
      bodyInput.focus();
    }

    function summaryText(p) {
      return `カテゴリ: ${labels[p.category]}\n` +
        `重要度: ${p.importance ?? '未設定'}\n` +
        `期限: ${fmtDate(p.due_at) || '未設定'}\n` +
        `写真: ${p.photos.length ? p.photos.length + '枚' : 'なし'}\n` +
        `メモ: ${p.body.trim() || '（空）'}`;
    }

    // === Push / 更新 ===
    const pushBtn = document.getElementById('push-btn');
    pushBtn.addEventListener('click', async () => {
      const payload = collectPayload();
      const isEdit = !!editId;

      const ok = await eyegConfirm({
        title: isEdit ? 'このメモを更新しますか？' : 'このメモを Push しますか？',
        message: summaryText(payload),
        confirmLabel: isEdit ? '更新' : 'Push',
      });
      if (!ok) return;

      pushBtn.disabled = true;
      try {
        if (isEdit) {
          await api(`/api/memos/${editId}`, { method: 'PUT', body: payload });
          window.location.href = 'check.html';
        } else {
          await api('/api/memos', { method: 'POST', body: payload });
          await eyegAlert('Push しました', 'スタックに積みました。');
          resetForm();
        }
      } catch (err) {
        eyegAlert('保存できませんでした', err.message);
      } finally {
        pushBtn.disabled = false;
      }
    });

    // === 削除（編集モードのみ。effect は Push 側に集約） ===
    document.getElementById('delete-btn').addEventListener('click', async () => {
      if (!editId) return; // 新規モードでは何もしない（ボタン自体も非表示）
      const ok = await eyegConfirm({
        title: 'このメモを削除しますか？',
        message: '削除すると元に戻せません。',
        confirmLabel: '削除',
        danger: true,
      });
      if (!ok) return;
      try {
        await api(`/api/memos/${editId}`, { method: 'DELETE' });
        window.location.href = 'check.html';
      } catch (err) {
        eyegAlert('削除できませんでした', err.message);
      }
    });

    // === 初期化 ===
    (async () => {
      try {
        const user = await requireLogin();
        setupAvatar(user);
        labels = await getLabels();
        catButtons.forEach((b) => { b.textContent = labels[b.dataset.cat]; });

        if (editId) {
          document.getElementById('screen-subtitle').textContent = 'Push — 編集';
          document.title = 'EyeG-Stack Push（編集）';
          pushBtn.textContent = '更新';
          document.getElementById('delete-btn').hidden = false;

          const { memo } = await api(`/api/memos/${editId}`);
          bodyInput.value = memo.body;
          setCategory(memo.category);
          importance = memo.importance ?? 3; // 旧データの未設定も 3 として扱う
          renderStars();
          dueInput.value = memo.due_at || '';
          gps.latitude = memo.latitude;
          gps.longitude = memo.longitude;

          const { photos: existing } = await api(`/api/memos/${editId}/photos`);
          existing.forEach((p) => { photos[p.order] = p.data; });
          renderPhotos();

          // 既存値が見えるよう詳細パネルを開いておく
          if (memo.importance || memo.due_at || existing.length) setDetailOpen(true);
        }
      } catch (err) {
        if (err.status !== 401) eyegAlert('読み込みエラー', err.message);
      }
    })();
