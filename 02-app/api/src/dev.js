// ローカル開発エントリ: nginx なしで web/ を直接配信して起動する
process.env.SERVE_STATIC = '1';
process.env.PORT = process.env.PORT || '3456';
await import('./server.js');
