# Security Policy

## Reporting a vulnerability

Please report security issues privately. Do not open a public issue for a
suspected vulnerability.

Use GitHub's private reporting: open the repository's **Security** tab and choose
**Report a vulnerability**. Include the affected version or commit, steps to
reproduce, and the impact you observed.

We aim to acknowledge a report within a few days and will keep you updated as we
work on a fix. Please give us reasonable time to release a patch before any
public disclosure.

## What to expect

1. We confirm the report and assess severity.
2. We prepare a fix and, when relevant, a coordinated disclosure.
3. We credit reporters who want to be named.

## Handling secrets

This project keeps all secrets out of source control. Configuration lives in
`.env` (which is git-ignored), and runtime-changeable credentials are stored
encrypted in the database. If you find a committed secret, report it privately
using the process above.
