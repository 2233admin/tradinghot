-- A confirmed forum post may be its own title; tie that exception to the exact verified body.
CREATE TABLE verified_forum_bodies (
  article_id text PRIMARY KEY REFERENCES articles (id) ON DELETE CASCADE,
  body_hash text NOT NULL
);
