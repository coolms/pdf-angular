import { HttpClient } from '@angular/common/http';
import { CmsLoaderComponent } from '@coolms/core-angular';
import { CMS_PDF_IMAGE_PICKER } from './pdf-image-picker';
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
import { NgxExtendedPdfViewerModule, NgxExtendedPdfViewerService } from 'ngx-extended-pdf-viewer';
import { pinPdfSafetyOptions } from './pdf-safety';

// Before any viewer exists: what a PDF may do is decided at load, never left to the library's defaults.
pinPdfSafetyOptions();

/**
 * The PDF viewer. Replaces the bare-pdfjs canvas-rendering implementation
 * with `ngx-extended-pdf-viewer`: discrete page rendering, sidebar with
 * thumbnails / outline, full toolbar (paging, zoom, find, print,
 * download, rotate). Profile config -- sourced from the backend viewer
 * manifest -- drives which controls the toolbar shows.
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
            color: var(--cms-danger, #dc2626);
        }
        /*
         * -- The viewer wears the admin's theme ------------------
         *
         *  MEASURED in the running admin, and the numbers are why this is
         * written as explicit colours rather than as a variable map:
         *
         *   - #toolbarContainer is a hard-coded rgb(249,249,250). It
         *     follows nothing of ours, so in dark mode it stayed a white strip.
         *   - the icons are inline <svg fill="currentColor"> drawn by the
         *     Angular wrapper, so they INHERIT color -- near-white text on
         *     that white strip. An invisible control, not a cosmetic flaw.
         *   - pdf.js 6.1 does define a light-dark() palette
         *     (--main-color, --toolbar-icon-bg-color), but setting
         *     color-scheme: dark on the viewer left the toolbar background
         *     unchanged -- measured identical before and after. Its chrome is
         *     not driven by it, so stating our own colours is what lands.
         *
         * Encapsulation is already None on this component (see the note
         * below), which is what lets these reach library-injected DOM.
         *
         * WARNING: every selector names BOTH elements, and that is not
         * verbosity. MEASURED in the running admin -- written as
         * cms-pdf-viewer #toolbarContainer the rule has specificity (0,1,1),
         * and so does the library own ngx-extended-pdf-viewer
         * #toolbarContainer, which it injects at RUNTIME from its dynamic-css
         * after this one. Equal specificity means the later sheet wins, so the
         * theme loaded and did nothing. Naming both takes it to (0,1,2) and
         * wins on specificity rather than on order -- which is what keeps it
         * working when the library changes WHEN it injects.
         */
        /*
         *  The native controls -- the zoom dropdown's POPUP list, its arrow,
         * the scrollbars -- are browser chrome. CSS paints the closed select
         * (it computes --cms-input-bg on --cms-text), but the popup takes
         * color-scheme and nothing else, which is why the dropdown still
         * opened white after every colour above was already a kit token.
         *
         * MEASURED: color-scheme flips from dark to light at exactly one
         * element -- cms-pdf-viewer is dark, ngx-extended-pdf-viewer is light,
         * and the whole subtree inherits light from there.
         *
         * The ladder, measured on that host: plain inherit and plain dark both
         * did nothing; inherit !important and dark !important both took. The
         * library's declaration is important, and an important is only beaten
         * by another.
         *
         *  It said inherit here until a user reported a WHITE dialog with a
         * DARK textarea and an unreadable title. inherit follows the BROWSER;
         * our tokens follow data-theme -- and the admin theme has ZERO
         * prefers-color-scheme rules, so it is light unless data-theme says
         * otherwise. The two agree only while the OS and the theme agree.
         *
         * Flipping data-theme does NOT reproduce the divergence: on a machine
         * where the OS matches the theme both readings coincide, which is why
         * this came from a user rather than from a sweep.
         *
         * Pinned to the admin's theme rather than asked of the browser. Same
         * intent as before, an answer that cannot diverge.
         */
        cms-pdf-viewer ngx-extended-pdf-viewer {
            color-scheme: light !important;
        }
        :root[data-theme='dark'] cms-pdf-viewer ngx-extended-pdf-viewer {
            color-scheme: dark !important;
        }

        /*
         *  The toolbar renders in THREE ROWS for about half a second on load.
         * REPRODUCED and timed, sampling every 60ms from the click that opens
         * the viewer: at t=506ms it is 79px tall with its buttons on six
         * distinct y positions; at t=983ms it snaps to 34px and one row.
         *
         *  And the obvious diagnosis was WRONG. Declaring the library's own
         * one-row flex rule here, earlier in the cascade, changed nothing --
         * the probe still read 79px and six y positions. Measuring DURING the
         * wrap window is what corrected it:
         *
         *     #toolbarViewer   display: flex, flex-wrap: nowrap, width 1057
         *     its 3 groups     widths 243 / 152 / 128, tops 96 / 119 / 120
         *
         * The toolbar is not wrapping at all -- 523px of groups in 1057px of
         * room. One GROUP is stacking inside itself: the right-hand group needs
         * 288px, was 128px wide, and its float: right children wrapped onto
         * three lines, which is what makes the row 79px tall.
         *
         * Converting that group to flex cures the stack and is NOT neutral:
         * row-reverse scrambles the order outright, and a plain flex row moves
         * the settled buttons from one y to three (99 / 100 / 104).
         *
         *  min-width: max-content was tried and did NOTHING -- the group
         * stayed 128px. That is the tell: its children are float: right, and
         * floats contribute nothing to a container's intrinsic size, so
         * max-content really is that small. min-width cannot raise what it
         * cannot see.
         *
         * So the floats have to go, for that one group. Out of float and into
         * flow is what lets the row size to its content and stop stacking.
         *
         *  This is NOT free, and the cost was measured rather than hoped:
         * every button x is identical and the heights are identical, but the
         * settled y goes from a single 99 to 99/100 -- 1px of variance on some
         * buttons, because a flex row centres each wrapper on its own height
         * where a float line-box did not. That is the trade: 1px of settled
         * variance against half a second of three-row toolbar on every open.
         */
        cms-pdf-viewer ngx-extended-pdf-viewer #toolbarViewerRight {
            display: flex;
            flex-wrap: nowrap;
            align-items: center;
            justify-content: flex-end;
        }
        cms-pdf-viewer ngx-extended-pdf-viewer #toolbarViewerRight > * {
            display: flex;
            align-items: center;
            float: none;
        }
        cms-pdf-viewer ngx-extended-pdf-viewer #toolbarContainer,
        cms-pdf-viewer ngx-extended-pdf-viewer .toolbar,
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryToolbar,
        cms-pdf-viewer ngx-extended-pdf-viewer #sidebarContainer,
        cms-pdf-viewer ngx-extended-pdf-viewer #findbar {
            background: var(--cms-surface);
            border-color: var(--cms-border);
            color: var(--cms-text);
        }

        /*
         *  STATED, never inherited. currentColor is the icon's own fill, so
         * an unstated colour is whatever the surrounding app happens to use --
         * which is exactly how a white icon ended up on a white toolbar. The
         * muted token because a toolbar icon is chrome; the hover rule brings
         * it to full strength, which is the affordance.
         */
        cms-pdf-viewer ngx-extended-pdf-viewer .toolbarButton,
        cms-pdf-viewer ngx-extended-pdf-viewer .secondaryToolbarButton,
        cms-pdf-viewer ngx-extended-pdf-viewer .toolbarLabel,
        cms-pdf-viewer ngx-extended-pdf-viewer .toolbarButton svg,
        cms-pdf-viewer ngx-extended-pdf-viewer .secondaryToolbarButton svg {
            /*
             *  MEASURED, and this is what made the bar unreadable: muted
             * (#6b7f96) on the toolbar (#1a2332) is 3.83:1 -- barely over the
             * 3:1 floor for a graphical object, and fine only while the icon
             * was a chunky filled svg. A thin line glyph needs more. Secondary
             * (#9aa8bd) measures 6.61:1 and is still chrome rather than
             * headline; full text (#e8edf4) would be 13.42:1 and shouts.
             */
            color: var(--cms-text-secondary, #525a66);
        }
        /*
         * The disabled state has to be STATED now. The library dims it through
         * .toolbarButton[disabled] svg -- and the svg is the thing we hide, so
         * without this a disabled First Page looks exactly like a live one.
         * MEASURED on page 1: primaryFirstPage and primaryPrevious both report
         * disabled = true. Muted is the RIGHT colour here; it was only wrong as
         * the resting state.
         */
        /*
         *  The blue ring around a clicked button is a BORDER, not an outline:
         *
         *     ngx-extended-pdf-viewer button:focus
         *         { outline: none; border: 1px solid blue }
         *
         * and on a content-box button (the viewer resets box-sizing with
         * !important) that adds 2px to the box. The toolbar reflows, and the
         * right-anchored menu shifts -- which is the jitter on opening the
         * three-dots menu. An outline never affects layout; a border always
         * can.
         *
         * Keyboard users keep a ring, in the theme's own colour, drawn INSIDE
         * the box so it cannot move anything.
         */
        cms-pdf-viewer ngx-extended-pdf-viewer button:focus {
            border: 0 none;
            outline: none;
        }
        cms-pdf-viewer ngx-extended-pdf-viewer button:focus-visible {
            outline: 2px solid var(--cms-focus-ring, #7c4d00);
            outline-offset: -2px;
        }
        cms-pdf-viewer ngx-extended-pdf-viewer .toolbarButton[disabled],
        cms-pdf-viewer ngx-extended-pdf-viewer .secondaryToolbarButton[disabled] {
            color: var(--cms-text-muted, #69707c);
            cursor: default;
        }
        /*
         * Disabled must not light up under the cursor. The library disagrees at
         * (0,3,1) with a #e5e5e6 wash, so this needs the extra type to match.
         */
        cms-pdf-viewer ngx-extended-pdf-viewer .toolbarButton[disabled]:hover,
        cms-pdf-viewer ngx-extended-pdf-viewer .secondaryToolbarButton[disabled]:hover {
            color: var(--cms-text-muted, #69707c);
            background-color: transparent;
        }
        cms-pdf-viewer ngx-extended-pdf-viewer .toolbarButton:hover,
        cms-pdf-viewer ngx-extended-pdf-viewer .secondaryToolbarButton:hover,
        cms-pdf-viewer ngx-extended-pdf-viewer .toolbarButton:focus-visible {
            color: var(--cms-text);
            /*  This was var(--cms-surface-2), a token the kit does not
               define, so every hover fell through to a hard-coded rgba. An
               invented token name never errors -- it just quietly paints
               something the kit never chose. --cms-hover is the real one. */
            background-color: var(--cms-hover, #f3f4f6);
        }
        /*
         * The toggled state needs its BACKGROUND, not just its colour. The
         * library paints .toolbarButton.toggled at (0,2,1) with a light-grey
         * pill (#aeaeae / #333), and setting only the colour left that pill
         * sitting on the dark strip.
         */
        /*
         * Pressed reads as a raised ground and full-strength ink, never as a
         * colour -- the admin never signals active with hue.
         *
         *  The ground must be THEME-AWARE, and --cms-sidebar-active is not:
         * MEASURED at #2d3f57 in BOTH themes, because the admin's sidebar is
         * always dark navy and its tokens never flip. Against --cms-text, which
         * IS theme-aware, that put #111827 on dark navy in light mode -- an
         * invisible icon. A wash of the accent composites over whatever surface
         * is behind it, so it is correct in both themes by construction.
         */
        cms-pdf-viewer ngx-extended-pdf-viewer .toolbarButton.toggled,
        cms-pdf-viewer ngx-extended-pdf-viewer .toolbarButton.selected,
        cms-pdf-viewer ngx-extended-pdf-viewer .toolbarButton[aria-selected='true'] {
            color: var(--cms-selected-text);
            background-color: var(--cms-selected-light);
            border-color: var(--cms-selected);
        }
        /*
         *  THREE classes, because the library uses three:
         *
         *     .toolbarButton.toggled:hover { background-color: #d1d1d2 }   (0,3,1)
         *
         * Our .toolbarButton:hover is (0,2,2) -- one class short -- so hovering
         * an ACTIVE toolbar button (Find while the findbar is open, the sidebar
         * toggle, a zoom mode) painted it light grey under --cms-text and the
         * icon vanished.
         *
         *  This is the SAME rule already fixed for the secondary menu, where
         * the library's version is (0,4,1). Fixing one and assuming the other
         * is how the defect came back.
         *
         * So the whole family is covered here rather than the one selector that
         * was reported. Sweeping every library rule that styles a toolbar
         * button in a state found SIX, not one: .toggled, .selected and
         * [aria-selected=true] are the same visual state with identical values,
         * each with its own :hover, plus [disabled]:hover. A rule that names
         * only .toggled leaves two other spellings of "active" painting light
         * grey under our text.
         */
        cms-pdf-viewer ngx-extended-pdf-viewer .toolbarButton.toggled:hover,
        cms-pdf-viewer ngx-extended-pdf-viewer .toolbarButton.selected:hover,
        cms-pdf-viewer ngx-extended-pdf-viewer .toolbarButton[aria-selected='true']:hover {
            color: var(--cms-selected-text);
            background-color: var(--cms-selected-light);
        }

        /*
         *  The secondary menu needs TWO classes, not one.
         *
         * MEASURED on a clean load: every caption and glyph in the menu
         * computed rgb(0, 0, 0) against our #1a2332 background -- **1.33:1**,
         * invisible, and it had been that way since the theme landed. The rule
         * above never applied to it. Proven by injection rather than reasoning:
         * an injected rule at our own specificity changed nothing, and one with
         * a second class took effect immediately. The library ships
         *
         *     .secondaryToolbar .secondaryToolbarButton           (0,2,1)
         *     .secondaryToolbar .secondaryToolbarButton[disabled] (0,3,1)
         *
         * and ours, cms-pdf-viewer ngx-extended-pdf-viewer
         * .secondaryToolbarButton, is (0,1,2): naming BOTH elements buys type
         * count, and type count never beats a class. Match their shape and add
         * our own prefix on top.
         *
         *  The value it was losing to is #000 because the library mounts its
         * LIGHT theme -- its theme() input is never set, so <pdf-light-theme> is
         * in the DOM under both of our themes, and its blob is what we override.
         *
         * [disabled] comes LAST on purpose: it ties with :hover at (0,3,2), and
         * a hovered disabled button should still read disabled.
         */
        cms-pdf-viewer ngx-extended-pdf-viewer .secondaryToolbar .secondaryToolbarButton {
            color: var(--cms-text-secondary, #525a66);
        }
        /*
         * The active row, on the admin's OWN convention rather than an
         * invented one. Its sidebar reads
         *
         *     &.active { background: var(--cms-sidebar-active); color: white;
         *                box-shadow: inset 3px 0 0 var(--cms-accent); }
         *
         * -- a raised ground, full-strength ink and a 3px inset accent bar.
         * Never a coloured label.  And MEASURED, --cms-accent is #F5A623,
         * AMBER: the kit's accent was never blue. --cms-primary is a different
         * token doing a different job, and reaching for it is what made the
         * active item read as arbitrary.
         */
        cms-pdf-viewer ngx-extended-pdf-viewer .secondaryToolbar .secondaryToolbarButton.toggled {
            color: var(--cms-text);
            background-color: var(--cms-surface-alt);
            background-color: color-mix(in srgb, var(--cms-accent) 14%, transparent);
            box-shadow: inset 3px 0 0 var(--cms-accent, #f5a623);
        }
        cms-pdf-viewer ngx-extended-pdf-viewer .secondaryToolbar .secondaryToolbarButton:hover {
            color: var(--cms-text);
            background-color: var(--cms-hover);
        }
        /*
         *  FOUR classes, because the library uses four:
         *
         *     .secondaryToolbar .secondaryToolbarButton.toggled:hover
         *         { background-color: rgb(214, 214, 214) }      (0,4,1)
         *
         * a light grey. Our hover rule above is (0,3,2) -- one class short --
         * so hovering the ACTIVE row painted #d6d6d6 under #e8edf4 text and
         * the label vanished. The active row keeps its own ground on hover.
         */
        cms-pdf-viewer ngx-extended-pdf-viewer .secondaryToolbar .secondaryToolbarButton.toggled:hover {
            color: var(--cms-text);
            background-color: var(--cms-surface-alt);
            /* A touch stronger than the resting wash, so hovering the active
               row is visible without losing the label. */
            background-color: color-mix(in srgb, var(--cms-accent) 22%, transparent);
        }
        cms-pdf-viewer ngx-extended-pdf-viewer .secondaryToolbar .secondaryToolbarButton[disabled] {
            color: var(--cms-text-muted, #69707c);
            cursor: default;
        }

        /*
         * The page fields, the labels and the zoom select sit in the same
         * strip and were the last light boxes in it.
         *
         *  .html is part of the selector on purpose. The library paints
         * these from its light-theme blob at
         *
         *     .html .toolbarField  (0,2,1)  background #fff, colour #000
         *     .html .toolbarLabel  (0,2,1)  colour #000
         *
         * and a rule written as .toolbarField is (0,1,2), which loses on the
         * class count -- the page box stayed white with black text and "of 3"
         * stayed black on the dark strip. Matching their shape takes ours to
         * (0,2,2).
         */
        cms-pdf-viewer ngx-extended-pdf-viewer .html .toolbarField,
        cms-pdf-viewer ngx-extended-pdf-viewer #scaleSelect,
        cms-pdf-viewer ngx-extended-pdf-viewer #pageNumber {
            background: var(--cms-input-bg, var(--cms-surface));
            color: var(--cms-text);
            border-color: var(--cms-border);
        }
        cms-pdf-viewer ngx-extended-pdf-viewer .html .toolbarLabel {
            color: var(--cms-text-secondary, #525a66);
        }
        /* The dropdown wrapper is a light-grey box of its own (#aeaeaf), and
           its option list is painted separately from the closed select. */
        cms-pdf-viewer ngx-extended-pdf-viewer .dropdownToolbarButton {
            background-color: var(--cms-input-bg, var(--cms-surface));
            border-color: var(--cms-border);
        }
        /*
         *  !important, and only because the library got there first:
         *
         *     ngx-extended-pdf-viewer select { background-color: #fff !important }
         *
         * an !important on a bare type selector. Nothing normal moves it --
         * appearance:none and color-scheme:dark both applied and the white
         * stayed, which is what identified it as !important rather than as one
         * more specificity loss. An important declaration can only be beaten
         * by another, so this is the one place in the file that needs one.
         */
        cms-pdf-viewer ngx-extended-pdf-viewer .dropdownToolbarButton > select,
        cms-pdf-viewer ngx-extended-pdf-viewer #scaleSelect {
            background-color: var(--cms-input-bg, var(--cms-surface)) !important;
            color: var(--cms-text);
        }
        cms-pdf-viewer ngx-extended-pdf-viewer .dropdownToolbarButton > select > option,
        cms-pdf-viewer ngx-extended-pdf-viewer #scaleSelect option {
            background: var(--cms-surface);
            color: var(--cms-text);
        }
        /* Separators were rgba(0, 0, 0, .4) -- a black hairline on a dark
           strip, i.e. no line at all. */
        cms-pdf-viewer ngx-extended-pdf-viewer .splitToolbarButtonSeparator,
        cms-pdf-viewer ngx-extended-pdf-viewer .verticalToolbarSeparator {
            background-color: var(--cms-border);
            border-color: var(--cms-border);
        }
        /* The doorhanger's own outline, #9f9fa1 out of the box. */
        cms-pdf-viewer ngx-extended-pdf-viewer .doorHanger,
        cms-pdf-viewer ngx-extended-pdf-viewer .doorHangerRight {
            border-color: var(--cms-border);
        }

        /*
         * The desk exists so the paper has an EDGE: a white page on a white
         * ground has none. It follows the theme -- --cms-desk is #0b111a dark
         * and #e4e6ea light, and this rule is its only consumer, so changing
         * one of those values changes the desk and nothing else.
         *
         *  An earlier comment here claimed the desk stayed dark in BOTH
         * themes "deliberately". It never did: the token has been per-theme
         * since it was introduced. Corrected rather than implemented, because
         * a light-grey desk under a white page still gives the edge and is what
         * pdf.js itself does in its light theme -- nobody asked for a change.
         *
         * MEASURED: BOTH elements need the rule. #viewerContainer scrolls and
         * #viewer.pdfViewer sits inside it covering it entirely, so theming
         * only the container leaves its own light grey on top -- and reading
         * the container back says the rule worked, because the container
         * underneath really had changed.
         */
        cms-pdf-viewer ngx-extended-pdf-viewer #viewerContainer,
        cms-pdf-viewer ngx-extended-pdf-viewer #viewer.pdfViewer {
            background: var(--cms-desk, #e4e6ea);
        }


        /*
         * -- Our icons ------------------------------------------
         *
         * The toolbar is the library's own components, each wrapping a
         * pdf-shy-button that renders an inline SVG. None of them exposes an
         * icon input -- pdf-zoom-in and pdf-find-button take showZoomButtons
         * and disable, and nothing else. pdf-shy-button DOES take an image, so
         * a toolbar rebuilt from bare shy-buttons could carry ours; but then
         * every button's BEHAVIOUR has to be re-supplied through action /
         * eventBusName, which the typings do not document. A wrong value there
         * is a button that renders and does nothing, silently.
         *
         * So the glyph is swapped and the button is left alone: the library's
         * svg is hidden and a Bootstrap Icon is drawn in its place. Every
         * handler stays where it was, and the colour follows the theme for
         * free, because a glyph is TEXT and text takes the colour property.
         *
         * WARNING: each id is listed ONCE, with its own hide rule. A blanket
         * hide-every-svg rule would empty every button whose
         * id is not in this list -- a wrong guess would show nothing at all
         * rather than the library's icon, which is the worse failure.
         *
         * The ids come from the running viewer, the codepoints from
         * bootstrap-icons.css. Neither is typed from memory: a guessed id is an
         * empty button and a guessed codepoint is a box.
         */
        cms-pdf-viewer ngx-extended-pdf-viewer .toolbarButton::before,
        cms-pdf-viewer ngx-extended-pdf-viewer .secondaryToolbarButton::before {
            font-family: 'bootstrap-icons';
            font-style: normal;
            font-weight: normal;
            /*
             * 18px, and not 1rem: the size of a toolbar icon has no business
             * moving when the app root font-size does. MEASURED against what
             * it replaces -- the library svg draws 14px of ink inside its 24px
             * box, and 16px of a LINE icon only matched that, which is parity
             * rather than legibility. The button is 24px wide, so 18px still
             * leaves the widest glyph in the set a gutter.
             */
            font-size: 18px;
            line-height: 1;
            display: inline-block;
            /* The button is a 24px inline-flex; filling it and centring the
               text puts every glyph on the same axis whatever its advance. */
            width: 100%;
            text-align: center;
            /*
             * WARNING: pdf.js ships a legacy SPRITE rule that this
             * pseudo-element inherits the moment it is given a content --
             *
             *     @media (min-resolution: 1.1dppx) {
             *         .toolbarButton:before { transform: scale(.5); top: -5px }
             *     }
             *
             * -- left over from when the icon was a 2x background sprite. It
             * matches ANY ::before on a toolbar button, ours included, so on
             * every HiDPI screen the glyph was painted at HALF size and offset.
             * MEASURED in the running admin at devicePixelRatio 1.25: all nine
             * reported transform matrix(0.5, 0, 0, 0.5, 0, 0) -- 8px of glyph
             * where the svg had drawn 14px of ink.
             *
             * A glyph is not a sprite. Neutralise the sprite geometry outright,
             * inset included, so a future position:relative on the button
             * cannot bring the -5px / -1px offsets back to life.
             */
            transform: none;
            position: static;
            inset: auto;
            /* Neutralise any mask pdf.js draws on this same pseudo-element --
               a mask plus a glyph paints both. */
            mask-image: none;
            -webkit-mask-image: none;
            background-color: transparent;
        }
        /* layout-sidebar */
        cms-pdf-viewer ngx-extended-pdf-viewer #viewsManagerToggleButton > svg { display: none; }
        cms-pdf-viewer ngx-extended-pdf-viewer #viewsManagerToggleButton::before { content: '\\f45f'; }
        /* search */
        cms-pdf-viewer ngx-extended-pdf-viewer #primaryViewFind > svg { display: none; }
        cms-pdf-viewer ngx-extended-pdf-viewer #primaryViewFind::before { content: '\\f52a'; }
        /* chevron-double-up */
        cms-pdf-viewer ngx-extended-pdf-viewer #primaryFirstPage > svg { display: none; }
        cms-pdf-viewer ngx-extended-pdf-viewer #primaryFirstPage::before { content: '\\f281'; }
        /* chevron-up */
        cms-pdf-viewer ngx-extended-pdf-viewer #primaryPrevious > svg { display: none; }
        cms-pdf-viewer ngx-extended-pdf-viewer #primaryPrevious::before { content: '\\f286'; }
        /* chevron-down */
        cms-pdf-viewer ngx-extended-pdf-viewer #primaryNext > svg { display: none; }
        cms-pdf-viewer ngx-extended-pdf-viewer #primaryNext::before { content: '\\f282'; }
        /* chevron-double-down */
        cms-pdf-viewer ngx-extended-pdf-viewer #primaryLastPage > svg { display: none; }
        cms-pdf-viewer ngx-extended-pdf-viewer #primaryLastPage::before { content: '\\f27e'; }
        /* zoom-out */
        cms-pdf-viewer ngx-extended-pdf-viewer #primaryZoomOut > svg { display: none; }
        cms-pdf-viewer ngx-extended-pdf-viewer #primaryZoomOut::before { content: '\\f62d'; }
        /* zoom-in */
        cms-pdf-viewer ngx-extended-pdf-viewer #primaryZoomIn > svg { display: none; }
        cms-pdf-viewer ngx-extended-pdf-viewer #primaryZoomIn::before { content: '\\f62c'; }
        /* three-dots-vertical */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryToolbarToggle > svg { display: none; }
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryToolbarToggle::before { content: '\\f5d3'; }
        /*
         * -- Spacing --------------------------------------------
         *
         * WARNING: the toolbar borrows the SPRITE'S transparent gutter back
         * with negative margins --
         *
         *     .toolbarButton   { margin-left: -1px !important }
         *     #primaryZoomIn, #primaryZoomOut
         *                      { margin-left: -2px !important;
         *                        margin-right: -2px !important }
         *     .margin-left-correct  { margin-left: -3px }   (paging hosts)
         *     .margin-right-correct { margin-right: -3px }
         *
         * -- all of it calibrated to an icon that drew 14px of ink inside a
         * 24px box, where 5px per side really was dead space worth reclaiming.
         * A glyph has no dead space, so those pixels land on the INK. MEASURED,
         * four colliding pairs: firstPage/previous and next/lastPage overlapped
         * by 5px, the zoom pair by 4px, and #scaleSelect started 2px INSIDE
         * #primaryZoomIn -- the zoom control the report singled out.
         *
         * Take the borrowed pixels back. !important throughout, because that is
         * what the declarations being overridden carry, and the paging
         * correctors are component-scoped, which out-specifies us on its own.
         */
        cms-pdf-viewer ngx-extended-pdf-viewer .toolbarButton {
            margin-left: 0 !important;
        }
        cms-pdf-viewer ngx-extended-pdf-viewer #primaryZoomIn,
        cms-pdf-viewer ngx-extended-pdf-viewer #primaryZoomOut {
            margin-left: 0 !important;
            margin-right: 4px !important;
        }
        /*
         *  The class is REPEATED on purpose. The corrector is an
         * Angular component style, so what actually ships is
         * .margin-left-correct[_ngcontent-xyz] -- specificity (0,2,0). Naming
         * the class once gives us (0,1,2), which loses on the class count
         * however many !importants are involved. Repeating it reaches (0,2,2).
         */
        cms-pdf-viewer ngx-extended-pdf-viewer .margin-left-correct.margin-left-correct {
            margin-left: 0 !important;
        }
        cms-pdf-viewer ngx-extended-pdf-viewer .margin-right-correct.margin-right-correct {
            margin-right: 0 !important;
        }
        /* The select used to start inside the zoom-in button. */
        cms-pdf-viewer ngx-extended-pdf-viewer #scaleSelectContainer {
            margin-left: 6px;
        }

        /*
         * The rest of what the toolbar actually shows. MEASURED: 17
         * buttons are visible with this profile, and #2406 reached 9 of them --
         * the other 8 kept the library svg, at full size, beside ours at half.
         *
         * documentProperties is GONE from this list rather than added to it:
         * the component passes showPropertiesButton=false, so that button is
         * class="invisible toolbarButton" with display:none. Its rule painted
         * nothing and claimed a tenth tool. Document properties is reachable
         * from the secondary menu, which still wears the library's own icons.
         *
         * WARNING: the four editor buttons are matched by their l10n id, not
         * their title -- the library titles FreeText "Draw", Ink "Draw" and
         * Stamp "Text", so two of the three titles are simply wrong.
         * pdfjs-editor-free-text-button adds TEXT, pdfjs-editor-stamp-button
         * adds an IMAGE, pdfjs-editor-ink-button draws.
         */
        /* arrow-clockwise */
        cms-pdf-viewer ngx-extended-pdf-viewer #primaryPageRotateCw > svg { display: none; }
        cms-pdf-viewer ngx-extended-pdf-viewer #primaryPageRotateCw::before { content: '\\f116'; }
        /* arrow-counterclockwise */
        cms-pdf-viewer ngx-extended-pdf-viewer #primaryPageRotateCcw > svg { display: none; }
        cms-pdf-viewer ngx-extended-pdf-viewer #primaryPageRotateCcw::before { content: '\\f117'; }
        /* printer */
        cms-pdf-viewer ngx-extended-pdf-viewer #printButton > svg { display: none; }
        cms-pdf-viewer ngx-extended-pdf-viewer #printButton::before { content: '\\f501'; }
        /* download */
        cms-pdf-viewer ngx-extended-pdf-viewer #downloadButton > svg { display: none; }
        cms-pdf-viewer ngx-extended-pdf-viewer #downloadButton::before { content: '\\f30a'; }
        /* highlighter */
        cms-pdf-viewer ngx-extended-pdf-viewer #primaryEditorHighlight > svg { display: none; }
        cms-pdf-viewer ngx-extended-pdf-viewer #primaryEditorHighlight::before { content: '\\f7f8'; }
        /* type */
        cms-pdf-viewer ngx-extended-pdf-viewer #primaryEditorFreeText > svg { display: none; }
        cms-pdf-viewer ngx-extended-pdf-viewer #primaryEditorFreeText::before { content: '\\f5f7'; }
        /* image */
        cms-pdf-viewer ngx-extended-pdf-viewer #primaryEditorStamp > svg { display: none; }
        cms-pdf-viewer ngx-extended-pdf-viewer #primaryEditorStamp::before { content: '\\f42a'; }
        /* pencil */
        cms-pdf-viewer ngx-extended-pdf-viewer #primaryEditorInk > svg { display: none; }
        cms-pdf-viewer ngx-extended-pdf-viewer #primaryEditorInk::before { content: '\\f4cb'; }
        /*
         * -- Menu rows: padding, alignment, and one item per row -----------
         *
         *  The caption carries position: relative; top: -3px from the
         * library -- a nudge tuned for its own 27px sprite. Against a 24px
         * icon column in a centred flex row it drags the label 3px ABOVE the
         * icon, and align-items cannot fix it because the offset is applied
         * after alignment. MEASURED at exactly -3 on every visible row.
         *
         * The stock padding is 3px 0 1px 4px: 3 top against 1 bottom, 4 left
         * against 0 right. Nothing about it is even.
         *
         *  And the container is display: block with inline-flex buttons.
         * While their width is still indeterminate -- which is exactly what the
         * loading phase is -- they size to content and several fit per line.
         * That is the menu rendering in three rows until the document loads,
         * and it is also the "jitters left a bit" reported earlier: the popup
         * is anchored on its RIGHT edge, so a content-driven width settling
         * moves the LEFT edge. A flex COLUMN cannot put two items side by side
         * whatever their widths are, so the transient layout stops being
         * possible rather than becoming unlikely.
         */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryToolbarButtonContainer {
            display: flex;
            flex-direction: column;
        }
        /*
         *  width: 100% would OVERFLOW here, and box-sizing cannot save it:
         *
         *     ngx-extended-pdf-viewer div.zoom * { box-sizing: content-box !important }
         *
         * a universal important reset inside the viewer. A border-box
         * declaration of ours is simply inert against it -- computed stays
         * content-box -- so 100% means 250px of CONTENT plus 10px of padding a
         * side: a 264px row in a 250px container, and a horizontal scrollbar.
         *
         * So do not fight the reset. In a COLUMN flex container the cross axis
         * is horizontal, and align-self: stretch sizes the row to the container
         * INCLUDING its padding whatever box-sizing says. min-width: 0 lets it
         * shrink under its own content, and the caption truncates rather than
         * pushing.
         */
        cms-pdf-viewer ngx-extended-pdf-viewer .secondaryToolbar .secondaryToolbarButton {
            display: flex;
            align-items: center;
            align-self: stretch;
            width: auto;
            min-width: 0;
            gap: 8px;
            padding: 5px 10px;
            margin: 0 0 2px;
        }
        cms-pdf-viewer ngx-extended-pdf-viewer .secondaryToolbar .secondaryToolbarButton > .icon {
            flex: 0 0 24px;
            padding: 0;
            /* The row has no left padding any more, so the icon carries its own
               inset. This is what moves the icon in without dragging the accent
               bar -- which is an inset shadow on the ROW -- along with it. */
            margin-left: 12px;
        }
        /*
         * The accent bar sits on the menu's border, not 6.8px inside it. That
         * gap was TWO insets, measured separately:
         *
         *   - the popup's own padding: 0 6px;
         *   - and padding-left: 4px on the row, from
         *
         *       html[dir="ltr"] ngx-extended-pdf-viewer .secondaryToolbarButton
         *
         *     which is (0,2,2), the SAME specificity as our row rule and later
         *     in the cascade, so its longhand beat our shorthand.  Checked by
         *     reading the computed padding back, not assumed -- a declaration
         *     that quietly loses is what put a scrollbar on this menu one slice
         *     ago. Prefixing html[dir=...] the way the library does takes ours
         *     to (0,3,4).
         */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryToolbar {
            padding-left: 0;
        }
        html[dir='ltr'] cms-pdf-viewer ngx-extended-pdf-viewer .secondaryToolbar .secondaryToolbarButton,
        html[dir='rtl'] cms-pdf-viewer ngx-extended-pdf-viewer .secondaryToolbar .secondaryToolbarButton {
            padding-left: 0;
        }
        cms-pdf-viewer ngx-extended-pdf-viewer .secondaryToolbar .secondaryToolbarButton > .toolbar-caption {
            padding: 0;
            top: 0;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        /*
         * -- The secondary menu ---------------------------------
         *
         *  A DIFFERENT DOM from the primary bar, which is why the rules
         * above do not reach it:
         *
         *     <button id=...>
         *       <span class="icon" [innerHTML]="button.image"></span>
         *       <span class="toolbar-caption">...</span>
         *     </button>
         *
         * The svg sits INSIDE span.icon, so "#id > svg" matches nothing here.
         * Hide the svg within the span and draw the glyph on the SPAN's
         * ::before: the 28px icon column keeps its box, so every caption stays
         * on one axis whatever the glyph does.
         *
         * The ids are the primary ones re-prefixed by PdfShyButtonService --
         * primaryZoomIn -> secondaryZoomIn.  Except the next-page entry,
         * which is literally #primaryNextPage while every sibling is
         * secondary*. Read off the running viewer, not derived from the rule.
         *
         * MEASURED: 35 entries exist, and only 7 are visible at this width --
         * the rest are shy buttons still fitting on the primary bar, or
         * switched off by the profile. All 35 are mapped, because the menu is
         * exactly where a button goes when the window gets narrower.
         */
        cms-pdf-viewer ngx-extended-pdf-viewer .secondaryToolbarButton .icon > svg {
            display: none;
        }
        cms-pdf-viewer ngx-extended-pdf-viewer .secondaryToolbarButton .icon::before {
            font-family: 'bootstrap-icons';
            font-style: normal;
            font-weight: normal;
            font-size: 18px;
            /* The span measures 28x24. A matching line box centres the glyph
               without inheriting the button's 13px caption line-height. */
            line-height: 24px;
            display: block;
            text-align: center;
            /* The sprite rule targets .secondaryToolbarButton:before rather
               than this element, but it cost a whole slice once already. */
            transform: none;
            position: static;
            inset: auto;
        }
        /* arrows-fullscreen */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryPresentationMode .icon::before { content: '\\f14d'; }
        /* folder2-open */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryOpenFile .icon::before { content: '\\f3d8'; }
        /* printer */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryPrintButton .icon::before { content: '\\f501'; }
        /* download */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryDownload .icon::before { content: '\\f30a'; }
        /* arrow-up */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryMoveUpButton .icon::before { content: '\\f148'; }
        /* arrow-down */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryMoveDownButton .icon::before { content: '\\f128'; }
        /* chevron-double-up */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryFirstPage .icon::before { content: '\\f281'; }
        /* chevron-up */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryPreviousPage .icon::before { content: '\\f286'; }
        /* chevron-down */
        cms-pdf-viewer ngx-extended-pdf-viewer #primaryNextPage .icon::before { content: '\\f282'; }
        /* chevron-double-down */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryLastPage .icon::before { content: '\\f27e'; }
        /* arrow-clockwise */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryPageRotateCw .icon::before { content: '\\f116'; }
        /* arrow-counterclockwise */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryPageRotateCcw .icon::before { content: '\\f117'; }
        /* cursor-text */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryCursorSelectTool .icon::before { content: '\\f2e2'; }
        /* hand-index */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryCursorHandTool .icon::before { content: '\\f403'; }
        /* book-half */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryCursorPageFlipTool .icon::before { content: '\\f193'; }
        /* search */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryViewFind .icon::before { content: '\\f52a'; }
        /* zoom-out */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryZoomOut .icon::before { content: '\\f62d'; }
        /* zoom-in */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryZoomIn .icon::before { content: '\\f62c'; }
        /* square */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondarySpreadNone .icon::before { content: '\\f584'; }
        /* layout-split */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondarySpreadOdd .icon::before { content: '\\f460'; }
        /* columns-gap */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondarySpreadEven .icon::before { content: '\\f2cd'; }
        /* file-earmark */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryScrollPage .icon::before { content: '\\f392'; }
        /* arrow-down-up */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryScrollVertical .icon::before { content: '\\f127'; }
        /* arrow-left-right */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryScrollHorizontal .icon::before { content: '\\f12b'; }
        /* grid */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryScrollWrapped .icon::before { content: '\\f3fc'; }
        /* infinity */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryInfiniteScroll .icon::before { content: '\\f69e'; }
        /* book */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryBook-mode .icon::before { content: '\\f194'; }
        /* chat-square-text */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryEditorCommentButton .icon::before { content: '\\f264'; }
        /* pen */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryEditorSignatureButton .icon::before { content: '\\f4c8'; }
        /* highlighter */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryEditorHighlight .icon::before { content: '\\f7f8'; }
        /* pencil */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryEditorInk .icon::before { content: '\\f4cb'; }
        /* type */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryEditorFreeText .icon::before { content: '\\f5f7'; }
        /* image */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryEditorStamp .icon::before { content: '\\f42a'; }
        /* layout-sidebar */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryViewsManagerToggleButton .icon::before { content: '\\f45f'; }
        /* info-circle */
        cms-pdf-viewer ngx-extended-pdf-viewer #secondaryDocumentProperties .icon::before { content: '\\f431'; }

        /*
         * -- Dialog buttons wear the admin's buttons -------------------------
         *
         * Reported: Cancel / Add in the Add-comment dialog do not look like
         * ours. pdf.js resolves every dialog button through custom properties
         * on .html .dialog -- primary defaults to the library's cyan #0df and
         * secondary to #f0f0f4 -- so pointing those at the kit's button
         * tokens is the whole fix; no selector fights the library's markup.
         *
         * The mapping is the admin's own: .cms-btn-primary is an accent fill
         * with accent-fg ink, .cms-btn is surface + border + body text.
         *
         *  The primary ink is --cms-accent-fg, never --cms-text-inverse.
         * The fill is theme-invariant amber, so its foreground must be too --
         * eight rules had that backwards and were unreadable in one theme.
         */
        cms-pdf-viewer ngx-extended-pdf-viewer .html .dialog {
            --dialog-bg-color: var(--cms-surface);

            --button-primary-bg-color: var(--cms-accent);
            --button-primary-border-color: var(--cms-accent);
            --button-primary-fg-color: var(--cms-accent-fg);
            --button-primary-hover-bg-color: var(--cms-accent-hover);
            --button-primary-hover-border-color: var(--cms-accent-hover);
            --button-primary-hover-fg-color: var(--cms-accent-fg);
            --button-primary-active-bg-color: var(--cms-accent-hover);
            --button-primary-active-border-color: var(--cms-accent-hover);
            --button-primary-active-fg-color: var(--cms-accent-fg);

            --button-secondary-bg-color: var(--cms-btn-bg);
            --button-secondary-border-color: var(--cms-btn-border);
            --button-secondary-fg-color: var(--cms-btn-text);
            --button-secondary-hover-bg-color: var(--cms-btn-hover-bg);
            --button-secondary-hover-border-color: var(--cms-btn-hover-border);
            --button-secondary-hover-fg-color: var(--cms-btn-text);
            --button-secondary-active-bg-color: var(--cms-btn-hover-bg);
            --button-secondary-active-border-color: var(--cms-btn-hover-border);
            --button-secondary-active-fg-color: var(--cms-btn-text);
        }
        /*
         * The dialog's own chrome: its text, its fields and the border that
         * separates the footer, so the panel reads as one of ours rather than
         * as the library's white sheet.
         */
        cms-pdf-viewer ngx-extended-pdf-viewer .html .dialog {
            color: var(--cms-text);
            border-color: var(--cms-border);
        }
        cms-pdf-viewer ngx-extended-pdf-viewer .html .dialog textarea,
        cms-pdf-viewer ngx-extended-pdf-viewer .html .dialog input[type='text'] {
            background-color: var(--cms-input-bg, var(--cms-surface));
            color: var(--cms-text);
            border-color: var(--cms-border);
            border-radius: var(--cms-radius-sm, 4px);
        }

        /*
         * -- The Add-comment panel wears the kit's buttons -------------------
         *
         *  It IS a .dialog (dialog#commentManagerDialog.dialog), so the
         * --button-primary-* / --button-secondary-* mapping above is what
         * colours these. Its buttons sit in .dialogButtonsGroup -- NOT the
         * .commentManagerActions the library's CSS mentions, which is
         * never rendered here. A stylesheet says what COULD match; only
         * the DOM says what does. pdf.js gives it its own --comment-dialog-* family, and one
         * rule draws Cancel and Add identically at (0,1,2): no primary, no
         * kit shape. Mapping a variable set is only a fix when it is the set
         * the element actually reads.
         *
         * The buttons take .cms-btn / .cms-btn-primary wholesale rather than a
         * colour remap, because our button is more than colour: padding,
         * radius, weight, the focus ring and the disabled opacity come with
         * it.
         */
        cms-pdf-viewer ngx-extended-pdf-viewer #commentManagerDialog {
            --comment-dialog-bg: var(--cms-surface);
            --comment-dialog-text: var(--cms-text);
            --comment-dialog-border: var(--cms-border);
            --comment-dialog-header-bg: var(--cms-surface-muted);
            --comment-button-hover-bg-dialog: var(--cms-btn-hover-bg);
            /*  !important because pdf.js paints this one INLINE, from JS:
                   dialogStyle.backgroundColor = findContrastColor(
                       applyOpacity(highlightColor, opacity),
                       CSSConstants.commentForegroundColor);
               -- a surface derived to contrast with the LIBRARY's comment ink,
               which it reads once from --comment-fg-color and memoises for the
               page. We replace that ink with ours, so its answer solves for a
               colour that is no longer on the element: in dark theme it chose
               #ffffff and our #e8edf4 title landed on white. No selector beats
               an inline style, which is why raising specificity kept moving
               the geometry and never the colour.
               border-color is deliberately NOT taken: pdf.js sets it inline to
               the highlight's own hex, and that is the cue tying this window
               to the mark it belongs to. */
            background-color: var(--cms-surface) !important;
            color: var(--cms-text);
            border-color: var(--cms-border);
        }
        /* The window title and header. Never styled by us, so they were
           whatever pdf.js picked -- the element the user could not read. */
        cms-pdf-viewer ngx-extended-pdf-viewer #commentManagerTitle,
        cms-pdf-viewer ngx-extended-pdf-viewer #commentManagerHeader {
            color: var(--cms-text);
        }
        cms-pdf-viewer ngx-extended-pdf-viewer #commentManagerTextInput {
            background-color: var(--cms-input-bg, var(--cms-surface));
            color: var(--cms-text);
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius-sm, 4px);
        }
        /* .cms-btn */
        cms-pdf-viewer ngx-extended-pdf-viewer #commentManagerDialog .dialogButtonsGroup button {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 5px 12px;
            /* GEOMETRY ONLY, and that is enough: the colour already arrives
               through --button-secondary-* / --button-primary-*, mapped to the
               kit's tokens on .html .dialog above. Measured on Cancel in dark
               theme: #c9d3e0 on #243044, i.e. --cms-btn-text on --cms-btn-bg.
               ⚠️ An earlier note here claimed the token resolved light at this
               element. It did not -- that reading was taken while a probe still
               had data-theme forced to light, so the LIGHT palette was measured
               and read as the dark one. Clear a forced state before believing
               the next measurement. */
            border-radius: var(--cms-radius, 6px);
            font-family: inherit;
            font-size: .8125rem;
            font-weight: 500;
            line-height: 1.5;
            cursor: pointer;
            white-space: nowrap;
            /* The library pins height: 32px on dialog buttons; ours sizes to
               its own padding like every other .cms-btn. */
            height: auto;
            transition: background .1s, border-color .1s, color .1s;
        }
        /* The confirming action: the accent is theme-invariant and so is its
           ink, so this pair is right in both themes without deriving. */
        cms-pdf-viewer ngx-extended-pdf-viewer #commentManagerDialog #commentManagerSaveButton {
            background: var(--cms-accent) !important;
            border-color: var(--cms-accent) !important;
            color: var(--cms-accent-fg) !important;
        }
        cms-pdf-viewer ngx-extended-pdf-viewer #commentManagerDialog #commentManagerSaveButton:hover:not(:disabled) {
            background: var(--cms-accent-hover) !important;
            border-color: var(--cms-accent-hover) !important;
        }
        cms-pdf-viewer ngx-extended-pdf-viewer #commentManagerDialog .dialogButtonsGroup button:focus-visible {
            outline: 2px solid var(--cms-focus-ring, #7c4d00);
            outline-offset: 2px;
        }
        cms-pdf-viewer ngx-extended-pdf-viewer #commentManagerDialog .dialogButtonsGroup button:disabled {
            opacity: .45;
            cursor: not-allowed;
        }

        /*
         * -- The comment sidebar and popup are the LIBRARY's paper -----------
         *
         *  ONE OWNER PER SUBTREE. The dialog above is ours: we paint its
         * surface, its title, its field and both buttons, so taking the
         * background completed the set. These two are the opposite -- pdf.js
         * derives their surface from the highlight colour and paints every
         * text node in them itself, pinning the subtree to color-scheme:light
         * so its --comment-fg-color lands dark on that paper.
         *
         * What leaked in was OUR ink, by plain inheritance, and it landed on
         * white. MEASURED in dark theme with one comment open:
         *
         *     Comments (title)      #15141a on #ffffff   18.31   library
         *     1 (count chip)        #15141a on #e2f7ff   16.55   library
         *     close button          #0c0c0d on #ffffff   19.55   library
         *     August 29, 2026       #e8edf4 on #ffffff    1.18   OURS
         *     the comment body      #e8edf4 on #ffffff    1.18   OURS
         *
         * The comment itself was the unreadable part. Hand the ink back to the
         * library's own variable rather than half-theming its panel: taking
         * the surface instead would mean owning the title, the chip, the close
         * glyph and every item, and a half-taken subtree is exactly how the
         * dialog got into trouble.
         */
        cms-pdf-viewer ngx-extended-pdf-viewer #editorCommentsSidebar,
        cms-pdf-viewer ngx-extended-pdf-viewer .commentPopup {
            color: var(--comment-fg-color);
        }

        /*
         * -- The alert bars wear the kit's toast ----------------------------
         *
         * Four surfaces, all pdf.js's own, none of them ours until now:
         *
         *     #editorUndoBar      .messageBar   navy   #003070  "Highlight removed"
         *     #newAltTextError    .messageBar   amber  #5a3100
         *     #addSignatureError  .messageBar   amber  #5a3100
         *     #errorWrapper       legacy        red    #ff6666
         *
         *  #errorWrapper was not merely off-style, it FAILED: #d4d4d7 text
         * on #ff6666 measures 1.75, and its detail box inverts the same pair
         * for another 1.75. Its buttons still use an outset border.
         *
         * Our toast (ui-angular ToastOutletComponent) is the house shape for
         * exactly this: a neutral --cms-surface card, --cms-radius,
         * --cms-shadow-md, and the TYPE carried by a 3px left stripe rather
         * than by flooding the whole bar. That is what these become.
         *
         * Taking the surface means taking every text node in it -- the rule
         * from the comment sidebar. Title, description, action, close and the
         * detail box are all listed below for that reason; leaving any one to
         * pdf.js would put its near-white ink on our light surface.
         */
        cms-pdf-viewer ngx-extended-pdf-viewer .messageBar,
        cms-pdf-viewer ngx-extended-pdf-viewer #errorWrapper {
            background: var(--cms-surface);
            color: var(--cms-text);
            border: 1px solid var(--cms-border);
            border-left: 3px solid var(--cms-info);
            border-radius: var(--cms-radius);
            box-shadow: var(--cms-shadow-md);
            padding: 10px 12px;
        }
        cms-pdf-viewer ngx-extended-pdf-viewer #newAltTextError,
        cms-pdf-viewer ngx-extended-pdf-viewer #addSignatureError {
            border-left-color: var(--cms-warning);
        }
        cms-pdf-viewer ngx-extended-pdf-viewer #errorWrapper {
            border-left-color: var(--cms-danger);
        }
        cms-pdf-viewer ngx-extended-pdf-viewer .messageBar .title {
            color: var(--cms-text);
            font-size: .8125rem;
            font-weight: 600;
        }
        cms-pdf-viewer ngx-extended-pdf-viewer .messageBar .description,
        cms-pdf-viewer ngx-extended-pdf-viewer #errorMessage {
            color: var(--cms-text-secondary);
            font-size: .8125rem;
        }
        /* .cms-btn -- the action in an alert is a kit button, never the
           library's tinted slab or a 1990s outset border.
           ⚠️ Undo is addressed by TWO ids, not by .messageBar .undoButton.
           MEASURED: the class form (0,3,2) left it at pdf.js's
           rgba(255,255,255,.08) while the id-anchored #errorShowMore rules
           beside it landed -- pdf.js hangs this one off #editorUndoBar, and an
           ID beats any number of classes. */
        cms-pdf-viewer ngx-extended-pdf-viewer #editorUndoBar #editorUndoBarUndoButton,
        cms-pdf-viewer ngx-extended-pdf-viewer #errorShowMore,
        cms-pdf-viewer ngx-extended-pdf-viewer #errorShowLess,
        cms-pdf-viewer ngx-extended-pdf-viewer #errorClose {
            background: var(--cms-btn-bg);
            border: 1px solid var(--cms-btn-border);
            color: var(--cms-btn-text);
            border-radius: var(--cms-radius);
            padding: 5px 12px;
            font-family: inherit;
            font-size: .8125rem;
            font-weight: 500;
            line-height: 1.5;
            cursor: pointer;
        }
        cms-pdf-viewer ngx-extended-pdf-viewer #editorUndoBar #editorUndoBarUndoButton:hover,
        cms-pdf-viewer ngx-extended-pdf-viewer #errorShowMore:hover,
        cms-pdf-viewer ngx-extended-pdf-viewer #errorShowLess:hover,
        cms-pdf-viewer ngx-extended-pdf-viewer #errorClose:hover {
            background: var(--cms-btn-hover-bg);
        }
        cms-pdf-viewer ngx-extended-pdf-viewer .messageBar .closeButton {
            color: var(--cms-text-muted);
        }
        cms-pdf-viewer ngx-extended-pdf-viewer .messageBar .closeButton:hover {
            color: var(--cms-text);
        }
        cms-pdf-viewer ngx-extended-pdf-viewer #errorMoreInfo {
            background: var(--cms-input-bg, var(--cms-surface));
            color: var(--cms-text);
            border: 1px solid var(--cms-border);
            border-radius: var(--cms-radius-sm, 4px);
        }

        /*
         * -- The editor params popups (highlight, draw, text, image, ...) -----
         *
         *  Their labels were INVISIBLE: the popup keeps the library's light
         * background (#f9f9fa) while the label colour resolves from pdf.js's
         * own light-dark() palette, which returns its DARK value (#f9f9fa)
         * because we set color-scheme: inherit. Same colour, same element --
         * a mixed palette, and a side effect of that change worth naming.
         *
         *  The background is set at (1,0,1) by an ID rule per popup, so a
         * .editorParamsToolbar rule at (0,1,2) loses. The six ids are named.
         *
         *  And --selected-outline-color / --toggle-background-color-pressed
         * do NOT reach from the toolbar: both are defined on a closer scope.
         * They have to be set on the swatch and the toggle themselves.
         */
        cms-pdf-viewer ngx-extended-pdf-viewer #editorHighlightParamsToolbar,
        cms-pdf-viewer ngx-extended-pdf-viewer #editorFreeTextParamsToolbar,
        cms-pdf-viewer ngx-extended-pdf-viewer #editorInkParamsToolbar,
        cms-pdf-viewer ngx-extended-pdf-viewer #editorStampParamsToolbar,
        cms-pdf-viewer ngx-extended-pdf-viewer #editorSignatureParamsToolbar,
        cms-pdf-viewer ngx-extended-pdf-viewer #editorCommentParamsToolbar {
            background-color: var(--cms-surface);
            color: var(--cms-text);
            border-color: var(--cms-border);
        }
        cms-pdf-viewer ngx-extended-pdf-viewer .editorParamsToolbar .editorParamsLabel {
            color: var(--cms-text);
        }
        /* The ring on the chosen colour: ours, not the library's cyan. */
        cms-pdf-viewer ngx-extended-pdf-viewer .editorParamsToolbar .swatch {
            --selected-outline-color: var(--cms-accent);
        }
        /*
         * The toggle ("Show all") wears the brand amber, like every
         * other switch in the admin -- .cms-switch sets its ON track to
         * --cms-accent, so a blue one here reads as a foreign control.
         *
         *  Every toggle colour funnels through --color-accent-primary and
         * its -hover / -active siblings. #2436 set two of the three, so
         * pressing the toggle still flashed the library's blue. Cover the
         * family, not the state that was reported.
         *
         * The knob is --cms-surface for the same reason: that is what the
         * app's own switch puts on an amber track.
         */
        cms-pdf-viewer ngx-extended-pdf-viewer .editorParamsToolbar .toggle-button {
            --color-accent-primary: var(--cms-accent);
            --color-accent-primary-hover: var(--cms-accent-hover);
            --color-accent-primary-active: var(--cms-accent-hover);
            --toggle-background-color-pressed: var(--cms-accent);
            --toggle-background-color-pressed-hover: var(--cms-accent-hover);
            --toggle-background-color-pressed-active: var(--cms-accent-hover);
            --toggle-dot-background-color-on-pressed: var(--cms-surface);
        }
        cms-pdf-viewer ngx-extended-pdf-viewer .editorParamsToolbar .toggle-button:focus-visible {
            outline: none;
            box-shadow: 0 0 0 2px var(--cms-surface, #ffffff), 0 0 0 4px var(--cms-focus-ring, #7c4d00);
        }
        /*
         * The container declares gap: 16px and is display: block, where a gap
         * does nothing -- which is why the sections sat on top of each other.
         * A column flex box makes the library's own declared gap apply.
         */
        cms-pdf-viewer ngx-extended-pdf-viewer .editorParamsToolbarContainer {
            display: flex;
            flex-direction: column;
        }

        /*
         * Viewer polish: hide empty <option> entries in the pdfjs zoom
         * dropdown. ngx-extended-pdf-viewer's i18n template
         * (pdfjs-page-scale-percent) wraps the numeral in U+2068/U+2069
         * bidi-isolate marks; before i18n resolves the text content is
         * empty for a tick, and this hides any option caught mid-load.
         * Encapsulation is None on this component because the pdfjs
         * toolbar is library-injected DOM and doesn't carry our Angular
         * content-scope attribute.
         *
         *  What this comment used to claim, and it was wrong: the options
         * were not blank for a TICK, they were blank ALWAYS. AdminController
         * gated static files on an extension allowlist that never named .ftl,
         * so every locale request answered with 60KB of index.html and pdf.js
         * parsed the SPA shell as Fluent. Every string resolved to nothing:
         * the named options showed raw ids (auto, page-actual) and the
         * numeric ones showed blank. This rule hid the blanks well enough
         * that the cause read as a timing quirk for months. A workaround that
         * makes a permanent failure look intermittent is worse than no
         * workaround -- keep the rule, but do not let it explain the bug.
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
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly pdfService = inject(NgxExtendedPdfViewerService);
    private readonly imagePicker = inject(CMS_PDF_IMAGE_PICKER, { optional: true });

    /** Fraction of the page width a stamped image gets before the user resizes it. */
    private static readonly STAMP_WIDTH_FRACTION = 0.4;

    constructor() {
        effect(() => {
            const url = this.url();
            if ('' === url) {
                return;
            }
            this.loadPdf(url);
        });

        this.interceptImageTool();
    }

    /*
     * -- The image tool uses OUR picker, not the browser's dialog ----
     *
     * Only when a host app provides one: with no CMS_PDF_IMAGE_PICKER the
     * library keeps its own dialog, which is right for a consumer that has no
     * media library.
     *
     * The listener is on the HOST in the CAPTURE phase because pdf.js binds
     * its own click handler directly to the button; capture is the only phase
     * that runs first, and stopping propagation there is what keeps CREATE
     * from ever reaching the event bus. The button is library-injected DOM
     * that does not exist yet at construction time, hence a delegated
     * listener rather than a direct one.
     */
    private interceptImageTool(): void {
        const picker = this.imagePicker;
        if (!picker) {
            return;
        }

        const element = this.host.nativeElement;
        const onClick = (event: Event): void => {
            const target = event.target as Element | null;
            if (!target?.closest?.('#editorStampAddImage')) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            void this.stampPickedImage();
        };

        element.addEventListener('click', onClick, true);
        this.destroyRef.onDestroy(() => element.removeEventListener('click', onClick, true));
    }

    /** Ask the host app for an image, then place it on the current page. */
    private async stampPickedImage(): Promise<void> {
        const source = await this.imagePicker?.pickImage();
        if (!source) {
            return;
        }

        try {
            await this.pdfService.addImageToAnnotationLayer({
                urlOrDataUrl: source,
                ...(await this.centredRect(source)),
            });
        } catch (cause) {
            // Never silent: a stamp that did not land has to say so somewhere,
            // and the viewer's own error panel only renders before the PDF
            // loads -- by here it would paint nothing.
            console.error('[cms-pdf-viewer] stamping the picked image failed', cause);
        }
    }

    /*
     * A rect centred on the page that keeps the image's own aspect ratio.
     *
     *  addImageToAnnotationLayer defaults every omitted edge to the page
     * edge, so leaving these out stamps the image stretched over the whole
     * sheet. Percentages are relative to the page in EACH axis independently,
     * which is why the page box's own aspect has to come into the height:
     * a square image on a portrait page is not 40% x 40%.
     */
    private async centredRect(source: string): Promise<{
        left: string; bottom: string; right: string; top: string;
    }> {
        const half = PdfViewerComponent.STAMP_WIDTH_FRACTION / 2;
        const fallback = {
            left:   `${(0.5 - half) * 100}%`,
            bottom: `${(0.5 - half) * 100}%`,
            right:  `${(0.5 + half) * 100}%`,
            top:    `${(0.5 + half) * 100}%`,
        };

        const page = this.host.nativeElement.querySelector('.page');
        const pageWidth = (page as HTMLElement | null)?.clientWidth ?? 0;
        const pageHeight = (page as HTMLElement | null)?.clientHeight ?? 0;
        if (0 === pageWidth || 0 === pageHeight) {
            return fallback;
        }

        const size = await this.naturalSize(source);
        if (!size) {
            return fallback;
        }

        const limit = PdfViewerComponent.STAMP_WIDTH_FRACTION;
        let widthFraction = limit;
        let heightFraction = (widthFraction * pageWidth * size.height)
            / (size.width * pageHeight);
        if (heightFraction > limit) {
            // Portrait image: the height is the binding edge, so BOTH sides
            // shrink by the same factor. Capping the height alone would keep
            // the full width and squash the picture.
            widthFraction *= limit / heightFraction;
            heightFraction = limit;
        }

        const halfWidth = widthFraction / 2;
        const halfHeight = heightFraction / 2;
        return {
            left:   `${(0.5 - halfWidth) * 100}%`,
            bottom: `${(0.5 - halfHeight) * 100}%`,
            right:  `${(0.5 + halfWidth) * 100}%`,
            top:    `${(0.5 + halfHeight) * 100}%`,
        };
    }

    /** Natural pixel size of the picked image, or null when it will not load. */
    private naturalSize(source: string): Promise<{ width: number; height: number } | null> {
        return new Promise((resolve) => {
            const probe = new Image();
            probe.onload = () => resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
            probe.onerror = () => resolve(null);
            probe.src = source;
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
