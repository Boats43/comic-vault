# API Data Completeness Audit — Ship #28 Investigation
**Date:** 2026-06-24  
**Status:** Investigation only — GREENLIGHT REQUIRED before refactor  
**Goal:** Map what data we're leaving on the table vs what AI receives

---

## EXECUTIVE SUMMARY

**Current architecture:** API calls extract rich structured data → we discard 60-70% of it → pass sparse summaries to AI → AI re-derives what we already had

**Opportunity:** Data-first pipeline that extracts complete API payloads → stores deterministic facts → only calls AI for genuine conflicts

**Est. AI call reduction:** 70-80% (most books have clean data, no conflicts)

---

See full audit in file.
