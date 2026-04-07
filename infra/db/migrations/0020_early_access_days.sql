-- Flip chapter access model: "delay public access" → "early subscriber access"
-- Rename chapter_delay_days → early_access_days with value inversion

-- Step 1: Add new column
ALTER TABLE subscription_tiers ADD COLUMN IF NOT EXISTS early_access_days integer NOT NULL DEFAULT 0;

-- Step 2: Invert values per-author (earlyAccessDays = maxDelay - currentDelay)
UPDATE subscription_tiers st
SET early_access_days = author_max.max_delay - st.chapter_delay_days
FROM (
  SELECT author_id, MAX(chapter_delay_days) AS max_delay
  FROM subscription_tiers
  WHERE is_active = true
  GROUP BY author_id
) author_max
WHERE st.author_id = author_max.author_id;

-- Step 3: Remove embargo delay from all published chapters (publicReleaseDate = publishedAt)
UPDATE chapter_publications
SET public_release_date = published_at
WHERE published_at IS NOT NULL;

-- Step 4: Drop old column
ALTER TABLE subscription_tiers DROP COLUMN IF EXISTS chapter_delay_days;
