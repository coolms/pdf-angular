import { pdfDefaultOptions } from 'ngx-extended-pdf-viewer';

import { PDF_SAFETY_OPTIONS } from './pdf-safety';
import { PdfViewerComponent } from './pdf-viewer.component';

/**
 * The viewer pins what a PDF may do as soon as it is loaded: importing the component is enough, so no
 * route that renders a PDF can do so with the library's defaults (which turn XFA on).
 */
describe('the PDF viewer pins scripting and XFA off', () => {
    it('applies the pin when the component is loaded, not when someone remembers to call it', () => {
        expect(PdfViewerComponent).toBeDefined();
        const options = pdfDefaultOptions as unknown as Record<string, unknown>;
        expect(options['enableScripting']).toBe(false);
        expect(options['enableOpenActionJavaScript']).toBe(false);
        expect(options['enableCatalogAAJavaScript']).toBe(false);
        expect(options['enableXfa']).withContext('the library defaults it to true').toBe(false);
    });

    it('names every option it pins as off', () => {
        expect(Object.values(PDF_SAFETY_OPTIONS).every((value) => value === false)).toBe(true);
        expect(Object.keys(PDF_SAFETY_OPTIONS).sort()).toEqual(
            ['enableCatalogAAJavaScript', 'enableOpenActionJavaScript', 'enableScripting', 'enableXfa'],
        );
    });
});
