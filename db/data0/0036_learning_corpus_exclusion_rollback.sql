-- Rollback for 0036_learning_corpus_exclusion.sql
SET search_path TO data1_dev;
DROP VIEW IF EXISTS organic_operator_correction_event;
DROP VIEW IF EXISTS organic_model_prediction_event;
DROP TABLE IF EXISTS learning_corpus_exclusion;
