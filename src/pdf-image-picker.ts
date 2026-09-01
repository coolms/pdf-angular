import { InjectionToken } from '@angular/core';

/**
 * Where the PDF viewer gets an image to stamp onto a page.
 *
 * pdf.js opens a bare browser file dialog for its image (stamp) tool. An app
 * that has its own media library wants its own picker there instead, so the
 * viewer asks this port first and only falls back to the library's dialog when
 * nothing is provided.
 *
 * The implementation returns something the viewer can hand to
 * `addImageToAnnotationLayer`: a data URL, or a URL the browser may fetch
 * without credentials. ⚠️ pdf.js fetches a plain URL with a bare `fetch()`,
 * outside Angular's HttpClient, so an image behind a Bearer token has to be
 * resolved to a data URL by the implementation -- the same trap this viewer
 * already documents for the PDF itself.
 */
export interface CmsPdfImagePicker {
    /** Resolves to the image to stamp, or null when the user cancels. */
    pickImage(): Promise<string | null>;
}

export const CMS_PDF_IMAGE_PICKER = new InjectionToken<CmsPdfImagePicker>(
    'CMS_PDF_IMAGE_PICKER',
);
