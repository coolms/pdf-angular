import { HttpClient } from '@angular/common/http';
import { CmsLoaderComponent } from '@coolms/core-angular';
import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    ElementRef,
    ViewEncapsulation,
    computed,
    effect,
    inject,
    input,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgxExtendedPdfViewerModule } from 'ngx-extended-pdf-viewer';

/**
 * F.7 PDF viewer. Replaces the bare-pdfjs canvas-rendering implementation
 * with `ngx-extended-pdf-viewer`: discrete page rendering, sidebar with
 * thumbnails / outline, full toolbar (paging, zoom, find, print,
 * download, rotate). Profile config — sourced from the backend viewer
 * manifest — drives which controls the toolbar shows.
 *
 * Auth pre-fetch: `HttpClient.get(url, {responseType: 'arraybuffer'})`
 * runs through `authInterceptor` so the Bearer token attaches and a
 * 401 triggers refresh-on-the-fly. The library does NOT fetch the URL
 * itself (its raw fetch would skip the interceptor and present the
 * user with a broken viewer when the access token is stale).
 */
export interface PdfProfileConfig {
    readonly toolbar?: {
        readonly show?: boolean;
        readonly buttons?: ReadonlyArray<string>;
    };
    readonly sidebar?: {
        readonly show?: boolean;
        readonly defaultOpen?: boolean;
        readonly tabs?: ReadonlyArray<string>;
    };
    readonly textLayer?: boolean;
}

@Component({
    selector: 'cms-pdf-viewer',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CmsLoaderComponent, NgxExtendedPdfViewerModule],
    template: `
        @if (pdfBytes(); as bytes) {
            <ngx-extended-pdf-viewer
                [src]="bytes"
                [textLayer]="cfg().textLayer ?? true"
                [showToolbar]="cfg().toolbar?.show ?? true"
                [showSidebarButton]="cfg().sidebar?.show ?? true"
                [sidebarVisible]="cfg().sidebar?.defaultOpen ?? false"
                [showFindButton]="hasButton('find')"
                [showPagingButtons]="hasButton('paging')"
                [showZoomButtons]="hasButton('zoom')"
                [showPrintButton]="hasButton('print')"
                [showDownloadButton]="hasButton('download')"
                [showRotateButton]="hasButton('rotate')"
                [showPresentationModeButton]="false"
                [showOpenFileButton]="false"
                [showHandToolButton]="false"
                [showSpreadButton]="false"
                [showPropertiesButton]="false"
                height="100%"
            />
        } @else if (loading()) {
            <div class="cms-pdf-viewer__status" role="status">
                <cms-loader [inline]="true" />
                <span>Loading PDF…</span>
            </div>
        } @else if (error()) {
            <div class="cms-pdf-viewer__error" role="alert">
                <strong>Failed to load PDF</strong>
                <p>{{ error() }}</p>
            </div>
        }
    `,
    encapsulation: ViewEncapsulation.None,
    styles: [`
        cms-pdf-viewer {
            display: block;
            width: 100%;
            height: 100%;
            min-height: 320px;
        }
        .cms-pdf-viewer__status,
        .cms-pdf-viewer__error {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
            padding: var(--cms-content-padding);
            color: var(--cms-text-muted);
        }
        .cms-pdf-viewer__error {
            color: var(--cms-danger, #b91c1c);
        }
        /*
         * Viewer polish: hide empty <option> entries in the pdfjs zoom
         * dropdown. ngx-extended-pdf-viewer's i18n template
         * (pdfjs-page-scale-percent) wraps the numeral in U+2068/U+2069
         * bidi-isolate marks; before i18n resolves, the text content is
         * empty for a brief tick. The :empty rule hides any option
         * caught in that loading state. Encapsulation is None on this
         * component because the pdfjs toolbar is library-injected DOM
         * and doesn't carry our Angular content-scope attribute.
         */
        cms-pdf-viewer select#scaleSelect option:empty {
            display: none;
        }
    `],
})
export class PdfViewerComponent {
    readonly url = input.required<string>();
    readonly profile = input<PdfProfileConfig>({});

    protected readonly pdfBytes = signal<Uint8Array | null>(null);
    protected readonly loading = signal(true);
    protected readonly error = signal<string | null>(null);

    protected readonly cfg = computed<PdfProfileConfig>(() => this.profile());

    private readonly http = inject(HttpClient);
    private readonly destroyRef = inject(DestroyRef);

    constructor() {
        effect(() => {
            const url = this.url();
            if ('' === url) {
                return;
            }
            this.loadPdf(url);
        });
    }

    protected hasButton(key: string): boolean {
        return this.cfg().toolbar?.buttons?.includes(key) ?? false;
    }

    private loadPdf(url: string): void {
        this.loading.set(true);
        this.error.set(null);
        this.pdfBytes.set(null);

        this.http
            .get(url, { responseType: 'arraybuffer' })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (buffer) => {
                    this.pdfBytes.set(new Uint8Array(buffer));
                    this.loading.set(false);
                },
                error: (err: unknown) => {
                    const message = err instanceof Error ? err.message : 'Unknown error';
                    this.error.set('Failed to load PDF: ' + message);
                    this.loading.set(false);
                },
            });
    }
}
