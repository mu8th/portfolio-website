# Deliberately vulnerable scan target

This directory exists only to be **scanned** by the portfolio's vulnerability
scanner demo. It is never imported, executed or served. Each flaw is planted on
purpose next to a safe look-alike, and `expected.json` labels every line the
demo cares about, so the scan's precision and recall are measured, not claimed.

The AWS key is Amazon's documented example value (`AKIAIOSFODNN7EXAMPLE`); the
Stripe-style key is a made-up placeholder. Neither grants access to anything.
