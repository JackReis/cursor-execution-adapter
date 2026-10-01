# Security boundaries

The adapter is experimental. Treat prompts, input data, downloaded artifacts, and provider responses as untrusted. Run it under a dedicated OS account when processing hostile data. The local adapter exposes only allowlisted file tools; cloud execution still has the repository and service-configured capabilities described in README.

Do not post secrets in public issues. For a suspected issue, first open a minimal issue requesting a private reporting channel without exploit details or sensitive data. Keep SDK credentials, receipts, checkpoints, and real fleet inventories outside this repository.

The external verifier is trusted code supplied by the operator. The adapter does not sandbox Ringer check commands or make Cursor usage free.
