"use client";

import Link from "next/link";
import { useMemo } from "react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const TERRACOTTA = "#B85042";

export type BoqLine = {
  description: string;
  quantity: number;
  unit: string;
  rate_aed: number;
  total_aed: number;
  vendor_or_source: string;
  notes: string | null;
};

export type BoqSection = {
  work_section: string;
  lines: BoqLine[];
  section_total_aed: number;
};

export type BoqPayload = {
  sections: BoqSection[];
  subtotal_aed: number;
  contingency_pct: number;
  contingency_aed: number;
  vat_pct: number;
  vat_aed: number;
  grand_total_aed: number;
};

type Props = {
  projectId: string;
  projectTitle: string;
  budgetAed: number;
  boq: BoqPayload;
};

function formatAed(n: number): string {
  return `AED ${Math.round(n).toLocaleString("en-US")}`;
}

function budgetComparison(grand: number, budget: number): {
  label: string;
  tone: "under" | "over" | "on-target";
} {
  if (budget <= 0) return { label: "No budget set", tone: "on-target" };
  const diff = budget - grand;
  const pct = Math.round((Math.abs(diff) / budget) * 100);
  if (pct <= 1) return { label: "On target", tone: "on-target" };
  return diff > 0
    ? { label: `${pct}% under`, tone: "under" }
    : { label: `${pct}% over`, tone: "over" };
}

// Hardcoded upgrade hints. Each entry returns a matcher against a section's
// lines plus a delta (AED) and copy. We pick 6–8 to actually surface based
// on which sections exist in this BoQ.
type Sensitivity = {
  description: string;
  delta_aed: number;
};

function sensitivityFor(
  workSection: string,
  line: BoqLine,
): Sensitivity | null {
  const desc = line.description.toLowerCase();

  if (workSection === "Floor Finishes" && desc.includes("porcelain")) {
    return {
      description:
        "Upgrading to engineered European oak (180mm wide, brushed matt) adds AED 18,400",
      delta_aed: 18400,
    };
  }
  if (workSection === "Floor Finishes" && desc.includes("screed")) {
    return {
      description:
        "Upgrading to a self-levelling polymer screed (acoustic-rated) adds AED 4,200",
      delta_aed: 4200,
    };
  }
  if (workSection === "Wall Finishes") {
    return {
      description:
        "Upgrading to large-format marble-effect porcelain (60×120, rectified) adds AED 6,600",
      delta_aed: 6600,
    };
  }
  if (workSection === "Sanitaryware") {
    return {
      description:
        "Upgrading the set to Duravit + Hansgrohe (matt black) adds AED 14,500 per bathroom",
      delta_aed: 14500,
    };
  }
  if (
    workSection === "Joinery & Carpentry" &&
    desc.includes("wardrobe")
  ) {
    return {
      description:
        "Upgrading wardrobe carcass to smoked oak veneer with soft-close push-to-open adds AED 11,800 per bedroom",
      delta_aed: 11800,
    };
  }
  if (workSection === "Joinery & Carpentry" && desc.includes("door")) {
    return {
      description:
        "Upgrading from flush MDF to engineered solid-core oak doors adds AED 1,900 per door",
      delta_aed: 1900,
    };
  }
  if (
    workSection === "Joinery & Carpentry" &&
    desc.includes("vanity")
  ) {
    return {
      description:
        "Upgrading the vanity top to honed Calacatta marble adds AED 3,400 per bathroom",
      delta_aed: 3400,
    };
  }
  if (workSection === "Lighting") {
    return {
      description:
        "Adding 4 designer pendants (Flos / Foscarini) plus DALI dimming adds AED 12,200",
      delta_aed: 12200,
    };
  }
  if (
    workSection === "Decoration & Painting" &&
    (desc.includes("painting") || desc.includes("walls"))
  ) {
    return {
      description:
        "Upgrading to a hand-applied lime wash on living-area walls adds AED 7,800",
      delta_aed: 7800,
    };
  }
  return null;
}

export function BoqView({ projectId, projectTitle, budgetAed, boq }: Props) {
  const compare = budgetComparison(boq.grand_total_aed, budgetAed);

  // First sensitivity hit per (section, line). Cap at 8 total so the page
  // doesn't get noisy.
  const sensitivityIndex = useMemo(() => {
    const map = new Map<string, Sensitivity>();
    let count = 0;
    for (const section of boq.sections) {
      for (const line of section.lines) {
        if (count >= 8) break;
        const hint = sensitivityFor(section.work_section, line);
        if (hint) {
          map.set(`${section.work_section}::${line.description}`, hint);
          count++;
        }
      }
      if (count >= 8) break;
    }
    return map;
  }, [boq.sections]);

  return (
    <div className="pb-32">
      {/* HERO ---------------------------------------------------------- */}
      <section className="mt-8 rounded-2xl border border-outline-variant bg-surface-container p-8">
        <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">
          {projectTitle}
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-3">
          <div
            className="text-[64px] leading-[1.05] font-semibold tracking-tight"
            style={{
              fontFamily: '"Georgia", "Times New Roman", serif',
              color: TERRACOTTA,
            }}
          >
            {formatAed(boq.grand_total_aed)}
          </div>
          <div className="flex flex-col gap-1 pb-2 text-body-md text-on-surface-variant">
            <span>Budget: {formatAed(budgetAed)}</span>
            <BudgetPill tone={compare.tone} label={compare.label} />
          </div>
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <SummaryChip label="Subtotal" value={formatAed(boq.subtotal_aed)} />
          <SummaryChip
            label={`Contingency ${boq.contingency_pct}%`}
            value={formatAed(boq.contingency_aed)}
          />
          <SummaryChip
            label={`VAT ${boq.vat_pct}%`}
            value={formatAed(boq.vat_aed)}
          />
          <SummaryChip
            label="Grand total"
            value={formatAed(boq.grand_total_aed)}
            emphasis
          />
        </div>
      </section>

      {/* SECTIONS ------------------------------------------------------ */}
      <section className="mt-10">
        <Accordion multiple defaultValue={[boq.sections[0]?.work_section ?? ""]}>
          {boq.sections.map((section) => (
            <AccordionItem
              key={section.work_section}
              value={section.work_section}
              className="rounded-xl border border-outline-variant bg-surface-container px-5 mb-3"
            >
              <AccordionTrigger className="py-5 hover:no-underline">
                <div className="flex w-full items-center justify-between gap-4 pr-6">
                  <div className="flex flex-col gap-1 text-left">
                    <span className="text-h3 text-on-surface">
                      {section.work_section}
                    </span>
                    <span className="text-label-sm text-on-surface-variant">
                      {section.lines.length}{" "}
                      {section.lines.length === 1 ? "line item" : "line items"}
                    </span>
                  </div>
                  <span className="text-h3 text-on-surface tabular-nums">
                    {formatAed(section.section_total_aed)}
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="border-t border-outline-variant pt-3">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="text-on-surface-variant">
                          Description
                        </TableHead>
                        <TableHead className="text-right text-on-surface-variant">
                          Qty
                        </TableHead>
                        <TableHead className="text-on-surface-variant">
                          Unit
                        </TableHead>
                        <TableHead className="text-right text-on-surface-variant">
                          Rate (AED)
                        </TableHead>
                        <TableHead className="text-right text-on-surface-variant">
                          Total (AED)
                        </TableHead>
                        <TableHead className="text-on-surface-variant">
                          Source
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {section.lines.map((line, idx) => {
                        const hint = sensitivityIndex.get(
                          `${section.work_section}::${line.description}`,
                        );
                        return (
                          <LineRow
                            key={`${section.work_section}-${idx}`}
                            line={line}
                            sensitivity={hint}
                          />
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>

      {/* STICKY FOOTER ------------------------------------------------- */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-outline-variant bg-surface/95 backdrop-blur-sm">
        <div className="ml-64 px-6 py-4">
          <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4">
            <p className="text-label-md text-on-surface-variant">
              Total: <span className="text-on-surface">{formatAed(boq.grand_total_aed)}</span>{" "}
              · {compare.label}
            </p>
            <Link
              href={`/project/${projectId}/vendors`}
              className={buttonVariants({ size: "lg" })}
            >
              Approve BoQ → pick vendors
              <span
                className="material-symbols-outlined ml-1 text-base"
                aria-hidden="true"
              >
                arrow_forward
              </span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function SummaryChip({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={
        "flex items-center gap-3 rounded-full border px-4 py-2 " +
        (emphasis
          ? "border-indigo-500/40 bg-indigo-500/10"
          : "border-outline-variant bg-surface-container-low")
      }
    >
      <span className="text-label-sm uppercase tracking-wider text-on-surface-variant">
        {label}
      </span>
      <span
        className={
          "text-label-md tabular-nums " +
          (emphasis ? "text-indigo-400" : "text-on-surface")
        }
      >
        {value}
      </span>
    </div>
  );
}

function BudgetPill({
  tone,
  label,
}: {
  tone: "under" | "over" | "on-target";
  label: string;
}) {
  const cls =
    tone === "under"
      ? "border-status-success/40 bg-status-success/15 text-status-success"
      : tone === "over"
        ? "border-status-error/40 bg-status-error/15 text-status-error"
        : "border-outline-variant bg-surface-container-low text-on-surface-variant";
  return (
    <Badge
      variant="secondary"
      className={"w-fit border " + cls}
    >
      {label}
    </Badge>
  );
}

function LineRow({
  line,
  sensitivity,
}: {
  line: BoqLine;
  sensitivity: Sensitivity | undefined;
}) {
  return (
    <>
      <TableRow className="hover:bg-surface-container-high/40">
        <TableCell className="whitespace-normal align-top">
          <div className="flex flex-col gap-1">
            <span className="text-body-md text-on-surface">
              {line.description}
            </span>
            {line.notes && (
              <span className="text-label-sm text-on-surface-variant">
                {line.notes}
              </span>
            )}
          </div>
        </TableCell>
        <TableCell className="text-right align-top tabular-nums text-on-surface">
          {line.quantity.toLocaleString("en-US")}
        </TableCell>
        <TableCell className="align-top text-on-surface-variant">
          {line.unit}
        </TableCell>
        <TableCell className="text-right align-top tabular-nums text-on-surface">
          {line.rate_aed.toLocaleString("en-US")}
        </TableCell>
        <TableCell className="text-right align-top tabular-nums text-on-surface">
          {line.total_aed.toLocaleString("en-US")}
        </TableCell>
        <TableCell className="whitespace-normal align-top text-on-surface-variant">
          <span className="text-label-sm">{line.vendor_or_source}</span>
        </TableCell>
      </TableRow>
      {sensitivity && (
        <TableRow className="border-b-0 hover:bg-transparent">
          <TableCell colSpan={6} className="whitespace-normal py-2">
            <div
              className="flex items-start gap-2 rounded-md border border-dashed px-3 py-2 text-label-sm"
              style={{
                borderColor: `${TERRACOTTA}55`,
                background: `${TERRACOTTA}0F`,
                color: "#E9B7B0",
              }}
            >
              <span
                className="material-symbols-outlined text-base"
                aria-hidden="true"
                style={{ color: TERRACOTTA }}
              >
                trending_up
              </span>
              <span>
                <span className="font-semibold">Sensitivity · </span>
                {sensitivity.description}
              </span>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
