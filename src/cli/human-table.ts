import { createTable, type TableCell } from "@visulima/tabular";
import { NO_BORDER } from "@visulima/tabular/style";

import { muted, type CliUiOptions } from "./format.ts";

const dividerFor = (width: number, ui: CliUiOptions): string =>
  muted("─".repeat(width), ui);

const ansiPattern = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  "gu"
);

export type HumanTableOptions = {
  headers: TableCell[] | TableCell[][];
  rows: TableCell[][];
  columnWidths: number[];
  useColor?: boolean;
};

const columnGap = 1;

const countHeaderRows = (headers: TableCell[] | TableCell[][]): number =>
  Array.isArray(headers[0]) ? headers.length : 1;

const visibleText = (cell: TableCell): string => {
  if (cell === null || cell === undefined) {
    return "";
  }
  if (typeof cell === "object") {
    return String(cell.content ?? "");
  }
  return String(cell);
};

const visibleWidth = (text: string): number =>
  text.replaceAll(ansiPattern, "").length;

const rowWidth = (row: TableCell[], columnWidths: number[]): number => {
  let total = 0;
  for (const [index, cell] of row.entries()) {
    const width = columnWidths[index] ?? visibleWidth(visibleText(cell));
    total += width + (index === 0 ? 0 : 1);
  }
  return total;
};

export const formatHumanTable = (options: HumanTableOptions): string => {
  const terminalWidth =
    options.columnWidths.reduce((total, width) => total + width, 0) +
    columnGap * Math.max(0, options.columnWidths.length - 1);
  const table = createTable({
    columnWidths: options.columnWidths,
    gap: columnGap,
    showHeader: true,
    style: {
      border: NO_BORDER,
      paddingLeft: 0,
      paddingRight: 0,
    },
    terminalWidth,
    truncate: true,
    wordWrap: false,
  });
  table.setHeaders(options.headers);
  table.addRows(...options.rows);

  const headerRows = countHeaderRows(options.headers);
  const lines = table
    .toString()
    .split("\n")
    .map((line) => line.trimEnd());
  if (lines.length === 0 || lines[0] === undefined || lines[0] === "") {
    return "";
  }
  const headers = lines.slice(0, headerRows);
  const body = lines.slice(headerRows);
  const renderedWidth = Math.max(
    terminalWidth,
    ...lines.map((line) => visibleWidth(line)),
    ...options.rows.map((row) => rowWidth(row, options.columnWidths))
  );
  return `${[
    ...headers,
    dividerFor(renderedWidth, { color: options.useColor ?? false }),
    ...body,
  ].join("\n")}\n`;
};
