-- Remove duplicate follow rows before enforcing uniqueness.
DELETE FROM user_followers a
USING user_followers b
WHERE a.ctid < b.ctid
  AND a.follower_id = b.follower_id
  AND a.following_id = b.following_id;

CREATE UNIQUE INDEX IF NOT EXISTS user_followers_follower_following_idx
  ON user_followers (follower_id, following_id);
