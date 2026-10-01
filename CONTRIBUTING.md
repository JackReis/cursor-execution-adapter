# Contributing

Keep changes focused and include an executable regression test. Run `npm ci --ignore-scripts`, `npm test`, and `npm run check` with Node 22.13 or newer.

Tests must not require credentials, send paid requests, or upload local files. Live pilot results must identify the tested SDK version and distinguish provider completion from independent verification. Never include credentials or private execution receipts in issues or pull requests.

Contributions to this repository are under MIT. Do not copy Ringer source or redistribute Cursor SDK implementation into this repository. Keep changes to those projects separate and retain their licenses.
