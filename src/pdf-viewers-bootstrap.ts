import {
    type EnvironmentProviders,
    inject,
    makeEnvironmentProviders,
    provideAppInitializer,
} from '@angular/core';

import { ViewerComponentRegistry } from '@coolms/document-viewer-angular';
import { PdfViewerComponent } from './pdf-viewer.component';

/**
 * Registers `PdfViewerComponent` into the federation-style
 * `ViewerComponentRegistry` so `<cms-viewer-host>` can mount it when
 * the manifest dispatches `application/pdf`. Call once from the app's
 * `ApplicationConfig.providers` array — `provideAppInitializer` runs
 * the registration synchronously during bootstrap.
 */
export function provideCoolmsPdf(): EnvironmentProviders {
    return makeEnvironmentProviders([
        provideAppInitializer(() => {
            const registry = inject(ViewerComponentRegistry);
            registry.register('app-pdf-viewer', PdfViewerComponent);

            // `app-office-viewer` (#1788) is the SAME component: xlsx and pptx
            // are shown as a PDF rendition produced by LibreOffice, because no
            // client-side library renders them faithfully enough to ship. The
            // caller points it at `/document/preview.pdf`, so by the time the
            // bytes arrive this really is a PDF — a second component would be
            // the same code with a different name.
            registry.register('app-office-viewer', PdfViewerComponent);
        }),
    ]);
}
