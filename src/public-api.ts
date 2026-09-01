/**
 * Public surface of the @coolms/pdf package. The PDF viewer ships
 * here (federated home for the Pdf module's frontend); consumers
 * dispatch into it through `<cms-viewer-host [mimeType]="..." />`
 * rather than importing the component directly.
 */
export { PdfViewerComponent } from './pdf-viewer.component';
export type { PdfProfileConfig } from './pdf-viewer.component';
export { provideCoolmsPdf } from './pdf-viewers-bootstrap';
export { CMS_PDF_IMAGE_PICKER } from './pdf-image-picker';
export type { CmsPdfImagePicker } from './pdf-image-picker';
