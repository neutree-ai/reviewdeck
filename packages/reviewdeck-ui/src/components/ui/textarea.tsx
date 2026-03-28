import React from "react";
import { cn } from "../../lib/utils";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    className={cn(
      "rd:flex rd:min-h-[60px] rd:w-full rd:rounded-md rd:border rd:border-border rd:bg-input/60 rd:px-3 rd:py-2 rd:text-sm rd:text-foreground rd:font-[family-name:var(--font-sans)] placeholder:rd:text-muted-foreground focus-visible:rd:outline-none focus-visible:rd:ring-1 focus-visible:rd:ring-primary/50 focus-visible:rd:border-primary/40 rd:transition-colors disabled:rd:cursor-not-allowed disabled:rd:opacity-50",
      className,
    )}
    ref={ref}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export { Textarea };
