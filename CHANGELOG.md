# Changelog

All notable changes to `@coolms/pdf-angular` are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

This file starts at the version named below, which is what the registry
currently serves. Earlier alphas are deliberately not reconstructed: entries are written
in the same commit as the work they describe, and inventing the ones that
predate this file would be a worse record than not having them.

## 2.0.0-alpha.2 -- 2026-09-03

**A pre-release, carrying no compatibility promise.** Published under the
`alpha` dist-tag.

The PDF viewer. It registers itself with `@coolms/document-viewer-angular`, so
consumers dispatch through the viewer host rather than importing this component
-- installing it is what makes PDFs open, with no other change at the call site.
