const { Pool } = require('pg')

// PGSSL=true일 때만 SSL로 접속(RDS 등 SSL 필수 환경용). 로컬/인클러스터 Postgres는
// SSL 없이 붙으므로 기본값은 false — env 하나로 갈아끼우면 되게 해둔다.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
})

module.exports = pool
