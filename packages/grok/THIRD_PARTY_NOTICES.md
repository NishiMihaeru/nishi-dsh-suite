# Third-Party Notices

This package drives the user's own installed official Grok Build CLI (`grok`) through its published headless and ACP interfaces. It does not bundle, redistribute, or vendor the Grok Build CLI, any xAI SDK, any model runtime, or any credential store.

The `grok` binary is distributed by SpaceXAI under the Apache License 2.0 and is installed by the user, not by this package. Authentication and session state remain owned by that product boundary: nothing here reads, copies, parses, migrates, or deletes `~/.grok/auth.json`, and no API key is read or written. Each user drives their own installation under their own account.

xAI's Brand Guidelines allow their marks to be used only to accurately refer to their own services. This package refers to the vendor's product by name for that purpose and ships no xAI logo, glyph, or brand colour.

See the repository root `THIRD_PARTY_NOTICES.md` for repository-wide notices, and `docs/verification/grok-cli-contract.md` for the vendor-contract and terms read this package rests on.
