-- Rows synced before unpriced models were detected carry a cost the old code
-- invented: any model it did not recognise was billed at Claude 3.5 Sonnet
-- rates. The new column defaulted those rows to 'estimated', which asserts that
-- number is trustworthy.
--
-- Their provenance is genuinely unknown, so they are marked as such. The figure
-- itself is left in place: nothing renders it while the confidence says unknown,
-- and the next time a session's file changes it is recomputed properly.
UPDATE `sessions` SET `cost_confidence` = 'unknown';
