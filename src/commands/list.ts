import { getLogger } from "@logtape/logtape";
import type { TableCell } from "@visulima/tabular";
import { define } from "gunshi";

import {
  bold,
  cliUseColor,
  formatNextLine,
  formatRouteLine,
  muted,
  statusIcon,
  type CliUiOptions,
} from "../cli/format.ts";
import { formatHumanTable } from "../cli/human-table.ts";
import { listRunStates } from "../state/store.ts";
import { readSwitchRegistry } from "../state/switch-registry.ts";
import { pickBoolean, pickString } from "../utils/pick.ts";
import {
  formatSwitchableRoutes,
  hasSwitchablesForRun,
} from "./switchable-output.ts";

const log = getLogger(["orchport", "list"]);

const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const proxyNamesForRows = (
  rows: ReadonlyArray<{ proxies: Record<string, unknown> }>
): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    for (const name of Object.keys(row.proxies)) {
      if (!seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
  }
  return out;
};

const centerCell = (content: string): TableCell => ({
  content,
  hAlign: "center",
});

const plainCell = (content: string): TableCell => ({ content });

const maxTextWidth = (values: string[], minimum: number): number =>
  values.reduce((max, value) => Math.max(max, value.length), minimum);

/** Reads persisted run state from disk; `--json` or human-readable table. Volatile runs (no state file) do not appear. */
export const listCommand = define({
  name: "list",
  description: "List recorded orchport runs",
  args: {
    json: {
      type: "boolean",
      description: "Print recorded runs as JSON",
      default: false,
    },
    stale: {
      type: "boolean",
      description: "Only show runs whose root PID is gone",
      default: false,
    },
    sld: {
      type: "string",
      description: "Filter runs by SLD (ORCHPORT_SLD / stored workspace label)",
    },
    worktree: {
      type: "string",
      description: "Filter runs by worktree slug",
    },
  },
  run: async (ctx) => {
    log.debug("list: loading run states");
    let rows = await listRunStates();
    const w = pickString(ctx.values, "sld");
    const wt = pickString(ctx.values, "worktree");
    if (w) {
      rows = rows.filter((r) => r.workspace === w);
    }
    if (wt) {
      rows = rows.filter((r) => r.worktree === wt);
    }

    const json = pickBoolean(ctx.values, "json") === true;
    const staleOnly = pickBoolean(ctx.values, "stale") === true;

    const mapped = rows.map((r) =>
      Object.assign({}, r, { running: pidAlive(r.rootPid) })
    );

    const filtered = staleOnly ? mapped.filter((r) => !r.running) : mapped;
    log.debug("list: showing {n} run(s)", { n: String(filtered.length) });

    if (json) {
      process.stdout.write(`${JSON.stringify(filtered, null, 2)}\n`);
      return;
    }

    const useColor = cliUseColor(process.stdout, {
      noColor: pickBoolean(ctx.values, "noColor") ?? false,
    });
    const ui: CliUiOptions = { color: useColor };
    const registry = await readSwitchRegistry();
    const routes = formatSwitchableRoutes(registry, rows);

    if (filtered.length === 0) {
      process.stdout.write(`${muted("(no recorded runs)", ui)}\n`);
      return;
    }

    const proxyNames = proxyNamesForRows(filtered);
    const proxyColumns = proxyNames.length > 0 ? proxyNames : ["-"];
    const runWidth = maxTextWidth(
      filtered.map((row) => row.runId.slice(0, 10)),
      "Run".length
    );
    const statusWidth =
      maxTextWidth(
        filtered.map((row) => (row.running ? "● needs target" : "○ stopped")),
        "Status".length
      ) + 1;
    const pidWidth = maxTextWidth(
      filtered.map((row) => String(row.rootPid)),
      "PID".length
    );
    const workspaceWidth = maxTextWidth(
      filtered.map((row) => `${row.workspace}/${row.worktree}`),
      "Workspace".length
    );
    const switchesWidth = "Switches".length;
    const proxyWidths = proxyColumns.map((name) =>
      maxTextWidth(
        filtered.map((row) => {
          const port = row.proxies[name]?.port;
          return port === undefined ? "-" : String(port);
        }),
        name.length
      )
    );
    const proxyDivider = muted("│", ui);
    const headers: TableCell[][] = [
      [
        bold("Run", ui),
        bold("Status", ui),
        bold("PID", ui),
        bold("Workspace", ui),
        proxyDivider,
        {
          content: bold("Proxies", ui),
          colSpan: proxyColumns.length,
        },
        proxyDivider,
        bold("Switches", ui),
      ],
      [
        "",
        "",
        "",
        "",
        proxyDivider,
        ...proxyColumns.map((name) => centerCell(bold(name, ui))),
        proxyDivider,
        "",
      ],
    ];

    const dataRows: TableCell[][] = [];
    for (const r of filtered) {
      const hasSwitches = hasSwitchablesForRun(r, registry);
      const unresolved = routes.some(
        (route) =>
          route.targetWorktree === r.worktree &&
          r.proxies[route.proxyName] !== undefined &&
          route.unresolved
      );
      const rowUi: CliUiOptions = {
        color: useColor && (r.running || unresolved),
      };
      const status = r.running
        ? `${statusIcon(unresolved ? "warn" : "running", ui)} ${unresolved ? "needs target" : "running"}`
        : `${statusIcon("stopped", ui)} stopped`;
      const switchText = hasSwitches
        ? unresolved
          ? rowUi.color
            ? "\x1b[33myes\x1b[0m"
            : "yes"
          : "yes"
        : "no";
      dataRows.push([
        r.running ? r.runId.slice(0, 10) : muted(r.runId.slice(0, 10), ui),
        status,
        r.running ? String(r.rootPid) : muted(String(r.rootPid), ui),
        r.running
          ? `${r.workspace}/${r.worktree}`
          : muted(`${r.workspace}/${r.worktree}`, ui),
        plainCell(proxyDivider),
        ...proxyColumns.map((name) => {
          if (name === "-") {
            return centerCell(r.running ? name : muted(name, ui));
          }
          const port = r.proxies[name]?.port;
          const value = port === undefined ? "-" : String(port);
          return centerCell(r.running ? value : muted(value, ui));
        }),
        plainCell(proxyDivider),
        hasSwitches && unresolved
          ? switchText
          : r.running
            ? switchText
            : muted(switchText, ui),
      ]);
    }

    process.stdout.write(
      `${bold(`orchport list  ${filtered.length} runs`, ui)}\n`
    );
    process.stdout.write(
      `${formatHumanTable({
        headers,
        rows: dataRows,
        columnWidths: [
          runWidth,
          statusWidth,
          pidWidth,
          workspaceWidth,
          1,
          ...proxyWidths,
          1,
          switchesWidth,
        ],
        useColor,
      })}\n`
    );
    if (routes.length > 0) {
      process.stdout.write(`${bold("Switchable", ui)}\n`);
      for (const route of routes) {
        process.stdout.write(formatRouteLine(route, ui));
      }
    }
    if (filtered.some((r) => !r.running)) {
      process.stdout.write(
        `\n${formatNextLine("remove stale entries with `orchport kill --stale`.", ui)}`
      );
    }
  },
});
