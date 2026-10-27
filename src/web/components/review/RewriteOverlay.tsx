import React, { useLayoutEffect, useRef, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpenText, Code2, MessageSquarePlus } from "lucide-react";
import type { ResolvedRewriteBlock, ReviewSide, RewriteRegion } from "../../../core/types";

export interface OverlayRegion {
  key: string;
  block: ResolvedRewriteBlock;
  region: RewriteRegion;
}

interface Box {
  top: number;
  height: number;
  left: number;
  width: number;
}

interface Layout {
  /** Over the column the rewrite is read in: additions in split view. */
  text: Box;
  /** Over the other columns of the same rows. */
  masks: Box[];
  /** Code lines folded away under the layer. */
  folded: number;
}

const HIDE = "data-rw-hide";
const PAD = "data-rw-pad";
/** Holds a filler's original style while it spans fewer rows. */
const SPAN = "data-rw-span";
const SHADOW_CSS = `[${HIDE}]{display:none!important}[${PAD}]{padding-bottom:var(--rw-pad)!important}`;

const within = (n: number | undefined, range: [number, number] | undefined) =>
  n !== undefined && range !== undefined && n >= range[0] && n <= range[1];

/** Old/new line numbers of a rendered diff row. */
function rowLines(row: Element): { old?: number; new?: number } {
  const type = row.getAttribute("data-line-type") ?? "";
  const line = Number(row.getAttribute("data-line"));
  const altAttr = row.getAttribute("data-alt-line");
  const alt = altAttr ? Number(altAttr) : undefined;
  if (type.includes("deletion")) return { old: line };
  if (type.includes("addition")) return { new: line };
  // Context rows: the deletions column numbers by the old file, others by the new one.
  return row.closest("[data-code]")?.hasAttribute("data-deletions")
    ? { old: line, new: alt }
    : { new: line, old: alt };
}

export function inRegion(region: RewriteRegion, side: ReviewSide, line: number): boolean {
  return within(line, side === "additions" ? region.additions : region.deletions);
}

/** The last line of a region, where annotations go while it is covered. */
export function regionEnd(region: RewriteRegion): { side: ReviewSide; line: number } {
  return region.additions
    ? { side: "additions", line: region.additions[1] }
    : { side: "deletions", line: region.deletions![1] };
}

function clearFolds(root: ShadowRoot) {
  for (const el of root.querySelectorAll<HTMLElement>(`[${HIDE}],[${PAD}],[${SPAN}]`)) {
    el.removeAttribute(HIDE);
    el.removeAttribute(PAD);
    el.style.removeProperty("--rw-pad");
    if (el.hasAttribute(SPAN)) {
      el.setAttribute("style", el.getAttribute(SPAN)!);
      el.removeAttribute(SPAN);
    }
  }
}

/**
 * Fillers keep split columns aligned: one cell spanning the rows the other
 * column has and this one lacks. Folding rows out of the other column takes
 * as many rows out of the filler.
 */
const isFiller = (cell: Element) => cell.hasAttribute("data-buffer-size") && !isAnnotation(cell);

/**
 * Annotation rows (comments) are never folded. The diff syncs their height
 * across split columns from what is rendered, so hiding them would feed back
 * into the layout the next pass measures.
 */
const isAnnotation = (cell: Element) =>
  cell.hasAttribute("data-line-annotation") ||
  cell.getAttribute("data-gutter-buffer") === "annotation";

/**
 * A filler's height is its min-height (border-box), so padding would not add
 * to it: a pad goes into the min-height instead.
 */
function fitFiller(cell: HTMLElement, rows: number, pad: number) {
  if (rows <= 0) {
    cell.setAttribute(HIDE, "");
    return;
  }
  if (!cell.hasAttribute(SPAN)) cell.setAttribute(SPAN, cell.getAttribute("style") ?? "");
  cell.style.gridRow = `span ${rows}`;
  cell.style.minHeight = `calc(${rows} * 1lh + ${pad}px)`;
}

/**
 * Lay out each region's layer over the rendered diff, and fit the code rows
 * under a covered layer to its rewrite: rows past what the rewrite needs are
 * folded away, and a region too short for its rewrite is padded. The diff
 * renders into an open shadow root and re-renders asynchronously
 * (highlighting, annotations, resizes), so layout reruns on every change.
 */
function useRegionLayouts(
  wrap: HTMLDivElement | null,
  regions: OverlayRegion[],
  revealed: Set<string>,
) {
  const [layouts, setLayouts] = useState<Map<string, Layout>>(new Map());

  useLayoutEffect(() => {
    const el = wrap;
    if (!el) return;
    let frame = 0;
    let root: ShadowRoot | null = null;
    const watchRoot = () =>
      root && shadowChanges.observe(root, { childList: true, subtree: true, attributes: true });

    const measure = () => {
      frame = 0;
      root = el.querySelector("diffs-container")?.shadowRoot ?? null;
      if (!root) return;
      // Our own edits to the shadow DOM must not schedule another pass.
      shadowChanges.disconnect();
      try {
        if (!root.querySelector("style[data-rw]")) {
          const style = document.createElement("style");
          style.setAttribute("data-rw", "");
          style.textContent = SHADOW_CSS;
          root.append(style);
        }
        clearFolds(root);
        const next = layoutRegions(el, root, regions, revealed);
        setLayouts((prev) =>
          JSON.stringify([...prev]) === JSON.stringify([...next]) ? prev : next,
        );
      } finally {
        watchRoot();
      }
      for (const text of el.querySelectorAll(".rw-text")) resizes.observe(text);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    const shadowChanges = new MutationObserver(schedule);
    const lightChanges = new MutationObserver(schedule);
    lightChanges.observe(el, { childList: true, subtree: true });
    const resizes = new ResizeObserver(schedule);
    resizes.observe(el);
    // Synchronously, so a toggle never paints the rows in between.
    measure();

    return () => {
      cancelAnimationFrame(frame);
      shadowChanges.disconnect();
      lightChanges.disconnect();
      resizes.disconnect();
      if (root) clearFolds(root);
    };
  }, [wrap, regions, revealed]);

  return layouts;
}

function layoutRegions(
  el: HTMLElement,
  root: ShadowRoot,
  regions: OverlayRegion[],
  revealed: Set<string>,
): Map<string, Layout> {
  const origin = el.getBoundingClientRect();
  const codes = [...root.querySelectorAll<HTMLElement>("[data-code]")];
  const textCode = codes.find((code) => code.hasAttribute("data-additions")) ?? codes.at(-1);
  const columnOf = (code: HTMLElement) => {
    const content = code.querySelector("[data-content]")!.getBoundingClientRect();
    return {
      left: content.left - origin.left,
      width: code.getBoundingClientRect().right - content.left,
    };
  };
  const cells = () =>
    codes.flatMap((code) =>
      [
        ...code.querySelectorAll<HTMLElement>(
          ":scope > [data-gutter] > *, :scope > [data-content] > *",
        ),
      ]
        .map((cell) => ({ cell, code, rect: cell.getBoundingClientRect() }))
        .filter(({ rect }) => rect.height > 0),
    );
  const rowsOf = (region: RewriteRegion, all: ReturnType<typeof cells>) =>
    all.filter(({ cell }) => {
      if (!cell.hasAttribute("data-line")) return false;
      const lines = rowLines(cell);
      return within(lines.old, region.deletions) || within(lines.new, region.additions);
    });
  /**
   * A region's rows and where its layer ends in each column. In split view
   * the rows beside a region's tail can be lines outside it (the start of
   * the next change): a column's layer ends above the first of them, so they
   * stay readable.
   */
  const extentOf = (region: RewriteRegion, all: ReturnType<typeof cells>) => {
    const rows = rowsOf(region, all);
    if (rows.length === 0) return undefined;
    const own = new Set(rows.map((r) => r.cell));
    const top = Math.min(...rows.map((r) => r.rect.top));
    const bottom = Math.max(...rows.map((r) => r.rect.bottom));
    const endIn = (code: HTMLElement) =>
      Math.min(
        bottom,
        ...all
          .filter(
            (c) =>
              c.code === code &&
              c.cell.hasAttribute("data-line") &&
              !own.has(c.cell) &&
              c.rect.top > top + 0.5 &&
              c.rect.top < bottom - 0.5,
          )
          .map((c) => c.rect.top),
      );
    return { rows, top, endIn };
  };

  // Fit pass, against the natural layout.
  const natural = cells();
  const folded = new Map<string, number>();
  // A filler can reach under several regions, so its edits add up.
  const fillerCuts = new Map<HTMLElement, number>();
  const pads = new Map<HTMLElement, number>();
  for (const { key, block, region } of regions) {
    if (revealed.has(block.id)) continue;
    const extent = extentOf(region, natural);
    if (!extent) continue;
    const { top } = extent;
    // Fold and pad only above lines outside the region, in any column.
    const bottom = Math.min(...codes.map(extent.endIn));
    const text = el.querySelector<HTMLElement>(`[data-rw-key="${CSS.escape(key)}"] .rw-text`);
    if (!text) continue;
    const target = top + Math.max(text.offsetHeight, 1);
    const band = natural.filter((c) => c.rect.top >= top - 0.5 && c.rect.bottom <= bottom + 0.5);
    // Fillers reaching into the region from outside it.
    const fillers = natural.filter(
      (c) => isFiller(c.cell) && c.rect.top < bottom - 0.5 && c.rect.bottom > top + 0.5,
    );

    if (bottom > target + 3) {
      // Fold at the first row boundary past the rewrite that no line spans;
      // a few pixels of slack absorb inline code chips taller than a row.
      const cut = [...new Set(band.map((c) => c.rect.bottom))]
        .sort((a, b) => a - b)
        .find(
          (y) =>
            y >= target - 3 &&
            !natural.some(
              (c) => !isFiller(c.cell) && c.rect.top < y - 0.5 && c.rect.bottom > y + 0.5,
            ),
        );
      if (cut === undefined || cut >= bottom - 0.5) continue;
      const hidden = band.filter(
        (c) => !isFiller(c.cell) && !isAnnotation(c.cell) && c.rect.top >= cut - 0.5,
      );
      for (const { cell } of hidden) cell.setAttribute(HIDE, "");
      // Count the rows hidden beside each filler rather than divide its
      // height: wrapped rows make the rows it spans uneven.
      for (const { cell, code, rect } of fillers) {
        const rows = new Set(
          hidden
            .filter(
              (c) =>
                c.code !== code &&
                c.rect.top >= rect.top - 0.5 &&
                c.rect.bottom <= rect.bottom + 0.5,
            )
            .map((c) => Math.round(c.rect.top)),
        ).size;
        if (rows) fillerCuts.set(cell, (fillerCuts.get(cell) ?? 0) + rows);
      }
      folded.set(
        key,
        Math.max(
          ...codes.map(
            (code) =>
              hidden.filter((c) => c.code === code && c.cell.hasAttribute("data-line")).length,
          ),
        ),
      );
    } else if (target > bottom + 0.5) {
      // A filler as tall as the region is in both lists; pad it once.
      for (const { cell, rect } of new Map(
        [...band, ...fillers].map((c) => [c.cell, c]),
      ).values()) {
        // Cells ending with the region, and fillers running past its end.
        if (Math.abs(rect.bottom - bottom) > 0.5 && !(isFiller(cell) && rect.bottom > bottom))
          continue;
        pads.set(cell, (pads.get(cell) ?? 0) + target - bottom);
      }
    }
  }
  for (const cell of new Set([...fillerCuts.keys(), ...pads.keys()].filter(isFiller)))
    fitFiller(
      cell,
      (Number(cell.getAttribute("data-buffer-size")) || 1) - (fillerCuts.get(cell) ?? 0),
      pads.get(cell) ?? 0,
    );
  for (const [cell, pad] of pads) {
    if (isFiller(cell)) continue;
    cell.setAttribute(PAD, "");
    cell.style.setProperty("--rw-pad", `${pad}px`);
  }

  // Place pass, against the fitted layout.
  const fitted = cells();
  const layouts = new Map<string, Layout>();
  for (const { key, region } of regions) {
    const extent = extentOf(region, fitted);
    if (!extent || !textCode) continue;
    const box = (code: HTMLElement) => ({
      top: extent.top - origin.top,
      height: extent.endIn(code) - extent.top,
      ...columnOf(code),
    });
    layouts.set(key, {
      text: box(textCode),
      // Only columns holding some of the region's lines: beside an
      // additions-only region the other column is filler and stays as is.
      masks: codes
        .filter((code) => code !== textCode && extent.rows.some((r) => r.code === code))
        .map(box),
      folded: folded.get(key) ?? 0,
    });
  }
  return layouts;
}

/**
 * Tables wider than the column scroll on their own instead of being clipped.
 * A press that scrolled the table (its scrollbar) does not toggle the layer.
 */
function ScrollTable(props: React.ComponentProps<"table">) {
  const pressedAt = useRef(0);
  return (
    <div
      className="rw-table"
      onPointerDown={(e) => (pressedAt.current = e.currentTarget.scrollLeft)}
      onClick={(e) => {
        if (e.currentTarget.scrollLeft !== pressedAt.current) e.stopPropagation();
      }}
    >
      <table {...props} />
    </div>
  );
}

const markdownComponents: Components = {
  table: ({ node: _, ...props }) => <ScrollTable {...props} />,
};

const boxStyle = (box: Box): React.CSSProperties => ({
  top: box.top,
  left: box.left,
  width: box.width,
  height: box.height,
});

/**
 * Rewrite layers laid over the code lines they re-express. A covered layer
 * folds the rows under it down to what the rewrite needs; lifting it restores
 * the code. The switch in the top-right corner (and the rail on the left
 * edge) toggles both ways and stays in
 * the same place in either state.
 */
export function RewriteOverlays({
  wrap,
  regions,
  revealed,
  onToggle,
  onComment,
}: {
  /** The element wrapping the rendered diff; overlays are positioned inside it. */
  wrap: HTMLDivElement | null;
  regions: OverlayRegion[];
  revealed: Set<string>;
  onToggle: (blockId: string) => void;
  onComment: (block: ResolvedRewriteBlock) => void;
}) {
  const layouts = useRegionLayouts(wrap, regions, revealed);

  return (
    <>
      {regions.map(({ key, block }) => {
        const layout = layouts.get(key);
        if (!layout) return null;
        const open = revealed.has(block.id);
        const toggle = () => onToggle(block.id);
        const rail = (
          <button
            className="rw-rail"
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
            title={open ? "Cover with the rewrite" : "Show the code"}
            aria-label={open ? "Cover with the rewrite" : "Show the code"}
          />
        );
        const toggleSwitch = (
          <button
            className="rw-switch"
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
            title={open ? "Cover with the rewrite" : "Show the code"}
          >
            {open ? <BookOpenText className="size-3" /> : <Code2 className="size-3" />}
            {open ? "rewrite" : "code"}
          </button>
        );

        if (open) {
          return (
            <div key={key} data-rw-key={key} className="rw-revealed" style={boxStyle(layout.text)}>
              {rail}
              {toggleSwitch}
            </div>
          );
        }

        return (
          <React.Fragment key={key}>
            {layout.masks.map((mask, i) => (
              <div
                key={i}
                className="rw-mask"
                style={boxStyle(mask)}
                onClick={toggle}
                title="Show the code"
              />
            ))}
            <div
              data-rw-key={key}
              role="button"
              tabIndex={0}
              className="rw-overlay"
              style={boxStyle(layout.text)}
              onClick={toggle}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggle();
                }
              }}
              title="Show the code"
            >
              {rail}
              <div className="rw-meta">
                {/* Always in place, so folding never changes the width the
                    rewrite wraps in, and with it what gets folded. */}
                <span
                  className="rw-folded"
                  style={{ visibility: layout.folded > 0 ? undefined : "hidden" }}
                  title={`${layout.folded} more code lines folded under this rewrite`}
                >
                  +{layout.folded}
                </span>
                <button
                  className="rw-comment"
                  onClick={(e) => {
                    e.stopPropagation();
                    onComment(block);
                  }}
                  title="Comment on this rewrite"
                >
                  <MessageSquarePlus className="size-3.5" />
                </button>
                {toggleSwitch}
              </div>
              <div className="rw-text">
                {block.title && <strong className="rw-title">{block.title}</strong>}
                <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {block.rewrite}
                </Markdown>
              </div>
            </div>
          </React.Fragment>
        );
      })}
    </>
  );
}
