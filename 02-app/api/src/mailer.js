import { config } from './config.js';

// Resend (https://resend.com) でマジックリンクを送る。
// API キー未設定時は送信せずログに出す（ローカル開発用フォールバック）。
export async function sendLoginLink(email, url) {
  if (!config.resendApiKey) {
    console.log(`[mailer] RESEND_API_KEY 未設定のためログ出力のみ: ${email} -> ${url}`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.mailFrom,
      to: [email],
      subject: 'EyeG-Stack ログインリンク',
      text: [
        'EyeG-Stack へのログインリンクです。',
        '',
        url,
        '',
        `このリンクは ${config.loginTokenTtlMin} 分間有効で、1回だけ使えます。`,
        '心当たりがない場合はこのメールを無視してください。',
      ].join('\n'),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend API error ${res.status}: ${detail}`);
  }
}
