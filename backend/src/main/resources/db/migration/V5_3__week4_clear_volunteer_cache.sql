-- 4주차 보완 3 (2026-10-21): the first 1365 responses on the server were read with the wrong character set,
-- so titles and places were stored as broken text. volunteer_programs is only a cache: empty it and let the
-- server fetch the programs again with the fixed reader.
DELETE FROM volunteer_programs;
