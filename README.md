# @coolms/pdf-angular

The CoolMS PDF viewer for Angular.

## Install

```bash
npm install @coolms/pdf-angular @coolms/document-viewer-angular @coolms/core-angular
```

## Use

Register it once, then dispatch through the viewer host rather than importing
the component:

```ts
import { provideCoolmsPdf } from '@coolms/pdf-angular';

providers: [provideCoolmsPdf()]
```

```html
<cms-viewer-host mimeType="application/pdf" [url]="url" />
```

Importing `PdfViewerComponent` directly works, but bypasses the registry that
lets a document surface show a format it was never told about.

## Building it

Peers are consumed as BUILT output, never as sources: compiling a peer's
sources in would place them outside this package's `rootDir` (TS6059) and ship
a second copy of that peer to anyone installing both. Build in dependency
order:

    document-engine -> core-angular -> editor-angular -> ui-angular
                    -> document-angular, document-viewer-angular,
       image-editor-angular -> pdf-angular

## Status

Not published, and no repository yet. `tools/publish-guard.sh` reports "no
tracked files" for it -- the guard refusing to certify what it cannot read,
which is not the same as a clean result.

## Licence

MIT.
