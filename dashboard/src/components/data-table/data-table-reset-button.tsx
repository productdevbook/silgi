"use client";

import { useDataTable } from "@/components/data-table/data-table-provider";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useHotKey } from "@/hooks/use-hot-key";
import { X } from "lucide-react";
import { Button } from "../ui/button";

export function DataTableResetButton() {
  const { table } = useDataTable();
  useHotKey(table.resetColumnFilters, "Escape");

  return (
    <TooltipProvider>
      <Tooltip delayDuration={100}>
        <TooltipTrigger render={<Button variant="ghost" onClick={() => table.resetColumnFilters()} />}><X className="me-2 h-4 w-4" />Reset
                        </TooltipTrigger>
        <TooltipContent side="left">
          <p className="text-nowrap">
            Reset filters with{" "}
            <Kbd className="text-muted-foreground group-hover:text-accent-foreground ms-1">
              <span className="me-1">⌘</span>
              <span>Esc</span>
            </Kbd>
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
