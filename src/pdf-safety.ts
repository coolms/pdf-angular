import { pdfDefaultOptions } from 'ngx-extended-pdf-viewer';

/**
 * What a PDF may DO in this viewer, pinned rather than left to the library's defaults.
 *
 * ngx-extended-pdf-viewer bundles its own pdf.js. Its defaults leave scripting off but XFA ON, and a default
 * is one release away from changing. A PDF opened here may be anyone's upload, so nothing in it runs:
 *
 *  - `enableScripting`: the document's JavaScript (actions, field calculations, `app.alert`...) does not run;
 *  - `enableOpenActionJavaScript`, `enableCatalogAAJavaScript`: nor the scripts a document asks to run on open;
 *  - `enableXfa`: XFA forms are not rendered. A PDF that is only an XFA form shows its fallback page, or
 *    nothing. Rendering XFA again is a new decision, not a setting to flip.
 */
export const PDF_SAFETY_OPTIONS = {
    enableScripting: false,
    enableOpenActionJavaScript: false,
    enableCatalogAAJavaScript: false,
    enableXfa: false,
} as const;

/** Writes {@link PDF_SAFETY_OPTIONS} over the viewer's defaults; idempotent. */
export function pinPdfSafetyOptions(): void {
    Object.assign(pdfDefaultOptions, PDF_SAFETY_OPTIONS);
}
