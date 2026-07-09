const pool = require('./db/pool')

// 랭킹전 대국 1건을 기보로 저장. moves는 [{row,col,player}, ...] 착수 순서 그대로.
async function recordGame({
  blackUserId, whiteUserId, winner, reason, forbiddenType,
  blackRatingBefore, whiteRatingBefore, blackRatingDelta, whiteRatingDelta,
  moves, startedAt,
}) {
  await pool.query(
    `INSERT INTO games (
       black_user_id, white_user_id, winner, reason, forbidden_type,
       black_rating_before, white_rating_before, black_rating_delta, white_rating_delta,
       moves, started_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      blackUserId, whiteUserId, winner, reason, forbiddenType ?? null,
      blackRatingBefore, whiteRatingBefore, blackRatingDelta, whiteRatingDelta,
      JSON.stringify(moves), startedAt,
    ]
  )
}

module.exports = { recordGame }
