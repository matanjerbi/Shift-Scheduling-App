-- What a payment should have been by the hourly rates, and any earlier gap it also paid off (per worker)
ALTER TABLE periods ADD COLUMN expected_amount REAL;
ALTER TABLE periods ADD COLUMN carry_json TEXT;
