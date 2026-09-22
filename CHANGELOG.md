# Changelog

All notable changes to `@coolms/pdf-angular` are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

This file starts at the version named below, which is what the registry
currently serves. Earlier alphas are deliberately not reconstructed: entries are written
in the same commit as the work they describe, and inventing the ones that
predate this file would be a worse record than not having them.

## Unreleased

### Changed

- A pressed toolbar button (the library's `.toggled`, `.selected` and
  `[aria-selected='true']`, hovered or not) reads the host theme's selected
  family -- `--cms-selected-light` under `--cms-selected-text`, bordered in
  `--cms-selected` -- instead of a tint of the accent mixed by hand at 14
  and 22 per cent, so a theme that moves selection moves the toolbar with
  it. The hover of a pressed button is the pressed state; the wash no longer
  deepens on hover.

### Added

- Declares `bugs` so a page imported from this package, and the catalogue,
  know where a correction is filed. The registry filled the gap from GitHub when
  the manifest was silent; the declared field is the one that holds on any
  registry.

## 2.0.0-alpha.2 -- 2026-09-03

**A pre-release, carrying no compatibility promise.** Published under the
`alpha` dist-tag.

The PDF viewer. It registers itself with `@coolms/document-viewer-angular`, so
consumers dispatch through the viewer host rather than importing this component
-- installing it is what makes PDFs open, with no other change at the call site.
