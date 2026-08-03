import { config } from './config.js';

// Resend (https://resend.com) でログインコード（6桁）を送る。
// API キー未設定時は送信せずログに出す（ローカル開発用フォールバック）。
export async function sendLoginCode(email, code) {
  if (!config.resendApiKey) {
    console.log(`[mailer] RESEND_API_KEY 未設定のためログ出力のみ: ${email} -> コード ${code}`);
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
      subject: `EyeG-Stack ログインコード ${code}`,
      text: [
        'EyeG-Stack のログインコードです。',
        '',
        `    ${code}`,
        '',
        `このコードは ${config.loginCodeTtlMin} 分間有効で、1回だけ使えます。`,
        'アプリの画面に入力してください。',
        '心当たりがない場合はこのメールを無視してください。',
      ].join('\n'),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend API error ${res.status}: ${detail}`);
  }
}
