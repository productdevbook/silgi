import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useHotKey } from "@/hooks/use-hot-key";
import { useMediaQuery } from "@/hooks/use-media-query";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { FilterIcon } from "lucide-react";
import React from "react";
import { DataTableFilterControls } from "./data-table-filter-controls";

export function DataTableFilterControlsDrawer() {
  const triggerButtonRef = React.useRef<HTMLButtonElement>(null);
  const isMobile = useMediaQuery("(max-width: 640px)");

  useHotKey(() => {
    triggerButtonRef.current?.click();
  }, "b");

  return (
    <Drawer>
      <TooltipProvider>
        <Tooltip delayDuration={100}>
          <TooltipTrigger render={<DrawerTrigger render={<Button ref={isMobile ? triggerButtonRef : null} variant="ghost" size="icon" className="h-9 w-9" />} />}><FilterIcon className="h-4 w-4" /></TooltipTrigger>
          <TooltipContent side="right">
            <p className="text-nowrap">
              Toggle controls with{" "}
              <Kbd className="text-muted-foreground group-hover:text-accent-foreground ms-1">
                <span className="me-1">⌘</span>
                <span>B</span>
              </Kbd>
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DrawerContent className="max-h-[calc(100dvh-4rem)]">
        <VisuallyHidden>
          <DrawerHeader>
            <DrawerTitle>Filters</DrawerTitle>
            <DrawerDescription>Adjust your table filters</DrawerDescription>
          </DrawerHeader>
        </VisuallyHidden>
        <div className="flex-1 overflow-y-auto px-4">
          <DataTableFilterControls />
        </div>
        <DrawerFooter>
          <DrawerClose render={<Button variant="outline" className="w-full" />}>Close
                              </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
