-- Self-use mode: a buyer can set up a parent profile for themselves, not
-- just as a gift for someone else.
ALTER TYPE relationship_t ADD VALUE 'self';
