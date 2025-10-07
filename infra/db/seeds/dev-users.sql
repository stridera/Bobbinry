-- Development Test Users
-- Run with: psql $DATABASE_URL -f infra/db/seeds/dev-users.sql

-- Delete existing test data
DELETE FROM users WHERE email IN ('test@example.com', 'demo@bobbinry.com', 'writer@bobbinry.com');

-- Test User 1: Basic test account
INSERT INTO users (id, email, name, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'test@example.com',
  'Test User',
  NOW(),
  NOW()
) ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  name = EXCLUDED.name,
  updated_at = NOW();

-- Test User 2: Demo writer account
INSERT INTO users (id, email, name, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  'demo@bobbinry.com',
  'Demo Writer',
  NOW(),
  NOW()
) ON CONFLICT (id) DO NOTHING;

-- Test User 3: Active writer with projects
INSERT INTO users (id, email, name, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000003',
  'writer@bobbinry.com',
  'Active Writer',
  NOW(),
  NOW()
) ON CONFLICT (id) DO NOTHING;

-- Create user profiles for test users
INSERT INTO user_profiles (user_id, username, display_name, bio, created_at, updated_at)
VALUES
  (
    '00000000-0000-0000-0000-000000000001',
    'testuser',
    'Test User',
    'This is a test account for development',
    NOW(),
    NOW()
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    'demowriter',
    'Demo Writer',
    'Demo account showcasing the platform features',
    NOW(),
    NOW()
  ),
  (
    '00000000-0000-0000-0000-000000000003',
    'activewriter',
    'Active Writer',
    'Professional writer testing the publishing workflow',
    NOW(),
    NOW()
  )
ON CONFLICT (user_id) DO UPDATE SET
  username = EXCLUDED.username,
  display_name = EXCLUDED.display_name,
  bio = EXCLUDED.bio,
  updated_at = NOW();

-- Create a test project for demo user
INSERT INTO projects (id, name, description, owner_id, created_at, updated_at)
VALUES (
  '10000000-0000-0000-0000-000000000001',
  'Demo Novel Project',
  'A sample project with Manuscript bobbin installed',
  '00000000-0000-0000-0000-000000000002',
  NOW(),
  NOW()
) ON CONFLICT (id) DO NOTHING;

-- Success message
SELECT 'Development test users created successfully!' AS message;
SELECT email, name, id FROM users WHERE email LIKE '%@bobbinry.com' OR email = 'test@example.com';
