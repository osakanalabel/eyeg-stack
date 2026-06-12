import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

// DATE 型(OID 1082)は JS Date に変換せず 'YYYY-MM-DD' 文字列のまま受け取る。
// due_at は「ユーザーTZでの期限日」を表す日付であり、TZ変換が混ざると日付がずれるため。
pg.types.setTypeParser(1082, (v) => v);

export const pool = new Pool({ connectionString: config.databaseUrl });

export const query = (text, params) => pool.query(text, params);
